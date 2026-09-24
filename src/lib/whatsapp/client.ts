const GRAPH_API_VERSION = "v21.0";

/**
 * Demo/tanıtım verisindeki SAHTE müşteri numaraları (bkz. scripts/demo). "9000000" ile başlayan
 * numaralar gerçek bir hat OLAMAZ (Türkiye numaralarında abone numarası 0 ile başlamaz), bu yüzden
 * Meta'ya hiç gönderilmez: demoda "Hepsini Onayla" / anket / hatırlatma akışları hata vermeden
 * çalışıyor gibi görünür ve gerçek kimseye ulaşmaz. Gerçek numaralara hiçbir etkisi yok.
 */
export function isDemoPhone(phone: string): boolean {
  return /^9000000\d{5}$/.test(phone.replace(/\D/g, ""));
}

/**
 * WhatsApp Cloud API'ye serbest metin mesajı gönderir. 24 saatlik müşteri-
 * başlatımlı pencere dışında (örn. hatırlatma) bunun yerine onaylı bir şablon
 * göndermek gerekir — Hafta 6/9'da eklenecek, bu fonksiyon şimdilik sadece
 * webhook'a gelen mesajlara serbest metinle yanıt için kullanılıyor.
 */
export async function sendWhatsappTextMessage(to: string, body: string) {
  if (isDemoPhone(to)) {
    console.log("[whatsapp] demo numarası, Meta'ya gönderilmedi (metin)");
    return { demo: true };
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    }
  );

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`whatsapp_send_failed: ${res.status} ${errorBody}`);
  }

  return res.json();
}

/**
 * WhatsApp Cloud API'ye Meta-onaylı bir ŞABLON mesajı gönderir — 24 saatlik
 * müşteri-başlatımlı pencere dışında (hatırlatmalar, proaktif öneriler) tek
 * yasal yol bu. `bodyParams`, şablonun gövdesindeki {{1}}, {{2}}, ... yerine
 * sırayla geçer. `templateName` Meta'da tam olarak onaylanan isimle (örn.
 * "randevu_hatirlatma") birebir eşleşmeli, aksi halde Meta reddeder.
 */
export async function sendWhatsappTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[]
) {
  if (isDemoPhone(to)) {
    console.log(`[whatsapp] demo numarası, Meta'ya gönderilmedi (şablon: ${templateName})`);
    return { demo: true };
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            {
              type: "body",
              parameters: bodyParams.map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
    }
  );

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`whatsapp_template_send_failed: ${res.status} ${errorBody}`);
  }

  return res.json();
}
