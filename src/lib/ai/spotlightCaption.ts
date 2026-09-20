import { GoogleGenAI } from "@google/genai";
import { AI_MODEL } from "@/lib/ai/model";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface SpotlightCaptionInput {
  businessName: string;
  kind: "service" | "staff";
  subjectName: string; // hizmet adı ya da personel adı — GERÇEK veri
  meta?: string; // hizmet için "60 dk · 800 TL" gibi ek bilgi (opsiyonel)
}

const FALLBACK: Record<SpotlightCaptionInput["kind"], (name: string) => string> = {
  service: (name) => `${name} için hemen randevunuzu ayırtın!`,
  staff: (name) => `${name} ile randevu almak için hemen yazın!`,
};

const CREATIVE_ANGLES = [
  "merak uyandıran bir soru sorarak",
  "somut bir fayda/hissi vurgulayarak (uydurma rakam değil, gerçek bir duygu)",
  "kısa ve sıcak bir davet cümlesiyle",
  "günlük konuşma diline yakın, samimi bir tonla",
];

/**
 * Günlük vitrin içeriği (hizmet ya da personel tanıtımı) için — sabit
 * "Bugünün öne çıkan hizmeti: X" kalıbı yerine, transformationCaption.ts ile aynı
 * ilkeyle (klişesiz, kısa, reklam kreatifi kalitesinde) metin üretir.
 */
export async function generateSpotlightCaption(input: SpotlightCaptionInput): Promise<string> {
  const angle = CREATIVE_ANGLES[Math.floor(Math.random() * CREATIVE_ANGLES.length)];

  const subjectInstruction =
    input.kind === "service"
      ? `"${input.subjectName}" hizmetini tanıtan bir Instagram Story metni yaz${input.meta ? ` (süre/fiyat: ${input.meta})` : ""}.
"Bugünün öne çıkan hizmeti" gibi kalıplaşmış ifadeler KULLANMA.`
      : `Ekip üyesi "${input.subjectName}"i tanıtan bir Instagram Story metni yaz — o kişiyi gerçekten öne
çıkaran, "bugün ekibimizden X'i tanıtıyoruz" gibi kalıplardan KAÇINAN bir cümle.`;

  const prompt = `İşletme adı: ${input.businessName}. ${subjectInstruction}

Bu metni ${angle} yaz — doğal aksın, zorlama olmasın. Uydurma rakam/sonuç EKLEME.

TEK cümle, en fazla 14 kelime, sonunda nazikçe randevuya davet eden bir ton olsun.
SADECE bu cümleyi yaz, başka hiçbir şey ekleme (tırnak işareti de ekleme).`;

  const response = await ai.models.generateContent({
    model: AI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { temperature: 1.1 },
  });

  const text = (response.text ?? "").trim().replace(/^["']|["']$/g, "");
  return text || FALLBACK[input.kind](input.subjectName);
}
