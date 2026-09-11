import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/api-response";
import { PAYMENT_GRACE_DAYS } from "@/lib/billing";

/**
 * Günde 1 kez çalışır (vercel.json), vade tarihi + PAYMENT_GRACE_DAYS geçtiği
 * halde hâlâ ödeme (EFT/nakit, admin panelinde elle) onaylanmamış işletmeleri
 * otomatik askıya alır. is_active=false yapmak yeterli — bu zaten mevcut
 * "elle kapatma anahtarı" (src/lib/auth.ts, whatsapp webhook) tarafından
 * WhatsApp botunu ve dashboard erişimini engelliyor, ayrı bir kontrol
 * eklemeye gerek yok.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - PAYMENT_GRACE_DAYS);
    const cutoffKey = cutoff.toISOString().slice(0, 10);

    const { data: overdue, error } = await admin
      .from("businesses")
      .select("id, name")
      .eq("subscription_status", "active")
      .not("next_payment_due_date", "is", null)
      .lt("next_payment_due_date", cutoffKey);
    if (error) throw error;

    if (!overdue || overdue.length === 0) {
      return NextResponse.json({ suspended: [] });
    }

    const ids = overdue.map((b) => b.id);
    const { error: updateError } = await admin
      .from("businesses")
      .update({ subscription_status: "suspended", is_active: false })
      .in("id", ids);
    if (updateError) throw updateError;

    return NextResponse.json({ suspended: overdue.map((b) => ({ id: b.id, name: b.name })) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
