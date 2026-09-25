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
import { dateKeyRangeUtcISO, dayRangeUtcISO } from "@/lib/date";
import { runNightlySummaryForBusiness } from "@/lib/nightlySummary";
import { SERVICE_BY_KEY, STAFF_BY_KEY, makeRng, todayKey, localIso, dayKeyOffset } from "./common";

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

  // Betik tekrar çalıştırılınca sayılar şişmesin: bugün gelmiş 9, günün kalanı için 4 yaklaşan randevuya tamamlanır.
  const PAST_TARGET = 9;
  const UPCOMING_TARGET = 4;
  const upcomingExisting = (todays ?? []).filter((a) => a.status !== "cancelled" && new Date(a.starts_at).getTime() >= Date.now()).length;
  const needPast = Math.max(0, PAST_TARGET - alreadyToday.size);
  const needUpcoming = Math.max(0, UPCOMING_TARGET - upcomingExisting);
  const usedToday = new Set((todays ?? []).filter((a) => a.status !== "cancelled").map((a) => a.customer_id));

  const fakeCustomers = rng.weightedOrder(
    (customers ?? []).filter((c) => c.phone.startsWith("9000000")),
    () => 1
  );
  const svcPool = ["kesim", "kalici_oje", "kas", "cilt", "fon", "pedikur", "boya", "manikur", "kirpik"];
  const apptRows: Record<string, unknown>[] = [];
  const svcRows: Record<string, unknown>[] = [];

  /** Bugün, belirtilen saat aralığında, personeli boş bir yere randevu yerleştirir. */
  function addAppointment(customer: { id: string }, svc: string, fromHour: number, toHour: number, upcoming: boolean): boolean {
    const def = SERVICE_BY_KEY.get(svc)!;
    const staffKey = def.staff[0];
    const staffId = staffByName.get(STAFF_BY_KEY.get(staffKey)!.name);
    const serviceId = serviceByName.get(def.name);
    if (!staffId || !serviceId) return false;

    let placedStart: number | null = null;
    for (let h = fromHour; h <= toHour; h++) {
      const start = h * 60;
      const end = start + def.duration;
      if ((busy.get(staffId) ?? []).some(([s, e]) => start < e && end > s)) continue;
      placedStart = start;
      busy.set(staffId, [...(busy.get(staffId) ?? []), [start, end]]);
      break;
    }
    if (placedStart === null) return false;

    const id = randomUUID();
    const startsAt = localIso(today, placedStart);
    const flagged = new Date().toISOString();
    apptRows.push({
      id,
      business_id: businessId,
      customer_id: customer.id,
      starts_at: startsAt,
      ends_at: localIso(today, placedStart + def.duration),
      status: upcoming ? (rng.chance(0.4) ? "confirmed" : "scheduled") : "completed",
      attendance: upcoming ? null : "came",
      source: "whatsapp_ai",
      // Sahte müşterilere hatırlatma denenmesin; Şerif'in yaklaşan randevusu (varsa) gerçek hatırlatma alır.
      reminder_24h_sent_at: customer.id === serif!.id && upcoming ? null : flagged,
      reminder_1h_sent_at: customer.id === serif!.id && upcoming ? null : flagged,
      created_at: new Date(new Date(startsAt).getTime() - 2 * 86400_000).toISOString(),
    });
    svcRows.push({
      id: randomUUID(),
      appointment_id: id,
      service_id: serviceId,
      staff_id: staffId,
      planned_price: def.price,
      commission_rate_snapshot: STAFF_BY_KEY.get(staffKey)!.commissionRate,
      payment_method: upcoming ? null : rng.chance(0.55) ? "kart" : "nakit",
    });
    usedToday.add(customer.id);
    return true;
  }

  // Gelmiş randevular (Şerif her zaman dahil)
  let addedPast = 0;
  if (!alreadyToday.has(serif.id) && addAppointment(serif, "manikur", 9, lastStartHour, false)) addedPast++;
  for (const c of fakeCustomers) {
    if (addedPast >= needPast) break;
    if (usedToday.has(c.id)) continue;
    if (addAppointment(c, rng.pick(svcPool), 9, lastStartHour, false)) addedPast++;
  }
  // Günün kalanı için yaklaşan randevular
  let addedUpcoming = 0;
  const firstUpcomingHour = Math.ceil((nowMin + 30) / 60);
  for (const c of fakeCustomers) {
    if (addedUpcoming >= needUpcoming || firstUpcomingHour > 18) break;
    if (usedToday.has(c.id)) continue;
    if (addAppointment(c, rng.pick(svcPool), firstUpcomingHour, 18, true)) addedUpcoming++;
  }

  if (apptRows.length > 0) {
    const { error: e1 } = await admin.from("appointments").insert(apptRows);
    if (e1) fatal(`Randevu eklenemedi: ${e1.message}`);
    const { error: e2 } = await admin.from("appointment_services").insert(svcRows);
    if (e2) fatal(`Randevu hizmeti eklenemedi: ${e2.message}`);
  }
  console.log(`Bugün için ${addedPast} "gelmiş" ve ${addedUpcoming} yaklaşan randevu eklendi.`);

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

  // ---------------------------------------------------------------- ritim kartı senin numarana gitsin
  // Aynı numaranın farklı yazımı (boşluklu) Meta tarafında aynı hesaba (wa_id) eşleniyor; bu sayede iki ayrı müşteri
  // kaydı (Gizem = risk, Pınar = ritim) aynı telefona ulaşabiliyor. Cevap yazarsan Şerif kaydına düşer (düz numara).
  {
    const d = serif.phone.replace(/\D/g, "");
    const spaced = `+${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
    const pinar = byName.get("Pınar Yalçın");
    if (pinar && pinar.phone !== spaced) {
      const { error } = await admin.from("customers").update({ phone: spaced }).eq("id", pinar.id);
      if (error) console.log(`Pınar numarası güncellenemedi: ${error.message}`);
      else console.log("Ritim kartı müşterisi (Pınar Yalçın) senin numarana bağlandı.");
    }
  }

  // ---------------------------------------------------------------- bekleme listesi demosu (Şerif'in numarası)
  // Şerif "Kalıcı Oje" için bekleme listesinde. Başka bir müşterinin yaklaşan Kalıcı Oje randevusu iptal edilince
  // (Danışman'a "<isim> için yarınki randevuyu iptal et" demek yeterli) sıradaki kişiye, yani Şerif'e, şablonlu teklif gider;
  // "evet" yazarsa randevu otomatik oluşur.
  {
    const ojeId = serviceByName.get("Kalıcı Oje");
    const busePersonId = staffByName.get("Buse Aydın");
    if (ojeId && busePersonId) {
      await admin.from("waitlist_entries").delete().eq("business_id", businessId).eq("customer_id", serif.id);
      await admin.from("waitlist_entries").insert({
        business_id: businessId,
        customer_id: serif.id,
        desired_service_id: ojeId,
        desired_time_range: { from: "08:00", to: "20:00", days: ["mon", "tue", "wed", "thu", "fri", "sat"] },
        status: "open",
        created_at: new Date(Date.now() - 10 * 86400_000).toISOString(),
      });

      const { data: futureAppts } = await admin
        .from("appointments")
        .select("id, starts_at, customer_id, appointment_services(service_id)")
        .eq("business_id", businessId)
        .in("status", ["scheduled", "confirmed"])
        .gt("starts_at", new Date(Date.now() + 2 * 3600_000).toISOString())
        .neq("customer_id", serif.id)
        .order("starts_at");
      const fakeIds = new Set((customers ?? []).filter((c) => c.phone.startsWith("9000000")).map((c) => c.id));
      let target = (futureAppts ?? []).find(
        (a) => fakeIds.has(a.customer_id) && ((a.appointment_services ?? []) as { service_id: string }[]).some((s) => s.service_id === ojeId)
      );
      if (!target) {
        // Yaklaşan bir Kalıcı Oje randevusu yoksa yarın ya da sonraki açık günde Buse'ye bir tane ekle.
        let dayOffset = 1;
        while (new Date(`${dayKeyOffset(dayOffset)}T00:00:00Z`).getUTCDay() === 0) dayOffset++;
        const dateKey = dayKeyOffset(dayOffset);
        const fake = (customers ?? []).find((c) => c.phone.startsWith("9000000") && !(futureAppts ?? []).some((a) => a.customer_id === c.id));
        if (fake) {
          const id = randomUUID();
          const startsAt = localIso(dateKey, 14 * 60);
          await admin.from("appointments").insert({
            id,
            business_id: businessId,
            customer_id: fake.id,
            starts_at: startsAt,
            ends_at: localIso(dateKey, 15 * 60),
            status: "confirmed",
            source: "whatsapp_ai",
            reminder_24h_sent_at: new Date().toISOString(),
            reminder_1h_sent_at: new Date().toISOString(),
          });
          await admin.from("appointment_services").insert({
            id: randomUUID(),
            appointment_id: id,
            service_id: ojeId,
            staff_id: busePersonId,
            planned_price: SERVICE_BY_KEY.get("kalici_oje")!.price,
            commission_rate_snapshot: STAFF_BY_KEY.get("buse")!.commissionRate,
          });
          target = { id, starts_at: startsAt, customer_id: fake.id, appointment_services: [{ service_id: ojeId }] };
        }
      }
      if (target) {
        const owner = (customers ?? []).find((c) => c.id === target!.customer_id);
        const when = new Date(new Date(target.starts_at).getTime() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
        console.log(`Bekleme listesi demosu hazır: Şerif "Kalıcı Oje" için sırada. İptal edilecek randevu: ${owner?.full_name} — ${when} (Kalıcı Oje).`);
      }
    }
  }

  // ---------------------------------------------------------------- bugünün Günlük Finans Özeti
  // Normalde her sabah 06:00 cron'u üretir; demo verisi silinip yeniden kurulduğunda (ya da cron o gün
  // çalışmadığında) dashboard'da özet kartı görünmez. Bugünün özetini silip güncel veriyle yeniden üretir.
  const { startUtc: dayStart, endUtc: dayEnd } = dayRangeUtcISO(0);
  await admin
    .from("action_objects")
    .delete()
    .eq("business_id", businessId)
    .eq("type", "finance_note")
    .gte("created_at", dayStart)
    .lt("created_at", dayEnd);
  const summary = await runNightlySummaryForBusiness(businessId);
  console.log(`Günlük Finans Özeti: ${summary.created ? "oluşturuldu" : `oluşturulamadı (${summary.reason})`}`);

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
