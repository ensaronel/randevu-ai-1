import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { generateTransformationCaption } from "@/lib/ai/transformationCaption";
import {
  TRANSFORMATION_LAYOUTS,
  TRANSFORMATION_ACCENTS,
  type TransformationSharePayload,
  type TransformationLayout,
  type TransformationAccent,
} from "@/lib/ai/transformationShareImage";

export const runtime = "nodejs";

// Telefon kamera fotoğrafları rahatlıkla 10-15MB'ı bulabiliyor — bunu ret sebebi
// yapmak yerine (önceki 8MB sınırı "oluşturulamadı" hatasının asıl sebebiydi)
// sharp ile küçültüp yeniden sıkıştırıyoruz (bkz. normalizePhoto). RAW dosya için
// yine de makul bir tavan var (kötüye kullanım/bellek koruması).
const MAX_RAW_BYTES = 30 * 1024 * 1024;

/**
 * Ne formatta/boyutta gelirse gelsin JPEG'e çevirip makul bir boyuta küçültüyor —
 * hem Storage/Satori için güvenilir tek bir format garantisi, hem de büyük
 * telefon fotoğraflarının reddedilmesini önlüyor. sharp gerçek HEIC (Apple codec,
 * patentli) decode EDEMİYOR — o durumda burada anlaşılır bir hata fırlatıyoruz.
 */
async function normalizePhoto(file: File): Promise<Buffer> {
  const input = Buffer.from(await file.arrayBuffer());
  try {
    return await sharp(input)
      .rotate() // EXIF orientation'ı uygula (çoğu telefon fotoğrafı yan/ters gelir)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch (err) {
    console.error("fotoğraf işlenemedi (desteklenmeyen format olabilir)", err);
    throw new PhotoProcessingError();
  }
}

class PhotoProcessingError extends Error {}

/** Havuzdan RASTGELE seçer, ama `avoid` ile aynı gelirse tekrar dener — art
 * arda üretilen iki içerik aynı şema/renkte olmasın diye (bkz. kullanıcı
 * geri bildirimi: "her görsel aynı şemalar uygulanmasın"). Havuzda tek eleman
 * varsa (teorik olarak imkansız burada) sonsuz döngüye girmemesi için normal
 * bir rastgele seçime düşer. */
function pickDifferent<T>(pool: readonly T[], avoid: T | undefined): T {
  const choice = pool[Math.floor(Math.random() * pool.length)];
  if (choice !== avoid || pool.length < 2) return choice;
  return pool[(pool.indexOf(choice) + 1) % pool.length];
}

/**
 * Owner'ın öncesi/sonrası fotoğraf yükleyip AI'ye paylaşılabilir bir "Dönüşüm"
 * içeriği ürettirdiği rota — bkz. /reklam sayfasındaki yükleme formu. Fotoğraflar
 * `reklam-photos` (private) Storage bucket'ına admin client ile yazılır; hiçbir
 * zaman doğrudan tarayıcıdan/anon key ile yazılmaz, bu yüzden bucket için RLS
 * politikası gerekmiyor (bkz. bucket'ı oluşturan tek seferlik script notu).
 */
export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner } = await requireBusinessOwner();

    const form = await request.formData();
    const before = form.get("before");
    const after = form.get("after");
    const note = form.get("note");

    if (!(before instanceof File) || !(after instanceof File)) {
      return NextResponse.json({ error: "missing_photos" }, { status: 400 });
    }
    for (const file of [before, after]) {
      if (file.size > MAX_RAW_BYTES) {
        return NextResponse.json({ error: "file_too_large" }, { status: 400 });
      }
    }

    let beforeJpeg: Buffer;
    let afterJpeg: Buffer;
    try {
      [beforeJpeg, afterJpeg] = await Promise.all([normalizePhoto(before), normalizePhoto(after)]);
    } catch (err) {
      if (err instanceof PhotoProcessingError) {
        return NextResponse.json({ error: "invalid_file_type" }, { status: 400 });
      }
      throw err;
    }

    const admin = createAdminSupabaseClient();
    const { data: business } = await admin.from("businesses").select("name").eq("id", owner.business_id).single();
    const businessName = business?.name ?? "İşletmeniz";

    const stamp = Date.now();
    const beforePath = `${owner.business_id}/${stamp}-before.jpg`;
    const afterPath = `${owner.business_id}/${stamp}-after.jpg`;

    const [beforeUpload, afterUpload] = await Promise.all([
      admin.storage.from("reklam-photos").upload(beforePath, beforeJpeg, { contentType: "image/jpeg" }),
      admin.storage.from("reklam-photos").upload(afterPath, afterJpeg, { contentType: "image/jpeg" }),
    ]);
    if (beforeUpload.error || afterUpload.error) {
      throw beforeUpload.error ?? afterUpload.error;
    }

    const noteText = typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : undefined;
    const { headline, caption } = await generateTransformationCaption({ businessName, note: noteText });

    // Son üretilen "Dönüşüm" içeriğinin şema/rengini öğrenip ondan FARKLI birini
    // seçiyoruz — art arda oluşturulan içerikler birbirinin kopyası gibi durmasın.
    const { data: lastTransformation } = await admin
      .from("action_objects")
      .select("share_image")
      .eq("business_id", owner.business_id)
      .eq("type", "transformation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastPayload = lastTransformation?.share_image as TransformationSharePayload | undefined;

    const layout = pickDifferent<TransformationLayout>(TRANSFORMATION_LAYOUTS, lastPayload?.layout);
    const accent = pickDifferent<TransformationAccent>(TRANSFORMATION_ACCENTS, lastPayload?.accent);

    const shareImage: TransformationSharePayload = {
      kind: "transformation",
      businessName,
      beforePath,
      afterPath,
      headline,
      caption,
      category: noteText?.slice(0, 40),
      layout,
      accent,
    };

    const { data: inserted, error: insertError } = await admin
      .from("action_objects")
      .insert({
        business_id: owner.business_id,
        type: "transformation",
        suggestion: caption,
        reasoning: "Owner'ın yüklediği öncesi/sonrası fotoğraftan AI ile üretilen paylaşım içeriği.",
        status: "auto_sent",
        share_image: shareImage,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ data: { id: inserted.id } });
  });
}
