import * as Sentry from "@sentry/nextjs";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR, dayRangeUtcISO } from "@/lib/date";
import { generateFinanceCommentary } from "@/lib/ai/financeCommentary";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/** İptal edilmeyen randevuların (final_price varsa o, yoksa planned_price) toplamı — uygulama genelinde tek ciro kuralı. */
async function computeRevenueForRange(admin: AdminClient, businessId: string, startUtc: string, endUtc: string): Promise<number> {
  const { data } = await admin
    .from("appointments")
    .select("status, appointment_services(planned_price, final_price)")
    .eq("business_id", businessId)
    .gte("starts_at", startUtc)
    .lt("starts_at", endUtc);

  return (data ?? [])
    .filter((row) => row.status !== "cancelled")
    .reduce(
      (sum, row) =>
        sum + row.appointment_services.reduce((s, svc) => s + Number(svc.final_price ?? svc.planned_price), 0),
      0
    );
}

// "Anlamlı sapma" eşiği — bunun altındaki farklar için yorum üretilmez (gürültü olmasın diye).
const DEVIATION_THRESHOLD_PERCENT = 25;
// Aylık ortalamayı anlamlı saymak için ay başından bu yana geçmesi gereken minimum gün sayısı.
const MIN_MONTHLY_SAMPLE_SIZE = 3;

export interface NightlySummaryResult {
  businessId: string;
  created: boolean;
  reason: string;
  error?: string;
}

function percentDiff(value: number, baseline: number): number | null {
  if (baseline <= 0) return null;
  return ((value - baseline) / baseline) * 100;
}

export async function runNightlySummaryForBusiness(businessId: string): Promise<NightlySummaryResult> {
  const admin = createAdminSupabaseClient();

  const yesterdayKey = dateKeyTR(-1);

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

  const yesterdayRange = dayRangeUtcISO(-1);
  const yesterdayRevenue = await computeRevenueForRange(admin, businessId, yesterdayRange.startUtc, yesterdayRange.endUtc);

  const lastWeekRange = dayRangeUtcISO(-8);
  const lastWeekRevenue = await computeRevenueForRange(admin, businessId, lastWeekRange.startUtc, lastWeekRange.endUtc);

  // Ay başından düne kadar (dün hariç, o zaten ayrı karşılaştırılıyor) günlük ortalama ciro.
  const dayOfMonth = Number(yesterdayKey.split("-")[2]);
  const daysBeforeYesterdayInMonth = dayOfMonth - 1;
  let monthlyAverageRevenue: number | null = null;
  if (daysBeforeYesterdayInMonth >= MIN_MONTHLY_SAMPLE_SIZE) {
    const monthStartUtc = dayRangeUtcISO(-dayOfMonth).startUtc;
    const monthEndUtc = yesterdayRange.startUtc;
    const monthRevenue = await computeRevenueForRange(admin, businessId, monthStartUtc, monthEndUtc);
    monthlyAverageRevenue = monthRevenue / daysBeforeYesterdayInMonth;
  }

  const diffs = [
    percentDiff(yesterdayRevenue, lastWeekRevenue),
    monthlyAverageRevenue !== null ? percentDiff(yesterdayRevenue, monthlyAverageRevenue) : null,
  ].filter((d): d is number => d !== null);

  if (diffs.length === 0) {
    return { businessId, created: false, reason: "karşılaştırma için yeterli geçmiş veri yok" };
  }

  const isMeaningful = diffs.some((d) => Math.abs(d) >= DEVIATION_THRESHOLD_PERCENT);
  if (!isMeaningful) {
    return { businessId, created: false, reason: "sapma eşiğin altında, gürültü olmasın diye yorum üretilmedi" };
  }

  const commentary = await generateFinanceCommentary({
    yesterdayRevenue,
    lastWeekSameDayRevenue: lastWeekRevenue,
    monthlyAverageRevenue,
  });

  const reasoningParts = [
    `Dün: ${Math.round(yesterdayRevenue)} TL`,
    `geçen hafta aynı gün: ${Math.round(lastWeekRevenue)} TL`,
  ];
  if (monthlyAverageRevenue !== null) reasoningParts.push(`aylık ortalama: ${Math.round(monthlyAverageRevenue)} TL`);

  const { error: insertError } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "finance_note",
    suggestion: commentary,
    reasoning: reasoningParts.join(", "),
    status: "auto_sent",
  });
  if (insertError) throw insertError;

  return { businessId, created: true, reason: "anlamlı sapma tespit edildi, yorum oluşturuldu" };
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
