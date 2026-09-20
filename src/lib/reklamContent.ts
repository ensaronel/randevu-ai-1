import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { runAvailableSlotsAnnouncementForBusiness } from "@/lib/ai/availableSlotsContent";
import { runSocialProofForBusiness } from "@/lib/ai/socialProofContent";
import { runSpotlightContentForBusiness, runTipContentForBusiness } from "@/lib/dailyContent";
import { runRecordDayCheckForBusiness, runBusinessMilestoneCheckForBusiness } from "@/lib/achievements";
import { runLowDemandCampaignCheckForBusiness } from "@/lib/ai/lowDemandCampaign";
import { sendPushToBusiness } from "@/lib/push";

/** Esnek 5. slot — öncelik sırayla, ilk uyan kazanır, günde en fazla biri tetiklenir. */
async function runFlexibleEventSlot(businessId: string): Promise<boolean> {
  if (await runRecordDayCheckForBusiness(businessId)) return true;
  if (await runBusinessMilestoneCheckForBusiness(businessId)) return true;
  if (await runLowDemandCampaignCheckForBusiness(businessId)) return true;
  return false;
}

/**
 * Her gece (nightly cron) bir işletme için üretilebilecek en fazla 5 reklam içeriği
 * parçasını sırayla dener — her biri kendi dedupe/uygunluk kontrolünü içeride yapar,
 * uygun değilse (veri yoksa, zaten üretilmişse, olay tetiklenmediyse) sessizce atlanır.
 * Zorlama içerik yok: bazı günler 5'ten az parça üretilebilir. Üretilen parça sayısı
 * kadar TEK birleşik push gönderilir (eskiden her üretici kendi push'unu atıyordu).
 */
export async function runNightlyReklamContentForBusiness(businessId: string): Promise<number> {
  let count = 0;
  if (await runAvailableSlotsAnnouncementForBusiness(businessId)) count++;
  if (await runSocialProofForBusiness(businessId)) count++;
  if (await runSpotlightContentForBusiness(businessId)) count++;
  if (await runTipContentForBusiness(businessId)) count++;
  if (await runFlexibleEventSlot(businessId)) count++;

  if (count > 0) {
    await sendPushToBusiness(businessId, {
      title: "Bugün için yeni içerik hazır 📣",
      body: count === 1 ? "1 yeni paylaşılabilir içerik seni bekliyor." : `${count} yeni paylaşılabilir içerik seni bekliyor.`,
      url: "/reklam",
    }).catch((err) => console.error("reklam içerik push bildirimi gönderilemedi", err));
  }

  return count;
}

export async function runNightlyReklamContentForAllBusinesses(): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data: businesses, error } = await admin.from("businesses").select("id").eq("is_active", true);
  if (error) throw error;

  for (const b of businesses ?? []) {
    try {
      await runNightlyReklamContentForBusiness(b.id);
    } catch (err) {
      console.error("gecelik reklam içerik üretimi başarısız", b.id, err);
    }
  }
}
