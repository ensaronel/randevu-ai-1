import type { ReactNode } from "react";

/**
 * Ortak sayfa başlığı — daha önce her sayfada ayrı ayrı kopyalanan
 * "küçük büyük-harf etiket + başlık (+ opsiyonel alt yazı)" deseni tek yerde.
 * Bazı sayfalarda (Dashboard, Takvim, Müşteri Detay) ekstra öğeler (avatar,
 * tarih navigasyonu, geri linki) olduğu için onlar bilerek bunu kullanmıyor.
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  titleClassName = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <div>
      {eyebrow && <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">{eyebrow}</p>}
      <h1 className={`text-2xl font-semibold ${titleClassName}`}>{title}</h1>
      {subtitle && <p className="text-[13px] text-ink-muted mt-1">{subtitle}</p>}
    </div>
  );
}
