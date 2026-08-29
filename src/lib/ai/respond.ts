import { GoogleGenAI, type Content, type FunctionCall } from "@google/genai";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadBusinessContext } from "@/lib/ai/context";
import { AI_TOOLS, executeAiTool } from "@/lib/ai/tools";
import { dateKeyTR, weekdayKeyTR } from "@/lib/date";
import type { Business, Customer } from "@/types/database";

// Bütçe kısıtı nedeniyle şimdilik Gemini'nin ücretsiz katmanı kullanılıyor
// (kart gerektirmiyor) — pilot/canlıya geçerken plandaki Claude Haiku'ya
// dönülebilir, mimari (tools.ts/availability.ts) sağlayıcıdan bağımsız.
const MODEL = "gemini-3.6-flash";
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

KURALLAR:
- Kısa, sıcak, samimi bir dille yaz — WhatsApp mesajı gibi, resmi rapor gibi değil.
- Uygun saat önerirken ASLA tahmin etme — mutlaka check_availability aracını kullan.
- check_availability 2-3 seçenek döndürürse, HER seçenekte tarihi, saati VE personel adını açıkça yaz
  (tek personel olsa bile) — örn. "29 Ağustos Cumartesi 10:00 - Ayşe Usta". Sadece saatleri listeleyip
  tarih/personeli bir kez üstte söylemek YETERSİZ, her satır kendi içinde tam ve net olmalı; müşteri
  farklı günlere veya personellere bakıyorsa bu karışıklığı önler.
- Müşteri bir seçeneği açıkça onaylamadan create_appointment'ı ASLA çağırma.
- create_appointment'ı çağırırken starts_at/ends_at/assignments değerlerini check_availability'nin
  döndürdüğü değerlerle BİREBİR aynı gönder, kendin değiştirme.
- Müşteri randevusunu iptal etmek isterse: önce list_my_appointments ile hangi randevudan bahsettiğini
  netleştir, sonra müşteri onaylarsa cancel_appointment'ı çağır.
- Müşteri randevusunu ertelemek/değiştirmek isterse: önce cancel_appointment ile eskisini iptal et,
  sonra check_availability + create_appointment ile yeni saati normal akışla oluştur.
- check_availability istenen günde boş saat bulamazsa, aracın kendisi otomatik olarak sonraki günlere
  bakıp en yakın uygun günü döndürür (yanıtta is_alternate_date:true ve gerçek date alanı gelir) — bunu
  müşteriye AÇIKÇA bir alternatif olarak sun, örn. "Cumartesi için boş yerimiz kalmadı, ama Pazar 12:00'de
  müsaitiz, olur mu?" Sadece slots boş dönerse (yakın günlerde de hiç yer yoksa) müşteriye başka bir
  gün/saat boşaldığında haber verilmesini isteyip istemediğini sor; isterse hangi gün(ler) ve saat
  aralığını istediğini netleştirip join_waitlist'i çağır.
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
    const response = await ai.models.generateContent({ model: MODEL, contents, config });

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
        { ctx, customerId: customer.id }
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
