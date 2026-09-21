import Link from "next/link";
import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import PushNotificationSettings from "@/components/PushNotificationSettings";

const LINKS = [
  {
    href: "/ayarlar/hizmetler",
    label: "Hizmetler",
    desc: "Fiyat, süre ve hizmet listesi",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4M20 8v8l-8 4" />
      </svg>
    ),
  },
  {
    href: "/ayarlar/calisanlar",
    label: "Çalışanlar",
    desc: "Personel, çalışma saatleri ve performans",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="2.6" />
        <circle cx="17" cy="7" r="2.6" />
        <circle cx="12" cy="16" r="2.6" />
        <path d="M7 10v2M17 10v2M9.5 16.5h-1M14.5 16.5h1" />
      </svg>
    ),
  },
  {
    href: "/ayarlar/isletme",
    label: "İşletme Ayarları",
    desc: "Çalışma saatleri ve kapalı günler",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 13a7.6 7.6 0 000-2l2-1.5-2-3.5-2.4.6a7.6 7.6 0 00-1.7-1L15 3h-6l-.3 2.6a7.6 7.6 0 00-1.7 1l-2.4-.6-2 3.5L4.6 11a7.6 7.6 0 000 2l-2 1.5 2 3.5 2.4-.6a7.6 7.6 0 001.7 1L9 21h6l.3-2.6a7.6 7.6 0 001.7-1l2.4.6 2-3.5-2-1.5z" />
      </svg>
    ),
  },
  {
    href: "/bekleme-listesi",
    label: "Bekleme Listesi",
    desc: "Uygun saat çıkınca haber verilecek müşteriler",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v5l3.5 2" />
      </svg>
    ),
  },
];

export default async function AyarlarPage() {
  const { business } = await getBusinessOwnerForPage();

  return (
    <AppShell businessName={business.name}>
        <PageHeader eyebrow={business.name} title="Ayarlar" />

        <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-3 lg:gap-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                {link.icon}
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-semibold text-sm">{link.label}</span>
                <span className="text-[12.5px] text-ink-muted">{link.desc}</span>
              </div>
            </Link>
          ))}
        </div>

        <PushNotificationSettings />
    </AppShell>
  );
}
