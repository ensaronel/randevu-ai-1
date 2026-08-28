import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { appointmentCreateSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");

    let query = supabase
      .from("appointments")
      .select(
        "*, customer:customers(id, full_name, phone), appointment_services(*, service:services(id, name), staff:staff(id, full_name))"
      )
      .eq("business_id", owner.business_id)
      .order("starts_at", { ascending: true });

    if (from) query = query.gte("starts_at", from);
    if (to) query = query.lte("starts_at", to);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ data });
  });
}

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { supabase } = await requireBusinessOwner();
    const body = appointmentCreateSchema.parse(await request.json());

    const { data, error } = await supabase.rpc("create_appointment_with_services", {
      p_customer_id: body.customer_id,
      p_starts_at: body.starts_at,
      p_ends_at: body.ends_at,
      p_source: body.source,
      p_services: body.services,
    });

    if (error) {
      if (error.message?.includes("staff_conflict")) {
        return NextResponse.json({ error: "staff_conflict" }, { status: 409 });
      }
      if (error.message?.includes("invalid_time_range")) {
        return NextResponse.json({ error: "invalid_time_range" }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ data: { id: data } }, { status: 201 });
  });
}
