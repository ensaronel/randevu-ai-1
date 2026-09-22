"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatTL } from "@/lib/date";
import { parseTLInput } from "@/lib/money";
import BadgeStat from "@/components/BadgeStat";
import EmptyState from "@/components/EmptyState";
import type { ExpenseCategory, FixedExpense, OneTimeExpense, OneTimeSale, CustomerPackage } from "@/types/database";

interface StaffOption {
  id: string;
  full_name: string;
}

interface ServiceOption {
  id: string;
  name: string;
}

interface CustomerOption {
  id: string;
  full_name: string;
}

interface CommissionItem {
  name: string;
  amount: number;
}

type CustomerPackageRow = CustomerPackage & {
  usedSessions: number;
  remainingSessions: number;
  customer: { full_name: string } | { full_name: string }[] | null;
  service: { name: string } | { name: string }[] | null;
};

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

/** Satır bazlı satış ikonu — giderlerin CategoryIcon'una paralel ama "gelir" hissi için yeşil. */
function SaleIcon() {
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-good-soft text-good-ink">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10v4a1 1 0 001 1h2l5 4V5L6 9H4a1 1 0 00-1 1z" />
        <path d="M16 8.5a4 4 0 010 7" />
      </svg>
    </div>
  );
}

/**
 * Tek tıkla geri alınamaz silme yerine "emin misin, tekrar bas" onayı —
 * Reklam kartlarındaki desenle aynı, tüm silme aksiyonlarında tutarlı olsun diye.
 */
function DeleteButton({ onConfirm, busy, label }: { onConfirm: () => void; busy: boolean; label: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        onConfirm();
      }}
      onBlur={() => setConfirming(false)}
      disabled={busy}
      aria-label={label}
      className={`shrink-0 rounded-full flex items-center justify-center disabled:opacity-50 transition-colors ${
        confirming ? "px-2 h-6 bg-bad text-white text-[10.5px] font-bold" : "w-6 h-6 text-ink-muted"
      }`}
    >
      {confirming ? (
        "Sil?"
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0v12a1 1 0 001 1h6a1 1 0 001-1V7" />
        </svg>
      )}
    </button>
  );
}

/**
 * Kasa'daki işlem listeleri (Sabit Gider/Tek Seferlik Gider/Ürün Satış/Primler)
 * girdikçe sınırsız uzuyor, sayfayı "biriken" bir hale getiriyordu — varsayılan
 * olarak sadece ilk N kayıt gösterilir, "Tümünü Gör" ile genişleyince de sabit
 * yükseklikte iç scroll'a geçer.
 */
function ExpandableList<T>({
  items,
  collapsedCount = 5,
  keyOf,
  renderItem,
}: {
  items: T[];
  collapsedCount?: number;
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, collapsedCount);
  const hiddenCount = items.length - visible.length;

  return (
    <>
      <div className={`flex flex-col gap-1.5 ${expanded ? "max-h-72 overflow-y-auto pr-0.5" : ""}`}>
        {visible.map((item) => (
          <div key={keyOf(item)}>{renderItem(item)}</div>
        ))}
      </div>
      {items.length > collapsedCount && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-[12px] font-semibold text-accent self-start"
        >
          {expanded ? "Daha az göster" : `Tümünü gör (${hiddenCount} tane daha)`}
        </button>
      )}
    </>
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
  oneTimeSales: OneTimeSale[];
  customerPackages: CustomerPackageRow[];
  dailyChart: { date: string; revenue: number }[] | null;
}

/** Satır ikonu — paketler bir "seans" hakkı sattığı için diğer gelir kalemlerinden ayırt edici bilet/kupon hissi. */
function PackageIcon() {
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-good-soft text-good-ink">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8z" />
        <path d="M10 8v8" strokeDasharray="1.6 2" />
      </svg>
    </div>
  );
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
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
    <div className={`rounded-[20px] p-5 flex flex-col gap-1 ${isProfit ? "bg-ink text-white" : "bg-bad-soft"}`}>
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

/**
 * Önceden Net Kâr / Ciro-Gider rozetleri / nakit-kart kırılımı / günlük grafik
 * dört ayrı beyaz kart olarak alt alta diziliyordu — tek başına anlamlı olsa da
 * bir arada "dağınık, kutu kutu" bir sayfa hissi veriyordu. Artık hepsi TEK bir
 * kartın içinde, ince ayraçlarla bölünmüş bölümler olarak duruyor.
 */
function RangeCalculator({
  preset,
  setPreset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  range,
  summary,
  fetchError,
  onRetry,
}: {
  preset: PresetKey;
  setPreset: (p: PresetKey) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  range: { from: string; to: string };
  summary: RangeSummary | null;
  fetchError: boolean;
  onRetry: () => void;
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
      ) : fetchError ? (
        <div className="flex items-center gap-2">
          <p className="text-[12.5px] text-bad">Ciro hesaplanamadı, bağlantını kontrol edip tekrar dene.</p>
          <button onClick={onRetry} className="text-[12.5px] font-semibold text-accent shrink-0">
            Tekrar dene
          </button>
        </div>
      ) : isStale ? (
        <p className="text-[12.5px] text-ink-muted">Hesaplanıyor…</p>
      ) : (
        <div className="bg-surface border border-border rounded-2xl shadow-card p-4 flex flex-col gap-4">
          <HeroNet summary={summary} />

          <div className="grid grid-cols-2 gap-2.5">
            <BadgeStat icon="banknote" label="Ciro" value={formatTL(summary.revenue)} tone="accentSoft" />
            <BadgeStat icon="wallet" label="Gider payı" value={formatTL(summary.expenseShare)} tone="block2" />
          </div>

          {hasPaymentSplit && (
            <div className="flex flex-wrap items-center gap-4 pt-3.5 border-t border-border">
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
            <div className="flex flex-col gap-3 pt-3.5 border-t border-border">
              <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Günlük Ciro</p>
              <RangeRevenueChart data={summary.dailyChart} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OneTimeExpensesBody({
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
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, e) => sum + Number(e.amount), 0);

  async function addExpense() {
    const amount = parseTLInput(amountDraft);
    const description = descDraft.trim();
    if (!description || Number.isNaN(amount) || amount < 0 || !dateDraft) return;

    setAdding(true);
    setError(null);
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
      } else {
        setError("Gider eklenemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Gider eklenemedi, lütfen tekrar dene.");
    } finally {
      setAdding(false);
    }
  }

  async function removeExpense(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/kasa/one-time-expenses/${id}`, { method: "DELETE" });
      if (res.ok) onChanged();
      else setError("Gider silinemedi, lütfen tekrar dene.");
    } catch {
      setError("Gider silinemedi, lütfen tekrar dene.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-muted">
        Tamirat, ekipman alımı gibi bir kerelik giderler — seçili tarih aralığındakiler listelenir.
      </p>

      {items.length === 0 ? (
        <EmptyState message="Seçili aralıkta tek seferlik gider yok." />
      ) : (
        <div className="flex flex-col gap-1.5">
          <ExpandableList
            items={items}
            keyOf={(e) => e.id}
            renderItem={(e) => (
              <div className="flex items-center gap-2.5">
                <CategoryIcon category={e.category} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink truncate">{e.description}</p>
                  <p className="text-[11px] text-ink-muted">{e.expense_date}</p>
                </div>
                <span className="font-semibold font-display text-[13px] shrink-0">{formatTL(Number(e.amount))}</span>
                <DeleteButton
                  onConfirm={() => removeExpense(e.id)}
                  busy={removingId === e.id}
                  label="Gideri sil"
                />
              </div>
            )}
          />
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
            className="bg-accent text-white rounded-lg shadow-[0_2px_10px_-3px_rgba(30,46,79,0.55)] active:scale-[0.98] px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50 shrink-0"
          >
            Ekle
          </button>
        </div>
        {error && <p className="text-[12px] text-bad">{error}</p>}
      </div>
    </div>
  );
}

function OneTimeSalesBody({
  range,
  items,
  staffList,
  onChanged,
}: {
  range: { from: string; to: string };
  items: OneTimeSale[];
  staffList: StaffOption[];
  onChanged: () => void;
}) {
  const [dateDraft, setDateDraft] = useState(range.to);
  const [descDraft, setDescDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [staffDraft, setStaffDraft] = useState("");
  const [paymentDraft, setPaymentDraft] = useState<"nakit" | "kart" | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, s) => sum + Number(s.amount), 0);
  const staffName = (id: string | null) => staffList.find((s) => s.id === id)?.full_name ?? "İşletme (genel)";

  async function addSale() {
    const amount = parseTLInput(amountDraft);
    const description = descDraft.trim();
    if (!description || Number.isNaN(amount) || amount < 0 || !dateDraft) return;

    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/kasa/one-time-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sale_date: dateDraft,
          description,
          amount,
          staff_id: staffDraft || null,
          payment_method: paymentDraft,
        }),
      });
      if (res.ok) {
        setDescDraft("");
        setAmountDraft("");
        onChanged();
      } else {
        setError("Satış eklenemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Satış eklenemedi, lütfen tekrar dene.");
    } finally {
      setAdding(false);
    }
  }

  async function removeSale(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/kasa/one-time-sales/${id}`, { method: "DELETE" });
      if (res.ok) onChanged();
      else setError("Satış silinemedi, lütfen tekrar dene.");
    } catch {
      setError("Satış silinemedi, lütfen tekrar dene.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-muted">
        Randevu dışı ürün/ek satışlar — seçilirse personelin primi de hesaba katılır.
      </p>

      {items.length === 0 ? (
        <EmptyState message="Seçili aralıkta ürün/ek satış yok." />
      ) : (
        <div className="flex flex-col gap-1.5">
          <ExpandableList
            items={items}
            keyOf={(s) => s.id}
            renderItem={(s) => (
              <div className="flex items-center gap-2.5">
                <SaleIcon />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink truncate">{s.description}</p>
                  <p className="text-[11px] text-ink-muted">
                    {s.sale_date} · {staffName(s.staff_id)}
                  </p>
                </div>
                <span className="font-semibold font-display text-[13px] shrink-0 text-good-ink">
                  +{formatTL(Number(s.amount))}
                </span>
                <DeleteButton onConfirm={() => removeSale(s.id)} busy={removingId === s.id} label="Satışı sil" />
              </div>
            )}
          />
          <div className="flex items-center justify-between text-[13px] font-semibold pt-1 border-t border-border">
            <span>Aralık toplamı</span>
            <span className="font-display text-good-ink">+{formatTL(total)}</span>
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
          <select
            value={staffDraft}
            onChange={(e) => setStaffDraft(e.target.value)}
            className="flex-1 min-w-0 border border-border rounded-lg px-2 py-2 text-[13px] bg-surface"
          >
            <option value="">İşletme (genel)</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            placeholder="Açıklama (ör. Bakım kremi)"
            className="flex-1 min-w-0 border border-border rounded-lg px-2.5 py-2 text-[13px]"
          />
          <input
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            inputMode="decimal"
            placeholder="Tutar"
            className="w-24 border border-border rounded-lg px-2 py-2 text-right text-[13px]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1.5 flex-1">
            {(["nakit", "kart"] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentDraft((prev) => (prev === method ? null : method))}
                className={`px-2.5 py-1.5 rounded-full text-[12px] font-semibold border ${
                  paymentDraft === method ? "bg-accent text-white border-accent" : "border-border text-ink-muted"
                }`}
              >
                {method === "nakit" ? "Nakit" : "Kart"}
              </button>
            ))}
          </div>
          <button
            onClick={addSale}
            disabled={adding || !descDraft.trim() || !amountDraft.trim()}
            className="bg-accent text-white rounded-lg shadow-[0_2px_10px_-3px_rgba(30,46,79,0.55)] active:scale-[0.98] px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50 shrink-0"
          >
            Ekle
          </button>
        </div>
        {error && <p className="text-[12px] text-bad">{error}</p>}
      </div>
    </div>
  );
}

function FixedExpensesBody({ initialFixedExpenses }: { initialFixedExpenses: FixedExpense[] }) {
  const [items, setItems] = useState(initialFixedExpenses);
  const [descDraft, setDescDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("diger");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmountDraft, setEditAmountDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, e) => sum + Number(e.monthly_amount), 0);

  async function addFixedExpense() {
    const amount = parseTLInput(amountDraft);
    const description = descDraft.trim();
    if (!description || Number.isNaN(amount) || amount < 0) return;

    setAdding(true);
    setError(null);
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
      } else {
        setError("Gider eklenemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Gider eklenemedi, lütfen tekrar dene.");
    } finally {
      setAdding(false);
    }
  }

  async function saveAmount(id: string) {
    const amount = parseTLInput(editAmountDraft);
    if (Number.isNaN(amount) || amount < 0) return;

    setBusyId(id);
    setError(null);
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
      } else {
        setError("Tutar güncellenemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Tutar güncellenemedi, lütfen tekrar dene.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeFixedExpense(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/kasa/fixed-expenses/${id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((e) => e.id !== id));
      } else {
        setError("Gider silinemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Gider silinemedi, lütfen tekrar dene.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-muted">
        Kira, şampuan gibi her ay tekrar eden giderler — bir kere gir, zam gelince tutarını güncelle.
      </p>

      {items.length === 0 ? (
        <EmptyState message="Henüz sabit gider eklenmedi." />
      ) : (
        <div className="flex flex-col gap-1.5">
          <ExpandableList
            items={items}
            keyOf={(e) => e.id}
            renderItem={(e) => {
              const isEditing = editingId === e.id;
              return (
                <div className="flex items-center gap-2.5">
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
                    <DeleteButton
                      onConfirm={() => removeFixedExpense(e.id)}
                      busy={busyId === e.id}
                      label="Gideri sil"
                    />
                  </div>
                </div>
              );
            }}
          />
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
            className="bg-accent text-white rounded-lg shadow-[0_2px_10px_-3px_rgba(30,46,79,0.55)] active:scale-[0.98] px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50 shrink-0"
          >
            Ekle
          </button>
        </div>
        {error && <p className="text-[12px] text-bad">{error}</p>}
      </div>
    </div>
  );
}

function CustomerPackagesBody({
  range,
  items,
  staffList,
  serviceList,
  customerList,
  onChanged,
}: {
  range: { from: string; to: string };
  items: CustomerPackageRow[];
  staffList: StaffOption[];
  serviceList: ServiceOption[];
  customerList: CustomerOption[];
  onChanged: () => void;
}) {
  const [dateDraft, setDateDraft] = useState(range.to);
  const [customerDraft, setCustomerDraft] = useState("");
  const [serviceDraft, setServiceDraft] = useState("");
  const [sessionsDraft, setSessionsDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [staffDraft, setStaffDraft] = useState("");
  const [paymentDraft, setPaymentDraft] = useState<"nakit" | "kart" | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, p) => sum + Number(p.price), 0);

  async function addPackage() {
    const sessions = Number(sessionsDraft);
    const amount = parseTLInput(amountDraft);
    if (!customerDraft || !serviceDraft || !Number.isInteger(sessions) || sessions <= 0 || Number.isNaN(amount) || amount < 0 || !dateDraft)
      return;

    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/kasa/customer-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sale_date: dateDraft,
          customer_id: customerDraft,
          service_id: serviceDraft,
          total_sessions: sessions,
          price: amount,
          staff_id: staffDraft || null,
          payment_method: paymentDraft,
        }),
      });
      if (res.ok) {
        setCustomerDraft("");
        setServiceDraft("");
        setSessionsDraft("");
        setAmountDraft("");
        onChanged();
      } else {
        setError("Paket eklenemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Paket eklenemedi, lütfen tekrar dene.");
    } finally {
      setAdding(false);
    }
  }

  async function removePackage(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/kasa/customer-packages/${id}`, { method: "DELETE" });
      if (res.ok) onChanged();
      else setError("Paket silinemedi — kullanılmış seansı olan bir paket silinemez.");
    } catch {
      setError("Paket silinemedi, lütfen tekrar dene.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-muted">
        Çok seanslı hizmet paketi satışı (ör. lazer epilasyon) — randevu alınırken kalan seans otomatik kullanılır.
      </p>

      {items.length === 0 ? (
        <EmptyState message="Seçili aralıkta paket satışı yok." />
      ) : (
        <div className="flex flex-col gap-1.5">
          <ExpandableList
            items={items}
            keyOf={(p) => p.id}
            renderItem={(p) => (
              <div className="flex items-center gap-2.5">
                <PackageIcon />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink truncate">
                    {one(p.customer)?.full_name ?? "Müşteri"} · {one(p.service)?.name ?? "Hizmet"}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {p.sale_date} · {p.usedSessions}/{p.total_sessions} seans kullanıldı
                  </p>
                </div>
                <span className="font-semibold font-display text-[13px] shrink-0 text-good-ink">
                  +{formatTL(Number(p.price))}
                </span>
                <DeleteButton onConfirm={() => removePackage(p.id)} busy={removingId === p.id} label="Paketi sil" />
              </div>
            )}
          />
          <div className="flex items-center justify-between text-[13px] font-semibold pt-1 border-t border-border">
            <span>Aralık toplamı</span>
            <span className="font-display text-good-ink">+{formatTL(total)}</span>
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
          <select
            value={customerDraft}
            onChange={(e) => setCustomerDraft(e.target.value)}
            className="flex-1 min-w-0 border border-border rounded-lg px-2 py-2 text-[13px] bg-surface"
          >
            <option value="">Müşteri seç...</option>
            {customerList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={serviceDraft}
            onChange={(e) => setServiceDraft(e.target.value)}
            className="flex-1 min-w-0 border border-border rounded-lg px-2 py-2 text-[13px] bg-surface"
          >
            <option value="">Hizmet seç...</option>
            {serviceList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            value={sessionsDraft}
            onChange={(e) => setSessionsDraft(e.target.value)}
            inputMode="numeric"
            placeholder="Seans"
            className="w-20 border border-border rounded-lg px-2 py-2 text-right text-[13px]"
          />
          <input
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            inputMode="decimal"
            placeholder="Tutar"
            className="w-24 border border-border rounded-lg px-2 py-2 text-right text-[13px]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={staffDraft}
            onChange={(e) => setStaffDraft(e.target.value)}
            className="flex-1 min-w-0 border border-border rounded-lg px-2 py-2 text-[13px] bg-surface"
          >
            <option value="">İşletme (genel)</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
          <div className="flex gap-1.5">
            {(["nakit", "kart"] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentDraft((prev) => (prev === method ? null : method))}
                className={`px-2.5 py-1.5 rounded-full text-[12px] font-semibold border ${
                  paymentDraft === method ? "bg-accent text-white border-accent" : "border-border text-ink-muted"
                }`}
              >
                {method === "nakit" ? "Nakit" : "Kart"}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={addPackage}
          disabled={adding || !customerDraft || !serviceDraft || !sessionsDraft.trim() || !amountDraft.trim()}
          className="bg-accent text-white rounded-lg shadow-[0_2px_10px_-3px_rgba(30,46,79,0.55)] active:scale-[0.98] px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50"
        >
          Paketi Sat
        </button>
        {error && <p className="text-[12px] text-bad">{error}</p>}
      </div>
    </div>
  );
}

function CommissionsBody({ commissions }: { commissions: CommissionItem[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-muted">Bu ayın başından bugüne, randevu + ürün satışlarından personel bazlı prim.</p>
      {commissions.length === 0 ? (
        <EmptyState message="Bu ay için henüz personel primi oluşmadı." />
      ) : (
        <ExpandableList
          items={commissions}
          keyOf={(c) => c.name}
          renderItem={(c) => (
            <div className="flex items-center justify-between text-[13px] py-0.5">
              <span className="text-ink">{c.name}</span>
              <span className="font-semibold font-display">{formatTL(c.amount)}</span>
            </div>
          )}
        />
      )}
    </div>
  );
}

type KasaTab = "satis" | "tek" | "sabit" | "paket" | "prim";

const KASA_TABS: { key: KasaTab; label: string }[] = [
  { key: "satis", label: "Satış" },
  { key: "tek", label: "Tek Seferlik" },
  { key: "sabit", label: "Sabit Gider" },
  { key: "paket", label: "Paketler" },
  { key: "prim", label: "Primler" },
];

/**
 * Önceden dört işlem grubu (Sabit Gider/Tek Seferlik Gider/Ürün Satış/Primler)
 * hep aynı anda görünen dört ayrı kart olarak alt alta diziliyordu — özet
 * kartıyla birlikte sayfada aynı anda 5-6 kutu birden görünüyordu. Reklam
 * sayfasındaki sekme desenini uygulayarak tek bir kartta, aynı anda tek bir
 * grup gösteriliyor.
 */
function KasaTabBar({ tab, setTab }: { tab: KasaTab; setTab: (t: KasaTab) => void }) {
  return (
    <div className="flex gap-1 bg-bg border border-border rounded-xl p-1">
      {KASA_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`flex-1 text-center text-[12.5px] font-semibold rounded-lg py-2 px-1 transition-colors ${
            tab === t.key ? "bg-surface text-ink shadow-sm" : "text-ink-muted"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function KasaClient({
  initialFixedExpenses,
  staffList,
  serviceList,
  customerList,
  commissions,
}: {
  initialFixedExpenses: FixedExpense[];
  staffList: StaffOption[];
  serviceList: ServiceOption[];
  customerList: CustomerOption[];
  commissions: CommissionItem[];
}) {
  const [preset, setPreset] = useState<PresetKey>("today");
  const [customFrom, setCustomFrom] = useState(toDateKey(new Date()));
  const [customTo, setCustomTo] = useState(toDateKey(new Date()));
  const [summary, setSummary] = useState<RangeSummary | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [tab, setTab] = useState<KasaTab>("satis");

  const range = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset);

  useEffect(() => {
    if (range.from > range.to) return;
    let cancelled = false;
    setFetchError(false);
    fetch(`/api/kasa/range-summary?from=${range.from}&to=${range.to}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (body?.data) setSummary(body.data);
        else setFetchError(true);
      })
      .catch(() => {
        if (!cancelled) setFetchError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, refreshTick]);

  const summaryReady = summary && summary.from === range.from && summary.to === range.to;

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
        fetchError={fetchError}
        onRetry={() => setRefreshTick((t) => t + 1)}
      />

      <div className="bg-surface border border-border rounded-2xl shadow-card p-4 flex flex-col gap-3.5">
        <KasaTabBar tab={tab} setTab={setTab} />

        {tab === "satis" &&
          (summaryReady ? (
            <OneTimeSalesBody
              key={`sale-${range.to}`}
              range={range}
              items={summary.oneTimeSales}
              staffList={staffList}
              onChanged={() => setRefreshTick((t) => t + 1)}
            />
          ) : (
            <p className="text-[12.5px] text-ink-muted">Yükleniyor…</p>
          ))}

        {tab === "tek" &&
          (summaryReady ? (
            <OneTimeExpensesBody
              key={`exp-${range.to}`}
              range={range}
              items={summary.oneTimeExpenses}
              onChanged={() => setRefreshTick((t) => t + 1)}
            />
          ) : (
            <p className="text-[12.5px] text-ink-muted">Yükleniyor…</p>
          ))}

        {tab === "sabit" && <FixedExpensesBody initialFixedExpenses={initialFixedExpenses} />}

        {tab === "paket" &&
          (summaryReady ? (
            <CustomerPackagesBody
              key={`pkg-${range.to}`}
              range={range}
              items={summary.customerPackages}
              staffList={staffList}
              serviceList={serviceList}
              customerList={customerList}
              onChanged={() => setRefreshTick((t) => t + 1)}
            />
          ) : (
            <p className="text-[12.5px] text-ink-muted">Yükleniyor…</p>
          ))}

        {tab === "prim" && <CommissionsBody commissions={commissions} />}
      </div>
    </>
  );
}
