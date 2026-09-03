import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyTR, weekdayKeyTR, dayRangeUtcISO, formatTL } from "@/lib/date";
import { sendWhatsappTextMessage } from "@/lib/whatsapp/client";

export interface WeeklySummaryResult {
  businessId: string;
  sent: boolean;
  reason: string;
}

const NO_SHOW_VALUES = ["no_show_notified", "no_show_silent"];

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function shortDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
}

/**
 * Her gece cron'unda çağrılır ama sadece Pazartesi günleri (Türkiye yerel saatiyle)
 * bir şey yapar — geçen haftanın (Pazartesi-Pazar) özetini WhatsApp'tan owner'a
 * gönderir. Sabah özeti (nightlySummary.ts) gibi 'action_objects'e 'weekly_summary'
 * tipiyle kaydedilir; type kolonu serbest metin olduğu için yeni bir migration
 * gerekmiyor (bkz. schema.sql'deki action_objects yorumu).
 */
export async function runWeeklySummaryForBusiness(businessId: string): Promise<WeeklySummaryResult> {
  if (weekdayKeyTR(0) !== "mon") {
    return { businessId, sent: false, reason: "bugün pazartesi değil" };
  }

  const admin = createAdminSupabaseClient();

  const { data: alreadySent } = await admin
    .from("action_objects")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", "weekly_summary")
    .gte("created_at", dayRangeUtcISO(0).startUtc)
    .lt("created_at", dayRangeUtcISO(0).endUtc)
    .limit(1);
  if (alreadySent && alreadySent.length > 0) {
    return { businessId, sent: false, reason: "bugün için zaten bir haftalık özet gönderilmiş" };
  }

  const weekStartKey = dateKeyTR(-7);
  const weekEndKey = dateKeyTR(-1);
  const startUtc = dayRangeUtcISO(-7).startUtc;
  const endUtc = dayRangeUtcISO(-1).endUtc;

  const { data: rows } = await admin
    .from("appointments")
    .select("status, attendance, appointment_services(planned_price, final_price, service:services(name))")
    .eq("business_id", businessId)
    .gte("starts_at", startUtc)
    .lt("starts_at", endUtc);

  if (!rows || rows.length === 0) {
    return { businessId, sent: false, reason: "geçen hafta hiç randevu kaydı yok" };
  }

  let revenue = 0;
  let cameCount = 0;
  let cancelledCount = 0;
  let noShowCount = 0;
  const serviceCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.status === "cancelled") {
      cancelledCount++;
      continue;
    }
    if (NO_SHOW_VALUES.includes(row.attendance ?? "")) noShowCount++;
    if (row.attendance === "came") {
      cameCount++;
      for (const svc of row.appointment_services) {
        revenue += Number(svc.final_price ?? svc.planned_price);
        const name = one(svc.service)?.name;
        if (name) serviceCounts.set(name, (serviceCounts.get(name) ?? 0) + 1);
      }
    }
  }

  if (cameCount === 0) {
    return { businessId, sent: false, reason: "geçen hafta gelen randevu yok, özet gönderilmedi" };
  }

  const topService = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const lines = [
    `📊 Geçen hafta özeti (${shortDateLabel(weekStartKey)} - ${shortDateLabel(weekEndKey)})`,
    `💰 Ciro: ${formatTL(revenue)}`,
    `✅ Gelen randevu: ${cameCount}`,
  ];
  if (cancelledCount > 0) lines.push(`❌ İptal: ${cancelledCount}`);
  if (noShowCount > 0) lines.push(`👻 Gelmeyen: ${noShowCount}`);
  if (topService) lines.push(`⭐ En popüler hizmet: ${topService}`);
  const message = lines.join("\n");

  const { data: owner } = await admin.from("business_owners").select("phone").eq("business_id", businessId).maybeSingle();

  let sent = false;
  if (owner?.phone) {
    try {
      await sendWhatsappTextMessage(owner.phone, message);
      sent = true;
    } catch (err) {
      console.error("haftalık özet gönderilemedi", businessId, err);
    }
  }

  await admin.from("whatsapp_message_log").insert({
    business_id: businessId,
    direction: "outbound",
    message_type: "freeform",
    body: message,
  });

  await admin.from("action_objects").insert({
    business_id: businessId,
    type: "weekly_summary",
    suggestion: message,
    reasoning: `${weekStartKey} - ${weekEndKey}: ciro ${revenue} TL, gelen ${cameCount}, iptal ${cancelledCount}, gelmeyen ${noShowCount}`,
    status: "auto_sent",
  });

  return { businessId, sent, reason: sent ? "gönderildi" : "owner telefon numarası tanımlı değil, sadece kayda geçirildi" };
}

export async function runWeeklySummaryForAllBusinesses(): Promise<WeeklySummaryResult[]> {
  const admin = createAdminSupabaseClient();
  const { data: businesses, error } = await admin.from("businesses").select("id").eq("is_active", true);
  if (error) throw error;

  const results: WeeklySummaryResult[] = [];
  for (const b of businesses ?? []) {
    results.push(await runWeeklySummaryForBusiness(b.id));
  }
  return results;
}
