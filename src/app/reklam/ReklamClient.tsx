"use client";

import { useState } from "react";
import { formatDateTR } from "@/lib/date";

export interface ReklamItem {
  id: string;
  typeLabel: string;
  suggestion: string;
  createdAt: string;
}

function ReklamCard({ item, onDeleted }: { item: ReklamItem; onDeleted: (id: string) => void }) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageUrl = `/api/reklam/${item.id}/image`;

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error("failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `randevu-ai-${item.id}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Görsel indirilemedi, lütfen tekrar dene.");
    } finally {
      setDownloading(false);
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(item.suggestion);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Metin kopyalanamadı.");
    }
  }

  async function deleteItem() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reklam/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      onDeleted(item.id);
    } catch {
      setError("Silinemedi, lütfen tekrar dene.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-accent2-ink bg-accent2-soft px-2.5 py-1 rounded-full uppercase tracking-wide">
          {item.typeLabel}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-ink-muted">{formatDateTR(item.createdAt)}</span>
          <button
            onClick={deleteItem}
            disabled={deleting}
            aria-label="Sil"
            onBlur={() => setConfirmingDelete(false)}
            className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
              confirmingDelete ? "bg-bad text-white" : "text-ink-muted hover:bg-bg"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0v12a1 1 0 001 1h6a1 1 0 001-1V7" />
            </svg>
          </button>
        </div>
      </div>
      {confirmingDelete && !deleting && <p className="text-[11.5px] text-bad -mt-1">Emin misin? Tekrar bas.</p>}

      {/* eslint-disable-next-line @next/next/no-img-element -- Satori PNG rotası, next/image optimizasyonuna uygun değil */}
      <img
        src={imageUrl}
        alt={item.suggestion}
        className="w-full aspect-[9/16] object-cover rounded-xl border border-border bg-bg"
        loading="lazy"
      />

      <p className="text-[13px] text-ink leading-relaxed">{item.suggestion}</p>

      {error && <p className="text-[12px] text-bad">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={download}
          disabled={downloading}
          className="flex-1 bg-accent-ink text-white rounded-lg py-2.5 text-[12.5px] font-semibold disabled:opacity-50"
        >
          {downloading ? "İndiriliyor..." : "Görseli İndir"}
        </button>
        <button
          onClick={copyCaption}
          className="flex-1 border border-border rounded-lg py-2.5 text-[12.5px] font-semibold text-ink-muted"
        >
          {copied ? "Kopyalandı ✓" : "Metni Kopyala"}
        </button>
      </div>
    </div>
  );
}

export default function ReklamClient({ items }: { items: ReklamItem[] }) {
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const visible = items.filter((item) => !deletedIds.has(item.id));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {visible.map((item) => (
        <ReklamCard key={item.id} item={item} onDeleted={(id) => setDeletedIds((prev) => new Set([...prev, id]))} />
      ))}
    </div>
  );
}
