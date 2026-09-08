"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatTL, formatTimeTR } from "@/lib/date";
import { colorForStaffIndex } from "@/lib/serviceColors";

type OneOrMany<T> = T | T[] | null;

function one<T>(value: OneOrMany<T>): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Türkçe para girişini (binlik ayraç "." + ondalık ayraç ",") sayıya çevirir.
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

export interface TakvimAppointment {
  id: string;
  starts_at: string;
  customer: OneOrMany<{ full_name: string; phone: string }>;
  appointment_services: {
    id: string;
    staff_id: string;
    planned_price: number;
    final_price: number | null;
    adjustment_note: string | null;
    service: OneOrMany<{ name: string; duration_minutes: number }>;
  }[];
}

export default function TakvimAppointmentBlocks({
  appointments,
  staffIds,
  startUtc,
  gridStartHour,
  gridMinutes,
}: {
  appointments: TakvimAppointment[];
  staffIds: string[];
  startUtc: string;
  gridStartHour: number;
  gridMinutes: number;
}) {
  const router = useRouter();
  const [openApptId, setOpenApptId] = useState<string | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const openAppt = appointments.find((a) => a.id === openApptId) ?? null;

  async function savePrice(serviceRowId: string) {
    const value = parseTLInput(priceDraft);
    if (Number.isNaN(value) || value < 0) return;

    setSaving(true);
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
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-1" style={{ position: "relative", height: gridMinutes, gap: 8 }}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 60px)",
          }}
        />

        {staffIds.map((staffId, staffIndex) => {
          const color = colorForStaffIndex(staffIndex);
          return (
            <div key={staffId} className="relative flex-1" style={{ minWidth: 130, height: gridMinutes }}>
              {appointments.flatMap((appt) => {
                const startMinutes =
                  (new Date(appt.starts_at).getTime() - new Date(startUtc).getTime()) / 60000 - gridStartHour * 60;

                return appt.appointment_services
                  .filter((svc) => svc.staff_id === staffId)
                  .map((svc, i) => {
                    const service = one(svc.service);
                    if (!service) return null;
                    const customer = one(appt.customer);
                    const blockHeight = Math.max(26, service.duration_minutes - 4);

                    return (
                      <button
                        key={`${appt.id}-${i}`}
                        onClick={() => setOpenApptId(appt.id)}
                        className="absolute rounded-xl px-2 py-1.5 text-[11px] leading-tight overflow-hidden shadow-sm text-left"
                        style={{
                          top: startMinutes,
                          height: blockHeight,
                          left: 3,
                          right: 3,
                          background: color.bg,
                          color: color.text,
                        }}
                      >
                        <span className="font-bold flex items-center gap-1.5 truncate">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color.border }} />
                          {customer?.full_name ?? "Müşteri"}
                        </span>
                        {blockHeight >= 40 && (
                          <span className="block truncate opacity-85 pl-3">{service.name}</span>
                        )}
                      </button>
                    );
                  });
              })}
            </div>
          );
        })}
      </div>

      {openAppt && (
        <div
          className="fixed inset-0 z-30 bg-black/40 flex items-end lg:items-center justify-center"
          onClick={() => setOpenApptId(null)}
        >
          <div
            className="bg-surface rounded-t-3xl lg:rounded-3xl w-full lg:w-[420px] max-h-[80vh] overflow-y-auto p-5 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-[15px]">{one(openAppt.customer)?.full_name ?? "Müşteri"}</p>
                <p className="text-[12.5px] text-ink-muted">
                  {formatTimeTR(openAppt.starts_at)}
                  {one(openAppt.customer)?.phone ? ` · ${one(openAppt.customer)?.phone}` : ""}
                </p>
              </div>
              <button onClick={() => setOpenApptId(null)} aria-label="Kapat" className="text-ink-muted">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              {openAppt.appointment_services.map((svc) => {
                const service = one(svc.service);
                const isEditing = editingServiceId === svc.id;
                const currentPrice = svc.final_price ?? svc.planned_price;
                return (
                  <div key={svc.id} className="flex flex-col gap-1 border border-border rounded-xl p-2.5">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-ink-muted">{service?.name}</span>
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
                            disabled={saving}
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
        </div>
      )}
    </>
  );
}
