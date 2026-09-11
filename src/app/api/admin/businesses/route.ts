import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { handleRoute } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { adminCreateBusinessSchema } from "@/lib/validation";
import { PACKAGE_PRICES_TL } from "@/lib/billing";

function randomTempPassword(): string {
  // Sadece bir kerelik, admin panelinde gösterilip müşteriye sözlü/mesajla
  // iletilecek geçici şifre — DB'ye düz metin olarak hiç yazılmıyor (Supabase
  // auth kendi hash'ini tutuyor), müşteri ilk girişte /sifre-sifirla ile
  // kendi şifresini belirleyebilir.
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/** Platform admin (Ensar) yüz yüze sattığı yeni işletmeyi "ödeme bekleniyor" durumunda ekler. */
export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    await requirePlatformAdmin();

    const input = adminCreateBusinessSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .insert({
        name: input.business_name,
        package: input.package,
        subscription_status: "pending_payment",
        is_active: false, // ilk odeme onaylanana (confirm-payment) kadar panele/bota erisim kapali
        monthly_price_tl: PACKAGE_PRICES_TL[input.package],
        voice_number_mode: input.package === "whatsapp_and_voice" ? input.voice_number_mode : null,
        business_own_number: input.voice_number_mode === "existing_forwarded" ? input.business_own_number : null,
      })
      .select()
      .single();
    if (businessError) throw businessError;

    const tempPassword = randomTempPassword();
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: input.owner_email,
      password: tempPassword,
      email_confirm: true, // Supabase'in dogrulama e-postasina bagimli olmayalim - musteriye biz haber veriyoruz
    });
    if (authError) {
      // Islem yarim kalmasin - olusturulan business satirini geri al.
      await admin.from("businesses").delete().eq("id", business.id);
      throw authError;
    }

    const { data: owner, error: ownerError } = await admin
      .from("business_owners")
      .insert({
        business_id: business.id,
        auth_user_id: authUser.user.id,
        full_name: input.owner_full_name,
        phone: input.owner_phone ?? null,
      })
      .select()
      .single();
    if (ownerError) {
      await admin.auth.admin.deleteUser(authUser.user.id);
      await admin.from("businesses").delete().eq("id", business.id);
      throw ownerError;
    }

    return NextResponse.json(
      { data: { business, owner, login_email: input.owner_email, temp_password: tempPassword } },
      { status: 201 }
    );
  });
}

export async function GET() {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.from("businesses").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ data });
  });
}
