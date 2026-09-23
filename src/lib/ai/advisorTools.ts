import type { FunctionDeclaration } from "@google/genai";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addDaysToKey, dateKeyFromIso } from "@/lib/date";
import {
  WEEKDAY_LABELS_TR,
  computeCancellationStats,
  computeCustomerSegments,
  computeOccupancy,
  computePackagesOverview,
  computeProfit,
  computeQuietBlocks,
  computeRunRate,
  computeServiceStats,
  computeTeamStats,
  computeWeekdayPatterns,
  findPackageCandidates,
  formatHourRange,
  loadInsightsDataset,
  revenuePerBookedHour,
  round,
  type InsightDataset,
} from "@/lib/businessInsights";
import { buildPulse } from "@/lib/opportunities";

/**
 * Danışman'ın "her yere erişimini" sağlayan stratejik araçlar. Hepsi businessInsights.ts'teki
 * kodla hesaplanmış gerçekleri döner — model rakam üretmez, sadece bunları yorumlar. Bu araçlar
 * SADECE OKUR (hiçbir veriyi değiştirmez), bu yüzden onay gerektirmeden özgürce çağrılabilir.
 */

interface ToolContext {
  businessId: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RANGE_PROPS = {
  from: { type: "string", description: "YYYY-MM-DD, aralığın başlangıcı (dahil). Belirtilmezse son 30 gün." },
  to: { type: "string", description: "YYYY-MM-DD, aralığın bitişi (dahil). Belirtilmezse dün." },
} as const;

export const ADVISOR_TOOLS: FunctionDeclaration[] = [
  {
    name: "get_business_pulse",
    description:
      "Son 28 günün doluluğunu, ay sonu ciro tahminini ve verilerden otomatik çıkan en değerli FIRSATLARI/RİSKLERİ " +
      "(tahmini TL etkisiyle) döner. Stratejik/beyin fırtınası " +
      "sorularında (\"işletmemi nasıl büyütürüm\", \"ne yapmalıyım\", \"durum nasıl\") HER ZAMAN ilk çağıracağın araç.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_business_profile",
    description:
      "İşletmenin tanımını döner: çalışma saatleri, kapalı günler, tüm hizmetler (fiyat, süre, kategori, hangi personelin " +
      "verdiği) ve tüm personel (çalışma saati, prim oranı, izinler, verdiği hizmetler). Hizmet/personel/fiyat/kapasite " +
      "konusunda öneri vermeden önce mevcut yapıyı bilmek için çağır.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_profit_and_expenses",
    description:
      "Aralık için ciro kırılımı (randevu / ürün satışı / paket), gider kırılımı (sabit gider payı + tek seferlik, " +
      "kategoriye göre), personel primleri, Net Kâr (Kasa'daki gibi) ve primler düşülmüş net, kâr marjı döner. " +
      "\"Kâr ediyor muyum\", \"giderlerim nasıl\", \"marjım ne\" sorularında kullan.",
    parametersJsonSchema: { type: "object", properties: RANGE_PROPS, required: [] },
  },
  {
    name: "get_customer_segments",
    description:
      "Müşteri tabanının analizi: aktif / riskli (45-90 gün) / kayıp (90+ gün) / tek seferlik gelip kaybolan sayıları, " +
      "son 30 günde yeni müşteri, tekrar gelme oranı, ortalama ziyaret aralığı, en çok harcayan müşteriler, ciro " +
      "yoğunlaşması, geri kazanılabilecek müşteri listesi (isimle) ve sık gelmeme yapanlar. Sadakat, müşteri kaybı, " +
      "VIP ve geri kazanım sorularında kullan.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_service_performance",
    description:
      "Hizmet bazlı performans: rezervasyon sayısı, ciro ve payı, ortalama ücret, SAAT BAŞI getiri (kapasitenin en " +
      "verimli kullanıldığı hizmetleri bulmak için), paketten karşılanan seans sayısı. Fiyatlama, hangi hizmeti " +
      "öne çıkarmalı/bırakmalı, paketleme soruları için kullan.",
    parametersJsonSchema: { type: "object", properties: RANGE_PROPS, required: [] },
  },
  {
    name: "get_time_patterns",
    description:
      "Hafta günü bazında doluluk / ortalama randevu / ortalama ciro ve çalışma saatleri içinde en BOŞ kalan gün+saat " +
      "blokları (haftada kaç saat boşta olduğuyla) ile saat başı ortalama getiri. Boş saat kampanyası, mesai düzeni, " +
      "\"hangi gün/saat boş\" soruları için kullan.",
    parametersJsonSchema: { type: "object", properties: RANGE_PROPS, required: [] },
  },
  {
    name: "get_cancellation_analysis",
    description:
      "İptal ve gelmeme (no-show) analizi: toplam oran, kaybedilen tutar, gün / hizmet / personel bazında oranlar. " +
      "\"İptaller neden çok\", \"hangi gün iptal fazla\" sorularında kullan.",
    parametersJsonSchema: { type: "object", properties: RANGE_PROPS, required: [] },
  },
  {
    name: "get_packages_overview",
    description:
      "Seans paketlerinin genel durumu: aktif/biten paket sayısı, kalan seans ve değeri, son 30/90 günde satılan paketler, " +
      "uzun süredir kullanılmayan (unutulmuş) paketler ve paket alması mantıklı olan (aynı hizmeti düzenli alan) müşteriler.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_team_overview",
    description:
      "Tüm personelin aralıktaki karşılaştırmalı performansı: ciro, randevu sayısı, doluluk, iptal oranı, prim, ortalama " +
      "ücret ve verdiği hizmetler. Ekip dengesi, prim, kim öne çıkıyor/geride sorularında kullan.",
    parametersJsonSchema: { type: "object", properties: RANGE_PROPS, required: [] },
  },
  {
    name: "get_operations_snapshot",
    description:
      "Operasyonel anlık görüntü: önümüzdeki 7 günün gün gün doluluğu ve randevu sayısı, bekleme listesi (hangi hizmete kaç kişi), " +
      "son 30 günde WhatsApp mesaj hacmi ve AI'nin insana devrettiği konuşma sayısı, onay bekleyen öneri sayısı.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "simulate_scenario",
    description:
      "\"Ya şöyle yapsam?\" senaryolarını kendi verisiyle hesaplar (tahmin, taahhüt değil): 'price_change' (bir hizmete %X zam), " +
      "'fill_quiet_slots' (boş saatlerin %X'i dolsa), 'winback_customers' (kaybedilen müşterilerin %X'i dönse), " +
      "'reduce_cancellations' (iptal/gelmeme kaybı %X azalsa), 'sell_packages' (paket adaylarının %X'i paket alsa). " +
      "Sonucu varsayımlarıyla birlikte sun.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        scenario: {
          type: "string",
          description: "price_change | fill_quiet_slots | winback_customers | reduce_cancellations | sell_packages",
        },
        percent: {
          type: "number",
          description:
            "Senaryonun ana yüzdesi: zam oranı / dolacak boşluk yüzdesi / geri dönecek müşteri yüzdesi / azalacak kayıp yüzdesi / paket alacak aday yüzdesi (0-100).",
        },
        service_name: { type: "string", description: "SADECE price_change için: hizmetin sistemdeki adı." },
        demand_drop_percent: {
          type: "number",
          description: "SADECE price_change için: zam sonrası talebin tahmini düşüşü yüzdesi (belirtilmezse 0).",
        },
      },
      required: ["scenario", "percent"],
    },
  },
  {
    name: "plan_revenue_target",
    description:
      "Bu ay için bir ciro hedefi verildiğinde: şu ana kadarki ciro, hedefe kalan tutar, kalan çalışma gününde günlük gereken ciro, " +
      "mevcut tempoyla ay sonu tahmini, önceden alınmış randevuların değeri ve açığı kapatabilecek en büyük fırsatları döner. " +
      "\"Bu ay X TL yapmak istiyorum\", \"hedefe yetişir miyim\" sorularında kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: { target_tl: { type: "number", description: "Bu ay için hedeflenen toplam ciro (TL)" } },
      required: ["target_tl"],
    },
  },
];

const DATASET_TTL_MS = 45_000;
const datasetCache = new Map<string, { at: number; promise: Promise<InsightDataset> }>();

/** Aynı sohbet turunda paralel çağrılan araçlar tek bir veri yüklemesini paylaşsın (her araç için 8 sorguyu tekrarlamayalım). */
function getDataset(businessId: string): Promise<InsightDataset> {
  const cached = datasetCache.get(businessId);
  if (cached && Date.now() - cached.at < DATASET_TTL_MS) return cached.promise;
  const promise = loadInsightsDataset(createAdminSupabaseClient(), businessId);
  promise.catch(() => datasetCache.delete(businessId));
  datasetCache.set(businessId, { at: Date.now(), promise });
  return promise;
}

function resolveRange(input: Record<string, unknown>, ds: InsightDataset): { from: string; to: string } | { error: string } {
  const to = String(input.to ?? "") || addDaysToKey(ds.todayKey, -1);
  const from = String(input.from ?? "") || addDaysToKey(to, -29);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return { error: "Tarihler YYYY-MM-DD formatında olmalı ve from <= to olmalı." };
  return { from, to };
}

function money(value: number): number {
  return Math.round(value);
}

export async function executeAdvisorTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string | null> {
  const isAdvisorTool = ADVISOR_TOOLS.some((t) => t.name === name);
  if (!isAdvisorTool) return null;

  try {
    const ds = await getDataset(ctx.businessId);
    switch (name) {
      case "get_business_pulse":
        return JSON.stringify(businessPulse(ds));
      case "get_business_profile":
        return JSON.stringify(businessProfile(ds));
      case "get_profit_and_expenses":
        return JSON.stringify(profitAndExpenses(ds, input));
      case "get_customer_segments":
        return JSON.stringify(computeCustomerSegments(ds));
      case "get_service_performance":
        return JSON.stringify(servicePerformance(ds, input));
      case "get_time_patterns":
        return JSON.stringify(timePatterns(ds, input));
      case "get_cancellation_analysis":
        return JSON.stringify(cancellationAnalysis(ds, input));
      case "get_packages_overview":
        return JSON.stringify({ ...computePackagesOverview(ds), packageCandidates: findPackageCandidates(ds).slice(0, 10) });
      case "get_team_overview":
        return JSON.stringify(teamOverview(ds, input));
      case "get_operations_snapshot":
        return JSON.stringify(await operationsSnapshot(ds, ctx));
      case "simulate_scenario":
        return JSON.stringify(simulateScenario(ds, input));
      case "plan_revenue_target":
        return JSON.stringify(planRevenueTarget(ds, input));
      default:
        return null;
    }
  } catch (err) {
    console.error("[advisorTools]", name, err);
    return JSON.stringify({ error: "Bu analiz şu an yapılamadı, lütfen biraz sonra tekrar dene." });
  }
}

function businessPulse(ds: InsightDataset) {
  const pulse = buildPulse(ds);
  const yesterday = addDaysToKey(ds.todayKey, -1);
  const occ = computeOccupancy(ds, addDaysToKey(ds.todayKey, -28), yesterday);
  return {
    hasEnoughData: pulse.hasEnoughData,
    opportunities: pulse.opportunities,
    occupancyLast28Days: occ,
    monthPace: computeRunRate(ds),
    note: "Fırsatların impactTL değerleri AYLIK tahmindir ve impactNote'taki varsayıma dayanır.",
  };
}

function businessProfile(ds: InsightDataset) {
  const staffName = new Map(ds.staff.map((s) => [s.id, s.full_name]));
  const serviceName = new Map(ds.services.map((s) => [s.id, s.name]));
  const hoursLabel = (h: Record<string, [string, string] | null> | null | undefined) =>
    Object.entries(h ?? {})
      .filter((entry): entry is [string, [string, string]] => Array.isArray(entry[1]))
      .map(([k, v]) => {
        const idx = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(k);
        return `${WEEKDAY_LABELS_TR[idx] ?? k}: ${v[0]}-${v[1]}`;
      });
  return {
    business_name: ds.business.name,
    working_hours: hoursLabel(ds.business.working_hours),
    upcoming_closed_dates: (ds.business.closed_dates ?? []).filter((d) => d >= ds.todayKey),
    services: ds.services.map((s) => {
      const performers = ds.expertise.filter((e) => e.service_id === s.id).map((e) => staffName.get(e.staff_id) ?? "Personel");
      return {
        name: s.name,
        category: s.category,
        price: Number(s.price),
        duration_minutes: s.duration_minutes,
        status: s.status,
        performed_by: performers.length > 0 ? performers : "Kısıt tanımlı değil (tüm aktif personel yapabilir)",
      };
    }),
    staff: ds.staff.map((s) => ({
      name: s.full_name,
      status: s.status,
      commission_rate_percent: Number(s.commission_rate),
      working_hours: hoursLabel(s.working_hours),
      upcoming_leave_dates: (s.leave_dates ?? []).filter((d) => d >= ds.todayKey),
      services_offered: ds.expertise.filter((e) => e.staff_id === s.id).map((e) => serviceName.get(e.service_id) ?? "Hizmet"),
    })),
    total_customers: ds.customers.length,
  };
}

function profitAndExpenses(ds: InsightDataset, input: Record<string, unknown>) {
  const range = resolveRange(input, ds);
  if ("error" in range) return range;
  const p = computeProfit(ds, range.from, range.to);
  return {
    from: range.from,
    to: range.to,
    revenue: { total: money(p.revenue.total), appointments: money(p.revenue.appointments), product_sales: money(p.revenue.products), packages: money(p.revenue.packages) },
    expenses: {
      total: money(p.expenses.total),
      fixed_share: money(p.expenses.fixedShare),
      one_time: money(p.expenses.oneTime),
      by_category: p.expenses.byCategory.map((c) => ({ category: c.category, amount: money(c.amount) })),
    },
    staff_commissions: money(p.commissions),
    net_profit_kasa_definition: money(p.netProfit),
    net_after_commissions: money(p.netAfterCommissions),
    margin_percent: p.marginPercent !== null ? round(p.marginPercent, 1) : null,
    has_expense_data: ds.fixedExpenses.length > 0 || ds.oneTimeExpenses.length > 0,
    note: "Net kâr Kasa'daki tanımla aynıdır (ciro - gider); prim ayrıca gösterilir. Malzeme/ürün maliyeti hizmet bazında tutulmadığı için hizmet kâr marjı hesaplanamaz.",
  };
}

function servicePerformance(ds: InsightDataset, input: Record<string, unknown>) {
  const range = resolveRange(input, ds);
  if ("error" in range) return range;
  return {
    from: range.from,
    to: range.to,
    services: computeServiceStats(ds, range.from, range.to),
    note: "Paketten karşılanan seansların değeri paket fiyatı / seans sayısı olarak (eşdeğer) hesaplanmıştır.",
  };
}

function timePatterns(ds: InsightDataset, input: Record<string, unknown>) {
  const range = resolveRange(input, ds);
  if ("error" in range) return range;
  const rph = revenuePerBookedHour(ds, range.from, range.to);
  return {
    from: range.from,
    to: range.to,
    weekdays: computeWeekdayPatterns(ds, range.from, range.to),
    quiet_blocks: computeQuietBlocks(ds, range.from, range.to)
      .slice(0, 8)
      .map((b) => ({ day: b.weekdayLabel, hours: formatHourRange(b.startHour, b.endHour), fill_percent: b.fillPercent, free_hours_per_week: b.freeHoursPerWeek })),
    revenue_per_booked_hour: rph !== null ? Math.round(rph) : null,
  };
}

function cancellationAnalysis(ds: InsightDataset, input: Record<string, unknown>) {
  const range = resolveRange(input, ds);
  if ("error" in range) return range;
  return computeCancellationStats(ds, range.from, range.to);
}

function teamOverview(ds: InsightDataset, input: Record<string, unknown>) {
  const range = resolveRange(input, ds);
  if ("error" in range) return range;
  return { from: range.from, to: range.to, team: computeTeamStats(ds, range.from, range.to) };
}

async function operationsSnapshot(ds: InsightDataset, ctx: ToolContext) {
  const admin = createAdminSupabaseClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const next7 = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(ds.todayKey, i);
    const booked = ds.appointments.filter((a) => a.status !== "cancelled" && dateKeyFromIso(a.starts_at) === key).length;
    const occ = computeOccupancy(ds, key, key);
    return {
      date: key,
      weekday: WEEKDAY_LABELS_TR[new Date(`${key}T00:00:00Z`).getUTCDay()],
      appointments: booked,
      occupancy_percent: occ.percent,
      free_hours: occ.capacityHours > 0 ? round(Math.max(0, occ.capacityHours - occ.bookedHours), 1) : 0,
    };
  });

  const [inbound, outbound, escalated, pending] = await Promise.all([
    admin.from("whatsapp_message_log").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId).eq("direction", "inbound").gte("created_at", since),
    admin.from("whatsapp_message_log").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId).eq("direction", "outbound").gte("created_at", since),
    admin.from("whatsapp_message_log").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId).eq("escalated", true).gte("created_at", since),
    admin.from("action_objects").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId).eq("status", "pending"),
  ]);

  const serviceName = new Map(ds.services.map((s) => [s.id, s.name]));
  const waitlistByService = new Map<string, number>();
  for (const w of ds.waitlistOpen) {
    const label = w.desired_service_id ? serviceName.get(w.desired_service_id) ?? "Hizmet" : "Belirtilmemiş";
    waitlistByService.set(label, (waitlistByService.get(label) ?? 0) + 1);
  }

  return {
    next_7_days: next7,
    waitlist_open_total: ds.waitlistOpen.length,
    waitlist_by_service: [...waitlistByService.entries()].map(([service, count]) => ({ service, count })),
    whatsapp_last_30_days: {
      inbound_messages: inbound.count ?? 0,
      outbound_messages: outbound.count ?? 0,
      conversations_escalated_to_human: escalated.count ?? 0,
    },
    pending_suggestions: pending.count ?? 0,
  };
}

function findService(ds: InsightDataset, name: string) {
  const needle = name.trim().toLowerCase();
  return ds.services.find((s) => s.name.trim().toLowerCase() === needle) ?? ds.services.find((s) => s.name.toLowerCase().includes(needle));
}

function simulateScenario(ds: InsightDataset, input: Record<string, unknown>) {
  const scenario = String(input.scenario ?? "");
  const percent = Math.max(0, Math.min(100, Number(input.percent ?? 0)));
  const yesterday = addDaysToKey(ds.todayKey, -1);
  const last90 = addDaysToKey(ds.todayKey, -90);
  const last56 = addDaysToKey(ds.todayKey, -56);

  if (scenario === "price_change") {
    const service = findService(ds, String(input.service_name ?? ""));
    if (!service) {
      return { error: `Hizmet bulunamadı. Sistemdeki hizmetler: ${ds.services.map((s) => s.name).join(", ")}` };
    }
    const stat = computeServiceStats(ds, last90, yesterday).find((s) => s.serviceId === service.id);
    if (!stat || stat.bookings === 0) return { no_data: true, message: `${service.name} için son 90 günde veri yok.` };
    const p = percent / 100;
    const d = Math.max(0, Math.min(100, Number(input.demand_drop_percent ?? 0))) / 100;
    const monthlyNow = stat.revenue / 3;
    const monthlyAfter = monthlyNow * (1 + p) * (1 - d);
    return {
      scenario,
      service: service.name,
      assumptions: `Son 90 günün aylık ortalaması baz alındı; fiyat %${percent} artıyor, talep %${round(d * 100)} düşüyor.`,
      monthly_revenue_now: money(monthlyNow),
      monthly_revenue_after: money(monthlyAfter),
      monthly_delta: money(monthlyAfter - monthlyNow),
      break_even_demand_drop_percent: round((p / (1 + p)) * 100, 1),
      bookings_last_90_days: stat.bookings,
      caution: "Bu bir tahmindir. Talep esnekliği bilinmiyor; küçük adımlarla (ör. %5-10) denemek ve müşteri tepkisini izlemek daha güvenli.",
    };
  }

  if (scenario === "fill_quiet_slots") {
    const blocks = computeQuietBlocks(ds, last56, yesterday);
    const rph = revenuePerBookedHour(ds, last56, yesterday);
    if (blocks.length === 0 || rph === null) return { no_data: true, message: "Belirgin boş saat bloğu bulunamadı ya da yeterli veri yok." };
    const freePerWeek = blocks.reduce((s, b) => s + b.freeHoursPerWeek, 0);
    const monthly = freePerWeek * 4.3 * (percent / 100) * rph;
    const overallOccupancy = computeOccupancy(ds, last56, yesterday).percent;
    return {
      scenario,
      assumptions: `Son 8 haftanın boş bloklarındaki kapasitenin %${percent}'i doluyor; saat başı ortalama getiri ${Math.round(rph)} TL sabit.`,
      overall_occupancy_percent: overallOccupancy,
      warning:
        overallOccupancy !== null && overallOccupancy < 15
          ? "Genel doluluk çok düşük: boş saatler belirli saatlerin değil genel talebin sonucu. Bu rakam, talebi o kadar artırabilirsen ulaşılacak teorik üst sınırdır; gerçekçi hedef için önce talep artırma önlemlerini konuş."
          : null,
      free_hours_per_week_in_quiet_blocks: round(freePerWeek, 1),
      revenue_per_booked_hour: Math.round(rph),
      monthly_revenue_gain: money(monthly),
      top_blocks: blocks.slice(0, 5).map((b) => ({ day: b.weekdayLabel, hours: formatHourRange(b.startHour, b.endHour), fill_percent: b.fillPercent })),
      caution: "İndirimle doldurulan saatlerde saat başı getiri daha düşük olabilir; indirim oranını bu hesaba katmalısın.",
    };
  }

  if (scenario === "winback_customers") {
    const seg = computeCustomerSegments(ds);
    const pool = seg.lost + seg.atRisk;
    if (pool === 0 || !seg.winbackAvgTicket) return { no_data: true, message: "Geri kazanılabilecek kayıp/riskli müşteri yok." };
    const recovered = round(pool * (percent / 100), 1);
    const visitsPerMonth = seg.medianDaysBetweenVisits ? Math.min(4, 30 / seg.medianDaysBetweenVisits) : 0.5;
    return {
      scenario,
      assumptions: `${pool} kayıp/riskli müşterinin %${percent}'i geri dönüyor; ortalama ziyaret değeri ${seg.winbackAvgTicket} TL, tipik ziyaret sıklığı ~${round(visitsPerMonth, 1)}/ay.`,
      customers_recovered: recovered,
      first_visit_revenue: money(recovered * seg.winbackAvgTicket),
      monthly_recurring_revenue_if_retained: money(recovered * seg.winbackAvgTicket * visitsPerMonth),
      top_candidates: seg.winbackCandidates.slice(0, 5).map((c) => ({ name: c.name, visits: c.visits, days_since_last_visit: c.lastVisitDaysAgo, avg_ticket: c.avgTicket })),
      caution: "Geri dönüş oranı kampanya kalitesine ve gecikme süresine çok bağlı; uzun süre geçmiş müşterilerde oran düşer.",
    };
  }

  if (scenario === "reduce_cancellations") {
    const c = computeCancellationStats(ds, last90, yesterday);
    if (c.totalBookings < 5) return { no_data: true, message: "İptal analizi için yeterli veri yok." };
    const monthlyLost = c.lostRevenue / 3;
    return {
      scenario,
      assumptions: `Son 90 günde kaybedilen ${c.lostRevenue} TL'nin aylık ortalaması baz alındı; kayıp %${percent} azalıyor.`,
      current_loss_rate_percent: c.lossRatePercent,
      monthly_lost_revenue_now: money(monthlyLost),
      monthly_revenue_recovered: money(monthlyLost * (percent / 100)),
      worst_weekday: c.byWeekday[0] ?? null,
      caution: "Kurtarılan randevu yeniden doldurulabilirse gerçekleşir; son dakika iptalde slotu başka müşteriyle doldurmak (bekleme listesi) kritik.",
    };
  }

  if (scenario === "sell_packages") {
    const candidates = findPackageCandidates(ds);
    if (candidates.length === 0) return { no_data: true, message: "Paket adayı müşteri bulunamadı (aynı hizmeti 90 günde 3+ kez alan)." };
    const potential = candidates.reduce((s, c) => s + c.spendLast90Days, 0);
    return {
      scenario,
      assumptions: `${candidates.length} adayın %${percent}'i, 90 günlük harcamasına denk bir paket alıyor.`,
      candidates: candidates.length,
      upfront_cash_collected: money(potential * (percent / 100)),
      note: "Bu yeni ciro değil, ön tahsilattır; asıl kazanç müşteriyi bağlaması ve nakit akışıdır. Paket satışı Kasa'da satış anında ciroya yazılır.",
      top_candidates: candidates.slice(0, 5),
    };
  }

  return { error: "Bilinmeyen senaryo. Geçerli: price_change, fill_quiet_slots, winback_customers, reduce_cancellations, sell_packages." };
}

function planRevenueTarget(ds: InsightDataset, input: Record<string, unknown>) {
  const target = Number(input.target_tl ?? 0);
  if (!(target > 0)) return { error: "Geçerli bir hedef tutar (TL) gerekli." };
  const rr = computeRunRate(ds);
  const remaining = Math.max(0, target - rr.mtdRevenue);
  const neededPerDay = rr.remainingOpenDays > 0 ? remaining / rr.remainingOpenDays : null;
  const pulse = buildPulse(ds);
  return {
    target_tl: money(target),
    month_to_date_revenue: rr.mtdRevenue,
    remaining_to_target: money(remaining),
    remaining_open_days: rr.remainingOpenDays,
    required_revenue_per_open_day: neededPerDay !== null ? money(neededPerDay) : null,
    current_avg_revenue_per_open_day: rr.avgPerOpenDay,
    projected_month_end_at_current_pace: rr.projection,
    already_booked_ahead_value: rr.bookedAhead,
    gap_vs_projection: rr.projection !== null ? money(target - rr.projection) : null,
    last_month_revenue: rr.lastMonthRevenue,
    achievable_assessment:
      rr.projection === null
        ? "Tempo tahmini için yeterli gün yok."
        : rr.projection >= target
          ? "Mevcut tempoyla hedefe ulaşılıyor."
          : `Mevcut tempoyla ${money(target - rr.projection)} TL açık var.`,
    biggest_levers: pulse.opportunities
      .filter((o) => o.impactTL !== null)
      .slice(0, 4)
      .map((o) => ({ title: o.title, monthly_impact_tl: o.impactTL, assumption: o.impactNote })),
    note: "Kaldıraç etkileri aylık tam etki tahminidir; ayın kalan günlerinde gerçekleşecek pay daha düşüktür.",
  };
}
