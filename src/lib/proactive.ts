import * as Sentry from "@sentry/nextjs";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR, formatDateTR, formatTimeTR } from "@/lib/date";
import { sendWhatsappTemplateMessage } from "@/lib/whatsapp/client";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

function weekdayKeyForIso(iso: string): WeekdayKey {
  // Randevu saatleri zaten Türkiye yerel saatine göre girildiği için gösterim
  // amaçlı hafta günü hesaplaması burada UTC+3 offset'e ihtiyaç duymuyor —
  // appointments.starts_at'in UTC eşdeğerinden +3 kaydırıp gün adını buluyoruz.
  const turkeyMs = new Date(iso).getTime() + 3 * 60 * 60000;
  return WEEKDAY_KEYS[new Date(turkeyMs).getUTCDay()];
}

function timeOfDayMinutes(iso: string): number {
  const turkeyMs = new Date(iso).getTime() + 3 * 60 * 60000;
  const d = new Date(turkeyMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

export interface FreedSlot {
  serviceId: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Bir randevu iptal edilince boşalan (hizmet, gün/saat) ile eşleşen, sırada en
 * ÖNCE olan (created_at'e göre) TEK bekleme listesi kaydına otomatik WhatsApp
 * şablonu gönderir ve o kaydı "teklif bekliyor" olarak işaretler
 * (offered_slot/offered_at) — 2026-09-13'te owner onaylı öneri kartından tam
 * otomatiğe çevrildi (zaman hassas: yavaş kalınırsa boşluk başka şekilde
 * dolabilir). excludeEntryId, bir teklif reddedilince/zaman aşımına uğrayınca
 * AYNI boşluğu bir sonraki adaya sunarken bu kaydı tekrar denemesin diye var.
 * webhook route.ts'teki cevap işleyicisi ve cron'daki zaman aşımı temizleyici
 * de aynı fonksiyonu "sıradakine geç" için kullanır.
 */
export async function offerNextWaitlistEntry(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  businessId: string,
  slot: FreedSlot,
  excludeEntryId?: string
): Promise<boolean> {
  const weekday = weekdayKeyForIso(slot.startsAt);
  const timeMin = timeOfDayMinutes(slot.startsAt);

  const { data: candidates } = await admin
    .from("waitlist_entries")
    .select("id, customer_id, desired_time_range, customer:customers(full_name, phone), service:services(name)")
    .eq("business_id", businessId)
    .eq("status", "open")
    .eq("desired_service_id", slot.serviceId)
    .is("offered_slot", null)
    .order("created_at", { ascending: true });

  for (const entry of candidates ?? []) {
    if (excludeEntryId && entry.id === excludeEntryId) continue;
    const range = entry.desired_time_range as { from: string; to: string; days: string[] } | null;
    if (!range) continue;
    if (!range.days.includes(weekday)) continue;
    if (timeMin < parseHHMM(range.from) || timeMin > parseHHMM(range.to)) continue;

    const customer = (entry as unknown as { customer: { full_name: string; phone: string } | null }).customer;
    const serviceName = (entry as unknown as { service: { name: string } | null }).service?.name ?? "randevu";
    if (!customer?.phone) continue;

    try {
      await sendWhatsappTemplateMessage(customer.phone, "bekleme_listesi_bosluk", "tr", [
        customer.full_name,
        serviceName,
      ]);
    } catch (err) {
      console.error("bekleme listesi şablon mesajı gönderilemedi", customer.phone, err);
      Sentry.captureException(err);
      continue; // bu adaya ulaşılamadı, sıradakini dene
    }

    await admin
      .from("waitlist_entries")
      .update({ offered_slot: slot, offered_at: new Date().toISOString() })
      .eq("id", entry.id);

    await admin.from("whatsapp_message_log").insert({
      business_id: businessId,
      customer_id: entry.customer_id,
      direction: "outbound",
      message_type: "template",
      template_name: "bekleme_listesi_bosluk",
      body: `Bekleme listesi boşluk teklifi: ${serviceName} — ${formatDateTR(slot.startsAt)} ${formatTimeTR(slot.startsAt)}`,
    });
    return true;
  }
  return false;
}

/** Bir randevu iptal edildiğinde, boşalan her hizmet/personel için sıradaki bekleme listesi adayına otomatik teklif gönderir. */
export async function matchWaitlistForCancelledAppointment(businessId: string, appointmentId: string) {
  const admin = createAdminSupabaseClient();

  const { data: appointment } = await admin
    .from("appointments")
    .select("starts_at, ends_at, appointment_services(service_id, staff_id)")
    .eq("id", appointmentId)
    .single();
  if (!appointment) return;

  const services = appointment.appointment_services as unknown as { service_id: string; staff_id: string }[];
  for (const svc of services) {
    await offerNextWaitlistEntry(admin, businessId, {
      serviceId: svc.service_id,
      staffId: svc.staff_id,
      startsAt: appointment.starts_at,
      endsAt: appointment.ends_at,
    });
  }
}

/** Bir bekleme listesi teklifine bu kadar saat içinde cevap gelmezse, boşluk sıradaki adaya geçer (bkz. cron/waitlist-timeout). */
export const WAITLIST_OFFER_TIMEOUT_HOURS = 3;

export async function expireStaleWaitlistOffers(): Promise<{ expired: number }> {
  const admin = createAdminSupabaseClient();
  const cutoff = new Date(Date.now() - WAITLIST_OFFER_TIMEOUT_HOURS * 60 * 60 * 1000).toISOString();

  const { data: stale } = await admin
    .from("waitlist_entries")
    .select("id, business_id, offered_slot")
    .eq("status", "open")
    .not("offered_slot", "is", null)
    .lt("offered_at", cutoff);

  let expired = 0;
  for (const entry of stale ?? []) {
    const slot = entry.offered_slot as unknown as FreedSlot;
    await admin.from("waitlist_entries").update({ offered_slot: null, offered_at: null }).eq("id", entry.id);
    await offerNextWaitlistEntry(admin, entry.business_id, slot, entry.id);
    expired++;
  }
  return { expired };
}

const RETENTION_MULTIPLIER = 1.5; // "aralık geçti" sayılması için ortalama ziyaret aralığının kaç katı geçmesi gerektiği
const RETENTION_DEDUP_DAYS = 14; // aynı müşteri için bu kadar gün içinde ikinci bir uyarı üretilmez
const RHYTHM_MIN_VISITS = 3;
const RHYTHM_MAX_SPREAD_RATIO = 0.4; // ziyaret aralıkları arası tutarlılık eşiği (max-min)/ortalama
const RHYTHM_LOOKAHEAD_DAYS = 3; // ritim dolmadan kaç gün önce davet önerilsin

interface VisitRow {
  starts_at: string;
  service_ids: string[];
}

async function loadCameVisitsByCustomer(admin: ReturnType<typeof createAdminSupabaseClient>, businessId: string) {
  const { data } = await admin
    .from("appointments")
    .select("customer_id, starts_at, status, appointment_services(service_id)")
    .eq("business_id", businessId)
    .neq("status", "cancelled")
    .lt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

  const byCustomer = new Map<string, VisitRow[]>();
  for (const row of data ?? []) {
    const list = byCustomer.get(row.customer_id) ?? [];
    list.push({
      starts_at: row.starts_at,
      service_ids: (row.appointment_services as unknown as { service_id: string }[]).map((s) => s.service_id).sort(),
    });
    byCustomer.set(row.customer_id, list);
  }
  return byCustomer;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24);
}

export async function hasUpcomingAppointment(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  businessId: string,
  customerId: string
) {
  const { data } = await admin
    .from("appointments")
    .select("id")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .in("status", ["scheduled", "confirmed"])
    .gte("starts_at", new Date().toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function hasRecentUnresolvedActionObject(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  businessId: string,
  customerId: string,
  type: string,
  sinceDaysAgo: number
) {
  const since = new Date(Date.now() - sinceDaysAgo * 24 * 60 * 60000).toISOString();
  const { data } = await admin
    .from("action_objects")
    .select("id")
    .eq("business_id", businessId)
    .eq("related_customer_id", customerId)
    .eq("type", type)
    .gte("created_at", since)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export interface ProactiveInsightsResult {
  businessId: string;
  retentionRisksCreated: number;
  rhythmInvitesCreated: number;
  error?: string;
}

/**
 * Gece cron'unda çağrılır. Ziyaret aralığı dolan müşteriler için 'retention_risk',
 * düzenli ritmi olan müşteriler için ritim dolmadan 'rhythm_invite' aksiyon
 * nesnesi üretir — ikisi de owner onayı bekler (status='pending'), otomatik mesaj gitmez.
 */
export async function runProactiveInsightsForBusiness(businessId: string): Promise<ProactiveInsightsResult> {
  const admin = createAdminSupabaseClient();
  const visitsByCustomer = await loadCameVisitsByCustomer(admin, businessId);
  const todayKey = dateKeyTR(0);

  const { data: customerRows } = await admin
    .from("customers")
    .select("id, full_name")
    .eq("business_id", businessId)
    .in("id", Array.from(visitsByCustomer.keys()));
  const customerNames = new Map((customerRows ?? []).map((c) => [c.id, c.full_name]));

  let retentionRisksCreated = 0;
  let rhythmInvitesCreated = 0;

  for (const [customerId, visits] of visitsByCustomer) {
    if (visits.length < 2) continue;
    const customerName = customerNames.get(customerId) ?? "Müşteri";

    const intervals: number[] = [];
    for (let i = 1; i < visits.length; i++) {
      intervals.push(daysBetween(visits[i - 1].starts_at, visits[i].starts_at));
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const lastVisit = visits[visits.length - 1];
    const daysSinceLastVisit = daysBetween(lastVisit.starts_at, new Date().toISOString());

    if (avgInterval > 0 && daysSinceLastVisit > avgInterval * RETENTION_MULTIPLIER) {
      const alreadyUpcoming = await hasUpcomingAppointment(admin, businessId, customerId);
      const alreadyFlagged = alreadyUpcoming
        ? true
        : await hasRecentUnresolvedActionObject(admin, businessId, customerId, "retention_risk", RETENTION_DEDUP_DAYS);
      if (!alreadyFlagged) {
        await admin.from("action_objects").insert({
          business_id: businessId,
          type: "retention_risk",
          related_customer_id: customerId,
          suggestion: "İndirimsiz, kişisel bir hatırlatma mesajı göndermeyi düşünebilirsin — uzun süredir gelmiyor.",
          customer_message: `Merhaba ${customerName}, sizi bir süredir aramızda göremedik — nasılsınız? Ne zaman isterseniz buradayız 🙂`,
          reasoning: `Ortalama ziyaret aralığı ~${Math.round(avgInterval)} gün, son ziyaretten bu yana ${Math.round(daysSinceLastVisit)} gün geçti.`,
          status: "pending",
          whatsapp_template_name: "musteri_ozlem_hatirlatma",
          whatsapp_template_params: [customerName],
        });
        retentionRisksCreated++;
      }
    }

    if (visits.length >= RHYTHM_MIN_VISITS) {
      const lastN = visits.slice(-RHYTHM_MIN_VISITS);
      const sameServiceCombo = lastN.every(
        (v) => JSON.stringify(v.service_ids) === JSON.stringify(lastN[0].service_ids)
      );
      const lastNIntervals = intervals.slice(-(RHYTHM_MIN_VISITS - 1));
      const avgRhythm = lastNIntervals.reduce((a, b) => a + b, 0) / lastNIntervals.length;
      const spread = Math.max(...lastNIntervals) - Math.min(...lastNIntervals);
      const isConsistentRhythm = avgRhythm > 0 && spread / avgRhythm <= RHYTHM_MAX_SPREAD_RATIO;

      if (sameServiceCombo && isConsistentRhythm) {
        const daysUntilExpected = avgRhythm - daysSinceLastVisit;
        if (daysUntilExpected >= 0 && daysUntilExpected <= RHYTHM_LOOKAHEAD_DAYS) {
          const alreadyUpcoming = await hasUpcomingAppointment(admin, businessId, customerId);
          const alreadyFlagged = alreadyUpcoming
            ? true
            : await hasRecentUnresolvedActionObject(admin, businessId, customerId, "rhythm_invite", Math.round(avgRhythm));
          if (!alreadyFlagged) {
            await admin.from("action_objects").insert({
              business_id: businessId,
              type: "rhythm_invite",
              related_customer_id: customerId,
              suggestion: "Alışılmış randevu zamanı yaklaşıyor — indirimsiz, kişisel bir davet göndermeyi düşünebilirsin.",
              customer_message: `Merhaba ${customerName}, genelde ~${Math.round(avgRhythm)} günde bir bizi tercih ediyorsunuz — tekrar bir randevu ayarlamak ister misiniz?`,
              reasoning: `Son ${RHYTHM_MIN_VISITS} ziyaret aynı hizmet kombinasyonuyla, ~${Math.round(avgRhythm)} günlük düzenli ritimde. Ritim ${Math.round(daysUntilExpected)} gün içinde doluyor (bugün: ${todayKey}).`,
              status: "pending",
              whatsapp_template_name: "_randevu_ritim_davet",
              whatsapp_template_params: [customerName, String(Math.round(avgRhythm))],
            });
            rhythmInvitesCreated++;
          }
        }
      }
    }
  }

  return { businessId, retentionRisksCreated, rhythmInvitesCreated };
}

export async function runProactiveInsightsForAllBusinesses(): Promise<ProactiveInsightsResult[]> {
  const admin = createAdminSupabaseClient();
  const { data: businesses, error } = await admin.from("businesses").select("id").eq("is_active", true);
  if (error) throw error;

  const results: ProactiveInsightsResult[] = [];
  for (const b of businesses ?? []) {
    try {
      results.push(await runProactiveInsightsForBusiness(b.id));
    } catch (err) {
      console.error("proactive insights failed for business", b.id, err);
      Sentry.captureException(err);
      results.push({
        businessId: b.id,
        retentionRisksCreated: 0,
        rhythmInvitesCreated: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
