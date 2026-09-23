import Link from "next/link";

interface ParsedBrief {
  headline: string;
  facts: string[];
  recommendation: string | null;
}

/** nightlySummary.ts'in yazdığı biçimi ayrıştırır; eski tek satırlık notlar başlık olarak gösterilir. */
function parseBrief(text: string): ParsedBrief {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const facts = lines.filter((l) => l.startsWith("• ")).map((l) => l.slice(2));
  const recLine = lines.find((l) => l.startsWith("Öneri:"));
  const headline = lines.find((l) => !l.startsWith("• ") && !l.startsWith("Öneri:")) ?? text;
  return { headline, facts, recommendation: recLine ? recLine.slice("Öneri:".length).trim() : null };
}

const ASK_ABOUT_BRIEF = "Dünkü finans özetimi yorumla ve bugün cirom için ne yapmam gerektiğini somut olarak söyle.";

export default function FinanceBrief({ note }: { note: string }) {
  const brief = parseBrief(note);

  return (
    <div className="flex flex-col gap-3 pt-3.5 border-t border-border">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-bold text-accent uppercase tracking-wide">Günlük Finans Özeti</p>
        <span className="text-[11px] font-semibold text-ink-muted bg-accent-soft rounded-full px-2 py-0.5">Dün</span>
      </div>

      <p className="text-[14.5px] font-semibold text-ink leading-snug">{brief.headline}</p>

      {brief.facts.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {brief.facts.map((fact) => (
            <li key={fact} className="flex gap-2 text-[12.5px] text-ink-muted leading-snug">
              <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-accent/50 shrink-0" />
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      )}

      {brief.recommendation && (
        <div className="bg-accent2-soft rounded-xl px-3.5 py-3 flex flex-col gap-1">
          <p className="text-[11px] font-bold text-accent2-ink/70 uppercase tracking-wide">Bugün için öneri</p>
          <p className="text-[13px] text-accent2-ink leading-snug">{brief.recommendation}</p>
        </div>
      )}

      <Link
        href={`/asistan?q=${encodeURIComponent(ASK_ABOUT_BRIEF)}`}
        className="self-start text-[12.5px] font-bold text-accent flex items-center gap-1"
      >
        Danışmanla derinleştir
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>
    </div>
  );
}
