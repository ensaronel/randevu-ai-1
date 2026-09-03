import { NextRequest, NextResponse } from "next/server";
import { sendDueReminders } from "@/lib/reminders";
import { verifyCronSecret } from "@/lib/api-response";

/**
 * Vercel Cron günde 1 kez sınırlı olduğu için (Hobby plan), bu endpoint
 * Supabase'in kendi zamanlayıcısı (pg_cron + pg_net) tarafından sık aralıklarla
 * (örn. her 10-15 dakikada bir) tetiklenir — bkz. schema.sql'in sonundaki
 * pg_cron kurulum notu. Aynı CRON_SECRET korumasını kullanıyor.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDueReminders();
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
