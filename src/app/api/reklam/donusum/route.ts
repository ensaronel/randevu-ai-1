import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { generateTransformationCaption } from "@/lib/ai/transformationCaption";
import type { TransformationSharePayload } from "@/lib/ai/transformationShareImage";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
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
      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json({ error: "invalid_file_type" }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "file_too_large" }, { status: 400 });
      }
    }

    const admin = createAdminSupabaseClient();
    const { data: business } = await admin.from("businesses").select("name").eq("id", owner.business_id).single();
    const businessName = business?.name ?? "İşletmeniz";

    const stamp = Date.now();
    const beforePath = `${owner.business_id}/${stamp}-before.${extensionFor(before.type)}`;
    const afterPath = `${owner.business_id}/${stamp}-after.${extensionFor(after.type)}`;

    const [beforeUpload, afterUpload] = await Promise.all([
      admin.storage.from("reklam-photos").upload(beforePath, before, { contentType: before.type }),
      admin.storage.from("reklam-photos").upload(afterPath, after, { contentType: after.type }),
    ]);
    if (beforeUpload.error || afterUpload.error) {
      throw beforeUpload.error ?? afterUpload.error;
    }

    const noteText = typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : undefined;
    const { headline, caption } = await generateTransformationCaption({ businessName, note: noteText });

    const shareImage: TransformationSharePayload = {
      kind: "transformation",
      businessName,
      beforePath,
      afterPath,
      headline,
      caption,
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
