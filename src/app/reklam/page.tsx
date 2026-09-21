import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import ReklamClient from "./ReklamClient";
import ReklamTabs from "./ReklamTabs";
import { TYPE_LABELS } from "./typeLabels";

const CONTENT_TYPES = [
  "achievement_moment",
  "daily_content",
  "daily_spotlight",
  "daily_tip",
  "campaign_suggestion",
  "available_slots",
  "social_proof",
];

export default async function ReklamPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data } = await supabase
    .from("action_objects")
    .select("id, type, suggestion, created_at")
    .eq("business_id", business.id)
    .in("type", CONTENT_TYPES)
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
        subtitle={
          items.length === 0
            ? "Henüz paylaşılacak bir içerik yok."
            : "AI'nin işletmeniz için otomatik hazırladığı, paylaşıma hazır görseller."
        }
      />

      <ReklamTabs active="content" />

      {items.length === 0 ? (
        <EmptyState message="Her gün otomatik olarak yeni paylaşılabilir içerikler (boş randevu duyurusu, sosyal kanıt, vitrin, bakım ipucu, ve gerçekten bir şey olduğunda bir başarı anı) burada belirir — hiçbir şey yapmana gerek yok." />
      ) : (
        <ReklamClient items={items} />
      )}
    </AppShell>
  );
}
