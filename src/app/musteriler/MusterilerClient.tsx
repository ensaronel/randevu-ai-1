"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatTL, formatDateTR } from "@/lib/date";

export interface CustomerListItem {
  id: string;
  full_name: string;
  phone: string;
  noShowCount: number;
  totalSpent: number;
  lastVisitAt: string | null;
  hasAiFlag: boolean;
}

export default function MusterilerClient({ customers }: { customers: CustomerListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.full_name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [customers, query]);

  async function addCustomer() {
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name.trim(), phone: phone.trim() }),
      });
      if (res.ok) {
        setName("");
        setPhone("");
        setShowAddForm(false);
        router.refresh();
      } else if (res.status === 409) {
        setError("Bu telefon numarası zaten kayıtlı.");
      } else {
        setError("Müşteri eklenemedi.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        placeholder="İsim veya telefon ara..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="border border-border rounded-lg px-3 py-2.5 text-sm bg-surface"
      />

      {showAddForm ? (
        <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Yeni Müşteri</p>
          <input
            placeholder="Ad Soyad"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Telefon (05xx...)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm"
          />
          {error && <p className="text-[12px] text-bad">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={addCustomer}
              disabled={saving}
              className="flex-1 bg-accent text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {saving ? "Ekleniyor..." : "Kaydet"}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setError(null);
              }}
              className="flex-1 border border-border rounded-lg py-2.5 text-sm font-semibold text-ink-muted"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="border border-dashed border-border rounded-2xl py-3 text-sm font-semibold text-accent"
        >
          + Yeni Müşteri
        </button>
      )}

      <div className="flex flex-col gap-2.5">
        {filtered.length === 0 && (
          <p className="text-sm text-ink-muted text-center py-6">
            {query ? "Eşleşen müşteri bulunamadı." : "Henüz müşteri yok."}
          </p>
        )}
        {filtered.map((c) => (
          <Link
            key={c.id}
            href={`/musteriler/${c.id}`}
            className="bg-surface border border-border rounded-2xl p-3.5 flex items-center justify-between gap-3"
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-sm truncate">{c.full_name}</p>
                {c.hasAiFlag && (
                  <span className="text-[10px] font-bold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full shrink-0">
                    AI
                  </span>
                )}
                {c.noShowCount >= 2 && (
                  <span className="text-[10px] font-bold text-bad bg-bad-soft px-1.5 py-0.5 rounded-full shrink-0">
                    ⚠
                  </span>
                )}
              </div>
              <p className="text-[12.5px] text-ink-muted truncate">{c.phone}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold font-display">{formatTL(c.totalSpent)}</p>
              <p className="text-[11px] text-ink-muted">{c.lastVisitAt ? formatDateTR(c.lastVisitAt) : "Ziyaret yok"}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
