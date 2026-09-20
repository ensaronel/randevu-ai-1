import { GoogleGenAI } from "@google/genai";
import { AI_MODEL } from "@/lib/ai/model";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface SocialProofCandidate {
  id: string;
  text: string; // müşterinin ham anket cevabı
}

export interface SocialProofSelection {
  id: string;
  quote: string; // müşterinin KENDİ sözlerinden kısaltılmış alıntı — uydurma yok
  caption: string;
}

/**
 * Son N gündeki, daha önce kullanılmamış anket geri bildirimleri arasından GERÇEKTEN
 * olumlu olanı seçer (varsa). Uydurma veri riskini sıfırlamak için: model alıntıyı
 * İCAT EDEMEZ, sadece verilen adaylardan birini seçip metnini kısaltabilir. Puan/yıldız
 * hiç sorulmuyor (bkz. proje anket akışı) — bu yüzden burada da hiç üretilmez.
 */
export async function selectPositiveFeedback(input: {
  businessName: string;
  candidates: SocialProofCandidate[];
}): Promise<SocialProofSelection | null> {
  if (input.candidates.length === 0) return null;

  const list = input.candidates.map((c, i) => `${i + 1}. (id:${c.id}) "${c.text}"`).join("\n");

  const prompt = `İşletme adı: ${input.businessName}. Aşağıda müşterilerden WhatsApp anketiyle toplanmış
HAM geri bildirim metinleri var:
${list}

Görevin:
1. Bunlar arasından GERÇEKTEN olumlu/övücü olanı seç — şikayet, nötr, belirsiz veya çok kısa/anlamsız
   ("iyi", "teşekkürler" gibi tek kelimelik) olanları SEÇME. Hiçbiri yeterince olumlu ve paylaşılabilir
   değilse SADECE "NONE" yaz, başka hiçbir şey ekleme.
2. Seçtiğin metinden KISA bir alıntı çıkar — müşterinin KENDİ SÖZLERİNDEN, hiçbir şey UYDURMA veya
   EKLEME, sadece kısalt/gerekirse hafif dilbilgisi düzelt. En fazla 12-14 kelime. Tırnak işareti EKLEME.
3. Bu alıntıyı tanıtan, Instagram Story'de paylaşılacak KISA bir caption yaz (en fazla 10 kelime,
   "müşterilerimiz bizi seviyor" gibi genel kalıplardan KAÇIN, özgün ol).

Hiçbiri uygun değilse TEK SATIR olarak sadece:
NONE

Uygun biri varsa şu TAM formatta, başka hiçbir şey eklemeden cevap ver:
ID: <seçilen id>
QUOTE: <alıntı>
CAPTION: <paylaşım metni>`;

  const response = await ai.models.generateContent({
    model: AI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { temperature: 0.7 },
  });

  const text = (response.text ?? "").trim();
  if (!text || /^NONE\b/i.test(text)) return null;

  const idMatch = text.match(/ID:\s*([\s\S]*?)(?:\nQUOTE:|$)/);
  const quoteMatch = text.match(/QUOTE:\s*([\s\S]*?)(?:\nCAPTION:|$)/);
  const captionMatch = text.match(/CAPTION:\s*([\s\S]*)$/);

  const id = idMatch?.[1]?.trim();
  const quote = quoteMatch?.[1]?.trim().replace(/^["']|["']$/g, "");
  const caption = captionMatch?.[1]?.trim();

  if (!id || !quote || !caption) return null;

  // Halüsinasyon id'sine karşı güvenlik — model listede olmayan bir id uydurmuşsa reddet.
  const matched = input.candidates.find((c) => c.id === id);
  if (!matched) return null;

  return { id, quote, caption };
}
