import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHmac } from "crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendWhatsappTextMessage } from "@/lib/whatsapp/client";
import { generateAiReply } from "@/lib/ai/respond";
import type { Business } from "@/types/database";

/** Zamanlama saldırısına karşı sabit-zamanlı karşılaştırma — uzunluk farklıysa direkt false döner. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Meta, her webhook POST'unda gövdeyi Uygulama Sırrı (App Secret) ile imzalayıp
 * `X-Hub-Signature-256` header'ında gönderir — bu sayede URL'yi bilen herkes değil,
 * sadece gerçekten Meta'dan gelen istekler işlenir.
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
function isValidMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(signatureHeader.slice("sha256=".length), expected);
}

const KVKK_CONSENT_MESSAGE =
  "Merhaba! Randevu talebinizi işleyebilmemiz için telefon numaranız, " +
  "randevu geçmişiniz ve varsa tercih notlarınız KVKK kapsamında işletme " +
  "tarafından saklanacaktır. Devam ederek bunu kabul etmiş olursunuz. " +
  "Size nasıl yardımcı olabiliriz?";

/**
 * Meta, webhook'u abone ederken bu GET ile doğrular:
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
    safeEqual(token, process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
  ) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("forbidden", { status: 403 });
}

interface WhatsappWebhookMessage {
  from: string;
  type: string;
  text?: { body: string };
}

const ESCALATION_OWNER_TEMPLATE = (customerPhone: string, reason: string) =>
  `⚠️ Bir müşteri mesajını AI yanıtlayamadı, sizin dönüş yapmanız gerekiyor.\n` +
  `Müşteri: ${customerPhone}\nSebep: ${reason}`;

const SYSTEM_ERROR_OWNER_TEMPLATE = (customerPhone: string, detail: string) =>
  `🔴 Sistemde bir hata oluştu, bir müşteri mesajı işlenemedi.\n` +
  `Müşteri: ${customerPhone}\nDetay: ${detail}\nLütfen müşteriye elle dönüş yapın.`;

const SYSTEM_ERROR_CUSTOMER_FALLBACK =
  "Şu an sistemimizde teknik bir sorun oluştu, ekibimiz en kısa sürede size dönüş yapacak. 🙏";

/** Beklenmeyen bir hata olduğunda işletme sahibini WhatsApp'tan uyarır — best-effort, kendi hatası bile olsa akışı kesmez. */
async function notifyOwnerOfSystemError(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  businessId: string,
  customerPhone: string,
  detail: string
) {
  try {
    const { data: owner } = await admin
      .from("business_owners")
      .select("phone")
      .eq("business_id", businessId)
      .maybeSingle();
    if (owner?.phone) {
      await sendWhatsappTextMessage(owner.phone, SYSTEM_ERROR_OWNER_TEMPLATE(customerPhone, detail));
    }
  } catch (err) {
    console.error("İşletme sahibine hata bildirimi gönderilemedi:", err);
  }
}

/**
 * Gelen WhatsApp mesajlarını işler: müşteriyi bul/oluştur, mesajı logla,
 * ilk temasta KVKK onay metnini otomatik gönderir, ardından AI'ın ürettiği
 * yanıtı gönderir. AI anlayamazsa/eskale ederse sabit bir "döneceğiz" mesajı
 * gider ve işletme sahibi WhatsApp'tan uyarılır (bkz. src/lib/ai/respond.ts).
 * Meta yeniden denemesin diye hata durumlarında bile her zaman 200 döner
 * (kendi loglarımıza yazıp burada susuyoruz).
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!isValidMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return new NextResponse("forbidden", { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }
  if (!payload) return NextResponse.json({ ok: true });

  const admin = createAdminSupabaseClient();

  const entries = payload.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
      const messages: WhatsappWebhookMessage[] = value.messages ?? [];
      const contacts: { wa_id?: string; profile?: { name?: string } }[] = value.contacts ?? [];

      if (!phoneNumberId || messages.length === 0) continue;

      const { data: business } = await admin
        .from("businesses")
        .select("*")
        .eq("whatsapp_phone_number_id", phoneNumberId)
        .maybeSingle();

      if (!business) continue;

      for (const message of messages) {
        try {
          const body = message.text?.body ?? null;

          let { data: customer } = await admin
            .from("customers")
            .select("*")
            .eq("business_id", business.id)
            .eq("phone", message.from)
            .maybeSingle();

          if (!customer) {
            // WhatsApp'ın kendi kişi bilgisinde genelde müşterinin profil adı gelir
            // (contacts[].profile.name) — bulunursa gerçek isim olarak kullanılır,
            // yoksa (nadiren, gizlilik ayarına göre) telefon numarasına düşülür.
            const waProfileName = contacts.find((c) => c.wa_id === message.from)?.profile?.name;
            const { data: newCustomer } = await admin
              .from("customers")
              .insert({ business_id: business.id, full_name: waProfileName || message.from, phone: message.from })
              .select()
              .single();
            customer = newCustomer;
          }

          if (!customer || !body) continue;

          // AI, henüz DB'ye yazılmamış geçmişi okuyacağı için çağrıyı inbound
          // log satırından önce başlatıyoruz — aksi halde bu mesaj geçmişte
          // iki kez görünür (bir kez history'de, bir kez son user turn'de).
          const aiReplyPromise = generateAiReply(business as Business, customer, body);

          await admin.from("whatsapp_message_log").insert({
            business_id: business.id,
            customer_id: customer.id,
            direction: "inbound",
            message_type: "freeform",
            body,
          });

          if (!customer.kvkk_consent_at) {
            await admin
              .from("customers")
              .update({ kvkk_consent_at: new Date().toISOString() })
              .eq("id", customer.id);

            await sendWhatsappTextMessage(message.from, KVKK_CONSENT_MESSAGE).catch((err) =>
              console.error("KVKK mesajı gönderilemedi:", err)
            );

            await admin.from("whatsapp_message_log").insert({
              business_id: business.id,
              customer_id: customer.id,
              direction: "outbound",
              message_type: "freeform",
              body: KVKK_CONSENT_MESSAGE,
            });
          }

          const aiReply = await aiReplyPromise.catch((err) => {
            console.error("AI yanıtı üretilemedi:", err);
            return null;
          });

          if (!aiReply) {
            await sendWhatsappTextMessage(message.from, SYSTEM_ERROR_CUSTOMER_FALLBACK).catch((err) =>
              console.error("Hata fallback mesajı gönderilemedi:", err)
            );
            await admin.from("whatsapp_message_log").insert({
              business_id: business.id,
              customer_id: customer.id,
              direction: "outbound",
              message_type: "freeform",
              body: SYSTEM_ERROR_CUSTOMER_FALLBACK,
              ai_confidence: 0,
              escalated: true,
            });
            await notifyOwnerOfSystemError(admin, business.id, message.from, "AI yanıtı üretilemedi");
            continue;
          }

          await sendWhatsappTextMessage(message.from, aiReply.replyText).catch((err) =>
            console.error("AI yanıtı gönderilemedi:", err)
          );

          await admin.from("whatsapp_message_log").insert({
            business_id: business.id,
            customer_id: customer.id,
            direction: "outbound",
            message_type: "freeform",
            body: aiReply.replyText,
            ai_confidence: aiReply.escalated ? 0 : 1,
            escalated: aiReply.escalated,
          });

          if (aiReply.escalated && aiReply.ownerPhone) {
            await sendWhatsappTextMessage(
              aiReply.ownerPhone,
              ESCALATION_OWNER_TEMPLATE(message.from, aiReply.escalationReason ?? "belirtilmedi")
            ).catch((err) => console.error("Eskalasyon bildirimi gönderilemedi:", err));
          }
        } catch (err) {
          // Bu mesajda ne olursa olsun (beklenmeyen DB/ağ hatası dahil) diğer
          // mesajların işlenmesi durmasın, işletme sahibi bilgilendirilsin.
          console.error("Mesaj işlenirken beklenmeyen hata:", err);
          await notifyOwnerOfSystemError(
            admin,
            business.id,
            message.from,
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
