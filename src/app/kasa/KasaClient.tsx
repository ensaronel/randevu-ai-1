"use client";

import { useEffect, useState } from "react";
import { formatTL } from "@/lib/date";
import type { FixedExpense } from "@/types/database";

/**
 * Türkçe para girişini (binlik ayraç "." + ondalık ayraç ",") sayıya çevirir.
 * Virgül varsa noktalar binlik ayraç sayılıp silinir. Virgül yoksa ve tek bir
 * nokta 1-2 haneli bir kesirle bitiyorsa ("45.5" gibi) ondalık ayraç kabul
 * edilir, aksi halde ("1.234" gibi) binlik ayraç sayılıp silinir.
 */
function parseTLInput(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return NaN;
  if (trimmed.includes(",")) {
    return Number(trimmed.replace(/\./g, "").replace(",", "."));
  }
  const dotMatches = trimmed.match(/\./g);
  if (dotMatches?.length === 1) {
    const decimalPart = trimmed.split(".")[1];
    if (decimalPart.length <= 2) return Number(trimmed);
  }
  return Number(trimmed.replace(/\./g, ""));
}

/** Tarayıcının yerel (Türkiye) gününe göre "YYYY-MM-DD" — toISOString() UTC'ye kaydırdığı için kullanılmadı. */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

type PresetKey = "today" | "yesterday" | "week" | "month" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Bugün" },
  { key: "yesterday", label: "Dün" },
  { key: "week", label: "Bu Hafta" },
  { key: "month", label: "Bu Ay" },
  { key: "custom", label: "Özel Aralık" },
];

function presetRange(preset: PresetKey): { from: string; to: string } {
  const today = new Date();
  const todayKey = toDateKey(today);
  if (preset === "yesterday") {
    const y = toDateKey(addDays(today, -1));
    return { from: y, to: y };
  }
  if (preset === "week") {
    // Pazartesi baslangicli (Turkce takvim konvansiyonu), bugune kadar.
    const isoWeekday = today.getDay() === 0 ? 7 : today.getDay(); // 1=Pzt..7=Paz
    const monday = toDateKey(addDays(today, -(isoWeekday - 1)));
    return { from: monday, to: todayKey };
  }
  if (preset === "month") {
    const first = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    return { from: first, to: todayKey };
  }
  return { from: todayKey, to: todayKey };
}

interface RangeSummary {
  from: string;
  to: string;
  dayCount: number;
  revenue: number;
  expenseShare: number;
  net: number;
}

function RangeCalculator() {
  const [preset, setPreset] = useState<PresetKey>("today");
  const [customFrom, setCustomFrom] = useState(toDateKey(new Date()));
  const [customTo, setCustomTo] = useState(toDateKey(new Date()));
  const [summary, setSummary] = useState<RangeSummary | null>(null);

  const range = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset);
  // summary bir onceki araligin sonucu olabilir — o zaman "guncel degil" say ve
  // yukleniyor goster, ayri bir loading state'i senkron olarak effect'te set etmeyelim.
  const isStale = !summary || summary.from !== range.from || summary.to !== range.to;

  useEffect(() => {
    if (range.from > range.to) return;
    let cancelled = false;
    fetch(`/api/kasa/range-summary?from=${range.from}&to=${range.to}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.data) setSummary(body.data);
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
      <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Hesaplama</p>

      <div className="flex gap-1.5 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold border ${
              preset === p.key ? "bg-accent text-white border-accent" : "border-border text-ink-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="flex-1 min-w-0 border border-border rounded-lg px-2.5 py-2 text-[13px]"
          />
          <span className="text-ink-muted text-[13px]">—</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="flex-1 min-w-0 border border-border rounded-lg px-2.5 py-2 text-[13px]"
          />
        </div>
      )}

      {range.from > range.to ? (
        <p className="text-[12.5px] text-bad">Bitiş tarihi başlangıçtan önce olamaz.</p>
      ) : isStale ? (
        <p className="text-[12.5px] text-ink-muted">Hesaplanıyor…</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-muted">Ciro</span>
            <span className="text-[16px] font-bold font-display">{formatTL(summary.revenue)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-muted">Gider payı</span>
            <span className="text-[16px] font-bold font-display">{formatTL(summary.expenseShare)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-muted">{summary.net >= 0 ? "Net kâr" : "Net zarar"}</span>
            <span className={`text-[16px] font-bold font-display ${summary.net >= 0 ? "text-good-ink" : "text-bad"}`}>
              {formatTL(Math.abs(summary.net))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function FixedExpenses({ initialFixedExpenses }: { initialFixedExpenses: FixedExpense[] }) {
  const [items, setItems] = useState(initialFixedExpenses);
  const [descDraft, setDescDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmountDraft, setEditAmountDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const total = items.reduce((sum, e) => sum + Number(e.monthly_amount), 0);

  async function addFixedExpense() {
    const amount = parseTLInput(amountDraft);
    const description = descDraft.trim();
    if (!description || Number.isNaN(amount) || amount < 0) return;

    setAdding(true);
    try {
      const res = await fetch("/api/kasa/fixed-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, monthly_amount: amount }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setItems((prev) => [...prev, data]);
        setDescDraft("");
        setAmountDraft("");
      }
    } finally {
      setAdding(false);
    }
  }

  async function saveAmount(id: string) {
    const amount = parseTLInput(editAmountDraft);
    if (Number.isNaN(amount) || amount < 0) return;

    setBusyId(id);
    try {
      const res = await fetch(`/api/kasa/fixed-expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_amount: amount }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setItems((prev) => prev.map((e) => (e.id === id ? data : e)));
        setEditingId(null);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function removeFixedExpense(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/kasa/fixed-expenses/${id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((e) => e.id !== id));
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
      <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Sabit Giderler</p>
      <p className="text-[12px] text-ink-muted -mt-1.5">
        Kira, şampuan gibi her ay tekrar eden giderler — bir kere gir, zam gelince tutarını güncelle.
      </p>

      {items.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {items.map((e) => {
            const isEditing = editingId === e.id;
            return (
              <div key={e.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="text-ink truncate">{e.description}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {isEditing ? (
                    <>
                      <input
                        autoFocus
                        value={editAmountDraft}
                        onChange={(ev) => setEditAmountDraft(ev.target.value)}
                        className="w-20 border border-border rounded px-1.5 py-0.5 text-right text-[13px]"
                      />
                      <button
                        onClick={() => saveAmount(e.id)}
                        disabled={busyId === e.id}
                        className="text-accent font-semibold text-[12.5px]"
                      >
                        Kaydet
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(e.id);
                        setEditAmountDraft(String(e.monthly_amount));
                      }}
                      className="font-semibold font-display underline decoration-dotted"
                    >
                      {formatTL(Number(e.monthly_amount))}/ay
                    </button>
                  )}
                  <button
                    onClick={() => removeFixedExpense(e.id)}
                    disabled={busyId === e.id}
                    aria-label="Gideri sil"
                    className="text-ink-muted disabled:opacity-50"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between text-[13px] font-semibold pt-1 border-t border-border">
            <span>Aylık toplam</span>
            <span className="font-display">{formatTL(total)}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          placeholder="Açıklama (ör. Şampuan)"
          className="flex-1 min-w-0 border border-border rounded-lg px-2.5 py-2 text-[13px]"
        />
        <input
          value={amountDraft}
          onChange={(e) => setAmountDraft(e.target.value)}
          inputMode="decimal"
          placeholder="Aylık tutar"
          className="w-24 border border-border rounded-lg px-2 py-2 text-right text-[13px]"
        />
        <button
          onClick={addFixedExpense}
          disabled={adding || !descDraft.trim() || !amountDraft.trim()}
          className="bg-accent text-white rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50 shrink-0"
        >
          Ekle
        </button>
      </div>
    </div>
  );
}

export default function KasaClient({ initialFixedExpenses }: { initialFixedExpenses: FixedExpense[] }) {
  return (
    <>
      <RangeCalculator />
      <FixedExpenses initialFixedExpenses={initialFixedExpenses} />
    </>
  );
}
