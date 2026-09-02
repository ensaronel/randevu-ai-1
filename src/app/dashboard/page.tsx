import Link from "next/link";
import { getBusinessOwnerForPage } from "@/lib/auth";
import { dayRangeUtcISO, weekdayKeyTR, dateKeyTR, formatTL, formatTimeTR } from "@/lib/date";
import { computeFreeCapacityMinutes, formatMinutesAsHours } from "@/lib/capacity";
import AppShell from "@/components/AppShell";
import SuggestionsClient from "@/app/dashboard/SuggestionsClient";
import type { Staff } from "@/types/database";

type OneOrMany<T> = T | T[] | null;
function one<T>(value: OneOrMany<T>): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

type UpcomingApptRow = {
  id: string;
  starts_at: string;
  customer: OneOrMany<{ full_name: string }>;
  appointment_services: {
    service: OneOrMany<{ name: string }>;
    staff: OneOrMany<{ full_name: string }>;
  }[];
};

async function loadUpcomingToday(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  businessId: string
) {
  const { endUtc } = dayRangeUtcISO(0);
  const { data } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, customer:customers(full_name), appointment_services(service:services(name), staff:staff(full_name))"
    )
    .eq("business_id", businessId)
    .neq("status", "cancelled")
    .gte("starts_at", new Date().toISOString())
    .lt("starts_at", endUtc)
    .order("starts_at")
    .limit(6);
  return (data ?? []) as unknown as UpcomingApptRow[];
}

async function loadTodayReconciled(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  businessId: string
) {
  const { data } = await supabase
    .from("daily_financial_summaries")
    .select("reconciled_at")
    .eq("business_id", businessId)
    .eq("summary_date", dateKeyTR(0))
    .maybeSingle();
  return !!data?.reconciled_at;
}

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

  const [today, yesterday, lastWeekSameDay, financeNote, suggestions, upcomingToday, todayReconciled] = await Promise.all([
    loadDayTotals(supabase, business.id, 0),
    loadDayTotals(supabase, business.id, -1),
    loadDayTotals(supabase, business.id, -7),
    loadTodaysFinanceNote(supabase, business.id),
    loadPendingSuggestions(supabase, business.id),
    loadUpcomingToday(supabase, business.id),
    loadTodayReconciled(supabase, business.id),
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

  const totalCapacityMinutes = isClosedToday
    ? 0
    : staffList.reduce((sum, staff) => {
        if (staff.leave_dates?.includes(dateKeyTR(0))) return sum;
        const hours = staff.working_hours?.[weekdayKeyTR(0)];
        if (!hours) return sum;
        const [start, end] = hours;
        const parse = (v: string) => {
          const [h, m] = v.split(":").map(Number);
          return h * 60 + (m || 0);
        };
        return sum + Math.max(0, parse(end) - parse(start));
      }, 0);
  const occupancyPercent =
    totalCapacityMinutes > 0
      ? Math.round(((totalCapacityMinutes - freeMinutes) / totalCapacityMinutes) * 100)
      : 0;

  const staffOnDutyToday = staffList.map((s) => ({
    name: s.full_name,
    onLeave: s.leave_dates?.includes(dateKeyTR(0)) ?? false,
    working: !isClosedToday && !!s.working_hours?.[weekdayKeyTR(0)],
  }));

  const showReconcileReminder = !isClosedToday && today.appointmentCount > 0 && !todayReconciled;

  return (
    <AppShell businessName={business.name}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">
            {business.name}
          </p>
          <h1 className="text-2xl lg:text-[26px] font-semibold font-display">
            Merhaba, {owner.full_name.split(" ")[0]}
          </h1>
        </div>
        <Link
          href="/randevu-olustur"
          className="hidden lg:flex items-center gap-2 bg-accent text-white rounded-full px-5 py-2.5 text-sm font-semibold shrink-0"
        >
          + Yeni Randevu
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-5 items-start">
        <UpcomingTodayCard appointments={upcomingToday} />
        <div className="flex flex-col gap-3 lg:gap-5">
          {showReconcileReminder && (
            <Link
              href="/gun-sonu"
              className="bg-accent2-soft border border-accent2/30 rounded-2xl p-4 flex items-center justify-between gap-3"
            >
              <div>
                <p className="text-[12.5px] font-bold text-accent2-ink uppercase tracking-wide">Gün Sonu</p>
                <p className="text-[13.5px] text-ink">Bugünü henüz kapatmadınız — ciro eksik görünebilir.</p>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent2-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          )}
          <StaffOnDutyCard staff={staffOnDutyToday} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_1fr] gap-3 lg:gap-5">
        <OccupancyCard percent={occupancyPercent} freeMinutes={freeMinutes} />

        <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5 lg:gap-5">
          <StatCard label="Bugünkü randevu" value={String(today.appointmentCount)} />
          <StatCard label="İptal" value={String(today.cancelledCount)} warn={today.cancelledCount > 0} />
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4 lg:p-5 flex flex-col gap-1.5 lg:justify-center">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-3 lg:gap-5 items-start">
        {financeNote && (
          <div className="bg-accent-soft border border-accent/30 rounded-2xl p-4 lg:p-5 flex flex-col gap-1.5">
            <p className="text-[12.5px] font-bold text-accent uppercase tracking-wide">AI Finans Notu</p>
            <p className="text-[13.5px] text-ink leading-relaxed">{financeNote}</p>
          </div>
        )}

        <div className="flex flex-col gap-2.5 lg:gap-3.5">
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
      </div>
    </AppShell>
  );
}

function OccupancyCard({ percent, freeMinutes }: { percent: number; freeMinutes: number }) {
  const radius = 63;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - percent / 100);

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 lg:p-6 flex flex-col items-center gap-3 pt-5 lg:pt-6">
      <div className="relative w-[140px] h-[140px] lg:w-[160px] lg:h-[160px]">
        <svg width="100%" height="100%" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--accent-soft)" strokeWidth="14" />
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            transform="rotate(-90 70 70)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-[32px] lg:text-[34px] font-bold leading-none">%{percent}</span>
          <span className="text-ink-muted text-[11.5px] font-bold uppercase tracking-wide mt-1">Doluluk</span>
        </div>
      </div>
      <span className="text-ink-muted text-[13px] text-center">
        Bugün için {formatMinutesAsHours(freeMinutes)} boş kapasite kaldı
      </span>
    </div>
  );
}

function UpcomingTodayCard({ appointments }: { appointments: UpcomingApptRow[] }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 lg:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Bugünün Programı</p>
        <Link href="/takvim" className="text-[12.5px] font-semibold text-accent">
          Tümünü Gör
        </Link>
      </div>
      {appointments.length === 0 ? (
        <p className="text-[13px] text-ink-muted py-2">Bugün için kalan randevu yok.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {appointments.map((a) => {
            const customer = one(a.customer);
            const serviceNames = a.appointment_services
              .map((s) => one(s.service)?.name)
              .filter((n): n is string => !!n)
              .join(", ");
            const staffNames = Array.from(
              new Set(a.appointment_services.map((s) => one(s.staff)?.full_name).filter((n): n is string => !!n))
            ).join(", ");
            return (
              <div key={a.id} className="flex items-center gap-3">
                <span className="text-[13px] font-bold font-display shrink-0 w-12">{formatTimeTR(a.starts_at)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold truncate">{customer?.full_name ?? "Müşteri"}</p>
                  <p className="text-[12px] text-ink-muted truncate">
                    {serviceNames}
                    {staffNames ? ` · ${staffNames}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StaffOnDutyCard({ staff }: { staff: { name: string; onLeave: boolean; working: boolean }[] }) {
  if (staff.length === 0) return null;
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2.5 flex-1">
      <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Bugün Kim Çalışıyor</p>
      <div className="flex flex-col gap-1.5">
        {staff.map((s) => (
          <div key={s.name} className="flex items-center justify-between text-[13.5px]">
            <span>{s.name}</span>
            <span className={`text-[12px] font-semibold ${s.working ? "text-good-ink" : "text-ink-muted"}`}>
              {s.onLeave ? "İzinli" : s.working ? "Çalışıyor" : "Bugün kapalı"}
            </span>
          </div>
        ))}
      </div>
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
    <div className="bg-surface border border-border rounded-2xl p-3.5 lg:p-5 flex flex-col gap-2 lg:flex-1 lg:justify-center">
      <p className={`text-[21px] lg:text-[26px] font-semibold font-display ${warn ? "text-bad" : ""}`}>{value}</p>
      <p className="text-[12.5px] text-ink-muted">{label}</p>
    </div>
  );
}
