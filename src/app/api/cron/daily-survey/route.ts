import { NextRequest, NextResponse } from "next/server";
import { runDailySurveyForAllBusinesses } from "@/lib/dailySurvey";
import { verifyCronSecret } from "@/lib/api-response";

/**
 * Vercel Cron akşam (kapanış civarı) tetikler (bkz. vercel.json) — nightly-summary'den
 * (gece yarısından sonra, dünü özetler) FARKLI bir saatte çalışır çünkü bu, aynı GÜN
 * içinde, ziyaret hâlâ tazeyken müşteriye anket önerisi sunmak için var.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const results = await runDailySurveyForAllBusinesses();
    return NextResponse.json({ results });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
