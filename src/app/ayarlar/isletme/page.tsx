import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import IsletmeClient from "@/app/ayarlar/isletme/IsletmeClient";

export default async function IsletmePage() {
  const { business } = await getBusinessOwnerForPage();

  return (
    <AppShell businessName={business.name}>
        <PageHeader eyebrow={business.name} title="İşletme Ayarları" />
        <IsletmeClient initialWorkingHours={business.working_hours} initialClosedDates={business.closed_dates} />
    </AppShell>
  );
}
