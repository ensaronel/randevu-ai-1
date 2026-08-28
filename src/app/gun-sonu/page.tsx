import { getBusinessOwnerForPage } from "@/lib/auth";
import { dayRangeUtcISO, monthRangeUtcISO, dateKeyTR, formatDateTR, formatTL } from "@/lib/date";
import BottomNav from "@/components/BottomNav";
import GunSonuClient, { type GunSonuAppointment } from "@/app/gun-sonu/GunSonuClient";

type CommissionRow = {
  attendance: string | null;
  appointment_services: {
    planned_price: number;
    final_price: number | null;
    staff_id: string;
    staff: { full_name: string; commission_rate: number } | { full_name: string; commission_rate: number }[] | null;
  }[];
};

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function loadMonthlyCommissions(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  businessId: string
) {
  const { startUtc, endUtc } = monthRangeUtcISO();
  const { data } = await supabase
    .from("appointments")
    .select("attendance, appointment_services(planned_price, final_price, staff_id, staff:staff(full_name, commission_rate))")
    .eq("business_id", businessId)
    .eq("attendance", "came")
    .gte("starts_at", startUtc)
    .lt("starts_at", endUtc);

  const rows = (data ?? []) as unknown as CommissionRow[];
  const totals = new Map<string, { name: string; amount: number }>();

  for (const row of rows) {
    for (const svc of row.appointment_services) {
      const staff = one(svc.staff);
      if (!staff) continue;
      const price = Number(svc.final_price ?? svc.planned_price);
      const commission = price * (Number(staff.commission_rate) / 100);
      const existing = totals.get(svc.staff_id);
      totals.set(svc.staff_id, { name: staff.full_name, amount: (existing?.amount ?? 0) + commission });
    }
  }

  return Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
}

export default async function GunSonuPage() {
  const { business, supabase } = await getBusinessOwnerForPage();
  const { startUtc, endUtc } = dayRangeUtcISO(0);
  const todayKey = dateKeyTR(0);

  const [{ data: apptData }, { data: summary }, commissions] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, starts_at, status, attendance, customer:customers(full_name), appointment_services(id, planned_price, final_price, adjustment_note, service:services(name), staff:staff(full_name))"
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
    loadMonthlyCommissions(supabase, business.id),
  ]);

  const appointments = (apptData ?? []) as unknown as GunSonuAppointment[];

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-4 max-w-md mx-auto w-full">
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
      </div>

      <BottomNav />
    </div>
  );
}
