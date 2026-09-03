import type { FunctionDeclaration } from "@google/genai";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parseTimeToMinutes } from "@/lib/capacity";
import { formatDateTR, formatTimeTR } from "@/lib/date";
import { findAvailableSlots } from "@/lib/ai/availability";
import { loadBusinessContext } from "@/lib/ai/context";
import { matchWaitlistForCancelledAppointment } from "@/lib/proactive";
import type { Appointment, AppointmentService } from "@/types/database";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export const ASSISTANT_TOOLS: FunctionDeclaration[] = [
  {
    name: "get_revenue_summary",
    description:
      "Belirtilen tarih aralığında gerçekleşen (geldi işaretlenmiş) randevulardan elde edilen ciro, " +
      "randevu sayısı, iptal sayısı ve no-show sayısını döner. Ciro/kazanç ile ilgili her soru için kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD, aralığın başlangıcı (dahil)" },
        to: { type: "string", description: "YYYY-MM-DD, aralığın bitişi (dahil)" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_staff_performance",
    description:
      "Belirli bir personelin, belirtilen tarih aralığındaki doluluk oranını, cirosunu ve no-show/iptal " +
      "oranını döner. Personel performansıyla ilgili her soru için kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        staff_name: { type: "string", description: "Personelin sistemdeki tam adı" },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["staff_name", "from", "to"],
    },
  },
  {
    name: "get_customer_info",
    description:
      "Bir müşterinin ziyaret geçmişini, toplam harcamasını, son ziyaret tarihini ve no-show sayısını döner. " +
      "Müşteri adı veya telefon numarasıyla arar. Belirli bir müşteriyle ilgili her soru için kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Müşteri adı (tam veya kısmi) ya da telefon numarası" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_appointments",
    description:
      "Belirtilen tarih aralığındaki randevuları (müşteri, hizmet, personel, saat) listeler. " +
      "\"Yarın ne var\", \"bu hafta programım nasıl\" gibi program/takvim sorularında kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_popular_services",
    description:
      "Belirtilen tarih aralığında en çok rezerve edilen (iptal edilmemiş) hizmetleri, rezervasyon " +
      "sayılarına göre sıralı döner. \"En popüler hizmet\", \"en çok tercih edilen\" gibi sorularda kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_busy_hours",
    description:
      "Belirtilen tarih aralığında randevuların (iptal edilmemiş) hangi saat dilimlerinde yoğunlaştığını " +
      "döner. \"En yoğun saatler\", \"hangi saatte daha çok randevu alıyoruz\" gibi sorularda kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_lost_customers",
    description:
      "Daha önce en az iki kez gelmiş (düzenli) ama belirtilen gün sayısından beri hiç gelmemiş ve " +
      "yaklaşan randevusu olmayan müşterileri, son ziyaretlerinden bu yana geçen gün sayısıyla birlikte " +
      "listeler. \"Kimi kaybettik\", \"hangi müşteriler gelmiyor\" gibi sorularda kullan.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        min_days_since_last_visit: {
          type: "number",
          description: "Son ziyaretten bu yana en az kaç gün geçmiş olmalı — belirtilmezse 60 kullan.",
        },
      },
      required: ["min_days_since_last_visit"],
    },
  },
  {
    name: "find_customer_appointments",
    description:
      "Bir müşterinin yaklaşan (henüz gerçekleşmemiş) randevularını bulur, her birinin appointment_id'siyle " +
      "birlikte döner. Bir randevuyu İPTAL ETMEDEN veya ERTELEMEDEN ÖNCE mutlaka bunu çağırıp doğru " +
      "appointment_id'yi bul — asla tahmin etme.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        customer_query: { type: "string", description: "Müşteri adı (tam veya kısmi) ya da telefon numarası" },
      },
      required: ["customer_query"],
    },
  },
  {
    name: "cancel_appointment_action",
    description:
      "find_customer_appointments'ın döndürdüğü bir appointment_id'yi iptal eder. Owner AÇIKÇA onaylamadan " +
      "(ör. 'evet iptal et' demeden) ASLA çağırma — önce hangi randevudan bahsettiğini ve iptal etmek " +
      "istediğini owner'a net bir cümleyle teyit ettir.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        appointment_id: { type: "string", description: "find_customer_appointments'tan dönen appointment_id" },
      },
      required: ["appointment_id"],
    },
  },
  {
    name: "check_availability_for_owner",
    description:
      "Belirli bir tarihte, istenen hizmet(ler) için uygun randevu saatlerini bulur — owner'ın kendisi " +
      "manuel randevu oluşturmak istediğinde kullan. Asla saat uydurma.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        service_names: {
          type: "array",
          items: { type: "string" },
          description: "İstenen hizmet adları (sistemdeki tam adlarıyla)",
        },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["service_names", "date"],
    },
  },
  {
    name: "create_appointment_action",
    description:
      "check_availability_for_owner'ın önerdiği bir saati owner AÇIKÇA onayladıktan SONRA çağrılır — gerçek " +
      "randevuyu oluşturur. starts_at/ends_at/assignments değerlerini check_availability_for_owner'ın " +
      "döndürdüğü değerlerle BİREBİR aynı gönder.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        customer_query: { type: "string", description: "Randevu kime açılacak — müşteri adı veya telefonu" },
        starts_at: { type: "string", description: "check_availability_for_owner'dan dönen starts_at (ISO)" },
        ends_at: { type: "string", description: "check_availability_for_owner'dan dönen ends_at (ISO)" },
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
        },
      },
      required: ["customer_query", "starts_at", "ends_at", "assignments"],
    },
  },
  {
    name: "reschedule_appointment_action",
    description:
      "find_customer_appointments ile bulunan bir randevuyu, check_availability_for_owner'ın önerdiği yeni " +
      "bir saate taşır. Owner AÇIKÇA onaylamadan ASLA çağırma.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        appointment_id: { type: "string", description: "find_customer_appointments'tan dönen appointment_id" },
        starts_at: { type: "string", description: "check_availability_for_owner'dan dönen yeni starts_at (ISO)" },
        ends_at: { type: "string", description: "check_availability_for_owner'dan dönen yeni ends_at (ISO)" },
      },
      required: ["appointment_id", "starts_at", "ends_at"],
    },
  },
];

interface ToolContext {
  businessId: string;
}

export async function executeAssistantTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (name === "get_revenue_summary") return getRevenueSummary(input, ctx);
  if (name === "get_popular_services") return getPopularServices(input, ctx);
  if (name === "get_busy_hours") return getBusyHours(input, ctx);
  if (name === "get_lost_customers") return getLostCustomers(input, ctx);
  if (name === "get_staff_performance") return getStaffPerformance(input, ctx);
  if (name === "get_customer_info") return getCustomerInfo(input, ctx);
  if (name === "list_appointments") return listAppointments(input, ctx);
  if (name === "find_customer_appointments") return findCustomerAppointments(input, ctx);
  if (name === "cancel_appointment_action") return cancelAppointmentAction(input, ctx);
  if (name === "check_availability_for_owner") return checkAvailabilityForOwner(input, ctx);
  if (name === "create_appointment_action") return createAppointmentAction(input, ctx);
  if (name === "reschedule_appointment_action") return rescheduleAppointmentAction(input, ctx);
  return JSON.stringify({ error: `Bilinmeyen araç: ${name}` });
}

async function findCustomerAppointments(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const query = String(input.customer_query ?? "").trim();
  if (!query) return JSON.stringify({ error: "Müşteri adı veya telefon numarası gerekli." });

  const admin = createAdminSupabaseClient();
  const { data: customers } = await admin
    .from("customers")
    .select("id, full_name, phone")
    .eq("business_id", ctx.businessId)
    .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(5);

  if (!customers || customers.length === 0) {
    return JSON.stringify({ no_data: true, message: "Bu isimde/numarada bir müşteri bulunamadı." });
  }
  if (customers.length > 1) {
    return JSON.stringify({
      ambiguous: true,
      matches: customers.map((c) => ({ name: c.full_name, phone: c.phone })),
      message: "Birden fazla eşleşme var, hangisini kastettiğini netleştir.",
    });
  }

  const customer = customers[0];
  const { data: appointments } = await admin
    .from("appointments")
    .select("id, starts_at, appointment_services(service:services(name), staff:staff(full_name))")
    .eq("business_id", ctx.businessId)
    .eq("customer_id", customer.id)
    .in("status", ["scheduled", "confirmed"])
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");

  if (!appointments || appointments.length === 0) {
    return JSON.stringify({
      customer: { name: customer.full_name, phone: customer.phone },
      appointments: [],
      message: "Bu müşterinin yaklaşan randevusu yok.",
    });
  }

  return JSON.stringify({
    customer: { name: customer.full_name, phone: customer.phone },
    appointments: appointments.map((a) => ({
      appointment_id: a.id,
      display: `${formatDateTR(a.starts_at)} ${formatTimeTR(a.starts_at)}`,
      services: (a.appointment_services as unknown as { service: { name: string } | { name: string }[] | null; staff: { full_name: string } | { full_name: string }[] | null }[]).map(
        (s) => ({ service_name: one(s.service)?.name, staff_name: one(s.staff)?.full_name })
      ),
    })),
  });
}

async function cancelAppointmentAction(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const appointmentId = String(input.appointment_id ?? "");
  if (!appointmentId) return JSON.stringify({ error: "appointment_id gerekli." });

  const admin = createAdminSupabaseClient();
  const { data: appointment } = await admin
    .from("appointments")
    .select("id, status")
    .eq("business_id", ctx.businessId)
    .eq("id", appointmentId)
    .maybeSingle();

  if (!appointment) return JSON.stringify({ error: "Randevu bulunamadı." });
  if (appointment.status === "cancelled") return JSON.stringify({ error: "Bu randevu zaten iptal edilmiş." });

  const { error } = await admin.from("appointments").update({ status: "cancelled" }).eq("id", appointmentId);
  if (error) return JSON.stringify({ error: "İptal edilemedi, lütfen tekrar dene." });

  await matchWaitlistForCancelledAppointment(ctx.businessId, appointmentId).catch((err) =>
    console.error("waitlist match failed", err)
  );

  return JSON.stringify({ success: true });
}

async function checkAvailabilityForOwner(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const serviceNames = (input.service_names as string[] | undefined) ?? [];
  const dateKey = String(input.date ?? "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return JSON.stringify({ error: "Tarih YYYY-MM-DD formatında olmalı." });
  }

  const bizCtx = await loadBusinessContext(ctx.businessId);
  const normalized = serviceNames.map((n) => n.trim().toLowerCase());
  const requestedServices = bizCtx.services.filter((s) => normalized.includes(s.name.trim().toLowerCase()));
  if (requestedServices.length !== serviceNames.length) {
    return JSON.stringify({ error: `Bazı hizmet adları tanınmadı. Sistemdeki hizmetler: ${bizCtx.services.map((s) => s.name).join(", ")}` });
  }

  const admin = createAdminSupabaseClient();
  const { data: appointments } = await admin
    .from("appointments")
    .select("*, appointment_services(*)")
    .eq("business_id", ctx.businessId)
    .gte("starts_at", `${dateKey}T00:00:00+03:00`)
    .lt("starts_at", `${dateKey}T23:59:59+03:00`);

  const slots = findAvailableSlots({
    business: bizCtx.business,
    requestedServices,
    staff: bizCtx.staff,
    expertise: bizCtx.expertise,
    existingAppointments: (appointments ?? []) as (Appointment & { appointment_services: AppointmentService[] })[],
    dateKey,
  });

  if (slots.length === 0) {
    return JSON.stringify({ slots: [], message: "Bu tarihte uygun saat yok." });
  }

  return JSON.stringify({
    date: dateKey,
    slots: slots.map((slot) => ({
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      display: `${formatDateTR(slot.startsAt)} ${formatTimeTR(slot.startsAt)}`,
      assignments: slot.assignments.map((a) => ({ service_name: a.serviceName, staff_name: a.staffName })),
    })),
  });
}

async function createAppointmentAction(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const customerQuery = String(input.customer_query ?? "").trim();
  const startsAt = String(input.starts_at ?? "");
  const endsAt = String(input.ends_at ?? "");
  const rawAssignments = (input.assignments as { service_name: string; staff_name: string }[] | undefined) ?? [];

  if (!customerQuery) return JSON.stringify({ error: "Müşteri adı veya telefonu gerekli." });

  const admin = createAdminSupabaseClient();
  const { data: customers } = await admin
    .from("customers")
    .select("id, full_name, phone")
    .eq("business_id", ctx.businessId)
    .eq("status", "active")
    .or(`full_name.ilike.%${customerQuery}%,phone.ilike.%${customerQuery}%`)
    .limit(5);

  if (!customers || customers.length === 0) {
    return JSON.stringify({ error: "Müşteri bulunamadı. Önce Müşteriler ekranından kayıt oluşturulmalı." });
  }
  if (customers.length > 1) {
    return JSON.stringify({
      ambiguous: true,
      matches: customers.map((c) => ({ name: c.full_name, phone: c.phone })),
      message: "Birden fazla eşleşme var, hangisini kastettiğini netleştir.",
    });
  }
  const customer = customers[0];

  const bizCtx = await loadBusinessContext(ctx.businessId);
  const resolved = rawAssignments.map((a) => {
    const service = bizCtx.services.find((s) => s.name.trim().toLowerCase() === a.service_name.trim().toLowerCase());
    const staff = bizCtx.staff.find((s) => s.full_name.trim().toLowerCase() === a.staff_name.trim().toLowerCase());
    return { service, staff };
  });

  if (resolved.some((r) => !r.service || !r.staff)) {
    return JSON.stringify({ error: "Hizmet veya personel adı tanınmadı, önce check_availability_for_owner ile geçerli bir seçenek al." });
  }

  const { data: appointmentId, error } = await admin.rpc("create_appointment_with_services", {
    p_customer_id: customer.id,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_source: "manual",
    p_services: resolved.map((r) => ({
      service_id: r.service!.id,
      staff_id: r.staff!.id,
      planned_price: r.service!.price,
    })),
    p_business_id: ctx.businessId,
  });

  if (error) {
    if (error.message?.includes("staff_conflict")) {
      return JSON.stringify({ error: "Bu saat az önce başka bir randevuyla doldu, tekrar check_availability_for_owner çağır." });
    }
    return JSON.stringify({ error: "Randevu oluşturulamadı, lütfen tekrar dene." });
  }
  if (!appointmentId) {
    return JSON.stringify({ error: "Randevu oluşturulamadı, lütfen tekrar dene." });
  }

  return JSON.stringify({
    success: true,
    customer_name: customer.full_name,
    display: `${formatDateTR(startsAt)} ${formatTimeTR(startsAt)}`,
  });
}

async function rescheduleAppointmentAction(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const appointmentId = String(input.appointment_id ?? "");
  const startsAt = String(input.starts_at ?? "");
  const endsAt = String(input.ends_at ?? "");
  if (!appointmentId || !startsAt || !endsAt) {
    return JSON.stringify({ error: "appointment_id, starts_at ve ends_at gerekli." });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin.rpc("reschedule_appointment_with_check", {
    p_appointment_id: appointmentId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_business_id: ctx.businessId,
  });

  if (error) {
    if (error.message?.includes("staff_conflict")) {
      return JSON.stringify({ error: "Yeni saat az önce doldu, tekrar check_availability_for_owner çağır." });
    }
    if (error.message?.includes("not_found")) {
      return JSON.stringify({ error: "Randevu bulunamadı." });
    }
    return JSON.stringify({ error: "Erteleme yapılamadı, lütfen tekrar dene." });
  }

  return JSON.stringify({ success: true, display: `${formatDateTR(startsAt)} ${formatTimeTR(startsAt)}` });
}

function rangeToUtc(from: string, to: string) {
  return { startUtc: `${from}T00:00:00+03:00`, endUtc: `${to}T23:59:59+03:00` };
}

const NO_SHOW_VALUES = ["no_show_notified", "no_show_silent"];

async function getRevenueSummary(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return JSON.stringify({ error: "Tarihler YYYY-MM-DD formatında olmalı." });
  }
  const { startUtc, endUtc } = rangeToUtc(from, to);
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("appointments")
    .select("status, attendance, appointment_services(planned_price, final_price)")
    .eq("business_id", ctx.businessId)
    .gte("starts_at", startUtc)
    .lte("starts_at", endUtc);

  const rows = data ?? [];
  let revenue = 0;
  let cameCount = 0;
  let cancelledCount = 0;
  let noShowCount = 0;

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
      }
    }
  }

  if (rows.length === 0) {
    return JSON.stringify({ no_data: true, message: "Bu tarih aralığında hiç randevu kaydı yok." });
  }

  return JSON.stringify({ from, to, revenue, appointments_came: cameCount, cancelled: cancelledCount, no_show: noShowCount });
}

async function getPopularServices(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return JSON.stringify({ error: "Tarihler YYYY-MM-DD formatında olmalı." });
  }
  const { startUtc, endUtc } = rangeToUtc(from, to);
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("appointments")
    .select("status, appointment_services(service:services(name))")
    .eq("business_id", ctx.businessId)
    .neq("status", "cancelled")
    .gte("starts_at", startUtc)
    .lte("starts_at", endUtc);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    for (const svc of row.appointment_services) {
      const name = one(svc.service)?.name;
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    return JSON.stringify({ no_data: true, message: "Bu tarih aralığında hiç randevu kaydı yok." });
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([service_name, booking_count]) => ({ service_name, booking_count }));

  return JSON.stringify({ from, to, services: ranked });
}

const HOUR_LABEL = (hour: number) => `${String(hour).padStart(2, "0")}:00-${String(hour + 1).padStart(2, "0")}:00`;

async function getBusyHours(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return JSON.stringify({ error: "Tarihler YYYY-MM-DD formatında olmalı." });
  }
  const { startUtc, endUtc } = rangeToUtc(from, to);
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("appointments")
    .select("starts_at, status")
    .eq("business_id", ctx.businessId)
    .neq("status", "cancelled")
    .gte("starts_at", startUtc)
    .lte("starts_at", endUtc);

  if (!data || data.length === 0) {
    return JSON.stringify({ no_data: true, message: "Bu tarih aralığında hiç randevu kaydı yok." });
  }

  const counts = new Map<number, number>();
  for (const row of data) {
    const turkeyMs = new Date(row.starts_at).getTime() + 3 * 60 * 60000;
    const hour = new Date(turkeyMs).getUTCHours();
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hour, appointment_count]) => ({ hour_range: HOUR_LABEL(hour), appointment_count }));

  return JSON.stringify({ from, to, busy_hours: ranked });
}

async function getLostCustomers(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const minDays = Number(input.min_days_since_last_visit ?? 60);
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("appointments")
    .select("customer_id, starts_at, customer:customers(full_name)")
    .eq("business_id", ctx.businessId)
    .eq("attendance", "came")
    .order("starts_at", { ascending: true });

  const byCustomer = new Map<string, { name: string; visits: string[] }>();
  for (const row of data ?? []) {
    const name = one(row.customer)?.full_name ?? "Müşteri";
    const entry: { name: string; visits: string[] } = byCustomer.get(row.customer_id) ?? { name, visits: [] };
    entry.visits.push(row.starts_at);
    byCustomer.set(row.customer_id, entry);
  }

  const nowMs = Date.now();
  const lost: { customer_name: string; days_since_last_visit: number; total_past_visits: number }[] = [];

  for (const [customerId, entry] of byCustomer) {
    if (entry.visits.length < 2) continue;
    const lastVisit = entry.visits[entry.visits.length - 1];
    const daysSince = Math.round((nowMs - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < minDays) continue;

    const { data: upcoming } = await admin
      .from("appointments")
      .select("id")
      .eq("business_id", ctx.businessId)
      .eq("customer_id", customerId)
      .in("status", ["scheduled", "confirmed"])
      .gte("starts_at", new Date().toISOString())
      .limit(1);
    if (upcoming && upcoming.length > 0) continue;

    lost.push({ customer_name: entry.name, days_since_last_visit: daysSince, total_past_visits: entry.visits.length });
  }

  if (lost.length === 0) {
    return JSON.stringify({ no_data: true, message: `${minDays} günden fazladır gelmeyen, eskiden düzenli gelen bir müşteri yok.` });
  }

  lost.sort((a, b) => b.days_since_last_visit - a.days_since_last_visit);
  return JSON.stringify({ min_days_since_last_visit: minDays, lost_customers: lost });
}

async function computeAvailableMinutes(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  staffId: string,
  from: string,
  to: string,
  workingHours: Record<string, [string, string]>,
  leaveDates: string[]
): Promise<number> {
  const { data: business } = await admin
    .from("staff")
    .select("business:businesses(closed_dates)")
    .eq("id", staffId)
    .single();
  const closedDates = ((business as unknown as { business: { closed_dates: string[] } | null })?.business?.closed_dates) ?? [];

  let totalMinutes = 0;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateKey = d.toISOString().slice(0, 10);
    if (leaveDates.includes(dateKey) || closedDates.includes(dateKey)) continue;
    const weekdayKey = WEEKDAY_KEYS[d.getUTCDay()];
    const shift = workingHours?.[weekdayKey];
    if (!shift) continue;
    totalMinutes += Math.max(0, parseTimeToMinutes(shift[1]) - parseTimeToMinutes(shift[0]));
  }
  return totalMinutes;
}

async function getStaffPerformance(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const staffName = String(input.staff_name ?? "").trim().toLowerCase();
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return JSON.stringify({ error: "Tarihler YYYY-MM-DD formatında olmalı." });
  }

  const admin = createAdminSupabaseClient();
  const { data: staffRows } = await admin.from("staff").select("*").eq("business_id", ctx.businessId);
  const staff = (staffRows ?? []).find((s) => s.full_name.trim().toLowerCase() === staffName);
  if (!staff) {
    const known = (staffRows ?? []).map((s) => s.full_name).join(", ");
    return JSON.stringify({ error: `Personel bulunamadı. Sistemdeki personeller: ${known}` });
  }

  const { startUtc, endUtc } = rangeToUtc(from, to);
  const { data: apptRows } = await admin
    .from("appointments")
    .select("status, attendance, appointment_services(staff_id, planned_price, final_price, service:services(duration_minutes))")
    .eq("business_id", ctx.businessId)
    .gte("starts_at", startUtc)
    .lte("starts_at", endUtc);

  let revenue = 0;
  let bookedMinutes = 0;
  let totalAssignments = 0;
  let noShowOrCancelled = 0;

  for (const row of apptRows ?? []) {
    for (const svc of row.appointment_services) {
      if (svc.staff_id !== staff.id) continue;
      totalAssignments++;
      const isCancelled = row.status === "cancelled";
      const isNoShow = NO_SHOW_VALUES.includes(row.attendance ?? "");
      if (isCancelled || isNoShow) noShowOrCancelled++;
      if (!isCancelled) {
        const service = Array.isArray(svc.service) ? svc.service[0] : svc.service;
        bookedMinutes += service?.duration_minutes ?? 0;
      }
      if (row.attendance === "came") revenue += Number(svc.final_price ?? svc.planned_price);
    }
  }

  const availableMinutes = await computeAvailableMinutes(admin, staff.id, from, to, staff.working_hours, staff.leave_dates ?? []);
  const occupancyPercent = availableMinutes > 0 ? Math.round((bookedMinutes / availableMinutes) * 100) : 0;
  const noShowRatePercent = totalAssignments > 0 ? Math.round((noShowOrCancelled / totalAssignments) * 100) : 0;

  if (totalAssignments === 0) {
    return JSON.stringify({ no_data: true, message: `${staff.full_name} için bu tarih aralığında hiç randevu yok.` });
  }

  return JSON.stringify({
    staff_name: staff.full_name,
    from,
    to,
    revenue,
    occupancy_percent: occupancyPercent,
    no_show_rate_percent: noShowRatePercent,
    total_assignments: totalAssignments,
  });
}

async function getCustomerInfo(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const query = String(input.query ?? "").trim();
  if (!query) return JSON.stringify({ error: "Müşteri adı veya telefon numarası gerekli." });

  const admin = createAdminSupabaseClient();
  const { data: customers } = await admin
    .from("customers")
    .select("*")
    .eq("business_id", ctx.businessId)
    .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(5);

  if (!customers || customers.length === 0) {
    return JSON.stringify({ no_data: true, message: "Bu isimde/numarada bir müşteri bulunamadı." });
  }
  if (customers.length > 1) {
    return JSON.stringify({
      ambiguous: true,
      matches: customers.map((c) => ({ name: c.full_name, phone: c.phone })),
      message: "Birden fazla eşleşme var, hangisini kastettiğini netleştir.",
    });
  }

  const customer = customers[0];
  const { data: visits } = await admin
    .from("appointments")
    .select("starts_at, attendance, appointment_services(planned_price, final_price)")
    .eq("business_id", ctx.businessId)
    .eq("customer_id", customer.id)
    .eq("attendance", "came")
    .order("starts_at", { ascending: false });

  const totalSpend = (visits ?? []).reduce(
    (sum, v) => sum + v.appointment_services.reduce((s, svc) => s + Number(svc.final_price ?? svc.planned_price), 0),
    0
  );

  return JSON.stringify({
    name: customer.full_name,
    phone: customer.phone,
    total_visits: (visits ?? []).length,
    total_spend: totalSpend,
    last_visit: visits && visits.length > 0 ? formatDateTR(visits[0].starts_at) : null,
    no_show_count: customer.no_show_count,
    notes: customer.notes,
  });
}

async function listAppointments(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return JSON.stringify({ error: "Tarihler YYYY-MM-DD formatında olmalı." });
  }
  const { startUtc, endUtc } = rangeToUtc(from, to);
  const admin = createAdminSupabaseClient();

  const { data } = await admin
    .from("appointments")
    .select("starts_at, customer:customers(full_name), appointment_services(service:services(name), staff:staff(full_name))")
    .eq("business_id", ctx.businessId)
    .neq("status", "cancelled")
    .gte("starts_at", startUtc)
    .lte("starts_at", endUtc)
    .order("starts_at");

  if (!data || data.length === 0) {
    return JSON.stringify({ no_data: true, message: "Bu tarih aralığında hiç randevu yok." });
  }

  return JSON.stringify({
    appointments: data.map((a) => {
      const customer = Array.isArray(a.customer) ? a.customer[0] : a.customer;
      return {
        display_time: `${formatDateTR(a.starts_at)} ${formatTimeTR(a.starts_at)}`,
        customer_name: customer?.full_name ?? "Müşteri",
        services: a.appointment_services.map((s) => {
          const service = Array.isArray(s.service) ? s.service[0] : s.service;
          const staff = Array.isArray(s.staff) ? s.staff[0] : s.staff;
          return { service_name: service?.name, staff_name: staff?.full_name };
        }),
      };
    }),
  });
}
