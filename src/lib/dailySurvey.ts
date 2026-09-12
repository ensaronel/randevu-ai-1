import * as Sentry from "@sentry/nextjs";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dayRangeUtcISO, dateKeyTR } from "@/lib/date";

/**
 * Gün sonu cron'unda çağrılır (bkz. vercel.json). O gün en az bir randevusu
 * gerçekleşmiş (iptal olmayan, saati geçmiş) işletmeler için, kapanışta müşterilere
 * bir anket/öneri mesajı gönderilsin mi diye SORAN tek bir öneri kartı üretir —
 * otomatik gönderilmez, owner onaylayınca /api/action-objects/[id] o günkü TÜM
 * müşterilere fan-out yapar (bkz. o dosyadaki daily_survey özel dalı).
 */
export async function runDailySurveyForBusiness(businessId: string): Promise<{ created: boolean; customerCount?: number }> {
  const admin = createAdminSupabaseClient();
  const { startUtc, endUtc } = dayRangeUtcISO(0);

  const { data: existing } = await admin
    .from("action_objects")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", "daily_survey")
    .gte("created_at", startUtc)
    .limit(1);
  if (existing && existing.length > 0) return { created: false };

  const { data: appts } = await admin
    .from("appointments")
    .select("customer_id")
    .eq("business_id", businessId)
    .neq("status", "cancelled")
    .gte("starts_at", startUtc)
    .lt("starts_at", endUtc)
    .lt("starts_at", new Date().toISOString());

  const uniqueCustomerIds = new Set((appts ?? []).map((a) => a.customer_id));
  if (uniqueCustomerIds.size === 0) return { created: false };

  await admin.from("action_objects").insert({
    business_id: businessId,
    type: "daily_survey",
    suggestion: `Bugün ${uniqueCustomerIds.size} müşteri geldi — kapanışta hepsine kısa bir anket/öneri mesajı gönderilsin mi?`,
    customer_message: null,
    reasoning: `${dateKeyTR(0)} tarihinde randevusu olan ${uniqueCustomerIds.size} müşteri.`,
    status: "pending",
  });

  return { created: true, customerCount: uniqueCustomerIds.size };
}

export async function runDailySurveyForAllBusinesses(): Promise<{ businessId: string; created: boolean; error?: string }[]> {
  const admin = createAdminSupabaseClient();
  const { data: businesses, error } = await admin.from("businesses").select("id").eq("is_active", true);
  if (error) throw error;

  const results: { businessId: string; created: boolean; error?: string }[] = [];
  for (const b of businesses ?? []) {
    try {
      const { created } = await runDailySurveyForBusiness(b.id);
      results.push({ businessId: b.id, created });
    } catch (err) {
      console.error("daily survey failed for business", b.id, err);
      Sentry.captureException(err);
      results.push({ businessId: b.id, created: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
