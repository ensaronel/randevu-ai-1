import { getBusinessOwnerForPage } from "@/lib/auth";
import { dayRangeUtcISO, formatDateTR } from "@/lib/date";
import { colorForCategory } from "@/lib/serviceColors";
import BottomNav from "@/components/BottomNav";
import type { Staff } from "@/types/database";

const GRID_START_HOUR = 9;
const GRID_END_HOUR = 19;
const COLUMN_WIDTH = 108;
const HOUR_HEIGHT = 60; // 1px = 1dk

type ServiceInfo = { name: string; duration_minutes: number; category: string | null };
type ApptServiceRow = {
  staff_id: string;
  service: ServiceInfo | ServiceInfo[] | null;
};
type ApptRow = {
  id: string;
  starts_at: string;
  status: string;
  customer: { full_name: string } | { full_name: string }[] | null;
  appointment_services: ApptServiceRow[];
};

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function TakvimPage() {
  const { business, supabase } = await getBusinessOwnerForPage();
  const { startUtc, endUtc } = dayRangeUtcISO(0);

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
        "id, starts_at, status, customer:customers(full_name), appointment_services(staff_id, service:services(name, duration_minutes, category))"
      )
      .eq("business_id", business.id)
      .gte("starts_at", startUtc)
      .lt("starts_at", endUtc)
      .neq("status", "cancelled"),
  ]);

  const staffList = (staffData ?? []) as Staff[];
  const appointments = (apptData ?? []) as unknown as ApptRow[];
  const gridMinutes = (GRID_END_HOUR - GRID_START_HOUR) * 60;

  const hourMarks = Array.from(
    { length: GRID_END_HOUR - GRID_START_HOUR + 1 },
    (_, i) => GRID_START_HOUR + i
  );

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-4 max-w-3xl mx-auto w-full">
        <div>
          <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">Takvim</p>
          <h1 className="text-xl font-semibold capitalize">{formatDateTR(new Date().toISOString())}</h1>
        </div>

        {staffList.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Henüz aktif personel yok — Ayarlar&apos;dan (Hafta 10) personel ekleyince burada görünecek.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex" style={{ minWidth: 42 + staffList.length * (COLUMN_WIDTH + 8) }}>
              <div style={{ width: 42 }} />
              {staffList.map((s) => (
                <div
                  key={s.id}
                  className="text-center text-[12.5px] font-bold"
                  style={{ width: COLUMN_WIDTH, marginRight: 8 }}
                >
                  {s.full_name}
                </div>
              ))}
            </div>

            <div className="flex relative" style={{ minWidth: 42 + staffList.length * (COLUMN_WIDTH + 8) }}>
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

              <div style={{ position: "relative", height: gridMinutes, flex: 1 }}>
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 60px)",
                  }}
                />

                {staffList.map((staff, colIndex) => (
                  <div
                    key={staff.id}
                    style={{
                      position: "absolute",
                      left: colIndex * (COLUMN_WIDTH + 8),
                      top: 0,
                      width: COLUMN_WIDTH,
                      height: gridMinutes,
                    }}
                  >
                    {appointments.flatMap((appt) => {
                      const startMinutes =
                        (new Date(appt.starts_at).getTime() -
                          new Date(startUtc).getTime()) /
                          60000 -
                        GRID_START_HOUR * 60;

                      return appt.appointment_services
                        .filter((svc) => svc.staff_id === staff.id)
                        .map((svc, i) => {
                          const service = one(svc.service);
                          if (!service) return null;
                          const color = colorForCategory(service.category);
                          const customer = one(appt.customer);

                          return (
                            <div
                              key={`${appt.id}-${i}`}
                              className="absolute rounded-lg px-1.5 py-1 text-[11px] leading-tight overflow-hidden border-l-[3px]"
                              style={{
                                top: startMinutes,
                                height: Math.max(24, service.duration_minutes),
                                width: COLUMN_WIDTH,
                                background: color.bg,
                                borderColor: color.border,
                                color: color.text,
                              }}
                            >
                              <span className="font-bold block truncate">
                                {customer?.full_name ?? "Müşteri"}
                              </span>
                              <span className="block truncate opacity-85">{service.name}</span>
                            </div>
                          );
                        });
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
