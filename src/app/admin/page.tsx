import { getPlatformAdminForPage } from "@/lib/platformAdmin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { monthRangeUtcISO } from "@/lib/date";
import AdminClient from "@/app/admin/AdminClient";
import type { Payment } from "@/types/database";

export default async function AdminPage() {
  await getPlatformAdminForPage();

  const admin = createAdminSupabaseClient();
  const { data: businesses } = await admin
    .from("businesses")
    .select(
      "id, name, package, subscription_status, voice_number_mode, business_own_number, twilio_number, whatsapp_twilio_number, whatsapp_phone_number_id, monthly_price_tl, next_payment_due_date, created_at"
    )
    .order("created_at", { ascending: false });

  const businessIds = (businesses ?? []).map((b) => b.id);

  const [{ data: owners }, { data: payments }] = await Promise.all([
    businessIds.length
      ? admin.from("business_owners").select("business_id, full_name, phone, auth_user_id").in("business_id", businessIds)
      : Promise.resolve({ data: [] as { business_id: string; full_name: string; phone: string | null; auth_user_id: string }[] }),
    businessIds.length
      ? admin.from("payments").select("*").in("business_id", businessIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Payment[] }),
  ]);

  // Sahibinin e-postası business_owners'da değil auth.users'da tutuluyor —
  // her sahip için ayrı bir admin API çağrısı gerekiyor. Platformun bu
  // erken aşamasında işletme sayısı küçük olduğu için bu kabul edilebilir;
  // sayı büyüdükçe admin.auth.admin.listUsers() ile toplu çekmeye geçilebilir.
  const ownersWithEmail = await Promise.all(
    (owners ?? []).map(async (o) => {
      const { data } = await admin.auth.admin.getUserById(o.auth_user_id);
      return { business_id: o.business_id, full_name: o.full_name, phone: o.phone, email: data.user?.email ?? null };
    })
  );

  const ownerByBusinessId = new Map(ownersWithEmail.map((o) => [o.business_id, o]));
  const paymentsByBusinessId = new Map<string, Payment[]>();
  for (const p of payments ?? []) {
    const list = paymentsByBusinessId.get(p.business_id) ?? [];
    list.push(p);
    paymentsByBusinessId.set(p.business_id, list);
  }

  const businessRows = (businesses ?? []).map((b) => ({
    ...b,
    owner: ownerByBusinessId.get(b.id) ?? null,
    payments: paymentsByBusinessId.get(b.id) ?? [],
  }));

  const { startUtc: monthStartUtc } = monthRangeUtcISO();
  const allPayments = payments ?? [];
  const summary = {
    totalRevenueTl: allPayments.reduce((sum, p) => sum + p.amount_tl, 0),
    monthRevenueTl: allPayments.filter((p) => p.created_at >= monthStartUtc).reduce((sum, p) => sum + p.amount_tl, 0),
    activeCount: (businesses ?? []).filter((b) => b.subscription_status === "active").length,
    pendingCount: (businesses ?? []).filter((b) => b.subscription_status === "pending_payment").length,
    suspendedCount: (businesses ?? []).filter((b) => b.subscription_status === "suspended").length,
  };

  return (
    <div className="min-h-screen bg-bg px-4 py-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-ink mb-1">Platform Yönetimi</h1>
      <p className="text-sm text-ink-muted mb-6">
        Yeni müşteri ekle, ödeme onayla — sesli paket seçiliyse numara otomatik bağlanır.
      </p>
      <AdminClient businesses={businessRows} summary={summary} />
    </div>
  );
}
