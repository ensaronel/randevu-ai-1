import type { ReactNode } from "react";

const BADGE_STAT_TONES = {
  accentSoft: { bg: "bg-accent-soft", badge: "bg-white/70 text-accent" },
  accent2Soft: { bg: "bg-accent2-soft", badge: "bg-white/70 text-accent2-ink" },
  block2: { bg: "bg-block2", badge: "bg-white/60 text-block2-ink" },
  warn: { bg: "bg-bad-soft", badge: "bg-white/60 text-bad" },
  good: { bg: "bg-good-soft", badge: "bg-white/60 text-good-ink" },
} as const;

const BADGE_STAT_ICONS: Record<string, ReactNode> = {
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="15" rx="3" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </>
  ),
  x: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7.5A2.5 2.5 0 015.5 5h11A2.5 2.5 0 0119 7.5" />
      <rect x="3" y="7.5" width="18" height="11.5" rx="2.5" />
      <path d="M15 13.2h3" />
    </>
  ),
  check: (
    <>
      <rect x="4" y="5.5" width="16" height="15" rx="3" />
      <path d="M4 10h16M8 3v4M16 3v4" />
      <path d="M8.7 14.3l2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3.5 2" />
    </>
  ),
  banknote: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M5.5 9v0M18.5 15v0" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 9.5h19" />
    </>
  ),
};

export type BadgeStatTone = keyof typeof BADGE_STAT_TONES;
export type BadgeStatIcon = keyof typeof BADGE_STAT_ICONS;

/** Referans 1'deki "ikon dairesi + büyük sayı" istatistik örüntüsü — Dashboard, Müşteri detay ve Kasa'da ortak. */
export default function BadgeStat({
  icon,
  label,
  value,
  tone,
  size = "md",
}: {
  icon: BadgeStatIcon;
  label: string;
  value: string;
  tone: BadgeStatTone;
  size?: "md" | "sm";
}) {
  const { bg, badge } = BADGE_STAT_TONES[tone];
  const isSmall = size === "sm";
  return (
    <div className={`${bg} rounded-2xl ${isSmall ? "p-3 gap-2" : "p-4 gap-3"} flex flex-col`}>
      <div
        className={`${badge} ${isSmall ? "w-8 h-8" : "w-9 h-9"} rounded-full flex items-center justify-center shrink-0`}
      >
        <svg
          width={isSmall ? 16 : 18}
          height={isSmall ? 16 : 18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {BADGE_STAT_ICONS[icon]}
        </svg>
      </div>
      <div>
        <p
          className={`${isSmall ? "text-[16px] leading-tight break-words" : "text-[26px] leading-none"} font-bold font-display`}
        >
          {value}
        </p>
        <p className={`${isSmall ? "text-[11px] mt-0.5" : "text-[12px] mt-1"} text-ink-muted`}>{label}</p>
      </div>
    </div>
  );
}
