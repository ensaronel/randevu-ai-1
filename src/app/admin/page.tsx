import { getPlatformAdminForPage } from "@/lib/platformAdmin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import AdminClient from "@/app/admin/AdminClient";

export default async function AdminPage() {
  await getPlatformAdminForPage();

  const admin = createAdminSupabaseClient();
  const { data: businesses } = await admin
    .from("businesses")
    .select(
      "id, name, package, subscription_status, voice_number_mode, business_own_number, twilio_number, whatsapp_twilio_number, whatsapp_phone_number_id, monthly_price_tl, next_payment_due_date, created_at"
    )
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen bg-bg px-4 py-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-ink mb-1">Platform Yönetimi</h1>
      <p className="text-sm text-ink-muted mb-6">
        Yeni müşteri ekle, ödeme onayla — sesli paket seçiliyse numara otomatik bağlanır.
      </p>
      <AdminClient businesses={businesses ?? []} />
    </div>
  );
}
