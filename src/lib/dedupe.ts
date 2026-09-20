import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/** `action_objects.reasoning` alanına `dedupe:<key> — <asıl metin>` yazıp aynı `type` +
 * `dedupeKey` için tekrar üretim yapılmasını önleyen ortak idiom (bkz. reklamContent.ts
 * altındaki tüm üreticiler). `reasoning` sadece denetim amaçlı, hiçbir yerde render edilmiyor. */
export async function hasDedupeFired(
  admin: AdminClient,
  businessId: string,
  type: string,
  dedupeKey: string
): Promise<boolean> {
  const { data } = await admin
    .from("action_objects")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", type)
    .ilike("reasoning", `dedupe:${dedupeKey} —%`)
    .limit(1);
  return !!data && data.length > 0;
}

export function dedupeReasoning(dedupeKey: string, reasoning: string): string {
  return `dedupe:${dedupeKey} — ${reasoning}`;
}
