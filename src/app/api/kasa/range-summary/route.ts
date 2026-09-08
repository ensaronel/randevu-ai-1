import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { dateKeyRangeUtcISO, daysBetweenKeys, addDaysToKey, dateKeyFromIso } from "@/lib/date";

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CHART_DAYS = 31;

type ApptRow = {
  starts_at: string;
  status: string;
  appointment_services: { planned_price: number; final_price: number | null; payment_method: string | null }[];
};

function revenueOf(appointments: ApptRow[]): number {
  return appointments
    .filter((a) => a.status !== "cancelled")
    .reduce(
      (sum, a) => sum + a.appointment_services.reduce((s, svc) => s + Number(svc.final_price ?? svc.planned_price), 0),
      0
    );
}

/**
 * Kasa'daki tarih aralığı hesaplayıcısı: seçilen aralıktaki (iptal olmayan
 * randevuların tutarı) ciro — nakit/kart kırılımıyla —, sabit giderlerin o
 * aralığa oranlanan payı + aralığa düşen tek seferlik giderler, net
 * kazanç (kâr/zarar), önceki eşit uzunluktaki döneme göre % değişim, ve
 * (aralık 31 günü aşmıyorsa) günlük ciro grafiği.
 */
export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";

    if (!DATE_KEY_REGEX.test(from) || !DATE_KEY_REGEX.test(to) || from > to) {
      return NextResponse.json({ error: "invalid_range" }, { status: 400 });
    }

    const { startUtc, endUtc } = dateKeyRangeUtcISO(from, to);
    const dayCount = daysBetweenKeys(from, to);
    const previousTo = addDaysToKey(from, -1);
    const previousFrom = addDaysToKey(from, -dayCount);
    const { startUtc: prevStartUtc, endUtc: prevEndUtc } = dateKeyRangeUtcISO(previousFrom, previousTo);

    const [
      { data: appointments, error: apptError },
      { data: previousAppointments, error: prevApptError },
      { data: fixedExpenses, error: fixedError },
      { data: oneTimeExpenses, error: oneTimeError },
    ] = await Promise.all([
      supabase
        .from("appointments")
        .select("starts_at, status, appointment_services(planned_price, final_price, payment_method)")
        .eq("business_id", owner.business_id)
        .gte("starts_at", startUtc)
        .lte("starts_at", endUtc),
      supabase
        .from("appointments")
        .select("starts_at, status, appointment_services(planned_price, final_price, payment_method)")
        .eq("business_id", owner.business_id)
        .gte("starts_at", prevStartUtc)
        .lte("starts_at", prevEndUtc),
      supabase.from("fixed_expenses").select("monthly_amount").eq("business_id", owner.business_id),
      supabase
        .from("one_time_expenses")
        .select("*")
        .eq("business_id", owner.business_id)
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("expense_date", { ascending: false }),
    ]);
    if (apptError) throw apptError;
    if (prevApptError) throw prevApptError;
    if (fixedError) throw fixedError;
    if (oneTimeError) throw oneTimeError;

    const apptRows = (appointments ?? []) as ApptRow[];
    const revenue = revenueOf(apptRows);
    const previousRevenue = revenueOf((previousAppointments ?? []) as ApptRow[]);
    const revenueChangePercent = previousRevenue > 0 ? ((revenue - previousRevenue) / previousRevenue) * 100 : null;

    let cashRevenue = 0;
    let cardRevenue = 0;
    let unspecifiedRevenue = 0;
    for (const appt of apptRows) {
      if (appt.status === "cancelled") continue;
      for (const svc of appt.appointment_services) {
        const amount = Number(svc.final_price ?? svc.planned_price);
        if (svc.payment_method === "nakit") cashRevenue += amount;
        else if (svc.payment_method === "kart") cardRevenue += amount;
        else unspecifiedRevenue += amount;
      }
    }

    const totalMonthlyExpense = (fixedExpenses ?? []).reduce((sum, e) => sum + Number(e.monthly_amount), 0);
    const fixedExpenseShare = (totalMonthlyExpense / 30) * dayCount;
    const oneTimeExpenseTotal = (oneTimeExpenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
    const expenseShare = fixedExpenseShare + oneTimeExpenseTotal;
    const net = revenue - expenseShare;

    let dailyChart: { date: string; revenue: number }[] | null = null;
    if (dayCount <= MAX_CHART_DAYS) {
      const byDate = new Map<string, number>();
      let cursor = from;
      for (let i = 0; i < dayCount; i++) {
        byDate.set(cursor, 0);
        cursor = addDaysToKey(cursor, 1);
      }
      for (const appt of apptRows) {
        if (appt.status === "cancelled") continue;
        const key = dateKeyFromIso(appt.starts_at);
        const apptRevenue = appt.appointment_services.reduce(
          (s, svc) => s + Number(svc.final_price ?? svc.planned_price),
          0
        );
        byDate.set(key, (byDate.get(key) ?? 0) + apptRevenue);
      }
      dailyChart = Array.from(byDate.entries()).map(([date, rev]) => ({ date, revenue: rev }));
    }

    return NextResponse.json({
      data: {
        from,
        to,
        dayCount,
        revenue,
        cashRevenue,
        cardRevenue,
        unspecifiedRevenue,
        expenseShare,
        net,
        previousRevenue,
        revenueChangePercent,
        oneTimeExpenses: oneTimeExpenses ?? [],
        dailyChart,
      },
    });
  });
}
