"use client";

import { useState } from "react";
import type { Business, Payment } from "@/types/database";
import { formatTL } from "@/lib/date";

type Owner = { full_name: string; phone: string | null; email: string | null };

type BusinessRow = Pick<
  Business,
  | "id"
  | "name"
  | "package"
  | "subscription_status"
  | "voice_number_mode"
  | "business_own_number"
  | "twilio_number"
  | "whatsapp_twilio_number"
  | "whatsapp_phone_number_id"
  | "monthly_price_tl"
  | "next_payment_due_date"
  | "created_at"
> & {
  owner: Owner | null;
  payments: Payment[];
};

type Summary = {
  totalRevenueTl: number;
  monthRevenueTl: number;
  activeCount: number;
  pendingCount: number;
  suspendedCount: number;
};

function formatPaymentDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Istanbul",
  });
}

const METHOD_LABELS: Record<string, string> = { eft: "EFT", nakit: "Nakit" };

function formatDueDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Istanbul",
  });
}

function isOverdue(dateKey: string): boolean {
  return dateKey < new Date().toISOString().slice(0, 10);
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Ödeme bekleniyor",
  active: "Aktif",
  suspended: "Askıda",
};

const STATUS_STYLES: Record<string, string> = {
  pending_payment: "bg-warn-soft text-warn-ink",
  active: "bg-good-soft text-good-ink",
  suspended: "bg-bad-soft text-bad-ink",
};

export default function AdminClient({ businesses: initial, summary }: { businesses: BusinessRow[]; summary: Summary }) {
  const [businesses, setBusinesses] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ email: string; password: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewError, setRenewError] = useState<string | null>(null);
  const [expandedPaymentsId, setExpandedPaymentsId] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [pkg, setPkg] = useState<"whatsapp_only" | "whatsapp_and_voice">("whatsapp_only");
  const [voiceMode, setVoiceMode] = useState<"existing_forwarded" | "twilio_new">("existing_forwarded");
  const [businessOwnNumber, setBusinessOwnNumber] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setLastCreated(null);
    try {
      const res = await fetch("/api/admin/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: businessName,
          owner_full_name: ownerFullName,
          owner_email: ownerEmail,
          owner_phone: ownerPhone || undefined,
          package: pkg,
          voice_number_mode: pkg === "whatsapp_and_voice" ? voiceMode : undefined,
          business_own_number: voiceMode === "existing_forwarded" ? businessOwnNumber : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCreateError(json.message ?? json.error ?? "Bilinmeyen hata");
        return;
      }
      const createdOwner: Owner = {
        full_name: json.data.owner.full_name,
        phone: json.data.owner.phone,
        email: json.data.login_email,
      };
      setBusinesses((prev) => [{ ...json.data.business, owner: createdOwner, payments: [] }, ...prev]);
      setLastCreated({ email: json.data.login_email, password: json.data.temp_password });
      setBusinessName("");
      setOwnerFullName("");
      setOwnerEmail("");
      setOwnerPhone("");
      setBusinessOwnNumber("");
      setShowForm(false);
    } catch {
      setCreateError("Sunucuya ulaşılamadı");
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmPayment(id: string, method: "eft" | "nakit") {
    setConfirmingId(id);
    setConfirmError(null);
    try {
      const res = await fetch(`/api/admin/businesses/${id}/confirm-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const json = await res.json();
      if (!res.ok) {
        setConfirmError(json.message ?? json.error ?? "Bilinmeyen hata");
        return;
      }
      const { business, payment } = json.data as { business: Partial<BusinessRow>; payment: Payment };
      setBusinesses((prev) =>
        prev.map((b) => (b.id === id ? { ...b, ...business, payments: [payment, ...b.payments] } : b))
      );
    } catch {
      setConfirmError("Sunucuya ulaşılamadı");
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleConfirmRenewal(id: string, method: "eft" | "nakit") {
    setRenewingId(id);
    setRenewError(null);
    try {
      const res = await fetch(`/api/admin/businesses/${id}/confirm-renewal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRenewError(json.message ?? json.error ?? "Bilinmeyen hata");
        return;
      }
      const { business, payment } = json.data as { business: Partial<BusinessRow>; payment: Payment };
      setBusinesses((prev) =>
        prev.map((b) => (b.id === id ? { ...b, ...business, payments: [payment, ...b.payments] } : b))
      );
    } catch {
      setRenewError("Sunucuya ulaşılamadı");
    } finally {
      setRenewingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-surface border border-border p-3">
          <p className="text-xs text-ink-muted mb-1">Bu Ay Tahsilat</p>
          <p className="text-lg font-semibold text-ink">{formatTL(summary.monthRevenueTl)}</p>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3">
          <p className="text-xs text-ink-muted mb-1">Toplam Tahsilat</p>
          <p className="text-lg font-semibold text-ink">{formatTL(summary.totalRevenueTl)}</p>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3">
          <p className="text-xs text-ink-muted mb-1">Aktif / Bekleyen</p>
          <p className="text-lg font-semibold text-ink">
            {summary.activeCount} / {summary.pendingCount}
          </p>
        </div>
        <div className="rounded-xl bg-surface border border-border p-3">
          <p className="text-xs text-ink-muted mb-1">Askıda</p>
          <p className={`text-lg font-semibold ${summary.suspendedCount > 0 ? "text-bad-ink" : "text-ink"}`}>
            {summary.suspendedCount}
          </p>
        </div>
      </div>

      {lastCreated && (
        <div className="rounded-xl bg-good-soft text-good-ink p-4 text-sm">
          <p className="font-medium mb-1">İşletme oluşturuldu — giriş bilgilerini müşteriye ilet:</p>
          <p>
            E-posta: <span className="font-mono">{lastCreated.email}</span>
          </p>
          <p>
            Geçici şifre: <span className="font-mono">{lastCreated.password}</span>
          </p>
          <p className="mt-1 text-xs opacity-80">Bu şifre sadece burada gösteriliyor, tekrar göremeyeceksin.</p>
        </div>
      )}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-xl bg-accent text-accent-ink py-3 font-medium"
        >
          + Yeni İşletme Ekle
        </button>
      ) : (
        <form onSubmit={handleCreate} className="rounded-xl bg-surface border border-border p-4 space-y-3">
          <h2 className="font-medium text-ink">Yeni İşletme</h2>
          <input
            required
            placeholder="İşletme adı"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Sahibinin adı soyadı"
            value={ownerFullName}
            onChange={(e) => setOwnerFullName(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            placeholder="Sahibinin e-postası (giriş için)"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
          <input
            placeholder="Sahibinin telefonu (opsiyonel)"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />

          <div>
            <p className="text-sm text-ink-muted mb-1">Paket</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPkg("whatsapp_only")}
                className={`flex-1 rounded-lg py-2 text-sm border ${pkg === "whatsapp_only" ? "bg-accent text-accent-ink border-accent" : "border-border text-ink"}`}
              >
                Sadece WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setPkg("whatsapp_and_voice")}
                className={`flex-1 rounded-lg py-2 text-sm border ${pkg === "whatsapp_and_voice" ? "bg-accent text-accent-ink border-accent" : "border-border text-ink"}`}
              >
                WhatsApp + Sesli
              </button>
            </div>
          </div>

          {pkg === "whatsapp_and_voice" && (
            <div>
              <p className="text-sm text-ink-muted mb-1">Sesli arama numarası</p>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setVoiceMode("existing_forwarded")}
                  className={`flex-1 rounded-lg py-2 text-sm border ${voiceMode === "existing_forwarded" ? "bg-accent text-accent-ink border-accent" : "border-border text-ink"}`}
                >
                  Mevcut numarasını yönlendir
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceMode("twilio_new")}
                  className={`flex-1 rounded-lg py-2 text-sm border ${voiceMode === "twilio_new" ? "bg-accent text-accent-ink border-accent" : "border-border text-ink"}`}
                >
                  Yeni numara ver
                </button>
              </div>
              {voiceMode === "existing_forwarded" && (
                <input
                  required
                  placeholder="İşletmenin mevcut numarası (ör. 0532 xxx xx xx)"
                  value={businessOwnNumber}
                  onChange={(e) => setBusinessOwnNumber(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              )}
            </div>
          )}

          {createError && <p className="text-sm text-bad-ink">{createError}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="flex-1 rounded-lg bg-accent text-accent-ink py-2 text-sm font-medium disabled:opacity-50"
            >
              {creating ? "Oluşturuluyor…" : "Oluştur"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-ink"
            >
              Vazgeç
            </button>
          </div>
        </form>
      )}

      {confirmError && <p className="text-sm text-bad-ink">{confirmError}</p>}
      {renewError && <p className="text-sm text-bad-ink">{renewError}</p>}

      <div className="space-y-3">
        {businesses.map((b) => {
          const overdue = !!b.next_payment_due_date && isOverdue(b.next_payment_due_date) && b.subscription_status !== "pending_payment";
          return (
          <div key={b.id} className="rounded-xl bg-surface border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-ink">{b.name}</span>
              <span className={`text-xs rounded-full px-2 py-1 ${STATUS_STYLES[b.subscription_status]}`}>
                {STATUS_LABELS[b.subscription_status]}
              </span>
            </div>
            {b.owner && (
              <p className="text-xs text-ink-muted">
                Sahibi: {b.owner.full_name}
                {b.owner.phone && ` — ${b.owner.phone}`}
                {b.owner.email && ` — ${b.owner.email}`}
              </p>
            )}
            <p className="text-xs text-ink-muted">
              Paket: {b.package === "whatsapp_and_voice" ? "WhatsApp + Sesli" : b.package === "whatsapp_only" ? "Sadece WhatsApp" : "-"}
              {b.monthly_price_tl != null && ` — ${formatTL(b.monthly_price_tl)}/ay`}
            </p>
            {b.voice_number_mode && (
              <p className="text-xs text-ink-muted">
                Sesli numara:{" "}
                {b.voice_number_mode === "existing_forwarded"
                  ? `${b.business_own_number ?? "-"} (kendi numarası, ${b.twilio_number ? "yönlendirme hedefi hazır" : "henüz sağlanmadı"})`
                  : b.twilio_number ?? "henüz sağlanmadı"}
              </p>
            )}
            <p className="text-xs text-ink-muted">
              WhatsApp:{" "}
              {b.whatsapp_phone_number_id
                ? "bağlı"
                : b.whatsapp_twilio_number
                  ? `${b.whatsapp_twilio_number} (numara alındı, Meta Business Manager'da kayıt bekliyor)`
                  : "henüz numara alınmadı"}
            </p>
            {b.next_payment_due_date && (
              <p className={`text-xs mt-1 ${overdue ? "text-bad-ink font-medium" : "text-ink-muted"}`}>
                {overdue ? "Vadesi geçti: " : "Sonraki ödeme vadesi: "}
                {formatDueDate(b.next_payment_due_date)}
              </p>
            )}

            {b.payments.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => setExpandedPaymentsId((prev) => (prev === b.id ? null : b.id))}
                  className="text-xs text-accent font-medium"
                >
                  {expandedPaymentsId === b.id ? "Ödeme geçmişini gizle" : `Ödeme geçmişi (${b.payments.length})`}
                </button>
                {expandedPaymentsId === b.id && (
                  <div className="mt-2 rounded-lg bg-bg border border-border divide-y divide-border">
                    {b.payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <span className="text-ink">{formatPaymentDate(p.created_at)}</span>
                        <span className="text-ink-muted">{METHOD_LABELS[p.method] ?? p.method}</span>
                        <span className="font-medium text-ink">{formatTL(p.amount_tl)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {b.subscription_status === "pending_payment" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleConfirmPayment(b.id, "eft")}
                  disabled={confirmingId === b.id}
                  className="flex-1 rounded-lg bg-good text-good-ink py-2 text-sm font-medium disabled:opacity-50"
                >
                  {confirmingId === b.id ? "İşleniyor…" : "EFT ile Onayla"}
                </button>
                <button
                  onClick={() => handleConfirmPayment(b.id, "nakit")}
                  disabled={confirmingId === b.id}
                  className="flex-1 rounded-lg bg-good text-good-ink py-2 text-sm font-medium disabled:opacity-50"
                >
                  {confirmingId === b.id ? "İşleniyor…" : "Nakit ile Onayla"}
                </button>
              </div>
            )}

            {(b.subscription_status === "active" || b.subscription_status === "suspended") && (
              <div className="mt-3">
                <p className="text-xs text-ink-muted mb-1">Bu ayın ödemesini onayla:</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirmRenewal(b.id, "eft")}
                    disabled={renewingId === b.id}
                    className="flex-1 rounded-lg border border-good text-good-ink py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {renewingId === b.id ? "İşleniyor…" : "EFT Geldi"}
                  </button>
                  <button
                    onClick={() => handleConfirmRenewal(b.id, "nakit")}
                    disabled={renewingId === b.id}
                    className="flex-1 rounded-lg border border-good text-good-ink py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {renewingId === b.id ? "İşleniyor…" : "Nakit Geldi"}
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
