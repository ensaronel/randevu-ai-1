import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dateKeyFromIso, addDaysToKey } from "@/lib/date";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/** İptal edilmeyen randevuların (final_price varsa o, yoksa planned_price) toplamı + o aralıktaki ürün/ek satışlar — uygulama genelinde tek ciro kuralı. */
export async function computeRevenueForRange(admin: AdminClient, businessId: string, startUtc: string, endUtc: string): Promise<number> {
  const fromKey = dateKeyFromIso(startUtc);
  const toKey = addDaysToKey(dateKeyFromIso(endUtc), -1);

  const [{ data }, { data: salesData }, { data: packagesData }] = await Promise.all([
    admin
      .from("appointments")
      .select("status, appointment_services(planned_price, final_price)")
      .eq("business_id", businessId)
      .gte("starts_at", startUtc)
      .lt("starts_at", endUtc),
    admin
      .from("one_time_sales")
      .select("amount")
      .eq("business_id", businessId)
      .gte("sale_date", fromKey)
      .lte("sale_date", toKey),
    admin
      .from("customer_packages")
      .select("price")
      .eq("business_id", businessId)
      .gte("sale_date", fromKey)
      .lte("sale_date", toKey),
  ]);

  const appointmentRevenue = (data ?? [])
    .filter((row) => row.status !== "cancelled")
    .reduce(
      (sum, row) =>
        sum + row.appointment_services.reduce((s, svc) => s + Number(svc.final_price ?? svc.planned_price), 0),
      0
    );
  const salesRevenue = (salesData ?? []).reduce((sum, s) => sum + Number(s.amount), 0);
  const packagesRevenue = (packagesData ?? []).reduce((sum, p) => sum + Number(p.price), 0);

  return appointmentRevenue + salesRevenue + packagesRevenue;
}
