import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { createAdminSupabaseClient } from "../src/lib/supabase/admin.js";
import { loadBusinessContext } from "../src/lib/ai/context.js";
import { AI_TOOLS, executeAiTool } from "../src/lib/ai/tools.js";
import { buildVoiceSystemPrompt } from "./voicePrompt.js";
import { findOrCreateCustomerByPhone } from "./customerLookup.js";
import { twilioMuLawToGeminiPcm16, geminiPcm16ToTwilioMuLaw } from "./audio.js";

// Live API'ye özgü model — klasik generateContent'in kullandığı model (src/lib/ai/model.ts)
// sesli/gerçek-zamanlı modu desteklemiyor, ayrı bir "-live-" modeli gerekiyor. Kurulum
// sırasında Google AI Studio'dan güncel model adı doğrulanmalı, bu şimdilik en güncel bilinen ad.
const VOICE_MODEL = process.env.GEMINI_VOICE_MODEL ?? "gemini-2.5-flash-native-audio-preview-09-2025";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface CallHandlers {
  sendAudioToTwilio: (base64MuLaw: string) => void;
  clearTwilioAudioQueue: () => void;
}

/**
 * Tek bir telefon araması boyunca yaşayan Gemini Live oturumu. Twilio tarafındaki
 * WebSocket (server.ts) bu sınıfı çağırır: ses geldikçe pushAudio(), arama bitince stop().
 */
export class VoiceCallSession {
  private session: Session | null = null;
  private customerId = "";
  private customerName = "";
  private businessId: string;
  private handlers: CallHandlers;
  private ready: Promise<void>;

  constructor(businessId: string, twilioFromNumber: string, handlers: CallHandlers) {
    this.businessId = businessId;
    this.handlers = handlers;
    this.ready = this.setup(twilioFromNumber);
  }

  private async setup(twilioFromNumber: string): Promise<void> {
    const admin = createAdminSupabaseClient();

    const [ctx, customer] = await Promise.all([
      loadBusinessContext(this.businessId),
      findOrCreateCustomerByPhone(admin, this.businessId, twilioFromNumber),
    ]);
    this.customerId = customer.id;
    this.customerName = customer.full_name;

    this.session = await ai.live.connect({
      model: VOICE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildVoiceSystemPrompt(ctx),
        tools: [{ functionDeclarations: AI_TOOLS }],
      },
      callbacks: {
        onopen: () => console.log(`[voice] Gemini Live oturumu açıldı — müşteri ${customer.phone}`),
        onmessage: (message) => this.handleGeminiMessage(message, ctx),
        onerror: (e) => console.error("[voice] Gemini Live hata:", e),
        onclose: () => console.log("[voice] Gemini Live oturumu kapandı"),
      },
    });
  }

  private handleGeminiMessage(
    message: import("@google/genai").LiveServerMessage,
    ctx: Awaited<ReturnType<typeof loadBusinessContext>>
  ) {
    // Kullanıcı araya girdiyse (barge-in) - AI'nin kuyruktaki sesini hemen kes,
    // aksi halde AI konuşmaya devam ederken üstüne binen tuhaf bir gecikme olur.
    if (message.serverContent?.interrupted) {
      this.handlers.clearTwilioAudioQueue();
    }

    const parts = message.serverContent?.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        this.handlers.sendAudioToTwilio(geminiPcm16ToTwilioMuLaw(part.inlineData.data));
      }
    }

    const functionCalls = message.toolCall?.functionCalls ?? [];
    if (functionCalls.length > 0) {
      void this.handleToolCalls(functionCalls, ctx);
    }
  }

  private async handleToolCalls(
    functionCalls: { name?: string; args?: Record<string, unknown>; id?: string }[],
    ctx: Awaited<ReturnType<typeof loadBusinessContext>>
  ) {
    const responses = await Promise.all(
      functionCalls.map(async (call) => {
        const { result } = await executeAiTool(call.name ?? "", call.args ?? {}, {
          ctx,
          customerId: this.customerId,
          customerName: this.customerName,
        });
        return { id: call.id, name: call.name, response: { result } };
      })
    );
    this.session?.sendToolResponse({ functionResponses: responses });
  }

  /** Twilio'dan gelen tek bir μ-law 8kHz ses parçasını Gemini'ye iletir. */
  async pushAudio(base64MuLaw: string): Promise<void> {
    await this.ready;
    this.session?.sendRealtimeInput({
      audio: { data: twilioMuLawToGeminiPcm16(base64MuLaw), mimeType: "audio/pcm;rate=16000" },
    });
  }

  async stop(): Promise<void> {
    await this.ready.catch(() => undefined);
    this.session?.close();
  }
}
