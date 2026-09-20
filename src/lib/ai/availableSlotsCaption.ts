import { GoogleGenAI } from "@google/genai";
import { AI_MODEL } from "@/lib/ai/model";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AvailableSlotsCaptionInput {
  businessName: string;
  serviceName: string;
  dayLabel: "bugün" | "yarın";
  times: string[]; // ör. ["14:00", "16:00"] — GERÇEK, koddan gelen saatler
}

const FALLBACK = (input: AvailableSlotsCaptionInput) => `${input.times[0]} hâlâ boş, hemen yaz!`;

// transformationCaption.ts'teki desenle aynı: her çağrıda rastgele bir açı seçilip
// modele hep aynı kalıbı tekrarlatmıyoruz.
const CREATIVE_ANGLES = [
  "aciliyet hissi yaratarak (yer azaldığını ima et, abartma)",
  "rahat/plansız bir davet tonuyla",
  "doğrudan ve pratik bir çağrıyla",
  "günün ritmine gönderme yaparak",
];

/**
 * Nightly cron'da (bkz. availableSlotsContent.ts) gerçek boş saatler bulunduğunda
 * çağrılır — sadece VERİLEN saatleri kullanır, rakam/oran uydurmaz.
 */
export async function generateAvailableSlotsCaption(input: AvailableSlotsCaptionInput): Promise<string> {
  const angle = CREATIVE_ANGLES[Math.floor(Math.random() * CREATIVE_ANGLES.length)];
  const timesText = input.times.join(", ");

  const prompt = `İşletme adı: ${input.businessName}. ${input.dayLabel} için "${input.serviceName}" hizmetinde
şu saatler boş: ${timesText}.

Bu boşluğu doldurmak için Instagram Story'de paylaşılacak KISA bir duyuru metni yaz. ${angle} yaz.

Rakam veya oran UYDURMA, sadece verilen saatleri kullan. "Kaçırma", "Sınırlı yer", "Hemen kaçırma
fırsatı" gibi AŞIRI kullanılmış klişelerden KAÇIN, özgün bir cümle bul.

TEK cümle, en fazla 14 kelime, saatlerden en az birini doğal şekilde geçir ve randevuya nazikçe davet et.
SADECE bu cümleyi yaz, başka hiçbir şey ekleme (tırnak işareti de ekleme).`;

  const response = await ai.models.generateContent({
    model: AI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { temperature: 1.1 },
  });

  const text = (response.text ?? "").trim().replace(/^["']|["']$/g, "");
  return text || FALLBACK(input);
}
