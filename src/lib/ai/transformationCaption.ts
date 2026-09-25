import { generateContentResilient } from "@/lib/ai/gemini";

export interface TransformationCaptionInput {
  businessName: string;
  note?: string; // owner'ın isteğe bağlı olarak girdiği kısa not (ör. hizmet adı, "saç boyama")
}

export interface TransformationCaptionOutput {
  headline: string; // görselde büyük yazan kısa vurucu cümle (maks ~6 kelime)
  caption: string; // paylaşım metni (2-3 cümle)
}

const FALLBACK: TransformationCaptionOutput = {
  headline: "Yepyeni bir hâl ✨",
  caption: "Sıra sende — hemen randevunu ayırt!",
};

// Her çağrıda RASTGELE birini seçip prompt'a veriyoruz — modele hep aynı kalıbı
// ("Bambaşka bir kişi!", "Kusursuz X'e merhaba deyin" gibi) tekrarlatmamak için.
// Kullanıcı geri bildirimi: "AI daha akıllı yazılar üretsin, hep aynı cümleleri
// kullanmasın" — tek bir sabit prompt her seferinde aynı üsluba yakınsıyordu.
const CREATIVE_ANGLES = [
  "merak uyandıran bir soru sorarak",
  "doğrudan somut bir fayda/his vurgulayarak (uydurma rakam değil, gerçek bir duygu)",
  "kısa ve iddialı bir itiraf/gözlem cümlesiyle (ör. bir müşteri repliği havasında)",
  "günlük konuşma diline yakın, samimi ve esprili bir tonla",
  "önce/sonra kontrastını vurgulayan kısa bir karşılaştırmayla",
];

/**
 * Owner öncesi/sonrası fotoğraf yüklediğinde (bkz. /api/reklam/donusum) çağrılır —
 * gerçek müşteri/işlem verisine dayanmadığı, sadece owner'ın kendi girdiği nota
 * göre genel bir kutlama metni ürettiği için uydurma veri riski yok.
 */
export async function generateTransformationCaption(
  input: TransformationCaptionInput
): Promise<TransformationCaptionOutput> {
  const topicInstruction = input.note
    ? `Owner bu fotoğrafın "${input.note}" hizmetine ait olduğunu belirtti — HEADLINE ve CAPTION
KESİNLİKLE bu hizmet hakkında olsun, genel/belirsiz bir "dönüşüm" ifadesiyle YETİNME
(ör. not "kaş ekimi" ise metin kaş ekiminden bahsetmeli, alakasız genel bir cümle olmamalı).
Hizmete özgü, o alanı gerçekten bilen biri gibi yaz (ör. kaş ekimi için "doğallık/simetri/
kalıcılık", saç boyama için "kök/ton/parlaklık" gibi o hizmete özgü kavramlar kullan).`
    : `Owner özel bir hizmet belirtmedi, genel bir görünüm dönüşümünden bahset.`;

  const angle = CREATIVE_ANGLES[Math.floor(Math.random() * CREATIVE_ANGLES.length)];

  const prompt = `İşletme adı: ${input.businessName}. Bir öncesi/sonrası dönüşüm fotoğrafı için
PROFESYONEL bir reklam kreatifi metni hazırlıyorsun (Instagram reklamı gibi düşün — kısa,
vurucu, klişe değil). ${topicInstruction}

Bu metni ${angle} yaz — ama zorlama, doğal aksın. "Bambaşka bir kişi", "Kusursuz X'e merhaba
deyin", "Yepyeni bir hâl" gibi kalıplaşmış/klişe reklam cümlelerini KULLANMA, bu ifadeler
zaten çok kullanıldı. Gerçekten YARATICI ve akılda kalıcı bir şey bul.

İki şey üret:
1. HEADLINE: Görselin üzerine büyük puntoyla yazılacak, EN FAZLA 5 kelime, vurucu ve özgün.
   Rakam veya somut bir sonuç UYDURMA.
2. CAPTION: TEK cümle, en fazla 12-14 kelime, sonunda randevuya nazikçe davet eden kısa bir
   ton olsun. Uzun/duygusal paragraflardan KAÇIN — bu bir reklam metni, hikaye değil.

Şu TAM formatta, başka hiçbir şey eklemeden cevap ver:
HEADLINE: <başlık>
CAPTION: <paylaşım metni>`;

  const response = await generateContentResilient({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { temperature: 1.15 },
  }).catch((err) => {
    console.error("[transformationCaption] AI metni üretilemedi, yedek metin kullanılıyor:", err);
    return null;
  });

  const text = (response?.text ?? "").trim();
  const headlineMatch = text.match(/HEADLINE:\s*([\s\S]*?)(?:\nCAPTION:|$)/);
  const captionMatch = text.match(/CAPTION:\s*([\s\S]*)$/);

  const headline = headlineMatch?.[1]?.trim();
  const caption = captionMatch?.[1]?.trim();

  if (!headline || !caption) return FALLBACK;
  return { headline, caption };
}
