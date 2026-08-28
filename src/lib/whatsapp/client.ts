const GRAPH_API_VERSION = "v21.0";

/**
 * WhatsApp Cloud API'ye serbest metin mesajı gönderir. 24 saatlik müşteri-
 * başlatımlı pencere dışında (örn. hatırlatma) bunun yerine onaylı bir şablon
 * göndermek gerekir — Hafta 6/9'da eklenecek, bu fonksiyon şimdilik sadece
 * webhook'a gelen mesajlara serbest metinle yanıt için kullanılıyor.
 */
export async function sendWhatsappTextMessage(to: string, body: string) {
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
