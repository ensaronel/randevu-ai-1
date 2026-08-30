import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import RandevuOlusturClient from "@/app/randevu-olustur/RandevuOlusturClient";
import type { Service, Staff } from "@/types/database";

export default async function RandevuOlusturPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const [{ data: servicesData }, { data: staffData }] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("business_id", business.id)
      .eq("status", "active")
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("staff")
      .select("*")
      .eq("business_id", business.id)
      .eq("status", "active")
      .order("full_name", { ascending: true }),
  ]);

  return (
    <AppShell businessName={business.name}>
      <RandevuOlusturClient
        services={(servicesData ?? []) as Service[]}
        staff={(staffData ?? []) as Staff[]}
      />
    </AppShell>
  );
}
