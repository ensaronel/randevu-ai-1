import { NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { TransformationSharePayload } from "@/lib/ai/transformationShareImage";

/**
 * Bir reklam içeriğini (action_objects satırını) siler. "Dönüşüm" tipindeyse
 * Storage'daki öncesi/sonrası fotoğrafları da temizler — aksi halde bucket'ta
 * sahipsiz dosya birikir.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/reklam/[id]">) {
  return handleRoute(async () => {
    const { owner } = await requireBusinessOwner();
    const { id } = await ctx.params;
    const admin = createAdminSupabaseClient();

    const { data: row, error: fetchError } = await admin
      .from("action_objects")
      .select("share_image")
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .single();
    if (fetchError || !row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const payload = row.share_image as (TransformationSharePayload & { kind?: string }) | null;
    if (payload?.kind === "transformation") {
      await admin.storage.from("reklam-photos").remove([payload.beforePath, payload.afterPath]);
    }

    const { error: deleteError } = await admin
      .from("action_objects")
      .delete()
      .eq("business_id", owner.business_id)
      .eq("id", id);
    if (deleteError) throw deleteError;

    return NextResponse.json({ data: { id } });
  });
}
