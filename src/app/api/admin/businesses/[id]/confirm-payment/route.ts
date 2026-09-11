import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { handleRoute } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { findAvailableTurkishNumber, purchasePhoneNumber } from "@/lib/twilio/provision";
import { addOneMonth, todayDateKey } from "@/lib/billing";
import { confirmPaymentSchema } from "@/lib/validation";

class NoNumberAvailableError extends Error {}

/**
 * Ödeme (banka havalesi/nakit) elle onaylandığında tetiklenir — HER pakette
 * bir WhatsApp numarası, sesli paket seçildiyse AYRICA bir sesli numara
 * Twilio'dan otomatik satın alınır (whatsapp_and_voice = 2 numara toplam).
 * Sesli numara existing_forwarded modunda GİZLİ kalır (sadece yönlendirme
 * hedefi), twilio_new modunda doğrudan müşteriye verilir — bkz.
 * voice_number_mode. WhatsApp numarası SADECE satın alınır; o numarayı
 * Meta Business Manager'da gerçekten WhatsApp için kaydetmek (OTP
 * doğrulama, işletme doğrulaması) ayrı, hâlâ manuel bir adımdır —
 * whatsapp_phone_number_id o tamamlanınca ayrıca set edilir.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { email } = await requirePlatformAdmin();
    const { id } = await params;
    const { method } = confirmPaymentSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();

    const { data: business, error: fetchError } = await admin.from("businesses").select("*").eq("id", id).single();
    if (fetchError) throw fetchError;
    if (business.subscription_status === "active") {
      return NextResponse.json({ error: "already_active" }, { status: 409 });
    }
    // Sesli numara icin VOICE_BRIDGE_URL sart (bkz. purchasePhoneNumber) - bunu
    // herhangi bir satin almadan ONCE kontrol ediyoruz, aksi halde WhatsApp
    // numarasi basariyla (ve parayla) satin alinip sesli numara burada patlar,
    // WhatsApp numarasi hicbir yere kaydedilmemis halde bosa gitmis olurdu.
    if (business.package === "whatsapp_and_voice" && !process.env.VOICE_BRIDGE_URL) {
      return NextResponse.json(
        {
          error: "voice_bridge_not_deployed",
          message:
            "VOICE_BRIDGE_URL tanımlı değil — voice-bridge henüz gerçek bir adrese deploy edilmeden sesli paket için numara satın alınamaz (WhatsApp numarası bile alınmadan burada durduruldu, boşa para gitmesin diye).",
        },
        { status: 422 }
      );
    }

    // Ayni "musaitlik ara -> satin al" adimini WhatsApp ve (varsa) sesli numara
    // icin sirayla calistirir - once satin alinan numara, ikinci aramada bir
    // daha "musait" gorunmez, boylece iki farkli numara garanti edilir.
    async function purchaseOne(purpose: "voice" | "whatsapp"): Promise<{ phoneNumber: string; sid: string }> {
      const available = await findAvailableTurkishNumber();
      if (!available) {
        throw new NoNumberAvailableError();
      }
      return purchasePhoneNumber(available, purpose);
    }

    let whatsappNumber: string | null = null;
    let whatsappNumberSid: string | null = null;
    let twilioNumber: string | null = null;
    let twilioNumberSid: string | null = null;

    try {
      const wa = await purchaseOne("whatsapp");
      whatsappNumber = wa.phoneNumber;
      whatsappNumberSid = wa.sid;

      if (business.package === "whatsapp_and_voice") {
        const voice = await purchaseOne("voice");
        twilioNumber = voice.phoneNumber;
        twilioNumberSid = voice.sid;
      }
    } catch (err) {
      if (err instanceof NoNumberAvailableError) {
        return NextResponse.json(
          {
            error: "no_turkish_number_available",
            message:
              "Twilio'da satın alınabilir bir Türkiye numarası bulunamadı — hesapta 'Regulatory Bundle' (kimlik doğrulama) onayı eksik olabilir, Twilio Console'dan kontrol et.",
          },
          { status: 422 }
        );
      }
      return NextResponse.json(
        { error: "twilio_purchase_failed", message: err instanceof Error ? err.message : String(err) },
        { status: 502 }
      );
    }

    const coversUntil = addOneMonth(todayDateKey());

    const { data: updated, error: updateError } = await admin
      .from("businesses")
      .update({
        subscription_status: "active",
        is_active: true, // panele/bota erisim burada aciliyor
        whatsapp_twilio_number: whatsappNumber,
        whatsapp_twilio_number_sid: whatsappNumberSid,
        twilio_number: twilioNumber,
        twilio_number_sid: twilioNumberSid,
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
