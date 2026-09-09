import Link from "next/link";
import { getBusinessOwnerForPage } from "@/lib/auth";
import { dayRangeUtcISO, weekdayKeyTR, dateKeyTR, dateKeyFromIso, formatTL, formatTimeTR } from "@/lib/date";
import { computeFreeCapacityMinutes, formatMinutesAsHours } from "@/lib/capacity";
import AppShell from "@/components/AppShell";
import Mascot from "@/components/Mascot";
import BadgeStat from "@/components/BadgeStat";
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

async function loadPendingSuggestions(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  businessId: string
) {
  const { data } = await supabase
    .from("action_objects")
    .select("id, type, suggestion, customer_message, reasoning")
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
  final_price: number | null;
  staff_id: string;
  service: { duration_minutes: number } | { duration_minutes: number }[] | null;
};

type ApptRow = {
  starts_at: string;
  status: string;
  appointment_services: ApptServiceRow[];
};

interface DayTotals {
  appointmentCount: number;
  cancelledCount: number;
  revenue: number;
  bookedMinutesByStaffId: Record<string, number>;
}

function serviceDuration(service: ApptServiceRow["service"]): number {
  if (!service) return 0;
  return Array.isArray(service) ? service[0]?.duration_minutes ?? 0 : service.duration_minutes;
}

function emptyDayTotals(): DayTotals {
  return { appointmentCount: 0, cancelledCount: 0, revenue: 0, bookedMinutesByStaffId: {} };
}

/**
 * Bir haftalik araligin tum randevularini TEK sorguda cekip Turkiye yerel gune
 * gore grupluyor - onceden her gun (bugun + haftanin 7 gunu) icin ayri ayri
 * sorgu atiliyordu (8 ayri ag-round-trip'i, biri bugun icin iki kez), bu da
 * sayfa yuklemesini gozle gorulur yavaslatiyordu.
 */
async function loadWeekTotalsByDate(
  supabase: Awaited<ReturnType<typeof getBusinessOwnerForPage>>["supabase"],
  businessId: string,
  weekStartOffset: number
): Promise<Map<string, DayTotals>> {
  const { startUtc } = dayRangeUtcISO(weekStartOffset);
  const { endUtc } = dayRangeUtcISO(weekStartOffset + 6);

  const { data } = await supabase
    .from("appointments")
    .select(
      "starts_at, status, appointment_services(planned_price, final_price, staff_id, service:services(duration_minutes))"
    )
    .eq("business_id", businessId)
    .gte("starts_at", startUtc)
    .lt("starts_at", endUtc);

  const byDate = new Map<string, DayTotals>();
  for (const appt of (data ?? []) as unknown as ApptRow[]) {
    const key = dateKeyFromIso(appt.starts_at);
    const totals = byDate.get(key) ?? emptyDayTotals();

    if (appt.status === "cancelled") {
      totals.cancelledCount++;
    } else {
      totals.appointmentCount++;
      for (const svc of appt.appointment_services) {
        totals.revenue += Number(svc.final_price ?? svc.planned_price);
        totals.bookedMinutesByStaffId[svc.staff_id] =
          (totals.bookedMinutesByStaffId[svc.staff_id] ?? 0) + serviceDuration(svc.service);
      }
    }

    byDate.set(key, totals);
  }
  return byDate;
}

export default async function DashboardPage() {
  const { owner, business, supabase } = await getBusinessOwnerForPage();

  const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const WEEKDAY_SHORT_TR: Record<string, string> = {
    sun: "Paz", mon: "Pzt", tue: "Sal", wed: "Çar", thu: "Per", fri: "Cum", sat: "Cts",
  };
  // Hafta her zaman Pazartesi'den baslar (Turkce takvim konvansiyonu) - "son 7
  // gun" kayan penceresi yerine, bugun neresi olursa olsun soldan Pzt baslar.
  const todayWeekdayIndex = WEEKDAY_ORDER.indexOf(weekdayKeyTR(0));
  const mondayOffset = -((todayWeekdayIndex + 6) % 7);
  const weekOffsets = Array.from({ length: 7 }, (_, i) => mondayOffset + i);

  const [weekTotalsByDate, financeNote, suggestions, upcomingToday] = await Promise.all([
    loadWeekTotalsByDate(supabase, business.id, mondayOffset),
    loadTodaysFinanceNote(supabase, business.id),
    loadPendingSuggestions(supabase, business.id),
    loadUpcomingToday(supabase, business.id),
  ]);

  const today = weekTotalsByDate.get(dateKeyTR(0)) ?? emptyDayTotals();
  const weekChart = weekOffsets.map((offset) => ({
    label: WEEKDAY_SHORT_TR[weekdayKeyTR(offset)],
    revenue: weekTotalsByDate.get(dateKeyTR(offset))?.revenue ?? 0,
    isToday: offset === 0,
  }));

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

  return (
    <AppShell businessName={business.name}>
      <div className="flex items-center gap-3">
        <Mascot size={52} waving />
        <div>
          <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">
            {business.name}
          </p>
          <h1 className="text-2xl lg:text-[26px] font-semibold font-display">
            Merhaba, {owner.full_name.split(" ")[0]}
          </h1>
        </div>
      </div>

      {/* HERO: koyu kart + dalga illüstrasyonu — maskot sahnesiyle aynı imza
          motif, buyuk halka gercek bir "an" hissi versin diye ortalanmis. */}
      <div className="bg-accent text-white rounded-[28px] p-5 lg:p-7 flex flex-col gap-4 relative overflow-hidden">
        <svg viewBox="0 0 400 90" className="absolute bottom-0 left-0 w-full h-[64px] pointer-events-none" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 40 Q 100 0 200 30 T 400 20 V90 H0 Z" fill="white" opacity="0.045" />
          <path d="M0 60 Q 120 25 220 55 T 400 45 V90 H0 Z" fill="white" opacity="0.06" />
        </svg>

        <div className="flex items-center gap-5 relative">
          <div className="relative w-[86px] h-[86px] shrink-0">
            <svg width="100%" height="100%" viewBox="0 0 86 86">
              <circle cx="43" cy="43" r="36" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="8" />
              <circle
                cx="43"
                cy="43"
                r="36"
                fill="none"
                stroke="white"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 36}
                strokeDashoffset={2 * Math.PI * 36 * (1 - occupancyPercent / 100)}
                transform="rotate(-90 43 43)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[20px] font-bold font-display leading-none">%{occupancyPercent}</span>
            </div>
          </div>
          <div>
            <p className="text-[12px] font-bold text-white/60 uppercase tracking-wide">Bugünün Doluluğu</p>
            <p className="text-[15px] font-semibold mt-0.5">
              {formatMinutesAsHours(freeMinutes)} boş kapasite kaldı
            </p>
          </div>
        </div>

        {upcomingToday.length > 0 && (
          <div className="flex flex-col gap-2.5 relative">
            {upcomingToday.map((a) => {
              const customer = one(a.customer);
              const serviceNames = a.appointment_services
                .map((s) => one(s.service)?.name)
                .filter((n): n is string => !!n)
                .join(", ");
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <span className="text-[13px] font-bold font-display shrink-0 w-11">
                    {formatTimeTR(a.starts_at)}
                  </span>
                  <div className="min-w-0 flex-1 border-t border-white/15 pt-2.5">
                    <p className="text-[13.5px] font-semibold truncate">{customer?.full_name ?? "Müşteri"}</p>
                    <p className="text-[12px] text-white/65 truncate">{serviceNames}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Link href="/takvim" className="self-start text-[12.5px] font-bold text-white/85 flex items-center gap-1 relative">
          Takvimi Gör
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      </div>

      {/* İkon-rozetli istatistik kartları — referans 1'deki "ikon dairesi +
          buyuk sayi" oruntusu. */}
      <div className="grid grid-cols-2 gap-3">
        <BadgeStat icon="calendar" label="Bugünkü Randevu" value={String(today.appointmentCount)} tone="accentSoft" />
        <BadgeStat icon="x" label="İptal" value={String(today.cancelledCount)} tone={today.cancelledCount > 0 ? "warn" : "block2"} />
      </div>

      <WeekRevenueChart data={weekChart} />

      {/* Danışman sahnesi — referans 3'teki buyuk illustrasyonlu "start your
          day" karti gibi gercek bir sahne: buyuk maskot, zemin/gokyuzu
          illustrasyonu, hap CTA butonu — kucuk bir satir linki degil. */}
      <Link
        href="/asistan"
        className="bg-accent2-soft rounded-[28px] p-6 pb-5 flex flex-col items-center text-center gap-1 relative overflow-hidden"
      >
        <svg viewBox="0 0 400 90" className="absolute bottom-0 left-0 w-full h-[70px]" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 40 Q 100 0 200 30 T 400 20 V90 H0 Z" fill="var(--accent2)" opacity="0.16" />
          <path d="M0 60 Q 120 25 220 55 T 400 45 V90 H0 Z" fill="var(--accent2)" opacity="0.22" />
        </svg>
        <Mascot size={92} />
        <p className="text-[18px] font-bold font-display text-accent2-ink mt-1 relative">Danışmana Sor</p>
        <p className="text-[13px] text-accent2-ink/75 relative">
          &quot;Bu ay ne kadar kazandım?&quot; gibi sorular sor
        </p>
        <span className="mt-2 bg-accent2-ink text-white rounded-full px-5 py-2 text-[13px] font-bold relative">
          Sohbete Başla
        </span>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-5 items-start">
        <StaffOnDutyCard staff={staffOnDutyToday} />
        {financeNote && (
          <div className="bg-accent-soft border border-accent/30 rounded-2xl p-4 lg:p-5 flex flex-col gap-1.5">
            <p className="text-[12.5px] font-bold text-accent uppercase tracking-wide">AI Finans Notu</p>
            <p className="text-[13.5px] text-ink leading-relaxed">{financeNote}</p>
          </div>
        )}
      </div>

      <SuggestionsClient items={suggestions} />
    </AppShell>
  );
}

/** Referans 2'deki "Statistic" ekranındaki çubuk grafik örüntüsü — 7 günlük ciro. */
function WeekRevenueChart({ data }: { data: { label: string; revenue: number; isToday: boolean }[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const total = data.reduce((sum, d) => sum + d.revenue, 0);
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 lg:p-5 flex flex-col gap-4">
      <div>
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Bu Hafta</p>
        <p className="text-[22px] font-bold font-display">{formatTL(total)}</p>
      </div>
      <div className="flex items-end justify-between gap-2 h-24">
        {data.map((d) => {
          const heightPercent = Math.max(6, Math.round((d.revenue / max) * 100));
          return (
            <div key={d.label + d.revenue} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
              <div
                className={`w-full rounded-t-md ${d.isToday ? "bg-accent" : "bg-accent-soft"}`}
                style={{ height: `${heightPercent}%` }}
              />
              <span className={`text-[10px] font-bold ${d.isToday ? "text-accent" : "text-ink-muted"}`}>
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
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
