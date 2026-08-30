"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/dashboard",
    label: "Ana Sayfa",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11l8-7 8 7" />
        <path d="M6 10v9h12v-9" />
      </svg>
    ),
  },
  {
    href: "/takvim",
    label: "Takvim",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/musteriler",
    label: "Müşteriler",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M9 13l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/ayarlar/calisanlar",
    label: "Çalışanlar",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="2.6" />
        <circle cx="17" cy="7" r="2.6" />
        <circle cx="12" cy="16" r="2.6" />
        <path d="M7 10v2M17 10v2M9.5 16.5h-1M14.5 16.5h1" />
      </svg>
    ),
  },
  {
    href: "/ayarlar",
    label: "Ayarlar",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 13a7.6 7.6 0 000-2l2-1.5-2-3.5-2.4.6a7.6 7.6 0 00-1.7-1L15 3h-6l-.3 2.6a7.6 7.6 0 00-1.7 1l-2.4-.6-2 3.5L4.6 11a7.6 7.6 0 000 2l-2 1.5 2 3.5 2.4-.6a7.6 7.6 0 001.7 1L9 21h6l.3-2.6a7.6 7.6 0 001.7-1l2.4.6 2-3.5-2-1.5z" />
      </svg>
    ),
  },
];

export default function Sidebar({ businessName }: { businessName: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-[232px] shrink-0 bg-surface border-r border-border p-4 flex-col gap-7">
      <div className="px-1.5 pt-2">
        <p className="text-[12.5px] font-bold text-ink-muted uppercase tracking-wide truncate">{businessName}</p>
        <h2 className="text-[17px] font-semibold font-display mt-0.5">Randevu AI</h2>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const active =
            item.href === "/ayarlar"
              ? pathname === "/ayarlar" || (pathname?.startsWith("/ayarlar/") && !pathname.startsWith("/ayarlar/calisanlar"))
              : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-[13.5px] font-semibold ${
                active ? "bg-accent-soft text-accent-ink" : "text-ink-muted hover:bg-bg"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
