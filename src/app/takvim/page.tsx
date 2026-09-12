import Link from "next/link";
import { getBusinessOwnerForPage } from "@/lib/auth";
import { dateKeyTR, formatDateTR } from "@/lib/date";
import { dayRangeUtcISOForDate, weekdayKeyForDate } from "@/lib/ai/availability";
import { parseTimeToMinutes } from "@/lib/capacity";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import TakvimAppointmentBlocks from "@/app/takvim/TakvimAppointmentBlocks";
import type { Staff } from "@/types/database";

const DEFAULT_GRID_START_HOUR = 9;
const DEFAULT_GRID_END_HOUR = 19;
const COLUMN_WIDTH = 130;
const HOUR_HEIGHT = 60; // 1px = 1dk
const WEEKDAY_LABELS = ["PAZ", "PZT", "SAL", "ÇAR", "PER", "CUM", "CTS"];

function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Türkiye yerel saatine göre gece yarısından bu yana geçen dakika (UTC+3 sabit ofset, bkz. lib/date.ts notu). */
function turkeyNowMinutesOfDay(): number {
  const turkeyMs = Date.now() + 3 * 60 * 60000;
  const d = new Date(turkeyMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function weekdayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return WEEKDAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

type ServiceInfo = { name: string; duration_minutes: number };
type ApptServiceRow = {
  id: string;
  staff_id: string;
  planned_price: number;
  final_price: number | null;
  adjustment_note: string | null;
  payment_method: "nakit" | "kart" | null;
  service: ServiceInfo | ServiceInfo[] | null;
};
type ApptRow = {
  id: string;
  starts_at: string;
  status: string;
  customer: { full_name: string; phone: string } | { full_name: string; phone: string }[] | null;
  appointment_services: ApptServiceRow[];
};

export default async function TakvimPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { business, supabase } = await getBusinessOwnerForPage();
  const sp = await searchParams;
  const dateKey = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : dateKeyTR(0);
  const { startUtc, endUtc } = dayRangeUtcISOForDate(dateKey);

  const dayChips = Array.from({ length: 7 }, (_, i) => shiftDateKey(dateKey, i - 3));

  const [{ data: staffData }, { data: apptData }] = await Promise.all([
    supabase
      .from("staff")
      .select("*")
      .eq("business_id", business.id)
      .eq("status", "active")
      .order("full_name", { ascending: true }),
    supabase
      .from("appointments")
      .select(
        "id, starts_at, status, customer:customers(full_name, phone), appointment_services(id, staff_id, planned_price, final_price, adjustment_note, payment_method, service:services(name, duration_minutes))"
      )
      .eq("business_id", business.id)
      .gte("starts_at", startUtc)
      .lt("starts_at", endUtc)
      .neq("status", "cancelled"),
  ]);

  const staffList = (staffData ?? []) as Staff[];
  const appointments = (apptData ?? []) as unknown as ApptRow[];
  const weekdayKey = weekdayKeyForDate(dateKey);

  // Grid, sabit 09:00-19:00 yerine o günkü gerçek en erken açılış/en geç kapanışa
  // göre boyutlanır — işletme daha kısa çalışıyorsa boş alan israf edilmez.
  const activeShiftsToday = staffList
    .filter((s) => !s.leave_dates?.includes(dateKey))
    .map((s) => s.working_hours?.[weekdayKey])
    .filter((shift): shift is [string, string] => !!shift);
  const businessShiftToday = business.working_hours?.[weekdayKey];
  const candidateShifts = activeShiftsToday.length > 0 ? activeShiftsToday : businessShiftToday ? [businessShiftToday] : [];

  const GRID_START_HOUR =
    candidateShifts.length > 0
      ? Math.floor(Math.min(...candidateShifts.map((s) => parseTimeToMinutes(s[0]))) / 60)
      : DEFAULT_GRID_START_HOUR;
  const GRID_END_HOUR =
    candidateShifts.length > 0
      ? Math.ceil(Math.max(...candidateShifts.map((s) => parseTimeToMinutes(s[1]))) / 60)
      : DEFAULT_GRID_END_HOUR;
  const gridMinutes = (GRID_END_HOUR - GRID_START_HOUR) * 60;

  const isToday = dateKey === dateKeyTR(0);
  const nowLineTop = turkeyNowMinutesOfDay() - GRID_START_HOUR * 60;
  const showNowLine = isToday && nowLineTop >= 0 && nowLineTop <= gridMinutes;

  function serviceDuration(service: ServiceInfo | ServiceInfo[] | null): number {
    if (!service) return 0;
    return Array.isArray(service) ? service[0]?.duration_minutes ?? 0 : service.duration_minutes;
  }

  function occupancyForStaff(staff: Staff): { percent: number; working: boolean } {
    if (staff.leave_dates?.includes(dateKey)) return { percent: 0, working: false };
    const shift = staff.working_hours?.[weekdayKey];
    if (!shift) return { percent: 0, working: false };

    const capacityMinutes = Math.max(0, parseTimeToMinutes(shift[1]) - parseTimeToMinutes(shift[0]));
    if (capacityMinutes === 0) return { percent: 0, working: false };

    const bookedMinutes = appointments.reduce((sum, appt) => {
      return (
        sum +
        appt.appointment_services
          .filter((svc) => svc.staff_id === staff.id)
          .reduce((s, svc) => s + serviceDuration(svc.service), 0)
      );
    }, 0);

    return { percent: Math.round((bookedMinutes / capacityMinutes) * 100), working: true };
  }

  const hourMarks = Array.from(
    { length: GRID_END_HOUR - GRID_START_HOUR + 1 },
    (_, i) => GRID_START_HOUR + i
  );

  return (
    <AppShell businessName={business.name}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link
              href={`/takvim?date=${shiftDateKey(dateKey, -1)}`}
              className="w-8 h-8 rounded-full border border-border flex items-center justify-center shrink-0 text-ink-muted"
              aria-label="Önceki gün"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </Link>
            <div>
              <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">Takvim</p>
              <h1 className="text-xl font-semibold capitalize">{formatDateTR(`${dateKey}T12:00:00+03:00`)}</h1>
            </div>
            <Link
              href={`/takvim?date=${shiftDateKey(dateKey, 1)}`}
              className="w-8 h-8 rounded-full border border-border flex items-center justify-center shrink-0 text-ink-muted"
              aria-label="Sonraki gün"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
          <Link
            href="/randevu-olustur"
            className="bg-accent text-white rounded-full px-4 py-2 text-[13px] font-semibold shrink-0"
          >
            + Randevu
          </Link>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {dayChips.map((chipDateKey) => (
            <Link
              key={chipDateKey}
              href={`/takvim?date=${chipDateKey}`}
              className={`w-12 shrink-0 flex flex-col items-center gap-1.5`}
            >
              <span className="text-[10px] font-bold text-ink-muted">{weekdayLabel(chipDateKey)}</span>
              <span
                className={`w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-bold transition-colors ${
                  chipDateKey === dateKey
                    ? "bg-accent text-white shadow-sm"
                    : "bg-surface border border-border text-ink-muted"
                }`}
              >
                {Number(chipDateKey.split("-")[2])}
              </span>
            </Link>
          ))}
        </div>

        {staffList.length === 0 ? (
          <EmptyState message="Henüz aktif personel yok — Ayarlar'dan personel ekleyince burada görünecek." />
        ) : (
          <div className="overflow-x-auto overflow-y-visible">
            <div className="flex" style={{ minWidth: 42 + staffList.length * COLUMN_WIDTH + (staffList.length - 1) * 8 }}>
              <div style={{ width: 42, flexShrink: 0 }} />
              <div className="flex flex-1" style={{ gap: 8 }}>
                {staffList.map((s) => {
                  const occupancy = occupancyForStaff(s);
                  return (
                    <div
                      key={s.id}
                      className="flex flex-col items-center gap-0.5 flex-1"
                      style={{ minWidth: COLUMN_WIDTH }}
                    >
                      <span className="text-center text-[12.5px] font-bold">{s.full_name}</span>
                      <span className="text-[10.5px] text-ink-muted">
                        {occupancy.working ? `%${occupancy.percent} dolu` : "Bugün kapalı"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className="flex relative"
              style={{
                minWidth: 42 + staffList.length * COLUMN_WIDTH + (staffList.length - 1) * 8,
                // Son saat etiketi ("19:00" gibi) tam kapsayıcının alt kenarına denk
                // gelip kırpılmasın diye altta biraz boşluk bırakılıyor — etiket
                // dikey ortalamak için -6px yukarı kayıyor (bkz. aşağıdaki top hesabı),
                // bu boşluk olmazsa en alttaki etiketin metni kesiliyordu.
                paddingBottom: 20,
              }}
            >
              {showNowLine && (
                <div
                  className="absolute z-10 pointer-events-none flex items-center"
                  style={{ top: nowLineTop, left: 38, right: 0 }}
                >
                  <span className="w-2 h-2 rounded-full bg-bad shrink-0" />
                  <span className="flex-1 h-[1.5px] bg-bad" />
                </div>
              )}
              <div style={{ width: 42, height: gridMinutes, position: "relative", flexShrink: 0 }}>
                {hourMarks.map((h, i) => (
                  <div
                    key={h}
                    className="absolute text-[10.5px] text-ink-muted"
                    style={{ top: i * HOUR_HEIGHT - 6 }}
                  >
                    {String(h).padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              <TakvimAppointmentBlocks
                appointments={appointments}
                staffIds={staffList.map((s) => s.id)}
                startUtc={startUtc}
                gridStartHour={GRID_START_HOUR}
                gridMinutes={gridMinutes}
              />
            </div>
          </div>
        )}
    </AppShell>
  );
}
