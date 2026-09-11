import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { handleRoute } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { nextDueDateAfterPayment } from "@/lib/billing";
import { confirmPaymentSchema } from "@/lib/validation";

/**
 * Aylık tekrar eden ödeme (EFT/nakit) elle onaylandığında tetiklenir — ilk
 * aktivasyondan (confirm-payment) FARKLI: Twilio numarası tekrar satın
 * alınmaz, sadece vade tarihi ileri alınır ve ödeme geçmişine bir satır
 * eklenir. İşletme daha önce ödeme gecikmesinden askıya alınmışsa
 * (subscription_status='suspended' + is_active=false, bkz.
 * /api/cron/suspend-overdue) burada yeniden aktif edilir.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { email } = await requirePlatformAdmin();
    const { id } = await params;
    const { method } = confirmPaymentSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();

    const { data: business, error: fetchError } = await admin.from("businesses").select("*").eq("id", id).single();
    if (fetchError) throw fetchError;
    if (business.subscription_status === "pending_payment") {
      return NextResponse.json(
        { error: "not_activated_yet", message: "Bu işletme henüz ilk kez aktive edilmedi — önce 'Ödeme Alındı' ile aktive et." },
        { status: 409 }
      );
    }

    const coversUntil = nextDueDateAfterPayment(business.next_payment_due_date);
    // is_active sadece odeme gecikmesinden dolayi (cron ile) suspended olduysa
    // burada geri acilir - eger admin baska bir sebeple elle kapatmissa
    // (business.subscription_status zaten 'active' kalmis olurdu bu durumda)
    // bu odeme onayi o manuel kapatmayi ezmemeli.
    const wasAutoSuspended = business.subscription_status === "suspended";

    const { data: updated, error: updateError } = await admin
      .from("businesses")
      .update({
        subscription_status: "active",
        ...(wasAutoSuspended ? { is_active: true } : {}),
        next_payment_due_date: coversUntil,
      })
      .eq("id", id)
      .select()
      .single();
    if (updateError) throw updateError;

    const { error: paymentError } = await admin.from("payments").insert({
      business_id: id,
      amount_tl: business.monthly_price_tl ?? 0,
      method,
      covers_until: coversUntil,
      confirmed_by_email: email,
    });
    if (paymentError) throw paymentError;

    return NextResponse.json({ data: updated });
  });
}
