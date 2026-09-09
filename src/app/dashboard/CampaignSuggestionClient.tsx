"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CampaignSuggestionClient({
  id,
  message,
  reasoning,
}: {
  id: string;
  message: string;
  reasoning: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // pano izni olmayan tarayıcılarda sessizce yok say - buton yine de metni gösteriyor
    }
  }

  async function dismiss() {
    setDismissing(true);
    try {
      const res = await fetch(`/api/action-objects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div className="bg-accent2-soft border border-accent2/30 rounded-2xl p-4 lg:p-5 flex flex-col gap-2">
      <p className="text-[12.5px] font-bold text-accent2-ink uppercase tracking-wide">Kampanya Önerisi</p>
      <p className="text-[13.5px] text-ink leading-relaxed">{message}</p>
      <p className="text-[12px] text-ink-muted">{reasoning}</p>
      <p className="text-[11.5px] text-ink-muted italic">
        Bu metin otomatik gönderilmez — kopyalayıp kendi WhatsApp Business hesabınızdan iletebilirsiniz.
      </p>
      <div className="flex gap-2 pt-1">
        <button
          onClick={copy}
          className="flex-1 bg-accent2-ink text-white rounded-lg py-2 text-[12.5px] font-semibold"
        >
          {copied ? "Kopyalandı ✓" : "Kopyala"}
        </button>
        <button
          onClick={dismiss}
          disabled={dismissing}
          className="flex-1 border border-border rounded-lg py-2 text-[12.5px] font-semibold text-ink-muted disabled:opacity-50"
        >
          Kapat
        </button>
      </div>
    </div>
  );
}
