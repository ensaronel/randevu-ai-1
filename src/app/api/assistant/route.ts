import { NextRequest, NextResponse } from "next/server";
import type { Content } from "@google/genai";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { askAssistant } from "@/lib/ai/assistant";
import { assistantQuestionSchema } from "@/lib/validation";
import type { Business } from "@/types/database";

const HISTORY_LIMIT = 20;

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { question } = assistantQuestionSchema.parse(await request.json());

    const { data: business, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", owner.business_id)
      .single();
    if (error) throw error;

    // Client'ın gönderdiği history'e güvenmek yerine (manipüle edilebilir,
    // sekmeler arası tutarsız olabilir) son N mesajı kalıcı log'dan okuyoruz.
    const { data: historyRows } = await supabase
      .from("assistant_message_log")
      .select("role, body")
      .eq("business_id", owner.business_id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    const historyContents: Content[] = (historyRows ?? [])
      .reverse()
      .map((m) => ({ role: m.role as "user" | "model", parts: [{ text: m.body }] }));

    const reply = await askAssistant(business as Business, question, historyContents);

    await supabase.from("assistant_message_log").insert([
      { business_id: owner.business_id, role: "user", body: question },
      { business_id: owner.business_id, role: "model", body: reply.replyText },
    ]);

    return NextResponse.json(reply);
  });
}
