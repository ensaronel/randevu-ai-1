/**
 * Twilio REST API'sine doğrudan fetch ile erişir — `twilio` npm paketi sadece
 * voice-bridge'de var (ayrı bir Node süreci), ana Next.js projesine ağır bir
 * bağımlılık eklememek için burada sadece birkaç HTTP çağrısı olduğundan ham
 * fetch kullanılıyor.
 */
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

function twilioAuthHeader(): string {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio kimlik bilgileri (.env: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN) tanımlı değil.");
  }
  return "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
}

/**
 * Türkiye'de satın alınabilir bir numara arar (0850 formatı — "National").
 * Twilio TR numaraları için önce hesapta bir "Regulatory Bundle" (kimlik
 * doğrulama) onayı gerekiyor — bu onay yoksa Twilio 404/21421 gibi bir hata
 * döner, bu fonksiyon o durumda `null` döner (çağıran taraf anlamlı bir
 * mesaj gösterir, ham Twilio hatasını sızdırmaz).
 */
export async function findAvailableTurkishNumber(): Promise<string | null> {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/TR/National.json?VoiceEnabled=true&PageSize=1`,
    { headers: { Authorization: twilioAuthHeader() } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const first = data.available_phone_numbers?.[0];
  return first?.phone_number ?? null;
}

/**
 * Bulunan numarayı satın alır. `purpose: "voice"` ise gelen aramaları
 * voice-bridge'in Twilio webhook'una (/twilio/voice) yönlendirecek şekilde
 * ayarlar — bunun için VOICE_BRIDGE_URL gerçek, dışarıdan erişilebilir bir
 * adres olmalı (Render'a deploy edildikten sonra), yoksa bu numaraya gelen
 * aramalar hiçbir yere gitmez, o yüzden bu durumda satın alma bilinçli
 * olarak engellenir. `purpose: "whatsapp"` numaraları Meta Business
 * Manager'da AYRI, hâlâ manuel bir kayıt/doğrulama adımı gerektirir —
 * burada sadece ham numara satın alınır, bir Voice URL'ye ihtiyaç yoktur.
 */
export async function purchasePhoneNumber(
  phoneNumber: string,
  purpose: "voice" | "whatsapp"
): Promise<{ sid: string; phoneNumber: string }> {
  const params: Record<string, string> = { PhoneNumber: phoneNumber };

  if (purpose === "voice") {
    const voiceBridgeUrl = process.env.VOICE_BRIDGE_URL;
    if (!voiceBridgeUrl) {
      throw new Error(
        "VOICE_BRIDGE_URL tanımlı değil — voice-bridge henüz gerçek bir adrese (ör. Render) deploy edilmeden sesli numara satın alınamaz, aksi halde gelen aramalar hiçbir yere gitmez."
      );
    }
    params.VoiceUrl = `${voiceBridgeUrl}/twilio/voice`;
    params.VoiceMethod = "POST";
  }

  const body = new URLSearchParams(params);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`, {
    method: "POST",
    headers: {
      Authorization: twilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Twilio numara satın alma hatası: ${data.message ?? res.status}`);
  }

  return { sid: data.sid, phoneNumber: data.phone_number };
}
