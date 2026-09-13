import { NextRequest, NextResponse } from "next/server";
import { expireStaleWaitlistOffers } from "@/lib/proactive";
import { verifyCronSecret } from "@/lib/api-response";

/**
 * Bekleme listesi teklifleri saat hassasiyetinde süre aşımına uğramalı (bkz.
 * WAITLIST_OFFER_TIMEOUT_HOURS) - Vercel Cron'un ücretsiz katmanı günde 1
 * kere ile sınırlı, bu yüzden diğer saat-hassas iş (reminders) gibi bu da
 * Supabase pg_cron + pg_net ile tetiklenir, Vercel Cron'a EKLENMEZ (bkz.
 * schema.sql'deki pg_cron notu).
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await expireStaleWaitlistOffers();
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
