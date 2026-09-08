import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { fixedExpenseUpdateSchema } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/kasa/fixed-expenses/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;
    const body = fixedExpenseUpdateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("fixed_expenses")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  });
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/kasa/fixed-expenses/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;

    const { error } = await supabase
      .from("fixed_expenses")
      .delete()
      .eq("business_id", owner.business_id)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ data: { id } });
  });
}
