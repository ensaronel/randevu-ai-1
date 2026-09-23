import Link from "next/link";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadInsightsDataset } from "@/lib/businessInsights";
import { buildPulse, type BusinessPulse, type Opportunity, type OpportunityIcon, type OpportunityTone } from "@/lib/opportunities";
import { formatTL } from "@/lib/date";

const TONE_STYLES: Record<OpportunityTone, { circle: string; chip: string }> = {
  good: { circle: "bg-good-soft text-good-ink", chip: "bg-good-soft text-good-ink" },
  warn: { circle: "bg-warn-soft text-warn-ink", chip: "bg-warn-soft text-warn-ink" },
  info: { circle: "bg-accent-soft text-accent", chip: "bg-accent-soft text-accent" },
};

function OpportunityIconSvg({ name }: { name: OpportunityIcon }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "users":
    case "team":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
        </svg>
      );
    case "ticket":
      return (
        <svg {...common}>
          <path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3z" />
          <path d="M13 6v12" strokeDasharray="2 3" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "trend":
      return (
        <svg {...common}>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M14 7h7v7" />
        </svg>
      );
    case "scissors":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" />
          <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
        </svg>
      );
  }
}

function OpportunityRow({ opp }: { opp: Opportunity }) {
  const tone = TONE_STYLES[opp.tone];
  return (
    <div className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
      <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${tone.circle}`}>
        <OpportunityIconSvg name={opp.icon} />
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <p className="text-[13.5px] font-semibold text-ink leading-snug">{opp.title}</p>
        <p className="text-[12.5px] text-ink-muted leading-relaxed">{opp.detail}</p>
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 pt-0.5">
          {opp.impactTL !== null && (
            <span className={`text-[11.5px] font-bold rounded-full px-2.5 py-1 ${tone.chip}`}>
              ≈ {formatTL(opp.impactTL)}/ay potansiyel
            </span>
          )}
          <Link href={`/asistan?q=${encodeURIComponent(opp.ask)}`} className="text-[12.5px] font-bold text-accent flex items-center gap-1">
            Danışmana sor
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
        {opp.impactNote && <p className="text-[11px] text-ink-muted/80 italic">{opp.impactNote}</p>}
      </div>
    </div>
  );
}

export function BusinessPulseSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card p-4 lg:p-5 flex flex-col gap-3 animate-pulse">
      <div className="h-3 w-28 rounded bg-border" />
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-border shrink-0" />
        <div className="flex-1 flex flex-col gap-2">
          <div className="h-2.5 rounded bg-border" />
          <div className="h-2.5 rounded bg-border w-4/5" />
        </div>
      </div>
    </div>
  );
}

const VISIBLE_OPPORTUNITIES = 3;

export default async function BusinessPulseCard({ businessId }: { businessId: string }) {
  let pulse: BusinessPulse;
  try {
    const ds = await loadInsightsDataset(createAdminSupabaseClient(), businessId);
    pulse = buildPulse(ds);
  } catch (err) {
    console.error("[dashboard] Fırsat Radarı hesaplanamadı:", err);
    return null;
  }

  const visible = pulse.opportunities.slice(0, VISIBLE_OPPORTUNITIES);
  const rest = pulse.opportunities.slice(VISIBLE_OPPORTUNITIES);

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card p-4 lg:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] font-bold text-accent uppercase tracking-wide">Fırsat Radarı</p>
        <span className="text-[11px] text-ink-muted text-right">Verilerinden çıkarıldı, tahminler varsayıma dayanır</span>
      </div>

      {!pulse.hasEnoughData ? (
        <p className="text-[13px] text-ink-muted leading-relaxed">
          Fırsatları çıkarabilmem için birkaç hafta daha randevu verisi birikmesi gerekiyor. Veri geldikçe burada somut, sayılara dayalı
          fırsatlar göstereceğim.
        </p>
      ) : pulse.opportunities.length === 0 ? (
        <p className="text-[13px] text-ink-muted leading-relaxed">Şu an öne çıkan bir fırsat ya da risk görünmüyor.</p>
      ) : (
        <>
          <div className="flex flex-col divide-y divide-border">
            {visible.map((opp) => (
              <OpportunityRow key={opp.id} opp={opp} />
            ))}
          </div>
          {rest.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-[12.5px] font-bold text-accent list-none flex items-center gap-1">
                <span className="group-open:hidden">Diğer {rest.length} fırsatı gör</span>
                <span className="hidden group-open:inline">Gizle</span>
              </summary>
              <div className="flex flex-col divide-y divide-border pt-3">
                {rest.map((opp) => (
                  <OpportunityRow key={opp.id} opp={opp} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
