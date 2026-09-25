import * as Sentry from "@sentry/nextjs";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dayRangeUtcISO, dateKeyFromIso, addDaysToKey, formatTL } from "@/lib/date";
import {
  computeDayFacts,
  computeOccupancy,
  computeProfit,
  computeRevenue,
  loadInsightsDataset,
} from "@/lib/businessInsights";
import { buildPulse } from "@/lib/opportunities";
import { generateBriefNarrative } from "@/lib/ai/financeBrief";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/** İptal edilmeyen randevuların (final_price varsa o, yoksa planned_price) toplamı + o aralıktaki ürün/ek satışlar — uygulama genelinde tek ciro kuralı. */
export async function computeRevenueForRange(admin: AdminClient, businessId: string, startUtc: string, endUtc: string): Promise<number> {
  const fromKey = dateKeyFromIso(startUtc);
  const toKey = addDaysToKey(dateKeyFromIso(endUtc), -1);

  const [{ data }, { data: salesData }, { data: packagesData }] = await Promise.all([
    admin
      .from("appointments")
      .select("status, appointment_services(planned_price, final_price)")
      .eq("business_id", businessId)
      .gte("starts_at", startUtc)
      .lt("starts_at", endUtc),
    admin
      .from("one_time_sales")
      .select("amount")
      .eq("business_id", businessId)
      .gte("sale_date", fromKey)
      .lte("sale_date", toKey),
    admin
      .from("customer_packages")
      .select("price")
      .eq("business_id", businessId)
      .gte("sale_date", fromKey)
      .lte("sale_date", toKey),
  ]);

  const appointmentRevenue = (data ?? [])
    .filter((row) => row.status !== "cancelled")
    .reduce(
      (sum, row) =>
        sum + row.appointment_services.reduce((s, svc) => s + Number(svc.final_price ?? svc.planned_price), 0),
      0
    );
  const salesRevenue = (salesData ?? []).reduce((sum, s) => sum + Number(s.amount), 0);
  const packagesRevenue = (packagesData ?? []).reduce((sum, p) => sum + Number(p.price), 0);

  return appointmentRevenue + salesRevenue + packagesRevenue;
}

export interface NightlySummaryResult {
  businessId: string;
  created: boolean;
  reason: string;
  error?: string;
}

function signedPercent(value: number, baseline: number): string | null {
  if (baseline <= 0) return null;
  const pct = Math.round(((value - baseline) / baseline) * 100);
  return `${pct >= 0 ? "+" : "-"}%${Math.abs(pct)}`;
}

/**
 * Günlük Finans Özeti. Önceden sadece 3 rakamdan tek cümlelik bir yorumdu ve yalnızca %25'ten
 * büyük sapmada çıkıyordu. Şimdi HER gün (dün hiç hareket yoksa hariç): rakamların hepsi KODLA
 * hesaplanır (AI rakam üretmez), sadece başlık cümlesi ve tek bir somut öneriyi AI yazar.
 *
 * `suggestion` alanının biçimi (dashboard bunu ayrıştırıp düzenli gösterir; eski tek satırlık
 * notlar da düz metin olarak gösterilmeye devam eder):
 *   <başlık cümlesi>
 *   • <rakam satırı> ...
 *   Öneri: <somut öneri>
 */
export async function runNightlySummaryForBusiness(businessId: string): Promise<NightlySummaryResult> {
  const admin = createAdminSupabaseClient();

  const { data: todaysNotes } = await admin
    .from("action_objects")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", "finance_note")
    .gte("created_at", dayRangeUtcISO(0).startUtc)
    .lt("created_at", dayRangeUtcISO(0).endUtc)
    .limit(1);
  if (todaysNotes && todaysNotes.length > 0) {
    return { businessId, created: false, reason: "bugün için zaten bir finans notu oluşturulmuş" };
  }

  const ds = await loadInsightsDataset(admin, businessId);
  const yesterdayKey = addDaysToKey(ds.todayKey, -1);
  const day = computeDayFacts(ds, yesterdayKey);

  if (day.revenue.total === 0 && day.appointments === 0 && day.cancelled === 0 && day.noShows === 0) {
    return { businessId, created: false, reason: "dün hiç hareket yok, özet üretilmedi" };
  }

  const lastWeekKey = addDaysToKey(yesterdayKey, -7);
  const lastWeekRevenue = computeRevenue(ds, lastWeekKey, lastWeekKey).total;
  const sameWeekdayRevenues = [7, 14, 21, 28]
    .map((n) => computeRevenue(ds, addDaysToKey(yesterdayKey, -n), addDaysToKey(yesterdayKey, -n)).total)
    .filter((v) => v > 0);
  const sameWeekdayAvg =
    sameWeekdayRevenues.length >= 2 ? sameWeekdayRevenues.reduce((s, v) => s + v, 0) / sameWeekdayRevenues.length : null;

  const monthStart = `${yesterdayKey.slice(0, 8)}01`;
  const mtd = computeProfit(ds, monthStart, yesterdayKey);
  const hasExpenses = ds.fixedExpenses.length > 0 || ds.oneTimeExpenses.length > 0;

  const todayOcc = computeOccupancy(ds, ds.todayKey, ds.todayKey);
  const todayBooked = ds.appointments.filter((a) => a.status !== "cancelled" && dateKeyFromIso(a.starts_at) === ds.todayKey).length;

  const facts: string[] = [];

  const parts: string[] = [];
  if (day.revenue.products > 0 || day.revenue.packages > 0) {
    parts.push(`randevu ${formatTL(Math.round(day.revenue.appointments))}`);
    if (day.revenue.products > 0) parts.push(`ürün ${formatTL(Math.round(day.revenue.products))}`);
    if (day.revenue.packages > 0) parts.push(`paket ${formatTL(Math.round(day.revenue.packages))}`);
  }
  const vsLastWeek = signedPercent(day.revenue.total, lastWeekRevenue);
  facts.push(
    `Ciro: ${formatTL(Math.round(day.revenue.total))}` +
      (parts.length > 0 ? ` (${parts.join(" · ")})` : "") +
      (vsLastWeek ? ` — geçen haftanın aynı gününe göre ${vsLastWeek} (${formatTL(Math.round(lastWeekRevenue))})` : "")
  );
  if (sameWeekdayAvg !== null) {
    const vsAvg = signedPercent(day.revenue.total, sameWeekdayAvg);
    facts.push(`Son haftaların ${day.weekdayLabel} ortalaması: ${formatTL(Math.round(sameWeekdayAvg))}${vsAvg ? ` (dün ${vsAvg})` : ""}`);
  }
  facts.push(`Randevu: ${day.appointments} tamamlandı · ${day.cancelled} iptal · ${day.noShows} gelmedi`);
  if (day.topService || day.topStaff) {
    const bits: string[] = [];
    if (day.topService) bits.push(`en çok kazandıran hizmet ${day.topService.name} (${formatTL(day.topService.revenue)})`);
    if (day.topStaff) bits.push(`en yoğun personel ${day.topStaff.name} (${day.topStaff.count} hizmet)`);
    facts.push(bits.join(" · ").replace(/^./, (c) => c.toUpperCase()));
  }
  facts.push(
    `Ay başından beri: ${formatTL(Math.round(mtd.revenue.total))} ciro` +
      (hasExpenses ? `, tahmini net kâr ${formatTL(Math.round(mtd.netProfit))}` : "")
  );
  if (todayOcc.percent !== null) {
    facts.push(`Bugün: ${todayBooked} randevu, doluluk %${todayOcc.percent}`);
  }

  const pulse = buildPulse(ds);
  const top = pulse.opportunities[0];

  const narrative = await generateBriefNarrative({
    businessName: ds.business.name,
    weekdayLabel: day.weekdayLabel,
    factsText: facts.map((f) => `- ${f}`).join("\n"),
    topOpportunity: top ? `${top.title}. ${top.detail}` : null,
  });

  const fallbackHeadline = vsLastWeek
    ? `Dün ciro ${formatTL(Math.round(day.revenue.total))} oldu; geçen haftanın aynı gününe göre ${vsLastWeek}.`
    : `Dün ciro ${formatTL(Math.round(day.revenue.total))} oldu.`;
  const headline = narrative?.headline ?? fallbackHeadline;
  // Yapay zeka cevap veremezse (kota/yavaşlık) yedek: en değerli fırsata yönlendiren, eyleme dönük bir cümle.
  const recommendation = narrative?.recommendation ?? (top ? `Fırsat Radarı'ndaki "${top.title}" fırsatına bugün göz atın.` : null);

  const suggestion = [headline, ...facts.map((f) => `• ${f}`), ...(recommendation ? [`Öneri: ${recommendation}`] : [])].join("\n");

  const { error: insertError } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "finance_note",
    suggestion,
    reasoning: `Dün: ${Math.round(day.revenue.total)} TL, geçen hafta aynı gün: ${Math.round(lastWeekRevenue)} TL` +
      (sameWeekdayAvg !== null ? `, aynı gün ortalaması: ${Math.round(sameWeekdayAvg)} TL` : ""),
    expected_impact: top?.impactTL ? `≈ ${formatTL(top.impactTL)}/ay (${top.title})` : null,
    status: "auto_sent",
  });
  if (insertError) throw insertError;

  return { businessId, created: true, reason: "günlük finans özeti oluşturuldu" };
}

export async function runNightlySummaryForAllBusinesses(): Promise<NightlySummaryResult[]> {
  const admin = createAdminSupabaseClient();
  const { data: businesses, error } = await admin.from("businesses").select("id").eq("is_active", true);
  if (error) throw error;

  const results: NightlySummaryResult[] = [];
  for (const b of businesses ?? []) {
    try {
      results.push(await runNightlySummaryForBusiness(b.id));
    } catch (err) {
      // Bir işletmenin bozuk verisi diğerlerinin gece işini durdurmasın.
      console.error("nightly summary failed for business", b.id, err);
      Sentry.captureException(err);
      results.push({
        businessId: b.id,
        created: false,
        reason: "beklenmeyen hata",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
