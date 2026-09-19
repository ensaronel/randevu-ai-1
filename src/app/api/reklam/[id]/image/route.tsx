import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner, UnauthorizedError, AccountInactiveError } from "@/lib/auth";
import { ShareImage, type ShareImagePayload } from "@/lib/ai/shareImage";
import { TransformationShareImage, type TransformationSharePayload } from "@/lib/ai/transformationShareImage";
import { loadShareImageFonts } from "@/lib/ai/shareImageFonts";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function storagePathToDataUrl(path: string): Promise<string> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.storage.from("reklam-photos").download(path);
  if (error || !data) throw new Error(`fotoğraf indirilemedi: ${path}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  return `data:${data.type || "image/jpeg"};base64,${buffer.toString("base64")}`;
}

/**
 * Bir action_objects satırının share_image alanını isteğe cevap üretilirken
 * PNG'ye çeviren rota — PWA ikonlarında zaten kullanılan aynı Satori/ImageResponse
 * tekniği. İki şekli var: standart kart (ShareImage, DB'de saklanan alanlardan
 * doğrudan render edilir) ve öncesi/sonrası (TransformationShareImage, DB'de sadece
 * Storage YOLU tutulur — fotoğrafın kendisi burada indirilip data URI'ye çevrilir,
 * bkz. /api/reklam/donusum). Diğer /api/* rotaları gibi proxy.ts'nin oturum
 * zorunluluğuna tabi (whitelist'te değil).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/reklam/[id]/image">) {
  try {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;

    const { data, error } = await supabase
      .from("action_objects")
      .select("share_image")
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .single();

    if (error || !data?.share_image) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const fonts = await loadShareImageFonts();

    if ((data.share_image as { kind?: string }).kind === "transformation") {
      const payload = data.share_image as TransformationSharePayload;
      const [beforeDataUrl, afterDataUrl] = await Promise.all([
        storagePathToDataUrl(payload.beforePath),
        storagePathToDataUrl(payload.afterPath),
      ]);
      return new ImageResponse(
        (
          <TransformationShareImage
            businessName={payload.businessName}
            headline={payload.headline}
            caption={payload.caption}
            category={payload.category}
            beforeDataUrl={beforeDataUrl}
            afterDataUrl={afterDataUrl}
          />
        ),
        { width: 1080, height: 1920, fonts }
      );
    }

    const payload = data.share_image as ShareImagePayload;
    return new ImageResponse(<ShareImage {...payload} />, {
      width: 1080,
      height: 1920,
      fonts,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof AccountInactiveError) {
      return NextResponse.json({ error: "account_inactive" }, { status: 403 });
    }
    console.error("reklam görseli üretilemedi", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
