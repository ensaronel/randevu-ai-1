import { GoogleGenAI } from "@google/genai";

// Diğer AI dosyalarıyla aynı sağlayıcı kararı — bkz. respond.ts üstündeki not.
const MODEL = "gemini-3.6-flash";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface FinanceComparisonInput {
  yesterdayRevenue: number;
  lastWeekSameDayRevenue: number | null;
  monthlyAverageRevenue: number | null;
}

/**
 * Sadece verilen rakamları yorumlar — sebep tahmini yapmaz, ek veri uydurmaz.
 * Girdi zaten gün-sonu mutabakatından gelen gerçekleşen ciro olduğu için
 * (bkz. nightlySummary.ts) modelin uydurabileceği bir "gerçek" yok, tek riski
 * gereksiz sebep spekülasyonu yapması — bu yüzden prompt bunu açıkça yasaklıyor.
 */
export async function generateFinanceCommentary(input: FinanceComparisonInput): Promise<string> {
  const lines = [`Dünkü gerçekleşen ciro: ${Math.round(input.yesterdayRevenue)} TL.`];
  if (input.lastWeekSameDayRevenue !== null) {
    lines.push(`Geçen haftanın aynı günü: ${Math.round(input.lastWeekSameDayRevenue)} TL.`);
  }
  if (input.monthlyAverageRevenue !== null) {
    lines.push(`Bu ayki günlük ortalama ciro: ${Math.round(input.monthlyAverageRevenue)} TL.`);
  }

  const prompt = `${lines.join(" ")}

Bu rakamlara dayanarak işletme sahibine tek cümlelik, sıcak ama net bir Türkçe yorum yaz.
SADECE verilen rakamları karşılaştır. Sebebini tahmin etme (ör. "hava kötü olduğu için" deme,
sebebi bilmiyorsun). Rakam uydurma, sadece verilenleri kullan. Tek cümle yaz, uzun rapor yazma.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  return (response.text ?? "").trim();
}
