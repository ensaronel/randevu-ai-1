import type { Staff } from "@/types/database";

export function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Aktif personelin bugünkü çalışma saatlerinden, o gün için dolu (randevulu)
 * dakikaları düşerek toplam boş kapasiteyi (dakika) hesaplar. İzinli personel
 * ya da çalışma saati tanımlanmamış günler 0 katkı yapar.
 */
export function computeFreeCapacityMinutes(
  staffList: Staff[],
  todayWeekdayKey: string,
  todayDateKey: string,
  bookedMinutesByStaffId: Record<string, number>
): number {
  let totalFreeMinutes = 0;

  for (const staff of staffList) {
    if (staff.leave_dates?.includes(todayDateKey)) continue;

    const hours = staff.working_hours?.[todayWeekdayKey];
    if (!hours) continue;

    const [start, end] = hours;
    const workingMinutes = Math.max(0, parseTimeToMinutes(end) - parseTimeToMinutes(start));
    const bookedMinutes = bookedMinutesByStaffId[staff.id] ?? 0;

    totalFreeMinutes += Math.max(0, workingMinutes - bookedMinutes);
  }

  return totalFreeMinutes;
}

export function formatMinutesAsHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours} sa`;
  return `${hours} sa ${remaining} dk`;
}
