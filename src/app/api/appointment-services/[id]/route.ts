import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { appointmentServiceUpdateSchema } from "@/lib/validation";

// appointment_services'te business_id kolonu yok (appointments üzerinden dolaylı) —
// bu yüzden burada .eq("business_id", ...) ile ek filtre yapılamıyor, izolasyon
// tamamen "own appointment_services" RLS politikasına (appointments join'i) dayanıyor.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/appointment-services/[id]">
) {
  return handleRoute(async () => {
    const { supabase } = await requireBusinessOwner();
    const { id } = await ctx.params;
    const body = appointmentServiceUpdateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("appointment_services")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  });
}
