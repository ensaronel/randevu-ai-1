// icon.tsx / apple-icon.tsx / icon-192.png / icon-512.png rotalarının
// ImageResponse (Satori) ile paylaştığı maskot çizimi — Mascot.tsx ile aynı
// yollar, ama var(--accent2...) yerine sabit hex değerler kullanıyor çünkü
// Satori CSS custom property'leri çözemiyor.
const ACCENT2 = "#d9932f";
const ACCENT2_SOFT = "#f1dfb9";
const ACCENT2_INK = "#6e4f15";

export function mascotIconSvg(size: number, options?: { waving?: boolean; celebrating?: boolean }) {
  const waving = options?.waving ?? false;
  const celebrating = options?.celebrating ?? false;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="32" fill={ACCENT2_SOFT} />
      {waving && (
        <g>
          <path
            d="M45 22c3-2 6-1 6 2.5s-3 5-6 3.5"
            stroke={ACCENT2}
            strokeWidth="3.4"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M53 16.5c1.4.6 2 1.6 2 2.6M55 21c1.4 0 2.4.7 2.6 1.8" stroke={ACCENT2} strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {celebrating && (
        <g>
          {/* iki kol havada, "hooray" pozu — kutlama anları (öncesi/sonrası paylaşımı) için */}
          <path d="M16 26c-4-4-5-9-2-12" stroke={ACCENT2} strokeWidth="3.4" strokeLinecap="round" fill="none" />
          <path d="M48 26c4-4 5-9 2-12" stroke={ACCENT2} strokeWidth="3.4" strokeLinecap="round" fill="none" />
          {/* parıltı/yıldızlar */}
          <path d="M10 14l1.4 3.4L15 18.8l-3.6 1.4L10 23.6l-1.4-3.4L5 18.8l3.6-1.4z" fill={ACCENT2} opacity={0.8} />
          <path d="M54 10l1 2.6L57.6 14l-2.6 1L54 17.6l-1-2.6L50.4 14l2.6-1z" fill={ACCENT2} opacity={0.7} />
          <circle cx="47" cy="6" r="1.6" fill={ACCENT2} opacity={0.6} />
        </g>
      )}
      <circle cx="32" cy="34" r="19" fill={ACCENT2} />
      <circle cx="23.5" cy="37" r="2.6" fill={ACCENT2_INK} opacity={0.18} />
      <circle cx="40.5" cy="37" r="2.6" fill={ACCENT2_INK} opacity={0.18} />
      <path d="M22 30c1.3-2 3.7-2 5 0" stroke={ACCENT2_INK} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M37 30c1.3-2 3.7-2 5 0" stroke={ACCENT2_INK} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M26 39c2.2 2.4 9.8 2.4 12 0" stroke={ACCENT2_INK} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M27 16c1-3 4-4 5-2" stroke={ACCENT2} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M33 15c1-3 4-3.5 5-1.2" stroke={ACCENT2} strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}
