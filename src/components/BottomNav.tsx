"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/dashboard",
    label: "Ana Sayfa",
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11l8-7 8 7" />
        <path d="M6 10v9h12v-9" />
      </svg>
    ),
  },
  {
    href: "/takvim",
    label: "Takvim",
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/musteriler",
    label: "Müşteriler",
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6" />
        <circle cx="17.5" cy="9" r="2.4" />
        <path d="M15.8 13.4c2.4.5 4.2 2.3 4.2 5" />
      </svg>
    ),
  },
  {
    href: "/gun-sonu",
    label: "Gün Sonu",
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M9 13l2 2 4-4" />
      </svg>
    ),
  },
];

// "Ayarlar" bilerek burada değil — AppShell'in mobil üst çubuğundaki dişli
// ikonuna taşındı, ki burada tam 4 sekme (2 sol + 2 sağ) kalıp ortadaki +
// butonu görünmez dolgu/boşluk gerekmeden gerçekten simetrik olsun.
const LEFT_ITEMS = items.slice(0, 2);
const RIGHT_ITEMS = items.slice(2);

function NavLink({ item, active }: { item: (typeof items)[number]; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`flex-1 min-w-0 flex flex-col items-center gap-1 text-[11px] font-semibold whitespace-nowrap ${
        active ? "text-accent" : "text-ink-muted"
      }`}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 bg-surface border-t border-border flex items-end px-2 pt-2.5"
      style={{ paddingBottom: "calc(0.875rem + env(safe-area-inset-bottom))" }}
    >
      {LEFT_ITEMS.map((item) => (
        <NavLink key={item.href} item={item} active={!!pathname?.startsWith(item.href)} />
      ))}

      {/* Randevu Oluştur — kabartılmış birincil eylem, geri kalan sekmelerden biri değil. */}
      <div className="flex-1 min-w-0 flex justify-center">
        <Link
          href="/randevu-olustur"
          aria-label="Randevu Oluştur"
          className="-mt-8 w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center shadow-md border-4 border-bg"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
      </div>

      {RIGHT_ITEMS.map((item) => (
        <NavLink key={item.href} item={item} active={!!pathname?.startsWith(item.href)} />
      ))}
    </nav>
  );
}
