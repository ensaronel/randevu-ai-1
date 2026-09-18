import type Anthropic from "@anthropic-ai/sdk";
import { AI_TOOLS } from "../src/lib/ai/tools.js";

/**
 * src/lib/ai/tools.ts'teki AI_TOOLS zaten ham JSON Schema'da yazılmış
 * (`parametersJsonSchema`) — Claude'un `input_schema` alanı da JSON Schema
 * olduğu için (Gemini'nin `toolsAdapter.ts`'teki gibi tip-tip bir çeviriye
 * ihtiyacı yok) burada sadece alan adı değişiyor.
 */
export const CLAUDE_LIVE_TOOLS: Anthropic.Tool[] = [
  ...AI_TOOLS.map((tool) => ({
    // AI_TOOLS'un tipi (@google/genai FunctionDeclaration) name/description'ı opsiyonel
    // sayıyor ama src/lib/ai/tools.ts'teki gerçek dizide ikisi de HER ZAMAN dolu —
    // burada sadece o gevşek tipi daraltıyoruz, veri kaybı yok.
    name: tool.name!,
    description: tool.description ?? "",
    input_schema: tool.parametersJsonSchema as Anthropic.Tool.InputSchema,
  })),
  {
    name: "end_call",
    description:
      "Görüşmeyi SONLANDIRIR (telefonu kapatır). SADECE müşteriye veda cümleni SÖYLEDİKTEN SONRA, en son adım olarak çağır — konuşmanın amacı tamamlandığında (randevu onaylandı/iptal edildi, soru cevaplandı ve müşterinin başka isteği yok, veya müşteri kendisi vedalaştı).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_customer_name",
    description: "Müşteriden öğrenilen adını kaydeder. Müşteri ismini söylediğinde sessizce çağır (bunu müşteriye söyleme).",
    input_schema: {
      type: "object",
      properties: { full_name: { type: "string", description: "Müşterinin söylediği ad (soyad varsa dahil)" } },
      required: ["full_name"],
    },
    // Bir aramadaki HER turda (respond.ts'in aksine, WhatsApp'ta mesaj başına sıfırdan
    // başlıyordu — burada tek bir arama boyunca aynı araç listesi/sistem promptu
    // defalarca gönderiliyor) araç listesi ve sistem promptu birebir aynı kalıyor —
    // son araca cache_control eklemek TÜM tools dizisini önbelleğe alır (Anthropic'in
    // önbellek sınırı kuralı: system'den ÖNCE gelen her şey tek blok sayılır).
    cache_control: { type: "ephemeral" },
  },
];
