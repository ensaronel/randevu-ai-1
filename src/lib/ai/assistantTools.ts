import type { FunctionDeclaration } from "@google/genai";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parseTimeToMinutes } from "@/lib/capacity";
import { formatDateTR, formatTimeTR } from "@/lib/date";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

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
];

interface ToolContext {
  businessId: string;
}

export async function executeAssistantTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (name === "get_revenue_summary") return getRevenueSummary(input, ctx);
  if (name === "get_staff_performance") return getStaffPerformance(input, ctx);
  if (name === "get_customer_info") return getCustomerInfo(input, ctx);
  if (name === "list_appointments") return listAppointments(input, ctx);
  return JSON.stringify({ error: `Bilinmeyen araç: ${name}` });
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
