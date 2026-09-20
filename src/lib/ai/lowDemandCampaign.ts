import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getBusinessName } from "@/lib/businessName";
import { generateCampaignSuggestion } from "@/lib/ai/campaignSuggestion";
import type { ShareImagePayload } from "@/lib/ai/shareImage";

// Art arda spam olmasın diye: son bu kadar gün içinde herhangi bir kampanya
// üretildiyse yeni bir tane üretilmez (mevcut nightlySummary.ts'teki ciro-spike
// kampanyasından devralınan throttle, bkz. proje geçmişi).
const CAMPAIGN_SUGGESTION_DEDUP_DAYS = 7;

const LAST_WINDOW_DAYS = 7;
const BASELINE_WINDOW_DAYS = 28;
// Gürültülü sinyale karşı: geçmişte haftada ortalama en az bu kadar randevu almamış
// bir hizmet için "düşüş" hesaplamak anlamsız (ör. haftada 1 randevu alan bir hizmet
// bu hafta 0 aldı diye "belirgin düşüş" denemez).
const MIN_WEEKLY_AVG_FOR_SIGNAL = 2;
// Önceki haftalık ortalamaya göre bu oranın ALTINDA kalan hizmet "az talep görüyor" sayılır.
const LOW_DEMAND_DROP_RATIO = 0.4;

/**
 * Bir hizmetin son 7 günkü randevu sayısı, önceki 4 haftalık ortalamasının belirgin
 * altındaysa (LOW_DEMAND_DROP_RATIO), o hizmete dikkat çeken bir mini kampanya taslağı
 * üretir. Ciro/yüzde gibi rakamlar görselde/metinde YER ALMAZ — sadece genel bir teşvik
 * metni ve hizmet adı (gerçek veri).
 */
export async function runLowDemandCampaignCheckForBusiness(businessId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient();

  const since = new Date(Date.now() - CAMPAIGN_SUGGESTION_DEDUP_DAYS * 24 * 60 * 60000).toISOString();
  const { data: recent } = await admin
    .from("action_objects")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", "campaign_suggestion")
    .gte("created_at", since)
    .limit(1);
  if (recent && recent.length > 0) return false;

  const { data: services } = await admin
    .from("services")
    .select("id, name")
    .eq("business_id", businessId)
    .eq("status", "active");
  if (!services || services.length === 0) return false;

  const totalWindowDays = LAST_WINDOW_DAYS + BASELINE_WINDOW_DAYS;
  const fromIso = new Date(Date.now() - totalWindowDays * 24 * 60 * 60000).toISOString();
  const lastWindowStartIso = new Date(Date.now() - LAST_WINDOW_DAYS * 24 * 60 * 60000).toISOString();

  const { data: appointments } = await admin
    .from("appointments")
    .select("starts_at, appointment_services(service_id)")
    .eq("business_id", businessId)
    .gte("starts_at", fromIso)
    .neq("status", "cancelled");

  const last7Counts = new Map<string, number>();
  const baselineCounts = new Map<string, number>();
  for (const appt of appointments ?? []) {
    const inLastWindow = appt.starts_at >= lastWindowStartIso;
    for (const svc of (appt as { appointment_services: { service_id: string }[] }).appointment_services ?? []) {
      const bucket = inLastWindow ? last7Counts : baselineCounts;
      bucket.set(svc.service_id, (bucket.get(svc.service_id) ?? 0) + 1);
    }
  }

  let worst: { service: { id: string; name: string }; dropRatio: number } | null = null;
  for (const service of services) {
    const avgWeekly = (baselineCounts.get(service.id) ?? 0) / (BASELINE_WINDOW_DAYS / 7);
    if (avgWeekly < MIN_WEEKLY_AVG_FOR_SIGNAL) continue;

    const last7 = last7Counts.get(service.id) ?? 0;
    const dropRatio = (avgWeekly - last7) / avgWeekly;
    if (dropRatio < LOW_DEMAND_DROP_RATIO) continue;

    if (!worst || dropRatio > worst.dropRatio) worst = { service, dropRatio };
  }
  if (!worst) return false;

  const businessName = await getBusinessName(admin, businessId);
  const draft = await generateCampaignSuggestion({
    businessName,
    situationDescription: `"${worst.service.name}" hizmetine son 7 günde daha az talep var (haftalık ortalamaya göre belirgin düşüş)`,
  });

  const shareImage: ShareImagePayload = {
    accent: "rose",
    businessName,
    eyebrow: "Fırsat",
    big: worst.service.name,
    subtitle: draft.message,
    contextLine: `Hedef kitle: ${draft.targetSegment}`,
  };

  const { error } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "campaign_suggestion",
    suggestion: draft.message,
    reasoning: `"${worst.service.name}" son 7 günde %${Math.round(worst.dropRatio * 100)} daha az talep gördü (düşük talep kampanyası). Önerilen hedef kitle: ${draft.targetSegment}.`,
    status: "pending",
    share_image: shareImage,
  });
  if (error) throw error;
  return true;
}
