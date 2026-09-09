import { GoogleGenAI } from "@google/genai";
import { AI_MODEL } from "@/lib/ai/model";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface CampaignSuggestionInput {
  businessName: string;
  comparisonDescription: string; // ör. "geçen haftanın aynı gününe göre %35 daha yüksek"
}

export interface CampaignSuggestionOutput {
  message: string;
  targetSegment: string;
}

const FALLBACK: CampaignSuggestionOutput = {
  message: "Son dönemde işleriniz iyi gidiyor — bu ivmeyi değerlendirmek için müşterilerinize kısa bir duyuru göndermeyi düşünebilirsiniz.",
  targetSegment: "Tüm müşteri listeniz",
};

/**
 * Gece cron'unda ciro beklenenden ANLAMLI ÖLÇÜDE yüksek çıktığında çağrılır
 * (bkz. nightlySummary.ts). Sadece TASLAK üretir — hiçbir yere otomatik
 * gönderilmez, işletme sahibi Öneriler'de görüp kendi WhatsApp Business
 * hesabından elle kopyalayıp gönderir (Meta şablon/24-saat penceresi sorununu
 * çoğaltmamak için bilinçli tercih, bkz proje notları).
 */
export async function generateCampaignSuggestion(input: CampaignSuggestionInput): Promise<CampaignSuggestionOutput> {
  const prompt = `İşletme adı: ${input.businessName}. Son ciro durumu: ${input.comparisonDescription}.

İşletme sahibinin WhatsApp Business hesabından müşterilerine TOPLU olarak göndermeyi
düşünebileceği, kısa (2-3 cümle), sıcak ve samimi bir duyuru/teşvik mesajı taslağı yaz.
İndirim yüzdesi veya rakam UYDURMA — sahibi kendi kararını kendi ekleyecek, sen sadece
genel bir "sizi görmekten mutluluk duyarız" / "bizi tercih edenlere teşekkür" tonunda kal.
Ayrıca bu mesajın kimlere gönderilmesinin en mantıklı olacağına dair TEK KISA CÜMLE bir
hedef kitle önerisi yaz (ör. "uzun süredir gelmeyen müşteriler" ya da "tüm müşteri listeniz").

Şu TAM formatta, başka hiçbir şey eklemeden cevap ver:
MESAJ: <mesaj taslağı>
HEDEF: <hedef kitle önerisi>`;

  const response = await ai.models.generateContent({
    model: AI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const text = (response.text ?? "").trim();
  const messageMatch = text.match(/MESAJ:\s*([\s\S]*?)(?:\nHEDEF:|$)/);
  const targetMatch = text.match(/HEDEF:\s*([\s\S]*)$/);

  const message = messageMatch?.[1]?.trim();
  const targetSegment = targetMatch?.[1]?.trim();

  if (!message || !targetSegment) return FALLBACK;
  return { message, targetSegment };
}
