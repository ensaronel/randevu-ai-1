import { GoogleGenAI, type Content, type FunctionCall } from "@google/genai";
import { ASSISTANT_TOOLS, executeAssistantTool } from "@/lib/ai/assistantTools";
import { AI_MODEL } from "@/lib/ai/model";
import { dateKeyTR, weekdayKeyTR } from "@/lib/date";
import type { Business } from "@/types/database";

const MAX_TOOL_ITERATIONS = 6;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const WEEKDAY_LABELS_TR: Record<string, string> = {
  mon: "Pazartesi", tue: "Salı", wed: "Çarşamba", thu: "Perşembe", fri: "Cuma", sat: "Cumartesi", sun: "Pazar",
};

function buildSystemPrompt(business: Business): string {
  const todayKey = dateKeyTR(0);
  const todayWeekday = WEEKDAY_LABELS_TR[weekdayKeyTR(0)];

  return `Sen ${business.name} işletmesinin sahibi için çalışan bir veri analisti VE randevu işlemleri
yapabilen bir asistansın.

BUGÜN: ${todayKey} (${todayWeekday}).

RAPORLAMA KURALLARI:
- SADECE araçların döndürdüğü GERÇEK verilerle cevap ver. Rakam, tarih veya isim UYDURMA — hiçbir
  zaman tahmin etme.
- Bir soruyu yanıtlamak için önce mutlaka ilgili aracı çağır. Araç "no_data" veya "error" dönerse,
  ya da elindeki veri soruyu güvenilir şekilde yanıtlamaya yetmiyorsa, açıkça "Bu soruyu yanıtlayacak
  yeterli veri yok" de — bu özellikle finansal sorularda çok önemli, yanlış güvenle yanlış cevap verme.
- Göreli tarihleri ("bu ay", "geçen hafta", "yarın") bugünün tarihine göre kendin YYYY-MM-DD aralığına
  çevirip aracı öyle çağır.
- Kısa, net, sayılara dayalı cevaplar ver — rapor gibi değil, bir asistanla konuşur gibi.

RANDEVU İŞLEMLERİ (iptal / oluşturma / erteleme) KURALLARI:
- Owner "Ayşe'nin randevusunu iptal et" gibi bir istek yaparsa: önce find_customer_appointments ile
  doğru müşteriyi ve randevuyu (appointment_id) bul. Birden fazla randevu varsa hangisi olduğunu sor.
- Yeni randevu oluşturma isteğinde: önce check_availability_for_owner ile uygun saatleri bul, sonra
  seçilen saati owner'a net bir cümleyle söyle.
- Erteleme isteğinde: önce find_customer_appointments ile eski randevuyu, sonra
  check_availability_for_owner ile yeni saati bul.
- EN ÖNEMLİ KURAL: cancel_appointment_action, create_appointment_action veya
  reschedule_appointment_action'ı ÇAĞIRMADAN ÖNCE, ne yapacağını AÇIK bir cümleyle owner'a söyleyip
  onay (ör. "evet", "yap", "tamam") almadan ASLA çağırma — yanlış anlaşılan bir isimden dolayı yanlış
  randevunun iptal/değişmesi çok kötü bir hata olur. Owner önceki turda zaten net onay verdiyse
  (ör. "evet iptal et" dediyse) tekrar sorma, direkt uygula.
- find_customer_appointments/check_availability_for_owner gibi SADECE ARAMA/SORGULAMA yapan araçları
  onay beklemeden özgürce çağırabilirsin — onay sadece GERÇEK bir değişiklik yapan üç araç için gerekli.`;
}

export interface AssistantReply {
  replyText: string;
}

export async function askAssistant(business: Business, question: string, history: Content[]): Promise<AssistantReply> {
  const contents: Content[] = [...history, { role: "user", parts: [{ text: question }] }];
  const config = {
    systemInstruction: buildSystemPrompt(business),
    tools: [{ functionDeclarations: ASSISTANT_TOOLS }],
  };

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await ai.models.generateContent({ model: AI_MODEL, contents, config });
    const functionCalls: FunctionCall[] = response.functionCalls ?? [];

    if (functionCalls.length === 0) {
      const text = (response.text ?? "").trim();
      return { replyText: text || "Bu soruyu yanıtlayacak yeterli veri yok." };
    }

    const modelTurn = response.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    const functionResponseParts: Content["parts"] = [];
    for (const call of functionCalls) {
      const result = await executeAssistantTool(call.name ?? "", (call.args as Record<string, unknown>) ?? {}, {
        businessId: business.id,
      });
      functionResponseParts!.push({ functionResponse: { name: call.name, response: { result }, id: call.id } });
    }
    contents.push({ role: "user", parts: functionResponseParts });
  }

  return { replyText: "Bu soruyu yanıtlamak için gereken veriyi tam olarak toparlayamadım, lütfen soruyu daha net sorar mısın?" };
}
