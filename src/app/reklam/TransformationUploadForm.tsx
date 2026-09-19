"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

function PhotoPicker({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = file ? URL.createObjectURL(file) : null;

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="flex-1 aspect-[3/4] rounded-xl border border-dashed border-border bg-bg flex flex-col items-center justify-center gap-1.5 overflow-hidden relative"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- yerel önizleme, next/image gerekmiyor
        <img src={previewUrl} alt={label} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10.5" r="1.8" />
            <path d="M21 16l-5.5-5.5L6 19" />
          </svg>
          <span className="text-[12px] font-semibold text-ink-muted">{label}</span>
        </>
      )}
    </button>
  );
}

export default function TransformationUploadForm() {
  const router = useRouter();
  const [before, setBefore] = useState<File | null>(null);
  const [after, setAfter] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const canSubmit = before && after && consent && !busy;

  async function submit() {
    if (!before || !after) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("before", before);
      form.append("after", after);
      if (note.trim()) form.append("note", note.trim());

      const res = await fetch("/api/reklam/donusum", { method: "POST", body: form });
      if (!res.ok) throw new Error("failed");

      setBefore(null);
      setAfter(null);
      setNote("");
      setConsent(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Oluşturulamadı, lütfen tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-accent2 text-white rounded-2xl p-4 flex items-center justify-center gap-2 text-[14px] font-bold"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Öncesi/Sonrası Paylaşım Oluştur
      </button>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-bold font-display text-ink">Öncesi/Sonrası Paylaşım</p>
        <button onClick={() => setOpen(false)} className="text-ink-muted text-[12.5px] font-semibold">
          Vazgeç
        </button>
      </div>

      <div className="flex gap-3">
        <PhotoPicker label="Öncesi fotoğrafı" file={before} onChange={setBefore} />
        <PhotoPicker label="Sonrası fotoğrafı" file={after} onChange={setAfter} />
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="İsteğe bağlı not (ör. saç boyama, sakal tıraşı...)"
        maxLength={200}
        className="bg-bg border border-border rounded-lg px-3 py-2.5 text-[13px]"
      />

      <label className="flex items-start gap-2 text-[12px] text-ink-muted leading-relaxed">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        Bu fotoğrafları paylaşım içeriği oluşturmak için kullanmaya (müşteriden gerekli izni aldığımı beyan ederek) onay veriyorum.
      </label>

      {error && <p className="text-[12px] text-bad">{error}</p>}

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="bg-accent2-ink text-white rounded-lg py-2.5 text-[12.5px] font-semibold disabled:opacity-50"
      >
        {busy ? "Oluşturuluyor..." : "AI ile Oluştur"}
      </button>
    </div>
  );
}
