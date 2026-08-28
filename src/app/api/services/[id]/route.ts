import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { serviceUpdateSchema } from "@/lib/validation";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/services/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;

    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  });
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/services/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;
    const body = serviceUpdateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("services")
      .update(body)
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  });
}

// Soft-delete: kalıcı silme yok, sadece status='inactive'.
export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/services/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;

    const { data, error } = await supabase
      .from("services")
      .update({ status: "inactive" })
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  });
}
