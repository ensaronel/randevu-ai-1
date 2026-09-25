import { generateContentResilient } from "@/lib/ai/gemini";

export interface TipCaptionInput {
  businessName: string;
  tipTitle: string;
  tipBody: string;
}

const FALLBACK = (input: TipCaptionInput) => `${input.tipBody} ✨`;

const CREATIVE_ANGLES = [
  "kısa bir 'biliyor muydunuz' girişiyle",
  "gerçek bir uzman tavsiyesi verir gibi sıcak ama bilgili bir tonla",
  "günlük hayattan küçük bir gözlemle bağlayarak",
  "doğrudan ve pratik bir tavsiye cümlesiyle",
];

/**
 * BEAUTY_TIPS havuzundaki sabit ipucu FAKTINI değiştirmeden, her seferinde farklı ve
 * eğlenceli bir çerçeveleme yazar — bilgiyi uydurmaz/genişletmez, sadece sunuş tarzını
 * değiştirir (bkz. dailyContent.ts).
 */
export async function generateTipFraming(input: TipCaptionInput): Promise<string> {
  const angle = CREATIVE_ANGLES[Math.floor(Math.random() * CREATIVE_ANGLES.length)];

  const prompt = `Şu bakım ipucunu Instagram Story'de paylaşılacak şekilde yeniden anlat:
Başlık: "${input.tipTitle}"
İçerik: "${input.tipBody}"

${angle} yaz. Bilgiyi DEĞİŞTİRME, yeni bir iddia/rakam EKLEME — sadece sunuş tarzını değiştir.
En fazla 2 kısa cümle (~18-20 kelime toplam), klişe reklam dilinden kaçın.
SADECE bu metni yaz, başka hiçbir şey ekleme (tırnak işareti de ekleme).`;

  const response = await generateContentResilient({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { temperature: 1.0 },
  }).catch((err) => {
    console.error("[tipCaption] AI metni üretilemedi, yedek metin kullanılıyor:", err);
    return null;
  });

  const text = (response?.text ?? "").trim().replace(/^["']|["']$/g, "");
  return text || FALLBACK(input);
}
