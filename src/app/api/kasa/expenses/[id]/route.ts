import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/kasa/expenses/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;

    const { error } = await supabase
      .from("expense_items")
      .delete()
      .eq("business_id", owner.business_id)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ data: { id } });
  });
}
