import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import IsletmeClient from "@/app/ayarlar/isletme/IsletmeClient";

export default async function IsletmePage() {
  const { business } = await getBusinessOwnerForPage();

  return (
    <AppShell businessName={business.name}>
        <h1 className="text-2xl font-semibold">İşletme Ayarları</h1>
        <IsletmeClient initialWorkingHours={business.working_hours} initialClosedDates={business.closed_dates} />
    </AppShell>
  );
}
