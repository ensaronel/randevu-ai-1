import Link from "next/link";

const TABS = [
  { key: "content", href: "/reklam", label: "İçerikler" },
  { key: "donusum", href: "/reklam/donusum", label: "Dönüşüm" },
] as const;

export default function ReklamTabs({ active }: { active: "content" | "donusum" }) {
  return (
    <div className="flex gap-1 bg-bg border border-border rounded-xl p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`flex-1 text-center text-[13px] font-semibold rounded-lg py-2 transition-colors ${
            active === tab.key ? "bg-surface text-ink shadow-sm" : "text-ink-muted"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
