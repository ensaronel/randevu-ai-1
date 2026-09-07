// icon.tsx / apple-icon.tsx / icon-192.png / icon-512.png rotalarının
// ImageResponse (Satori) ile paylaştığı maskot çizimi — Mascot.tsx ile aynı
// yollar, ama var(--accent2...) yerine sabit hex değerler kullanıyor çünkü
// Satori CSS custom property'leri çözemiyor.
const ACCENT2 = "#d9932f";
const ACCENT2_SOFT = "#f1dfb9";
const ACCENT2_INK = "#6e4f15";

export function mascotIconSvg(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="32" fill={ACCENT2_SOFT} />
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
