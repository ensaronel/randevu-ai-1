"use client";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Pazartesi" },
  { key: "tue", label: "Salı" },
  { key: "wed", label: "Çarşamba" },
  { key: "thu", label: "Perşembe" },
  { key: "fri", label: "Cuma" },
  { key: "sat", label: "Cumartesi" },
  { key: "sun", label: "Pazar" },
];

export type WorkingHours = Record<string, [string, string]>;

export default function WorkingHoursEditor({
  value,
  onChange,
}: {
  value: WorkingHours;
  onChange: (next: WorkingHours) => void;
}) {
  function setDay(key: string, closed: boolean, start?: string, end?: string) {
    const next = { ...value };
    if (closed) {
      delete next[key];
    } else {
      next[key] = [start ?? next[key]?.[0] ?? "09:00", end ?? next[key]?.[1] ?? "19:00"];
    }
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {DAYS.map((day) => {
        const shift = value[day.key];
        const closed = !shift;
        return (
          <div key={day.key} className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 w-28 shrink-0 text-[12.5px]">
              <input type="checkbox" checked={!closed} onChange={(e) => setDay(day.key, !e.target.checked)} />
              {day.label}
            </label>
            {!closed && (
              <>
                <input
                  type="time"
                  value={shift[0]}
                  onChange={(e) => setDay(day.key, false, e.target.value, shift[1])}
                  className="border border-border rounded px-2 py-1 text-[12.5px]"
                />
                <span className="text-ink-muted text-[12.5px]">–</span>
                <input
                  type="time"
                  value={shift[1]}
                  onChange={(e) => setDay(day.key, false, shift[0], e.target.value)}
                  className="border border-border rounded px-2 py-1 text-[12.5px]"
                />
              </>
            )}
            {closed && <span className="text-[12.5px] text-ink-muted">Kapalı</span>}
          </div>
        );
      })}
    </div>
  );
}
