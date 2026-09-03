import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";

const WEEKDAY_LABELS_TR: Record<string, string> = {
  sun: "Paz",
  mon: "Pzt",
  tue: "Sal",
  wed: "Çar",
  thu: "Per",
  fri: "Cum",
  sat: "Cmt",
};

type WaitlistRow = {
  id: string;
  created_at: string;
  desired_time_range: { from: string; to: string; days: string[] } | null;
  customer: { full_name: string; phone: string } | { full_name: string; phone: string }[] | null;
  service: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatRange(range: WaitlistRow["desired_time_range"]): string {
  if (!range) return "Belirtilmemiş";
  const days = range.days.map((d) => WEEKDAY_LABELS_TR[d] ?? d).join(", ");
  return `${days} · ${range.from}-${range.to}`;
}

export default async function BeklemeListesiPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data } = await supabase
    .from("waitlist_entries")
    .select("id, created_at, desired_time_range, customer:customers(full_name, phone), service:services(name)")
    .eq("business_id", business.id)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  const entries = (data ?? []) as unknown as WaitlistRow[];

  return (
    <AppShell businessName={business.name}>
      <div>
        <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">{business.name}</p>
        <h1 className="text-2xl font-semibold">Bekleme Listesi</h1>
        <p className="text-[13px] text-ink-muted mt-1">
          {entries.length === 0
            ? "Şu an bekleyen kimse yok."
            : `${entries.length} kişi uygun bir randevu bekliyor.`}
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-5 text-center">
          <p className="text-sm text-ink-muted">
            Bir müşteri istediği tarihte uygun saat bulamayıp WhatsApp&apos;tan beklemeyi kabul ederse burada
            görünecek — bir randevu iptal olduğunda sistem otomatik olarak eşleştirip Ana Sayfa&apos;daki
            Öneriler&apos;e ekliyor.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {entries.map((entry) => {
            const customer = one(entry.customer);
            const service = one(entry.service);
            return (
              <div key={entry.id} className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{customer?.full_name ?? "Müşteri"}</span>
                  <span className="text-[12px] text-ink-muted">{customer?.phone}</span>
                </div>
                <p className="text-[13px] text-ink-muted">{service?.name ?? "Herhangi bir hizmet"}</p>
                <p className="text-[12.5px] text-accent font-medium">{formatRange(entry.desired_time_range)}</p>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
