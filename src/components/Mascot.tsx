/**
 * Küçük, sevimli maskot karakteri — "yapay zeka" hissini değil, sıcak/yerel bir
 * "danışman" hissini taşımak için. Referans görsellerdeki illüstrasyon dilinden
 * (yuvarlak karakter, kapalı-gülen gözler, blush) esinlenildi, mevcut accent2
 * (amber) rengiyle kuruldu ki markanın zaten onaylı ikincil rengiyle tutarlı kalsın.
 */
export default function Mascot({ size = 56, waving = false }: { size?: number; waving?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="var(--accent2-soft)" />
      {waving && (
        <g>
          <path
            d="M45 22c3-2 6-1 6 2.5s-3 5-6 3.5"
            stroke="var(--accent2)"
            strokeWidth="3.4"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M53 16.5c1.4.6 2 1.6 2 2.6M55 21c1.4 0 2.4.7 2.6 1.8" stroke="var(--accent2)" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      <circle cx="32" cy="34" r="19" fill="var(--accent2)" />
      <path
        d="M24 32c1.5 2 3 3 3 6.5"
        stroke="var(--accent2-ink)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0"
      />
      {/* yanaklar */}
      <circle cx="23.5" cy="37" r="2.6" fill="var(--accent2-ink)" opacity="0.18" />
      <circle cx="40.5" cy="37" r="2.6" fill="var(--accent2-ink)" opacity="0.18" />
      {/* kapalı, gülümseyen gözler */}
      <path d="M22 30c1.3-2 3.7-2 5 0" stroke="var(--accent2-ink)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M37 30c1.3-2 3.7-2 5 0" stroke="var(--accent2-ink)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* gülümseme */}
      <path d="M26 39c2.2 2.4 9.8 2.4 12 0" stroke="var(--accent2-ink)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* küçük üst kıvırcık - berber/kuaför dokunuşu */}
      <path d="M27 16c1-3 4-4 5-2" stroke="var(--accent2)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M33 15c1-3 4-3.5 5-1.2" stroke="var(--accent2)" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}
