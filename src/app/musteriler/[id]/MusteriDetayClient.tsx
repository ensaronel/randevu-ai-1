"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatTL, formatDateTR, formatTimeTR } from "@/lib/date";
import type { Customer } from "@/types/database";

export interface AppointmentHistoryItem {
  id: string;
  starts_at: string;
  status: string;
  attendance: string | null;
  services: { name: string; staffName: string | null; price: number; adjustmentNote: string | null }[];
}

export interface ActionHistoryItem {
  id: string;
  type: string;
  suggestion: string;
  reasoning: string;
  status: string;
  outcome: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  fill_gap: "Boşluk Doldurma",
  retention_risk: "Risk Altında Müşteri",
  rhythm_invite: "Ritim Daveti",
  finance_note: "Finans Notu",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Bekliyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  auto_sent: "Otomatik Gönderildi",
};

const ATTENDANCE_LABELS: Record<string, { label: string; tone: "good" | "bad" | "muted" }> = {
  came: { label: "Geldi", tone: "good" },
  no_show_notified: { label: "Haber Verdi", tone: "muted" },
  no_show_silent: { label: "Habersiz", tone: "bad" },
};

export default function MusteriDetayClient({
  customer,
  staffList,
  totalSpent,
  visitCount,
  lastVisitAt,
  badges,
  appointments,
  actionHistory,
}: {
  customer: Customer;
  staffList: { id: string; full_name: string; status: "active" | "inactive" }[];
  totalSpent: number;
  visitCount: number;
  lastVisitAt: string | null;
  badges: { retentionRisk: boolean; rhythmInvite: boolean; frequentNoShow: boolean };
  appointments: AppointmentHistoryItem[];
  actionHistory: ActionHistoryItem[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [preferredStaffId, setPreferredStaffId] = useState(customer.preferred_staff_id ?? "");
  const [saving, setSaving] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveProfile() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || null, preferred_staff_id: preferredStaffId || null }),
      });
      if (res.ok) {
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

  async function toggleActiveStatus() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: customer.status === "active" ? "inactive" : "active" }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError("Durum değiştirilemedi, lütfen tekrar dene.");
      }
    } catch {
      setError("Durum değiştirilemedi, lütfen tekrar dene.");
    } finally {
      setSaving(false);
    }
  }

  async function resolveAction(id: string, status: "approved" | "rejected") {
    setBusyActionId(id);
    try {
      const res = await fetch(`/api/action-objects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyActionId(null);
    }
  }

  const hasAnyBadge = badges.retentionRisk || badges.rhythmInvite || badges.frequentNoShow;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/musteriler" className="text-[13px] text-ink-muted font-semibold">
        ← Müşteriler
      </Link>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold">{customer.full_name}</h1>
          {customer.status === "inactive" && (
            <span className="text-[11px] font-bold text-ink-muted bg-border px-2 py-0.5 rounded-full">Pasif</span>
          )}
        </div>
        <p className="text-sm text-ink-muted">{customer.phone}</p>
      </div>

      {hasAnyBadge && (
        <div className="flex flex-col gap-2">
          {badges.retentionRisk && (
            <Badge tone="accent" text="AI: Risk altında — uzun süredir gelmiyor, bekleyen bir öneri var." />
          )}
          {badges.rhythmInvite && (
            <Badge tone="accent" text="AI: Alışılmış randevu zamanı yaklaşıyor, bekleyen bir davet önerisi var." />
          )}
          {badges.frequentNoShow && (
            <Badge tone="bad" text={`Sık habersiz gelmeme: ${customer.no_show_count} kez`} />
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <StatCard label="Toplam harcama" value={formatTL(totalSpent)} />
        <StatCard label="Ziyaret sayısı" value={String(visitCount)} />
        <StatCard label="Son ziyaret" value={lastVisitAt ? formatDateTR(lastVisitAt) : "—"} small />
      </div>

      <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Profil</p>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-semibold text-ink-muted">Tercih edilen personel</label>
          <select
            value={preferredStaffId ?? ""}
            onChange={(e) => setPreferredStaffId(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-surface"
          >
            <option value="">Belirtilmedi</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
                {s.status === "inactive" ? " (pasif)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-semibold text-ink-muted">Notlar (tercih/alerji vb.)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="border border-border rounded-lg px-3 py-2 text-sm resize-none"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="flex-1 bg-accent text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            Kaydet
          </button>
          <button
            onClick={toggleActiveStatus}
            disabled={saving}
            className="flex-1 border border-border rounded-lg py-2.5 text-sm font-semibold text-ink-muted disabled:opacity-50"
          >
            {customer.status === "active" ? "Pasifleştir" : "Aktifleştir"}
          </button>
        </div>

        {error && <p className="text-[12px] text-bad">{error}</p>}

        {customer.kvkk_consent_at && (
          <p className="text-[11.5px] text-ink-muted">KVKK onayı: {formatDateTR(customer.kvkk_consent_at)}</p>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">AI Öneri Geçmişi</p>
        {actionHistory.length === 0 && (
          <p className="text-[13px] text-ink-muted">Bu müşteri için henüz AI önerisi yok.</p>
        )}
        {actionHistory.map((a) => (
          <div key={a.id} className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-bold text-accent uppercase tracking-wide">
                {TYPE_LABELS[a.type] ?? a.type}
              </span>
              <span className="text-[11px] text-ink-muted">{formatDateTR(a.created_at)}</span>
            </div>
            <p className="text-[13.5px] text-ink">{a.suggestion}</p>
            <p className="text-[12px] text-ink-muted">{a.reasoning}</p>
            <span
              className={`text-[12px] font-semibold ${
                a.status === "pending" ? "text-accent" : a.status === "rejected" ? "text-bad" : "text-good-ink"
              }`}
            >
              {STATUS_LABELS[a.status] ?? a.status}
              {a.outcome ? ` — ${a.outcome}` : ""}
            </span>
            {a.status === "pending" && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => resolveAction(a.id, "approved")}
                  disabled={busyActionId === a.id}
                  className="flex-1 bg-accent text-white rounded-lg py-2 text-[12.5px] font-semibold disabled:opacity-50"
                >
                  Onayla ve Gönder
                </button>
                <button
                  onClick={() => resolveAction(a.id, "rejected")}
                  disabled={busyActionId === a.id}
                  className="flex-1 border border-border rounded-lg py-2 text-[12.5px] font-semibold text-ink-muted disabled:opacity-50"
                >
                  Reddet
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Randevu Geçmişi</p>
        {appointments.length === 0 && <p className="text-[13px] text-ink-muted">Henüz randevu kaydı yok.</p>}
        {appointments.map((a) => {
          const attendance = a.attendance ? ATTENDANCE_LABELS[a.attendance] : null;
          const total = a.services.reduce((s, svc) => s + svc.price, 0);
          return (
            <div key={a.id} className="bg-surface border border-border rounded-2xl p-3.5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold capitalize">
                  {formatDateTR(a.starts_at)}, {formatTimeTR(a.starts_at)}
                </span>
                <span className="text-sm font-semibold font-display">{formatTL(total)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] text-ink-muted truncate">
                  {a.services.map((s) => s.name).join(", ")}
                </p>
                {a.status === "cancelled" ? (
                  <span className="text-[11px] font-bold text-bad shrink-0">İptal</span>
                ) : attendance ? (
                  <span
                    className={`text-[11px] font-bold shrink-0 ${
                      attendance.tone === "good" ? "text-good-ink" : attendance.tone === "bad" ? "text-bad" : "text-ink-muted"
                    }`}
                  >
                    {attendance.label}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-3 flex flex-col gap-1.5">
      <p className={`font-semibold font-display ${small ? "text-[13px]" : "text-[17px]"}`}>{value}</p>
      <p className="text-[11px] text-ink-muted">{label}</p>
    </div>
  );
}

function Badge({ tone, text }: { tone: "accent" | "bad"; text: string }) {
  const cls =
    tone === "accent"
      ? "bg-accent-soft border-accent/30 text-accent-ink"
      : "bg-bad-soft border-bad/30 text-bad-ink";
  return <div className={`border rounded-xl px-3 py-2 text-[12.5px] font-medium ${cls}`}>{text}</div>;
}
