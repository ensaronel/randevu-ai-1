import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { reconcileDaySchema } from "@/lib/validation";
import { dateKeyTR } from "@/lib/date";

/**
 * "Günü Kapat" — o günün gerçekleşen (attendance='came') randevularından
 * final_price varsa onu, yoksa planned_price'ı toplayıp daily_financial_summaries'e
 * yazar. (business_id, summary_date) unique olduğu için tekrar basılırsa günceller,
 * yeni satır açmaz.
 */
export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { date } = reconcileDaySchema.parse(await request.json().catch(() => ({})));

    const dateKey = date ?? dateKeyTR(0);
    const { startUtc, endUtc } = dayRangeFromKey(dateKey);

    const { data: appointments, error: apptError } = await supabase
      .from("appointments")
      .select("attendance, appointment_services(planned_price, final_price)")
      .eq("business_id", owner.business_id)
      .gte("starts_at", startUtc)
      .lt("starts_at", endUtc);

    if (apptError) throw apptError;

    const actualRevenue = (appointments ?? [])
      .filter((a) => a.attendance === "came")
      .reduce(
        (sum, a) =>
          sum +
          a.appointment_services.reduce(
            (s, svc) => s + Number(svc.final_price ?? svc.planned_price),
            0
          ),
        0
      );

    const { data, error } = await supabase
      .from("daily_financial_summaries")
      .upsert(
        {
          business_id: owner.business_id,
          summary_date: dateKey,
          actual_revenue: actualRevenue,
          reconciled_at: new Date().toISOString(),
        },
        { onConflict: "business_id,summary_date" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  });
}

function dayRangeFromKey(dateKey: string): { startUtc: string; endUtc: string } {
  return {
    startUtc: `${dateKey}T00:00:00+03:00`,
    endUtc: `${dateKey}T23:59:59.999+03:00`,
  };
}
