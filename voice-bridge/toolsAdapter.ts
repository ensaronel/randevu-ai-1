import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import { AI_TOOLS } from "../src/lib/ai/tools.js";

/**
 * src/lib/ai/tools.ts'teki AI_TOOLS, WhatsApp botunun kullandığı klasik generateContent
 * API'siyle uyumlu ham JSON Schema formatında (`parametersJsonSchema`) yazılmış. Gemini
 * Live API (BidiGenerateContent, sesli konuşma) bu alanı düzgün desteklemiyor — kullanınca
 * sunucu tarafında "1011 Internal error" ile bağlantı çöküyor (2026-09-09'da izole edilip
 * doğrulandı: aynı araç eski `parameters`/Schema formatına çevrilince sorunsuz çalıştı).
 * Bu yüzden AI_TOOLS'u DEĞİŞTİRMEK yerine (WhatsApp tarafını bozmamak için — randevu
 * mantığının tek kaynağı hâlâ tools.ts), burada sadece PROTOKOLE özgü bir format
 * dönüşümü yapılıyor.
 */
function jsonSchemaToGeminiSchema(schema: Record<string, unknown>): Schema {
  const result: Schema = {};

  if (schema.type === "object") {
    result.type = Type.OBJECT;
    if (schema.properties && typeof schema.properties === "object") {
      result.properties = Object.fromEntries(
        Object.entries(schema.properties as Record<string, unknown>).map(([key, value]) => [
          key,
          jsonSchemaToGeminiSchema(value as Record<string, unknown>),
        ])
      );
    }
    if (Array.isArray(schema.required)) result.required = schema.required as string[];
  } else if (schema.type === "array") {
    result.type = Type.ARRAY;
    if (schema.items) result.items = jsonSchemaToGeminiSchema(schema.items as Record<string, unknown>);
  } else if (schema.type === "string") {
    result.type = Type.STRING;
    if (Array.isArray(schema.enum)) result.enum = schema.enum as string[];
  } else if (schema.type === "number" || schema.type === "integer") {
    result.type = schema.type === "integer" ? Type.INTEGER : Type.NUMBER;
  } else if (schema.type === "boolean") {
    result.type = Type.BOOLEAN;
  }

  if (typeof schema.description === "string") result.description = schema.description;
  return result;
}

/**
 * SADECE sesli aramaya özgü, WhatsApp'ta karşılığı olmayan bir araç — bu yüzden
 * AI_TOOLS'a (src/lib/ai/tools.ts, iki kanal arasında paylaşılıyor) eklenmedi,
 * burada ayrıca tanımlanıp LIVE_TOOLS'a eklendi. geminiBridge.ts bunu
 * executeAiTool'a göndermek yerine kendi içinde özel olarak yakalar (hattı kapatır).
 */
const END_CALL_TOOL: FunctionDeclaration = {
  name: "end_call",
  description:
    "Görüşmeyi SONLANDIRIR (telefonu kapatır). SADECE müşteriye veda cümleni SÖYLEDİKTEN SONRA, en son adım olarak çağır — konuşmanın amacı tamamlandığında (randevu onaylandı/iptal edildi, soru cevaplandı ve müşterinin başka isteği yok, veya müşteri kendisi vedalaştı).",
  parameters: { type: Type.OBJECT, properties: {} },
};

/** Arayanın adını öğrendiğinde SESSİZCE kaydeder — bkz. voicePrompt.ts'teki needsCallerName talimatı. */
const SAVE_CUSTOMER_NAME_TOOL: FunctionDeclaration = {
  name: "save_customer_name",
  description: "Müşteriden öğrenilen adını kaydeder. Müşteri ismini söylediğinde sessizce çağır (bunu müşteriye söyleme).",
  parameters: {
    type: Type.OBJECT,
    properties: { full_name: { type: Type.STRING, description: "Müşterinin söylediği ad (soyad varsa dahil)" } },
    required: ["full_name"],
  },
};

export const LIVE_TOOLS: FunctionDeclaration[] = [
  ...AI_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToGeminiSchema(tool.parametersJsonSchema as Record<string, unknown>),
  })),
  END_CALL_TOOL,
  SAVE_CUSTOMER_NAME_TOOL,
];
