import { GoogleGenAI, Modality, EndSensitivity, StartSensitivity, type Session } from "@google/genai";
import { createAdminSupabaseClient } from "../src/lib/supabase/admin.js";
import { loadBusinessContext } from "../src/lib/ai/context.js";
import { executeAiTool } from "../src/lib/ai/tools.js";
import { buildVoiceSystemPrompt } from "./voicePrompt.js";
import { LIVE_TOOLS } from "./toolsAdapter.js";
import { findOrCreateCustomerByPhone } from "./customerLookup.js";
import { sendPushToBusiness } from "../src/lib/push.js";
import {
  twilioMuLawToGeminiPcm16,
  geminiPcm16ToTwilioMuLaw,
  resamplePcm16,
  bufferToInt16Array,
  int16ArrayToBuffer,
} from "./audio.js";

// Live API'ye özgü model — klasik generateContent'in kullandığı model (src/lib/ai/model.ts)
// sesli/gerçek-zamanlı modu desteklemiyor, ayrı bir "-live-" modeli gerekiyor. Kurulum
// sırasında Google AI Studio'dan güncel model adı doğrulanmalı, bu şimdilik en güncel bilinen ad.
const VOICE_MODEL = process.env.GEMINI_VOICE_MODEL ?? "gemini-2.5-flash-native-audio-preview-09-2025";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface CallHandlers {
  /** Twilio modunda μ-law 8kHz base64, tarayıcı modunda ham PCM16 24kHz base64 bekler. */
  sendAudioToClient: (base64Audio: string) => void;
  clearClientAudioQueue: () => void;
  /**
   * AI görüşmeyi sonlandırmaya karar verdiğinde (end_call aracı) çağrılır. Hemen
   * soketi kapatmak SON cümlenin (vedanın) kesilmesine yol açabilir — bu yüzden
   * gerçek kapatma server.ts'in sorumluluğunda: Twilio modunda kuyruktaki ses
   * gerçekten çalınana kadar bir "mark" ile beklenip ondan sonra kapatılıyor.
   */
  endCall: () => void;
}

/** twilio-mulaw-8k: gerçek telefon hattı. raw-pcm16: tarayıcı mikrofonu (Twilio yok, doğrudan WebSocket). */
type AudioMode = "twilio-mulaw-8k" | "raw-pcm16";

/**
 * Tek bir telefon araması (ya da tarayıcı test görüşmesi) boyunca yaşayan Gemini Live
 * oturumu. server.ts'teki WebSocket bu sınıfı çağırır: ses geldikçe pushAudio(), arama
 * bitince stop().
 */
export class VoiceCallSession {
  private session: Session | null = null;
  private customerId = "";
  private customerName = "";
  private businessId: string;
  private handlers: CallHandlers;
  private ready: Promise<void>;
  private audioMode: AudioMode;
  // Gecikme teşhisi için geçici zamanlama ölçümü — nerede yavaşladığını görmek için.
  // lastTurnEndAt: önceki model yanıtının bittiği an (turnComplete). Kullanıcı mikrofonu
  // sürekli akıttığı için "son kullanıcı sesi" ölçülemez (her ~85ms'de bir güncellenir,
  // konuşup konuşmadığına bakılmaksızın) — bunun yerine "önceki yanıt bitişi -> yeni
  // yanıtın ilk ses parçası" aralığını ölçüyoruz (kullanıcının konuşma süresini de içerir
  // ama araç-çağrısı süresiyle birlikte nerede zaman kaybedildiğini gösterir).
  private lastTurnEndAt = 0;
  private awaitingFirstResponseAudio = true;
  private toolCallStartedAt = 0;
  private stoppedByUs = false;

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
    const admin = createAdminSupabaseClient();

    const [ctx, customer] = await Promise.all([
      loadBusinessContext(this.businessId),
      findOrCreateCustomerByPhone(admin, this.businessId, callerIdentifier),
    ]);
    this.customerId = customer.id;
    this.customerName = customer.full_name;
    // Yeni musteri kaydi customerLookup.ts'de full_name=phone olarak olusturuluyor
    // (WhatsApp'taki gibi bir profil-adi kaynagi yok) - bu esitlik, ismin hala
    // hic sorulmamis oldugunun guvenilir bir isareti (bkz. voicePrompt.ts).
    const needsCallerName = customer.full_name === customer.phone;

    this.session = await ai.live.connect({
      model: VOICE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildVoiceSystemPrompt(ctx, needsCallerName),
        tools: [{ functionDeclarations: LIVE_TOOLS }],
        // Varsayılan "konuşma bitti" algılama gecikmesi hissedilir derecede yavaştı
        // (ölçülen tur gecikmesi 5-10sn) — sessizlik eşiğini kısaltarak modelin
        // kullanıcının sözünü bitirdiğine daha çabuk karar vermesi sağlanıyor.
        // A/B testiyle doğrulandı (2026-09-09): bu ayar KAPALIYKEN gecikme 7.5sn'ye,
        // 100ms'de 4-6sn'ye düşüyor. AMA 100ms gerçek kullanıcı testinde (2026-09-11)
        // konuşma kesilmelerine yol açtığı bildirildi — kullanıcı normal bir nefes/
        // duraklama molasında bile "sözünü bitirdi" sanılıp AI erken devreye giriyor,
        // ya da hat gürültüsü "kullanıcı konuşmaya başladı" sanılıp AI'nin kendi
        // cümlesi yarıda kesiliyor olabilir. 350ms, agresif hız kazanımının büyük
        // kısmını korurken (100ms'e göre yalnızca ~250ms ek gecikme) yanlış-pozitif
        // kesilme riskini belirgin şekilde azaltan bir orta nokta.
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
            prefixPaddingMs: 50,
            silenceDurationMs: 350,
          },
        },
        // Gecikme/davranış teşhisi için geçici: modelin gerçekte ne söylediğini ve
        // kullanıcıdan ne duyduğunu yazılı olarak görmek için (ses dinlemeden teşhis).
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => console.log(`[voice] Gemini Live oturumu açıldı — müşteri ${customer.phone}`),
        onmessage: (message) => this.handleGeminiMessage(message, ctx),
        onerror: (e) => {
          console.error("[voice] Gemini Live hata:", e?.message ?? e);
          this.handleUnexpectedSessionEnd(`hata: ${e?.message ?? "bilinmeyen"}`);
        },
        onclose: (e) => {
          console.log(`[voice] Gemini Live oturumu kapandı — code=${e?.code} reason=${e?.reason}`);
          if (!this.stoppedByUs) this.handleUnexpectedSessionEnd(`bağlantı koptu (code=${e?.code})`);
        },
      },
    });
  }

  private handleGeminiMessage(
    message: import("@google/genai").LiveServerMessage,
    ctx: Awaited<ReturnType<typeof loadBusinessContext>>
  ) {
    // Kullanıcı araya girdiyse (barge-in) - AI'nin kuyruktaki sesini hemen kes,
    // aksi halde AI konuşmaya devam ederken üstüne binen tuhaf bir gecikme olur.
    if (message.serverContent?.interrupted) {
      this.handlers.clearClientAudioQueue();
    }

    if (message.serverContent?.inputTranscription?.text) {
      console.log(`[voice][transkript] MÜŞTERİ: ${message.serverContent.inputTranscription.text}`);
    }
    if (message.serverContent?.outputTranscription?.text) {
      console.log(`[voice][transkript] AI: ${message.serverContent.outputTranscription.text}`);
    }

    const parts = message.serverContent?.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (this.awaitingFirstResponseAudio) {
          this.awaitingFirstResponseAudio = false;
          const elapsed = this.lastTurnEndAt ? Date.now() - this.lastTurnEndAt : 0;
          console.log(`[voice][zamanlama] yeni yanıtın ilk ses parçası: ${elapsed}ms (önceki yanıt bitişinden / arama başlangıcından beri, kullanıcının konuşma süresi dahil)`);
        }
        const outAudio =
          this.audioMode === "twilio-mulaw-8k"
            ? geminiPcm16ToTwilioMuLaw(part.inlineData.data)
            : part.inlineData.data; // raw-pcm16: Gemini zaten 24kHz PCM16 base64 döner, dönüşüm gerekmez
        this.handlers.sendAudioToClient(outAudio);
      }
    }

    if (message.serverContent?.turnComplete) {
      this.lastTurnEndAt = Date.now();
      this.awaitingFirstResponseAudio = true;
    }

    const functionCalls = message.toolCall?.functionCalls ?? [];
    if (functionCalls.length > 0) {
      this.toolCallStartedAt = Date.now();
      console.log(
        `[voice][zamanlama] araç çağrısı başladı: ${functionCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ")}`
      );
      void this.handleToolCalls(functionCalls, ctx);
    }
  }

  private async handleToolCalls(
    functionCalls: { name?: string; args?: Record<string, unknown>; id?: string }[],
    ctx: Awaited<ReturnType<typeof loadBusinessContext>>
  ) {
    // end_call SADECE sesli aramaya özgü (bkz. toolsAdapter.ts) - executeAiTool
    // (WhatsApp ile paylaşılan) bu ismi tanımıyor, o yüzden ona hiç gönderilmeden
    // burada ayrıca yakalanıyor.
    let shouldEndCall = false;

    const responses = await Promise.all(
      functionCalls.map(async (call) => {
        if (call.name === "end_call") {
          shouldEndCall = true;
          return { id: call.id, name: call.name, response: { result: "Görüşme sonlandırılıyor." } };
        }
        if (call.name === "save_customer_name") {
          const fullName = String(call.args?.full_name ?? "").trim();
          if (fullName) {
            this.customerName = fullName;
            const admin = createAdminSupabaseClient();
            await admin.from("customers").update({ full_name: fullName }).eq("id", this.customerId);
          }
          return { id: call.id, name: call.name, response: { result: "Kaydedildi." } };
        }
        const { result } = await executeAiTool(call.name ?? "", call.args ?? {}, {
          ctx,
          customerId: this.customerId,
          customerName: this.customerName,
        });
        console.log(`[voice][zamanlama] araç sonucu (${call.name}): ${result}`);
        return { id: call.id, name: call.name, response: { result } };
      })
    );
    console.log(`[voice][zamanlama] araç çağrısı toplam süresi: ${Date.now() - this.toolCallStartedAt}ms`);
    this.session?.sendToolResponse({ functionResponses: responses });

    if (shouldEndCall) {
      console.log("[voice] AI görüşmeyi sonlandırma kararı verdi (end_call)");
      this.handlers.endCall();
    }
  }

  /**
   * Twilio modunda μ-law 8kHz base64 bekler. raw-pcm16 modunda (tarayıcı mikrofonu)
   * ham PCM16 base64 bekler ve sourceSampleRate zorunludur (tarayıcının donanım oranı
   * genelde 48000, Gemini'nin beklediği 16000'e burada indirgenir).
   */
  async pushAudio(base64Audio: string, sourceSampleRate?: number): Promise<void> {
    await this.ready;
    const data =
      this.audioMode === "twilio-mulaw-8k"
        ? twilioMuLawToGeminiPcm16(base64Audio)
        : int16ArrayToBuffer(
            resamplePcm16(bufferToInt16Array(Buffer.from(base64Audio, "base64")), sourceSampleRate ?? 48000, 16000)
          ).toString("base64");

    this.session?.sendRealtimeInput({
      audio: { data, mimeType: "audio/pcm;rate=16000" },
    });
  }

  async stop(): Promise<void> {
    this.stoppedByUs = true;
    await this.ready.catch(() => undefined);
    this.session?.close();
  }

  /**
   * Gemini Live bağlantısı BİZİM istememizle değil (ağ sorunu, Google tarafı hata vb.)
   * kendiliğinden kopması durumunda çağrılır. Öncesinde bu sadece log'a yazılıyordu -
   * müşteri hatta sessizce (dead air) kalıyordu ve kimseye haber gitmiyordu
   * (2026-09-11 denetiminde bulundu). Artık hat gerçekten kapatılıyor VE sahibe
   * push bildirimiyle haber veriliyor.
   */
  private handleUnexpectedSessionEnd(reason: string): void {
    this.handlers.endCall();
    void sendPushToBusiness(this.businessId, {
      title: "Sesli arama teknik sorun yaşadı",
      body: `${this.customerName || "Bir müşteri"} ile görüşme beklenmedik şekilde kesildi (${reason}) — müşteriyi geri aramak isteyebilirsiniz.`,
    }).catch((err) => console.error("[voice] push bildirimi gönderilemedi (oturum koptu):", err));
  }
}
