import type { Appointment, AppointmentService, Business, Service, Staff } from "@/types/database";

const TURKEY_UTC_OFFSET_MINUTES = 3 * 60;
// Randevular SADECE tam saatte başlar (08:00, 09:00 — 08:30 gibi buçuklu saatler ASLA
// önerilmez) — bu işletmenin kendi kuralı, kullanıcı tarafından 2026-09-12'de açıkça
// doğrulandı. Hizmet süresi 30 dk bile olsa, bir sonraki randevu için grid hep tam
// saatten devam eder (aradaki 30 dk boşluk kasıtlı olarak boş/tampon kalır, ayrı bir
// randevu için ASLA teklif edilmez). Bunu 30'a düşürmeyi denedik (yarım saatlik gerçek
// boşlukları görsün diye) ama kullanıcı bunun YANLIŞ olduğunu, buçuklu saat
// kullanmadıklarını netleştirdi — geri 60'a alındı.
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
  /**
   * Müşterinin istediği saatle BİREBİR aynı mı — AI'nin yorum yapmasına
   * bırakmak yerine (denendi, model tutarsız cümle kuruyordu: "14:00 dolu
   * ama 14:00 müsait" gibi çelişkili ifadeler üretiyordu, 2026-09-10),
   * veride açıkça işaretleniyor ki cevap metni ondan doğrudan okunsun.
   */
  isExactPreferredTime: boolean;
}

interface FindSlotsParams {
  business: Business;
  requestedServices: Service[];
  staff: Staff[];
  expertise: { staff_id: string; service_id: string }[];
  existingAppointments: (Appointment & { appointment_services: AppointmentService[] })[];
  dateKey: string;
  /**
   * Müşteri "öğleden sonra", "akşama doğru" gibi bir tercih belirttiğinde, taramanın
   * günün AÇILIŞINDAN değil bu dakikadan (yerel saat, gece yarısından itibaren dakika)
   * başlaması için. Olmadan tarama hep açılıştan başlar ve MAX_CANDIDATES'e ulaşır
   * ulaşmaz durur — personel hep sabah açtığı için bu, gerçekte öğleden sonra da boş
   * yer varken bile "sadece sabah var" gibi yanlış bir sonuca yol açıyordu (2026-09-09'da
   * sesli arama testinde yakalandı: müşteri Cuma öğleden sonra istedi, sistem hiç
   * bakmadan sadece sabah 09-11 saatlerini önerdi).
   */
  preferredStartMinutes?: number;
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

/**
 * Bir randevunun takvimde GERÇEKTEN kapladığı süre — hizmetin ham duration_minutes
 * değeri ne olursa olsun (ör. 30 dk) her zaman en yakın tam saate YUKARI yuvarlanır.
 * Kullanıcının 2026-09-12'de açıkça belirttiği kural: "18.00 başlayan randevu 19.00'da
 * biter" — randevular her zaman tam saatlik bloklar halinde çalışır, buçuklu/kesirli
 * süre yok. Bunun doğal bir sonucu da şu: bir personelin mesaisi ne zaman biterse
 * bitsin, o mesaiye sığacak SON randevu her zaman (mesai_bitişi - 1 saat)'te başlar.
 */
function blockMinutesFor(service: Service): number {
  return Math.max(STEP_MINUTES, Math.ceil(service.duration_minutes / STEP_MINUTES) * STEP_MINUTES);
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
  const serviceEnd = t + blockMinutesFor(service);

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
 *
 * preferredStartMinutes verildiğinde, dönen adaylar o saate EN YAKIN olanlardır
 * (öncesi veya sonrası fark etmeksizin) — önceden sadece o saatten SONRAsı
 * taranıyordu, bu da müşteri "14:00" isteyip günün geri kalanı doluysa (ama
 * 13:00'te yer varsa) hiçbir şey bulunamayışına, direkt ertesi güne atlanmasına
 * yol açıyordu. Artık gün baştan sona (MAX_CANDIDATES sınırı olmadan) taranıp
 * istenen saate mesafeye göre en yakın 3 aday seçiliyor, sonra sunum için
 * kronolojik sıraya diziliyor. preferredStartMinutes yoksa (müşteri bir tercih
 * belirtmediyse) hedef "en erken uygun an" olur — bu da eski "en erkenden
 * başla" davranışıyla birebir aynı sonucu verir.
 */
export function findAvailableSlots(params: FindSlotsParams): SlotCandidate[] {
  const { business, requestedServices, dateKey, preferredStartMinutes } = params;

  if (business.closed_dates.includes(dateKey)) return [];

  const weekdayKey = weekdayKeyForDate(dateKey);
  const businessHours = business.working_hours[weekdayKey];
  if (!businessHours) return [];

  const [openMin, closeMin] = businessHours.map(parseTimeToMinutes);
  const maxDuration = Math.max(...requestedServices.map((s) => blockMinutesFor(s)));

  // Bugün için, saati çoktan geçmiş bir başlangıç önerilmesin — bir sonraki
  // tam saate yuvarlanır (STEP_MINUTES zaten 60 olduğundan bu doğal bir grid noktası).
  const now = nowInTurkey();
  const earliestAllowed =
    dateKey === now.dateKey
      ? Math.max(openMin, Math.ceil(now.minutesOfDay / STEP_MINUTES) * STEP_MINUTES)
      : openMin;

  const allCandidates: { t: number; assignments: SlotAssignment[] }[] = [];
  for (let t = earliestAllowed; t + maxDuration <= closeMin; t += STEP_MINUTES) {
    const assignments = tryAssignServices(requestedServices, 0, t, weekdayKey, new Set(), params);
    if (assignments) allCandidates.push({ t, assignments });
  }
  if (allCandidates.length === 0) return [];

  const target = preferredStartMinutes !== undefined ? Math.max(preferredStartMinutes, earliestAllowed) : earliestAllowed;

  // Müşteri belirli bir saat istedi VE o saat TAM olarak müsaitse, sadece onu döneriz —
  // "belki bunu da ister misin" diye alternatiflerle kalabalık etmeye gerek yok. Alternatif
  // saatler SADECE istenen saat gerçekten dolu olduğunda anlamlı (2026-09-10'da kullanıcı
  // geri bildirimiyle netleşti: "saat 4'te boş yer var ama diğer saatleri de öneriyor").
  // ÇOK ÖNEMLİ — burada preferredStartMinutes (müşterinin GERÇEKTEN istediği ham saat) ile
  // karşılaştırılır, "target" (yukarıda earliestAllowed'a doğru YUKARI kırpılmış olabilir)
  // ile DEĞİL: müşteri bugün için çoktan geçmiş bir saat isterse (ör. "saat 3" derken şu an
  // saat 17:00'i geçmişse), target sessizce earliestAllowed'a kayar — ama o kaydırılan
  // saatteki bir sonuç ASLA "tam istediğiniz saat" (isExactPreferredTime:true) sayılamaz,
  // çünkü müşteri o saati hiç istemedi. Bu karışıklık 2026-09-12'de canlı testte yakalandı:
  // müşteri "saat 3'te" (15:00) sordu, sistem 17:00'i "evet tam o saat" diye sundu — müşteri
  // "evet" deseydi 15:00 sanıp 17:00'e randevu alacaktı.
  if (preferredStartMinutes !== undefined) {
    const exactMatch = allCandidates.find((c) => c.t === preferredStartMinutes);
    if (exactMatch) {
      return [
        {
          startsAt: turkeyLocalMinutesToUtcISO(dateKey, exactMatch.t),
          endsAt: turkeyLocalMinutesToUtcISO(dateKey, exactMatch.t + maxDuration),
          assignments: exactMatch.assignments,
          isExactPreferredTime: true,
        },
      ];
    }
  }

  const byProximity = [...allCandidates].sort(
    (a, b) => Math.abs(a.t - target) - Math.abs(b.t - target) || a.t - b.t
  );

  const picked: typeof allCandidates = [];
  for (const c of byProximity) {
    if (picked.some((p) => Math.abs(p.t - c.t) < MIN_GAP_BETWEEN_CANDIDATES_MINUTES)) continue;
    picked.push(c);
    if (picked.length >= MAX_CANDIDATES) break;
  }
  picked.sort((a, b) => a.t - b.t); // sunum icin kronolojik sira

  return picked.map(({ t, assignments }) => ({
    startsAt: turkeyLocalMinutesToUtcISO(dateKey, t),
    endsAt: turkeyLocalMinutesToUtcISO(dateKey, t + maxDuration),
    assignments,
    isExactPreferredTime: false, // buraya düşüldüyse zaten exact match yoktu (üstteki blok döner)
  }));
}

export type UnavailabilityReason = "closed_day" | "outside_hours" | "staff_off" | "busy";

/**
 * Kullanıcının 2026-09-12'de açıkça istediği kural: "müsait değil" gibi tek düze bir
 * cevap yerine, gerçek sebep söylensin — dükkan o gün kapalıysa "o gün kapalıyız", saat
 * mesai dışındaysa "o saatte kapalıyız", istenen personel o gün çalışmıyorsa "[personel]
 * o gün çalışmıyor" densin; hiçbiri değilse gerçekten meşguliyetten (busy) kaynaklanıyor.
 * Bu, findAvailableSlots'un ANA planlama mantığından BİLEREK ayrı tutuldu — planlama saf
 * uygunluk hesaplar, bu fonksiyon sadece "neden olmadı"yı AÇIKLAR (tanı amaçlı).
 * requestedMinutes MUTLAKA müşterinin GERÇEKTEN istediği ham saat olmalı (earliestAllowed'a
 * kırpılmış "target" değil) — aksi halde "mesai dışı" sebebi hep gizlenir.
 */
export function explainUnavailability(params: {
  business: Business;
  staff: Staff[];
  dateKey: string;
  requestedMinutes?: number;
  staffName?: string;
}): { reason: UnavailabilityReason; staffFullName?: string } {
  const { business, staff, dateKey, requestedMinutes, staffName } = params;
  const weekdayKey = weekdayKeyForDate(dateKey);
  const businessHours = business.working_hours[weekdayKey];

  if (business.closed_dates.includes(dateKey) || !businessHours) {
    return { reason: "closed_day" };
  }

  if (staffName) {
    const normalized = staffName.trim().toLowerCase();
    const person = staff.find((s) => s.full_name.toLowerCase().includes(normalized));
    if (person && (person.leave_dates?.includes(dateKey) || !person.working_hours?.[weekdayKey])) {
      return { reason: "staff_off", staffFullName: person.full_name };
    }
  }

  if (requestedMinutes !== undefined) {
    const [openMin, closeMin] = businessHours.map(parseTimeToMinutes);
    if (requestedMinutes < openMin || requestedMinutes >= closeMin) {
      return { reason: "outside_hours" };
    }
  }

  return { reason: "busy" };
}

export { dayRangeUtcISO as dayRangeUtcISOForDate, weekdayKeyForDate };
