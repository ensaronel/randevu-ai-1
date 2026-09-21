import { getBusinessOwnerForPage } from "@/lib/auth";
import { formatDateTR } from "@/lib/date";
import { loadStaffMonthlyMetrics } from "@/lib/staffMetrics";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import KasaClient from "@/app/kasa/KasaClient";
import type { Business, FixedExpense, Staff } from "@/types/database";

async function loadMonthlyCommissions(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  business: Business,
  staffList: Staff[]
) {
  const metrics = await loadStaffMonthlyMetrics(supabase, business, staffList);

  return metrics
    .map((m) => ({ name: staffList.find((s) => s.id === m.staffId)?.full_name ?? "?", amount: m.commission }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export default async function KasaPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data: staffData } = await supabase.from("staff").select("*").eq("business_id", business.id).eq("status", "active");
  const staffList = (staffData ?? []) as Staff[];

  const [{ data: fixedExpenseData }, commissions] = await Promise.all([
    supabase
      .from("fixed_expenses")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: true }),
    loadMonthlyCommissions(supabase, business, staffList),
  ]);

  const fixedExpenses = (fixedExpenseData ?? []) as FixedExpense[];

  return (
    <AppShell businessName={business.name}>
        <PageHeader eyebrow="Kasa" title={formatDateTR(new Date().toISOString())} titleClassName="capitalize" />

        <KasaClient
          initialFixedExpenses={fixedExpenses}
          staffList={staffList.map((s) => ({ id: s.id, full_name: s.full_name }))}
          commissions={commissions}
        />
    </AppShell>
  );
}
