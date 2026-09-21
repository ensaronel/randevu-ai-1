import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { selectPositiveFeedback } from "@/lib/ai/socialProofCaption";
import { getBusinessName } from "@/lib/businessName";
import { dedupeReasoning, hasDedupeFired } from "@/lib/dedupe";
import { getInitials } from "@/lib/text";
import { dateKeyTR, formatDateTR } from "@/lib/date";
import type { ShareImagePayload } from "@/lib/ai/shareImage";

const FEEDBACK_LOOKBACK_DAYS = 14;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Son 14 gündeki anket geri bildirimleri arasından, daha önce bir sosyal kanıt
 * kartında KULLANILMAMIŞ olanları bulur. "Kullanılmış" bilgisi ayrı bir kolon yerine
 * (şemayı değiştirmemek için) önceki social_proof satırlarının reasoning'inde
 * "kaynak geri bildirim: <id>" deseninden çıkarılır.
 */
export async function runSocialProofForBusiness(businessId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient();
  const todayKey = dateKeyTR(0);

  if (await hasDedupeFired(admin, businessId, "social_proof", `social_proof:${todayKey}`)) return false;

  const since = new Date(Date.now() - FEEDBACK_LOOKBACK_DAYS * 24 * 60 * 60000).toISOString();
  const { data: feedback } = await admin
    .from("action_objects")
    .select("id, reasoning, related_customer_id, customer:customers(full_name)")
    .eq("business_id", businessId)
    .eq("type", "survey_feedback")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (!feedback || feedback.length === 0) return false;

  const { data: usedRows } = await admin
    .from("action_objects")
    .select("reasoning")
    .eq("business_id", businessId)
    .eq("type", "social_proof");
  const usedIds = new Set(
    (usedRows ?? [])
      .map((row) => row.reasoning.match(/kaynak geri bildirim:\s*([a-f0-9-]+)/i)?.[1])
      .filter((id): id is string => !!id)
  );

  const unused = feedback.filter((row) => !usedIds.has(row.id));
  if (unused.length === 0) return false;

  const businessName = await getBusinessName(admin, businessId);
  const selection = await selectPositiveFeedback({
    businessName,
    candidates: unused.map((row) => ({ id: row.id as string, text: row.reasoning as string })),
  });
  if (!selection) return false;

  const source = unused.find((row) => row.id === selection.id);
  const customerName = one(source?.customer)?.full_name ?? "Müşterimiz";
  const initials = getInitials(customerName);

  const shareImage: ShareImagePayload = {
    kind: "social_proof",
    accent: "amber",
    businessName,
    eyebrow: "Müşterilerimiz Ne Diyor?",
    big: selection.quote,
    subtitle: `— ${initials}`,
    contextLine: formatDateTR(`${todayKey}T12:00:00+03:00`),
  };

  const { error } = await admin.from("action_objects").insert({
    business_id: businessId,
    type: "social_proof",
    related_customer_id: source?.related_customer_id ?? null,
    suggestion: selection.caption,
    reasoning: dedupeReasoning(`social_proof:${todayKey}`, `kaynak geri bildirim: ${selection.id}`),
    status: "auto_sent",
    share_image: shareImage,
  });
  if (error) throw error;
  return true;
}
