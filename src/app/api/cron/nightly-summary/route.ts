import { NextRequest, NextResponse } from "next/server";
import { runProactiveInsightsForAllBusinesses } from "@/lib/proactive";
import { runWeeklySummaryForAllBusinesses } from "@/lib/weeklySummary";
import { runNightlyReklamContentForAllBusinesses } from "@/lib/reklamContent";
import { verifyCronSecret } from "@/lib/api-response";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Vercel Cron her gün bunu tetikler (bkz. vercel.json). Vercel, projede
 * CRON_SECRET tanımlıysa Cron Job isteklerine otomatik olarak
 * `Authorization: Bearer <CRON_SECRET>` ekler — burada aynı değeri kontrol ediyoruz.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const proactiveResults = await runProactiveInsightsForAllBusinesses();
    const weeklyResults = await runWeeklySummaryForAllBusinesses();
    await runNightlyReklamContentForAllBusinesses();

    // Webhook tekrar-teslim koruması (wamid) tablosunu şişirmemek için 14 günden eski kayıtları sil.
    // Tablo henüz yoksa hata sessizce yutulur.
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    await createAdminSupabaseClient().from("whatsapp_processed_messages").delete().lt("created_at", cutoff);

    return NextResponse.json({ proactiveResults, weeklyResults });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
