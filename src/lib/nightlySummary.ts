import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR, dayRangeUtcISO } from "@/lib/date";
import { generateFinanceCommentary } from "@/lib/ai/financeCommentary";

// "Anlamlı sapma" eşiği — bunun altındaki farklar için yorum üretilmez (gürültü olmasın diye).
const DEVIATION_THRESHOLD_PERCENT = 25;
// Aylık ortalamayı anlamlı saymak için gereken minimum mutabakatlı gün sayısı.
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
  const lastWeekKey = dateKeyTR(-8);
  const [year, month] = yesterdayKey.split("-");
  const monthStartKey = `${year}-${month}-01`;

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

  const { data: yesterdaySummary } = await admin
    .from("daily_financial_summaries")
    .select("actual_revenue, reconciled_at")
    .eq("business_id", businessId)
    .eq("summary_date", yesterdayKey)
    .maybeSingle();

  if (!yesterdaySummary || !yesterdaySummary.reconciled_at) {
    return { businessId, created: false, reason: "dün için gün sonu mutabakatı yapılmamış" };
  }
  const yesterdayRevenue = Number(yesterdaySummary.actual_revenue);

  const { data: lastWeekSummary } = await admin
    .from("daily_financial_summaries")
    .select("actual_revenue")
    .eq("business_id", businessId)
    .eq("summary_date", lastWeekKey)
    .not("reconciled_at", "is", null)
    .maybeSingle();
  const lastWeekRevenue = lastWeekSummary ? Number(lastWeekSummary.actual_revenue) : null;

  const { data: monthRows } = await admin
    .from("daily_financial_summaries")
    .select("actual_revenue")
    .eq("business_id", businessId)
    .gte("summary_date", monthStartKey)
    .lt("summary_date", yesterdayKey)
    .not("reconciled_at", "is", null);
  const monthlyAverageRevenue =
    monthRows && monthRows.length >= MIN_MONTHLY_SAMPLE_SIZE
      ? monthRows.reduce((sum, r) => sum + Number(r.actual_revenue), 0) / monthRows.length
      : null;

  const diffs = [
    lastWeekRevenue !== null ? percentDiff(yesterdayRevenue, lastWeekRevenue) : null,
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

  const reasoningParts = [`Dün: ${Math.round(yesterdayRevenue)} TL`];
  if (lastWeekRevenue !== null) reasoningParts.push(`geçen hafta aynı gün: ${Math.round(lastWeekRevenue)} TL`);
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
