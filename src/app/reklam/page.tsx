import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import ReklamClient from "./ReklamClient";

const TYPE_LABELS: Record<string, string> = {
  achievement_moment: "Başarı Anı",
  daily_content: "Günlük İçerik",
  campaign_suggestion: "Kampanya",
};

export default async function ReklamPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data } = await supabase
    .from("action_objects")
    .select("id, type, suggestion, created_at")
    .eq("business_id", business.id)
    .in("type", ["achievement_moment", "daily_content", "campaign_suggestion"])
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
      <div>
        <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">{business.name}</p>
        <h1 className="text-2xl font-semibold">Reklam</h1>
        <p className="text-[13px] text-ink-muted mt-1">
          {items.length === 0
            ? "Henüz paylaşılacak bir içerik yok."
            : "AI'nin işletmeniz için otomatik hazırladığı, paylaşıma hazır görseller."}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState message="Her gün bir marka içeriği, ve gerçekten bir şey olduğunda (rekor gün, sadakat kilometre taşı, kampanya fırsatı) bir başarı anı burada otomatik olarak belirir — hiçbir şey yapmana gerek yok." />
      ) : (
        <ReklamClient items={items} />
      )}
    </AppShell>
  );
}
