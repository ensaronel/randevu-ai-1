"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SuggestionItem {
  id: string;
  type: string;
  suggestion: string;
  reasoning: string;
}

const TYPE_LABELS: Record<string, string> = {
  fill_gap: "Boşluk Doldurma",
  retention_risk: "Risk Altında Müşteri",
  rhythm_invite: "Ritim Daveti",
};

export default function SuggestionsClient({ items }: { items: SuggestionItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  async function resolve(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/action-objects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setResolvedIds((prev) => new Set(prev).add(id));
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  const visible = items.filter((item) => !resolvedIds.has(item.id));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Öneriler</p>
      {visible.map((item) => (
        <div key={item.id} className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2">
          <span className="text-[11.5px] font-bold text-accent uppercase tracking-wide">
            {TYPE_LABELS[item.type] ?? item.type}
          </span>
          <p className="text-[13.5px] text-ink">{item.suggestion}</p>
          <p className="text-[12px] text-ink-muted">{item.reasoning}</p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => resolve(item.id, "approved")}
              disabled={busyId === item.id}
              className="flex-1 bg-accent text-white rounded-lg py-2 text-[12.5px] font-semibold disabled:opacity-50"
            >
              Onayla ve Gönder
            </button>
            <button
              onClick={() => resolve(item.id, "rejected")}
              disabled={busyId === item.id}
              className="flex-1 border border-border rounded-lg py-2 text-[12.5px] font-semibold text-ink-muted disabled:opacity-50"
            >
              Reddet
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
