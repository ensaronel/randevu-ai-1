import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import HizmetlerClient from "@/app/ayarlar/hizmetler/HizmetlerClient";

export default async function HizmetlerPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data } = await supabase
    .from("services")
    .select("id, name, duration_minutes, price, category, status")
    .eq("business_id", business.id)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  return (
    <AppShell businessName={business.name}>
        <h1 className="text-2xl font-semibold">Hizmetler</h1>
        <HizmetlerClient services={data ?? []} />
    </AppShell>
  );
}
