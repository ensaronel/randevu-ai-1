import type { Appointment, AppointmentService, Business, Service, Staff } from "@/types/database";

const TURKEY_UTC_OFFSET_MINUTES = 3 * 60;
const STEP_MINUTES = 15;
const MIN_GAP_BETWEEN_CANDIDATES_MINUTES = 60;
const MAX_CANDIDATES = 3;

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function weekdayKeyForDate(dateKey: string): (typeof WEEKDAY_KEYS)[number] {
  return WEEKDAY_KEYS[new Date(`${dateKey}T12:00:00+03:00`).getUTCDay()];
}

function dayRangeUtcISO(dateKey: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - TURKEY_UTC_OFFSET_MINUTES * 60000;
  const endUtcMs = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - TURKEY_UTC_OFFSET_MINUTES * 60000;
  return { startUtc: new Date(startUtcMs).toISOString(), endUtc: new Date(endUtcMs).toISOString() };
}

function turkeyLocalMinutesToUtcISO(dateKey: string, minutesFromMidnight: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utcMs =
    Date.UTC(y, m - 1, d, 0, minutesFromMidnight, 0) - TURKEY_UTC_OFFSET_MINUTES * 60000;
  return new Date(utcMs).toISOString();
}

function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

export interface SlotAssignment {
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  durationMinutes: number;
}

export interface SlotCandidate {
  startsAt: string;
  endsAt: string;
  assignments: SlotAssignment[];
}

interface FindSlotsParams {
  business: Business;
  requestedServices: Service[];
  staff: Staff[];
  expertise: { staff_id: string; service_id: string }[];
  existingAppointments: (Appointment & { appointment_services: AppointmentService[] })[];
  dateKey: string;
}

/** Bir hizmeti yapabilecek personel — o hizmet için hiç uzmanlık kaydı yoksa tüm aktif personel yapabilir sayılır. */
function capableStaffFor(service: Service, staff: Staff[], expertise: FindSlotsParams["expertise"]): Staff[] {
  const staffIdsForService = expertise.filter((e) => e.service_id === service.id).map((e) => e.staff_id);
  if (staffIdsForService.length === 0) return staff.filter((s) => s.status === "active");
  return staff.filter((s) => s.status === "active" && staffIdsForService.includes(s.id));
}

function staffBusyIntervals(
  staffId: string,
  existingAppointments: FindSlotsParams["existingAppointments"]
): { startMin: number; endMin: number }[] {
  const intervals: { startMin: number; endMin: number }[] = [];
  for (const appt of existingAppointments) {
    if (appt.status === "cancelled") continue;
    for (const svc of appt.appointment_services) {
      if (svc.staff_id !== staffId) continue;
      const startMs = new Date(appt.starts_at).getTime() + TURKEY_UTC_OFFSET_MINUTES * 60000;
      const endMs = new Date(appt.ends_at).getTime() + TURKEY_UTC_OFFSET_MINUTES * 60000;
      const dayStartMs = new Date(`${appt.starts_at.slice(0, 10)}T00:00:00Z`).getTime();
      intervals.push({
        startMin: Math.round((startMs - dayStartMs) / 60000),
        endMin: Math.round((endMs - dayStartMs) / 60000),
      });
    }
  }
  return intervals;
}

function isStaffFree(
  staffId: string,
  startMin: number,
  endMin: number,
  existingAppointments: FindSlotsParams["existingAppointments"]
): boolean {
  return staffBusyIntervals(staffId, existingAppointments).every(
    (busy) => endMin <= busy.startMin || startMin >= busy.endMin
  );
}

/** Belirli bir saatte, bir hizmeti karşılayabilecek (uygun, müsait, mesaide) personel adayları. */
function eligibleStaffAt(
  service: Service,
  t: number,
  weekdayKey: (typeof WEEKDAY_KEYS)[number],
  params: FindSlotsParams
): Staff[] {
  const { staff, expertise, dateKey, existingAppointments } = params;
  const serviceEnd = t + service.duration_minutes;

  return capableStaffFor(service, staff, expertise).filter((s) => {
    if (s.leave_dates?.includes(dateKey)) return false;
    const shift = s.working_hours?.[weekdayKey];
    if (!shift) return false;
    const [shiftStart, shiftEnd] = shift.map(parseTimeToMinutes);
    if (t < shiftStart || serviceEnd > shiftEnd) return false;
    return isStaffFree(s.id, t, serviceEnd, existingAppointments);
  });
}

/**
 * Belirli bir başlangıç saatinde, istenen TÜM hizmetleri (her biri farklı bir
 * personele) atamaya çalışır — açgözlü değil, geri izlemeli (backtracking):
 * bir hizmet için seçilen personel sonraki hizmetlerden birini imkansız
 * kılarsa, o seçim geri alınıp başka bir aday denenir. Böylece "A hizmetini
 * hem X hem Y, B hizmetini sadece X yapabiliyor" gibi durumlarda, A önce X'i
 * denese bile B için X'i boşa çıkarıp Y'ye geçebilir.
 */
function tryAssignServices(
  services: Service[],
  idx: number,
  t: number,
  weekdayKey: (typeof WEEKDAY_KEYS)[number],
  usedStaffIds: Set<string>,
  params: FindSlotsParams
): SlotAssignment[] | null {
  if (idx === services.length) return [];

  const service = services[idx];
  const candidates = eligibleStaffAt(service, t, weekdayKey, params).filter((s) => !usedStaffIds.has(s.id));

  for (const candidate of candidates) {
    usedStaffIds.add(candidate.id);
    const rest = tryAssignServices(services, idx + 1, t, weekdayKey, usedStaffIds, params);
    if (rest !== null) {
      return [
        {
          serviceId: service.id,
          serviceName: service.name,
          staffId: candidate.id,
          staffName: candidate.full_name,
          durationMinutes: service.duration_minutes,
        },
        ...rest,
      ];
    }
    usedStaffIds.delete(candidate.id);
  }

  return null;
}

/**
 * Verilen tarihte, istenen hizmetlerin hepsini (gerekirse farklı personelle
 * eşzamanlı) karşılayabilecek 3'e kadar aday saat döner. Her aday: her hizmet
 * için o hizmeti yapabilen, o gün çalışan, izinli olmayan ve o saatte başka
 * randevusu olmayan bir personel bulunduğunda geçerli sayılır.
 */
export function findAvailableSlots(params: FindSlotsParams): SlotCandidate[] {
  const { business, requestedServices, dateKey } = params;

  if (business.closed_dates.includes(dateKey)) return [];

  const weekdayKey = weekdayKeyForDate(dateKey);
  const businessHours = business.working_hours[weekdayKey];
  if (!businessHours) return [];

  const [openMin, closeMin] = businessHours.map(parseTimeToMinutes);
  const maxDuration = Math.max(...requestedServices.map((s) => s.duration_minutes));

  const candidates: SlotCandidate[] = [];
  let lastCandidateStart = -Infinity;

  for (let t = openMin; t + maxDuration <= closeMin; t += STEP_MINUTES) {
    if (t - lastCandidateStart < MIN_GAP_BETWEEN_CANDIDATES_MINUTES) continue;

    const assignments = tryAssignServices(requestedServices, 0, t, weekdayKey, new Set(), params);

    if (assignments) {
      const overallEnd = t + maxDuration;
      candidates.push({
        startsAt: turkeyLocalMinutesToUtcISO(dateKey, t),
        endsAt: turkeyLocalMinutesToUtcISO(dateKey, overallEnd),
        assignments,
      });
      lastCandidateStart = t;
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  }

  return candidates;
}

export { dayRangeUtcISO as dayRangeUtcISOForDate, weekdayKeyForDate };
