import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner, UnauthorizedError, AccountInactiveError } from "@/lib/auth";
import { ShareImage, type ShareImagePayload } from "@/lib/ai/shareImage";
import { loadShareImageFonts } from "@/lib/ai/shareImageFonts";

export const runtime = "nodejs";

/**
 * Bir action_objects satırının share_image alanını isteğe cevap üretilirken
 * PNG'ye çeviren rota — PWA ikonlarında zaten kullanılan aynı Satori/ImageResponse
 * tekniği, ayrı bir Supabase Storage bucket'ı gerekmiyor. Diğer /api/* rotaları
 * gibi proxy.ts'nin oturum zorunluluğuna tabi (whitelist'te değil).
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

    const payload = data.share_image as ShareImagePayload;
    const fonts = await loadShareImageFonts();

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
