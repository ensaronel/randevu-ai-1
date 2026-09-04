"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatTL } from "@/lib/date";

export interface ServiceItem {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  category: string | null;
  status: "active" | "inactive";
}

const emptyForm = { name: "", duration_minutes: "30", price: "", category: "" };

export default function HizmetlerClient({ services }: { services: ServiceItem[] }) {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addService() {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          duration_minutes: Number(form.duration_minutes),
          price: Number(form.price.replace(",", ".")),
          category: form.category.trim() || null,
        }),
      });
      if (res.ok) {
        setForm(emptyForm);
        router.refresh();
      } else {
        setError("Hizmet eklenemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Hizmet eklenemedi, lütfen tekrar dene.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(service: ServiceItem) {
    setBusyId(service.id);
    setError(null);
    try {
      const res = await fetch(`/api/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: service.status === "active" ? "inactive" : "active" }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError("Durum değiştirilemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Durum değiştirilemedi, lütfen tekrar dene.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2.5">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Yeni Hizmet</p>
        <input
          placeholder="Hizmet adı"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="border border-border rounded-lg px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <input
            placeholder="Süre (dk)"
            inputMode="numeric"
            value={form.duration_minutes}
            onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Fiyat (TL)"
            inputMode="decimal"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <input
          placeholder="Kategori (opsiyonel)"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="border border-border rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={addService}
          disabled={saving}
          className="bg-accent text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {saving ? "Ekleniyor..." : "Hizmeti Ekle"}
        </button>
        {error && <p className="text-[12px] text-bad">{error}</p>}
      </div>

      <div className="flex flex-col gap-2">
        {services.map((service) => (
          <div
            key={service.id}
            className={`bg-surface border border-border rounded-2xl p-3.5 flex items-center justify-between ${
              service.status === "inactive" ? "opacity-50" : ""
            }`}
          >
            <div>
              <p className="font-semibold text-sm">{service.name}</p>
              <p className="text-[12.5px] text-ink-muted">
                {service.duration_minutes} dk · {formatTL(service.price)}
                {service.category ? ` · ${service.category}` : ""}
              </p>
            </div>
            <button
              onClick={() => toggleStatus(service)}
              disabled={busyId === service.id}
              className="text-[12.5px] font-semibold text-accent"
            >
              {service.status === "active" ? "Pasifleştir" : "Aktifleştir"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
