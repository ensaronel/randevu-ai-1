"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WorkingHoursEditor, { type WorkingHours } from "@/components/WorkingHoursEditor";
import { formatDateTR } from "@/lib/date";

export default function IsletmeClient({
  initialWorkingHours,
  initialClosedDates,
}: {
  initialWorkingHours: WorkingHours;
  initialClosedDates: string[];
}) {
  const router = useRouter();
  const [workingHours, setWorkingHours] = useState<WorkingHours>(initialWorkingHours);
  const [closedDates, setClosedDates] = useState<string[]>(initialClosedDates);
  const [newDate, setNewDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(next: { working_hours?: WorkingHours; closed_dates?: string[] }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        // eslint-disable-next-line react-hooks/purity -- event handler içinde çağrılıyor, render sırasında değil
        const now = Date.now();
        setSavedAt(now);
        router.refresh();
      } else {
        setError("Kaydedilemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Kaydedilemedi, lütfen tekrar dene.");
    } finally {
      setSaving(false);
    }
  }

  function addClosedDate() {
    if (!newDate || closedDates.includes(newDate)) return;
    const next = [...closedDates, newDate].sort();
    setClosedDates(next);
    setNewDate("");
    save({ closed_dates: next });
  }

  function removeClosedDate(date: string) {
    const next = closedDates.filter((d) => d !== date);
    setClosedDates(next);
    save({ closed_dates: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Çalışma Saatleri</p>
        <WorkingHoursEditor value={workingHours} onChange={setWorkingHours} />
        <button
          onClick={() => save({ working_hours: workingHours })}
          disabled={saving}
          className="bg-accent text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 self-start px-4"
        >
          {saving ? "Kaydediliyor..." : "Kaydet"}
        </button>
        {error && <p className="text-[12px] text-bad">{error}</p>}
        {!error && savedAt && <p className="text-[12px] text-good-ink">Kaydedildi.</p>}
      </div>

      <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2.5">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Kapalı Günler</p>
        {closedDates.length === 0 && <p className="text-[12.5px] text-ink-muted">Tanımlı kapalı gün yok.</p>}
        {closedDates.map((date) => (
          <div key={date} className="flex items-center justify-between text-sm">
            <span>{formatDateTR(`${date}T12:00:00`)}</span>
            <button onClick={() => removeClosedDate(date)} className="text-[12.5px] text-bad font-semibold">
              Kaldır
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={addClosedDate} className="bg-accent text-white rounded-lg px-4 text-sm font-semibold">
            Ekle
          </button>
        </div>
      </div>
    </div>
  );
}
