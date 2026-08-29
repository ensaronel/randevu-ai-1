import { getBusinessOwnerForPage } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";
import AsistanClient from "@/app/asistan/AsistanClient";

export default async function AsistanPage() {
  await getBusinessOwnerForPage();

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <AsistanClient />
      <BottomNav />
    </div>
  );
}
