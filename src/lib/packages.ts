import type { getBusinessOwnerForPage } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { CustomerPackage } from "@/types/database";

type OwnerSupabaseClient = Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"];
type AdminSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;
type AnySupabaseClient = OwnerSupabaseClient | AdminSupabaseClient;

export interface PackageWithRemaining extends CustomerPackage {
  usedSessions: number;
  remainingSessions: number;
}

/**
 * "Kalan seans" hiçbir yerde sayaç olarak TUTULMUYOR — appointment_services.customer_package_id
 * ile bu pakete bağlı, iptal olmayan randevu sayısı total_sessions'tan düşülerek HER SEFERİNDE
 * hesaplanır (bkz. schema.sql'deki customer_packages yorumu: Kasa'daki ciro/prim gibi tek
 * gerçek kaynak, senkron bozulma riski yok). İptal edilen randevu seansı geri verir, no-show
 * vermez (randevu saati zaten personelin takviminden düşmüştü).
 */
export async function attachRemainingSessions(
  supabase: AnySupabaseClient,
  packages: CustomerPackage[]
): Promise<PackageWithRemaining[]> {
  if (packages.length === 0) return [];

  const { data: usageRows } = await supabase
    .from("appointment_services")
    .select("customer_package_id, appointment_id")
    .in(
      "customer_package_id",
      packages.map((p) => p.id)
    );

  const rows = (usageRows ?? []) as { customer_package_id: string; appointment_id: string }[];
  const appointmentIds = [...new Set(rows.map((r) => r.appointment_id))];

  let nonCancelledIds = new Set<string>();
  if (appointmentIds.length > 0) {
    const { data: appts } = await supabase
      .from("appointments")
      .select("id, status")
      .in("id", appointmentIds)
      .neq("status", "cancelled");
    nonCancelledIds = new Set((appts ?? []).map((a) => a.id as string));
  }

  const usedByPackage = new Map<string, number>();
  for (const row of rows) {
    if (!nonCancelledIds.has(row.appointment_id)) continue;
    usedByPackage.set(row.customer_package_id, (usedByPackage.get(row.customer_package_id) ?? 0) + 1);
  }

  return packages.map((p) => {
    const usedSessions = usedByPackage.get(p.id) ?? 0;
    return { ...p, usedSessions, remainingSessions: Math.max(0, p.total_sessions - usedSessions) };
  });
}

/**
 * Bir pakete bağlı, iptal olmayan en son (en yeni tarihli) randevunun starts_at'ini döner —
 * interval_days kısıtlamasının "son seanstan bu yana kaç gün geçti" hesabı için. Randevu hiç
 * yoksa null (ilk seansta kısıtlama uygulanmaz).
 */
export async function getLastSessionDate(supabase: AnySupabaseClient, packageId: string): Promise<string | null> {
  const { data: usageRows } = await supabase
    .from("appointment_services")
    .select("appointment_id")
    .eq("customer_package_id", packageId);

  const appointmentIds = [...new Set((usageRows ?? []).map((r) => r.appointment_id as string))];
  if (appointmentIds.length === 0) return null;

  const { data: appts } = await supabase
    .from("appointments")
    .select("starts_at, status")
    .in("id", appointmentIds)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: false })
    .limit(1);

  return (appts ?? [])[0]?.starts_at ?? null;
}

/**
 * WhatsApp AI'nin create_appointment'ta otomatik uygulaması için: bir müşterinin belirli bir
 * hizmet için kalan seansı olan (en eski satılan) aktif paketini bulur — varsa o seans otomatik
 * kullanılır, müşteriden ayrıca ücret istenmez.
 */
export async function findActivePackageForService(
  admin: AdminSupabaseClient,
  businessId: string,
  customerId: string,
  serviceId: string
): Promise<PackageWithRemaining | null> {
  const { data } = await admin
    .from("customer_packages")
    .select("*")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("service_id", serviceId)
    .order("sale_date", { ascending: true });

  const packages = (data ?? []) as CustomerPackage[];
  if (packages.length === 0) return null;

  const withRemaining = await attachRemainingSessions(admin, packages);
  return withRemaining.find((p) => p.remainingSessions > 0) ?? null;
}
