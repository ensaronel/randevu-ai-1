import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import MusterilerClient, { type CustomerListItem } from "@/app/musteriler/MusterilerClient";
import type { Customer } from "@/types/database";

type ApptRow = {
  customer_id: string;
  starts_at: string;
  appointment_services: { planned_price: number; final_price: number | null }[];
};

export default async function MusterilerPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const [{ data: customersData }, { data: apptData }, { data: pendingActions }] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .eq("business_id", business.id)
      .eq("status", "active")
      .order("full_name", { ascending: true }),
    supabase
      .from("appointments")
      .select("customer_id, starts_at, appointment_services(planned_price, final_price)")
      .eq("business_id", business.id)
      .eq("attendance", "came"),
    supabase
      .from("action_objects")
      .select("related_customer_id")
      .eq("business_id", business.id)
      .eq("status", "pending")
      .in("type", ["retention_risk", "rhythm_invite"]),
  ]);

  const customers = (customersData ?? []) as Customer[];
  const apptRows = (apptData ?? []) as unknown as ApptRow[];
  const aiFlaggedIds = new Set(
    (pendingActions ?? []).map((a) => a.related_customer_id).filter((id): id is string => Boolean(id))
  );

  const statsByCustomer = new Map<string, { totalSpent: number; lastVisitAt: string | null }>();
  for (const row of apptRows) {
    const stat = statsByCustomer.get(row.customer_id) ?? { totalSpent: 0, lastVisitAt: null };
    stat.totalSpent += row.appointment_services.reduce(
      (s, svc) => s + Number(svc.final_price ?? svc.planned_price),
      0
    );
    if (!stat.lastVisitAt || row.starts_at > stat.lastVisitAt) stat.lastVisitAt = row.starts_at;
    statsByCustomer.set(row.customer_id, stat);
  }

  const items: CustomerListItem[] = customers.map((c) => {
    const stat = statsByCustomer.get(c.id);
    return {
      id: c.id,
      full_name: c.full_name,
      phone: c.phone,
      noShowCount: c.no_show_count,
      totalSpent: stat?.totalSpent ?? 0,
      lastVisitAt: stat?.lastVisitAt ?? null,
      hasAiFlag: aiFlaggedIds.has(c.id),
    };
  });

  return (
    <AppShell businessName={business.name}>
        <h1 className="text-2xl font-semibold">Müşteriler</h1>
        <MusterilerClient customers={items} />
    </AppShell>
  );
}
