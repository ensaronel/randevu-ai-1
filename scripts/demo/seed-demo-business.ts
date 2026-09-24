/**
 * Tanıtım (demo) hesabı için gerçekçi bir güzellik merkezi verisi üretir.
 *
 * DİKKAT: Bu betik işletmenin mevcut TÜM operasyonel verisini (randevu, müşteri, hizmet, personel, paket,
 * satış, gider, mesaj kaydı...) SİLER ve yerine sahte veri koyar. İşletme kaydı, sahip girişi, WhatsApp
 * bağlantısı, push abonelikleri ve ödemeler korunur. İstenirse (--backup) silmeden önce her şey demo-backups/
 * altına JSON olarak yedeklenir Sadece demo/test işletmesinde çalışır (ad kontrolü) ve --confirm ister.
 *
 * Çalıştırma:  npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/demo/seed-demo-business.ts --confirm
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  SERVICES,
  SERVICE_BY_KEY,
  STAFF,
  STAFF_BY_KEY,
  FEMALE_NAMES,
  MALE_NAMES,
  SURNAMES,
  CUSTOMER_NOTES,
  demoPhone,
  dayKeyOffset,
  localIso,
  makeRng,
  weekdayOf,
  workingHoursJson,
} from "./common";

const DEMO_BUSINESS_NAME = "Lavin Güzellik Merkezi";
const PAST_DAYS = 180;
const FUTURE_DAYS = 14;

const admin = createAdminSupabaseClient();
const rng = makeRng(20260924);

// ------------------------------------------------------------------------------------------ tipler

type Band = "morning" | "noon" | "afternoon" | "evening";

interface Persona {
  id: string;
  kind: string;
  name: string;
  phone: string;
  isSerif: boolean;
  notes: string | null;
  prefStaff: string | null;
  prefWeekday: number;
  band: Band;
  noShows: number;
  firstApptCreatedAt: string | null;
}

interface VisitReq {
  persona: Persona;
  day: number;
  svcs: string[];
  exact?: boolean;
  packageId?: string;
}

interface PlacedAppt {
  id: string;
  persona: Persona;
  dateKey: string;
  day: number;
  startMin: number;
  endMin: number;
  assignments: { svcKey: string; staffKey: string }[];
  packageId: string | null;
  status: string;
  attendance: string | null;
  source: string;
  createdAt: string;
  startsAt: string;
  endsAt: string;
}

interface PackagePlan {
  id: string;
  persona: Persona;
  svcKey: string;
  total: number;
  price: number;
  saleDay: number;
  interval: number;
  sellerKey: string;
  payment: "nakit" | "kart";
  sessionDays: number[];
}

// ------------------------------------------------------------------------------------------ yardımcılar

function fatal(message: string): never {
  console.error(`\nDURDU: ${message}`);
  process.exit(1);
}

async function fetchAllByBusiness<T>(table: string, businessId: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from(table).select("*").eq("business_id", businessId).order("id").range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function insertBatches(table: string, rows: Record<string, unknown>[], size = 400) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} eklenemedi: ${error.message}`);
  }
  console.log(`  + ${table}: ${rows.length}`);
}

async function wipe(table: string, businessId: string) {
  const { error, count } = await admin.from(table).delete({ count: "exact" }).eq("business_id", businessId);
  if (error) throw new Error(`${table} silinemedi: ${error.message}`);
  console.log(`  - ${table}: ${count ?? 0}`);
}

// ------------------------------------------------------------------------------------------ ana akış

async function main() {
  if (!process.argv.includes("--confirm")) {
    fatal("Bu betik işletmenin tüm verisini siler. Emin olduktan sonra --confirm ile çalıştır.");
  }

  const { data: businesses } = await admin.from("businesses").select("*");
  if (!businesses || businesses.length !== 1) fatal("Tam olarak BİR işletme bekleniyordu (güvenlik).");
  const business = businesses[0];
  if (!/güzellik/i.test(business.name)) fatal(`İşletme adı "${business.name}" bir demo/test güzellik işletmesi gibi görünmüyor.`);
  const businessId: string = business.id;
  console.log(`İşletme: ${business.name} (${businessId})`);

  const { data: serifRows } = await admin.from("customers").select("*").eq("business_id", businessId).eq("full_name", "Şerif");
  const serif = serifRows?.[0];
  if (!serif) fatal("Korunacak 'Şerif' müşteri kaydı bulunamadı.");
  const realPhone: string = serif.phone;
  console.log("Korunacak gerçek test müşterisi: Şerif");

  // ---------------------------------------------------------------------------------- yedek (isteğe bağlı: --backup)
  let backupFile: string | null = null;
  if (process.argv.includes("--backup")) {
  console.log("\n[1/4] Yedek alınıyor...");
  const backup: Record<string, unknown> = { takenAt: new Date().toISOString(), business };
  for (const table of [
    "staff",
    "services",
    "customers",
    "appointments",
    "customer_packages",
    "one_time_sales",
    "one_time_expenses",
    "fixed_expenses",
    "waitlist_entries",
    "action_objects",
    "whatsapp_message_log",
    "assistant_message_log",
    "daily_financial_summaries",
  ]) {
    backup[table] = await fetchAllByBusiness(table, businessId);
  }
  const apptIds = (backup.appointments as { id: string }[]).map((a) => a.id);
  const apptServices: unknown[] = [];
  for (let i = 0; i < apptIds.length; i += 200) {
    const { data } = await admin.from("appointment_services").select("*").in("appointment_id", apptIds.slice(i, i + 200));
    apptServices.push(...(data ?? []));
  }
  backup.appointment_services = apptServices;
  const staffIds = (backup.staff as { id: string }[]).map((s) => s.id);
  const { data: expertiseRows } = await admin.from("staff_service_expertise").select("*").in("staff_id", staffIds.length ? staffIds : ["00000000-0000-0000-0000-000000000000"]);
  backup.staff_service_expertise = expertiseRows ?? [];

  const backupDir = path.join(process.cwd(), "demo-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  backupFile = path.join(backupDir, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup));
  console.log(`  Yedek: ${backupFile}`);
  }

  // ---------------------------------------------------------------------------------- temizlik
  console.log("\n[2/4] Eski test verisi siliniyor...");
  await admin.from("customers").update({ preferred_staff_id: null, pending_busy_offer: null }).eq("id", serif.id);
  for (const table of ["whatsapp_message_log", "assistant_message_log", "action_objects", "waitlist_entries", "appointments"]) {
    await wipe(table, businessId);
  }
  for (const table of ["customer_packages", "one_time_sales", "one_time_expenses", "fixed_expenses", "daily_financial_summaries"]) {
    await wipe(table, businessId);
  }
  {
    const { error, count } = await admin.from("customers").delete({ count: "exact" }).eq("business_id", businessId).neq("id", serif.id);
    if (error) throw new Error(`customers silinemedi: ${error.message}`);
    console.log(`  - customers: ${count ?? 0} (Şerif korundu)`);
  }
  await wipe("staff", businessId);
  await wipe("services", businessId);

  // ---------------------------------------------------------------------------------- yeni veri
  console.log("\n[3/4] Yeni veri üretiliyor...");

  // ----- işletme
  await admin
    .from("businesses")
    .update({
      name: DEMO_BUSINESS_NAME,
      working_hours: workingHoursJson({ 1: [9, 19], 2: [9, 19], 3: [9, 19], 4: [9, 19], 5: [9, 19], 6: [9, 18] }),
      closed_dates: [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", businessId);

  // ----- personel ve hizmetler
  const staffId = new Map<string, string>();
  const serviceId = new Map<string, string>();
  const leaveDates = new Map<string, Set<string>>();
  const staffRows = STAFF.map((s) => {
    const id = randomUUID();
    staffId.set(s.key, id);
    const leaves = s.leaveOffsets.map((o) => dayKeyOffset(o));
    leaveDates.set(s.key, new Set(leaves));
    return {
      id,
      business_id: businessId,
      full_name: s.name,
      working_hours: workingHoursJson(s.hours),
      leave_dates: leaves,
      commission_rate: s.commissionRate,
      status: "active",
    };
  });
  await insertBatches("staff", staffRows);

  const serviceRows = SERVICES.map((s) => {
    const id = randomUUID();
    serviceId.set(s.key, id);
    return { id, business_id: businessId, name: s.name, duration_minutes: s.duration, price: s.price, category: s.category, status: "active" };
  });
  await insertBatches("services", serviceRows);
  await insertBatches(
    "staff_service_expertise",
    SERVICES.flatMap((s) => s.staff.map((st) => ({ staff_id: staffId.get(st)!, service_id: serviceId.get(s.key)! })))
  );

  // ----- müşteri kişilikleri
  const personas: Persona[] = [];
  const usedNames = new Set<string>();
  let phoneCounter = 1;
  const bands: Band[] = ["morning", "noon", "afternoon", "evening"];
  const bandWeights = [0.32, 0.22, 0.31, 0.15];
  const weekdayChoices = [1, 2, 3, 4, 5, 6];
  const weekdayWeights = [0.7, 0.45, 1.25, 1.1, 1.3, 1.9];
  const staffKeys = STAFF.map((s) => s.key);

  function uniqueName(): string {
    for (;;) {
      const first = rng.chance(0.07) ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES);
      const name = `${first} ${rng.pick(SURNAMES)}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
  }

  function makePersona(kind: string, overrides: Partial<Persona> = {}): Persona {
    const p: Persona = {
      id: randomUUID(),
      kind,
      name: overrides.name ?? uniqueName(),
      phone: overrides.phone ?? demoPhone(phoneCounter++),
      isSerif: false,
      notes: rng.chance(0.12) ? rng.pick(CUSTOMER_NOTES) : null,
      prefStaff: rng.chance(0.3) ? rng.pick(staffKeys) : null,
      prefWeekday: rng.weighted(weekdayChoices, weekdayWeights),
      band: rng.weighted(bands, bandWeights),
      noShows: 0,
      firstApptCreatedAt: null,
      ...overrides,
    };
    if (overrides.name) usedNames.add(overrides.name);
    personas.push(p);
    return p;
  }

  interface Routine {
    svcs: string[];
    every: number;
    w: number;
  }
  const ROUTINES: Routine[] = [
    { svcs: ["kesim"], every: 52, w: 3 },
    { svcs: ["fon"], every: 14, w: 2 },
    { svcs: ["boya"], every: 42, w: 3 },
    { svcs: ["rofle"], every: 105, w: 1 },
    { svcs: ["keratin"], every: 135, w: 1 },
    { svcs: ["kalici_oje"], every: 24, w: 3 },
    { svcs: ["manikur"], every: 18, w: 2 },
    { svcs: ["pedikur"], every: 32, w: 2 },
    { svcs: ["protez"], every: 26, w: 1 },
    { svcs: ["kas"], every: 24, w: 3 },
    { svcs: ["kirpik"], every: 48, w: 1 },
    { svcs: ["cilt"], every: 34, w: 2 },
    { svcs: ["boya", "kalici_oje"], every: 42, w: 1 },
    { svcs: ["kesim", "kas"], every: 52, w: 1 },
    { svcs: ["cilt", "kalici_oje"], every: 34, w: 1 },
    { svcs: ["lazer_koltuk"], every: 30, w: 3 },
    { svcs: ["lazer_bacak"], every: 32, w: 2 },
  ];

  function sampleRoutines(count: number, scale = 1): Routine[] {
    const picked: Routine[] = [];
    const usedKeys = new Set<string>();
    let guard = 0;
    while (picked.length < count && guard++ < 50) {
      const r = rng.weighted(ROUTINES, ROUTINES.map((x) => x.w));
      const key = r.svcs.join("+");
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      picked.push({ ...r, every: Math.max(10, Math.round(r.every * scale * rng.rand(0.9, 1.12))) });
    }
    return picked;
  }

  const visits: VisitReq[] = [];

  function routineVisits(p: Persona, r: Routine, from: number, to: number, exact = false) {
    let t = from + rng.int(0, r.every);
    while (t <= to) {
      visits.push({ persona: p, day: t, svcs: r.svcs, exact });
      t += Math.max(7, Math.round(r.every * rng.rand(0.86, 1.16)));
    }
  }

  // Sadık müşteriler: 2 rutin, dönem boyunca düzenli
  for (let i = 0; i < 80; i++) {
    const p = makePersona("loyal");
    for (const r of sampleRoutines(2, rng.rand(0.9, 1.1))) routineVisits(p, r, rng.int(-178, -150), FUTURE_DAYS);
  }
  // Düzenli müşteriler
  for (let i = 0; i < 170; i++) {
    const p = makePersona("regular");
    for (const r of sampleRoutines(rng.chance(0.35) ? 2 : 1, rng.rand(1.0, 1.5))) routineVisits(p, r, rng.int(-178, -100), FUTURE_DAYS);
  }
  // Ara sıra gelenler
  for (let i = 0; i < 130; i++) {
    const p = makePersona("occasional");
    for (const r of sampleRoutines(1, rng.rand(1.6, 2.6))) routineVisits(p, r, rng.int(-178, -60), FUTURE_DAYS);
  }
  // Tek seferlik
  for (let i = 0; i < 80; i++) {
    const p = makePersona("once");
    const r = rng.weighted(ROUTINES, ROUTINES.map((x) => x.w));
    visits.push({ persona: p, day: rng.int(-170, -1), svcs: r.svcs });
  }
  // Kaybolan düzenli müşteriler (45-150 gün önce bırakmış)
  for (let i = 0; i < 30; i++) {
    const p = makePersona("lost");
    const lastDay = -rng.int(48, 150);
    for (const r of sampleRoutines(rng.chance(0.4) ? 2 : 1, rng.rand(0.9, 1.3))) routineVisits(p, r, lastDay - rng.int(90, 150), lastDay);
  }
  // Yeni müşteriler (son 30 gün)
  for (let i = 0; i < 32; i++) {
    const p = makePersona("new");
    const first = -rng.int(1, 30);
    const [r] = sampleRoutines(1, rng.rand(0.8, 1.2));
    visits.push({ persona: p, day: first, svcs: r.svcs });
    if (rng.chance(0.4)) routineVisits(p, r, first + r.every, FUTURE_DAYS);
  }

  // ----- vitrin müşterileri (demoda gösterilecek senaryolar)
  function exactRoutine(p: Persona, svcs: string[], every: number, lastDay: number, count: number, extraFuture: number[] = []) {
    for (let k = 0; k < count; k++) visits.push({ persona: p, day: lastDay - k * every, svcs, exact: true });
    for (const d of extraFuture) visits.push({ persona: p, day: d, svcs, exact: true });
  }

  const gizem = makePersona("showcase-risk", { name: "Gizem Arslan", phone: `+${realPhone}`, notes: "Kalıcı oje sever, Buse Hanım'ı tercih ediyor.", prefStaff: "buse" });
  exactRoutine(gizem, ["kalici_oje"], 21, -58, 7);
  const riskFake1 = makePersona("showcase-risk", { name: "Zeynep Aksoy" });
  exactRoutine(riskFake1, ["kas"], 24, -61, 6);
  const riskFake2 = makePersona("showcase-risk", { name: "Nilay Çakır" });
  exactRoutine(riskFake2, ["manikur"], 20, -50, 7);
  const rhythm1 = makePersona("showcase-rhythm", { name: "Pınar Yalçın" });
  exactRoutine(rhythm1, ["kalici_oje"], 28, -26, 6);
  const rhythm2 = makePersona("showcase-rhythm", { name: "Hande Koç" });
  exactRoutine(rhythm2, ["manikur"], 14, -12, 9);

  // Şerif: sahibin kendi numarası (mevcut kayıt korunur) — düzenli müşteri, yaklaşan randevusu ve paketi var
  const serifPersona: Persona = {
    id: serif.id,
    kind: "serif",
    name: "Şerif",
    phone: realPhone,
    isSerif: true,
    notes: null,
    prefStaff: null,
    prefWeekday: 5,
    band: "afternoon",
    noShows: 0,
    firstApptCreatedAt: null,
  };
  personas.push(serifPersona);
  exactRoutine(serifPersona, ["manikur"], 18, -5, 6, [13]);
  exactRoutine(serifPersona, ["kas"], 24, -22, 3, [2]);

  // ----- paketler
  const packages: PackagePlan[] = [];
  const sellerFor = (svcKey: string) => (svcKey.startsWith("lazer") ? "aysegul" : "selin");

  function planPackage(p: Persona, svcKey: string, total: number, price: number, saleDay: number, interval: number, opts: { idleAfter?: number } = {}) {
    const days: number[] = [];
    let d = saleDay + rng.int(1, 5);
    while (days.length < total && d <= FUTURE_DAYS) {
      days.push(d);
      d += interval + rng.int(0, 6);
      if (opts.idleAfter !== undefined && days.length >= opts.idleAfter) break;
    }
    packages.push({
      id: randomUUID(),
      persona: p,
      svcKey,
      total,
      price,
      saleDay,
      interval,
      sellerKey: sellerFor(svcKey),
      payment: rng.chance(0.6) ? "kart" : "nakit",
      sessionDays: days,
    });
  }

  const packageCustomers = rng.weightedOrder(
    personas.filter((p) => p.kind === "loyal" || p.kind === "regular"),
    () => 1
  );
  let pcIdx = 0;
  const lazerOptions: [string, number][] = [
    ["lazer_bacak", 5900],
    ["lazer_vucut", 13500],
    ["lazer_koltuk", 1900],
  ];
  for (let i = 0; i < 14; i++) {
    const [svc, price] = rng.weighted(lazerOptions, [0.6, 0.25, 0.15]);
    const idle = i >= 11; // 3 paket: birkaç seanstan sonra unutulmuş
    const recent = i < 3; // 3 paket son 3 haftada satılmış
    planPackage(
      packageCustomers[pcIdx++],
      svc,
      6,
      price,
      idle ? -rng.int(120, 150) : recent ? -rng.int(2, 24) : -rng.int(30, 170),
      28,
      idle ? { idleAfter: 2 } : {}
    );
  }
  for (let i = 0; i < 6; i++) planPackage(packageCustomers[pcIdx++], "cilt", 5, 5600, -rng.int(20, 150), 30);
  // Şerif'in paketi: 6 seanslık tüm bacak, 2 seans kullanılmış
  planPackage(serifPersona, "lazer_bacak", 6, 5900, -38, 28, { idleAfter: 2 });
  {
    const sp = packages[packages.length - 1];
    sp.sessionDays = [-36, -8];
  }
  for (const pk of packages) {
    for (const day of pk.sessionDays) {
      if (day >= 1 && !rng.chance(0.85)) continue;
      visits.push({ persona: pk.persona, day, svcs: [pk.svcKey], packageId: pk.id, exact: pk.persona.isSerif });
    }
  }

  // ------------------------------------------------------------------------------------ planlama
  const busy = new Map<string, [number, number][]>();
  const placed: PlacedAppt[] = [];

  function isOpenDay(dateKey: string): boolean {
    return weekdayOf(dateKey) !== 0;
  }

  function staffFree(staffKey: string, dateKey: string, start: number, end: number): boolean {
    const def = STAFF_BY_KEY.get(staffKey)!;
    const hours = def.hours[weekdayOf(dateKey)];
    if (!hours) return false;
    if (start < hours[0] * 60 || end > hours[1] * 60) return false;
    if (leaveDates.get(staffKey)?.has(dateKey)) return false;
    const list = busy.get(`${dateKey}|${staffKey}`) ?? [];
    return !list.some(([s, e]) => start < e && end > s);
  }

  function assign(dateKey: string, start: number, svcKeys: string[], prefStaff: string | null) {
    const used = new Set<string>();
    const result: { svcKey: string; staffKey: string }[] = [];
    const ordered = [...svcKeys].sort((a, b) => SERVICE_BY_KEY.get(b)!.duration - SERVICE_BY_KEY.get(a)!.duration);
    for (const key of ordered) {
      const def = SERVICE_BY_KEY.get(key)!;
      const end = start + def.duration;
      const candidates = def.staff.filter((st) => !used.has(st) && staffFree(st, dateKey, start, end));
      if (candidates.length === 0) return null;
      let chosen = candidates[0];
      if (candidates.length > 1) {
        chosen = prefStaff && candidates.includes(prefStaff) && rng.chance(0.6) ? prefStaff : rng.weighted(candidates, candidates.map((_, i) => (i === 0 ? 0.65 : 0.35 / (candidates.length - 1))));
      }
      used.add(chosen);
      result.push({ svcKey: key, staffKey: chosen });
    }
    return result;
  }

  function hourWeight(hour: number, band: Band, wd: number): number {
    const inBand = band === "morning" ? hour < 12 : band === "noon" ? hour >= 12 && hour < 14 : band === "afternoon" ? hour >= 14 && hour < 17 : hour >= 17;
    let w = inBand ? 4 : 1;
    if (wd === 2 && hour >= 13 && hour < 17) w *= 0.2; // Salı öğleden sonra boş kalsın
    if (wd === 1 && hour < 12) w *= 0.35; // Pazartesi sabahı sakin
    return w;
  }

  function tryPlace(v: VisitReq, day: number): PlacedAppt | null {
    const dateKey = dayKeyOffset(day);
    if (!isOpenDay(dateKey)) return null;
    const maxDur = Math.max(...v.svcs.map((k) => SERVICE_BY_KEY.get(k)!.duration));
    const wd = weekdayOf(dateKey);
    const hours = rng.weightedOrder([9, 10, 11, 12, 13, 14, 15, 16, 17, 18], (h) => hourWeight(h, v.persona.band, wd));
    for (const h of hours) {
      const start = h * 60;
      const assignment = assign(dateKey, start, v.svcs, v.persona.prefStaff);
      if (!assignment) continue;
      for (const a of assignment) {
        const dur = SERVICE_BY_KEY.get(a.svcKey)!.duration;
        const key = `${dateKey}|${a.staffKey}`;
        busy.set(key, [...(busy.get(key) ?? []), [start, start + dur]]);
      }
      return {
        id: randomUUID(),
        persona: v.persona,
        dateKey,
        day,
        startMin: start,
        endMin: start + maxDur,
        assignments: assignment,
        packageId: v.packageId ?? null,
        status: "scheduled",
        attendance: null,
        source: "manual",
        createdAt: "",
        startsAt: localIso(dateKey, start),
        endsAt: localIso(dateKey, start + maxDur),
      };
    }
    return null;
  }

  function snapDay(p: Persona, day: number): number {
    let d = day;
    if (rng.chance(0.62)) {
      for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
        if (weekdayOf(dayKeyOffset(d + delta)) === p.prefWeekday) {
          d += delta;
          break;
        }
      }
    }
    return d;
  }

  const inWindow = (d: number) => (d >= -PAST_DAYS && d <= -1) || (d >= 1 && d <= FUTURE_DAYS);

  const byDay = new Map<number, VisitReq[]>();
  for (const v of visits) {
    let day = v.exact ? v.day : snapDay(v.persona, v.day);
    if (day >= 1 && !v.exact && !rng.chance(Math.max(0.25, 0.92 - 0.045 * day))) continue; // ileri tarihe az randevu alınır
    if (!inWindow(day)) {
      if (weekdayOf(dayKeyOffset(day)) === 0) day += 1;
      if (!inWindow(day)) continue;
    }
    byDay.set(day, [...(byDay.get(day) ?? []), { ...v, day }]);
  }

  const sortedDays = [...byDay.keys()].sort((a, b) => a - b);
  let dropped = 0;
  for (const day of sortedDays) {
    const list = byDay.get(day)!;
    // vitrin/sabit randevular önce yer bulsun
    list.sort((a, b) => Number(!!b.exact) - Number(!!a.exact) || rng.next() - 0.5);
    for (const v of list) {
      const attempts = v.exact ? [day, day + 1, day - 1] : [day, day + 1, day - 1, day + 2, day - 2];
      let ok: PlacedAppt | null = null;
      for (const d of attempts) {
        if (!inWindow(d)) continue;
        if (day <= -1 && d > -1) continue;
        if (day >= 1 && d < 1) continue;
        ok = tryPlace(v, d);
        if (ok) break;
      }
      if (ok) placed.push(ok);
      else dropped++;
    }
  }
  console.log(`  Planlama: ${placed.length} randevu yerleşti, ${dropped} sığmadı (atlandı).`);

  // ------------------------------------------------------------------------------------ sonuç/durum
  const nowMs = Date.now();
  for (const a of placed) {
    const wd = weekdayOf(a.dateKey);
    a.source = rng.weighted(["whatsapp_ai", "manual", "phone_ai"], [0.55, 0.32, 0.13]);
    if (a.day >= 1) {
      a.status = rng.chance(0.05) ? "cancelled" : rng.chance(0.4) ? "confirmed" : "scheduled";
      a.createdAt = new Date(nowMs - rng.int(1, 72) * 3600_000).toISOString();
    } else {
      const cancelP = wd === 5 ? 0.19 : 0.065; // Cuma günleri iptal oranı yüksek
      // Paket seansları iptal olursa gerçek hayatta yeniden planlanır; veride telafi seansı üretmediğimiz için
      // geçmiş paket seansları hep gerçekleşmiş sayılır (paketler doğal şekilde tamamlanabilsin).
      if (a.packageId) {
        a.status = "completed";
        a.attendance = "came";
      } else if (rng.chance(cancelP)) a.status = "cancelled";
      else if (rng.chance(0.04)) {
        a.status = "scheduled";
        a.attendance = rng.chance(0.6) ? "no_show_silent" : "no_show_notified";
        a.persona.noShows++;
      } else {
        a.status = "completed";
        a.attendance = rng.chance(0.82) ? "came" : null;
      }
      const leadDays = rng.weighted([0, 1, 2, 3, 5, 7, 10], [0.08, 0.18, 0.2, 0.16, 0.16, 0.14, 0.08]);
      a.createdAt = new Date(new Date(a.startsAt).getTime() - leadDays * 86400_000 - rng.int(1, 5) * 3600_000).toISOString();
    }
    if (!a.persona.firstApptCreatedAt || a.createdAt < a.persona.firstApptCreatedAt) a.persona.firstApptCreatedAt = a.createdAt;
  }

  // ------------------------------------------------------------------------------------ satırları kur
  const packageIdSet = new Set(packages.map((p) => p.id));
  const apptRows: Record<string, unknown>[] = [];
  const apptServiceRows: Record<string, unknown>[] = [];
  for (const a of placed) {
    const isFuture = a.day >= 1;
    const isFake = !a.persona.isSerif && a.persona.phone !== `+${realPhone}`;
    apptRows.push({
      id: a.id,
      business_id: businessId,
      customer_id: a.persona.id,
      starts_at: a.startsAt,
      ends_at: a.endsAt,
      status: a.status,
      attendance: a.attendance,
      source: a.source,
      // Sahte müşterilerin ileri tarihli randevuları için hatırlatma gitmiş sayılır (boşuna denenmesin);
      // gerçek numaralar (Şerif) gerçek hatırlatma alır.
      reminder_24h_sent_at: isFuture && isFake ? new Date().toISOString() : null,
      reminder_1h_sent_at: isFuture && isFake ? new Date().toISOString() : null,
      created_at: a.createdAt,
      updated_at: a.createdAt,
    });
    for (const asg of a.assignments) {
      const def = SERVICE_BY_KEY.get(asg.svcKey)!;
      const isPackage = a.packageId !== null && packageIdSet.has(a.packageId);
      const realized = a.status === "completed" && a.day <= -1;
      let finalPrice: number | null = null;
      let note: string | null = null;
      if (!isPackage && realized && rng.chance(0.12)) {
        if (rng.chance(0.55)) {
          finalPrice = Math.round((def.price * 0.9) / 10) * 10;
          note = "%10 sadakat indirimi";
        } else if (def.category === "Tırnak") {
          finalPrice = def.price + 100;
          note = "Ek: tırnak tasarımı (+100 TL)";
        }
      }
      apptServiceRows.push({
        id: randomUUID(),
        appointment_id: a.id,
        service_id: serviceId.get(asg.svcKey)!,
        staff_id: staffId.get(asg.staffKey)!,
        planned_price: isPackage ? 0 : def.price,
        final_price: finalPrice,
        adjustment_note: note,
        commission_rate_snapshot: STAFF_BY_KEY.get(asg.staffKey)!.commissionRate,
        payment_method: realized && !isPackage ? (rng.chance(0.55) ? "kart" : "nakit") : null,
        customer_package_id: a.packageId,
        created_at: a.createdAt,
      });
    }
  }

  const packageRows = packages.map((pk) => ({
    id: pk.id,
    business_id: businessId,
    customer_id: pk.persona.id,
    service_id: serviceId.get(pk.svcKey)!,
    total_sessions: pk.total,
    price: pk.price,
    sale_date: dayKeyOffset(pk.saleDay),
    staff_id: staffId.get(pk.sellerKey)!,
    commission_rate_snapshot: STAFF_BY_KEY.get(pk.sellerKey)!.commissionRate,
    payment_method: pk.payment,
    interval_days: pk.svcKey.startsWith("lazer") ? 28 : 30,
    created_at: new Date(new Date(localIso(dayKeyOffset(pk.saleDay), 12 * 60)).getTime()).toISOString(),
  }));

  // müşteri satırları
  const nowIso = new Date().toISOString();
  const customerRows = personas
    .filter((p) => !p.isSerif)
    .map((p) => {
      const created = p.firstApptCreatedAt ? new Date(new Date(p.firstApptCreatedAt).getTime() - 3600_000).toISOString() : nowIso;
      return {
        id: p.id,
        business_id: businessId,
        full_name: p.name,
        phone: p.phone,
        notes: p.notes,
        preferred_staff_id: p.prefStaff ? staffId.get(p.prefStaff)! : null,
        kvkk_consent_at: created,
        no_show_count: p.noShows,
        status: "active",
        created_at: created,
        updated_at: created,
      };
    });
  // Hiç randevusu yerleşmeyen müşterileri at; ama paketi/vitrin kaydı olanlar (başka tablolardan referans
  // alınanlar) mutlaka kalır, yoksa yabancı anahtar hatası olur.
  const withAppts = new Set(placed.map((a) => a.persona.id));
  const mustKeep = new Set<string>([...packages.map((p) => p.persona.id), gizem.id, riskFake1.id, riskFake2.id, rhythm1.id, rhythm2.id]);
  const finalCustomerRows = customerRows.filter((c) => withAppts.has(c.id as string) || mustKeep.has(c.id as string));

  // ------------------------------------------------------------------------------------ ürün satışları
  const products: [string, number][] = [
    ["Şampuan (Kerastase)", 650],
    ["Saç Maskesi", 480],
    ["Saç Serumu", 720],
    ["Isı Koruyucu Sprey", 390],
    ["El Kremi", 260],
    ["Tırnak Bakım Yağı", 180],
    ["Yüz Temizleme Jeli", 420],
    ["Nemlendirici Krem", 890],
    ["Güneş Kremi SPF50", 760],
    ["Kirpik Serumu", 950],
    ["Boyalı Saç Şampuanı", 560],
  ];
  const saleRows: Record<string, unknown>[] = [];
  for (let day = -PAST_DAYS; day <= -1; day++) {
    const dateKey = dayKeyOffset(day);
    if (!isOpenDay(dateKey)) continue;
    const count = rng.weighted([0, 1, 2, 3], [0.38, 0.4, 0.17, 0.05]);
    for (let i = 0; i < count; i++) {
      const [desc, price] = rng.pick(products);
      const seller = rng.weighted(staffKeys, [0.3, 0.15, 0.25, 0.2, 0.1]);
      saleRows.push({
        business_id: businessId,
        sale_date: dateKey,
        description: desc,
        amount: price,
        staff_id: staffId.get(seller)!,
        commission_rate_snapshot: STAFF_BY_KEY.get(seller)!.commissionRate,
        payment_method: rng.chance(0.5) ? "kart" : "nakit",
        created_at: localIso(dateKey, rng.int(10 * 60, 18 * 60)),
      });
    }
  }

  // ------------------------------------------------------------------------------------ giderler
  const fixedExpenses = [
    ["Kira", 45000, "kira"],
    ["Elektrik", 4200, "fatura"],
    ["Su", 1100, "fatura"],
    ["Doğalgaz", 2800, "fatura"],
    ["İnternet ve telefon", 1300, "fatura"],
    ["Malzeme (boya, oje, sarf)", 42000, "malzeme"],
    ["Personel sabit maaş ve SGK", 95000, "diger"],
    ["Muhasebe", 4000, "diger"],
    ["Reklam ve sosyal medya", 6000, "diger"],
    ["Temizlik", 3500, "diger"],
  ] as const;
  const oneTimeExpenses: [number, string, number, string][] = [
    [-150, "Yeni bekleme koltukları", 22000, "diger"],
    [-122, "Klima bakım ve gaz dolumu", 6500, "bakim"],
    [-95, "Lazer cihazı yıllık bakımı", 18500, "bakim"],
    [-70, "Sosyal medya fotoğraf ve video çekimi", 8000, "diger"],
    [-48, "Profesyonel boya malzemesi toplu alım", 15000, "malzeme"],
    [-33, "Tabela aydınlatma tamiri", 3200, "bakim"],
    [-15, "Su tesisatı tamiri", 2400, "bakim"],
    [-6, "Yeni el aleti seti (makas, fön makinesi)", 9800, "diger"],
  ];

  // ------------------------------------------------------------------------------------ bekleme listesi, öneriler, geri bildirim
  const fakeRegulars = personas.filter((p) => p.kind === "regular" && withAppts.has(p.id));
  const waitlistRows = [0, 1, 2].map((i) => ({
    business_id: businessId,
    customer_id: fakeRegulars[i].id,
    desired_service_id: serviceId.get(i === 1 ? "boya" : "kesim")!,
    desired_time_range: { from: "14:00", to: "18:00", days: ["sat"] },
    status: "open",
    created_at: new Date(nowMs - (i + 1) * 26 * 3600_000).toISOString(),
  }));

  const actionRows: Record<string, unknown>[] = [];
  const riskCard = (p: Persona, avg: number, since: number) => ({
    business_id: businessId,
    type: "retention_risk",
    related_customer_id: p.id,
    suggestion: "İndirimsiz, kişisel bir hatırlatma mesajı göndermeyi düşünebilirsin — uzun süredir gelmiyor.",
    customer_message: `Merhaba ${p.name}, sizi bir süredir aramızda göremedik — nasılsınız? Ne zaman isterseniz buradayız 🙂`,
    reasoning: `Ortalama ziyaret aralığı ~${avg} gün, son ziyaretten bu yana ${since} gün geçti.`,
    status: "pending",
    whatsapp_template_name: "musteri_ozlem_hatirlatma",
    whatsapp_template_params: [p.name],
    created_at: new Date(nowMs - 3600_000).toISOString(),
  });
  actionRows.push(riskCard(gizem, 21, 58), riskCard(riskFake1, 24, 61), riskCard(riskFake2, 20, 50));
  const rhythmCard = (p: Persona, avg: number, due: number) => ({
    business_id: businessId,
    type: "rhythm_invite",
    related_customer_id: p.id,
    suggestion: "Alışılmış randevu zamanı yaklaşıyor — indirimsiz, kişisel bir davet göndermeyi düşünebilirsin.",
    customer_message: `Merhaba ${p.name}, genelde ~${avg} günde bir bizi tercih ediyorsunuz — tekrar bir randevu ayarlamak ister misiniz?`,
    reasoning: `Son 3 ziyaret aynı hizmet kombinasyonuyla, ~${avg} günlük düzenli ritimde. Ritim ${due} gün içinde doluyor.`,
    status: "pending",
    whatsapp_template_name: "_randevu_ritim_davet",
    whatsapp_template_params: [p.name, String(avg)],
    created_at: new Date(nowMs - 3600_000).toISOString(),
  });
  actionRows.push(rhythmCard(rhythm1, 28, 2), rhythmCard(rhythm2, 14, 2));

  const feedbackTexts = [
    "Elif Hanım çok ilgiliydi, saçım tam istediğim gibi oldu. Teşekkürler!",
    "Randevu saatinde başladık, çok memnun kaldım.",
    "Bekleme süresi biraz uzadı ama sonuç harikaydı.",
    "Manikür çok temiz ve kalıcı, Buse Hanım'a teşekkürler.",
    "Salon çok temiz ve kokusu güzel, tavsiye ederim.",
    "Fiyatlar biraz yüksek ama hizmet kalitesi karşılığını veriyor.",
    "Cilt bakımından sonra cildim çok yumuşadı.",
    "Cumartesi günleri çok kalabalık oluyor, randevu bulmak zor.",
    "Lazer seansı sonrası bilgilendirme çok iyiydi.",
  ];
  const feedbackCustomers = rng.weightedOrder(fakeRegulars, () => 1).slice(0, feedbackTexts.length);
  feedbackTexts.forEach((text, i) => {
    const at = new Date(nowMs - rng.int(1, 20) * 86400_000).toISOString();
    actionRows.push({
      business_id: businessId,
      type: "survey_feedback",
      related_customer_id: feedbackCustomers[i].id,
      suggestion: "Müşteri anket geri bildirimi",
      reasoning: text,
      status: "auto_sent",
      created_at: at,
      resolved_at: at,
    });
  });

  // ------------------------------------------------------------------------------------ WhatsApp konuşma kayıtları (son 30 gün)
  const WEEKDAY_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  const logRows: Record<string, unknown>[] = [];
  const thirtyDaysAgo = nowMs - 30 * 86400_000;
  for (const a of placed) {
    if (a.source !== "whatsapp_ai" || a.persona.isSerif || a.persona.phone.startsWith("+")) continue;
    const t0 = new Date(a.createdAt).getTime();
    if (t0 < thirtyDaysAgo || t0 > nowMs) continue;
    const svc = SERVICE_BY_KEY.get(a.assignments[0].svcKey)!;
    const staffName = STAFF_BY_KEY.get(a.assignments[0].staffKey)!.name;
    const dayLabel = WEEKDAY_TR[weekdayOf(a.dateKey)];
    const hour = hhmm(a.startMin);
    const first = a.persona.name.split(" ")[0];
    const steps: [string, string][] = [
      ["inbound", `Merhaba, ${svc.name.toLowerCase()} için randevu almak istiyorum`],
      ["outbound", `Merhaba ${first}! ${svc.name} için hangi gün ve saatte müsaitsin?`],
      ["inbound", `${dayLabel} ${hour} olur mu?`],
      ["outbound", `${dayLabel} saat ${hour} için ${staffName} müsait. Bu şekilde onaylıyor musun?`],
      ["inbound", "Evet"],
      ["outbound", `Randevun oluşturuldu ✅ ${dayLabel} ${hour} - ${svc.name} (${staffName})`],
    ];
    steps.forEach(([direction, body], i) => {
      logRows.push({
        business_id: businessId,
        customer_id: a.persona.id,
        direction,
        message_type: "freeform",
        body,
        ai_confidence: direction === "outbound" ? 1 : null,
        escalated: false,
        created_at: new Date(t0 + i * 40_000).toISOString(),
      });
    });
  }
  for (let i = 0; i < 5; i++) {
    const p = rng.pick(fakeRegulars);
    const t = nowMs - rng.int(1, 28) * 86400_000;
    logRows.push(
      { business_id: businessId, customer_id: p.id, direction: "inbound", message_type: "freeform", body: rng.pick(["Fiyat konusunda pazarlık yapabilir miyiz?", "Geçen seferki işlemden memnun kalmadım", "İade almak istiyorum"]), escalated: false, created_at: new Date(t).toISOString() },
      { business_id: businessId, customer_id: p.id, direction: "outbound", message_type: "freeform", body: "Şu an bu konuda size hemen yardımcı olamadım, ekibimiz en kısa sürede size dönüş yapacak. 🙏", ai_confidence: 0, escalated: true, created_at: new Date(t + 5000).toISOString() }
    );
  }

  // ------------------------------------------------------------------------------------ yazma
  console.log("\n[4/4] Veritabanına yazılıyor...");
  await admin
    .from("customers")
    .update({
      created_at: serifPersona.firstApptCreatedAt ? new Date(new Date(serifPersona.firstApptCreatedAt).getTime() - 3600_000).toISOString() : nowIso,
      no_show_count: 0,
      notes: null,
      preferred_staff_id: null,
      pending_busy_offer: null,
    })
    .eq("id", serif.id);
  await insertBatches("customers", finalCustomerRows);
  await insertBatches("customer_packages", packageRows);
  await insertBatches("appointments", apptRows);
  await insertBatches("appointment_services", apptServiceRows);
  await insertBatches("one_time_sales", saleRows);
  await insertBatches(
    "fixed_expenses",
    fixedExpenses.map(([description, monthly_amount, category]) => ({ business_id: businessId, description, monthly_amount, category }))
  );
  await insertBatches(
    "one_time_expenses",
    oneTimeExpenses.map(([offset, description, amount, category]) => ({ business_id: businessId, expense_date: dayKeyOffset(offset), description, amount, category }))
  );
  await insertBatches("waitlist_entries", waitlistRows);
  await insertBatches("action_objects", actionRows);
  await insertBatches("whatsapp_message_log", logRows);

  const past = placed.filter((a) => a.day <= -1);
  const future = placed.filter((a) => a.day >= 1);
  console.log(
    `\nTAMAM. Müşteri: ${finalCustomerRows.length + 1} | geçmiş randevu: ${past.length} | yaklaşan: ${future.length} | paket: ${packageRows.length} | ürün satışı: ${saleRows.length}`
  );
  if (backupFile) console.log(`Yedek dosyası: ${backupFile}`);
}

main().catch((err) => {
  console.error("\nHATA:", err instanceof Error ? err.message : err);
  process.exit(1);
});

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
