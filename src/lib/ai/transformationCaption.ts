import { GoogleGenAI } from "@google/genai";
import { AI_MODEL } from "@/lib/ai/model";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface TransformationCaptionInput {
  businessName: string;
  note?: string; // owner'ın isteğe bağlı olarak girdiği kısa not (ör. hizmet adı, "saç boyama")
}

export interface TransformationCaptionOutput {
  headline: string; // görselde büyük yazan kısa vurucu cümle (maks ~6 kelime)
  caption: string; // paylaşım metni (2-3 cümle)
}

const FALLBACK: TransformationCaptionOutput = {
  headline: "Bu da yeni hâli! ✨",
  caption: "Bu dönüşüm burada başladı — sıra sende, hemen randevunu ayırt!",
};

/**
 * Owner öncesi/sonrası fotoğraf yüklediğinde (bkz. /api/reklam/donusum) çağrılır —
 * gerçek müşteri/işlem verisine dayanmadığı, sadece owner'ın kendi girdiği nota
 * göre genel bir kutlama metni ürettiği için uydurma veri riski yok.
 */
export async function generateTransformationCaption(
  input: TransformationCaptionInput
): Promise<TransformationCaptionOutput> {
  const noteContext = input.note ? ` Owner'ın eklediği not: "${input.note}".` : "";
  const prompt = `İşletme adı: ${input.businessName}. Bir öncesi/sonrası dönüşüm fotoğrafı için
sosyal medya paylaşım içeriği hazırlıyorsun.${noteContext}

İki şey üret:
1. HEADLINE: Görselin üzerine büyük puntoyla yazılacak, en fazla 5-6 kelimelik, enerjik/kutlama
   hissi veren bir cümle (ör. "Bambaşka bir kişi! 🔥" gibi). Rakam veya somut bir sonuç UYDURMA.
2. CAPTION: Instagram/WhatsApp'ta paylaşılacak, 2-3 cümlelik sıcak ve enerjik bir paylaşım metni,
   sonunda okuyanı randevu almaya nazikçe teşvik eden bir cümle olsun.

Şu TAM formatta, başka hiçbir şey eklemeden cevap ver:
HEADLINE: <başlık>
CAPTION: <paylaşım metni>`;

  const response = await ai.models.generateContent({
    model: AI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const text = (response.text ?? "").trim();
  const headlineMatch = text.match(/HEADLINE:\s*([\s\S]*?)(?:\nCAPTION:|$)/);
  const captionMatch = text.match(/CAPTION:\s*([\s\S]*)$/);

  const headline = headlineMatch?.[1]?.trim();
  const caption = captionMatch?.[1]?.trim();

  if (!headline || !caption) return FALLBACK;
  return { headline, caption };
}
