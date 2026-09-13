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

export interface DailySurveyItem {
  id: string;
  suggestion: string;
}

/** retention_risk/rhythm_invite'ın kısa özeti - grup kartında müşteri adının yanında görünür. */
function shortReason(item: SuggestionItem): string {
  const match = item.reasoning.match(/(\d+) gün geçti|(\d+) gün içinde doluyor/);
  if (item.type === "retention_risk") return match ? `${match[1]} gündür gelmedi` : "bir süredir gelmedi";
  if (item.type === "rhythm_invite") return "randevu zamanı yaklaşıyor";
  return item.reasoning;
}

function IconCircle({ tone, children }: { tone: "risk" | "survey"; children: React.ReactNode }) {
  const toneClass = tone === "risk" ? "bg-block1 text-block1-ink" : "bg-good-soft text-good-ink";
  return (
    <div className={`${toneClass} w-9 h-9 rounded-full flex items-center justify-center shrink-0`}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </div>
  );
}

export default function SuggestionsClient({
  items,
  dailySurvey,
}: {
  items: SuggestionItem[];
  dailySurvey: DailySurveyItem | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"risk" | "survey" | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [surveyResolved, setSurveyResolved] = useState(false);
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

  async function resolveRisk(ids: string[], status: "approved" | "rejected") {
    setBusy("risk");
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
      setBusy(null);
    }
  }

  async function resolveSurvey(status: "approved" | "rejected") {
    if (!dailySurvey) return;
    setBusy("survey");
    setError(null);
    try {
      await resolveOne(dailySurvey.id, status);
      setSurveyResolved(true);
      router.refresh();
    } catch {
      setError("Anket işlemi yapılamadı, lütfen tekrar dene.");
    } finally {
      setBusy(null);
    }
  }

  const visibleRisk = items.filter((item) => !resolvedIds.has(item.id));
  const showSurvey = dailySurvey && !surveyResolved;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide">Öneriler</p>
      {error && <p className="text-[12px] text-bad">{error}</p>}

      {visibleRisk.length === 0 && !showSurvey && (
        <p className="text-[13px] text-ink-muted bg-surface border border-border rounded-2xl p-4">
          Şu an bekleyen öneri yok — AI, uzun süredir gelmeyen bir müşteri fark ettiğinde ya da gün
          sonunda anket önerisi hazırladığında burada çıkacak.
        </p>
      )}

      {visibleRisk.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4 lg:p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <IconCircle tone="risk">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 8v4.5M12 15.5v.01" />
            </IconCircle>
            <div>
              <p className="text-[14px] font-bold font-display text-ink">Risk Altında Müşteriler</p>
              <p className="text-[11.5px] text-ink-muted">{visibleRisk.length} müşteri bir süredir gelmedi</p>
            </div>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {visibleRisk.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 text-[13px] py-2 first:pt-0 last:pb-0">
                <span className="text-ink font-medium truncate">{item.customer_name ?? "Müşteri"}</span>
                <span className="text-[12px] text-ink-muted shrink-0">{shortReason(item)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => resolveRisk(visibleRisk.map((i) => i.id), "approved")}
              disabled={busy !== null}
              className="flex-1 bg-block1-ink text-white rounded-lg py-2.5 text-[12.5px] font-semibold disabled:opacity-50"
            >
              Hepsine Gönder
            </button>
            <button
              onClick={() => resolveRisk(visibleRisk.map((i) => i.id), "rejected")}
              disabled={busy !== null}
              className="flex-1 border border-border rounded-lg py-2.5 text-[12.5px] font-semibold text-ink-muted disabled:opacity-50"
            >
              Hepsini Reddet
            </button>
          </div>
        </div>
      )}

      {showSurvey && dailySurvey && (
        <div className="bg-surface border border-border rounded-2xl p-4 lg:p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <IconCircle tone="survey">
              <path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8A2.5 2.5 0 0117.5 16H10l-4 4v-4H6.5A2.5 2.5 0 014 13.5z" />
            </IconCircle>
            <div>
              <p className="text-[14px] font-bold font-display text-ink">Günlük Değerlendirme Anketi</p>
              <p className="text-[11.5px] text-ink-muted">Bugün gelen müşterilere WhatsApp&apos;tan gönderilir</p>
            </div>
          </div>
          <p className="text-[13px] text-ink-muted leading-relaxed">{dailySurvey.suggestion}</p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => resolveSurvey("approved")}
              disabled={busy !== null}
              className="flex-1 bg-good-ink text-white rounded-lg py-2.5 text-[12.5px] font-semibold disabled:opacity-50"
            >
              Gönder
            </button>
            <button
              onClick={() => resolveSurvey("rejected")}
              disabled={busy !== null}
              className="flex-1 border border-border rounded-lg py-2.5 text-[12.5px] font-semibold text-ink-muted disabled:opacity-50"
            >
              Bugün Gönderme
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
