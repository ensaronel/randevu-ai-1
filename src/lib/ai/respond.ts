import { GoogleGenAI, type Content, type FunctionCall } from "@google/genai";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadBusinessContext } from "@/lib/ai/context";
import { AI_TOOLS, executeAiTool } from "@/lib/ai/tools";
import { AI_MODEL } from "@/lib/ai/model";
import { dateKeyTR, weekdayKeyTR, formatDateTR, dateKeyFromIso } from "@/lib/date";
import {
  shouldBlockMutation,
  AMBIGUOUS_REPLY_ERROR,
  shouldBlockAvailabilityCheck,
  NO_SERVICE_MENTIONED_ERROR,
  shouldBlockUnverifiedSlot,
  UNVERIFIED_SLOT_ERROR,
  parseVerifiedSlotsFromResult,
  parseAssignmentsArg,
  type VerifiedSlot,
} from "@/lib/ai/safetyGate";
import type { Business, Customer } from "@/types/database";

const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 20;
// pending_busy_offer, müşteri o gün dolu olduğu için alternatif bir güne yönlendirildiğinde
// müşteride "kaydedildi mi" belirsizliği bırakmadan bekleme listesi teklifini GARANTİ etmek
// için kullanılıyor (bkz. customers.pending_busy_offer yorumu) — ama bu teklif çok eski
// (müşteri o ara vazgeçip GÜNLERCE sonra bambaşka bir şey için randevu almışsa) olursa
// alakasız/şaşırtıcı kaçar, bu yüzden sadece bu pencere içinde tetiklenir.
const PENDING_BUSY_OFFER_WINDOW_MS = 6 * 60 * 60 * 1000;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AiReplyResult {
  replyText: string;
  escalated: boolean;
  escalationReason?: string;
  ownerPhone: string | null;
}

const WEEKDAY_LABELS_TR: Record<string, string> = {
  mon: "Pazartesi",
  tue: "Salı",
  wed: "Çarşamba",
  thu: "Perşembe",
  fri: "Cuma",
  sat: "Cumartesi",
  sun: "Pazar",
};

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof loadBusinessContext>>): string {
  const todayKey = dateKeyTR(0);
  const tomorrowKey = dateKeyTR(1);
  const todayWeekday = WEEKDAY_LABELS_TR[weekdayKeyTR(0)];

  const servicesList = ctx.services
    .map((s) => `- ${s.name} (${s.duration_minutes} dk, ${s.price} TL)`)
    .join("\n");
  const staffList = ctx.staff.map((s) => `- ${s.full_name}`).join("\n");

  return `Sen ${ctx.business.name} işletmesi için WhatsApp üzerinden randevu alan bir asistansın.

BUGÜN: ${todayKey} (${todayWeekday}). "Yarın" derse ${tomorrowKey} kastedilir.

HİZMETLER:
${servicesList || "(tanımlı hizmet yok)"}

PERSONEL:
${staffList || "(tanımlı personel yok)"}

BİÇİM KURALLARI (ÇOK ÖNEMLİ):
- Bu düz metin bir WhatsApp mesajı — Markdown BİÇİMLENDİRME KULLANMA: ** kalın, # başlık, "1." "2." gibi
  numaralı liste, "-"/"*" ile madde işareti YAZMA. Bunlar WhatsApp'ta render edilmez, kullanıcıya "**" ve
  "1." gibi çirkin, karışık ham karakterler olarak görünür.
- Birden fazla seçenek/randevu sıralarken her birini AYRI SATIRA yaz (satır arası boş satırla ayır),
  numara/madde işareti yerine sadece emoji (📅 gibi) veya hiçbir işaret kullanmadan doğal cümle kur —
  örn. "29 Ağustos Cumartesi 10:00 - Ayşe Usta" tek başına bir satır olsun, "1. **29 Ağustos...**" DEĞİL.

KURALLAR:
- Kısa, sıcak, samimi bir dille yaz — WhatsApp mesajı gibi, resmi rapor gibi değil.
- Uygun saat önerirken ASLA tahmin etme — mutlaka check_availability aracını kullan.
- RANDEVU AKIŞI — SIRAYLA İZLE:
  1. Müşteri "randevu istiyorum" dediğinde ama hangi saati istediğini belirtmediyse, check_availability'yi
     hemen çağırma — ÖNCE hangi gün VE saat aralığını istediğini sor (ör. "hangi gün ve saatte müsaitsin?").
     Müşteri zaten bir saat belirtmişse (ör. "yarın 14:00 gibi") tekrar sorma, direkt devam et.
  2. Saat netleşince check_availability'yi date + preferred_time ile çağır. Dönen her seçenekteki
     is_exact_requested_time alanına bak — KENDİN yorumlamaya/tahmine çalışma: true ise istenen saat
     TAM MÜSAİT, doğrudan olumlu onayla (ör. "14:00 müsait, uygun mu?"), ASLA "dolu ama" deme. false
     ise istenen saat müsait DEĞİL — unavailable_reason alanına bak, GERÇEK sebebi söyle: "closed_day"
     -> "o gün kapalıyız"; "staff_off" -> "[unavailable_staff_name] o gün çalışmıyor"; "outside_hours"
     -> "o saatte kapalıyız"; "busy" -> "14:00 dolu" (SADECE bu durumda "dolu" de). Sonra AÇIKÇA en
     yakın alternatifi sun, sessizce farklı bir saat önerme.
  3. O gün hiç uygun saat yoksa (slots boş VEYA is_alternate_date:true dönerse), müşteriye hem "başka bir
     saat mi, yoksa aynı saatte başka bir gün mü bakayım?" diye SOR — otomatik olarak sadece bir yöne karar
     verme. is_alternate_date:true ile dönen gün zaten "aynı saatte en yakın gün" içindir, bunu bir
     seçenek olarak sun.
  4. Müşteri bir seçeneği seçtiğinde HEMEN create_appointment çağırma — önce seçilen tarih/saat/hizmet/
     personeli TEKRAR SÖYLEYİP "bu şekilde onaylıyor musun?" diye SON BİR KEZ teyit iste. Müşteri bu son
     teyide de açıkça evet dedikten SONRA create_appointment'ı çağır. Bu çift teyit, yanlış anlaşılan bir
     saatin sehven kaydedilmesini önlemek için ZORUNLU, atlama.
  5. Müşterinin adını bu konuşmada YENİ öğrendiysen (sistemde kayıtlı değildi, az önce sordun), ismi
     aldıktan SONRA create_appointment'ı çağırmadan ÖNCE ismi VE randevu detaylarını (tarih/saat/hizmet/
     personel) BİRLİKTE tek bir cümlede tekrar söyleyip son bir kez teyit al (ör. "Ayşe Kaya adına, yarın
     saat 14:00'te Saç Kesimi için Mehmet Usta'yla randevu oluşturuyorum, doğru mu?") — (4)'teki saat
     teyidi TEK BAŞINA YETERLİ DEĞİL, çünkü isim yanlış anlaşılmış olabilir (ör. müşteri "Sarkan" dedi,
     senin duyduğun "Serkan" olabilir) ve bunu yakalayacak başka bir şans olmaz. Müşteri zaten sistemde
     kayıtlıysa (adını yeniden sormadıysan) bu ek teyide gerek yok, (4) yeterli.
  6. create_appointment ALTERNATİF bir güne (is_alternate_date:true olan bir seçeneğe) yapılıp ilk istenen
     gün için unavailable_reason "busy" ise, ilk istenen gün için de bekleme listesine girmek isteyip
     istemediğini SORMA CÜMLESİ SENDEN BEKLENMİYOR — sistem bunu create_appointment başarılı olduktan
     sonra senin normal cevabına KENDİSİ, OTOMATİK olarak ekler (2026-09-14/15'te bu tekrar tekrar canlı
     testte modelin bunu unuttuğu görüldüğü için koda taşındı). Sen sadece randevunun oluştuğunu normal
     şekilde onayla, bekleme listesi teklifini kendin yazmaya ÇALIŞMA — aksi halde aynı teklif müşteriye
     iki kez (biri senden, biri sistemden) gitmiş olur. Müşteri o teklife "evet" derse (bu senin cevabından
     SONRAKİ bir mesajda gelir), o zaman normal şekilde hangi gün(ler)/saat aralığını istediğini netleştirip
     join_waitlist'i çağır — linked_appointment_id'ye demin oluşan randevunun appointment_id'sini ver.
- check_availability 2-3 seçenek döndürürse, HER seçenekte tarihi, saati VE personel adını açıkça yaz
  (tek personel olsa bile) — örn. "29 Ağustos Cumartesi 10:00 - Ayşe Usta". Sadece saatleri listeleyip
  tarih/personeli bir kez üstte söylemek YETERSİZ, her satır kendi içinde tam ve net olmalı; müşteri
  farklı günlere veya personellere bakıyorsa bu karışıklığı önler.
- create_appointment'ı çağırırken starts_at/ends_at/assignments değerlerini check_availability'nin
  döndürdüğü değerlerle BİREBİR aynı gönder, kendin değiştirme.
- Müşteri randevusunu iptal etmek isterse: önce list_my_appointments ile hangi randevudan (appointment_id)
  bahsettiğini netleştir, sonra müşteri onaylarsa cancel_appointment'ı çağır.
- Müşteri randevusunu ertelemek/değiştirmek isterse: cancel_appointment KULLANMA — önce list_my_appointments
  ile appointment_id'yi bul, check_availability ile yeni saati bul, müşteri onaylayınca reschedule_appointment'ı
  (appointment_id + yeni starts_at/ends_at) çağır. Bu TEK bir işlemdir; eski randevu SADECE yeni saat gerçekten
  ayrılabilirse değişir — asla önce iptal edip sonra yeniden oluşturma, bu müşteriyi randevusuz bırakabilir.
- Hiçbir gün/saatte uygun yer bulunamazsa müşteriye başka bir gün/saat boşaldığında haber verilmesini
  isteyip istemediğini sor; isterse hangi gün(ler) ve saat aralığını istediğini netleştirip join_waitlist'i
  çağır.
- ÇOK ÖNEMLİ — create_appointment/cancel_appointment/reschedule_appointment "error" ALANIYLA
  dönerse (ör. "Son söylediğiniz net anlaşılamadı..."): bu bir TEKNİK HATA DEĞİL, güvenlik amaçlı
  bir engelleme — AYNI aracı hemen tekrar ÇAĞIRMA ve bu yüzden escalate ETME. Bunun yerine
  hatadaki mesajı kendi doğal cümlenle müşteriye ilet ve net bir onay bekle (ör. müşteri "randevumu
  iptal eder misiniz?" dedi ama sistem bunu net bir onay saymadıysa, "Emin misiniz, randevunuzu
  iptal edeyim mi?" diye SOR, müşteri "evet" dedikten SONRA aynı aracı TEKRAR çağır). 2026-09-18'de
  test edildi: model bu durumda aracı sessizce tekrar deneyip sonra "API hatası" diye UYDURMA bir
  sebeple escalate etti — bu YANLIŞ, müşteri gayet net bir istekte bulunmuştu, sadece son bir kez
  açık onay gerekiyordu.
- Ne istediğini anlayamadığın, sistemin karşılayamayacağı (fiyat pazarlığı, şikayet gibi henüz
  desteklenmeyen konular) bir mesaj gelirse tahmin etmek yerine escalate aracını çağır.
- Randevu dışı sohbete (hava durumu vb.) girme, nazikçe konuyu randevuya getir.`;
}

function buildWaitlistOfferSentence(requestedDateKey: string): string {
  const dayLabel =
    requestedDateKey === dateKeyTR(0) ? "bugün" : formatDateTR(`${requestedDateKey}T12:00:00+03:00`);
  return `Bu arada, ${dayLabel} için de sizi bekleme listesine alalım mı? Boşluk çıkarsa hemen haber veririz.`;
}

async function loadHistory(customerId: string): Promise<Content[]> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("whatsapp_message_log")
    .select("direction, body")
    .eq("customer_id", customerId)
    .eq("message_type", "freeform")
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  return (data ?? [])
    .reverse()
    .filter((row) => row.body)
    .map((row) => ({
      role: row.direction === "inbound" ? "user" : "model",
      parts: [{ text: row.body as string }],
    }));
}

export async function generateAiReply(
  business: Business,
  customer: Customer,
  incomingText: string
): Promise<AiReplyResult> {
  const ctx = await loadBusinessContext(business.id);
  const history = await loadHistory(customer.id);

  const contents: Content[] = [...history, { role: "user", parts: [{ text: incomingText }] }];
  const config = {
    systemInstruction: buildSystemPrompt(ctx),
    tools: [{ functionDeclarations: AI_TOOLS }],
  };

  // Sesli tarafta (geminiBridge.ts) zaten var olan güvenlik kapılarının (safetyGate.ts)
  // WhatsApp tarafında HİÇ olmaması 2026-09-13'te fark edildi — aynı model/risk sınıfı
  // burada da geçerli. history sadece müşterinin gönderdiği metinleri (role: "user")
  // içerdiği için recentUtterances/fullTranscript'i ondan türetiyoruz. verifiedSlots ise
  // sadece BU ÇAĞRININ kendi araç-döngüsü içinde (bu mesaja verilen yanıt boyunca) tutulur -
  // WhatsApp her mesajda sıfırdan başladığı için önceki mesajlardaki ham araç sonuçları
  // (whatsapp_message_log'da sadece okunabilir metin tutuluyor) burada mevcut değil; bu
  // yine de AYNI mesaj içinde check+create art arda denendiğinde uydurmayı yakalar.
  const inboundHistoryTexts = history.filter((c) => c.role === "user").map((c) => c.parts?.[0]?.text ?? "");
  const fullTranscript = [...inboundHistoryTexts, incomingText];
  const recentUtterances = fullTranscript.slice(-2);
  const verifiedSlots: VerifiedSlot[] = [];

  // customer zaten select("*") ile yüklendiği için (webhook route) güncel — ayrı bir
  // sorguya gerek yok. Bu değişken, aşağıdaki döngü boyunca hem check_availability'nin
  // "busy" bulgusunu KAYDETMEK hem de create_appointment başarılı olunca bunu OKUYUP
  // TÜKETMEK için kullanılıyor (bkz. dosya başındaki PENDING_BUSY_OFFER_WINDOW_MS yorumu).
  let pendingBusyOffer = customer.pending_busy_offer;
  let waitlistOfferDateKey: string | null = null;
  const admin = createAdminSupabaseClient();

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await ai.models.generateContent({ model: AI_MODEL, contents, config });

    const functionCalls: FunctionCall[] = response.functionCalls ?? [];

    if (functionCalls.length === 0) {
      const text = (response.text ?? "").trim();
      const baseReply = text || "Şu an size yardımcı olamıyorum, en kısa sürede döneceğiz.";
      // Bekleme listesi teklifini modelin kendi metnine bırakmıyoruz (bkz. yukarıdaki
      // pendingBusyOffer yorumu) — waitlistOfferDateKey bu döngüde bir create_appointment
      // tam da bunu gerektirdiğinde set edildiyse, cümle KOD tarafından, garantili ekleniyor.
      const replyText = waitlistOfferDateKey
        ? `${baseReply}\n\n${buildWaitlistOfferSentence(waitlistOfferDateKey)}`
        : baseReply;
      return {
        replyText,
        escalated: false,
        ownerPhone: ctx.ownerPhone,
      };
    }

    const modelTurn = response.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    let escalation: { reason: string } | null = null;
    const functionResponseParts: Content["parts"] = [];

    for (const call of functionCalls) {
      const name = call.name ?? "";
      const args = (call.args as Record<string, unknown>) ?? {};

      console.log(`[whatsapp][araç] çağrı: ${name}(${JSON.stringify(args)})`);

      if (name === "check_availability" && shouldBlockAvailabilityCheck((args.service_names as string[] | undefined) ?? [], fullTranscript.join(" "))) {
        console.warn(`[whatsapp] GÜVENLİK: check_availability engellendi - istenen hizmet(ler) (${JSON.stringify(args.service_names)}) müşterinin söylediği hiçbir şeyde geçmiyor`);
        functionResponseParts!.push({
          functionResponse: { name, response: { result: JSON.stringify({ error: NO_SERVICE_MENTIONED_ERROR }) }, id: call.id },
        });
        continue;
      }

      if (shouldBlockMutation(name, recentUtterances)) {
        console.warn(`[whatsapp] GÜVENLİK: ${name} engellendi - müşterinin son sözleri (${JSON.stringify(recentUtterances)}) anlamlı bir onay/seçim gibi görünmüyor`);
        functionResponseParts!.push({
          functionResponse: { name, response: { result: JSON.stringify({ error: AMBIGUOUS_REPLY_ERROR }) }, id: call.id },
        });
        continue;
      }

      if (
        shouldBlockUnverifiedSlot(
          name,
          {
            startsAt: String(args.starts_at ?? ""),
            endsAt: String(args.ends_at ?? ""),
            assignments: parseAssignmentsArg(args.assignments),
          },
          verifiedSlots
        )
      ) {
        console.warn(`[whatsapp] GÜVENLİK: ${name} engellendi - önerilen saat/personel gerçekten başarılı bir check_availability sonucunda yok (${JSON.stringify(args)})`);
        functionResponseParts!.push({
          functionResponse: { name, response: { result: JSON.stringify({ error: UNVERIFIED_SLOT_ERROR }) }, id: call.id },
        });
        continue;
      }

      const { result, escalated, escalationReason } = await executeAiTool(name, args, {
        ctx,
        customerId: customer.id,
        customerName: customer.full_name,
        customerPhone: customer.phone,
        channel: "whatsapp",
      });
      console.log(`[whatsapp][araç] sonuç (${name}): ${result}`);
      if (name === "check_availability" && !result.includes('"error"')) {
        verifiedSlots.push(...parseVerifiedSlotsFromResult(result));

        const parsedAvailability = JSON.parse(result) as { unavailable_reason?: string; is_alternate_date?: boolean };
        const requestedDateKey = String(args.date ?? "");
        if (
          parsedAvailability.unavailable_reason === "busy" &&
          parsedAvailability.is_alternate_date === true &&
          /^\d{4}-\d{2}-\d{2}$/.test(requestedDateKey)
        ) {
          pendingBusyOffer = {
            requested_date: requestedDateKey,
            service_names: (args.service_names as string[] | undefined) ?? [],
            set_at: new Date().toISOString(),
          };
          void admin
            .from("customers")
            .update({ pending_busy_offer: pendingBusyOffer })
            .eq("id", customer.id)
            .then(({ error }) => {
              if (error) console.error("pending_busy_offer kaydedilemedi", error);
            });
        }
      }

      if (name === "create_appointment" && !result.includes('"error"') && pendingBusyOffer) {
        const bookedDateKey = dateKeyFromIso(String(args.starts_at ?? ""));
        const isFresh = Date.now() - Date.parse(pendingBusyOffer.set_at) < PENDING_BUSY_OFFER_WINDOW_MS;
        if (isFresh && bookedDateKey !== pendingBusyOffer.requested_date) {
          waitlistOfferDateKey = pendingBusyOffer.requested_date;
        }
        pendingBusyOffer = null;
        void admin
          .from("customers")
          .update({ pending_busy_offer: null })
          .eq("id", customer.id)
          .then(({ error }) => {
            if (error) console.error("pending_busy_offer temizlenemedi", error);
          });
      }
      functionResponseParts!.push({
        functionResponse: { name, response: { result }, id: call.id },
      });
      if (escalated) {
        console.warn(`[whatsapp] escalate tetiklendi: ${escalationReason ?? "belirtilmedi"}`);
        escalation = { reason: escalationReason ?? "belirtilmedi" };
      }
    }

    if (escalation) {
      return {
        replyText:
          "Şu an bu konuda size hemen yardımcı olamadım, ekibimiz en kısa sürede size dönüş yapacak. 🙏",
        escalated: true,
        escalationReason: escalation.reason,
        ownerPhone: ctx.ownerPhone,
      };
    }

    contents.push({ role: "user", parts: functionResponseParts });
  }

  return {
    replyText: "Şu an bu konuda size hemen yardımcı olamadım, ekibimiz en kısa sürede size dönüş yapacak. 🙏",
    escalated: true,
    escalationReason: "maksimum araç çağrısı sayısına ulaşıldı",
    ownerPhone: ctx.ownerPhone,
  };
}
