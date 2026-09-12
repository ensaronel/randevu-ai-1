"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SuggestionItem {
  id: string;
  type: string;
  suggestion: string;
  customer_message: string | null;
  reasoning: string;
  customer_name: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  fill_gap: "Boşluk Doldurma",
  retention_risk: "Risk Altında Müşteri",
  rhythm_invite: "Ritim Daveti",
};

/** retention_risk/rhythm_invite'ın kısa özeti - grup kartında müşteri adının yanında görünür. */
function shortReason(item: SuggestionItem): string {
  const match = item.reasoning.match(/(\d+) gün geçti|(\d+) gün içinde doluyor/);
  if (item.type === "retention_risk") return match ? `${match[1]} gündür gelmedi` : "bir süredir gelmedi";
  if (item.type === "rhythm_invite") return "randevu zamanı yaklaşıyor";
  return item.reasoning;
}

export default function SuggestionsClient({ items }: { items: SuggestionItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function resolveOne(id: string, status: "approved" | "rejected") {
    const res = await fetch(`/api/action-objects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error("failed");
    return id;
  }

  async function resolveMany(ids: string[], status: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.allSettled(ids.map((id) => resolveOne(id, status)));
      const succeeded = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);
      if (succeeded.length > 0) {
        setResolvedIds((prev) => new Set([...prev, ...succeeded]));
        router.refresh();
      }
      if (succeeded.length < ids.length) {
        setError("Bazı müşteriler için işlem yapılamadı, lütfen tekrar dene.");
      }
    } finally {
      setBusy(false);
    }
  }

  const visible = items.filter((item) => !resolvedIds.has(item.id));
  const fillGaps = visible.filter((item) => item.type === "fill_gap");
  const batchable = visible.filter((item) => item.type === "retention_risk" || item.type === "rhythm_invite");

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Öneriler</p>
      {error && <p className="text-[12px] text-bad">{error}</p>}
      {visible.length === 0 && (
        <p className="text-[13px] text-ink-muted bg-surface border border-border rounded-2xl p-4">
          Şu an bekleyen öneri yok — AI, boşalan randevuları bekleme listesindekilerle eşleştirdiğinde veya
          uzun süredir gelmeyen bir müşteri fark ettiğinde burada bir öneri kartı olarak çıkacak.
        </p>
      )}

      {batchable.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2">
          <span className="text-[11.5px] font-bold text-accent uppercase tracking-wide">
            {batchable.length} müşteri bir süredir gelmedi ya da randevu zamanı geldi
          </span>
          <div className="flex flex-col gap-1">
            {batchable.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="text-ink truncate">{item.customer_name ?? "Müşteri"}</span>
                <span className="text-[12px] text-ink-muted shrink-0">{shortReason(item)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => resolveMany(batchable.map((i) => i.id), "approved")}
              disabled={busy}
              className="flex-1 bg-accent text-white rounded-lg py-2 text-[12.5px] font-semibold disabled:opacity-50"
            >
              Hepsini Onayla ve Gönder
            </button>
            <button
              onClick={() => resolveMany(batchable.map((i) => i.id), "rejected")}
              disabled={busy}
              className="flex-1 border border-border rounded-lg py-2 text-[12.5px] font-semibold text-ink-muted disabled:opacity-50"
            >
              Hepsini Reddet
            </button>
          </div>
        </div>
      )}

      {fillGaps.map((item) => (
        <div key={item.id} className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2">
          <span className="text-[11.5px] font-bold text-accent uppercase tracking-wide">
            {TYPE_LABELS[item.type] ?? item.type}
          </span>
          <p className="text-[13.5px] text-ink">{item.suggestion}</p>
          <p className="text-[12px] text-ink-muted">{item.reasoning}</p>
          {item.customer_message && (
            <p className="text-[12.5px] text-ink-muted italic border-l-2 border-border pl-2.5">
              &quot;{item.customer_message}&quot;
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => resolveMany([item.id], "approved")}
              disabled={busy}
              className="flex-1 bg-accent text-white rounded-lg py-2 text-[12.5px] font-semibold disabled:opacity-50"
            >
              Onayla ve Gönder
            </button>
            <button
              onClick={() => resolveMany([item.id], "rejected")}
              disabled={busy}
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
