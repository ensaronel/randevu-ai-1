import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import ReklamClient from "../ReklamClient";
import ReklamTabs from "../ReklamTabs";
import { TYPE_LABELS } from "../typeLabels";
import TransformationUploadForm from "./TransformationUploadForm";

export default async function ReklamDonusumPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data } = await supabase
    .from("action_objects")
    .select("id, type, suggestion, created_at")
    .eq("business_id", business.id)
    .eq("type", "transformation")
    .not("share_image", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);

  const items = (data ?? []).map((row) => ({
    id: row.id as string,
    typeLabel: TYPE_LABELS[row.type as string] ?? "İçerik",
    suggestion: row.suggestion as string,
    createdAt: row.created_at as string,
  }));

  return (
    <AppShell businessName={business.name}>
      <PageHeader
        eyebrow={business.name}
        title="Reklam"
        subtitle="Öncesi/sonrası fotoğraflarınızdan reklam kreatifi oluşturun."
      />

      <ReklamTabs active="donusum" />

      <TransformationUploadForm />

      {items.length === 0 ? (
        <EmptyState message="Henüz bir dönüşüm paylaşımı oluşturmadınız — öncesi/sonrası fotoğraf yükleyerek başlayın." />
      ) : (
        <ReklamClient items={items} />
      )}
    </AppShell>
  );
}
