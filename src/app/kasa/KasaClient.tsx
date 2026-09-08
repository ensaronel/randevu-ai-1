"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatTimeTR, formatTL } from "@/lib/date";
import EmptyState from "@/components/EmptyState";
import type { ExpenseItem } from "@/types/database";

type OneOrMany<T> = T | T[] | null;

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

export interface KasaAppointment {
  id: string;
  starts_at: string;
  status: string;
  customer: OneOrMany<{ full_name: string; phone: string }>;
  appointment_services: {
    id: string;
    planned_price: number;
    final_price: number | null;
    adjustment_note: string | null;
    service: OneOrMany<{ name: string }>;
    staff: OneOrMany<{ full_name: string }>;
  }[];
}

function one<T>(value: OneOrMany<T>): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default function KasaClient({
  appointments,
  todayKey,
  initialExpenseItems,
}: {
  appointments: KasaAppointment[];
  todayKey: string;
  initialExpenseItems: ExpenseItem[];
}) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  const [expenseItems, setExpenseItems] = useState(initialExpenseItems);
  const [expenseDescDraft, setExpenseDescDraft] = useState("");
  const [expenseAmountDraft, setExpenseAmountDraft] = useState("");
  const [addingExpense, setAddingExpense] = useState(false);
  const [removingExpenseId, setRemovingExpenseId] = useState<string | null>(null);

  async function savePrice(serviceRowId: string) {
    const value = parseTLInput(priceDraft);
    if (Number.isNaN(value) || value < 0) return;

    setSavingId(serviceRowId);
    try {
      const res = await fetch(`/api/appointment-services/${serviceRowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ final_price: value, adjustment_note: noteDraft.trim() || null }),
      });
      if (res.ok) {
        setEditingServiceId(null);
        setNoteDraft("");
        router.refresh();
      }
    } finally {
      setSavingId(null);
    }
  }

  async function addExpense() {
    const amount = parseTLInput(expenseAmountDraft);
    const description = expenseDescDraft.trim();
    if (!description || Number.isNaN(amount) || amount < 0) return;

    setAddingExpense(true);
    try {
      const res = await fetch("/api/kasa/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expense_date: todayKey, description, amount }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setExpenseItems((prev) => [...prev, data]);
        setExpenseDescDraft("");
        setExpenseAmountDraft("");
      }
    } finally {
      setAddingExpense(false);
    }
  }

  async function removeExpense(id: string) {
    setRemovingExpenseId(id);
    try {
      const res = await fetch(`/api/kasa/expenses/${id}`, { method: "DELETE" });
      if (res.ok) {
        setExpenseItems((prev) => prev.filter((e) => e.id !== id));
      }
    } finally {
      setRemovingExpenseId(null);
    }
  }

  const expenseTotal = expenseItems.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <>
      <div className="flex flex-col gap-3">
        {appointments.length === 0 && (
          <EmptyState message="Bugün için randevu yok — Takvim'deki + butonundan veya Randevu Oluştur'dan ekleyebilirsin." />
        )}

        {appointments.map((appt) => {
          const customer = one(appt.customer);
          return (
            <div key={appt.id} className="bg-surface border border-border rounded-2xl p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="font-semibold text-sm">{customer?.full_name ?? "Müşteri"}</span>
                  {customer?.phone && <span className="text-[11.5px] text-ink-muted">{customer.phone}</span>}
                </div>
                <span className="text-[12.5px] text-ink-muted">{formatTimeTR(appt.starts_at)}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                {appt.appointment_services.map((svc) => {
                  const service = one(svc.service);
                  const staff = one(svc.staff);
                  const isEditing = editingServiceId === svc.id;
                  const currentPrice = svc.final_price ?? svc.planned_price;
                  return (
                    <div key={svc.id} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[13px]">
                        <span className="text-ink-muted">
                          {service?.name} · {staff?.full_name}
                        </span>
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              value={priceDraft}
                              onChange={(e) => setPriceDraft(e.target.value)}
                              className="w-16 border border-border rounded px-1.5 py-0.5 text-right text-[13px]"
                            />
                            <button
                              onClick={() => savePrice(svc.id)}
                              disabled={savingId === svc.id}
                              className="text-accent font-semibold text-[12.5px]"
                            >
                              Kaydet
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingServiceId(svc.id);
                              setPriceDraft(String(currentPrice));
                              setNoteDraft(svc.adjustment_note ?? "");
                            }}
                            className="font-semibold underline decoration-dotted"
                          >
                            {formatTL(currentPrice)}
                          </button>
                        )}
                      </div>
                      {isEditing ? (
                        <input
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Düzeltme notu (örn. 30 TL indirim)"
                          className="border border-border rounded px-1.5 py-0.5 text-[12px] w-full"
                        />
                      ) : (
                        svc.adjustment_note && (
                          <span className="text-[11.5px] text-ink-muted italic">{svc.adjustment_note}</span>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3 mt-1">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Bugünkü Giderler</p>

        {expenseItems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {expenseItems.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="text-ink truncate">{e.description}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold font-display">{formatTL(Number(e.amount))}</span>
                  <button
                    onClick={() => removeExpense(e.id)}
                    disabled={removingExpenseId === e.id}
                    aria-label="Gideri sil"
                    className="text-ink-muted disabled:opacity-50"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between text-[13px] font-semibold pt-1 border-t border-border">
              <span>Toplam</span>
              <span className="font-display">{formatTL(expenseTotal)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <input
            value={expenseDescDraft}
            onChange={(e) => setExpenseDescDraft(e.target.value)}
            placeholder="Açıklama (ör. Şampuan alımı)"
            className="flex-1 min-w-0 border border-border rounded-lg px-2.5 py-2 text-[13px]"
          />
          <input
            value={expenseAmountDraft}
            onChange={(e) => setExpenseAmountDraft(e.target.value)}
            inputMode="decimal"
            placeholder="Tutar"
            className="w-20 border border-border rounded-lg px-2 py-2 text-right text-[13px]"
          />
          <button
            onClick={addExpense}
            disabled={addingExpense || !expenseDescDraft.trim() || !expenseAmountDraft.trim()}
            className="bg-accent text-white rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50 shrink-0"
          >
            Ekle
          </button>
        </div>
      </div>
    </>
  );
}
