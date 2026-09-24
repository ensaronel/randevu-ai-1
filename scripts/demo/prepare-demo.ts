/**
 * Her tanıtımdan (demo) ÖNCE çalıştırılır: dashboard'da bugüne ait "Günlük Değerlendirme Anketi" kartını
 * ve "gelmeyen müşteri" kartlarını taze haline getirir.
 *
 *  - Bugün, saati geçmiş birkaç randevu ekler (Şerif dahil) — anket "bugün gelenlere" gider.
 *  - Bugünün anket kartını oluşturur (eski bekleyenleri kapatır).
 *  - Gizem Arslan (senin numaran) + 2 sahte müşteri için "gelmeyen müşteri" kartlarını yeniden açar.
 *
 * Çalıştırma:  npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/demo/prepare-demo.ts
 */
import { randomUUID } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyRangeUtcISO } from "@/lib/date";
import { SERVICE_BY_KEY, STAFF_BY_KEY, makeRng, todayKey, localIso } from "./common";

const admin = createAdminSupabaseClient();
const rng = makeRng(Date.now() % 100000);

function fatal(message: string): never {
  console.error(`\nDURDU: ${message}`);
  process.exit(1);
}

function localNowMinutes(): number {
  const d = new Date(Date.now() + 3 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

async function main() {
  const { data: businesses } = await admin.from("businesses").select("id, name");
  if (!businesses || businesses.length !== 1) fatal("Tam olarak BİR işletme bekleniyordu.");
  const business = businesses[0];
  const businessId: string = business.id;
  const today = todayKey();
  const { startUtc, endUtc } = dateKeyRangeUtcISO(today, today);
  console.log(`İşletme: ${business.name} | bugün: ${today}`);

  const { data: staffRows } = await admin.from("staff").select("id, full_name").eq("business_id", businessId);
  const { data: serviceRows } = await admin.from("services").select("id, name").eq("business_id", businessId);
  const staffByName = new Map((staffRows ?? []).map((s) => [s.full_name, s.id as string]));
  const serviceByName = new Map((serviceRows ?? []).map((s) => [s.name, s.id as string]));

  const { data: customers } = await admin.from("customers").select("id, full_name, phone").eq("business_id", businessId);
  const byName = new Map((customers ?? []).map((c) => [c.full_name, c]));
  const serif = byName.get("Şerif");
  const gizem = byName.get("Gizem Arslan");
  if (!serif || !gizem) fatal("Şerif / Gizem Arslan kaydı bulunamadı. Önce seed-demo-business.ts çalıştırılmalı.");

  // ---------------------------------------------------------------- bugünkü (geçmiş saatli) randevular
  const nowMin = localNowMinutes();
  const lastStartHour = Math.floor((nowMin - 45) / 60);
  if (lastStartHour < 9) fatal("Saat 10:00'dan önce çalıştırılamaz (bugün henüz randevu saati geçmedi). 10:00'dan sonra tekrar dene.");

  const { data: todays } = await admin
    .from("appointments")
    .select("id, customer_id, starts_at, ends_at, status, appointment_services(staff_id)")
    .eq("business_id", businessId)
    .gte("starts_at", startUtc)
    .lte("starts_at", endUtc);

  const busy = new Map<string, [number, number][]>();
  const addBusy = (staffId: string, startIso: string, endIso: string) => {
    const s = new Date(new Date(startIso).getTime() + 3 * 3600_000);
    const e = new Date(new Date(endIso).getTime() + 3 * 3600_000);
    const sm = s.getUTCHours() * 60 + s.getUTCMinutes();
    const em = e.getUTCHours() * 60 + e.getUTCMinutes();
    busy.set(staffId, [...(busy.get(staffId) ?? []), [sm, em]]);
  };
  for (const a of todays ?? []) {
    if (a.status === "cancelled") continue;
    for (const s of (a.appointment_services ?? []) as { staff_id: string }[]) addBusy(s.staff_id, a.starts_at, a.ends_at);
  }
  const alreadyToday = new Set((todays ?? []).filter((a) => a.status !== "cancelled" && new Date(a.starts_at).getTime() < Date.now()).map((a) => a.customer_id));

  const candidates = [
    { customer: serif, svc: "manikur" },
    ...rng
      .weightedOrder(
        (customers ?? []).filter((c) => c.phone.startsWith("9000000")),
        () => 1
      )
      .slice(0, 6)
      .map((customer) => ({ customer, svc: rng.pick(["kesim", "kalici_oje", "kas", "cilt", "fon", "pedikur"]) })),
  ];

  let added = 0;
  const apptRows: Record<string, unknown>[] = [];
  const svcRows: Record<string, unknown>[] = [];
  for (const { customer, svc } of candidates) {
    if (added >= 5 || alreadyToday.has(customer.id)) continue;
    const def = SERVICE_BY_KEY.get(svc)!;
    const staffName = STAFF_BY_KEY.get(def.staff[0])!.name;
    const staffId = staffByName.get(staffName);
    const serviceId = serviceByName.get(def.name);
    if (!staffId || !serviceId) continue;

    let placedStart: number | null = null;
    for (let h = 9; h <= lastStartHour; h++) {
      const start = h * 60;
      const end = start + def.duration;
      if ((busy.get(staffId) ?? []).some(([s, e]) => start < e && end > s)) continue;
      placedStart = start;
      busy.set(staffId, [...(busy.get(staffId) ?? []), [start, end]]);
      break;
    }
    if (placedStart === null) continue;

    const id = randomUUID();
    const startsAt = localIso(today, placedStart);
    apptRows.push({
      id,
      business_id: businessId,
      customer_id: customer.id,
      starts_at: startsAt,
      ends_at: localIso(today, placedStart + def.duration),
      status: "completed",
      attendance: "came",
      source: "whatsapp_ai",
      reminder_24h_sent_at: startsAt,
      reminder_1h_sent_at: startsAt,
      created_at: new Date(new Date(startsAt).getTime() - 2 * 86400_000).toISOString(),
    });
    svcRows.push({
      id: randomUUID(),
      appointment_id: id,
      service_id: serviceId,
      staff_id: staffId,
      planned_price: def.price,
      commission_rate_snapshot: STAFF_BY_KEY.get(def.staff[0])!.commissionRate,
      payment_method: rng.chance(0.55) ? "kart" : "nakit",
    });
    added++;
  }
  if (apptRows.length > 0) {
    const { error: e1 } = await admin.from("appointments").insert(apptRows);
    if (e1) fatal(`Randevu eklenemedi: ${e1.message}`);
    const { error: e2 } = await admin.from("appointment_services").insert(svcRows);
    if (e2) fatal(`Randevu hizmeti eklenemedi: ${e2.message}`);
  }
  console.log(`Bugün için ${apptRows.length} yeni "gelmiş" randevu eklendi.`);

  // ---------------------------------------------------------------- bugünün anket kartı
  const { data: todaysDone } = await admin
    .from("appointments")
    .select("customer_id, attendance")
    .eq("business_id", businessId)
    .neq("status", "cancelled")
    .gte("starts_at", startUtc)
    .lte("starts_at", endUtc)
    .lt("starts_at", new Date().toISOString());
  const cameCustomers = new Set((todaysDone ?? []).filter((a) => a.attendance === null || a.attendance === "came").map((a) => a.customer_id));

  await admin
    .from("action_objects")
    .update({ status: "rejected", outcome: "yeni anket hazırlandı", resolved_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("type", "daily_survey")
    .eq("status", "pending");
  await admin.from("action_objects").insert({
    business_id: businessId,
    type: "daily_survey",
    suggestion: `Bugün ${cameCustomers.size} müşteri geldi — kapanışta hepsine kısa bir anket/öneri mesajı gönderilsin mi?`,
    customer_message: null,
    reasoning: `${today} tarihinde randevusu olan ${cameCustomers.size} müşteri.`,
    status: "pending",
  });
  console.log(`Anket kartı hazır: ${cameCustomers.size} müşteri.`);

  // ---------------------------------------------------------------- gelmeyen müşteri kartları
  const riskDefs: [string, number, number][] = [
    ["Gizem Arslan", 21, 58],
    ["Zeynep Aksoy", 24, 61],
    ["Nilay Çakır", 20, 50],
  ];
  for (const [name, avg, since] of riskDefs) {
    const c = byName.get(name);
    if (!c) continue;
    const { data: pending } = await admin
      .from("action_objects")
      .select("id")
      .eq("business_id", businessId)
      .eq("type", "retention_risk")
      .eq("related_customer_id", c.id)
      .eq("status", "pending")
      .limit(1);
    if (pending && pending.length > 0) continue;
    await admin.from("action_objects").insert({
      business_id: businessId,
      type: "retention_risk",
      related_customer_id: c.id,
      suggestion: "İndirimsiz, kişisel bir hatırlatma mesajı göndermeyi düşünebilirsin — uzun süredir gelmiyor.",
      customer_message: `Merhaba ${name}, sizi bir süredir aramızda göremedik — nasılsınız? Ne zaman isterseniz buradayız 🙂`,
      reasoning: `Ortalama ziyaret aralığı ~${avg} gün, son ziyaretten bu yana ${since} gün geçti.`,
      status: "pending",
      whatsapp_template_name: "musteri_ozlem_hatirlatma",
      whatsapp_template_params: [name],
    });
    console.log(`Gelmeyen müşteri kartı yenilendi: ${name}`);
  }

  // ---------------------------------------------------------------- 24 saat penceresi uyarısı
  const { data: lastInbound } = await admin
    .from("whatsapp_message_log")
    .select("created_at")
    .eq("business_id", businessId)
    .eq("customer_id", serif.id)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1);
  const hoursSince = lastInbound?.[0] ? (Date.now() - new Date(lastInbound[0].created_at).getTime()) / 3600_000 : null;
  if (hoursSince === null || hoursSince > 22) {
    console.log("\nUYARI: Anket mesajının telefonuna ulaşması için demodan ÖNCE botun numarasına WhatsApp'tan bir 'selam' yaz");
    console.log("(WhatsApp, müşteri son 24 saatte yazmadıysa serbest metin mesajı engeller).");
  } else {
    console.log(`\nSon mesajın ${Math.round(hoursSince)} saat önce — anket mesajı ulaşır.`);
  }
}

main().catch((err) => {
  console.error("\nHATA:", err instanceof Error ? err.message : err);
  process.exit(1);
});
