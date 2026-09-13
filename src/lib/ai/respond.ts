import { GoogleGenAI, type Content, type FunctionCall } from "@google/genai";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadBusinessContext } from "@/lib/ai/context";
import { AI_TOOLS, executeAiTool } from "@/lib/ai/tools";
import { AI_MODEL } from "@/lib/ai/model";
import { dateKeyTR, weekdayKeyTR } from "@/lib/date";
import type { Business, Customer } from "@/types/database";

const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 20;

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
  5. create_appointment ALTERNATİF bir güne (is_alternate_date:true olan bir seçeneğe) yapıldıysa,
     randevu oluştuktan SONRA müşteriye ilk istediği günü DOĞAL şekilde söyleyerek sor — o gün bugünse
     "bugün" de, değilse o günün adını (ör. "Pazartesi") söyle, ASLA "orijinal gün" gibi teknik bir ifade
     kullanma. Örnek: "İsterseniz bugün için de sizi bekleme listesine alayım, boşluk çıkarsa hemen haber
     veririz." Müşteri isterse join_waitlist'i çağır — linked_appointment_id'ye create_appointment'ın
     döndürdüğü appointment_id'yi ver (böylece boşluk çıkıp müşteri kabul ederse bu randevu otomatik iptal
     edilir, müşteride iki randevu kalmaz). Müşteri istemezse bu adımı atla, ısrar etme.
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
- Ne istediğini anlayamadığın, sistemin karşılayamayacağı (fiyat pazarlığı, şikayet gibi henüz
  desteklenmeyen konular) bir mesaj gelirse tahmin etmek yerine escalate aracını çağır.
- Randevu dışı sohbete (hava durumu vb.) girme, nazikçe konuyu randevuya getir.`;
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

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await ai.models.generateContent({ model: AI_MODEL, contents, config });

    const functionCalls: FunctionCall[] = response.functionCalls ?? [];

    if (functionCalls.length === 0) {
      const text = (response.text ?? "").trim();
      return {
        replyText: text || "Şu an size yardımcı olamıyorum, en kısa sürede döneceğiz.",
        escalated: false,
        ownerPhone: ctx.ownerPhone,
      };
    }

    const modelTurn = response.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    let escalation: { reason: string } | null = null;
    const functionResponseParts: Content["parts"] = [];

    for (const call of functionCalls) {
      const { result, escalated, escalationReason } = await executeAiTool(
        call.name ?? "",
        (call.args as Record<string, unknown>) ?? {},
        { ctx, customerId: customer.id, customerName: customer.full_name, customerPhone: customer.phone, channel: "whatsapp" }
      );
      functionResponseParts!.push({
        functionResponse: { name: call.name, response: { result }, id: call.id },
      });
      if (escalated) escalation = { reason: escalationReason ?? "belirtilmedi" };
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
