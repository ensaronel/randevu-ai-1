import type { Appointment, AppointmentService, Business, Service, Staff } from "@/types/database";

const TURKEY_UTC_OFFSET_MINUTES = 3 * 60;
// Randevular yalnizca tam saatlerde baslar (ör. 11:30 degil 11:00/12:00) —
// bir hizmet ortalama ~1 saat surdugu icin bu, gercek calisma duzenine uyar.
const STEP_MINUTES = 60;
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

/** Türkiye yerel tarihine/gece-yarısından-bu-yana-geçen-dakikaya göre "şu an" (sabit UTC+3 ofset, Türkiye'de DST yok). */
function nowInTurkey(): { dateKey: string; minutesOfDay: number } {
  const d = new Date(Date.now() + TURKEY_UTC_OFFSET_MINUTES * 60000);
  return { dateKey: d.toISOString().slice(0, 10), minutesOfDay: d.getUTCHours() * 60 + d.getUTCMinutes() };
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

/** Bir personelin o gün için toplam dolu dakikası — en boş personeli önceliklendirmek için. */
function totalBookedMinutes(staffId: string, existingAppointments: FindSlotsParams["existingAppointments"]): number {
  return staffBusyIntervals(staffId, existingAppointments).reduce((sum, i) => sum + (i.endMin - i.startMin), 0);
}

/**
 * Belirli bir saatte, bir hizmeti karşılayabilecek (uygun, müsait, mesaide) personel
 * adayları — o günkü doluluğu en az olandan en çok olana sıralı döner, böylece
 * randevu her zaman en meşgul ustaya değil, en boş olana önerilir. Doluluk eşitse
 * (ör. o gün için hiç randevu yoksa, herkes 0 dakika dolu) saate göre döndürerek
 * sıralanır — aksi halde eşitlik hep aynı (dizideki ilk/alfabetik) personele
 * düşer ve bir günde önerilen 3 saatin de hep aynı ustayı göstermesine yol açardı.
 */
function eligibleStaffAt(
  service: Service,
  t: number,
  weekdayKey: (typeof WEEKDAY_KEYS)[number],
  params: FindSlotsParams
): Staff[] {
  const { staff, expertise, dateKey, existingAppointments } = params;
  const serviceEnd = t + service.duration_minutes;

  const eligible = capableStaffFor(service, staff, expertise).filter((s) => {
    if (s.leave_dates?.includes(dateKey)) return false;
    const shift = s.working_hours?.[weekdayKey];
    if (!shift) return false;
    const [shiftStart, shiftEnd] = shift.map(parseTimeToMinutes);
    if (t < shiftStart || serviceEnd > shiftEnd) return false;
    return isStaffFree(s.id, t, serviceEnd, existingAppointments);
  });

  const rotationOffset = eligible.length > 0 ? Math.floor(t / STEP_MINUTES) % eligible.length : 0;
  return eligible
    .map((s, i) => ({ s, busy: totalBookedMinutes(s.id, existingAppointments), rotated: (i + rotationOffset) % eligible.length }))
    .sort((a, b) => a.busy - b.busy || a.rotated - b.rotated)
    .map((x) => x.s);
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

  // Bugün için, saati çoktan geçmiş bir başlangıç önerilmesin — bir sonraki
  // tam saate yuvarlanır (STEP_MINUTES zaten 60 olduğundan bu doğal bir grid noktası).
  const now = nowInTurkey();
  const startMin =
    dateKey === now.dateKey
      ? Math.max(openMin, Math.ceil(now.minutesOfDay / STEP_MINUTES) * STEP_MINUTES)
      : openMin;

  const candidates: SlotCandidate[] = [];
  let lastCandidateStart = -Infinity;

  for (let t = startMin; t + maxDuration <= closeMin; t += STEP_MINUTES) {
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
