import { getBusinessOwnerForPage } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import AsistanClient from "@/app/asistan/AsistanClient";

const HISTORY_LIMIT = 20;
const MAX_INITIAL_QUESTION_LENGTH = 400;

export default async function AsistanPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { business, supabase } = await getBusinessOwnerForPage();
  const { q } = await searchParams;
  const rawQuestion = Array.isArray(q) ? q[0] : q;
  const initialQuestion = rawQuestion?.trim().slice(0, MAX_INITIAL_QUESTION_LENGTH) || undefined;

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
      <div className="flex-1 flex flex-col min-h-0 w-full lg:max-w-2xl lg:mx-auto">
        <AsistanClient initialMessages={initialMessages} initialQuestion={initialQuestion} />
      </div>
    </AppShell>
  );
}
