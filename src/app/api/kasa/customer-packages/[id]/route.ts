import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/kasa/customer-packages/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;

    const { error } = await supabase
      .from("customer_packages")
      .delete()
      .eq("business_id", owner.business_id)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ data: { id } });
  });
}
