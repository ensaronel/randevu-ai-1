"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTL, formatTimeTR } from "@/lib/date";
import type { Service, Staff } from "@/types/database";

interface CustomerHit {
  id: string;
  full_name: string;
  phone: string;
}

interface Slot {
  starts_at: string;
  ends_at: string;
  assignments: { service_id: string; staff_id: string; staff_name: string }[];
}

const WEEKDAY_LABELS = ["PAZ", "PZT", "SAL", "ÇAR", "PER", "CUM", "CTS"];
const DAY_COUNT = 7;

function nextDateKeys(): { dateKey: string; label: string; dayNumber: number }[] {
  const now = new Date();
  const turkeyNow = new Date(now.getTime() + 3 * 60 * 60000);
  const days = [];
  for (let i = 0; i < DAY_COUNT; i++) {
    const d = new Date(
      Date.UTC(turkeyNow.getUTCFullYear(), turkeyNow.getUTCMonth(), turkeyNow.getUTCDate() + i)
    );
    days.push({
      dateKey: d.toISOString().slice(0, 10),
      label: WEEKDAY_LABELS[d.getUTCDay()],
      dayNumber: d.getUTCDate(),
    });
  }
  return days;
}

export default function RandevuOlusturClient({ services, staff }: { services: Service[]; staff: Staff[] }) {
  const router = useRouter();
  const dateOptions = useMemo(() => nextDateKeys(), []);

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerHit | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [addingCustomer, setAddingCustomer] = useState(false);

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(services[0]?.id ?? null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null); // null = Herhangi
  const [selectedDateKey, setSelectedDateKey] = useState(dateOptions[0]?.dateKey ?? "");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const selectedService = services.find((s) => s.id === selectedServiceId) ?? null;
  const slotsRequestSeq = useRef(0);

  useEffect(() => {
    if (selectedCustomer) return;
    const q = customerQuery.trim();
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sorgu boşaldığında önceki sonuçları temizlemek gerekiyor
      setCustomerHits([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const { data } = await res.json();
        setCustomerHits(data ?? []);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [customerQuery, selectedCustomer]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hizmet/personel/tarih değişince önceki seçim geçersiz kalır
    setSelectedSlot(null);
    if (!selectedServiceId || !selectedDateKey) {
      setSlots([]);
      return;
    }
    const seq = ++slotsRequestSeq.current;
    setLoadingSlots(true);
    const params = new URLSearchParams({ date: selectedDateKey, service_id: selectedServiceId });
    if (selectedStaffId) params.set("staff_id", selectedStaffId);
    fetch(`/api/appointments/available-slots?${params.toString()}`)
      .then((res) => res.json())
      .then((body) => {
        // Bu istek beklerken hizmet/personel/tarih tekrar değişip yeni bir
        // istek başlatılmışsa, geç gelen bu eski cevap ekranı güncellemez.
        if (seq !== slotsRequestSeq.current) return;
        setSlots(body.data ?? []);
      })
      .finally(() => {
        if (seq === slotsRequestSeq.current) setLoadingSlots(false);
      });
  }, [selectedServiceId, selectedStaffId, selectedDateKey]);

  async function addNewCustomer() {
    if (!newName.trim() || !newPhone.trim()) return;
    setAddingCustomer(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: newName.trim(), phone: newPhone.trim() }),
      });
      const body = await res.json();
      if (res.ok) {
        setSelectedCustomer({ id: body.data.id, full_name: body.data.full_name, phone: body.data.phone });
        setShowNewCustomer(false);
        setNewName("");
        setNewPhone("");
      } else if (res.status === 409) {
        setError("Bu telefon numarası zaten kayıtlı, arama kutusundan bulabilirsin.");
      } else {
        setError("Müşteri eklenemedi.");
      }
    } finally {
      setAddingCustomer(false);
    }
  }

  async function submit() {
    if (!selectedCustomer || !selectedService || !selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const assignment = selectedSlot.assignments.find((a) => a.service_id === selectedService.id);
      if (!assignment) throw new Error("no_assignment");

      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: selectedCustomer.id,
          starts_at: selectedSlot.starts_at,
          ends_at: selectedSlot.ends_at,
          source: "manual",
          services: [
            { service_id: selectedService.id, staff_id: assignment.staff_id, planned_price: selectedService.price },
          ],
        }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push("/takvim"), 1200);
      } else if (res.status === 409) {
        setError("Bu saat az önce başka bir randevuyla doldu, lütfen başka bir saat seç.");
        setSlots((prev) => prev.filter((s) => s.starts_at !== selectedSlot.starts_at));
        setSelectedSlot(null);
      } else {
        setError("Randevu oluşturulamadı, lütfen tekrar dene.");
      }
    } catch {
      setError("Randevu oluşturulamadı, lütfen tekrar dene.");
    } finally {
      setSubmitting(false);
    }
  }

  const resolvedStaffName = selectedSlot?.assignments.find((a) => a.service_id === selectedServiceId)?.staff_name;
  const canSubmit = !!(selectedCustomer && selectedService && selectedSlot) && !submitting;

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-good-soft flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--good-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <p className="font-semibold">Randevu oluşturuldu!</p>
        <p className="text-sm text-ink-muted">Takvime yönlendiriliyorsun...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 lg:max-w-2xl">
      <h1 className="text-xl font-semibold">Randevu Oluştur</h1>

      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Müşteri</span>
        {selectedCustomer ? (
          <div className="bg-surface border border-border rounded-2xl p-3 flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">{selectedCustomer.full_name}</p>
              <p className="text-[12.5px] text-ink-muted">{selectedCustomer.phone}</p>
            </div>
            <button
              onClick={() => setSelectedCustomer(null)}
              className="text-[12.5px] font-semibold text-accent"
            >
              Değiştir
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              placeholder="İsim veya telefon ara..."
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              className="border border-border rounded-lg px-3.5 py-3 text-sm bg-surface"
            />
            {customerHits.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {customerHits.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer(c);
                      setCustomerQuery("");
                      setCustomerHits([]);
                    }}
                    className="bg-surface border border-border rounded-xl p-3 text-left"
                  >
                    <p className="font-semibold text-sm">{c.full_name}</p>
                    <p className="text-[12.5px] text-ink-muted">{c.phone}</p>
                  </button>
                ))}
              </div>
            )}
            {!showNewCustomer ? (
              <button
                onClick={() => setShowNewCustomer(true)}
                className="text-[13px] font-semibold text-accent text-left"
              >
                + Yeni müşteri ekle
              </button>
            ) : (
              <div className="bg-surface border border-border rounded-2xl p-3 flex flex-col gap-2">
                <input
                  placeholder="Ad Soyad"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="border border-border rounded-lg px-3 py-2 text-sm"
                />
                <input
                  placeholder="Telefon (05xx...)"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="border border-border rounded-lg px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={addNewCustomer}
                    disabled={addingCustomer}
                    className="flex-1 bg-accent text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {addingCustomer ? "Ekleniyor..." : "Kaydet"}
                  </button>
                  <button
                    onClick={() => setShowNewCustomer(false)}
                    className="flex-1 border border-border rounded-lg py-2 text-sm font-semibold text-ink-muted"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Hizmet</span>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedServiceId(s.id)}
              className={`rounded-full px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap shrink-0 ${
                selectedServiceId === s.id ? "bg-accent text-white" : "bg-surface border border-border"
              }`}
            >
              {s.name}
            </button>
          ))}
          {services.length === 0 && (
            <p className="text-sm text-ink-muted">Önce Ayarlar &gt; Hizmetler&apos;den bir hizmet ekle.</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Personel</span>
        <div className="flex gap-3.5 overflow-x-auto pb-1">
          <button onClick={() => setSelectedStaffId(null)} className="flex flex-col items-center gap-1.5 shrink-0">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm ${
                selectedStaffId === null ? "bg-accent text-white" : "bg-accent-soft text-accent-ink"
              }`}
            >
              ?
            </div>
            <span className={`text-[11.5px] font-semibold ${selectedStaffId === null ? "" : "text-ink-muted"}`}>
              Herhangi
            </span>
          </button>
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedStaffId(s.id)}
              className="flex flex-col items-center gap-1.5 shrink-0"
            >
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm ${
                  selectedStaffId === s.id
                    ? "bg-accent text-white"
                    : "bg-[oklch(94%_0.012_70)] text-ink-muted"
                }`}
              >
                {s.full_name.charAt(0).toUpperCase()}
              </div>
              <span className={`text-[11.5px] font-semibold ${selectedStaffId === s.id ? "" : "text-ink-muted"}`}>
                {s.full_name.split(" ")[0]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Tarih</span>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {dateOptions.map((d) => (
            <button
              key={d.dateKey}
              onClick={() => setSelectedDateKey(d.dateKey)}
              className={`w-[46px] h-[58px] rounded-xl flex flex-col items-center justify-center gap-0.5 shrink-0 ${
                selectedDateKey === d.dateKey
                  ? "bg-accent text-white"
                  : "bg-surface border border-border text-ink-muted"
              }`}
            >
              <span className="text-[10px] font-bold">{d.label}</span>
              <span className="text-sm font-bold">{d.dayNumber}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Saat</span>
        {loadingSlots ? (
          <p className="text-sm text-ink-muted">Uygun saatler aranıyor...</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-ink-muted">Bu tarihte uygun saat bulunamadı, başka bir gün dene.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((slot) => (
              <button
                key={slot.starts_at}
                onClick={() => setSelectedSlot(slot)}
                className={`rounded-lg py-2.5 text-[13px] font-semibold text-center ${
                  selectedSlot?.starts_at === slot.starts_at
                    ? "bg-accent text-white"
                    : "bg-surface border border-border"
                }`}
              >
                {formatTimeTR(slot.starts_at)}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedCustomer && selectedService && selectedSlot && (
        <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2.5">
          <span className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Randevu Özeti</span>
          <SummaryRow label="Müşteri" value={selectedCustomer.full_name} />
          <SummaryRow label="Hizmet" value={selectedService.name} />
          <SummaryRow label="Personel" value={resolvedStaffName ?? "-"} />
          <SummaryRow
            label="Tarih / Saat"
            value={`${selectedDateKey.split("-").reverse().join(".")}, ${formatTimeTR(selectedSlot.starts_at)}`}
          />
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-[13.5px] text-ink-muted">Fiyat</span>
            <span className="font-display font-semibold text-lg">{formatTL(selectedService.price)}</span>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="bg-accent text-white rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-40"
      >
        {submitting ? "Oluşturuluyor..." : "Randevu Oluştur"}
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[13.5px]">
      <span className="text-ink-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
