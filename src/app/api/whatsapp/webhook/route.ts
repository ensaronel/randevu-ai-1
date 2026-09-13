import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHmac } from "crypto";
import * as Sentry from "@sentry/nextjs";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendWhatsappTextMessage } from "@/lib/whatsapp/client";
import { generateAiReply } from "@/lib/ai/respond";
import { aiReplyLimiter, isRateLimited } from "@/lib/rateLimit";
import { DAILY_SURVEY_SENT_LOG_BODY, SURVEY_FEEDBACK_WINDOW_HOURS } from "@/lib/dailySurvey";
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
  "randevu geçmişiniz ve mesajlarınız KVKK kapsamında işletme tarafından " +
  "ve yapay zeka destekli sistemimiz (Google) aracılığıyla işlenip " +
  "saklanacaktır. Detaylar: https://randevu-ai-1.vercel.app/gizlilik — " +
  "Devam ederek bunu kabul etmiş olursunuz. Size nasıl yardımcı olabiliriz?";

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

const UNSUPPORTED_MESSAGE_TYPE_FALLBACK = "Şu an sadece yazılı mesajları okuyabiliyorum 🙏";

const SURVEY_FEEDBACK_THANK_YOU = "Değerli geri bildiriminiz için çok teşekkür ederiz! 🙏";

/**
 * Bu müşteriye SURVEY_FEEDBACK_WINDOW_HOURS içinde gün sonu anketi gönderildi mi?
 * Gönderildiyse, müşterinin bu penceredeki cevabı normal randevu AI'ına değil,
 * doğrudan bir geri bildirim olarak ele alınır (bkz. POST handler).
 */
async function findRecentSurveySend(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  businessId: string,
  customerId: string
) {
  const cutoff = new Date(Date.now() - SURVEY_FEEDBACK_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("whatsapp_message_log")
    .select("id")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("direction", "outbound")
    .eq("body", DAILY_SURVEY_SENT_LOG_BODY)
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();
  return !!data;
}

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
    Sentry.captureException(err);
  }
}

/** Müşterinin ilk teması ise KVKK aydınlatma metnini gönderip onay tarihini damgalar — değilse hiçbir şey yapmaz. */
async function ensureKvkkConsent(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  businessId: string,
  customer: { id: string; phone: string; kvkk_consent_at: string | null }
) {
  if (customer.kvkk_consent_at) return;

  await admin.from("customers").update({ kvkk_consent_at: new Date().toISOString() }).eq("id", customer.id);

  await sendWhatsappTextMessage(customer.phone, KVKK_CONSENT_MESSAGE).catch((err) =>
    console.error("KVKK mesajı gönderilemedi:", err)
  );

  await admin.from("whatsapp_message_log").insert({
    business_id: businessId,
    customer_id: customer.id,
    direction: "outbound",
    message_type: "system_notice",
    body: KVKK_CONSENT_MESSAGE,
  });
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

      // Hesap pasifse (elle kapatma anahtarı) gelen mesajlar hiç işlenmez.
      if (!business || !business.is_active) continue;

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
            const { data: newCustomer, error: insertErr } = await admin
              .from("customers")
              .insert({ business_id: business.id, full_name: waProfileName || message.from, phone: message.from })
              .select()
              .single();

            if (insertErr?.code === "23505") {
              // Aynı numaradan eşzamanlı ikinci mesaj yarışıp müşteriyi az önce
              // oluşturmuş olabilir — hatayı yutup silmek yerine gerçek satırı okuyoruz.
              const { data: raceCustomer } = await admin
                .from("customers")
                .select("*")
                .eq("business_id", business.id)
                .eq("phone", message.from)
                .maybeSingle();
              customer = raceCustomer;
            } else {
              customer = newCustomer;
            }
          }

          if (!customer) continue;

          if (!body) {
            // Metin dışı mesaj (resim/konum/ses vb.) — sessizce atlamak yerine
            // logluyor ve müşteriye kısa bir açıklama gönderiyoruz.
            await admin.from("whatsapp_message_log").insert({
              business_id: business.id,
              customer_id: customer.id,
              direction: "inbound",
              message_type: "freeform",
              body: `[desteklenmeyen mesaj türü: ${message.type}]`,
            });

            await ensureKvkkConsent(admin, business.id, customer);

            await sendWhatsappTextMessage(message.from, UNSUPPORTED_MESSAGE_TYPE_FALLBACK).catch((err) => {
              console.error("Desteklenmeyen mesaj türü fallback'i gönderilemedi:", err);
              Sentry.captureException(err);
            });
            await admin.from("whatsapp_message_log").insert({
              business_id: business.id,
              customer_id: customer.id,
              direction: "outbound",
              message_type: "system_notice",
              body: UNSUPPORTED_MESSAGE_TYPE_FALLBACK,
            });
            continue;
          }

          // Gun sonu anketi gonderilmis bir musteriden gelen cevap, normal randevu
          // AI'ina hic gitmez - anlamsizca "nasil yardimci olabilirim" gibi bir
          // cevap uretmesin diye, dogrudan geri bildirim olarak kaydedilip
          // musteriye kisa bir tesekkur mesaji gonderilir.
          if (await findRecentSurveySend(admin, business.id, customer.id)) {
            await admin.from("whatsapp_message_log").insert({
              business_id: business.id,
              customer_id: customer.id,
              direction: "inbound",
              message_type: "freeform",
              body,
            });

            await admin.from("action_objects").insert({
              business_id: business.id,
              type: "survey_feedback",
              related_customer_id: customer.id,
              suggestion: "Müşteri anket geri bildirimi",
              reasoning: body,
              status: "resolved",
              resolved_at: new Date().toISOString(),
            });

            await sendWhatsappTextMessage(message.from, SURVEY_FEEDBACK_THANK_YOU).catch((err) => {
              console.error("Anket teşekkür mesajı gönderilemedi:", err);
              Sentry.captureException(err);
            });
            await admin.from("whatsapp_message_log").insert({
              business_id: business.id,
              customer_id: customer.id,
              direction: "outbound",
              message_type: "system_notice",
              body: SURVEY_FEEDBACK_THANK_YOU,
            });
            continue;
          }

          // Paylasilan Gemini ucretsiz-katman kotasini tek bir musterinin spam'inden
          // korur - asiri istekte AI hic cagrilmaz, kisa bir bekleme mesaji gider.
          if (await isRateLimited(aiReplyLimiter, `customer:${customer.id}`)) {
            await admin.from("whatsapp_message_log").insert({
              business_id: business.id,
              customer_id: customer.id,
              direction: "inbound",
              message_type: "freeform",
              body,
            });
            await sendWhatsappTextMessage(
              message.from,
              "Kısa sürede çok fazla mesaj gönderdiniz, biraz bekleyip tekrar yazar mısınız? 🙏"
            ).catch((err) => {
              console.error("Rate limit mesajı gönderilemedi:", err);
              Sentry.captureException(err);
            });
            continue;
          }

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

          await ensureKvkkConsent(admin, business.id, customer);

          const aiReply = await aiReplyPromise.catch((err) => {
            console.error("AI yanıtı üretilemedi:", err);
            Sentry.captureException(err);
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
              message_type: "system_notice",
              body: SYSTEM_ERROR_CUSTOMER_FALLBACK,
              ai_confidence: 0,
              escalated: true,
            });
            await notifyOwnerOfSystemError(admin, business.id, message.from, "AI yanıtı üretilemedi");
            continue;
          }

          await sendWhatsappTextMessage(message.from, aiReply.replyText).catch(async (err) => {
            console.error("AI yanıtı gönderilemedi:", err);
            Sentry.captureException(err);
            // Musteri cevabi hic alamadi ve bunu fark edecek kimse yoktu (sessizce
            // konsola dusuyordu) - sahibe de haber verilsin ki takip edebilsin.
            await notifyOwnerOfSystemError(
              admin,
              business.id,
              message.from,
              `Yanıt gönderilemedi: ${err instanceof Error ? err.message : String(err)}`
            );
          });

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
            ).catch((err) => {
              console.error("Eskalasyon bildirimi gönderilemedi:", err);
              Sentry.captureException(err);
            });
          }
        } catch (err) {
          // Bu mesajda ne olursa olsun (beklenmeyen DB/ağ hatası dahil) diğer
          // mesajların işlenmesi durmasın, işletme sahibi bilgilendirilsin.
          console.error("Mesaj işlenirken beklenmeyen hata:", err);
          Sentry.captureException(err);
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
