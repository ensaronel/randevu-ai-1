"use client";

import { useEffect, useState } from "react";
import { formatTL } from "@/lib/date";
import BadgeStat from "@/components/BadgeStat";
import EmptyState from "@/components/EmptyState";
import type { ExpenseCategory, FixedExpense, OneTimeExpense } from "@/types/database";

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

const CATEGORY_TONES: Record<Exclude<ExpenseCategory, null>, string> = {
  kira: "bg-block2 text-block2-ink",
  fatura: "bg-bad-soft text-bad-ink",
  malzeme: "bg-accent-soft text-accent",
  bakim: "bg-accent2-soft text-accent2-ink",
  diger: "bg-border text-ink-muted",
};

const CATEGORY_ICON_PATHS: Record<Exclude<ExpenseCategory, null>, string> = {
  kira: "M4 11l8-6 8 6v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z",
  fatura: "M13 3L5 13h5l-1 8 8-10h-5z",
  malzeme: "M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4M20 8v8l-8 4",
  bakim: "M14.7 6.3a4 4 0 01-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 015.4-5.4L21 6l-3-3-3.3 3.3z",
  diger: "M20 12l-8 8-8-8 8-8 8 8z",
};

function CategoryIcon({ category }: { category: ExpenseCategory }) {
  const key = category ?? "diger";
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${CATEGORY_TONES[key]}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={CATEGORY_ICON_PATHS[key]} />
      </svg>
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-border rounded-lg px-2 py-2 text-[13px] bg-surface shrink-0"
    >
      <option value="diger">Diğer</option>
      <option value="kira">Kira</option>
      <option value="fatura">Fatura</option>
      <option value="malzeme">Malzeme</option>
      <option value="bakim">Bakım</option>
    </select>
  );
}

interface RangeSummary {
  from: string;
  to: string;
  dayCount: number;
  revenue: number;
  cashRevenue: number;
  cardRevenue: number;
  unspecifiedRevenue: number;
  expenseShare: number;
  net: number;
  previousRevenue: number;
  revenueChangePercent: number | null;
  oneTimeExpenses: OneTimeExpense[];
  dailyChart: { date: string; revenue: number }[] | null;
}

function RangeRevenueChart({ data }: { data: { date: string; revenue: number }[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <div className="flex items-end justify-between gap-1 h-20">
      {data.map((d) => {
        const heightPercent = Math.max(6, Math.round((d.revenue / max) * 100));
        const dayNum = Number(d.date.slice(8, 10));
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <div className="w-full rounded-t-md bg-accent-soft" style={{ height: `${heightPercent}%` }} />
            <span className="text-[9px] font-bold text-ink-muted">{dayNum}</span>
          </div>
        );
      })}
    </div>
  );
}

function HeroNet({ summary }: { summary: RangeSummary }) {
  const isProfit = summary.net >= 0;
  return (
    <div className={`rounded-[24px] p-5 flex flex-col gap-1 ${isProfit ? "bg-ink text-white" : "bg-bad-soft"}`}>
      <p className={`text-[12.5px] font-bold uppercase tracking-wide ${isProfit ? "text-white/65" : "text-bad-ink/80"}`}>
        {isProfit ? "Net Kâr" : "Net Zarar"}
      </p>
      <div className="flex items-end gap-2.5 flex-wrap">
        <p className={`text-[34px] font-bold font-display leading-none ${isProfit ? "text-white" : "text-bad-ink"}`}>
          {formatTL(Math.abs(summary.net))}
        </p>
        {summary.revenueChangePercent !== null && (
          <span
            className={`text-[12.5px] font-bold mb-1 ${
              summary.revenueChangePercent >= 0
                ? isProfit
                  ? "text-good-soft"
                  : "text-good-ink"
                : isProfit
                  ? "text-white/70"
                  : "text-bad-ink/70"
            }`}
          >
            {summary.revenueChangePercent >= 0 ? "▲" : "▼"} %{Math.abs(Math.round(summary.revenueChangePercent))} ciro
            (geçen döneme göre)
          </span>
        )}
      </div>
    </div>
  );
}

function RangeCalculator({
  preset,
  setPreset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  range,
  summary,
}: {
  preset: PresetKey;
  setPreset: (p: PresetKey) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  range: { from: string; to: string };
  summary: RangeSummary | null;
}) {
  const isStale = !summary || summary.from !== range.from || summary.to !== range.to;
  const hasPaymentSplit = summary && (summary.cashRevenue > 0 || summary.cardRevenue > 0 || summary.unspecifiedRevenue > 0);

  return (
    <div className="flex flex-col gap-3">
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
        <>
          <HeroNet summary={summary} />

          <div className="grid grid-cols-2 gap-2.5">
            <BadgeStat icon="banknote" label="Ciro" value={formatTL(summary.revenue)} tone="accentSoft" />
            <BadgeStat icon="wallet" label="Gider payı" value={formatTL(summary.expenseShare)} tone="block2" />
          </div>

          {hasPaymentSplit && (
            <div className="bg-surface border border-border rounded-2xl p-3.5 flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-[12.5px]">
                <span className="w-2 h-2 rounded-full bg-good-ink" />
                <span className="text-ink-muted">Nakit</span>
                <span className="font-semibold font-display">{formatTL(summary.cashRevenue)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[12.5px]">
                <span className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-ink-muted">Kart</span>
                <span className="font-semibold font-display">{formatTL(summary.cardRevenue)}</span>
              </div>
              {summary.unspecifiedRevenue > 0 && (
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <span className="w-2 h-2 rounded-full bg-border" />
                  <span className="text-ink-muted">Belirtilmedi</span>
                  <span className="font-semibold font-display">{formatTL(summary.unspecifiedRevenue)}</span>
                </div>
              )}
            </div>
          )}

          {summary.dailyChart && summary.dailyChart.length > 1 && (
            <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
              <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Günlük Ciro</p>
              <RangeRevenueChart data={summary.dailyChart} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OneTimeExpensesSection({
  range,
  items,
  onChanged,
}: {
  range: { from: string; to: string };
  items: OneTimeExpense[];
  onChanged: () => void;
}) {
  const [dateDraft, setDateDraft] = useState(range.to);
  const [descDraft, setDescDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("diger");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const total = items.reduce((sum, e) => sum + Number(e.amount), 0);

  async function addExpense() {
    const amount = parseTLInput(amountDraft);
    const description = descDraft.trim();
    if (!description || Number.isNaN(amount) || amount < 0 || !dateDraft) return;

    setAdding(true);
    try {
      const res = await fetch("/api/kasa/one-time-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expense_date: dateDraft, description, amount, category: categoryDraft }),
      });
      if (res.ok) {
        setDescDraft("");
        setAmountDraft("");
        onChanged();
      }
    } finally {
      setAdding(false);
    }
  }

  async function removeExpense(id: string) {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/kasa/one-time-expenses/${id}`, { method: "DELETE" });
      if (res.ok) onChanged();
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
      <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Tek Seferlik Giderler</p>
      <p className="text-[12px] text-ink-muted -mt-1.5">
        Tamirat, ekipman alımı gibi bir kerelik giderler — seçili tarih aralığındakiler listelenir.
      </p>

      {items.length === 0 ? (
        <EmptyState message="Seçili aralıkta tek seferlik gider yok." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((e) => (
            <div key={e.id} className="flex items-center gap-2.5">
              <CategoryIcon category={e.category} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-ink truncate">{e.description}</p>
                <p className="text-[11px] text-ink-muted">{e.expense_date}</p>
              </div>
              <span className="font-semibold font-display text-[13px] shrink-0">{formatTL(Number(e.amount))}</span>
              <button
                onClick={() => removeExpense(e.id)}
                disabled={removingId === e.id}
                aria-label="Gideri sil"
                className="text-ink-muted disabled:opacity-50 shrink-0"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between text-[13px] font-semibold pt-1 border-t border-border">
            <span>Aralık toplamı</span>
            <span className="font-display">{formatTL(total)}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateDraft}
            onChange={(e) => setDateDraft(e.target.value)}
            className="border border-border rounded-lg px-2 py-2 text-[13px] shrink-0"
          />
          <CategorySelect value={categoryDraft} onChange={setCategoryDraft} />
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            placeholder="Açıklama (ör. Fön makinesi tamiri)"
            className="flex-1 min-w-0 border border-border rounded-lg px-2.5 py-2 text-[13px]"
          />
          <input
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            inputMode="decimal"
            placeholder="Tutar"
            className="w-24 border border-border rounded-lg px-2 py-2 text-right text-[13px]"
          />
          <button
            onClick={addExpense}
            disabled={adding || !descDraft.trim() || !amountDraft.trim()}
            className="bg-accent text-white rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50 shrink-0"
          >
            Ekle
          </button>
        </div>
      </div>
    </div>
  );
}

function FixedExpenses({ initialFixedExpenses }: { initialFixedExpenses: FixedExpense[] }) {
  const [items, setItems] = useState(initialFixedExpenses);
  const [descDraft, setDescDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("diger");
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
        body: JSON.stringify({ description, monthly_amount: amount, category: categoryDraft }),
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

      {items.length === 0 ? (
        <EmptyState message="Henüz sabit gider eklenmedi." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((e) => {
            const isEditing = editingId === e.id;
            return (
              <div key={e.id} className="flex items-center gap-2.5">
                <CategoryIcon category={e.category} />
                <span className="text-ink truncate flex-1 min-w-0 text-[13px]">{e.description}</span>
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
                      className="font-semibold font-display underline decoration-dotted text-[13px]"
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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <input
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            placeholder="Açıklama (ör. Şampuan)"
            className="flex-1 min-w-0 border border-border rounded-lg px-2.5 py-2 text-[13px]"
          />
          <CategorySelect value={categoryDraft} onChange={setCategoryDraft} />
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            inputMode="decimal"
            placeholder="Aylık tutar"
            className="flex-1 min-w-0 border border-border rounded-lg px-2 py-2 text-right text-[13px]"
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
    </div>
  );
}

export default function KasaClient({ initialFixedExpenses }: { initialFixedExpenses: FixedExpense[] }) {
  const [preset, setPreset] = useState<PresetKey>("today");
  const [customFrom, setCustomFrom] = useState(toDateKey(new Date()));
  const [customTo, setCustomTo] = useState(toDateKey(new Date()));
  const [summary, setSummary] = useState<RangeSummary | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const range = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset);

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
  }, [range.from, range.to, refreshTick]);

  return (
    <>
      <RangeCalculator
        preset={preset}
        setPreset={setPreset}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        range={range}
        summary={summary}
      />
      {summary && summary.from === range.from && summary.to === range.to && (
        <OneTimeExpensesSection
          key={range.to}
          range={range}
          items={summary.oneTimeExpenses}
          onChanged={() => setRefreshTick((t) => t + 1)}
        />
      )}
      <FixedExpenses initialFixedExpenses={initialFixedExpenses} />
    </>
  );
}
