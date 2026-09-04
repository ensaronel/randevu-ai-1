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
    const serviceIds = request.nextUrl.searchParams.getAll("service_id");
    const staffId = request.nextUrl.searchParams.get("staff_id");

    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || serviceIds.length === 0) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) ve en az bir service_id gerekli" }, { status: 400 });
    }

    const [{ data: business }, { data: serviceData }, { data: staffData }, { data: apptData }] = await Promise.all([
      supabase.from("businesses").select("*").eq("id", owner.business_id).single(),
      supabase.from("services").select("*").eq("business_id", owner.business_id).in("id", serviceIds),
      supabase.from("staff").select("*").eq("business_id", owner.business_id).eq("status", "active"),
      supabase
        .from("appointments")
        .select("*, appointment_services(*)")
        .eq("business_id", owner.business_id)
        .gte("starts_at", `${dateKey}T00:00:00+03:00`)
        .lt("starts_at", `${dateKey}T23:59:59+03:00`),
    ]);

    const services = (serviceData ?? []) as Service[];
    if (!business || services.length !== serviceIds.length) {
      return NextResponse.json({ error: "isletme_veya_hizmet_bulunamadi" }, { status: 404 });
    }

    let staffList = (staffData ?? []) as Staff[];
    if (staffId) staffList = staffList.filter((s) => s.id === staffId);

    // RLS zaten staff_service_expertise'i bu işletmenin personeline daraltıyor
    // (staff.business_id üzerinden) ama savunma katmanı olarak burada da açıkça
    // sadece ilgili staffList'in id'leriyle filtreleniyor.
    const { data: expertise } =
      staffList.length > 0
        ? await supabase
            .from("staff_service_expertise")
            .select("staff_id, service_id")
            .in("staff_id", staffList.map((s) => s.id))
        : { data: [] };

    const slots = findAvailableSlots({
      business: business as Business,
      requestedServices: services,
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
