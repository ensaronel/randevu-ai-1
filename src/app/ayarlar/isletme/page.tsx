import { getBusinessOwnerForPage } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";
import IsletmeClient from "@/app/ayarlar/isletme/IsletmeClient";

export default async function IsletmePage() {
  const { business } = await getBusinessOwnerForPage();

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-4 max-w-md mx-auto w-full">
        <h1 className="text-2xl font-semibold">İşletme Ayarları</h1>
        <IsletmeClient initialWorkingHours={business.working_hours} initialClosedDates={business.closed_dates} />
      </div>
      <BottomNav />
    </div>
  );
}
