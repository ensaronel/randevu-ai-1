/**
 * Hızlı, deterministik, LLM'e HİÇ ihtiyaç duymayan kontroller — saniyeler içinde
 * çalışır, hep aynı sonucu verir. Bu dosyadaki her kontrol, bu oturumda canlı testte
 * yakalanan gerçek bir hatanın BİR DAHA SESSİZCE GERİ GELMEYECEĞİNİ garanti eder.
 * scenarios.ts/run.ts'teki LLM-tabanlı senaryolar daha geniş davranışı test eder ama
 * modelin kendisi olasılıksal olduğu için %100 tekrarlanabilir değildir — bu dosyadaki
 * kontroller ise saf kod mantığını test ettiği için HER ZAMAN aynı sonucu vermeli.
 */
import { loadBusinessContext } from "../../src/lib/ai/context.js";
import { findAvailableSlots, explainUnavailability } from "../../src/lib/ai/availability.js";
import { shouldBlockUnverifiedSlot, parseVerifiedSlotsFromResult } from "../../src/lib/ai/safetyGate.js";
import type { Business, Staff, Service, Appointment, AppointmentService } from "../../src/types/database.js";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}

/**
 * 2026-09-12'de canlı testte yakalandı: business/services/staff sorgusu sessizce
 * başarısız olup boş diziye düşüyor, AI'ya "hiç personel yok" gibi yanlış bir tablo
 * gidiyordu ("JWT issued at future" — bkz. context.ts'teki kod yorumu). Artık bu tür
 * bir hata sessizce yutulmamalı, loadBusinessContext fırlatmalı. Var olmayan bir
 * business_id ile bilerek "bulunamadı" hatası tetikleyip bunu doğruluyoruz.
 */
async function checkContextFailsLoudlyOnError(): Promise<void> {
  const fakeId = "00000000-0000-0000-0000-000000000000";
  try {
    const ctx = await loadBusinessContext(fakeId);
    // .single() olmayan business bulunamadığında da hata döner (PGRST116) - context.ts
    // bunu artık fırlatıyor olmalı. Eğer buraya kadar geldiyse (hata fırlatılmadıysa)
    // ve boş/geçersiz bir context sessizce döndüyse, bu tam da önlemek istediğimiz hata.
    record(
      "context: sorgu hatasında sessizce boş veri döndürmüyor",
      false,
      `Beklenen: hata fırlatılmalıydı. Gerçekleşen: sessizce döndü — business=${JSON.stringify(ctx.business)}`
    );
  } catch {
    record("context: sorgu hatasında sessizce boş veri döndürmüyor", true, "beklendiği gibi hata fırlattı");
  }
}

const DAY_KEY = "2026-09-14"; // pazartesi, hem business hem her iki personel açık

function fixtureBusiness(): Business {
  return {
    id: "test-biz",
    name: "Test Kuaför",
    timezone: "Europe/Istanbul",
    whatsapp_phone_number_id: null,
    working_hours: { mon: ["09:00", "19:00"] } as Record<string, [string, string]>,
    closed_dates: [],
    is_active: true,
    package: "whatsapp_and_voice",
    subscription_status: "active",
    voice_number_mode: null,
    business_own_number: null,
    twilio_number: null,
    twilio_number_sid: null,
    whatsapp_twilio_number: null,
    whatsapp_twilio_number_sid: null,
    monthly_price_tl: null,
    next_payment_due_date: null,
    created_at: "",
    updated_at: "",
  };
}

function fixtureStaff(id: string, name: string): Staff {
  return {
    id,
    business_id: "test-biz",
    full_name: name,
    working_hours: { mon: ["09:00", "19:00"] } as Record<string, [string, string]>,
    leave_dates: [],
    commission_rate: 10,
    status: "active",
    created_at: "",
    updated_at: "",
  };
}

function fixtureService(): Service {
  return {
    id: "svc-1",
    business_id: "test-biz",
    name: "Saç Kesimi",
    duration_minutes: 30,
    price: 200,
    category: null,
    status: "active",
    created_at: "",
    updated_at: "",
  };
}

function fixtureAppointment(
  id: string,
  staffId: string,
  startsAtIso: string,
  endsAtIso: string
): Appointment & { appointment_services: AppointmentService[] } {
  return {
    id,
    business_id: "test-biz",
    customer_id: "cust-1",
    starts_at: startsAtIso,
    ends_at: endsAtIso,
    status: "scheduled",
    attendance: null,
    source: "manual",
    reminder_24h_sent_at: null,
    reminder_1h_sent_at: null,
    created_at: "",
    updated_at: "",
    appointment_services: [
      {
        id: `${id}-svc`,
        appointment_id: id,
        service_id: "svc-1",
        staff_id: staffId,
        planned_price: 200,
        final_price: null,
        adjustment_note: null,
        payment_method: null,
        created_at: "",
      },
    ],
  };
}

/**
 * Kullanıcının bizzat verdiği örnek senaryoyla doğrulandı (bu oturumda daha önce):
 * Mehmet 3 randevu, Ali 2 randevu, Ahmet 5 randevu ise → Ahmet en meşgul, Ali en boş,
 * o saatte ikisi de müsaitse önce Ali önerilmeli. Burada basitleştirilmiş 2 personelli
 * bir eşdeğeriyle test ediyoruz: Personel A hiç dolu değil, Personel B aynı saatte
 * başka bir randevu ile dolu (farklı bir slotta) — ikisi de hedef saatte müsaitken
 * toplam doluluğu daha AZ olan (A) önce önerilmeli.
 */
function checkLeastBusyStaffRecommendedFirst(): void {
  const staffA = fixtureStaff("staff-a", "Personel A (boş)");
  const staffB = fixtureStaff("staff-b", "Personel B (meşgul)");
  const service = fixtureService();

  // B için sabah 09:00-09:30 dolu (hedef saat 11:00 değil, ama toplam dolu dakikasını artırır).
  const busyApptForB = fixtureAppointment(
    "appt-1",
    "staff-b",
    "2026-09-14T06:00:00.000Z", // 09:00 TR
    "2026-09-14T06:30:00.000Z"
  );

  const slots = findAvailableSlots({
    business: fixtureBusiness(),
    requestedServices: [service],
    staff: [staffA, staffB],
    expertise: [],
    existingAppointments: [busyApptForB],
    dateKey: DAY_KEY,
    preferredStartMinutes: 11 * 60, // 11:00 - her iki personel de müsait
  });

  const chosen = slots[0]?.assignments[0]?.staffId;
  record(
    "availability: en boş personel önce öneriliyor",
    chosen === "staff-a",
    `beklenen=staff-a, gerçekleşen=${chosen ?? "(hiç sonuç yok)"}`
  );
}

/**
 * 2026-09-12'de canlı testte yakalandı: müşteri "yarın açık mısınız?" diye sorunca AI
 * hiç check_availability çağırmadan "evet açığız" dedi — oysa business o gün kapalıydı.
 * Bu, saf bir prompt kuralıyla (voicePrompt.ts madde 0) çözüldü, kod seviyesinde
 * garanti edilemez (serbest metin cevap). Burada en azından ALTTAKİ veri katmanının
 * kapalı bir günü doğru raporladığını doğruluyoruz — closed_dates içeren bir iş yerinde
 * findAvailableSlots boş dizi dönmeli.
 */
function checkClosedDayReturnsNoSlots(): void {
  const business = fixtureBusiness();
  business.closed_dates = ["2026-09-14"];
  const slots = findAvailableSlots({
    business,
    requestedServices: [fixtureService()],
    staff: [fixtureStaff("staff-a", "Personel A")],
    expertise: [],
    existingAppointments: [],
    dateKey: "2026-09-14",
    preferredStartMinutes: 11 * 60,
  });
  record(
    "availability: kapalı gün için gerçekten boş sonuç dönüyor",
    slots.length === 0,
    `beklenen=0 slot, gerçekleşen=${slots.length}`
  );
}

/**
 * Kullanıcının 2026-09-12'de açıkça belirttiği kural: "18.00 başlayan randevu 19.00'da
 * biter" — hizmetin ham süresi (burada 30 dk) ne olursa olsun, her randevu takvimde
 * TAM BİR SAAT kaplar, buçuklu/kesirli süre yok. Bunun doğal sonucu: bir personelin
 * mesaisi ne zaman biterse bitsin, o mesaiye sığan SON randevu her zaman
 * (mesai bitişi - 1 saat)'te başlar, mesai bitişinin KENDİSİNDE değil.
 */
function checkAppointmentAlwaysWholeHourBlock(): void {
  const staffA = fixtureStaff("staff-a", "Personel A");
  const service = fixtureService(); // 30 dk
  const slots = findAvailableSlots({
    business: fixtureBusiness(),
    requestedServices: [service],
    staff: [staffA],
    expertise: [],
    existingAppointments: [],
    dateKey: DAY_KEY,
    preferredStartMinutes: 11 * 60, // 11:00
  });
  const slot = slots.find((s) => s.isExactPreferredTime);
  const durationMin = slot ? (new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 60000 : -1;
  record(
    "availability: 30 dk'lık hizmet bile takvimde TAM 1 SAAT kaplıyor",
    durationMin === 60,
    `beklenen=60 dk, gerçekleşen=${durationMin} dk`
  );
}

/**
 * Aynı kuralın diğer yüzü: mesaisi 18:00'de biten bir personele, 18:00'de BAŞLAYAN bir
 * randevu ASLA önerilmemeli (18:00 + 1 saat = 19:00, mesaiyi aşar) — son önerilebilir
 * saat 17:00 olmalı. 2026-09-12'de canlı testte "Mehmet Usta saat 18:00'de boş" sanılan
 * karışıklığın kök nedeni tam bu: mesai bitişi = son randevunun BAŞLAYABİLECEĞİ saat
 * DEĞİL, personelin o saatte ARTIK MÜSAİT OLMADIĞI saattir.
 */
function checkLastSlotIsOneHourBeforeShiftEnd(): void {
  const staffA = fixtureStaff("staff-a", "Personel A (18:00'de mesaisi bitiyor)");
  staffA.working_hours = { mon: ["09:00", "18:00"] } as Record<string, [string, string]>;
  const slots = findAvailableSlots({
    business: fixtureBusiness(),
    requestedServices: [fixtureService()],
    staff: [staffA],
    expertise: [],
    existingAppointments: [],
    dateKey: DAY_KEY,
    preferredStartMinutes: 18 * 60, // tam 18:00 istendi
  });
  const offeredExactly18 = slots.some((s) => s.isExactPreferredTime);
  const last = slots[slots.length - 1];
  const lastHour = last ? new Date(new Date(last.startsAt).getTime() + 3 * 3600000).toISOString().slice(11, 16) : "(yok)";
  record(
    "availability: mesaisi 18:00'de biten personele 18:00'de randevu ÖNERİLMİYOR (son slot 17:00)",
    !offeredExactly18 && lastHour === "17:00",
    `18:00 teklif edildi mi=${offeredExactly18}, son önerilen saat=${lastHour} (beklenen: false / 17:00)`
  );
}

/**
 * 2026-09-12'de canlı testte yakalandı: müşteri "saat 3'te" (15:00) sordu ama o saat
 * BUGÜN için çoktan geçmişti. Kod, istenen saati sessizce "earliestAllowed"e (şu andan
 * sonraki en yakın tam saat) YUKARI kırpıp, o kırpılmış saati hâlâ "tam istediğiniz saat"
 * (isExactPreferredTime:true) sayıyordu — AI da "Evet, saat 15:00'te müsait" diyordu ama
 * gerçekte oluşturulacak randevu farklı bir saatteydi (17:00). Burada aynı senaryoyu,
 * "preferredStartMinutes açılıştan önce" (her zaman/gerçek saatten bağımsız olarak
 * earliestAllowed'ın altında kalacak) ile deterministik olarak yeniden üretiyoruz: dönen
 * ilk uygun saat, müşterinin GERÇEKTEN istediği saatle eşleşmediği için isExactPreferredTime
 * KESİNLİKLE false olmalı.
 */
function checkPastPreferredTimeNeverMarkedExact(): void {
  const staffA = fixtureStaff("staff-a", "Personel A");
  const slots = findAvailableSlots({
    business: fixtureBusiness(),
    requestedServices: [fixtureService()],
    staff: [staffA],
    expertise: [],
    existingAppointments: [],
    dateKey: DAY_KEY,
    preferredStartMinutes: 60, // 01:00 - işletme açılışından (09:00) önce, hep "geçmiş" sayılır
  });
  const wronglyMarkedExact = slots.some((s) => s.isExactPreferredTime);
  record(
    "availability: geçmiş/imkansız bir tercih saati ASLA 'tam istediğiniz saat' sayılmıyor",
    !wronglyMarkedExact,
    `beklenen=false, gerçekleşen=${wronglyMarkedExact} (dönen saatler: ${JSON.stringify(slots.map((s) => s.startsAt))})`
  );
}

/**
 * Kullanıcının 2026-09-12'de açıkça istediği kural: "müsait değil" gibi tek düze bir
 * cevap yerine GERÇEK sebep söylensin — dükkan o gün kapalıysa "kapalıyız", personel o
 * gün izinliyse "[personel] çalışmıyor", saat mesai dışındaysa "o saatte kapalıyız",
 * hiçbiri değilse gerçek meşguliyet ("busy"). Dört ayrı sebebi de tek tek doğruluyoruz.
 */
function checkUnavailabilityReasons(): void {
  const business = fixtureBusiness(); // mon: 09:00-19:00, sun: null (kapalı)
  const staffA = fixtureStaff("staff-a", "Ahmet Usta");
  staffA.working_hours = { mon: ["09:00", "19:00"] } as Record<string, [string, string]>;
  const staffOffToday = fixtureStaff("staff-b", "Mehmet Usta");
  staffOffToday.working_hours = { mon: null } as unknown as Record<string, [string, string]>;

  const closedDay = explainUnavailability({ business, staff: [staffA], dateKey: "2026-09-13" }); // pazar
  record(
    "unavailability: dükkanın kapalı olduğu gün 'closed_day' dönüyor",
    closedDay.reason === "closed_day",
    `beklenen=closed_day, gerçekleşen=${closedDay.reason}`
  );

  const staffOff = explainUnavailability({
    business,
    staff: [staffA, staffOffToday],
    dateKey: DAY_KEY, // pazartesi, business açık
    staffName: "Mehmet",
  });
  record(
    "unavailability: istenen personel o gün izinliyse 'staff_off' dönüyor",
    staffOff.reason === "staff_off" && staffOff.staffFullName === "Mehmet Usta",
    `beklenen=staff_off/Mehmet Usta, gerçekleşen=${staffOff.reason}/${staffOff.staffFullName}`
  );

  const outsideHours = explainUnavailability({
    business,
    staff: [staffA],
    dateKey: DAY_KEY,
    requestedMinutes: 20 * 60, // 20:00, business 19:00'da kapanıyor
  });
  record(
    "unavailability: mesai saatleri dışı bir saat 'outside_hours' dönüyor",
    outsideHours.reason === "outside_hours",
    `beklenen=outside_hours, gerçekleşen=${outsideHours.reason}`
  );

  const genuinelyBusy = explainUnavailability({
    business,
    staff: [staffA],
    dateKey: DAY_KEY,
    requestedMinutes: 11 * 60, // 11:00, mesai içi, personel izinli değil
  });
  record(
    "unavailability: hiçbir özel sebep yoksa 'busy' dönüyor",
    genuinelyBusy.reason === "busy",
    `beklenen=busy, gerçekleşen=${genuinelyBusy.reason}`
  );
}

/**
 * 2026-09-13'te canlı testte yakalandı: müşteri hizmet adını hiç söylemedi, üç
 * check_availability denemesi de doğru şekilde engellendi (shouldBlockAvailabilityCheck) —
 * ama model bunu görmezden gelip saat/personel UYDURUP create_appointment'ı GERÇEKTEN
 * çağırdı (o anki şans eseri o saat boştu, garanti değildi). shouldBlockUnverifiedSlot
 * bunu, önerilen saat/personel/hizmet kombinasyonunun GERÇEKTEN başarılı bir
 * check_availability sonucunda yer aldığını doğrulayarak önlemeli.
 */
function checkUnverifiedSlotIsBlocked(): void {
  // Hiç check_availability başarılı olmadı (verifiedSlots boş) - AI direkt create_appointment
  // çağırmaya çalışıyor, uydurma bir saat/personelle.
  const blockedWithNoVerification = shouldBlockUnverifiedSlot(
    "create_appointment",
    {
      startsAt: "2026-09-14T15:00:00.000Z",
      endsAt: "2026-09-14T16:00:00.000Z",
      assignments: [{ serviceName: "Saç Kesimi", staffName: "Ahmet Usta" }],
    },
    []
  );
  record(
    "safetyGate: hiç doğrulanmamış bir saat/personelle create_appointment engelleniyor",
    blockedWithNoVerification,
    `beklenen=true (engellenmeli), gerçekleşen=${blockedWithNoVerification}`
  );

  // check_availability GERÇEKTEN başarılı oldu ve TAM BU slotu döndürdü - engellenmemeli.
  const realResult = JSON.stringify({
    date: "2026-09-14",
    is_alternate_date: false,
    slots: [
      {
        starts_at: "2026-09-14T15:00:00.000Z",
        ends_at: "2026-09-14T16:00:00.000Z",
        display: "14 Eylül Pazartesi 18:00",
        assignments: [{ service_name: "Saç Kesimi", staff_name: "Ahmet Usta" }],
        is_exact_requested_time: true,
      },
    ],
  });
  const verified = parseVerifiedSlotsFromResult(realResult);
  const notBlockedWhenVerified = shouldBlockUnverifiedSlot(
    "create_appointment",
    {
      startsAt: "2026-09-14T15:00:00.000Z",
      endsAt: "2026-09-14T16:00:00.000Z",
      assignments: [{ serviceName: "Saç Kesimi", staffName: "Ahmet Usta" }],
    },
    verified
  );
  record(
    "safetyGate: GERÇEKTEN doğrulanmış bir saat/personelle create_appointment engellenmiyor",
    !notBlockedWhenVerified,
    `beklenen=false (engellenmemeli), gerçekleşen=${notBlockedWhenVerified}`
  );

  // Doğrulanmış slot BAŞKA bir personel için - farklı personelle uydurma engellenmeli.
  const blockedDifferentStaff = shouldBlockUnverifiedSlot(
    "create_appointment",
    {
      startsAt: "2026-09-14T15:00:00.000Z",
      endsAt: "2026-09-14T16:00:00.000Z",
      assignments: [{ serviceName: "Saç Kesimi", staffName: "Mehmet Usta" }],
    },
    verified
  );
  record(
    "safetyGate: doğrulanmış saatte AMA BAŞKA personelle create_appointment engelleniyor",
    blockedDifferentStaff,
    `beklenen=true (engellenmeli), gerçekleşen=${blockedDifferentStaff}`
  );
}

export async function runUnitChecks(): Promise<CheckResult[]> {
  await checkContextFailsLoudlyOnError();
  checkLeastBusyStaffRecommendedFirst();
  checkClosedDayReturnsNoSlots();
  checkAppointmentAlwaysWholeHourBlock();
  checkLastSlotIsOneHourBeforeShiftEnd();
  checkPastPreferredTimeNeverMarkedExact();
  checkUnavailabilityReasons();
  checkUnverifiedSlotIsBlocked();
  return results;
}
