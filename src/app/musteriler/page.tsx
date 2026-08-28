import { getBusinessOwnerForPage } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";

// Gerçek müşteri profili (CRM) ekranı Hafta 12'de burada olacak.
export default async function MusterilerPage() {
  await getBusinessOwnerForPage();

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 text-center">
        <p className="text-sm text-ink-muted">Müşteri profili ekranı Hafta 12&apos;de burada olacak.</p>
      </div>
      <BottomNav />
    </div>
  );
}
