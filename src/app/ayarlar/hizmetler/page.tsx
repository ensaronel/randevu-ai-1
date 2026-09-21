import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
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
        <PageHeader eyebrow={business.name} title="Hizmetler" />
        <HizmetlerClient services={data ?? []} />
    </AppShell>
  );
}
