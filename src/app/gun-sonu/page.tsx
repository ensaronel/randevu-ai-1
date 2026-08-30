import { getBusinessOwnerForPage } from "@/lib/auth";
import { dayRangeUtcISO, dateKeyTR, formatDateTR, formatTL } from "@/lib/date";
import { loadStaffMonthlyMetrics } from "@/lib/staffMetrics";
import AppShell from "@/components/AppShell";
import GunSonuClient, { type GunSonuAppointment } from "@/app/gun-sonu/GunSonuClient";
import type { Business, Staff } from "@/types/database";

async function loadMonthlyCommissions(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  business: Business
) {
  const { data: staffData } = await supabase.from("staff").select("*").eq("business_id", business.id).eq("status", "active");
  const staffList = (staffData ?? []) as Staff[];
  const metrics = await loadStaffMonthlyMetrics(supabase, business, staffList);

  return metrics
    .map((m) => ({ name: staffList.find((s) => s.id === m.staffId)?.full_name ?? "?", amount: m.commission }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export default async function GunSonuPage() {
  const { business, supabase } = await getBusinessOwnerForPage();
  const { startUtc, endUtc } = dayRangeUtcISO(0);
  const todayKey = dateKeyTR(0);

  const [{ data: apptData }, { data: summary }, commissions] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, starts_at, status, attendance, customer:customers(full_name, phone), appointment_services(id, planned_price, final_price, adjustment_note, service:services(name), staff:staff(full_name))"
      )
      .eq("business_id", business.id)
      .gte("starts_at", startUtc)
      .lt("starts_at", endUtc)
      .neq("status", "cancelled")
      .order("starts_at"),
    supabase
      .from("daily_financial_summaries")
      .select("*")
      .eq("business_id", business.id)
      .eq("summary_date", todayKey)
      .maybeSingle(),
    loadMonthlyCommissions(supabase, business),
  ]);

  const appointments = (apptData ?? []) as unknown as GunSonuAppointment[];

  return (
    <AppShell businessName={business.name}>
        <div>
          <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">Gün Sonu Mutabakat</p>
          <h1 className="text-xl font-semibold capitalize">{formatDateTR(new Date().toISOString())}</h1>
        </div>

        <GunSonuClient
          appointments={appointments}
          todayKey={todayKey}
          initialReconciledAt={summary?.reconciled_at ?? null}
          initialActualRevenue={summary?.actual_revenue ?? null}
        />

        {commissions.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2.5 mt-2">
            <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Bu Ayki Personel Primleri</p>
            {commissions.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span>{c.name}</span>
                <span className="font-semibold font-display">{formatTL(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
    </AppShell>
  );
}
