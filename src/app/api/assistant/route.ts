import { NextRequest, NextResponse } from "next/server";
import type { Content } from "@google/genai";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { askAssistant } from "@/lib/ai/assistant";
import { isAiUnavailableError } from "@/lib/ai/gemini";
import { assistantQuestionSchema } from "@/lib/validation";
import type { Business } from "@/types/database";

const HISTORY_LIMIT = 20;

// Derin analiz birkaç araç turu + uzun bir cevap üretebilir, varsayılan süre yetmeyebilir.
export const maxDuration = 60;

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

    let reply;
    try {
      reply = await askAssistant(business as Business, question, historyContents);
    } catch (err) {
      if (!isAiUnavailableError(err)) throw err;
      // Yapay zeka sağlayıcısı kota/aşırı yük/zaman aşımı yüzünden cevap vermedi — genel bir "hata oluştu"
      // yerine gerçek sebebi söylüyoruz. Bu konuşma geçmişe yazılmıyor, tekrar denenebilir.
      console.error("[assistant] AI servisi cevap vermedi:", err);
      return NextResponse.json({
        replyText:
          "Yapay zeka servisi şu an çok yoğun ya da kullanım kotası dolmuş olabilir, cevap veremedim. " +
          "Birkaç dakika sonra aynı soruyu tekrar sorar mısın?",
      });
    }

    await supabase.from("assistant_message_log").insert([
      { business_id: owner.business_id, role: "user", body: question },
      { business_id: owner.business_id, role: "model", body: reply.replyText },
    ]);

    return NextResponse.json(reply);
  });
}
