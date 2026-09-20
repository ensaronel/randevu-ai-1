import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR, dayRangeUtcISO, formatTL } from "@/lib/date";
import { getBusinessName } from "@/lib/businessName";
import { dedupeReasoning, hasDedupeFired } from "@/lib/dedupe";
import { computeRevenueForRange } from "@/lib/nightlySummary";
import type { ShareImagePayload } from "@/lib/ai/shareImage";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

// İşletme-geneli (kişi bazlı DEĞİL, hiçbir müşteri adı içermez — halka açık paylaşımda
// gizlilik riski olmasın diye) kilometre taşı eşikleri.
const BUSINESS_MILESTONES = [100, 250, 500, 1000, 2000, 5000, 10000];

// Rekor gün için en az bu kadar mutabakatlı geçmiş gün olmalı, yoksa "rekor" demek
// (ör. işletmenin 2. günü) anlamsız/yanıltıcı olur.
const MIN_HISTORY_DAYS_FOR_RECORD = 4;
const RECORD_DAY_LOOKBACK_DAYS = 30;

async function insertAchievement(
  admin: AdminClient,
  businessId: string,
  args: {
    dedupeKey: string;
    reasoningDetail: string;
    suggestion: string;
    shareImage: ShareImagePayload;
  }
): Promise<void> {
  const { error } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "achievement_moment",
    suggestion: args.suggestion,
    reasoning: dedupeReasoning(args.dedupeKey, args.reasoningDetail),
    status: "auto_sent",
    share_image: args.shareImage,
  });
  if (error) throw error;
}

/**
 * İşletmenin TOPLAM tamamlanmış (`attendance='came'`) randevu sayısı yuvarlak bir
 * eşiğe ulaştığında, İSİM İÇERMEYEN bir kilometre taşı kutlaması üretir. Önceden bu,
 * belirli bir müşterinin Nth randevusunu (gerçek adıyla) kutluyordu — halka açık
 * paylaşımda gizlilik riski olduğu için işletme-geneli, isimsiz bir kutlamaya
 * dönüştürüldü (bkz. proje kararları). En yüksek geçilmiş ama henüz kutlanmamış
 * eşiği bulur, aynı anda birden fazla eşik geçilse bile sadece birini kutlar.
 */
export async function runBusinessMilestoneCheckForBusiness(businessId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient();

  const { count, error } = await admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("attendance", "came");
  if (error) throw error;
  if (!count) return false;

  const eligible = [...BUSINESS_MILESTONES].reverse().filter((m) => count >= m);
  for (const threshold of eligible) {
    const dedupeKey = `business_milestone:${threshold}`;
    if (await hasDedupeFired(admin, businessId, "achievement_moment", dedupeKey)) continue;

    const businessName = await getBusinessName(admin, businessId);
    await insertAchievement(admin, businessId, {
      dedupeKey,
      reasoningDetail: `işletme toplam ${count} randevuya ulaştı (kilometre taşı: ${threshold}).`,
      suggestion: `İşletmeniz toplam ${threshold}. randevusunu tamamladı — kutlamaya değer bir kilometre taşı!`,
      shareImage: {
        accent: "amber",
        businessName,
        eyebrow: "Kilometre Taşı",
        big: `${threshold}.`,
        bigSub: "Randevu",
        subtitle: "Bugüne kadar bize güvenen herkese teşekkürler! 💛",
        contextLine: "Randevu AI ile büyüyoruz",
        waving: true,
      },
    });
    return true;
  }

  return false;
}

/**
 * Dünün cirosu son `RECORD_DAY_LOOKBACK_DAYS` günün rekoruysa bir "Başarı Anı" üretir.
 * Ciro, uygulama genelindeki TEK ciro kuralıyla (bkz. `computeRevenueForRange`,
 * nightlySummary.ts'in finans notu için kullandığı gerçek/canlı hesaplama — final_price
 * varsa o, yoksa planned_price) doğrudan randevulardan hesaplanır. ÖNEMLİ: bu fonksiyon
 * önceden hiç var olmayan bir "Günü Kapat" özelliğine (`daily_financial_summaries`
 * tablosu, hiçbir yerde yazılmıyor — 2026-09-20'de doğrulandı) bağımlıydı, bu yüzden
 * PRATİKTE HİÇ TETİKLENMİYORDU; artık gerçek veriye bağlı. Gerçek TL rakamı SADECE
 * `reasoning`de (denetim amaçlı, hiçbir yerde render edilmiyor) tutulur — halka açık
 * görselde/metinde ciro rakamı YOK (bkz. proje kararları).
 */
export async function runRecordDayCheckForBusiness(businessId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient();
  const yesterdayKey = dateKeyTR(-1);

  const yesterdayRange = dayRangeUtcISO(-1);
  const yesterdayRevenue = await computeRevenueForRange(admin, businessId, yesterdayRange.startUtc, yesterdayRange.endUtc);
  if (yesterdayRevenue <= 0) return false;

  const history: number[] = [];
  for (let offset = 2; offset <= RECORD_DAY_LOOKBACK_DAYS + 1; offset++) {
    const dayRange = dayRangeUtcISO(-offset);
    const revenue = await computeRevenueForRange(admin, businessId, dayRange.startUtc, dayRange.endUtc);
    if (revenue > 0) history.push(revenue);
  }
  if (history.length < MIN_HISTORY_DAYS_FOR_RECORD) return false;

  const previousMax = Math.max(...history);
  if (yesterdayRevenue <= previousMax) return false;

  const dedupeKey = `record_day:${yesterdayKey}`;
  if (await hasDedupeFired(admin, businessId, "achievement_moment", dedupeKey)) return false;

  const businessName = await getBusinessName(admin, businessId);
  await insertAchievement(admin, businessId, {
    dedupeKey,
    reasoningDetail: `dünkü ciro ${formatTL(yesterdayRevenue)}, önceki ${history.length} günün rekoru ${formatTL(previousMax)} idi.`,
    suggestion: "Dün son 30 günün en yoğun günüydü — bize güvenen herkese teşekkürler!",
    shareImage: {
      accent: "amber",
      businessName,
      eyebrow: "Ayın Rekoru",
      big: "Rekor Gün!",
      subtitle: "Dün ayın en yoğun günlerinden biriydi, bize güvenen herkese teşekkürler! 🎉",
      contextLine: "Randevu AI ile büyüyoruz",
      waving: true,
    },
  });
  return true;
}
