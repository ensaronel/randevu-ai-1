import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { appointmentUpdateSchema } from "@/lib/validation";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/appointments/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;

    const { data, error } = await supabase
      .from("appointments")
      .select(
        "*, customer:customers(id, full_name, phone), appointment_services(*, service:services(id, name), staff:staff(id, full_name))"
      )
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  });
}

const NO_SHOW_VALUES = ["no_show_notified", "no_show_silent"];

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/appointments/[id]">
) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;
    const body = appointmentUpdateSchema.parse(await request.json());

    const { data: before, error: beforeError } = await supabase
      .from("appointments")
      .select("attendance, customer_id")
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .single();
    if (beforeError) throw beforeError;

    const { data, error } = await supabase
      .from("appointments")
      .update(body)
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // no_show_count'u sadece durum GERÇEKTEN değiştiğinde artır/azalt — aynı
    // mutabakatı iki kez kaydetmek sayacı yanlışlıkla ikiye katlamasın diye.
    if (body.attendance !== undefined && body.attendance !== before.attendance) {
      const wasNoShow = NO_SHOW_VALUES.includes(before.attendance ?? "");
      const isNoShow = NO_SHOW_VALUES.includes(body.attendance ?? "");
      if (isNoShow && !wasNoShow) {
        const { error: rpcError } = await supabase.rpc("increment_no_show_count", { p_customer_id: before.customer_id });
        if (rpcError) throw rpcError;
      } else if (!isNoShow && wasNoShow) {
        const { error: rpcError } = await supabase.rpc("decrement_no_show_count", { p_customer_id: before.customer_id });
        if (rpcError) throw rpcError;
      }
    }

    return NextResponse.json({ data });
  });
}
