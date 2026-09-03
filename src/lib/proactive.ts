import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR } from "@/lib/date";
import type { Attendance } from "@/types/database";

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

/**
 * Bir randevu iptal edildiğinde, boşalan (personel, hizmet, gün/saat) ile
 * eşleşen açık bekleme listesi kayıtları için 'fill_gap' aksiyon nesnesi
 * oluşturur. Owner'ın dashboard'dan onaylamasıyla müşteriye mesaj gider —
 * burada otomatik mesaj gönderilmez, sadece öneri üretilir.
 */
export async function matchWaitlistForCancelledAppointment(businessId: string, appointmentId: string) {
  const admin = createAdminSupabaseClient();

  const { data: appointment } = await admin
    .from("appointments")
    .select("id, starts_at, appointment_services(service_id, service:services(name))")
    .eq("id", appointmentId)
    .single();
  if (!appointment) return;

  const weekday = weekdayKeyForIso(appointment.starts_at);
  const timeMin = timeOfDayMinutes(appointment.starts_at);
  const freedServiceIds = (appointment.appointment_services as unknown as { service_id: string }[]).map(
    (s) => s.service_id
  );

  const { data: waitlist } = await admin
    .from("waitlist_entries")
    .select("id, customer_id, desired_service_id, desired_time_range, customer:customers(full_name)")
    .eq("business_id", businessId)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  for (const entry of waitlist ?? []) {
    if (entry.desired_service_id && !freedServiceIds.includes(entry.desired_service_id)) continue;
    const range = entry.desired_time_range as { from: string; to: string; days: string[] } | null;
    if (!range) continue;
    if (!range.days.includes(weekday)) continue;
    if (timeMin < parseHHMM(range.from) || timeMin > parseHHMM(range.to)) continue;

    const { data: existing } = await admin
      .from("action_objects")
      .select("id")
      .eq("type", "fill_gap")
      .eq("related_appointment_id", appointmentId)
      .eq("related_customer_id", entry.customer_id)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const customerName = (entry as unknown as { customer: { full_name: string } | null }).customer?.full_name ?? "Müşteri";
    const serviceName =
      (appointment.appointment_services as unknown as { service: { name: string } | null }[])[0]?.service?.name ?? "randevu";

    await admin.from("action_objects").insert({
      business_id: businessId,
      type: "fill_gap",
      related_customer_id: entry.customer_id,
      related_appointment_id: appointmentId,
      suggestion: `Merhaba ${customerName}, bekleme listenizdeki ${serviceName} için bir yer boşaldı — halen istiyor musunuz?`,
      reasoning: `Bir randevu iptal oldu ve bekleme listesi kaydınızla (${range.days.join(", ")} ${range.from}-${range.to}) eşleşti.`,
      status: "pending",
    });
  }
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
    .select("customer_id, starts_at, attendance, appointment_services(service_id)")
    .eq("business_id", businessId)
    .eq("attendance", "came" satisfies Attendance)
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

  let retentionRisksCreated = 0;
  let rhythmInvitesCreated = 0;

  for (const [customerId, visits] of visitsByCustomer) {
    if (visits.length < 2) continue;

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
          reasoning: `Ortalama ziyaret aralığı ~${Math.round(avgInterval)} gün, son ziyaretten bu yana ${Math.round(daysSinceLastVisit)} gün geçti.`,
          status: "pending",
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
              reasoning: `Son ${RHYTHM_MIN_VISITS} ziyaret aynı hizmet kombinasyonuyla, ~${Math.round(avgRhythm)} günlük düzenli ritimde. Ritim ${Math.round(daysUntilExpected)} gün içinde doluyor (bugün: ${todayKey}).`,
              status: "pending",
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
    results.push(await runProactiveInsightsForBusiness(b.id));
  }
  return results;
}
