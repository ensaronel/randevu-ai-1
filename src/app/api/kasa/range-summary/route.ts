import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { dateKeyRangeUtcISO, daysBetweenKeys } from "@/lib/date";

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kasa'daki tarih aralığı hesaplayıcısı: seçilen aralıktaki (iptal olmayan
 * randevuların tutarı) ciro, sabit giderlerin o aralığa oranlanan payı
 * (aylık tutar / 30 gün * aralıktaki gün sayısı) ve net kazanç (kâr/zarar).
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

    const [{ data: appointments, error: apptError }, { data: fixedExpenses, error: expError }] = await Promise.all([
      supabase
        .from("appointments")
        .select("status, appointment_services(planned_price, final_price)")
        .eq("business_id", owner.business_id)
        .gte("starts_at", startUtc)
        .lte("starts_at", endUtc),
      supabase.from("fixed_expenses").select("monthly_amount").eq("business_id", owner.business_id),
    ]);
    if (apptError) throw apptError;
    if (expError) throw expError;

    const revenue = (appointments ?? [])
      .filter((a) => a.status !== "cancelled")
      .reduce(
        (sum, a) => sum + a.appointment_services.reduce((s, svc) => s + Number(svc.final_price ?? svc.planned_price), 0),
        0
      );

    const totalMonthlyExpense = (fixedExpenses ?? []).reduce((sum, e) => sum + Number(e.monthly_amount), 0);
    const expenseShare = (totalMonthlyExpense / 30) * dayCount;
    const net = revenue - expenseShare;

    return NextResponse.json({ data: { from, to, dayCount, revenue, expenseShare, net } });
  });
}
