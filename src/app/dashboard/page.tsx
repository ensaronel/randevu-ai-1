import Link from "next/link";
import { getBusinessOwnerForPage } from "@/lib/auth";
import { dayRangeUtcISO, weekdayKeyTR, dateKeyTR, formatTL } from "@/lib/date";
import { computeFreeCapacityMinutes, formatMinutesAsHours } from "@/lib/capacity";
import BottomNav from "@/components/BottomNav";
import SuggestionsClient from "@/app/dashboard/SuggestionsClient";
import type { Staff } from "@/types/database";

async function loadPendingSuggestions(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  businessId: string
) {
  const { data } = await supabase
    .from("action_objects")
    .select("id, type, suggestion, reasoning")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .in("type", ["fill_gap", "retention_risk", "rhythm_invite"])
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function loadTodaysFinanceNote(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  businessId: string
) {
  const { startUtc, endUtc } = dayRangeUtcISO(0);
  const { data } = await supabase
    .from("action_objects")
    .select("suggestion")
    .eq("business_id", businessId)
    .eq("type", "finance_note")
    .gte("created_at", startUtc)
    .lt("created_at", endUtc)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.suggestion ?? null;
}

type ApptServiceRow = {
  planned_price: number;
  staff_id: string;
  service: { duration_minutes: number } | { duration_minutes: number }[] | null;
};

type ApptRow = {
  status: string;
  appointment_services: ApptServiceRow[];
};

function serviceDuration(service: ApptServiceRow["service"]): number {
  if (!service) return 0;
  return Array.isArray(service) ? service[0]?.duration_minutes ?? 0 : service.duration_minutes;
}

async function loadDayTotals(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  businessId: string,
  offsetDays: number
) {
  const { startUtc, endUtc } = dayRangeUtcISO(offsetDays);

  const { data } = await supabase
    .from("appointments")
    .select("status, appointment_services(planned_price, staff_id, service:services(duration_minutes))")
    .eq("business_id", businessId)
    .gte("starts_at", startUtc)
    .lt("starts_at", endUtc);

  const appointments = (data ?? []) as unknown as ApptRow[];
  const active = appointments.filter((a) => a.status !== "cancelled");
  const cancelled = appointments.filter((a) => a.status === "cancelled");

  const revenue = active.reduce(
    (sum, a) => sum + a.appointment_services.reduce((s, svc) => s + Number(svc.planned_price), 0),
    0
  );

  const bookedMinutesByStaffId: Record<string, number> = {};
  for (const appt of active) {
    for (const svc of appt.appointment_services) {
      bookedMinutesByStaffId[svc.staff_id] =
        (bookedMinutesByStaffId[svc.staff_id] ?? 0) + serviceDuration(svc.service);
    }
  }

  return {
    appointmentCount: active.length,
    cancelledCount: cancelled.length,
    revenue,
    bookedMinutesByStaffId,
  };
}

export default async function DashboardPage() {
  const { owner, business, supabase } = await getBusinessOwnerForPage();

  const [today, yesterday, lastWeekSameDay, financeNote, suggestions] = await Promise.all([
    loadDayTotals(supabase, business.id, 0),
    loadDayTotals(supabase, business.id, -1),
    loadDayTotals(supabase, business.id, -7),
    loadTodaysFinanceNote(supabase, business.id),
    loadPendingSuggestions(supabase, business.id),
  ]);

  const { data: staffData } = await supabase
    .from("staff")
    .select("*")
    .eq("business_id", business.id)
    .eq("status", "active");
  const staffList = (staffData ?? []) as Staff[];

  const isClosedToday = business.closed_dates?.includes(dateKeyTR(0));
  const freeMinutes = isClosedToday
    ? 0
    : computeFreeCapacityMinutes(staffList, weekdayKeyTR(0), dateKeyTR(0), today.bookedMinutesByStaffId);

  const percentDiff =
    lastWeekSameDay.revenue > 0
      ? Math.round(((yesterday.revenue - lastWeekSameDay.revenue) / lastWeekSameDay.revenue) * 100)
      : null;

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-5 max-w-md mx-auto w-full">
        <div>
          <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">
            {business.name}
          </p>
          <h1 className="text-2xl font-semibold">Merhaba, {owner.full_name.split(" ")[0]}</h1>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <StatCard label="Bugünkü randevu" value={String(today.appointmentCount)} />
          <StatCard label="Tahmini ciro" value={formatTL(today.revenue)} />
          <StatCard label="Boş kapasite" value={formatMinutesAsHours(freeMinutes)} />
          <StatCard label="İptal" value={String(today.cancelledCount)} warn={today.cancelledCount > 0} />
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">
              Dün (tahmini)
            </span>
            {percentDiff !== null && (
              <span
                className={`text-[13px] font-bold ${
                  percentDiff >= 0 ? "text-good-ink" : "text-bad"
                }`}
              >
                {percentDiff >= 0 ? "+" : ""}
                {percentDiff}%
              </span>
            )}
          </div>
          <p className="text-[27px] font-semibold font-display">{formatTL(yesterday.revenue)}</p>
          {percentDiff !== null && (
            <p className="text-[13.5px] text-ink-muted">Geçen haftanın aynı gününe göre.</p>
          )}
        </div>

        {financeNote && (
          <div className="bg-accent-soft border border-accent/30 rounded-2xl p-4 flex flex-col gap-1.5">
            <p className="text-[12.5px] font-bold text-accent uppercase tracking-wide">AI Finans Notu</p>
            <p className="text-[13.5px] text-ink">{financeNote}</p>
          </div>
        )}

        <Link
          href="/asistan"
          className="bg-surface border border-border rounded-2xl p-4 flex items-center justify-between"
        >
          <div>
            <p className="text-sm font-semibold">AI Asistana Sor</p>
            <p className="text-[12.5px] text-ink-muted">&quot;Bu ay ne kadar kazandım?&quot; gibi sorular sor</p>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>

        <SuggestionsClient items={suggestions} />
      </div>

      <BottomNav />
    </div>
  );
}

function StatCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-3.5 flex flex-col gap-2">
      <p className={`text-[21px] font-semibold font-display ${warn ? "text-bad" : ""}`}>{value}</p>
      <p className="text-[12.5px] text-ink-muted">{label}</p>
    </div>
  );
}
