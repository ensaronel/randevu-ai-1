import { getBusinessOwnerForPage } from "@/lib/auth";
import { loadStaffMonthlyMetrics } from "@/lib/staffMetrics";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import CalisanlarClient, { type StaffItem } from "@/app/ayarlar/calisanlar/CalisanlarClient";
import type { Staff } from "@/types/database";

export default async function CalisanlarPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const [{ data: staffData }, { data: servicesData }] = await Promise.all([
    supabase
      .from("staff")
      .select("*, staff_service_expertise(service_id)")
      .eq("business_id", business.id)
      .order("full_name", { ascending: true }),
    supabase
      .from("services")
      .select("id, name")
      .eq("business_id", business.id)
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);
  const staffList = (staffData ?? []) as unknown as (Staff & { staff_service_expertise: { service_id: string }[] })[];

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
      serviceIds: s.staff_service_expertise.map((e) => e.service_id),
      revenue: m?.revenue ?? 0,
      commission: m?.commission ?? 0,
      occupancyPercent: m?.occupancyPercent ?? 0,
      cancellationRatePercent: m?.cancellationRatePercent ?? 0,
    };
  });

  return (
    <AppShell businessName={business.name}>
        <PageHeader eyebrow={business.name} title="Çalışanlar" />
        <CalisanlarClient staff={items} serviceList={servicesData ?? []} />
    </AppShell>
  );
}
