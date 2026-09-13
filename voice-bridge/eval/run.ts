/**
 * Sesli/AI-randevu mantığı için otomatik regresyon çalıştırıcısı.
 * Çalıştırma: cd voice-bridge && npm run eval
 *
 * Bu, "her hatayı tek tek elle telefonla arayıp bulma" döngüsünü kırmak için var —
 * bu oturumda canlı testte bulduğumuz her gerçek hata artık scenarios.ts'te kalıcı
 * bir senaryo, unitChecks.ts'te ise saf-kod (LLM'siz) bir kontrol olarak duruyor.
 * Bundan sonra bulunan HER YENİ hata de aynı şekilde buraya eklenmeli — amaç, "bunu
 * bir daha bozdun mu?" sorusunu saniyeler içinde, sizin sesli test etmenize gerek
 * kalmadan cevaplayabilmek.
 */
import { GoogleGenAI, type Content, type FunctionCall, type FunctionDeclaration } from "@google/genai";
import { AI_TOOLS, executeAiTool } from "../../src/lib/ai/tools.js";
import { AI_MODEL } from "../../src/lib/ai/model.js";
import { loadBusinessContext } from "../../src/lib/ai/context.js";
import { createAdminSupabaseClient } from "../../src/lib/supabase/admin.js";
import { buildVoiceSystemPrompt } from "../voicePrompt.js";
import {
  shouldBlockMutation,
  AMBIGUOUS_REPLY_ERROR,
  shouldBlockAvailabilityCheck,
  NO_SERVICE_MENTIONED_ERROR,
  shouldBlockUnverifiedSlot,
  UNVERIFIED_SLOT_ERROR,
  parseVerifiedSlotsFromResult,
  type VerifiedSlot,
} from "../../src/lib/ai/safetyGate.js";
import { findOrCreateCustomerByPhone } from "../customerLookup.js";
import { SCENARIOS, type Scenario, type ScenarioLog } from "./scenarios.js";
import { runUnitChecks } from "./unitChecks.js";

const VOICE_TEST_BUSINESS_ID = process.env.VOICE_TEST_BUSINESS_ID ?? "";
const MAX_TOOL_ITERATIONS_PER_TURN = 5;
// Gemini ücretsiz katmanı dakikada 15 istekle sınırlı (flash-lite) — art arda hızlı
// çağrılar 429 (RESOURCE_EXHAUSTED) ile başarısız olup GERÇEK OLMAYAN bir "regresyon"
// gibi görünüyordu (2026-09-12'de eval'i art arda birkaç kez çalıştırınca yakalandı).
// Her generateContent çağrısı arasına bilerek kısa bir bekleme konuyor.
const REQUEST_SPACING_MS = 4500;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// voicePrompt.ts, sesli aramaya özgü end_call/save_customer_name araçlarını da
// varsayıyor (bkz. toolsAdapter.ts'teki LIVE_TOOLS) — burada aynı iki aracı
// generateContent'in beklediği ham JSON Schema formatında ekliyoruz.
const EVAL_TOOLS: FunctionDeclaration[] = [
  ...AI_TOOLS,
  {
    name: "end_call",
    description: "Görüşmeyi sonlandırır (telefonu kapatır).",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "save_customer_name",
    description: "Müşteriden öğrenilen adını kaydeder.",
    parametersJsonSchema: {
      type: "object",
      properties: { full_name: { type: "string" } },
      required: ["full_name"],
    },
  },
];

async function runScenario(
  scenario: Scenario,
  ctx: Awaited<ReturnType<typeof loadBusinessContext>>,
  customer: { id: string; full_name: string; phone: string }
): Promise<ScenarioLog> {
  const contents: Content[] = [];
  const log: ScenarioLog = { toolCalls: [], aiTexts: [] };
  const recentUtterances: string[] = [];
  const fullTranscript: string[] = [];
  const verifiedSlots: VerifiedSlot[] = [];
  let customerName = customer.full_name;
  const needsCallerName = customer.full_name === customer.phone;

  for (const turn of scenario.turns) {
    contents.push({ role: "user", parts: [{ text: turn }] });
    recentUtterances.push(turn);
    if (recentUtterances.length > 2) recentUtterances.shift();
    fullTranscript.push(turn);

    for (let i = 0; i < MAX_TOOL_ITERATIONS_PER_TURN; i++) {
      await sleep(REQUEST_SPACING_MS);
      const response = await ai.models.generateContent({
        model: AI_MODEL,
        contents,
        config: {
          systemInstruction: buildVoiceSystemPrompt(ctx, needsCallerName),
          tools: [{ functionDeclarations: EVAL_TOOLS }],
        },
      });

      const functionCalls: FunctionCall[] = response.functionCalls ?? [];
      if (functionCalls.length === 0) {
        const text = (response.text ?? "").trim();
        if (text) log.aiTexts.push(text);
        contents.push({ role: "model", parts: [{ text }] });
        break;
      }

      const modelTurn = response.candidates?.[0]?.content;
      if (modelTurn) contents.push(modelTurn);

      const functionResponseParts: NonNullable<Content["parts"]> = [];
      for (const call of functionCalls) {
        const name = call.name ?? "";
        const args = (call.args as Record<string, unknown>) ?? {};

        if (name === "end_call") {
          functionResponseParts.push({
            functionResponse: { name, response: { result: "Görüşme sonlandırılıyor." }, id: call.id },
          });
          log.toolCalls.push({ name, args, blocked: false, resultPreview: "end_call" });
          continue;
        }
        if (name === "save_customer_name") {
          customerName = String(args.full_name ?? customerName);
          functionResponseParts.push({
            functionResponse: { name, response: { result: "Kaydedildi." }, id: call.id },
          });
          log.toolCalls.push({ name, args, blocked: false, resultPreview: "saved" });
          continue;
        }

        if (name === "check_availability" && shouldBlockAvailabilityCheck((args.service_names as string[] | undefined) ?? [], fullTranscript.join(" "))) {
          functionResponseParts.push({
            functionResponse: {
              name,
              response: { result: JSON.stringify({ error: NO_SERVICE_MENTIONED_ERROR }) },
              id: call.id,
            },
          });
          log.toolCalls.push({ name, args, blocked: true, resultPreview: "BLOCKED_NO_SERVICE" });
          continue;
        }

        if (shouldBlockMutation(name, recentUtterances)) {
          functionResponseParts.push({
            functionResponse: {
              name,
              response: { result: JSON.stringify({ error: AMBIGUOUS_REPLY_ERROR }) },
              id: call.id,
            },
          });
          log.toolCalls.push({ name, args, blocked: true, resultPreview: "BLOCKED" });
          continue;
        }

        if (
          shouldBlockUnverifiedSlot(
            name,
            {
              startsAt: String(args.starts_at ?? ""),
              endsAt: String(args.ends_at ?? ""),
              assignments: ((args.assignments as { service_name: string; staff_name: string }[] | undefined) ?? []).map(
                (a) => ({ serviceName: a.service_name, staffName: a.staff_name })
              ),
            },
            verifiedSlots
          )
        ) {
          functionResponseParts.push({
            functionResponse: {
              name,
              response: { result: JSON.stringify({ error: UNVERIFIED_SLOT_ERROR }) },
              id: call.id,
            },
          });
          log.toolCalls.push({ name, args, blocked: true, resultPreview: "BLOCKED_UNVERIFIED_SLOT" });
          continue;
        }

        const { result } = await executeAiTool(name, args, {
          ctx,
          customerId: customer.id,
          customerName,
          customerPhone: customer.phone,
          channel: "voice",
        });
        if (name === "check_availability" && !result.includes('"error"')) {
          verifiedSlots.push(...parseVerifiedSlotsFromResult(result));
        }
        functionResponseParts.push({ functionResponse: { name, response: { result }, id: call.id } });
        log.toolCalls.push({ name, args, blocked: false, resultPreview: result.slice(0, 200) });
      }

      contents.push({ role: "user", parts: functionResponseParts });
    }
  }

  return log;
}

async function main() {
  if (!VOICE_TEST_BUSINESS_ID) {
    console.error("VOICE_TEST_BUSINESS_ID ayarlı değil (.env) — eval çalıştırılamıyor.");
    process.exit(1);
  }

  console.log("=== Deterministik kontroller (LLM yok, saf kod mantığı, hızlı) ===\n");
  const unitResults = await runUnitChecks();
  let unitFail = 0;
  for (const r of unitResults) {
    console.log(`${r.pass ? "✅" : "❌"} ${r.name}\n   ${r.detail}`);
    if (!r.pass) unitFail++;
  }

  console.log("\n=== LLM tabanlı regresyon senaryoları (gerçek Gemini çağrısı) ===\n");
  const admin = createAdminSupabaseClient();
  const ctx = await loadBusinessContext(VOICE_TEST_BUSINESS_ID);

  let scenarioFail = 0;
  const lastLogByScenario = new Map<string, ScenarioLog>();
  for (const scenario of SCENARIOS) {
    const phone = `eval_${scenario.name}_${Date.now()}`;
    const customer = await findOrCreateCustomerByPhone(admin, VOICE_TEST_BUSINESS_ID, phone);
    try {
      const log = await runScenario(scenario, ctx, customer);
      lastLogByScenario.set(scenario.name, log);
      scenario.assert(log);
      console.log(`✅ ${scenario.name}`);
    } catch (err) {
      scenarioFail++;
      console.log(`❌ ${scenario.name}`);
      console.log(`   kaynak: ${scenario.origin}`);
      console.log(`   hata: ${(err as Error).message}`);
      const log = lastLogByScenario.get(scenario.name);
      if (log) {
        console.log(`   AI cevapları: ${JSON.stringify(log.aiTexts)}`);
        console.log(`   araç çağrıları: ${JSON.stringify(log.toolCalls.map((c) => ({ name: c.name, blocked: c.blocked })))}`);
      }
    }
  }

  const totalFail = unitFail + scenarioFail;
  console.log(`\n${totalFail === 0 ? "TÜMÜ BAŞARILI ✅" : `${totalFail} kontrol BAŞARISIZ ❌`}`);
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
