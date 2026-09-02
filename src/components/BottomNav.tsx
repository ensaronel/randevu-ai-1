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
  {
    href: "/ayarlar",
    label: "Ayarlar",
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 13a7.6 7.6 0 000-2l2-1.5-2-3.5-2.4.6a7.6 7.6 0 00-1.7-1L15 3h-6l-.3 2.6a7.6 7.6 0 00-1.7 1l-2.4-.6-2 3.5L4.6 11a7.6 7.6 0 000 2l-2 1.5 2 3.5 2.4-.6a7.6 7.6 0 001.7 1L9 21h6l.3-2.6a7.6 7.6 0 001.7-1l2.4.6 2-3.5-2-1.5z" />
      </svg>
    ),
  },
];

const LEFT_ITEMS = items.slice(0, 2);
const RIGHT_ITEMS = items.slice(2);

function NavLink({ item, active }: { item: (typeof items)[number]; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`flex-1 flex flex-col items-center gap-1 text-[11px] font-semibold ${
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
    <nav className="relative bg-surface border-t border-border flex items-end px-2 pt-2.5 pb-3.5">
      {LEFT_ITEMS.map((item) => (
        <NavLink key={item.href} item={item} active={!!pathname?.startsWith(item.href)} />
      ))}

      {/* Randevu Oluştur — kabartılmış birincil eylem, geri kalan sekmelerden biri değil. */}
      <div className="flex-1 flex justify-center">
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
