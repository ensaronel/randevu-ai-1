"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DailySurveyClient({ id, suggestion }: { id: string; suggestion: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function resolve(status: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/action-objects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError("İşlem yapılamadı, lütfen tekrar dene.");
      }
    } catch {
      setError("İşlem yapılamadı, lütfen tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <div className="bg-block2 border border-block2-ink/20 rounded-2xl p-4 flex flex-col gap-2">
      <p className="text-[12.5px] font-bold text-block2-ink uppercase tracking-wide">Günlük Anket</p>
      <p className="text-[13.5px] text-ink leading-relaxed">{suggestion}</p>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => resolve("approved")}
          disabled={busy}
          className="flex-1 bg-block2-ink text-white rounded-lg py-2 text-[12.5px] font-semibold disabled:opacity-50"
        >
          Gönder
        </button>
        <button
          onClick={() => resolve("rejected")}
          disabled={busy}
          className="flex-1 border border-border rounded-lg py-2 text-[12.5px] font-semibold text-ink-muted disabled:opacity-50"
        >
          Bugün Gönderme
        </button>
      </div>
      {error && <p className="text-[12px] text-bad">{error}</p>}
    </div>
  );
}
