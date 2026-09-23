import { generateContentResilient } from "@/lib/ai/gemini";

export interface BriefNarrativeInput {
  businessName: string;
  weekdayLabel: string;
  /** Kodla hesaplanmış, satır satır GERÇEK rakamlar — modelin tek bilgi kaynağı. */
  factsText: string;
  /** Verilerden çıkan en değerli fırsatın özeti (varsa). */
  topOpportunity: string | null;
}

export interface BriefNarrative {
  headline: string;
  recommendation: string;
}

/**
 * Günlük Finans Özeti'nde rakamların KENDİSİNİ model üretmez (bkz. nightlySummary.ts —
 * hepsi kodla hesaplanır); model sadece iki kısa metin yazar: dünün tek cümlelik
 * yorumu ve veriye dayalı tek bir somut öneri. Hata/bozuk çıktıda null döner, çağıran
 * taraf kodla üretilmiş yedek metne düşer — özet hiçbir zaman AI yüzünden çökmez.
 */
export async function generateBriefNarrative(input: BriefNarrativeInput): Promise<BriefNarrative | null> {
  const prompt = `Sen ${input.businessName} işletmesinin finans danışmanısın. Aşağıda dünün (${input.weekdayLabel}) kodla hesaplanmış GERÇEK rakamları var.

RAKAMLAR:
${input.factsText}

VERİDEN ÇIKAN EN DEĞERLİ FIRSAT: ${input.topOpportunity ?? "yok"}

İşletme sahibine gidecek profesyonel bir günlük finans özeti için İKİ kısa Türkçe metin yaz:
1) headline: Dünün genel resmini tek cümlede yorumla (en fazla 120 karakter). Rakamların gösterdiği yönü söyle
   (ör. "Dün geçen haftanın aynı gününe göre güçlü bir gündü."). Sadece verilen rakamlara dayan.
2) recommendation: TEK somut, bugün uygulanabilir öneri (en fazla 170 karakter). Öneri, yukarıdaki rakamlardan
   TAM OLARAK BİRİne doğrudan dayanmalı: bugünün doluluğu düşükse o boşluğu doldurmaya yönelik bir hamle; iptal/gelmeme
   varsa bunu azaltmaya yönelik bir hamle; belirgin bir fırsat verildiyse o fırsat. Birbiriyle ilgisi olmayan olgular
   arasında bağ KURMA (ör. bir personelin yoğunluğunu bir boş saatle ilişkilendirme). Genel geçer tavsiye verme.

KURALLAR: Sebep tahmin etme (hava, tatil, sezon vb. deme). Verilmeyen rakam, yüzde veya indirim oranı UYDURMA. Para
tutarlarını RAKAMLARDA verildiği biçimde (ör. ₺4.250) aynen yaz, "4250 lira" gibi yeniden biçimlendirme. Markdown, emoji
ve tırnak işareti kullanma. Ton: profesyonel ve sıcak.
Yalnızca şu JSON'u döndür: {"headline":"...","recommendation":"..."}`;

  try {
    const response = await generateContentResilient({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });
    const raw = (response.text ?? "").trim();
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText) as Partial<BriefNarrative>;
    const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
    const recommendation = typeof parsed.recommendation === "string" ? parsed.recommendation.trim() : "";
    if (!headline || !recommendation) return null;
    return { headline: headline.slice(0, 200), recommendation: recommendation.slice(0, 260) };
  } catch (err) {
    console.error("[financeBrief] AI metni üretilemedi:", err);
    return null;
  }
}
