import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { findAvailableSlots } from "@/lib/ai/availability";
import type { Appointment, AppointmentService, Business, Service, Staff } from "@/types/database";

/**
 * Owner'ın "Randevu Oluştur" ekranında kullandığı müsaitlik sorgusu — AI'ın
 * check_availability aracıyla (src/lib/ai/tools.ts) AYNI findAvailableSlots
 * motorunu kullanır, böylece iki farklı yol farklı sonuç üretmez.
 */
export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const dateKey = request.nextUrl.searchParams.get("date");
    const serviceId = request.nextUrl.searchParams.get("service_id");
    const staffId = request.nextUrl.searchParams.get("staff_id");

    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !serviceId) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) ve service_id gerekli" }, { status: 400 });
    }

    const [{ data: business }, { data: service }, { data: staffData }, { data: expertise }, { data: apptData }] =
      await Promise.all([
        supabase.from("businesses").select("*").eq("id", owner.business_id).single(),
        supabase.from("services").select("*").eq("business_id", owner.business_id).eq("id", serviceId).single(),
        supabase.from("staff").select("*").eq("business_id", owner.business_id).eq("status", "active"),
        supabase.from("staff_service_expertise").select("staff_id, service_id"),
        supabase
          .from("appointments")
          .select("*, appointment_services(*)")
          .eq("business_id", owner.business_id)
          .gte("starts_at", `${dateKey}T00:00:00+03:00`)
          .lt("starts_at", `${dateKey}T23:59:59+03:00`),
      ]);

    if (!business || !service) {
      return NextResponse.json({ error: "isletme_veya_hizmet_bulunamadi" }, { status: 404 });
    }

    let staffList = (staffData ?? []) as Staff[];
    if (staffId) staffList = staffList.filter((s) => s.id === staffId);

    const slots = findAvailableSlots({
      business: business as Business,
      requestedServices: [service as Service],
      staff: staffList,
      expertise: expertise ?? [],
      existingAppointments: (apptData ?? []) as (Appointment & { appointment_services: AppointmentService[] })[],
      dateKey,
    });

    return NextResponse.json({
      data: slots.map((s) => ({
        starts_at: s.startsAt,
        ends_at: s.endsAt,
        assignments: s.assignments.map((a) => ({
          service_id: a.serviceId,
          staff_id: a.staffId,
          staff_name: a.staffName,
        })),
      })),
    });
  });
}
