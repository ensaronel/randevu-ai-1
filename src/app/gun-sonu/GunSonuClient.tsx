"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatTimeTR, formatTL } from "@/lib/date";
import type { Attendance } from "@/types/database";

type OneOrMany<T> = T | T[] | null;

export interface GunSonuAppointment {
  id: string;
  starts_at: string;
  status: string;
  attendance: Attendance;
  customer: OneOrMany<{ full_name: string }>;
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

const ATTENDANCE_OPTIONS: { value: Attendance; label: string }[] = [
  { value: "came", label: "Geldi" },
  { value: "no_show_notified", label: "Haber Verdi" },
  { value: "no_show_silent", label: "Habersiz" },
];

export default function GunSonuClient({
  appointments,
  todayKey,
  initialReconciledAt,
  initialActualRevenue,
}: {
  appointments: GunSonuAppointment[];
  todayKey: string;
  initialReconciledAt: string | null;
  initialActualRevenue: number | null;
}) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconciledAt, setReconciledAt] = useState(initialReconciledAt);
  const [actualRevenue, setActualRevenue] = useState(initialActualRevenue);

  async function setAttendance(appointmentId: string, attendance: Attendance) {
    setSavingId(appointmentId);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSavingId(null);
    }
  }

  async function savePrice(serviceRowId: string) {
    const value = Number(priceDraft.replace(",", "."));
    if (Number.isNaN(value) || value < 0) return;

    setSavingId(serviceRowId);
    try {
      const res = await fetch(`/api/appointment-services/${serviceRowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ final_price: value }),
      });
      if (res.ok) {
        setEditingServiceId(null);
        router.refresh();
      }
    } finally {
      setSavingId(null);
    }
  }

  async function reconcileDay() {
    setReconciling(true);
    try {
      const res = await fetch("/api/gun-sonu/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayKey }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setReconciledAt(data.reconciled_at);
        setActualRevenue(data.actual_revenue);
      }
    } finally {
      setReconciling(false);
    }
  }

  const unmarkedCount = appointments.filter((a) => !a.attendance).length;

  return (
    <>
      <div className="flex flex-col gap-3">
        {appointments.length === 0 && (
          <p className="text-sm text-ink-muted text-center py-6">Bugün için randevu yok.</p>
        )}

        {appointments.map((appt) => {
          const customer = one(appt.customer);
          return (
            <div key={appt.id} className="bg-surface border border-border rounded-2xl p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{customer?.full_name ?? "Müşteri"}</span>
                <span className="text-[12.5px] text-ink-muted">{formatTimeTR(appt.starts_at)}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                {appt.appointment_services.map((svc) => {
                  const service = one(svc.service);
                  const staff = one(svc.staff);
                  const isEditing = editingServiceId === svc.id;
                  const currentPrice = svc.final_price ?? svc.planned_price;
                  return (
                    <div key={svc.id} className="flex items-center justify-between text-[13px]">
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
                          }}
                          className="font-semibold underline decoration-dotted"
                        >
                          {formatTL(currentPrice)}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-1.5 pt-1">
                {ATTENDANCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setAttendance(appt.id, opt.value)}
                    disabled={savingId === appt.id}
                    className={`flex-1 rounded-lg py-1.5 text-[12px] font-semibold border ${
                      appt.attendance === opt.value
                        ? opt.value === "came"
                          ? "bg-good-ink/10 border-good-ink text-good-ink"
                          : "bg-bad/10 border-bad text-bad"
                        : "border-border text-ink-muted"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {appointments.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2.5 mt-1">
          {reconciledAt ? (
            <>
              <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Gün Kapatıldı</p>
              <p className="text-[21px] font-semibold font-display">{formatTL(actualRevenue ?? 0)}</p>
              <button onClick={reconcileDay} disabled={reconciling} className="text-[12.5px] text-accent font-semibold self-start">
                Yeniden Hesapla
              </button>
            </>
          ) : (
            <>
              {unmarkedCount > 0 && (
                <p className="text-[12.5px] text-ink-muted">{unmarkedCount} randevu için henüz durum işaretlenmedi.</p>
              )}
              <button
                onClick={reconcileDay}
                disabled={reconciling}
                className="bg-accent text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {reconciling ? "..." : "Günü Kapat"}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
