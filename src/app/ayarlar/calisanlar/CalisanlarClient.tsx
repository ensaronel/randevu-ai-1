"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WorkingHoursEditor, { type WorkingHours } from "@/components/WorkingHoursEditor";
import { formatTL, formatDateTR } from "@/lib/date";

export interface StaffItem {
  id: string;
  full_name: string;
  status: "active" | "inactive";
  commission_rate: number;
  leave_dates: string[];
  working_hours: WorkingHours;
  serviceIds: string[];
  revenue: number;
  commission: number;
  occupancyPercent: number;
  cancellationRatePercent: number;
}

export interface ServiceOption {
  id: string;
  name: string;
}

const DEFAULT_HOURS: WorkingHours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, ["09:00", "19:00"]])
) as WorkingHours;

export default function CalisanlarClient({ staff, serviceList }: { staff: StaffItem[]; serviceList: ServiceOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [commissionRate, setCommissionRate] = useState("20");
  const [workingHours, setWorkingHours] = useState<WorkingHours>(DEFAULT_HOURS);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newLeaveDate, setNewLeaveDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addStaff() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name.trim(), commission_rate: Number(commissionRate), working_hours: workingHours }),
      });
      if (res.ok) {
        const { data: newStaff } = await res.json();
        if (selectedServiceIds.length > 0 && newStaff?.id) {
          await fetch(`/api/staff/${newStaff.id}/expertise`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ service_ids: selectedServiceIds }),
          }).catch(() => {});
        }
        setName("");
        setCommissionRate("20");
        setWorkingHours(DEFAULT_HOURS);
        setSelectedServiceIds([]);
        setShowAddForm(false);
        router.refresh();
      } else {
        setError("Personel eklenemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Personel eklenemedi, lütfen tekrar dene.");
    } finally {
      setSaving(false);
    }
  }

  async function updateStaff(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
      else setError("Güncellenemedi, lütfen tekrar dene.");
    } catch {
      setError("Güncellenemedi, lütfen tekrar dene.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleExpertise(member: StaffItem, serviceId: string) {
    const next = member.serviceIds.includes(serviceId)
      ? member.serviceIds.filter((id) => id !== serviceId)
      : [...member.serviceIds, serviceId];
    setBusyId(member.id);
    setError(null);
    try {
      const res = await fetch(`/api/staff/${member.id}/expertise`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_ids: next }),
      });
      if (res.ok) router.refresh();
      else setError("Hizmet ataması kaydedilemedi, lütfen tekrar dene.");
    } catch {
      setError("Hizmet ataması kaydedilemedi, lütfen tekrar dene.");
    } finally {
      setBusyId(null);
    }
  }

  function addLeaveDate(member: StaffItem) {
    if (!newLeaveDate || member.leave_dates.includes(newLeaveDate)) return;
    updateStaff(member.id, { leave_dates: [...member.leave_dates, newLeaveDate].sort() });
    setNewLeaveDate("");
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-[12px] text-bad">{error}</p>}
      {showAddForm ? (
        <div className="bg-surface border border-border rounded-2xl shadow-card p-4 flex flex-col gap-3">
          <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Yeni Personel</p>
          <input
            placeholder="Ad Soyad"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Prim oranı (%)"
            inputMode="numeric"
            value={commissionRate}
            onChange={(e) => setCommissionRate(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm"
          />
          <WorkingHoursEditor value={workingHours} onChange={setWorkingHours} />
          <div className="flex flex-col gap-1.5">
            <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Verdiği Hizmetler</p>
            {serviceList.length === 0 ? (
              <p className="text-[12px] text-ink-muted">Önce Hizmetler sayfasından hizmet ekle.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {serviceList.map((service) => {
                  const active = selectedServiceIds.includes(service.id);
                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() =>
                        setSelectedServiceIds((prev) =>
                          prev.includes(service.id) ? prev.filter((id) => id !== service.id) : [...prev, service.id]
                        )
                      }
                      className={`px-2.5 py-1.5 rounded-full text-[12px] font-semibold border ${
                        active ? "bg-accent text-white border-accent" : "border-border text-ink-muted"
                      }`}
                    >
                      {service.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={addStaff}
              disabled={saving}
              className="flex-1 bg-accent text-white rounded-lg shadow-[0_2px_10px_-3px_rgba(30,46,79,0.55)] active:scale-[0.98] py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {saving ? "Ekleniyor..." : "Personeli Ekle"}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
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
          + Personel Ekle
        </button>
      )}

      <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-2 lg:gap-4">
        {staff.map((member) => {
          const expanded = expandedId === member.id;
          return (
            <div
              key={member.id}
              className={`bg-surface border border-border rounded-2xl shadow-card p-3.5 flex flex-col gap-2.5 ${
                member.status === "inactive" ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-4">
                <OccupancyRing percent={member.occupancyPercent} />
                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => setExpandedId(expanded ? null : member.id)} className="text-left min-w-0">
                      <p className="font-semibold text-sm truncate">{member.full_name}</p>
                    </button>
                    <button
                      onClick={() => updateStaff(member.id, { status: member.status === "active" ? "inactive" : "active" })}
                      disabled={busyId === member.id}
                      className="text-[11px] font-bold text-accent shrink-0"
                    >
                      {member.status === "active" ? "Pasifleştir" : "Aktifleştir"}
                    </button>
                  </div>
                  <div className="flex gap-4">
                    <Metric label="Bu ay ciro" value={formatTL(member.revenue)} />
                    <Metric
                      label="İptal oranı"
                      value={`%${member.cancellationRatePercent}`}
                      warn={member.cancellationRatePercent > 25}
                    />
                  </div>
                  <span className="text-[11.5px] text-ink-muted">
                    Bu ay prim: {formatTL(member.commission)} (%{member.commission_rate})
                  </span>
                </div>
              </div>

              {expanded && (
                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                  <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Verdiği Hizmetler</p>
                  {serviceList.length === 0 ? (
                    <p className="text-[12px] text-ink-muted">Önce Hizmetler sayfasından hizmet ekle.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {serviceList.map((service) => {
                        const active = member.serviceIds.includes(service.id);
                        return (
                          <button
                            key={service.id}
                            type="button"
                            disabled={busyId === member.id}
                            onClick={() => toggleExpertise(member, service.id)}
                            className={`px-2.5 py-1.5 rounded-full text-[12px] font-semibold border disabled:opacity-50 ${
                              active ? "bg-accent text-white border-accent" : "border-border text-ink-muted"
                            }`}
                          >
                            {service.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide pt-1">İzin Günleri</p>
                  {member.leave_dates.length === 0 && (
                    <p className="text-[12px] text-ink-muted">Tanımlı izin günü yok.</p>
                  )}
                  {member.leave_dates.map((date) => (
                    <div key={date} className="flex items-center justify-between text-[13px]">
                      <span>{formatDateTR(`${date}T12:00:00`)}</span>
                      <button
                        onClick={() =>
                          updateStaff(member.id, { leave_dates: member.leave_dates.filter((d) => d !== date) })
                        }
                        className="text-[12px] text-bad font-semibold"
                      >
                        Kaldır
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={newLeaveDate}
                      onChange={(e) => setNewLeaveDate(e.target.value)}
                      className="flex-1 border border-border rounded-lg px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => addLeaveDate(member)}
                      className="bg-accent text-white rounded-lg shadow-[0_2px_10px_-3px_rgba(30,46,79,0.55)] active:scale-[0.98] px-4 text-sm font-semibold"
                    >
                      Ekle
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OccupancyRing({ percent }: { percent: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - Math.min(100, percent) / 100);

  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--accent-soft)" strokeWidth="8" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[13px] font-bold">%{percent}</div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={`text-sm font-semibold font-display ${warn ? "text-bad" : ""}`}>{value}</span>
      <span className="text-[11px] text-ink-muted">{label}</span>
    </div>
  );
}
