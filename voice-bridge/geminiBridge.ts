import { GoogleGenAI, Modality, EndSensitivity, StartSensitivity, ActivityHandling, type Session } from "@google/genai";
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
  type VerifiedSlot,
} from "../src/lib/ai/safetyGate.js";
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
  private customerPhone = "";
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
  // Kullanıcının isteği üzerine (2026-09-12): AI sözünü bitirdikten sonra müşteriden
  // makul bir süre (8sn) hiç ses gelmezse, sessizce beklemek yerine nazikçe tekrar sorsun.
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SILENCE_NUDGE_MS = 8000;
  // silenceTimer SADECE "AI sözünü bitirdi, müşteri sessiz kaldı" durumunu kapsar (yalnızca
  // bir AI turnComplete'inden SONRA yeniden kuruluyor). 2026-09-12'de canlı testte yakalandı:
  // müşteri art arda/karışık bir şey söyleyince (ör. aynı cümleyi birkaç kez tekrarlayınca)
  // Gemini'nin kendi konuşma-bitti algısı hiç tetiklenmemiş olabilir — bu durumda AI turu
  // HİÇ tamamlanmıyor, silenceTimer da hiç yeniden kurulmuyor (çünkü kurulması bir
  // turnComplete'e bağlı) ve arama SONSUZA KADAR sessiz kalabiliyor, müşteri hattaymış gibi
  // görünüp kimseden hiçbir şey duymuyor. deadAirTimer bunun genel bir güvenlik ağı: kimden
  // geldiği (AI/müşteri) fark etmeksizin HERHANGİ bir olay geldiğinde sıfırlanır; hiçbir şey
  // gelmezse (Gemini'nin kendisi tıkanmış olabilir) görüşme nazikçe sonlandırılır ve sahibe
  // haber verilir — müşteri süresiz sessizlikte terk edilmez.
  private deadAirTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEAD_AIR_TIMEOUT_MS = 20000;
  // Kullanıcının bizzat gördüğü gerçek bir olay üzerine eklendi (2026-09-12): model,
  // müşterinin söylediği anlamsız/alakasız bir şeyi ("all would be shout out to the"
  // gibi net bir gürültü/anlamsız cümle) saat onayı SANIP randevu oluşturdu, hatta bir
  // sonraki turda müşteri yine anlamsız bir şey söyleyince UYDURMA bir isim yazıp
  // create_appointment'ı GERÇEKTEN çağırdı. Salt prompt talimatı ("belirsiz cevabı onay
  // sayma") bunu ÖNLEYEMEDİ — model olasılıksal, bazen talimatı atlıyor. Bu yüzden
  // create_appointment/cancel_appointment/reschedule_appointment için KOD SEVİYESİNDE
  // bir son kontrol eklendi: müşterinin bu turda söylediği son şeyde en azından bir
  // sayı/saat kelimesi/evet-benzeri bir işaret yoksa, araç hiç çalıştırılmadan model'e
  // "net anlaşılamadı, tekrar sor" hatası döndürülüyor - bkz. isLikelyMeaningfulReply.
  private currentUtteranceBuffer = "";
  // Sadece TEK son turu değil son İKİ turu birlikte kontrol ediyoruz - çünkü onay
  // ("evet o saat olsun") ve isim ("Ayşe Kaya") ayrı turlarda gelebilir (bkz.
  // voicePrompt.ts'teki "tek soru sor" kuralı) - sadece son turu kontrol etsek,
  // isim TEK BAŞINA hiçbir rakam/onay kelimesi içermediği için MEŞRU bir randevuyu
  // bile yanlışlıkla engellerdik.
  private recentUtterances: string[] = [];
  // recentUtterances'tan FARKLI olarak görüşmenin BAŞINDAN İTİBAREN TÜMÜ (kırpılmıyor) —
  // hizmet genelde bir kez söylenir ve tekrar edilmesi beklenmez, bu yüzden "hizmet hiç
  // bahsedilmedi mi" kontrolü sadece son 1-2 tura değil TÜM görüşmeye bakmalı (bkz.
  // safetyGate.ts'teki shouldBlockAvailabilityCheck).
  private fullTranscript: string[] = [];
  // check_availability GERÇEKTEN başarılı (hatasız) döndüğünde biriken doğrulanmış
  // saat/personel seçenekleri — create_appointment/reschedule_appointment'ın önerdiği
  // slotun GERÇEKTEN buradan geldiğini doğrulamak için (bkz. safetyGate.ts'teki
  // shouldBlockUnverifiedSlot; 2026-09-13'te canlı testte AI, engellenen bir
  // check_availability sonucunu görmezden gelip saat/personel UYDURUP randevu oluşturdu).
  private verifiedSlots: VerifiedSlot[] = [];

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
      // ÇOK ÖNEMLİ — burada hatayı yutup this.ready'yi REJECT ETMEDEN bitiriyoruz:
      // pushAudio() her ses parçasında "await this.ready" yapıyor ve reddedilen bir
      // promise burada YAKALANMAZSA (server.ts "void callSession.pushAudio(...)" ile
      // sonucu hiç beklemiyor) Node'da yakalanmamış bir promise reddi TÜM sunucu
      // sürecini çökertip aktif diğer görüşmeleri de keser. Bunun yerine context
      // yüklenemediğinde görüşme burada nazikçe (ve sadece bu arama için) sonlandırılır,
      // sahibe bildirim gider — müşteriye sessiz/yanlış bir cevap gitmez.
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
    this.customerId = customer.id;
    this.customerName = customer.full_name;
    this.customerPhone = customer.phone;
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
        //
        // startOfSpeechSensitivity 2026-09-12'de HIGH'dan LOW'a düşürüldü: gerçek test
        // loglarında arka plan gürültüsünün (özellikle tarayıcı test aracının laptop
        // mikrofonunda) "müşteri konuşuyor" sanılıp modele anlamsız transkript olarak
        // gittiği görüldü (ör. "talk", "Doriar med mitt nya hjärta" gibi hiçbir müşterinin
        // söylemediği parçalar) — model bunları yorumlamaya çalışınca konu dışına çıkıp
        // kafası karışıyordu. LOW, daha net/yüksek sesli konuşmayı bekler, zayıf/belirsiz
        // sesleri konuşma başlangıcı saymaz.
        // activityHandling: NO_INTERRUPTION — kullanıcının isteği üzerine (2026-09-12)
        // AI konuşurken müşteriden gelen hiçbir ses onu KESMEZ artık ("barge-in" kapalı).
        // AI cümlesini her zaman sonuna kadar bitirir, ancak SONRA müşteriyi dinlemeye
        // geçer. Müşteri AI konuşurken bir şey söylerse bu kaybolmaz — VAD onu yine de
        // algılar, sadece modelin o anki yanıtını kesip yarıda bırakmaz.
        realtimeInputConfig: {
          activityHandling: ActivityHandling.NO_INTERRUPTION,
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
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

    // Kullanıcının isteği üzerine (2026-09-12): telefonu AI kendi açsın, müşterinin
    // önce bir şey söylemesini beklemesin. [SESSİZLİK]/[TEMSİLCİYE_YÖNLENDİR] ile
    // aynı sentetik-tur deseni — voicePrompt.ts modele bunun karşılığında sabit bir
    // karşılama cümlesi söylemesi gerektiğini öğretiyor.
    this.session?.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "[ARAMA_BAŞLADI]" }] }],
      turnComplete: true,
    });
    this.armDeadAirTimer();
  }

  private armDeadAirTimer(): void {
    if (this.deadAirTimer) clearTimeout(this.deadAirTimer);
    this.deadAirTimer = setTimeout(() => {
      this.deadAirTimer = null;
      if (this.stoppedByUs) return;
      console.error("[voice] ÖLÜ HAVA: Gemini'den/müşteriden uzun süre hiçbir olay gelmedi, görüşme sonlandırılıyor");
      this.handleUnexpectedSessionEnd("uzun süre hiçbir taraftan yanıt gelmedi (dead air)");
    }, VoiceCallSession.DEAD_AIR_TIMEOUT_MS);
  }

  private handleGeminiMessage(
    message: import("@google/genai").LiveServerMessage,
    ctx: Awaited<ReturnType<typeof loadBusinessContext>>
  ) {
    // Gemini'den GERÇEKTEN bir şey geldi (ne olursa olsun) - bağlantı hâlâ canlı,
    // "ölü hava" bekçisini sıfırla.
    this.armDeadAirTimer();

    // Kullanıcı araya girdiyse (barge-in) - AI'nin kuyruktaki sesini hemen kes,
    // aksi halde AI konuşmaya devam ederken üstüne binen tuhaf bir gecikme olur.
    if (message.serverContent?.interrupted) {
      this.handlers.clearClientAudioQueue();
    }

    if (message.serverContent?.inputTranscription?.text) {
      console.log(`[voice][transkript] MÜŞTERİ: ${message.serverContent.inputTranscription.text}`);
      this.currentUtteranceBuffer += message.serverContent.inputTranscription.text;
      // Müşteriden gerçek bir şey geldi - bekleyen "sessizlik" zaman aşımını iptal et.
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
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
      this.armSilenceTimer();
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

    // Bu turun birikmiş metnini son-2 penceresine ekleyip sıfırlıyoruz, araç
    // çağrılarını değerlendirmeden ÖNCE (aşağıdaki döngü sırasında yeni ses gelip
    // currentUtteranceBuffer değişebilir).
    if (this.currentUtteranceBuffer) {
      this.recentUtterances.push(this.currentUtteranceBuffer);
      if (this.recentUtterances.length > 2) this.recentUtterances.shift();
      this.fullTranscript.push(this.currentUtteranceBuffer);
      this.currentUtteranceBuffer = "";
    }

    const responses = await Promise.all(
      functionCalls.map(async (call) => {
        if (call.name === "end_call") {
          shouldEndCall = true;
          return { id: call.id, name: call.name, response: { result: "Görüşme sonlandırılıyor." } };
        }
        if (call.name === "save_customer_name") {
          const fullName = String(call.args?.full_name ?? "").trim();
          if (fullName && shouldBlockUnverifiedName(fullName, this.fullTranscript.join(" "))) {
            console.warn(
              `[voice] GÜVENLİK: save_customer_name engellendi - "${fullName}" müşterinin söylediği hiçbir şeyde geçmiyor`
            );
            return {
              id: call.id,
              name: call.name,
              response: { result: JSON.stringify({ error: NO_NAME_MENTIONED_ERROR }) },
            };
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
          return { id: call.id, name: call.name, response: { result: "Kaydedildi." } };
        }
        if (
          call.name === "check_availability" &&
          shouldBlockAvailabilityCheck((call.args?.service_names as string[] | undefined) ?? [], this.fullTranscript.join(" "))
        ) {
          console.warn(
            `[voice] GÜVENLİK: check_availability engellendi - istenen hizmet(ler) (${JSON.stringify(call.args?.service_names)}) müşterinin söylediği hiçbir şeyde geçmiyor`
          );
          return {
            id: call.id,
            name: call.name,
            response: { result: JSON.stringify({ error: NO_SERVICE_MENTIONED_ERROR }) },
          };
        }
        if (shouldBlockMutation(call.name ?? "", this.recentUtterances)) {
          console.warn(
            `[voice] GÜVENLİK: ${call.name} engellendi - müşterinin son sözleri (${JSON.stringify(this.recentUtterances)}) anlamlı bir onay/seçim gibi görünmüyor`
          );
          return {
            id: call.id,
            name: call.name,
            response: { result: JSON.stringify({ error: AMBIGUOUS_REPLY_ERROR }) },
          };
        }
        if (
          shouldBlockUnverifiedSlot(
            call.name ?? "",
            {
              startsAt: String(call.args?.starts_at ?? ""),
              endsAt: String(call.args?.ends_at ?? ""),
              assignments: (call.args?.assignments as { service_name: string; staff_name: string }[] | undefined ?? []).map(
                (a) => ({ serviceName: a.service_name, staffName: a.staff_name })
              ),
            },
            this.verifiedSlots
          )
        ) {
          console.warn(
            `[voice] GÜVENLİK: ${call.name} engellendi - önerilen saat/personel gerçekten başarılı bir check_availability sonucunda yok (${JSON.stringify(call.args)})`
          );
          return {
            id: call.id,
            name: call.name,
            response: { result: JSON.stringify({ error: UNVERIFIED_SLOT_ERROR }) },
          };
        }
        const { result, escalated, escalationReason } = await executeAiTool(call.name ?? "", call.args ?? {}, {
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
        // BUG (2026-09-12'ye kadar): escalate aracı çağrıldığında AI müşteriye "işletme
        // sahibine iletildi" diyordu ama WhatsApp tarafının aksine (webhook route.ts)
        // sesli tarafta bunu gerçekten iletecek bir kod hiç yoktu - sahip hiçbir zaman
        // haberdar olmuyordu. Diğer escalate tetikleyicileriyle (DTMF "0") aynı
        // bildirim yolunu paylaşsın diye notifyOwnerEscalation'a çıkarıldı.
        if (escalated) this.notifyOwnerEscalation(escalationReason ?? "belirtilmedi");
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
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.deadAirTimer) {
      clearTimeout(this.deadAirTimer);
      this.deadAirTimer = null;
    }
    await this.ready.catch(() => undefined);
    this.session?.close();
  }

  /**
   * AI sözünü bitirip müşteriyi dinlemeye geçtiğinde çağrılır. Belirli bir süre içinde
   * müşteriden ses gelmezse (inputTranscription yoksa), modele "[SESSİZLİK]" sentetik
   * bir tur gönderip nazikçe tekrar sormasını sağlar — bkz. voicePrompt.ts'teki bu
   * kalıbın nasıl yorumlanacağına dair talimat.
   */
  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.stoppedByUs) return;
      this.session?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "[SESSİZLİK]" }] }],
        turnComplete: true,
      });
    }, VoiceCallSession.SILENCE_NUDGE_MS);
  }

  /** escalate aracı VEYA DTMF "0" tetiklendiğinde işletme sahibine bildirim gönderir. */
  private notifyOwnerEscalation(reason: string): void {
    void sendPushToBusiness(this.businessId, {
      title: "Sesli arama sizi bekliyor",
      body: `${this.customerName || "Bir müşteri"} ile görüşmede AI yardımcı olamadı (${reason}) — müşteriyi geri aramak isteyebilirsiniz.`,
      url: "/takvim",
    }).catch((err) => console.error("[voice] push bildirimi gönderilemedi (escalate):", err));
  }

  /**
   * Kullanıcının isteği üzerine (2026-09-12): müşteri her an "0" tuşuna basarak
   * doğrudan bir yetkiliye yönlendirilmeyi isteyebilir — bu, AI'nin konuşmayı doğru
   * anlayıp escalate aracını çağırmasına bağlı DEĞİL, sunucu tarafında DTMF sinyaliyle
   * doğrudan tetiklenen, modelden bağımsız güvenilir bir çıkış kapısı (bkz. server.ts).
   * AI'ye SADECE kısa bir kapanış cümlesi söyletmek için sentetik bir tur gönderiyoruz
   * (aynı [SESSİZLİK] deseni) — asıl bildirim burada, modelin bunu doğru yorumlamasına
   * bağlı olmadan zaten gönderiliyor.
   */
  escalateToHuman(reason: string): void {
    this.notifyOwnerEscalation(reason);
    this.session?.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "[TEMSİLCİYE_YÖNLENDİR]" }] }],
      turnComplete: true,
    });
  }

  /**
   * Gemini Live bağlantısı BİZİM istememizle değil (ağ sorunu, Google tarafı hata vb.)
   * kendiliğinden kopması durumunda çağrılır. Öncesinde bu sadece log'a yazılıyordu -
   * müşteri hatta sessizce (dead air) kalıyordu ve kimseye haber gitmiyordu
   * (2026-09-11 denetiminde bulundu). Artık hat gerçekten kapatılıyor VE sahibe
   * push bildirimiyle haber veriliyor.
   */
  private handleUnexpectedSessionEnd(reason: string): void {
    this.stoppedByUs = true;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.deadAirTimer) {
      clearTimeout(this.deadAirTimer);
      this.deadAirTimer = null;
    }
    this.handlers.endCall();
    void sendPushToBusiness(this.businessId, {
      title: "Sesli arama teknik sorun yaşadı",
      body: `${this.customerName || "Bir müşteri"} ile görüşme beklenmedik şekilde kesildi (${reason}) — müşteriyi geri aramak isteyebilirsiniz.`,
    }).catch((err) => console.error("[voice] push bildirimi gönderilemedi (oturum koptu):", err));
  }
}
