import { GoogleGenAI, type Content, type FunctionCall } from "@google/genai";
import { ASSISTANT_TOOLS, executeAssistantTool } from "@/lib/ai/assistantTools";
import { dateKeyTR, weekdayKeyTR } from "@/lib/date";
import type { Business } from "@/types/database";

// Diğer AI dosyalarıyla aynı sağlayıcı — bkz. respond.ts üstündeki not.
const MODEL = "gemini-3.5-flash-lite";
const MAX_TOOL_ITERATIONS = 6;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const WEEKDAY_LABELS_TR: Record<string, string> = {
  mon: "Pazartesi", tue: "Salı", wed: "Çarşamba", thu: "Perşembe", fri: "Cuma", sat: "Cumartesi", sun: "Pazar",
};

function buildSystemPrompt(business: Business): string {
  const todayKey = dateKeyTR(0);
  const todayWeekday = WEEKDAY_LABELS_TR[weekdayKeyTR(0)];

  return `Sen ${business.name} işletmesinin sahibi için çalışan bir veri analisti asistanısın.

BUGÜN: ${todayKey} (${todayWeekday}).

KURALLAR:
- SADECE araçların (get_revenue_summary, get_staff_performance, get_customer_info, list_appointments)
  döndürdüğü GERÇEK verilerle cevap ver. Rakam, tarih veya isim UYDURMA — hiçbir zaman tahmin etme.
- Bir soruyu yanıtlamak için önce mutlaka ilgili aracı çağır. Araç "no_data" veya "error" dönerse,
  ya da elindeki veri soruyu güvenilir şekilde yanıtlamaya yetmiyorsa, açıkça "Bu soruyu yanıtlayacak
  yeterli veri yok" de — bu özellikle finansal sorularda çok önemli, yanlış güvenle yanlış cevap verme.
- Göreli tarihleri ("bu ay", "geçen hafta", "yarın") bugünün tarihine göre kendin YYYY-MM-DD aralığına
  çevirip aracı öyle çağır.
- Kısa, net, sayılara dayalı cevaplar ver — rapor gibi değil, bir asistanla konuşur gibi.
- Randevu oluşturma/iptal etme gibi işlemler yapamazsın, sadece SORULARI yanıtlarsın. Böyle bir istek
  gelirse bunun için ilgili ekranı (Takvim, Gün Sonu) kullanması gerektiğini nazikçe belirt.`;
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
    const response = await ai.models.generateContent({ model: MODEL, contents, config });
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
