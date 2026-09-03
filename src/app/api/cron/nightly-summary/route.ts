import { NextRequest, NextResponse } from "next/server";
import { runNightlySummaryForAllBusinesses } from "@/lib/nightlySummary";
import { runProactiveInsightsForAllBusinesses } from "@/lib/proactive";
import { runWeeklySummaryForAllBusinesses } from "@/lib/weeklySummary";

/**
 * Vercel Cron her gün bunu tetikler (bkz. vercel.json). Vercel, projede
 * CRON_SECRET tanımlıysa Cron Job isteklerine otomatik olarak
 * `Authorization: Bearer <CRON_SECRET>` ekler — burada aynı değeri kontrol ediyoruz.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const financeResults = await runNightlySummaryForAllBusinesses();
    const proactiveResults = await runProactiveInsightsForAllBusinesses();
    const weeklyResults = await runWeeklySummaryForAllBusinesses();
    return NextResponse.json({ financeResults, proactiveResults, weeklyResults });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
