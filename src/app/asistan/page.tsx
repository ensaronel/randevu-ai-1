import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import AsistanClient from "@/app/asistan/AsistanClient";

export default async function AsistanPage() {
  const { business } = await getBusinessOwnerForPage();

  return (
    <AppShell businessName={business.name}>
      <AsistanClient />
    </AppShell>
  );
}
