import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR, formatDateTR, formatTL } from "@/lib/date";
import { sendPushToBusiness } from "@/lib/push";
import type { ShareImagePayload } from "@/lib/ai/shareImage";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

// Yalnızca gerçekten "kilometre taşı" hissi veren, seyrek eşikler — her randevuda
// tetiklenip gürültü olmasın diye.
const LOYALTY_MILESTONES = [10, 20, 50, 100, 150, 200, 300, 500];

// Rekor gün için en az bu kadar mutabakatlı geçmiş gün olmalı, yoksa "rekor" demek
// (ör. işletmenin 2. günü) anlamsız/yanıltıcı olur.
const MIN_HISTORY_DAYS_FOR_RECORD = 4;
const RECORD_DAY_LOOKBACK_DAYS = 30;

async function getBusinessName(admin: AdminClient, businessId: string): Promise<string> {
  const { data } = await admin.from("businesses").select("name").eq("id", businessId).single();
  return data?.name ?? "İşletmeniz";
}

async function insertAchievement(
  admin: AdminClient,
  businessId: string,
  args: {
    dedupeKey: string;
    relatedCustomerId?: string;
    suggestion: string;
    reasoning: string;
    shareImage: ShareImagePayload;
  }
): Promise<void> {
  const { error } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "achievement_moment",
    related_customer_id: args.relatedCustomerId ?? null,
    suggestion: args.suggestion,
    reasoning: `dedupe:${args.dedupeKey} — ${args.reasoning}`,
    status: "auto_sent",
    share_image: args.shareImage,
  });
  if (error) throw error;

  await sendPushToBusiness(businessId, {
    title: "Yeni bir başarı anın var! 🎉",
    body: args.suggestion,
    url: "/reklam",
  }).catch((err) => console.error("başarı anı push bildirimi gönderilemedi", err));
}

async function alreadyFired(admin: AdminClient, businessId: string, dedupeKey: string): Promise<boolean> {
  const { data } = await admin
    .from("action_objects")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", "achievement_moment")
    .ilike("reasoning", `dedupe:${dedupeKey} —%`)
    .limit(1);
  return !!data && data.length > 0;
}

/**
 * Bir randevu "geldi" (attendance='came') olarak işaretlendiğinde çağrılır —
 * müşterinin toplam gerçekleşmiş randevu sayısı bir sadakat eşiğine denk
 * geliyorsa paylaşılabilir bir "Başarı Anı" üretir. `src/app/api/appointments/
 * [id]/route.ts`'in PATCH handler'ından, attendance GERÇEKTEN 'came'ye
 * değiştiğinde (tekrar mutabakat aynı sayacı ikiye katlamasın diye) çağrılır.
 */
export async function checkLoyaltyMilestoneOnAttendance(businessId: string, customerId: string): Promise<void> {
  const admin = createAdminSupabaseClient();

  const { count, error: countError } = await admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("attendance", "came");
  if (countError) throw countError;
  if (!count || !LOYALTY_MILESTONES.includes(count)) return;

  const dedupeKey = `loyalty:${customerId}:${count}`;
  if (await alreadyFired(admin, businessId, dedupeKey)) return;

  const { data: customer } = await admin.from("customers").select("full_name").eq("id", customerId).single();
  const customerName = customer?.full_name ?? "Bir müşteriniz";
  const businessName = await getBusinessName(admin, businessId);

  await insertAchievement(admin, businessId, {
    dedupeKey,
    relatedCustomerId: customerId,
    suggestion: `${customerName} ${count}. randevusuna geldi — paylaşmaya değer bir sadakat anı!`,
    reasoning: `${customerName} toplam ${count} kez randevuya geldi (sadakat eşiği).`,
    shareImage: {
      accent: "amber",
      businessName,
      eyebrow: "Sadakat Anı",
      big: `${count}.`,
      bigSub: "Randevusu",
      subtitle: `${customerName} seni ${count}. kez tercih etti, ne büyük bir güven! 💛`,
      contextLine: formatDateTR(`${dateKeyTR(0)}T12:00:00+03:00`),
      waving: false,
    },
  });
}

/**
 * Gece cronunda (nightlySummary ile aynı çalışma), her işletme için dünün
 * mutabakatlı cirosu son `RECORD_DAY_LOOKBACK_DAYS` günün rekoruysa bir
 * "Başarı Anı" üretir. Ham appointments toplamı yerine bilerek gün sonu
 * mutabakatından (`daily_financial_summaries`, "Günü Kapat") gelen kesin
 * rakamı kullanıyor — henüz kapatılmamış bir gün "rekor" ilan edilmesin.
 */
export async function runRecordDayCheckForBusiness(businessId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const yesterdayKey = dateKeyTR(-1);

  const { data: yesterdayRow } = await admin
    .from("daily_financial_summaries")
    .select("actual_revenue, reconciled_at")
    .eq("business_id", businessId)
    .eq("summary_date", yesterdayKey)
    .maybeSingle();
  if (!yesterdayRow?.reconciled_at) return; // dün henüz "Günü Kapat" yapılmamış

  const yesterdayRevenue = Number(yesterdayRow.actual_revenue);
  if (yesterdayRevenue <= 0) return;

  const lookbackStart = new Date(Date.now() - RECORD_DAY_LOOKBACK_DAYS * 24 * 60 * 60000).toISOString().slice(0, 10);
  const { data: history } = await admin
    .from("daily_financial_summaries")
    .select("actual_revenue")
    .eq("business_id", businessId)
    .neq("summary_date", yesterdayKey)
    .gte("summary_date", lookbackStart)
    .not("reconciled_at", "is", null);

  if (!history || history.length < MIN_HISTORY_DAYS_FOR_RECORD) return;

  const previousMax = Math.max(...history.map((row) => Number(row.actual_revenue)));
  if (yesterdayRevenue <= previousMax) return;

  const dedupeKey = `record_day:${yesterdayKey}`;
  if (await alreadyFired(admin, businessId, dedupeKey)) return;

  const businessName = await getBusinessName(admin, businessId);

  await insertAchievement(admin, businessId, {
    dedupeKey,
    suggestion: `Dün son ${RECORD_DAY_LOOKBACK_DAYS} günün en yüksek cirolu günüydü — ${formatTL(yesterdayRevenue)}!`,
    reasoning: `Dünkü ciro ${formatTL(yesterdayRevenue)}, önceki ${history.length} günün rekoru ${formatTL(previousMax)} idi.`,
    shareImage: {
      accent: "amber",
      businessName,
      eyebrow: "Ayın Rekoru",
      big: formatTL(yesterdayRevenue),
      bigSub: "Ciro",
      subtitle: "Dün ayın en yoğun günüydü! 🎉",
      contextLine: formatDateTR(`${yesterdayKey}T12:00:00+03:00`),
      waving: true,
    },
  });
}

export async function runAchievementChecksForAllBusinesses(): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data: businesses, error } = await admin.from("businesses").select("id").eq("is_active", true);
  if (error) throw error;

  for (const b of businesses ?? []) {
    try {
      await runRecordDayCheckForBusiness(b.id);
    } catch (err) {
      console.error("başarı anı (rekor gün) kontrolü başarısız", b.id, err);
    }
  }
}
