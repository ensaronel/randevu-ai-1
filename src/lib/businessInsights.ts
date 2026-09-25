import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addDaysToKey, dateKeyFromIso, dateKeyRangeUtcISO, dateKeyTR, daysBetweenKeys } from "@/lib/date";
import { parseTimeToMinutes } from "@/lib/capacity";
import { isRealizedRevenue } from "@/lib/revenue";
import type { Business, CustomerPackage, Service, Staff } from "@/types/database";

/**
 * İşletmenin tüm verisini TEK seferde yükleyip (loadInsightsDataset) saf fonksiyonlarla
 * analiz eden ortak katman. Danışman araçları ve dashboard'daki Fırsat Radarı
 * HEP buradaki rakamları kullanır — AI rakam üretmez, sadece bu
 * (kodla hesaplanmış) gerçekleri yorumlar. Ciro kuralı uygulama genelindeki tek kuraldır
 * (bkz. revenue.ts): gerçekleşmiş randevular + ürün satışları + paket satışları (satış anında).
 */

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const WEEKDAY_LABELS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Pazartesi'den başlayan gösterim sırası (getUTCDay indeksleri). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface InsightApptService {
  service_id: string;
  staff_id: string;
  planned_price: number;
  final_price: number | null;
  commission_rate_snapshot: number | null;
  customer_package_id: string | null;
}

export interface InsightAppt {
  id: string;
  customer_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  attendance: string | null;
  appointment_services: InsightApptService[];
}

export interface InsightCustomer {
  id: string;
  full_name: string;
  created_at: string;
  no_show_count: number;
}

export interface InsightSale {
  sale_date: string;
  amount: number;
  staff_id: string | null;
  commission_rate_snapshot: number | null;
}

export interface InsightOneTimeExpense {
  expense_date: string;
  amount: number;
  category: string | null;
}

export interface InsightFixedExpense {
  description: string;
  monthly_amount: number;
  category: string | null;
}

export interface InsightDataset {
  business: Business;
  staff: Staff[];
  services: Service[];
  expertise: { staff_id: string; service_id: string }[];
  appointments: InsightAppt[];
  customers: InsightCustomer[];
  packages: CustomerPackage[];
  sales: InsightSale[];
  oneTimeExpenses: InsightOneTimeExpense[];
  fixedExpenses: InsightFixedExpense[];
  waitlistOpen: { desired_service_id: string | null }[];
  todayKey: string;
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadInsightsDataset(admin: AdminClient, businessId: string, lookbackDays = 365): Promise<InsightDataset> {
  const todayKey = dateKeyTR(0);
  const fromKey = addDaysToKey(todayKey, -lookbackDays);
  const toKey = addDaysToKey(todayKey, 30);
  const startUtc = dateKeyRangeUtcISO(fromKey, fromKey).startUtc;
  const endUtc = dateKeyRangeUtcISO(toKey, toKey).endUtc;

  const [businessRes, staff, services, appointments, customers, packages, sales, oneTimeExpenses, fixedExpenses, waitlistOpen] =
    await Promise.all([
      admin.from("businesses").select("*").eq("id", businessId).single(),
      fetchAll<Staff>((f, t) => admin.from("staff").select("*").eq("business_id", businessId).order("id").range(f, t)),
      fetchAll<Service>((f, t) => admin.from("services").select("*").eq("business_id", businessId).order("id").range(f, t)),
      fetchAll<InsightAppt>((f, t) =>
        admin
          .from("appointments")
          .select(
            "id, customer_id, starts_at, ends_at, status, attendance, appointment_services(service_id, staff_id, planned_price, final_price, commission_rate_snapshot, customer_package_id)"
          )
          .eq("business_id", businessId)
          .gte("starts_at", startUtc)
          .lte("starts_at", endUtc)
          .order("starts_at")
          .order("id")
          .range(f, t)
      ),
      fetchAll<InsightCustomer>((f, t) =>
        admin.from("customers").select("id, full_name, created_at, no_show_count").eq("business_id", businessId).order("id").range(f, t)
      ),
      fetchAll<CustomerPackage>((f, t) =>
        admin.from("customer_packages").select("*").eq("business_id", businessId).order("id").range(f, t)
      ),
      fetchAll<InsightSale>((f, t) =>
        admin
          .from("one_time_sales")
          .select("sale_date, amount, staff_id, commission_rate_snapshot")
          .eq("business_id", businessId)
          .gte("sale_date", fromKey)
          .order("id")
          .range(f, t)
      ),
      fetchAll<InsightOneTimeExpense>((f, t) =>
        admin
          .from("one_time_expenses")
          .select("expense_date, amount, category")
          .eq("business_id", businessId)
          .gte("expense_date", fromKey)
          .order("id")
          .range(f, t)
      ),
      fetchAll<InsightFixedExpense>((f, t) =>
        admin.from("fixed_expenses").select("description, monthly_amount, category").eq("business_id", businessId).order("id").range(f, t)
      ),
      fetchAll<{ desired_service_id: string | null }>((f, t) =>
        admin.from("waitlist_entries").select("desired_service_id").eq("business_id", businessId).eq("status", "open").order("id").range(f, t)
      ),
    ]);
  if (businessRes.error) throw new Error(businessRes.error.message);

  const staffIds = staff.map((s) => s.id);
  const expertise =
    staffIds.length > 0
      ? await fetchAll<{ staff_id: string; service_id: string }>((f, t) =>
          admin.from("staff_service_expertise").select("staff_id, service_id").in("staff_id", staffIds).order("staff_id").range(f, t)
        )
      : [];

  return {
    business: businessRes.data as Business,
    staff,
    services,
    expertise,
    appointments,
    customers,
    packages,
    sales,
    oneTimeExpenses,
    fixedExpenses,
    waitlistOpen,
    todayKey,
  };
}

// ---------------------------------------------------------------- yardımcılar

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function localParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + TURKEY_OFFSET_MS);
  return {
    dateKey: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function weekdayOfKey(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

function dateKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let k = from; k <= to; k = addDaysToKey(k, 1)) keys.push(k);
  return keys;
}

export function apptAmount(a: InsightAppt): number {
  return a.appointment_services.reduce((s, x) => s + num(x.final_price ?? x.planned_price), 0);
}

function isRealized(a: InsightAppt): boolean {
  return isRealizedRevenue(a.status, a.attendance, a.starts_at);
}

function isNoShow(a: InsightAppt): boolean {
  return a.attendance === "no_show_silent" || a.attendance === "no_show_notified";
}

function serviceDuration(ds: InsightDataset, serviceId: string): number {
  return ds.services.find((s) => s.id === serviceId)?.duration_minutes ?? 30;
}

/** Paketten karşılanan seansın "eşdeğer" değeri (paket fiyatı / seans sayısı) — sadece hizmet/kârlılık analizinde kullanılır, ciro toplamlarında DEĞİL. */
function packageSessionValues(ds: InsightDataset): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of ds.packages) map.set(p.id, p.total_sessions > 0 ? num(p.price) / p.total_sessions : 0);
  return map;
}

function svcValue(svc: InsightApptService, pkgValues: Map<string, number>): number {
  if (svc.customer_package_id && pkgValues.has(svc.customer_package_id)) return pkgValues.get(svc.customer_package_id)!;
  return num(svc.final_price ?? svc.planned_price);
}

function staffCapacityMinutes(ds: InsightDataset, staff: Staff, dateKey: string): number {
  if (ds.business.closed_dates?.includes(dateKey)) return 0;
  if (staff.leave_dates?.includes(dateKey)) return 0;
  const hours = staff.working_hours?.[WEEKDAY_KEYS[weekdayOfKey(dateKey)]];
  if (!hours) return 0;
  return Math.max(0, parseTimeToMinutes(hours[1]) - parseTimeToMinutes(hours[0]));
}

function capacityMinutes(ds: InsightDataset, dateKey: string): number {
  return ds.staff.filter((s) => s.status === "active").reduce((sum, s) => sum + staffCapacityMinutes(ds, s, dateKey), 0);
}

function inRange(key: string, from: string, to: string): boolean {
  return key >= from && key <= to;
}

// ---------------------------------------------------------------- ciro / kâr

export interface RevenueBreakdown {
  appointments: number;
  products: number;
  packages: number;
  total: number;
}

export function computeRevenue(ds: InsightDataset, from: string, to: string): RevenueBreakdown {
  let appointments = 0;
  for (const a of ds.appointments) {
    if (!inRange(dateKeyFromIso(a.starts_at), from, to)) continue;
    if (!isRealized(a)) continue;
    appointments += apptAmount(a);
  }
  const products = ds.sales.filter((s) => inRange(s.sale_date, from, to)).reduce((sum, s) => sum + num(s.amount), 0);
  const packages = ds.packages.filter((p) => inRange(p.sale_date, from, to)).reduce((sum, p) => sum + num(p.price), 0);
  return { appointments, products, packages, total: appointments + products + packages };
}

export interface ExpenseBreakdown {
  fixedShare: number;
  oneTime: number;
  total: number;
  byCategory: { category: string; amount: number }[];
}

export function computeExpenses(ds: InsightDataset, from: string, to: string): ExpenseBreakdown {
  const days = daysBetweenKeys(from, to);
  const byCategory = new Map<string, number>();
  let fixedShare = 0;
  for (const e of ds.fixedExpenses) {
    const share = (num(e.monthly_amount) / 30) * days;
    fixedShare += share;
    const cat = e.category ?? "diger";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + share);
  }
  let oneTime = 0;
  for (const e of ds.oneTimeExpenses) {
    if (!inRange(e.expense_date, from, to)) continue;
    oneTime += num(e.amount);
    const cat = e.category ?? "diger";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + num(e.amount));
  }
  return {
    fixedShare,
    oneTime,
    total: fixedShare + oneTime,
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export function computeCommissions(ds: InsightDataset, from: string, to: string): number {
  const rateOf = new Map(ds.staff.map((s) => [s.id, num(s.commission_rate)]));
  let total = 0;
  for (const a of ds.appointments) {
    if (!inRange(dateKeyFromIso(a.starts_at), from, to) || !isRealized(a)) continue;
    for (const svc of a.appointment_services) {
      const rate = svc.commission_rate_snapshot ?? rateOf.get(svc.staff_id) ?? 0;
      total += (num(svc.final_price ?? svc.planned_price) * num(rate)) / 100;
    }
  }
  for (const s of ds.sales) {
    if (!s.staff_id || !inRange(s.sale_date, from, to)) continue;
    total += (num(s.amount) * num(s.commission_rate_snapshot ?? rateOf.get(s.staff_id) ?? 0)) / 100;
  }
  for (const p of ds.packages) {
    if (!p.staff_id || !inRange(p.sale_date, from, to)) continue;
    total += (num(p.price) * num(p.commission_rate_snapshot ?? rateOf.get(p.staff_id) ?? 0)) / 100;
  }
  return total;
}

export interface ProfitSummary {
  from: string;
  to: string;
  revenue: RevenueBreakdown;
  expenses: ExpenseBreakdown;
  commissions: number;
  /** Kasa'daki "Net Kâr" ile aynı: ciro - (sabit gider payı + tek seferlik gider). */
  netProfit: number;
  /** Personel primleri de düşülmüş gerçek cebe kalan. */
  netAfterCommissions: number;
  marginPercent: number | null;
}

export function computeProfit(ds: InsightDataset, from: string, to: string): ProfitSummary {
  const revenue = computeRevenue(ds, from, to);
  const expenses = computeExpenses(ds, from, to);
  const commissions = computeCommissions(ds, from, to);
  const netProfit = revenue.total - expenses.total;
  return {
    from,
    to,
    revenue,
    expenses,
    commissions,
    netProfit,
    netAfterCommissions: netProfit - commissions,
    marginPercent: revenue.total > 0 ? (netProfit / revenue.total) * 100 : null,
  };
}

// ---------------------------------------------------------------- doluluk / zaman kalıpları

export function computeOccupancy(ds: InsightDataset, from: string, to: string) {
  let capacity = 0;
  for (const key of dateKeysBetween(from, to)) capacity += capacityMinutes(ds, key);
  let booked = 0;
  for (const a of ds.appointments) {
    if (a.status === "cancelled") continue;
    if (!inRange(dateKeyFromIso(a.starts_at), from, to)) continue;
    for (const svc of a.appointment_services) booked += serviceDuration(ds, svc.service_id);
  }
  return {
    capacityHours: round(capacity / 60, 1),
    bookedHours: round(booked / 60, 1),
    percent: capacity > 0 ? Math.round((booked / capacity) * 100) : null,
  };
}

export interface WeekdayPattern {
  weekday: number;
  label: string;
  openDays: number;
  occupancyPercent: number | null;
  avgAppointmentsPerDay: number;
  avgRevenuePerDay: number;
}

export function computeWeekdayPatterns(ds: InsightDataset, from: string, to: string): WeekdayPattern[] {
  const cap = new Array(7).fill(0);
  const booked = new Array(7).fill(0);
  const apptCount = new Array(7).fill(0);
  const revenue = new Array(7).fill(0);
  const openDays = new Array(7).fill(0);

  for (const key of dateKeysBetween(from, to)) {
    const c = capacityMinutes(ds, key);
    if (c <= 0) continue;
    const wd = weekdayOfKey(key);
    cap[wd] += c;
    openDays[wd] += 1;
  }
  for (const a of ds.appointments) {
    const key = dateKeyFromIso(a.starts_at);
    if (!inRange(key, from, to)) continue;
    const wd = weekdayOfKey(key);
    if (a.status !== "cancelled") {
      apptCount[wd] += 1;
      for (const svc of a.appointment_services) booked[wd] += serviceDuration(ds, svc.service_id);
    }
    if (isRealized(a)) revenue[wd] += apptAmount(a);
  }

  return WEEK_ORDER.filter((wd) => openDays[wd] > 0).map((wd) => ({
    weekday: wd,
    label: WEEKDAY_LABELS_TR[wd],
    openDays: openDays[wd],
    occupancyPercent: cap[wd] > 0 ? Math.round((booked[wd] / cap[wd]) * 100) : null,
    avgAppointmentsPerDay: round(apptCount[wd] / openDays[wd], 1),
    avgRevenuePerDay: Math.round(revenue[wd] / openDays[wd]),
  }));
}

function addOverlap(arr: number[], startMin: number, endMin: number) {
  if (endMin <= startMin) return;
  const firstHour = Math.max(0, Math.floor(startMin / 60));
  const lastHour = Math.min(23, Math.ceil(endMin / 60) - 1);
  for (let h = firstHour; h <= lastHour; h++) {
    const overlap = Math.min(endMin, (h + 1) * 60) - Math.max(startMin, h * 60);
    if (overlap > 0) arr[h] += overlap;
  }
}

export interface QuietBlock {
  weekday: number;
  weekdayLabel: string;
  startHour: number;
  endHour: number;
  fillPercent: number;
  freeHoursPerWeek: number;
}

/** Hafta günü x saat ızgarasında, çalışma saatleri içinde doluluk oranı düşük ardışık saat blokları — boş slot kampanyasının hedefi. */
export function computeQuietBlocks(ds: InsightDataset, from: string, to: string, fillThreshold = 0.35): QuietBlock[] {
  const cap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const booked: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const keys = dateKeysBetween(from, to);

  for (const key of keys) {
    if (ds.business.closed_dates?.includes(key)) continue;
    const wd = weekdayOfKey(key);
    const wk = WEEKDAY_KEYS[wd];
    for (const s of ds.staff) {
      if (s.status !== "active" || s.leave_dates?.includes(key)) continue;
      const h = s.working_hours?.[wk];
      if (!h) continue;
      addOverlap(cap[wd], parseTimeToMinutes(h[0]), parseTimeToMinutes(h[1]));
    }
  }
  for (const a of ds.appointments) {
    if (a.status === "cancelled") continue;
    const p = localParts(a.starts_at);
    if (!inRange(p.dateKey, from, to)) continue;
    for (const svc of a.appointment_services) {
      addOverlap(booked[p.weekday], p.minutes, p.minutes + serviceDuration(ds, svc.service_id));
    }
  }

  const weeks = Math.max(1, keys.length / 7);
  const blocks: QuietBlock[] = [];
  for (const wd of WEEK_ORDER) {
    let h = 0;
    while (h < 24) {
      const isQuiet = (hour: number) => cap[wd][hour] > 0 && booked[wd][hour] / cap[wd][hour] < fillThreshold;
      if (!isQuiet(h)) {
        h++;
        continue;
      }
      const start = h;
      let capSum = 0;
      let bookedSum = 0;
      while (h < 24 && isQuiet(h)) {
        capSum += cap[wd][h];
        bookedSum += booked[wd][h];
        h++;
      }
      const freeHoursPerWeek = (capSum - bookedSum) / 60 / weeks;
      if (freeHoursPerWeek >= 0.75) {
        blocks.push({
          weekday: wd,
          weekdayLabel: WEEKDAY_LABELS_TR[wd],
          startHour: start,
          endHour: h,
          fillPercent: capSum > 0 ? Math.round((bookedSum / capSum) * 100) : 0,
          freeHoursPerWeek: round(freeHoursPerWeek, 1),
        });
      }
    }
  }
  return blocks.sort((a, b) => b.freeHoursPerWeek - a.freeHoursPerWeek);
}

export function formatHourRange(startHour: number, endHour: number): string {
  const f = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${f(startHour)}-${f(endHour)}`;
}

/** Gerçekleşmiş randevu cirosunun rezerve edilen saat başına düşen ortalaması — boş kapasitenin parasal değerini tahmin etmek için. */
export function revenuePerBookedHour(ds: InsightDataset, from: string, to: string): number | null {
  const pkgValues = packageSessionValues(ds);
  let value = 0;
  let minutes = 0;
  for (const a of ds.appointments) {
    if (!inRange(dateKeyFromIso(a.starts_at), from, to) || !isRealized(a)) continue;
    for (const svc of a.appointment_services) {
      value += svcValue(svc, pkgValues);
      minutes += serviceDuration(ds, svc.service_id);
    }
  }
  return minutes > 0 ? value / (minutes / 60) : null;
}

// ---------------------------------------------------------------- hizmet analizi

export interface ServiceStat {
  serviceId: string;
  name: string;
  category: string | null;
  listPrice: number;
  durationMinutes: number;
  bookings: number;
  packageSessions: number;
  revenue: number;
  sharePercent: number;
  avgTicket: number;
  revenuePerHour: number | null;
  activeStaffCount: number;
}

export function computeServiceStats(ds: InsightDataset, from: string, to: string): ServiceStat[] {
  const pkgValues = packageSessionValues(ds);
  const acc = new Map<string, { bookings: number; packageSessions: number; revenue: number }>();
  for (const a of ds.appointments) {
    if (a.status === "cancelled" || !inRange(dateKeyFromIso(a.starts_at), from, to)) continue;
    if (!isRealized(a)) continue;
    for (const svc of a.appointment_services) {
      const cur = acc.get(svc.service_id) ?? { bookings: 0, packageSessions: 0, revenue: 0 };
      cur.bookings += 1;
      if (svc.customer_package_id) cur.packageSessions += 1;
      cur.revenue += svcValue(svc, pkgValues);
      acc.set(svc.service_id, cur);
    }
  }
  const totalRevenue = [...acc.values()].reduce((s, v) => s + v.revenue, 0);

  return ds.services
    .map((s): ServiceStat => {
      const v = acc.get(s.id) ?? { bookings: 0, packageSessions: 0, revenue: 0 };
      const hours = (v.bookings * s.duration_minutes) / 60;
      const staffCount = ds.expertise.filter((e) => e.service_id === s.id).length;
      return {
        serviceId: s.id,
        name: s.name,
        category: s.category,
        listPrice: num(s.price),
        durationMinutes: s.duration_minutes,
        bookings: v.bookings,
        packageSessions: v.packageSessions,
        revenue: Math.round(v.revenue),
        sharePercent: totalRevenue > 0 ? round((v.revenue / totalRevenue) * 100, 1) : 0,
        avgTicket: v.bookings > 0 ? Math.round(v.revenue / v.bookings) : 0,
        revenuePerHour: hours > 0 ? Math.round(v.revenue / hours) : null,
        activeStaffCount: staffCount,
      };
    })
    .filter((s) => s.bookings > 0 || ds.services.find((x) => x.id === s.serviceId)?.status === "active")
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------- müşteri segmentleri

export interface CustomerAgg {
  id: string;
  name: string;
  visits: number;
  spend: number;
  noShows: number;
  hasUpcoming: boolean;
  firstVisitDaysAgo: number | null;
  lastVisitDaysAgo: number | null;
  avgTicket: number;
}

export interface CustomerSegments {
  totalCustomers: number;
  customersWithVisits: number;
  newLast30Days: number;
  active: number;
  atRisk: number;
  lost: number;
  oneTimeDrifted: number;
  repeatRatePercent: number | null;
  medianDaysBetweenVisits: number | null;
  top10PercentRevenueSharePercent: number | null;
  topSpenders: CustomerAgg[];
  winbackCandidates: CustomerAgg[];
  winbackAvgTicket: number | null;
  noShowProne: { name: string; noShows: number }[];
}

export function buildCustomerAggregates(ds: InsightDataset): CustomerAgg[] {
  const pkgValues = packageSessionValues(ds);
  const now = Date.now();
  const byId = new Map<string, { visitTimes: number[]; spend: number; noShows: number; hasUpcoming: boolean }>();
  for (const a of ds.appointments) {
    if (a.status === "cancelled") continue;
    const cur = byId.get(a.customer_id) ?? { visitTimes: [], spend: 0, noShows: 0, hasUpcoming: false };
    const t = new Date(a.starts_at).getTime();
    if (t > now) cur.hasUpcoming = true;
    else if (isNoShow(a)) cur.noShows += 1;
    else {
      cur.visitTimes.push(t);
      cur.spend += a.appointment_services.reduce((s, svc) => s + svcValue(svc, pkgValues), 0);
    }
    byId.set(a.customer_id, cur);
  }
  const nameOf = new Map(ds.customers.map((c) => [c.id, c.full_name]));
  return [...byId.entries()].map(([id, v]) => {
    const times = [...v.visitTimes].sort((x, y) => x - y);
    return {
      id,
      name: nameOf.get(id) ?? "Müşteri",
      visits: times.length,
      spend: Math.round(v.spend),
      noShows: v.noShows,
      hasUpcoming: v.hasUpcoming,
      firstVisitDaysAgo: times.length > 0 ? Math.floor((now - times[0]) / DAY_MS) : null,
      lastVisitDaysAgo: times.length > 0 ? Math.floor((now - times[times.length - 1]) / DAY_MS) : null,
      avgTicket: times.length > 0 ? Math.round(v.spend / times.length) : 0,
    };
  });
}

export function computeCustomerSegments(ds: InsightDataset): CustomerSegments {
  const aggs = buildCustomerAggregates(ds);
  const visited = aggs.filter((c) => c.visits >= 1);
  const now = Date.now();

  const active = visited.filter((c) => (c.lastVisitDaysAgo ?? 999) <= 45);
  const atRisk = visited.filter((c) => c.visits >= 2 && !c.hasUpcoming && (c.lastVisitDaysAgo ?? 0) > 45 && (c.lastVisitDaysAgo ?? 0) <= 90);
  const lost = visited.filter((c) => c.visits >= 2 && !c.hasUpcoming && (c.lastVisitDaysAgo ?? 0) > 90);
  const oneTimeDrifted = visited.filter((c) => c.visits === 1 && !c.hasUpcoming && (c.lastVisitDaysAgo ?? 0) > 45);
  const newLast30 = visited.filter((c) => (c.firstVisitDaysAgo ?? 999) <= 30);

  const gaps: number[] = [];
  const visitTimesById = new Map<string, number[]>();
  for (const a of ds.appointments) {
    if (a.status === "cancelled" || isNoShow(a)) continue;
    const t = new Date(a.starts_at).getTime();
    if (t > now) continue;
    const arr = visitTimesById.get(a.customer_id) ?? [];
    arr.push(t);
    visitTimesById.set(a.customer_id, arr);
  }
  for (const arr of visitTimesById.values()) {
    const days = [...new Set(arr.map((t) => Math.floor(t / DAY_MS)))].sort((x, y) => x - y);
    for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
  }
  gaps.sort((x, y) => x - y);
  const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : null;

  const spendSorted = [...visited].sort((a, b) => b.spend - a.spend);
  const totalSpend = spendSorted.reduce((s, c) => s + c.spend, 0);
  const topCount = Math.max(1, Math.ceil(spendSorted.length * 0.1));
  const topShare = totalSpend > 0 ? (spendSorted.slice(0, topCount).reduce((s, c) => s + c.spend, 0) / totalSpend) * 100 : null;

  const winbackPool = [...lost, ...atRisk].sort((a, b) => b.spend - a.spend);
  const winbackVisits = winbackPool.reduce((s, c) => s + c.visits, 0);
  const winbackSpend = winbackPool.reduce((s, c) => s + c.spend, 0);

  return {
    totalCustomers: ds.customers.length,
    customersWithVisits: visited.length,
    newLast30Days: newLast30.length,
    active: active.length,
    atRisk: atRisk.length,
    lost: lost.length,
    oneTimeDrifted: oneTimeDrifted.length,
    repeatRatePercent: visited.length > 0 ? Math.round((visited.filter((c) => c.visits >= 2).length / visited.length) * 100) : null,
    medianDaysBetweenVisits: median,
    top10PercentRevenueSharePercent: topShare !== null ? Math.round(topShare) : null,
    topSpenders: spendSorted.slice(0, 8),
    winbackCandidates: winbackPool.slice(0, 12),
    winbackAvgTicket: winbackVisits > 0 ? Math.round(winbackSpend / winbackVisits) : null,
    noShowProne: aggs
      .filter((c) => c.noShows >= 2)
      .sort((a, b) => b.noShows - a.noShows)
      .slice(0, 8)
      .map((c) => ({ name: c.name, noShows: c.noShows })),
  };
}

// ---------------------------------------------------------------- iptal / gelmeme

export interface RateRow {
  label: string;
  total: number;
  lost: number;
  ratePercent: number;
}

export interface CancellationStats {
  from: string;
  to: string;
  totalBookings: number;
  cancelled: number;
  noShows: number;
  lossRatePercent: number | null;
  lostRevenue: number;
  byWeekday: RateRow[];
  byService: RateRow[];
  byStaff: RateRow[];
}

export function computeCancellationStats(ds: InsightDataset, from: string, to: string): CancellationStats {
  const now = Date.now();
  const serviceName = new Map(ds.services.map((s) => [s.id, s.name]));
  const staffName = new Map(ds.staff.map((s) => [s.id, s.full_name]));
  const weekday = new Map<number, { total: number; lost: number }>();
  const service = new Map<string, { total: number; lost: number }>();
  const staff = new Map<string, { total: number; lost: number }>();
  let total = 0;
  let cancelled = 0;
  let noShows = 0;
  let lostRevenue = 0;

  const bump = <K,>(map: Map<K, { total: number; lost: number }>, key: K, lost: boolean) => {
    const cur = map.get(key) ?? { total: 0, lost: 0 };
    cur.total += 1;
    if (lost) cur.lost += 1;
    map.set(key, cur);
  };

  for (const a of ds.appointments) {
    const key = dateKeyFromIso(a.starts_at);
    if (!inRange(key, from, to)) continue;
    const isCancelled = a.status === "cancelled";
    const past = new Date(a.starts_at).getTime() <= now;
    if (!isCancelled && !past) continue; // henüz gerçekleşmemiş aktif randevu oran paydasına girmez
    const lost = isCancelled || isNoShow(a);
    total += 1;
    if (isCancelled) cancelled += 1;
    else if (isNoShow(a)) noShows += 1;
    if (lost) lostRevenue += a.appointment_services.reduce((s, x) => s + num(x.planned_price), 0);
    bump(weekday, weekdayOfKey(key), lost);
    for (const svc of a.appointment_services) {
      bump(service, svc.service_id, lost);
      bump(staff, svc.staff_id, lost);
    }
  }

  const toRows = <K,>(map: Map<K, { total: number; lost: number }>, label: (k: K) => string, minTotal: number): RateRow[] =>
    [...map.entries()]
      .filter(([, v]) => v.total >= minTotal)
      .map(([k, v]) => ({ label: label(k), total: v.total, lost: v.lost, ratePercent: Math.round((v.lost / v.total) * 100) }))
      .sort((a, b) => b.ratePercent - a.ratePercent);

  return {
    from,
    to,
    totalBookings: total,
    cancelled,
    noShows,
    lossRatePercent: total > 0 ? round(((cancelled + noShows) / total) * 100, 1) : null,
    lostRevenue: Math.round(lostRevenue),
    byWeekday: toRows(weekday, (k) => WEEKDAY_LABELS_TR[k], 4),
    byService: toRows(service, (k) => serviceName.get(k) ?? "Hizmet", 4),
    byStaff: toRows(staff, (k) => staffName.get(k) ?? "Personel", 4),
  };
}

// ---------------------------------------------------------------- paketler

export interface PackageRowInsight {
  customerName: string;
  serviceName: string;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  saleDate: string;
  perSessionValue: number;
  daysSinceLastSession: number | null;
  idle: boolean;
}

export interface PackagesOverview {
  totalPackagesSold: number;
  activePackages: number;
  completedPackages: number;
  remainingSessions: number;
  remainingValue: number;
  soldLast30Days: { count: number; revenue: number };
  soldLast90Days: { count: number; revenue: number };
  idlePackages: PackageRowInsight[];
  active: PackageRowInsight[];
}

function computePackageUsage(ds: InsightDataset): Map<string, { used: number; lastSession: number | null }> {
  const now = Date.now();
  const usage = new Map<string, { used: number; lastSession: number | null }>();
  for (const a of ds.appointments) {
    if (a.status === "cancelled") continue;
    for (const svc of a.appointment_services) {
      if (!svc.customer_package_id) continue;
      const cur = usage.get(svc.customer_package_id) ?? { used: 0, lastSession: null };
      cur.used += 1;
      const t = new Date(a.starts_at).getTime();
      if (t <= now && (cur.lastSession === null || t > cur.lastSession)) cur.lastSession = t;
      usage.set(svc.customer_package_id, cur);
    }
  }
  return usage;
}

export function computePackagesOverview(ds: InsightDataset): PackagesOverview {
  const now = Date.now();
  const usage = computePackageUsage(ds);
  const customerName = new Map(ds.customers.map((c) => [c.id, c.full_name]));
  const serviceName = new Map(ds.services.map((s) => [s.id, s.name]));

  const rows = ds.packages.map((p): PackageRowInsight => {
    const u = usage.get(p.id) ?? { used: 0, lastSession: null };
    const remaining = Math.max(0, p.total_sessions - u.used);
    const daysSinceLast = u.lastSession !== null ? Math.floor((now - u.lastSession) / DAY_MS) : null;
    const daysSinceSale = Math.floor((now - new Date(`${p.sale_date}T12:00:00+03:00`).getTime()) / DAY_MS);
    const idle = remaining > 0 && (daysSinceLast !== null ? daysSinceLast > 30 : daysSinceSale > 14);
    return {
      customerName: customerName.get(p.customer_id) ?? "Müşteri",
      serviceName: serviceName.get(p.service_id) ?? "Hizmet",
      totalSessions: p.total_sessions,
      usedSessions: u.used,
      remainingSessions: remaining,
      saleDate: p.sale_date,
      perSessionValue: p.total_sessions > 0 ? Math.round(num(p.price) / p.total_sessions) : 0,
      daysSinceLastSession: daysSinceLast ?? daysSinceSale,
      idle,
    };
  });

  const d30 = addDaysToKey(ds.todayKey, -30);
  const d90 = addDaysToKey(ds.todayKey, -90);
  const sold = (fromKey: string) => {
    const list = ds.packages.filter((p) => p.sale_date >= fromKey);
    return { count: list.length, revenue: Math.round(list.reduce((s, p) => s + num(p.price), 0)) };
  };
  const active = rows.filter((r) => r.remainingSessions > 0);

  return {
    totalPackagesSold: rows.length,
    activePackages: active.length,
    completedPackages: rows.length - active.length,
    remainingSessions: active.reduce((s, r) => s + r.remainingSessions, 0),
    remainingValue: Math.round(active.reduce((s, r) => s + r.remainingSessions * r.perSessionValue, 0)),
    soldLast30Days: sold(d30),
    soldLast90Days: sold(d90),
    idlePackages: rows.filter((r) => r.idle).sort((a, b) => b.remainingSessions * b.perSessionValue - a.remainingSessions * a.perSessionValue),
    active: active.slice(0, 15),
  };
}

// ---------------------------------------------------------------- ay tempo tahmini

export interface RunRate {
  monthStart: string;
  mtdRevenue: number;
  elapsedOpenDays: number;
  remainingOpenDays: number;
  avgPerOpenDay: number | null;
  bookedAhead: number;
  projection: number | null;
  lastMonthRevenue: number;
  changeVsLastMonthPercent: number | null;
}

export function computeRunRate(ds: InsightDataset): RunRate {
  const today = ds.todayKey;
  const monthStart = `${today.slice(0, 8)}01`;
  const yesterday = addDaysToKey(today, -1);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthEnd = `${today.slice(0, 8)}${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const mtd = yesterday >= monthStart ? computeRevenue(ds, monthStart, yesterday).total : 0;
  const elapsedKeys = yesterday >= monthStart ? dateKeysBetween(monthStart, yesterday) : [];
  const elapsedOpenDays = elapsedKeys.filter((k) => capacityMinutes(ds, k) > 0).length;
  const remainingKeys = dateKeysBetween(today, monthEnd);
  const remainingOpenDays = remainingKeys.filter((k) => capacityMinutes(ds, k) > 0).length;

  let bookedAhead = 0;
  for (const a of ds.appointments) {
    if (a.status === "cancelled") continue;
    const key = dateKeyFromIso(a.starts_at);
    if (key < today || key > monthEnd) continue;
    if (new Date(a.starts_at).getTime() <= Date.now()) continue;
    bookedAhead += apptAmount(a);
  }

  const avg = elapsedOpenDays > 0 ? mtd / elapsedOpenDays : null;
  const runRateProjection = avg !== null ? mtd + avg * remainingOpenDays : null;
  const projection = runRateProjection !== null ? Math.max(runRateProjection, mtd + bookedAhead) : null;

  const lastMonthEnd = addDaysToKey(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
  const lastMonthRevenue = computeRevenue(ds, lastMonthStart, lastMonthEnd).total;

  return {
    monthStart,
    mtdRevenue: Math.round(mtd),
    elapsedOpenDays,
    remainingOpenDays,
    avgPerOpenDay: avg !== null ? Math.round(avg) : null,
    bookedAhead: Math.round(bookedAhead),
    projection: projection !== null ? Math.round(projection) : null,
    lastMonthRevenue: Math.round(lastMonthRevenue),
    changeVsLastMonthPercent:
      projection !== null && lastMonthRevenue > 0 ? round(((projection - lastMonthRevenue) / lastMonthRevenue) * 100, 1) : null,
  };
}

// ---------------------------------------------------------------- ekip

export interface TeamMemberStat {
  name: string;
  serviceCount: number;
  revenue: number;
  appointments: number;
  occupancyPercent: number | null;
  cancellationRatePercent: number | null;
  commission: number;
  avgTicket: number;
  servicesOffered: string[];
}

export function computeTeamStats(ds: InsightDataset, from: string, to: string): TeamMemberStat[] {
  const serviceName = new Map(ds.services.map((s) => [s.id, s.name]));
  const keys = dateKeysBetween(from, to);
  return ds.staff
    .filter((s) => s.status === "active")
    .map((s): TeamMemberStat => {
      let revenue = 0;
      let commission = 0;
      let rows = 0;
      let lostRows = 0;
      let bookedMin = 0;
      const rate = num(s.commission_rate);
      for (const a of ds.appointments) {
        if (!inRange(dateKeyFromIso(a.starts_at), from, to)) continue;
        for (const svc of a.appointment_services) {
          if (svc.staff_id !== s.id) continue;
          const cancelled = a.status === "cancelled";
          const past = new Date(a.starts_at).getTime() <= Date.now();
          if (cancelled || past) {
            rows += 1;
            if (cancelled || isNoShow(a)) lostRows += 1;
          }
          if (cancelled) continue;
          bookedMin += serviceDuration(ds, svc.service_id);
          if (isRealized(a)) {
            const amount = num(svc.final_price ?? svc.planned_price);
            revenue += amount;
            commission += (amount * num(svc.commission_rate_snapshot ?? rate)) / 100;
          }
        }
      }
      for (const sale of ds.sales) {
        if (sale.staff_id !== s.id || !inRange(sale.sale_date, from, to)) continue;
        revenue += num(sale.amount);
        commission += (num(sale.amount) * num(sale.commission_rate_snapshot ?? rate)) / 100;
      }
      for (const p of ds.packages) {
        if (p.staff_id !== s.id || !inRange(p.sale_date, from, to)) continue;
        revenue += num(p.price);
        commission += (num(p.price) * num(p.commission_rate_snapshot ?? rate)) / 100;
      }
      const capacity = keys.reduce((sum, k) => sum + staffCapacityMinutes(ds, s, k), 0);
      const offered = ds.expertise.filter((e) => e.staff_id === s.id).map((e) => serviceName.get(e.service_id) ?? "Hizmet");
      return {
        name: s.full_name,
        serviceCount: rows,
        revenue: Math.round(revenue),
        appointments: rows - lostRows,
        occupancyPercent: capacity > 0 ? Math.round((bookedMin / capacity) * 100) : null,
        cancellationRatePercent: rows > 0 ? Math.round((lostRows / rows) * 100) : null,
        commission: Math.round(commission),
        avgTicket: rows - lostRows > 0 ? Math.round(revenue / (rows - lostRows)) : 0,
        servicesOffered: offered,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------- düzenli müşteri x hizmet (paket fırsatı)

export interface PackageOpportunityPair {
  customerName: string;
  serviceName: string;
  visitsLast90Days: number;
  spendLast90Days: number;
}

/** Son 90 günde aynı hizmeti 3+ kez almış ama o hizmet için (kalan seansı olan) paketi olmayan müşteriler. */
export function findPackageCandidates(ds: InsightDataset): PackageOpportunityPair[] {
  const pkgValues = packageSessionValues(ds);
  const from = addDaysToKey(ds.todayKey, -90);
  const counts = new Map<string, { customerId: string; serviceId: string; visits: number; spend: number }>();
  for (const a of ds.appointments) {
    if (!isRealized(a) || dateKeyFromIso(a.starts_at) < from) continue;
    for (const svc of a.appointment_services) {
      if (svc.customer_package_id) continue;
      const key = `${a.customer_id}|${svc.service_id}`;
      const cur = counts.get(key) ?? { customerId: a.customer_id, serviceId: svc.service_id, visits: 0, spend: 0 };
      cur.visits += 1;
      cur.spend += svcValue(svc, pkgValues);
      counts.set(key, cur);
    }
  }
  const usage = computePackageUsage(ds);
  const customerName = new Map(ds.customers.map((c) => [c.id, c.full_name]));
  const serviceName = new Map(ds.services.map((s) => [s.id, s.name]));
  const hasPackage = new Set(
    ds.packages
      .filter((p) => p.total_sessions - (usage.get(p.id)?.used ?? 0) > 0)
      .map((p) => `${p.customer_id}|${p.service_id}`)
  );

  const listPrice = new Map(ds.services.map((s) => [s.id, num(s.price)]));

  return [...counts.entries()]
    // Paket, pahalı (1.000 TL+) ve sık alınan hizmetlerde mantıklı; 300-500 TL'lik kaş/oje gibi hizmetlerde değil.
    .filter(([key, v]) => v.visits >= 3 && (listPrice.get(v.serviceId) ?? 0) >= 1000 && !hasPackage.has(key))
    .map(([, v]) => ({
      customerName: customerName.get(v.customerId) ?? "Müşteri",
      serviceName: serviceName.get(v.serviceId) ?? "Hizmet",
      visitsLast90Days: v.visits,
      spendLast90Days: Math.round(v.spend),
    }))
    .sort((a, b) => b.spendLast90Days - a.spendLast90Days);
}

// ---------------------------------------------------------------- günlük özet için tek gün

export interface DayFacts {
  dateKey: string;
  weekdayLabel: string;
  revenue: RevenueBreakdown;
  appointments: number;
  cancelled: number;
  noShows: number;
  topService: { name: string; revenue: number } | null;
  topStaff: { name: string; count: number } | null;
}

export function computeDayFacts(ds: InsightDataset, dateKey: string): DayFacts {
  const pkgValues = packageSessionValues(ds);
  const serviceName = new Map(ds.services.map((s) => [s.id, s.name]));
  const staffName = new Map(ds.staff.map((s) => [s.id, s.full_name]));
  let appointments = 0;
  let cancelled = 0;
  let noShows = 0;
  const serviceRevenue = new Map<string, number>();
  const staffCount = new Map<string, number>();

  for (const a of ds.appointments) {
    if (dateKeyFromIso(a.starts_at) !== dateKey) continue;
    if (a.status === "cancelled") {
      cancelled += 1;
      continue;
    }
    if (isNoShow(a)) {
      noShows += 1;
      continue;
    }
    appointments += 1;
    for (const svc of a.appointment_services) {
      serviceRevenue.set(svc.service_id, (serviceRevenue.get(svc.service_id) ?? 0) + svcValue(svc, pkgValues));
      staffCount.set(svc.staff_id, (staffCount.get(svc.staff_id) ?? 0) + 1);
    }
  }
  const topServiceEntry = [...serviceRevenue.entries()].sort((a, b) => b[1] - a[1])[0];
  const topStaffEntry = [...staffCount.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    dateKey,
    weekdayLabel: WEEKDAY_LABELS_TR[weekdayOfKey(dateKey)],
    revenue: computeRevenue(ds, dateKey, dateKey),
    appointments,
    cancelled,
    noShows,
    topService: topServiceEntry ? { name: serviceName.get(topServiceEntry[0]) ?? "Hizmet", revenue: Math.round(topServiceEntry[1]) } : null,
    topStaff: topStaffEntry ? { name: staffName.get(topStaffEntry[0]) ?? "Personel", count: topStaffEntry[1] } : null,
  };
}
