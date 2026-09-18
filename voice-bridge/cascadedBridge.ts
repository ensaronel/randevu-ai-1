import Anthropic from "@anthropic-ai/sdk";
import { createAdminSupabaseClient } from "../src/lib/supabase/admin.js";
import { loadBusinessContext } from "../src/lib/ai/context.js";
import { executeAiTool } from "../src/lib/ai/tools.js";
import {
  shouldBlockMutation,
  AMBIGUOUS_REPLY_ERROR,
  shouldBlockAvailabilityCheck,
  NO_SERVICE_MENTIONED_ERROR,
  shouldBlockUnverifiedSlot,
  UNVERIFIED_SLOT_ERROR,
  parseVerifiedSlotsFromResult,
  shouldBlockUnverifiedName,
  NO_NAME_MENTIONED_ERROR,
  parseAssignmentsArg,
  type VerifiedSlot,
} from "../src/lib/ai/safetyGate.js";
import { buildVoiceSystemPrompt } from "./voicePrompt.js";
import { CLAUDE_LIVE_TOOLS } from "./claudeToolsAdapter.js";
import { findOrCreateCustomerByPhone } from "./customerLookup.js";
import { sendPushToBusiness } from "../src/lib/push.js";
import { DeepgramSttSession, type DeepgramEncoding } from "./deepgramStt.js";
import { synthesizeSpeechStream, type TtsOutputFormat } from "./elevenLabsTts.js";

/**
 * 2026-09-16: Gemini Live (geminiBridge.ts) tek bir ses-girdi/ses-çıktı modeliydi —
 * kullanıcı bunun bazen "kafası karıştığını" gözlemleyince, Google'ın gerçek-zamanlı
 * ses API'sinde daha akıllı bir "Pro" seviyesi HİÇ olmadığı ortaya çıktı (sadece
 * "Flash" var). Bu yüzden beyin (LLM) kısmını gerçekten daha yetenekli bir modele
 * (Claude Haiku 4.5) taşıyabilmek için mimari STT (Deepgram) + LLM (Claude) + TTS
 * (ElevenLabs) olarak üçe ayrıldı. geminiBridge.ts KASITLI OLARAK dokunulmadan
 * bırakıldı — server.ts'teki TEK satırlık import değişikliği geri alınarak
 * (cascadedBridge.js -> geminiBridge.js) anında eski sisteme dönülebilir.
 */
const VOICE_LLM_MODEL = "claude-haiku-4-5";
const MAX_TOOL_ITERATIONS = 6;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface CallHandlers {
  sendAudioToClient: (base64Audio: string) => void;
  clearClientAudioQueue: () => void;
  endCall: () => void;
}

type AudioMode = "twilio-mulaw-8k" | "raw-pcm16";

export class VoiceCallSession {
  private customerId = "";
  private customerName = "";
  private customerPhone = "";
  private businessId: string;
  private handlers: CallHandlers;
  private ready: Promise<void>;
  private audioMode: AudioMode;
  private ctx: Awaited<ReturnType<typeof loadBusinessContext>> | null = null;
  private systemPrompt = "";
  private messages: Anthropic.MessageParam[] = [];
  private stoppedByUs = false;

  private deepgram: DeepgramSttSession | null = null;
  private currentUtteranceBuffer = "";

  // "busy": bir kullanıcı turu işlenirken (Claude'a soruluyor, araç çalışıyor, TTS
  // konuşuyor) true — bu süre boyunca müşteriden gelen YENİ bir "speech_final" hemen
  // işlenmez, kaybolmadan kuyruğa alınır (queuedUtteranceWhileBusy), tur bitince
  // otomatik olarak bir SONRAKİ tur olarak başlatılır. Bu, Gemini Live'daki
  // ActivityHandling.NO_INTERRUPTION (AI'nin sözü asla yarıda kesilmez) davranışının
  // elle yönetilen karşılığı — orada bunu tek model içeriden yapıyordu, burada
  // biz üç ayrı sistemi (STT/LLM/TTS) koordine ettiğimiz için kendimiz yönetiyoruz.
  private busy = false;
  private queuedUtteranceWhileBusy = "";
  // AI'nin kendi sesi (hoparlörden) tarayıcı testinde mikrofona sızıp Deepgram'a
  // "müşteri konuşuyor" gibi gidebiliyordu — AI kendi söylediğini/önceki cümleleri
  // duyup kafası karışıyordu (2026-09-16'da canlı testte yakalandı: müşteri daha
  // önce sorduğu bir şeyi tekrar "söylemiş" gibi göründü). Twilio'da (gerçek telefon
  // hattı, hoparlör/mikrofon akustik sızıntısı yok) bu risk yok ama yine de savunma
  // amaçlı: AI konuşurken mikrofon sesi Deepgram'a HİÇ gönderilmiyor.
  private isTtsPlaying = false;
  // Kullanıcının isteği üzerine (2026-09-18) AI konuşurken müşteri araya girip
  // konuşmaya başlarsa (barge-in) AI'nin sözü hemen kesilir — bkz. handleBargeIn.
  // Bu, aktif bir speak() çağrısı varsa onun beklemesini erken bitirmek için kullanılır.
  private ttsInterruptResolve: (() => void) | null = null;

  private recentUtterances: string[] = [];
  private fullTranscript: string[] = [];
  private verifiedSlots: VerifiedSlot[] = [];

  private turnStartedAt = 0;

  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SILENCE_NUDGE_MS = 8000;
  private deadAirTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEAD_AIR_TIMEOUT_MS = 20000;

  constructor(
    businessId: string,
    callerIdentifier: string,
    handlers: CallHandlers,
    audioMode: AudioMode = "twilio-mulaw-8k"
  ) {
    this.businessId = businessId;
    this.handlers = handlers;
    this.audioMode = audioMode;
    this.ready = this.setup(callerIdentifier);
  }

  private async setup(callerIdentifier: string): Promise<void> {
    try {
      await this.setupOrThrow(callerIdentifier);
    } catch (err) {
      // bkz. geminiBridge.ts'teki AYNI yorum — hatayı burada yutup this.ready'yi
      // REJECT ETMEDEN bitirmek zorunlu, aksi halde pushAudio()'daki "await this.ready"
      // tüm sunucu sürecini çökertebilecek yakalanmamış bir promise reddi üretir.
      console.error("[voice] kurulum başarısız, görüşme sonlandırılıyor:", (err as Error).message);
      this.handleUnexpectedSessionEnd(`kurulum hatası: ${(err as Error).message}`);
    }
  }

  private async setupOrThrow(callerIdentifier: string): Promise<void> {
    const admin = createAdminSupabaseClient();
    const [ctx, customer] = await Promise.all([
      loadBusinessContext(this.businessId),
      findOrCreateCustomerByPhone(admin, this.businessId, callerIdentifier),
    ]);
    this.ctx = ctx;
    this.customerId = customer.id;
    this.customerName = customer.full_name;
    this.customerPhone = customer.phone;
    const needsCallerName = customer.full_name === customer.phone;
    this.systemPrompt = buildVoiceSystemPrompt(ctx, needsCallerName);

    // Telefonu AI kendi açar, müşterinin önce bir şey söylemesini beklemez — bkz.
    // playFixedGreeting yorumu (Gemini sürümündeki [ARAMA_BAŞLADI] deseninin, gereksiz
    // LLM turu olmadan optimize edilmiş hâli).
    void this.playFixedGreeting();
  }

  /** Deepgram bağlantısı ilk ses parçası gelene kadar AÇILMAZ — karşılama cümlesi (yukarıda) STT beklemeden hemen başlar. */
  private ensureDeepgram(sourceSampleRate?: number): void {
    if (this.deepgram) return;
    const encoding: DeepgramEncoding = this.audioMode === "twilio-mulaw-8k" ? "mulaw" : "linear16";
    const sampleRate = this.audioMode === "twilio-mulaw-8k" ? 8000 : sourceSampleRate ?? 48000;

    this.deepgram = new DeepgramSttSession(encoding, sampleRate, {
      onTranscript: (t) => {
        this.armDeadAirTimer();
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
        // ÇOK ÖNEMLİ (2026-09-18'de canlı testte yakalandı) — barge-in'i SpeechStarted'a
        // (ham ses enerjisi eşiği — öksürük, nefes, hatta AI'nin kendi sesinin hoparlörden
        // sızıntısı bile tetikliyordu, "en küçük şeyde bile kesiliyor") DEĞİL, GERÇEK bir
        // transkript kelimesine bağlıyoruz: Deepgram bir şeyi ancak GERÇEKTEN anlaşılır bir
        // söz olarak tanıdığında (ara/kesin fark etmez) transcript döner — gürültü/öksürük
        // için bu neredeyse hiç olmaz. Böylece AI'nin sözü sadece müşteri GERÇEKTEN bir şey
        // söylemeye başladığında kesilir.
        if (t.transcript.trim()) this.handleBargeIn();
        if (t.isFinal) {
          console.log(`[voice][transkript] MÜŞTERİ: ${t.transcript}`);
          this.currentUtteranceBuffer = (this.currentUtteranceBuffer + " " + t.transcript).trim();
        }
        if (t.speechFinal) this.flushUtterance();
      },
      onUtteranceEnd: () => {
        this.armDeadAirTimer();
        this.flushUtterance();
      },
      // SpeechStarted (ham ses enerjisi) ARTIK barge-in'i tetiklemiyor (yukarıdaki yoruma
      // bkz.) — sadece dead-air bekçisini sıfırlamak için (birileri konuşmaya başladı,
      // sessizlik değil) kullanılıyor, "kesme" kararı onTranscript'e taşındı.
      onSpeechStarted: () => this.armDeadAirTimer(),
      onError: (err) => console.error("[voice] Deepgram hatası:", err.message),
      onClose: () => {
        if (!this.stoppedByUs) console.warn("[voice] Deepgram bağlantısı beklenmedik şekilde kapandı");
      },
    });
  }

  private flushUtterance(): void {
    const text = this.currentUtteranceBuffer.trim();
    this.currentUtteranceBuffer = "";
    if (!text) return;
    void this.enqueueUserTurn(text);
  }

  /** Gerçek müşteri sözü ya da sentetik bir işaret ([SESSİZLİK] vb.) — "busy" ise kaybolmadan kuyruğa alınır. */
  private enqueueUserTurn(text: string): void {
    if (this.busy) {
      this.queuedUtteranceWhileBusy = (this.queuedUtteranceWhileBusy + " " + text).trim();
      return;
    }
    void this.startTurn(text);
  }

  private async startTurn(text: string): Promise<void> {
    this.busy = true;
    this.armDeadAirTimer();
    this.turnStartedAt = Date.now();

    if (text !== "[ARAMA_BAŞLADI]" && text !== "[SESSİZLİK]" && text !== "[TEMSİLCİYE_YÖNLENDİR]") {
      this.recentUtterances.push(text);
      if (this.recentUtterances.length > 2) this.recentUtterances.shift();
      this.fullTranscript.push(text);
    }
    this.messages.push({ role: "user", content: text });

    await this.runClaudeLoop();

    this.finishTurn();
  }

  private finishTurn(): void {
    this.busy = false;
    if (this.queuedUtteranceWhileBusy) {
      const queued = this.queuedUtteranceWhileBusy;
      this.queuedUtteranceWhileBusy = "";
      void this.startTurn(queued);
    } else {
      this.armSilenceTimer();
    }
  }

  /**
   * voicePrompt.ts, "[ARAMA_BAŞLADI]" için modele HARFİYEN sabit bir cümle söyletiyor
   * ("aynen, başka hiçbir şey ekleme/değiştirme") — yani bu ilk cevap zaten tamamen
   * deterministik, Claude'a sormanın tek etkisi gereksiz bir ağ turu (2026-09-18'de
   * canlı testte fark edildi: "başlarken biraz bekliyor" şikayeti). Bu yüzden ilk
   * karşılama cümlesini LLM'e hiç sormadan doğrudan sesle çalıyoruz — konuşma geçmişine
   * de AYNI turu (kullanıcı sentetik işareti + modelin normalde vereceği cevap) yazıyoruz
   * ki Claude bir sonraki turda "az önce ne oldu" konusunda tutarlı bir bağlama sahip olsun.
   */
  private async playFixedGreeting(): Promise<void> {
    this.busy = true;
    this.armDeadAirTimer();
    this.turnStartedAt = Date.now();
    // "${name}'in yapay zeka asistanı" yapısı Türkçe ünlü uyumuna göre doğru eki (-in/-ün/
    // -nin/-nün vb.) gerektirir — sabit bir ek her işletme adında doğru olmaz (2026-09-18'de
    // canlı testte yakalandı). "Burası X" yapısı hiçbir ek gerektirmediği için HER işletme
    // adıyla (harf uyumundan bağımsız) her zaman doğru/doğal çıkar.
    const greeting = `Merhaba, burası ${this.ctx!.business.name}. Lütfen yapmak istediğiniz işlemi söyleyiniz.`;
    this.messages.push({ role: "user", content: "[ARAMA_BAŞLADI]" });
    this.messages.push({ role: "assistant", content: greeting });
    await this.speak(greeting);
    this.finishTurn();
  }

  /**
   * 2026-09-18: kullanıcı "kredi çok yiyor çünkü konuşma uzuyor" diye şikayet etti — kök
   * neden bulundu: system+tools önbelleğe alınıyordu (cache_control) ama `messages` (konuşma
   * geçmişinin KENDİSİ) alınmıyordu, yani 10. turda Claude'a HER SEFERİNDE önceki 9 turun
   * TAMAMI baştan, önbelleksiz/tam fiyattan gönderiliyordu — uzun aramalarda maliyet turlarla
   * birlikte katlanarak büyüyordu. Anthropic'in standart çoklu-tur önbellek deseni: HER
   * çağrıda son mesajın son bloğuna bir önbellek noktası koy — bir SONRAKİ turda bu nokta
   * hâlâ gerçek bir ÖNEK (prefix) olduğu için önbellek isabet eder, sadece ARADAN GEÇEN yeni
   * içerik tam fiyattan işlenir. `this.messages`'ı KALICI DEĞİŞTİRMİYORUZ (her çağrıda BURADA,
   * tek kullanımlık bir kopya üretiliyor) — aksi halde çağrılar arasında biriken eski önbellek
   * noktaları toplam 4 blok sınırını (system+tools zaten 2 kullanıyor) aşabilirdi.
   */
  private buildMessagesWithCachePoint(): Anthropic.MessageParam[] {
    return this.messages.map((msg, i) => {
      const blocks: Anthropic.ContentBlockParam[] =
        typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : [...msg.content];
      if (i === this.messages.length - 1 && blocks.length > 0) {
        const lastIdx = blocks.length - 1;
        // Bu uygulamada mesaj geçmişinde SADECE text/tool_use/tool_result blokları oluşur
        // (thinking KAPALI, resim yok) — ikisi de cache_control'ü destekliyor, tip daraltması
        // için bir doğrulama yeterli.
        const block = blocks[lastIdx];
        if (block.type === "text" || block.type === "tool_use" || block.type === "tool_result") {
          blocks[lastIdx] = { ...block, cache_control: { type: "ephemeral" } };
        }
      }
      return { role: msg.role, content: blocks };
    });
  }

  private async runClaudeLoop(): Promise<void> {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let response: Anthropic.Message | null = null;
      const claudeCallStartedAt = Date.now();
      // Ağdaki geçici bir yavaşlama/zaman aşımında hemen pes edip müşteriden "tekrar söyler
      // misiniz" istemek yerine (2026-09-18'de canlı testte bir "Request timed out" görüldü —
      // ardındaki tur normal hıza döndü, yani geçiciydi) SESSİZCE bir kez daha deniyoruz;
      // ikinci deneme de başarısız olursa ancak o zaman müşteriye haber veriyoruz.
      const MAX_ATTEMPTS = 2;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !response; attempt++) {
        try {
          response = await anthropic.messages.create({
            model: VOICE_LLM_MODEL,
            // 200: sesli cevaplar zaten kısa cümleler olmalı (bkz. voicePrompt.ts) — bu sadece
            // bir üst sınır, maliyeti/gecikmeyi büyütecek gereksiz uzun cevapları engeller.
            max_tokens: 200,
            // Bir arama boyunca sistem promptu HİÇ değişmiyor (tek seferde hesaplanıp
            // this.systemPrompt'ta saklanıyor) — önbellek noktası koyarak her turda aynı
            // uzun promptun yeniden işlenmesini önlüyoruz (araçlardaki cache_control ile
            // birlikte, bkz. claudeToolsAdapter.ts).
            system: [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }],
            tools: CLAUDE_LIVE_TOOLS,
            messages: this.buildMessagesWithCachePoint(),
          });
        } catch (err) {
          console.error(`[voice] Claude çağrısı başarısız (deneme ${attempt}/${MAX_ATTEMPTS}):`, (err as Error).message);
        }
      }
      if (!response) {
        await this.speak("Kusura bakmayın, küçük bir teknik aksaklık yaşadım, tekrar söyler misiniz?");
        return;
      }
      console.log(`[voice][zamanlama] Claude yanıt süresi: ${Date.now() - claudeCallStartedAt}ms`);
      this.messages.push({ role: "assistant", content: response.content });

      const textOut = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      if (textOut) await this.speak(textOut);

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) return;

      const { toolResults, shouldEndCall } = await this.handleToolCalls(toolUses);
      this.messages.push({ role: "user", content: toolResults });

      if (shouldEndCall) {
        console.log("[voice] AI görüşmeyi sonlandırma kararı verdi (end_call)");
        this.handlers.endCall();
        return;
      }
    }
    console.warn("[voice] maksimum araç-çağrısı döngüsüne ulaşıldı, tur zorla bitiriliyor");
  }

  private async handleToolCalls(
    toolUses: Anthropic.ToolUseBlock[]
  ): Promise<{ toolResults: Anthropic.ToolResultBlockParam[]; shouldEndCall: boolean }> {
    let shouldEndCall = false;
    const ctx = this.ctx!;

    const toolResults = await Promise.all(
      toolUses.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
        const args = (call.input as Record<string, unknown>) ?? {};

        if (call.name === "end_call") {
          shouldEndCall = true;
          return { type: "tool_result", tool_use_id: call.id, content: "Görüşme sonlandırılıyor." };
        }
        if (call.name === "save_customer_name") {
          const fullName = String(args.full_name ?? "").trim();
          if (fullName && shouldBlockUnverifiedName(fullName, this.fullTranscript.join(" "))) {
            console.warn(`[voice] GÜVENLİK: save_customer_name engellendi - "${fullName}" müşterinin söylediği hiçbir şeyde geçmiyor`);
            return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify({ error: NO_NAME_MENTIONED_ERROR }) };
          }
          if (fullName) {
            this.customerName = fullName;
            const admin = createAdminSupabaseClient();
            try {
              await admin.from("customers").update({ full_name: fullName }).eq("id", this.customerId);
            } catch (err) {
              console.error(`[voice] save_customer_name DB güncellemesi başarısız oldu: ${err}`);
            }
          }
          return { type: "tool_result", tool_use_id: call.id, content: "Kaydedildi." };
        }
        if (call.name === "check_availability" && shouldBlockAvailabilityCheck((args.service_names as string[] | undefined) ?? [], this.fullTranscript.join(" "))) {
          console.warn(`[voice] GÜVENLİK: check_availability engellendi - istenen hizmet(ler) (${JSON.stringify(args.service_names)}) müşterinin söylediği hiçbir şeyde geçmiyor`);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify({ error: NO_SERVICE_MENTIONED_ERROR }) };
        }
        if (shouldBlockMutation(call.name, this.recentUtterances)) {
          console.warn(`[voice] GÜVENLİK: ${call.name} engellendi - müşterinin son sözleri (${JSON.stringify(this.recentUtterances)}) anlamlı bir onay/seçim gibi görünmüyor`);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify({ error: AMBIGUOUS_REPLY_ERROR }) };
        }
        if (
          shouldBlockUnverifiedSlot(
            call.name,
            {
              startsAt: String(args.starts_at ?? ""),
              endsAt: String(args.ends_at ?? ""),
              assignments: parseAssignmentsArg(args.assignments),
            },
            this.verifiedSlots
          )
        ) {
          console.warn(`[voice] GÜVENLİK: ${call.name} engellendi - önerilen saat/personel gerçekten başarılı bir check_availability sonucunda yok (${JSON.stringify(args)})`);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify({ error: UNVERIFIED_SLOT_ERROR }) };
        }

        console.log(`[voice][zamanlama] araç çağrısı: ${call.name}(${JSON.stringify(args)})`);
        const { result, escalated, escalationReason } = await executeAiTool(call.name, args, {
          ctx,
          customerId: this.customerId,
          customerName: this.customerName,
          customerPhone: this.customerPhone,
          channel: "voice",
        });
        console.log(`[voice][zamanlama] araç sonucu (${call.name}): ${result}`);
        if (call.name === "check_availability" && !result.includes('"error"')) {
          this.verifiedSlots.push(...parseVerifiedSlotsFromResult(result));
        }
        if (escalated) this.notifyOwnerEscalation(escalationReason ?? "belirtilmedi");
        return { type: "tool_result", tool_use_id: call.id, content: result };
      })
    );

    return { toolResults, shouldEndCall };
  }

  /** Metni sese çevirip Twilio'ya/tarayıcıya akıtır. Tahmini çalma süresi kadar bekler (gerçek "playback bitti" geri bildirimi yok, bkz. plan). */
  private async speak(text: string): Promise<void> {
    console.log(`[voice][transkript] AI: ${text}`);
    this.isTtsPlaying = true;
    // bkz. deepgramStt.ts'teki sendKeepAlive yorumu — bu pencere boyunca Deepgram'a hiç
    // gerçek ses gitmiyor, uzun cevaplarda bağlantının kendiliğinden kopmasını önler.
    const keepAliveTimer = setInterval(() => this.deepgram?.sendKeepAlive(), 5000);
    const outputFormat: TtsOutputFormat = this.audioMode === "twilio-mulaw-8k" ? "ulaw_8000" : "pcm_24000";
    // mulaw 8kHz: 1 bayt/örnek -> 8 bayt/ms. pcm16 24kHz: 2 bayt/örnek * 24 örnek/ms = 48 bayt/ms.
    const bytesPerMs = this.audioMode === "twilio-mulaw-8k" ? 8 : 48;
    let totalBytes = 0;
    // ElevenLabs'in HTTP akışı, örnek (2 baytlık PCM16) sınırlarına hizalı parçalar
    // GARANTİ ETMİYOR — tek sayı baytla biten bir parça, tarayıcının onu bağımsız bir
    // Int16Array olarak yorumlamasıyla (bkz. call.html'deki playChunk) o parçadan sonraki
    // TÜM örnekleri kaydırıp cızırtı/karıncalanmaya yol açıyordu (2026-09-16'da canlı
    // testte bulundu). mulaw'da (1 bayt = 1 örnek) bu sorun yok, sadece pcm_24000'de
    // (tarayıcı test yolu) art arda parçalar arasında tek kalan baytı bir sonrakine
    // taşıyıp HER ZAMAN çift sayıda bayt gönderiyoruz.
    let leftoverByte: Buffer | null = null;
    let firstChunkLogged = false;
    try {
      for await (const rawChunk of synthesizeSpeechStream(text, outputFormat)) {
        // Barge-in TTS AKARKEN de gerçekleşebilir — müşteri araya girdiği anda kalan
        // parçaları hiç göndermeden akışı kes (zaten çalınmış kısım clearClientAudioQueue
        // ile durdurulur, bkz. handleBargeIn).
        if (!this.isTtsPlaying) break;
        let chunk = rawChunk;
        if (outputFormat === "pcm_24000") {
          if (leftoverByte) {
            chunk = Buffer.concat([leftoverByte, chunk]);
            leftoverByte = null;
          }
          if (chunk.length % 2 !== 0) {
            leftoverByte = chunk.subarray(chunk.length - 1);
            chunk = chunk.subarray(0, chunk.length - 1);
          }
          if (chunk.length === 0) continue;
        }
        if (!firstChunkLogged) {
          firstChunkLogged = true;
          console.log(`[voice][zamanlama] yeni yanıtın ilk ses parçası: ${Date.now() - this.turnStartedAt}ms (kullanıcının konuşma bitişinden beri)`);
        }
        totalBytes += chunk.length;
        this.handlers.sendAudioToClient(chunk.toString("base64"));
      }
    } catch (err) {
      console.error("[voice] TTS hatası:", (err as Error).message);
      clearInterval(keepAliveTimer);
      this.isTtsPlaying = false;
      return;
    }
    if (!this.isTtsPlaying) {
      // Barge-in akış sırasında oldu — handleBargeIn zaten isTtsPlaying'i kapattı,
      // tahmini oynatma süresini beklemeye hiç gerek yok.
      clearInterval(keepAliveTimer);
      return;
    }
    // 2026-09-18'de kullanıcı "bazen konuşuyorum ama gitmiyor" diye bildirdi — bu tahmini
    // süre GERÇEK "çalma bitti" geri bildirimi olmadığı için (bkz. yukarıdaki fonksiyon
    // yorumu) hafif kısa kalırsa, müşteri konuşmaya AI'nin sesi tam olarak susmadan
    // başlıyor ve isTtsPlaying hâlâ true iken pushAudio() o ilk sözleri sessizce atıyordu.
    // Tamponu 150ms'den büyütmek (müşterinin bir anlık ekstra beklemesi pahasına) gerçek
    // sözün kaybolmasından çok daha az zararlı. Bu bekleme de barge-in ile ERKEN
    // bitirilebilir (bkz. ttsInterruptResolve/handleBargeIn) — müşteri konuşmaya
    // başladığı an AI'nin sesi tam anlamıyla kesilir, geri kalan tahmini süreyi beklemez.
    const estimatedPlaybackMs = totalBytes / bytesPerMs;
    await new Promise<void>((resolve) => {
      this.ttsInterruptResolve = resolve;
      setTimeout(resolve, estimatedPlaybackMs + 450);
    });
    this.ttsInterruptResolve = null;
    clearInterval(keepAliveTimer);
    this.isTtsPlaying = false;
  }

  async pushAudio(base64Audio: string, sourceSampleRate?: number): Promise<void> {
    await this.ready;
    this.ensureDeepgram(sourceSampleRate);
    // ÖNEMLİ (2026-09-18, barge-in eklendi): ses artık AI konuşurken de Deepgram'a
    // gönderiliyor — müşteri araya girdiğinde bunu ANLIK yakalamak (bkz. onSpeechStarted
    // -> handleBargeIn) için mikrofonun kesintisiz akması gerekiyor. Tarayıcı testinde
    // (raw-pcm16, hoparlör/mikrofon aynı cihazda) bu, AI'nin KENDİ sesini "araya giriliyor"
    // sanıp kendini kesmesine yol açabilir — bu SADECE tarayıcı test aracına özgü bir risk
    // (bkz. AudioMode), gerçek Twilio aramasında iki taraf ayrı hatlarda olduğu için bu
    // risk yok. Tarayıcıda test ederken kulaklık kullanmak bunu tamamen ortadan kaldırır.
    void this.deepgram!.pushAudio(Buffer.from(base64Audio, "base64"));
  }

  /** Müşteri AI konuşurken konuşmaya başladığında (Deepgram VAD "SpeechStarted") anında çağrılır. */
  private handleBargeIn(): void {
    if (!this.isTtsPlaying) return;
    console.log("[voice] BARGE-IN: müşteri araya girdi, AI'nin sözü kesiliyor");
    this.handlers.clearClientAudioQueue();
    this.isTtsPlaying = false;
    this.ttsInterruptResolve?.();
    this.ttsInterruptResolve = null;
  }

  async stop(): Promise<void> {
    this.stoppedByUs = true;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.deadAirTimer) clearTimeout(this.deadAirTimer);
    await this.ready.catch(() => undefined);
    this.deepgram?.close();
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.stoppedByUs) return;
      void this.enqueueUserTurn("[SESSİZLİK]");
    }, VoiceCallSession.SILENCE_NUDGE_MS);
  }

  private armDeadAirTimer(): void {
    if (this.deadAirTimer) clearTimeout(this.deadAirTimer);
    this.deadAirTimer = setTimeout(() => {
      this.deadAirTimer = null;
      if (this.stoppedByUs) return;
      console.error("[voice] ÖLÜ HAVA: uzun süre hiçbir taraftan olay gelmedi, görüşme sonlandırılıyor");
      this.handleUnexpectedSessionEnd("uzun süre hiçbir taraftan yanıt gelmedi (dead air)");
    }, VoiceCallSession.DEAD_AIR_TIMEOUT_MS);
  }

  private notifyOwnerEscalation(reason: string): void {
    void sendPushToBusiness(this.businessId, {
      title: "Sesli arama sizi bekliyor",
      body: `${this.customerName || "Bir müşteri"} ile görüşmede AI yardımcı olamadı (${reason}) — müşteriyi geri aramak isteyebilirsiniz.`,
      url: "/takvim",
    }).catch((err) => console.error("[voice] push bildirimi gönderilemedi (escalate):", err));
  }

  escalateToHuman(reason: string): void {
    this.notifyOwnerEscalation(reason);
    this.enqueueUserTurn("[TEMSİLCİYE_YÖNLENDİR]");
  }

  private handleUnexpectedSessionEnd(reason: string): void {
    this.stoppedByUs = true;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.deadAirTimer) clearTimeout(this.deadAirTimer);
    this.handlers.endCall();
    void sendPushToBusiness(this.businessId, {
      title: "Sesli arama teknik sorun yaşadı",
      body: `${this.customerName || "Bir müşteri"} ile görüşme beklenmedik şekilde kesildi (${reason}) — müşteriyi geri aramak isteyebilirsiniz.`,
    }).catch((err) => console.error("[voice] push bildirimi gönderilemedi (oturum koptu):", err));
  }
}
