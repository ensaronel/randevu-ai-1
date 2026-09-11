import { getBusinessOwnerForPage } from "@/lib/auth";
import { monthRangeUtcISO, dateKeyTR } from "@/lib/date";
import { parseTimeToMinutes } from "@/lib/capacity";
import { isRealizedRevenue } from "@/lib/revenue";
import type { Business, Staff } from "@/types/database";

type SupabaseClient = Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"];

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface AppointmentRow {
  status: string;
  attendance: string | null;
  starts_at: string;
  appointment_services: {
    planned_price: number;
    final_price: number | null;
    staff_id: string;
    commission_rate_snapshot: number | null;
    service: { duration_minutes: number } | { duration_minutes: number }[] | null;
  }[];
}

function serviceDuration(service: AppointmentRow["appointment_services"][number]["service"]): number {
  if (!service) return 0;
  return Array.isArray(service) ? service[0]?.duration_minutes ?? 0 : service.duration_minutes;
}

export interface StaffMonthlyMetrics {
  staffId: string;
  revenue: number;
  commission: number;
  bookedMinutes: number;
  availableMinutes: number;
  occupancyPercent: number;
  totalAssignments: number;
  cancelledCount: number;
  cancellationRatePercent: number;
}

/** Ayın 1'inden bugüne (dahil) kaç gün geçtiğini, personelin o günkü izinli olup olmadığını hesaba katarak müsait dakikayı bulur. */
function computeAvailableMinutesMonthToDate(staff: Staff, business: Business): number {
  const todayKey = dateKeyTR(0);
  const [year, month, day] = todayKey.split("-").map(Number);
  let totalMinutes = 0;

  for (let d = 1; d <= day; d++) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (staff.leave_dates?.includes(dateKey)) continue;
    if (business.closed_dates?.includes(dateKey)) continue;

    const weekdayKey = WEEKDAY_KEYS[new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
    const shift = staff.working_hours?.[weekdayKey];
    if (!shift) continue;

    totalMinutes += Math.max(0, parseTimeToMinutes(shift[1]) - parseTimeToMinutes(shift[0]));
  }

  return totalMinutes;
}

/**
 * Çalışanlar ekranındaki "personel performansı" görünümü için: doluluk oranı,
 * aylık ciro/prim, no-show+iptal oranı. Mevcut verilerden (Hafta 7'nin
 * mutabakat/prim hesabı + randevu kayıtları) türetilir, yeni veri modeli
 * gerektirmez.
 */
export async function loadStaffMonthlyMetrics(
  supabase: SupabaseClient,
  business: Business,
  staffList: Staff[]
): Promise<StaffMonthlyMetrics[]> {
  const { startUtc, endUtc } = monthRangeUtcISO();

  const { data } = await supabase
    .from("appointments")
    .select(
      "status, attendance, starts_at, appointment_services(planned_price, final_price, staff_id, commission_rate_snapshot, service:services(duration_minutes))"
    )
    .eq("business_id", business.id)
    .gte("starts_at", startUtc)
    .lt("starts_at", endUtc);

  const rows = (data ?? []) as unknown as AppointmentRow[];

  return staffList.map((staff) => {
    let revenue = 0;
    let commission = 0;
    let bookedMinutes = 0;
    let totalAssignments = 0;
    let cancelledCount = 0;

    for (const row of rows) {
      for (const svc of row.appointment_services) {
        if (svc.staff_id !== staff.id) continue;
        totalAssignments++;
        if (row.status === "cancelled") {
          cancelledCount++;
          continue;
        }
        if (!isRealizedRevenue(row.status, row.attendance, row.starts_at)) continue;
        const price = Number(svc.final_price ?? svc.planned_price);
        const rate = svc.commission_rate_snapshot ?? staff.commission_rate;
        revenue += price;
        commission += price * (Number(rate) / 100);
        bookedMinutes += serviceDuration(svc.service);
      }
    }

    const availableMinutes = computeAvailableMinutesMonthToDate(staff, business);
    const occupancyPercent = availableMinutes > 0 ? Math.round((bookedMinutes / availableMinutes) * 100) : 0;
    const cancellationRatePercent = totalAssignments > 0 ? Math.round((cancelledCount / totalAssignments) * 100) : 0;

    return {
      staffId: staff.id,
      revenue,
      commission,
      bookedMinutes,
      availableMinutes,
      occupancyPercent,
      totalAssignments,
      cancelledCount,
      cancellationRatePercent,
    };
  });
}
