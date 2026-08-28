import type { FunctionDeclaration } from "@google/genai";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { findAvailableSlots } from "@/lib/ai/availability";
import { matchWaitlistForCancelledAppointment } from "@/lib/proactive";
import { formatDateTR, formatTimeTR } from "@/lib/date";
import type { AiBusinessContext } from "@/lib/ai/context";
import type { Appointment, AppointmentService } from "@/types/database";

export const AI_TOOLS: FunctionDeclaration[] = [
  {
    name: "check_availability",
    description:
      "Belirli bir tarihte, istenen hizmet(ler) için uygun randevu saatlerini bulur. " +
      "Müşteriye asla kendin bir saat uydurma — her zaman bu aracı kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        service_names: {
          type: "array",
          items: { type: "string" },
          description: "İstenen hizmet adları (sistemdeki tam adlarıyla), örn. [\"Saç Kesimi\"]",
        },
        date: {
          type: "string",
          description: "YYYY-MM-DD formatında tarih (Türkiye yerel tarihi)",
        },
      },
      required: ["service_names", "date"],
    },
  },
  {
    name: "create_appointment",
    description:
      "Müşteri check_availability'nin önerdiği bir saati onayladıktan SONRA çağrılır — " +
      "gerçek randevuyu oluşturur. Müşterinin açıkça onayı olmadan asla çağırma.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        starts_at: { type: "string", description: "check_availability'den dönen aday saatin starts_at değeri (ISO)" },
        ends_at: { type: "string", description: "check_availability'den dönen aday saatin ends_at değeri (ISO)" },
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              service_name: { type: "string" },
              staff_name: { type: "string" },
            },
            required: ["service_name", "staff_name"],
          },
          description: "check_availability'nin döndüğü assignments dizisiyle birebir aynı olmalı",
        },
      },
      required: ["starts_at", "ends_at", "assignments"],
    },
  },
  {
    name: "list_my_appointments",
    description:
      "Müşterinin yaklaşan (henüz gerçekleşmemiş) randevularını listeler. İptal veya erteleme " +
      "talebi geldiğinde, hangi randevudan bahsettiğini netleştirmek için önce bunu çağır.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "cancel_appointment",
    description:
      "list_my_appointments'ın döndürdüğü bir randevuyu iptal eder. Müşteri açıkça iptal istemeden " +
      "asla çağırma. Erteleme talebinde önce bunu, sonra check_availability + create_appointment'ı kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        starts_at: { type: "string", description: "list_my_appointments'tan dönen iptal edilecek randevunun starts_at değeri (ISO)" },
      },
      required: ["starts_at"],
    },
  },
  {
    name: "join_waitlist",
    description:
      "check_availability istenen tarihte uygun saat bulamadığında, müşteri başka bir gün/saat " +
      "boşaldığında haber verilmesini isterse çağır. Müşteriden hangi gün(ler) ve saat aralığını " +
      "istediğini mutlaka sor, tahmin etme.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        service_name: { type: "string", description: "İstenen hizmet adı (sistemdeki tam adıyla)" },
        days: {
          type: "array",
          items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
          description: "Müşterinin uygun olduğu gün(ler)",
        },
        from: { type: "string", description: "Uygun saat aralığının başlangıcı, HH:MM" },
        to: { type: "string", description: "Uygun saat aralığının bitişi, HH:MM" },
      },
      required: ["service_name", "days", "from", "to"],
    },
  },
  {
    name: "escalate",
    description:
      "Müşterinin ne istediğini anlayamıyorsan, sistemin karşılayamayacağı bir talep ise " +
      "(ör. karmaşık şikayet, fiyat pazarlığı, sistemin desteklemediği bir işlem) bu aracı çağır. " +
      "Asla tahmin ederek yanlış bilgi verme — emin değilsen eskale et.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Neden eskale edildiği, işletme sahibinin göreceği kısa not" },
      },
      required: ["reason"],
    },
  },
];

interface ToolExecContext {
  ctx: AiBusinessContext;
  customerId: string;
}

export async function executeAiTool(
  name: string,
  input: Record<string, unknown>,
  exec: ToolExecContext
): Promise<{ result: string; escalated: boolean; escalationReason?: string }> {
  if (name === "check_availability") {
    return { result: await runCheckAvailability(input, exec), escalated: false };
  }
  if (name === "create_appointment") {
    return { result: await runCreateAppointment(input, exec), escalated: false };
  }
  if (name === "list_my_appointments") {
    return { result: await runListMyAppointments(exec), escalated: false };
  }
  if (name === "cancel_appointment") {
    return { result: await runCancelAppointment(input, exec), escalated: false };
  }
  if (name === "join_waitlist") {
    return { result: await runJoinWaitlist(input, exec), escalated: false };
  }
  if (name === "escalate") {
    const reason = String(input.reason ?? "belirtilmedi");
    return { result: "İşletme sahibine iletildi.", escalated: true, escalationReason: reason };
  }
  return { result: `Bilinmeyen araç: ${name}`, escalated: false };
}

async function runCheckAvailability(input: Record<string, unknown>, exec: ToolExecContext): Promise<string> {
  const serviceNames = (input.service_names as string[] | undefined) ?? [];
  const dateKey = String(input.date ?? "");

  const normalizedRequested = serviceNames.map((n) => n.trim().toLowerCase());
  const requestedServices = exec.ctx.services.filter((s) => normalizedRequested.includes(s.name.trim().toLowerCase()));

  if (requestedServices.length !== serviceNames.length) {
    const known = exec.ctx.services.map((s) => s.name).join(", ");
    return JSON.stringify({ error: `Bazı hizmet adları tanınmadı. Sistemdeki hizmetler: ${known}` });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return JSON.stringify({ error: "Tarih YYYY-MM-DD formatında olmalı." });
  }

  const admin = createAdminSupabaseClient();
  const { data: appointments } = await admin
    .from("appointments")
    .select("*, appointment_services(*)")
    .eq("business_id", exec.ctx.business.id)
    .gte("starts_at", `${dateKey}T00:00:00+03:00`)
    .lt("starts_at", `${dateKey}T23:59:59+03:00`);

  const slots = findAvailableSlots({
    business: exec.ctx.business,
    requestedServices,
    staff: exec.ctx.staff,
    expertise: exec.ctx.expertise,
    existingAppointments: (appointments ?? []) as (Appointment & { appointment_services: AppointmentService[] })[],
    dateKey,
  });

  if (slots.length === 0) {
    return JSON.stringify({ slots: [], message: "O tarihte uygun saat bulunamadı." });
  }

  return JSON.stringify({
    slots: slots.map((slot) => ({
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      display: `${formatDateTR(slot.startsAt)} ${formatTimeTR(slot.startsAt)}`,
      assignments: slot.assignments.map((a) => ({ service_name: a.serviceName, staff_name: a.staffName })),
    })),
  });
}

async function runCreateAppointment(input: Record<string, unknown>, exec: ToolExecContext): Promise<string> {
  const startsAt = String(input.starts_at ?? "");
  const endsAt = String(input.ends_at ?? "");
  const rawAssignments = (input.assignments as { service_name: string; staff_name: string }[] | undefined) ?? [];

  const resolved = rawAssignments.map((a) => {
    const service = exec.ctx.services.find((s) => s.name.trim().toLowerCase() === a.service_name.trim().toLowerCase());
    const staff = exec.ctx.staff.find((s) => s.full_name.trim().toLowerCase() === a.staff_name.trim().toLowerCase());
    return { service, staff };
  });

  if (resolved.some((r) => !r.service || !r.staff)) {
    return JSON.stringify({ error: "Hizmet veya personel adı tanınmadı, önce check_availability ile geçerli bir seçenek al." });
  }

  const admin = createAdminSupabaseClient();

  // Son anda çakışma oluşmuş mu diye tekrar kontrol (iki mesaj arasında başka bir randevu girilmiş olabilir).
  for (const { staff } of resolved) {
    const { data: conflicts } = await admin
      .from("appointment_services")
      .select("appointment_id, appointments!inner(starts_at, ends_at, status, business_id)")
      .eq("staff_id", staff!.id)
      .eq("appointments.business_id", exec.ctx.business.id)
      .neq("appointments.status", "cancelled")
      .lt("appointments.starts_at", endsAt)
      .gt("appointments.ends_at", startsAt);

    if (conflicts && conflicts.length > 0) {
      return JSON.stringify({ error: "Bu saat az önce başka bir randevuyla doldu, lütfen tekrar check_availability çağır." });
    }
  }

  const { data: appointment, error: apptError } = await admin
    .from("appointments")
    .insert({
      business_id: exec.ctx.business.id,
      customer_id: exec.customerId,
      starts_at: startsAt,
      ends_at: endsAt,
      source: "whatsapp_ai",
    })
    .select()
    .single();

  if (apptError || !appointment) {
    return JSON.stringify({ error: "Randevu oluşturulamadı, lütfen tekrar dene." });
  }

  const { error: servicesError } = await admin.from("appointment_services").insert(
    resolved.map((r) => ({
      appointment_id: appointment.id,
      service_id: r.service!.id,
      staff_id: r.staff!.id,
      planned_price: r.service!.price,
    }))
  );

  if (servicesError) {
    return JSON.stringify({ error: "Randevu oluşturulamadı, lütfen tekrar dene." });
  }

  return JSON.stringify({ success: true, display: `${formatDateTR(startsAt)} ${formatTimeTR(startsAt)}` });
}

async function runListMyAppointments(exec: ToolExecContext): Promise<string> {
  const admin = createAdminSupabaseClient();
  const { data: appointments } = await admin
    .from("appointments")
    .select("starts_at, ends_at, status, appointment_services(services(name), staff(full_name))")
    .eq("business_id", exec.ctx.business.id)
    .eq("customer_id", exec.customerId)
    .in("status", ["scheduled", "confirmed"])
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");

  if (!appointments || appointments.length === 0) {
    return JSON.stringify({ appointments: [], message: "Yaklaşan randevu bulunamadı." });
  }

  return JSON.stringify({
    appointments: appointments.map((a) => ({
      starts_at: a.starts_at,
      display: `${formatDateTR(a.starts_at)} ${formatTimeTR(a.starts_at)}`,
      services: (a.appointment_services as unknown as { services: { name: string } | null; staff: { full_name: string } | null }[]).map(
        (s) => ({ service_name: s.services?.name, staff_name: s.staff?.full_name })
      ),
    })),
  });
}

async function runCancelAppointment(input: Record<string, unknown>, exec: ToolExecContext): Promise<string> {
  const startsAt = String(input.starts_at ?? "");
  const admin = createAdminSupabaseClient();

  const { data: appointment } = await admin
    .from("appointments")
    .select("id, status")
    .eq("business_id", exec.ctx.business.id)
    .eq("customer_id", exec.customerId)
    .eq("starts_at", startsAt)
    .maybeSingle();

  if (!appointment) {
    return JSON.stringify({ error: "Bu randevu bulunamadı, önce list_my_appointments ile kontrol et." });
  }
  if (appointment.status === "cancelled") {
    return JSON.stringify({ error: "Bu randevu zaten iptal edilmiş." });
  }

  // Soft-delete: satır silinmez, sadece durumu 'cancelled' olarak işaretlenir.
  const { error } = await admin.from("appointments").update({ status: "cancelled" }).eq("id", appointment.id);
  if (error) {
    return JSON.stringify({ error: "İptal edilemedi, lütfen tekrar dene." });
  }

  await matchWaitlistForCancelledAppointment(exec.ctx.business.id, appointment.id).catch((err) =>
    console.error("waitlist match failed", err)
  );

  return JSON.stringify({ success: true });
}

async function runJoinWaitlist(input: Record<string, unknown>, exec: ToolExecContext): Promise<string> {
  const serviceName = String(input.service_name ?? "");
  const days = (input.days as string[] | undefined) ?? [];
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");

  const service = exec.ctx.services.find((s) => s.name.trim().toLowerCase() === serviceName.trim().toLowerCase());
  if (!service) {
    const known = exec.ctx.services.map((s) => s.name).join(", ");
    return JSON.stringify({ error: `Hizmet tanınmadı. Sistemdeki hizmetler: ${known}` });
  }
  if (days.length === 0 || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    return JSON.stringify({ error: "Gün(ler) ve saat aralığı (HH:MM) eksik veya hatalı." });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("waitlist_entries").insert({
    business_id: exec.ctx.business.id,
    customer_id: exec.customerId,
    desired_service_id: service.id,
    desired_time_range: { from, to, days },
  });

  if (error) {
    return JSON.stringify({ error: "Bekleme listesine eklenemedi, lütfen tekrar dene." });
  }
  return JSON.stringify({ success: true });
}
