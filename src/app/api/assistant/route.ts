import { NextRequest, NextResponse } from "next/server";
import type { Content } from "@google/genai";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { askAssistant } from "@/lib/ai/assistant";
import { assistantQuestionSchema } from "@/lib/validation";
import type { Business } from "@/types/database";

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const { question, history } = assistantQuestionSchema.parse(await request.json());

    const { data: business, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", owner.business_id)
      .single();
    if (error) throw error;

    const historyContents: Content[] = (history ?? []).map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    const reply = await askAssistant(business as Business, question, historyContents);
    return NextResponse.json(reply);
  });
}
