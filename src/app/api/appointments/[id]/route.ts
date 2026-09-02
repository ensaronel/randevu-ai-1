import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { appointmentUpdateSchema } from "@/lib/validation";
import { matchWaitlistForCancelledAppointment } from "@/lib/proactive";

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
    const { starts_at, ends_at, ...rest } = body;

    const { data: before, error: beforeError } = await supabase
      .from("appointments")
      .select("attendance, customer_id, status")
      .eq("business_id", owner.business_id)
      .eq("id", id)
      .single();
    if (beforeError) throw beforeError;

    // Saat değişikliği artık ham .update() ile değil, create_appointment_with_services
    // ile AYNI advisory-lock + çakışma kontrolü mantığını paylaşan bir RPC üzerinden
    // geçiyor — aksi halde randevu ertelemek çakışma korumasını tamamen atlıyordu.
    if (starts_at !== undefined && ends_at !== undefined) {
      const { error: rescheduleError } = await supabase.rpc("reschedule_appointment_with_check", {
        p_appointment_id: id,
        p_starts_at: starts_at,
        p_ends_at: ends_at,
      });
      if (rescheduleError) {
        if (rescheduleError.message?.includes("staff_conflict")) {
          return NextResponse.json({ error: "staff_conflict" }, { status: 409 });
        }
        if (rescheduleError.message?.includes("invalid_time_range")) {
          return NextResponse.json({ error: "invalid_time_range" }, { status: 400 });
        }
        throw rescheduleError;
      }
    } else if (starts_at !== undefined || ends_at !== undefined) {
      return NextResponse.json({ error: "starts_at_and_ends_at_required_together" }, { status: 400 });
    }

    if (Object.keys(rest).length > 0) {
      const { error: updateError } = await supabase
        .from("appointments")
        .update(rest)
        .eq("business_id", owner.business_id)
        .eq("id", id);
      if (updateError) throw updateError;
    }

    const { data, error } = await supabase
      .from("appointments")
      .select(
        "*, customer:customers(id, full_name, phone), appointment_services(*, service:services(id, name), staff:staff(id, full_name))"
      )
      .eq("business_id", owner.business_id)
      .eq("id", id)
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

    if (body.status === "cancelled" && before.status !== "cancelled") {
      await matchWaitlistForCancelledAppointment(owner.business_id, id).catch((err) =>
        console.error("waitlist match failed", err)
      );
    }

    return NextResponse.json({ data });
  });
}
