import { getBusinessOwnerForPage } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";
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
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-4 max-w-md mx-auto w-full">
        <h1 className="text-2xl font-semibold">Hizmetler</h1>
        <HizmetlerClient services={data ?? []} />
      </div>
      <BottomNav />
    </div>
  );
}
