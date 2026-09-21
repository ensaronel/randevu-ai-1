import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadBusinessContext } from "@/lib/ai/context";
import { findAvailableSlots } from "@/lib/ai/availability";
import { generateAvailableSlotsCaption } from "@/lib/ai/availableSlotsCaption";
import { getBusinessName } from "@/lib/businessName";
import { dedupeReasoning, hasDedupeFired } from "@/lib/dedupe";
import { dateKeyTR, formatTimeTR } from "@/lib/date";
import type { ShareImagePayload } from "@/lib/ai/shareImage";
import type { Appointment, AppointmentService, Service } from "@/types/database";

const LOOKBACK_DAYS_FOR_POPULAR_SERVICE = 30;

/** İşletmenin son 30 gündeki en çok randevu alan aktif hizmeti — boş saat duyurusunu
 * rastgele bir hizmet yerine gerçekten talep gören bir hizmet üzerinden yapmak için.
 * Hiç geçmiş randevu yoksa en eski eklenen aktif hizmete düşer (deterministik). */
async function pickRepresentativeService(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  businessId: string,
  services: Service[]
): Promise<Service | null> {
  if (services.length === 0) return null;
  if (services.length === 1) return services[0];

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS_FOR_POPULAR_SERVICE * 24 * 60 * 60000).toISOString();
  const { data } = await admin
    .from("appointments")
    .select("appointment_services(service_id)")
    .eq("business_id", businessId)
    .gte("starts_at", cutoff)
    .neq("status", "cancelled");

  const counts = new Map<string, number>();
  for (const appt of data ?? []) {
    for (const svc of (appt as { appointment_services: { service_id: string }[] }).appointment_services ?? []) {
      counts.set(svc.service_id, (counts.get(svc.service_id) ?? 0) + 1);
    }
  }

  const activeIds = new Set(services.map((s) => s.id));
  const ranked = [...counts.entries()]
    .filter(([id]) => activeIds.has(id))
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return [...services].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  }
  return services.find((s) => s.id === ranked[0][0]) ?? services[0];
}

async function findSlotsForDay(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  businessId: string,
  dateKey: string,
  service: Service,
  ctx: Awaited<ReturnType<typeof loadBusinessContext>>
) {
  const { data: appointments } = await admin
    .from("appointments")
    .select("*, appointment_services(*)")
    .eq("business_id", businessId)
    .gte("starts_at", `${dateKey}T00:00:00+03:00`)
    .lt("starts_at", `${dateKey}T23:59:59+03:00`);

  return findAvailableSlots({
    business: ctx.business,
    requestedServices: [service],
    staff: ctx.staff,
    expertise: ctx.expertise,
    existingAppointments: (appointments ?? []) as (Appointment & { appointment_services: AppointmentService[] })[],
    dateKey,
  });
}

/**
 * Bugün, boşsa yarın için, işletmenin en çok talep gören hizmetinde gerçekten boş
 * saatler varsa bir "boş randevu duyurusu" üretir. İkisi de doluysa (ya da hiç aktif
 * hizmet yoksa) HİÇBİR ŞEY üretmez — doluluk iyi bir sorun, zorlama içerik yok.
 */
export async function runAvailableSlotsAnnouncementForBusiness(businessId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient();
  const todayKey = dateKeyTR(0);

  if (await hasDedupeFired(admin, businessId, "available_slots", `available_slots:${todayKey}`)) return false;

  const ctx = await loadBusinessContext(businessId);
  const service = await pickRepresentativeService(admin, businessId, ctx.services);
  if (!service) return false;

  const days: { dateKey: string; dayLabel: "bugün" | "yarın" }[] = [
    { dateKey: dateKeyTR(0), dayLabel: "bugün" },
    { dateKey: dateKeyTR(1), dayLabel: "yarın" },
  ];

  for (const day of days) {
    const slots = await findSlotsForDay(admin, businessId, day.dateKey, service, ctx);
    if (slots.length === 0) continue;

    const businessName = await getBusinessName(admin, businessId);
    const times = slots.map((s) => formatTimeTR(s.startsAt));
    const caption = await generateAvailableSlotsCaption({
      businessName,
      serviceName: service.name,
      dayLabel: day.dayLabel,
      times,
    });

    const shareImage: ShareImagePayload = {
      kind: "slots",
      accent: "sage",
      businessName,
      eyebrow: day.dayLabel === "bugün" ? "Bugün Boş Yer Var" : "Yarın Boş Yer Var",
      big: day.dayLabel === "bugün" ? "Bugün" : "Yarın",
      bigSub: service.name,
      subtitle: caption,
      chips: times,
    };

    const { error } = await admin.from("action_objects").insert({
      business_id: businessId,
      type: "available_slots",
      suggestion: caption,
      reasoning: dedupeReasoning(
        `available_slots:${todayKey}`,
        `${day.dayLabel} için "${service.name}" hizmetinde boş saatler: ${times.join(", ")}.`
      ),
      status: "auto_sent",
      share_image: shareImage,
    });
    if (error) throw error;
    return true;
  }

  return false;
}
