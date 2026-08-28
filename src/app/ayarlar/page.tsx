import Link from "next/link";
import { getBusinessOwnerForPage } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";

const LINKS = [
  { href: "/ayarlar/hizmetler", label: "Hizmetler", desc: "Fiyat, süre ve hizmet listesi" },
  { href: "/ayarlar/calisanlar", label: "Çalışanlar", desc: "Personel, çalışma saatleri ve performans" },
  { href: "/ayarlar/isletme", label: "İşletme Ayarları", desc: "Çalışma saatleri ve kapalı günler" },
];

export default async function AyarlarPage() {
  const { business } = await getBusinessOwnerForPage();

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-4 max-w-md mx-auto w-full">
        <div>
          <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">{business.name}</p>
          <h1 className="text-2xl font-semibold">Ayarlar</h1>
        </div>

        <div className="flex flex-col gap-2.5">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-1"
            >
              <span className="font-semibold text-sm">{link.label}</span>
              <span className="text-[12.5px] text-ink-muted">{link.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
