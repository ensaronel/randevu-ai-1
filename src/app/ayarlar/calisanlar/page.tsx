import { getBusinessOwnerForPage } from "@/lib/auth";
import { loadStaffMonthlyMetrics } from "@/lib/staffMetrics";
import AppShell from "@/components/AppShell";
import CalisanlarClient, { type StaffItem } from "@/app/ayarlar/calisanlar/CalisanlarClient";
import type { Staff } from "@/types/database";

export default async function CalisanlarPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data: staffData } = await supabase
    .from("staff")
    .select("*")
    .eq("business_id", business.id)
    .order("full_name", { ascending: true });
  const staffList = (staffData ?? []) as Staff[];

  const metrics = await loadStaffMonthlyMetrics(supabase, business, staffList.filter((s) => s.status === "active"));
  const metricsByStaffId = new Map(metrics.map((m) => [m.staffId, m]));

  const items: StaffItem[] = staffList.map((s) => {
    const m = metricsByStaffId.get(s.id);
    return {
      id: s.id,
      full_name: s.full_name,
      status: s.status,
      commission_rate: Number(s.commission_rate),
      leave_dates: s.leave_dates ?? [],
      working_hours: s.working_hours ?? {},
      revenue: m?.revenue ?? 0,
      commission: m?.commission ?? 0,
      occupancyPercent: m?.occupancyPercent ?? 0,
      noShowRatePercent: m?.noShowRatePercent ?? 0,
    };
  });

  return (
    <AppShell businessName={business.name}>
        <h1 className="text-2xl font-semibold">Çalışanlar</h1>
        <CalisanlarClient staff={items} />
    </AppShell>
  );
}
