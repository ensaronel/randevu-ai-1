import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendWhatsappTextMessage } from "@/lib/whatsapp/client";
import { formatDateTR, formatTimeTR } from "@/lib/date";

// NOT: WhatsApp kuralına göre işletme, müşteri son 24 saatte yazmadıysa ona
// ancak Meta'nın ONAYLADIĞI bir şablon mesajıyla ulaşabilir — bu hatırlatmalar
// tam olarak bu duruma giriyor. Şu an, projedeki diğer her yerde olduğu gibi
// (KVKK/AI yanıtları), serbest metin gönderen sendWhatsappTextMessage
// kullanılıyor — Meta doğrulaması + şablon onayı tamamlanınca burası mutlaka
// onaylı bir şablon çağrısına çevrilmeli, yoksa Meta gerçek gönderimi reddeder.

interface DueAppointment {
  id: string;
  business_id: string;
  starts_at: string;
  customer: { id: string; full_name: string; phone: string } | { id: string; full_name: string; phone: string }[] | null;
  appointment_services: { service: { name: string } | { name: string }[] | null }[];
}

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function reminderMessage(customerName: string, serviceNames: string[], startsAt: string, hoursLabel: string): string {
  const serviceText = serviceNames.length > 0 ? serviceNames.join(", ") : "randevunuz";
  return `Merhaba ${customerName}, ${formatDateTR(startsAt)} saat ${formatTimeTR(startsAt)} için ${serviceText} randevunuzu hatırlatmak isteriz (${hoursLabel} kaldı). Görüşmek üzere!`;
}

async function findDueAppointments(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  windowHours: number,
  reminderColumn: "reminder_24h_sent_at" | "reminder_1h_sent_at",
  minHoursAway: number
): Promise<DueAppointment[]> {
  // minHoursAway ile üst sınır (windowHours) arasında DAR bir yakalama
  // penceresi oluşturuyoruz (24h hatırlatma için 22-24 saat arası). Sadece
  // "starts_at <= now+24h" desek, son dakika alınan (örn. 5 saat sonrası
  // için) bir randevu ilk cron taramasında yanlışlıkla "24 saat kaldı"
  // mesajı alırdı — oysa gerçekte 5 saat kalmış. Dar pencere sayesinde böyle
  // kısa vadeli randevular bu hatırlatmayı hiç almaz, doğrudan 1 saatlik
  // hatırlatmaya bırakılır (cron sık çalıştığı için normal randevular bu
  // pencereyi mutlaka bir kez yakalar).
  const upperCutoff = new Date(Date.now() + windowHours * 60 * 60000).toISOString();
  const lowerCutoff = new Date(Date.now() + minHoursAway * 60 * 60000).toISOString();

  const { data } = await admin
    .from("appointments")
    .select(
      `id, business_id, starts_at, customer:customers(id, full_name, phone), appointment_services(service:services(name))`
    )
    .in("status", ["scheduled", "confirmed"])
    .is(reminderColumn, null)
    .gt("starts_at", lowerCutoff)
    .lte("starts_at", upperCutoff);

  return (data ?? []) as unknown as DueAppointment[];
}

async function sendReminderBatch(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  appointments: DueAppointment[],
  reminderColumn: "reminder_24h_sent_at" | "reminder_1h_sent_at",
  hoursLabel: string
): Promise<number> {
  let sentCount = 0;

  for (const appt of appointments) {
    const customer = one(appt.customer);
    if (!customer?.phone) continue;

    const serviceNames = appt.appointment_services
      .map((s) => one(s.service)?.name)
      .filter((n): n is string => !!n);

    const body = reminderMessage(customer.full_name, serviceNames, appt.starts_at, hoursLabel);

    try {
      await sendWhatsappTextMessage(customer.phone, body);
      await admin.from("whatsapp_message_log").insert({
        business_id: appt.business_id,
        customer_id: customer.id,
        direction: "outbound",
        message_type: "system_notice",
        body,
      });
      sentCount++;
    } catch (err) {
      console.error("hatırlatma gönderilemedi", appt.id, err);
    }

    // Gönderim başarısız olsa bile tekrar tekrar denenip müşteriye aynı
    // hatırlatmanın birden çok kez gitmesini önlemek için işaretliyoruz —
    // gerçek bir Meta/ağ arızası çok nadir ve tekrar denemek yerine bir
    // sonraki hatırlatma penceresine (1 saat) bırakmak daha güvenli.
    await admin.from("appointments").update({ [reminderColumn]: new Date().toISOString() }).eq("id", appt.id);
  }

  return sentCount;
}

export interface ReminderRunResult {
  sent24h: number;
  sent1h: number;
}

export async function sendDueReminders(): Promise<ReminderRunResult> {
  const admin = createAdminSupabaseClient();

  const due24h = await findDueAppointments(admin, 24, "reminder_24h_sent_at", 22);
  const sent24h = await sendReminderBatch(admin, due24h, "reminder_24h_sent_at", "24 saat");

  const due1h = await findDueAppointments(admin, 1, "reminder_1h_sent_at", 0);
  const sent1h = await sendReminderBatch(admin, due1h, "reminder_1h_sent_at", "1 saat");

  return { sent24h, sent1h };
}
