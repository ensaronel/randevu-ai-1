import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import AsistanClient from "@/app/asistan/AsistanClient";

const HISTORY_LIMIT = 20;

export default async function AsistanPage() {
  const { business, supabase } = await getBusinessOwnerForPage();

  const { data: historyRows } = await supabase
    .from("assistant_message_log")
    .select("role, body")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const initialMessages = (historyRows ?? [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "model", text: m.body as string }));

  return (
    <AppShell businessName={business.name}>
      <AsistanClient initialMessages={initialMessages} />
    </AppShell>
  );
}
