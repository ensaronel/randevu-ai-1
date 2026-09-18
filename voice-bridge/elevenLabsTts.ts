/**
 * `@elevenlabs/elevenlabs-js` paketinin `stream()` metodu denendi (2026-09-16) ama
 * yanıt hiç çözülmeden sonsuza dek asılı kaldı (SDK'nın kendi hatası — aynı istek ham
 * `fetch` ile deneyince anında ve doğru çalıştı). Bu yüzden SDK'ya bağımlı olunmadan
 * doğrudan REST uç noktası kullanılıyor.
 */
const ELEVENLABS_STREAM_URL = (voiceId: string, outputFormat: string) =>
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}`;

// Flash v2.5, Türkçe dahil onlarca dili destekliyor (canlı test edildi) ve gerçek-zamanlı
// konuşma için özel olarak optimize edilmiş — 2026-09-17'de ölçüldü: multilingual_v2 ile
// ilk ses parçası ~2.7sn'de geliyordu, Flash v2.5 ile ~0.7sn'de (kalite çok az fark
// ediyor, gecikme sesli AI için kaliteden daha kritik). Sesin kendisi (voice_id) dilden
// bağımsız, model metnin dilini kendisi algılayıp o dilde okuyor.
const MODEL_ID = "eleven_flash_v2_5";
// ElevenLabs'in premade (varsayılan, her hesapta hazır bulunan) seslerinden biri —
// "voices_read" izni olmayan kısıtlı anahtarlarla bile çalışır çünkü listelemeye değil
// doğrudan bilinen bir voice_id'ye sentezlemeye dayanıyor. 2026-09-18'de canlı API'den
// doğrulandı: eski ID ("George") aslında ERKEK bir İngiliz sesiydi — kullanıcının istediği
// "açık ve net kadın sesi" için hesaptaki seslerin etiketlerine bakılarak "Alice" seçildi
// (labels.gender: female, açıklaması tam olarak "Clear, Engaging Educator").
const VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"; // Alice — Clear, Engaging Educator (female)

export type TtsOutputFormat = "ulaw_8000" | "pcm_24000";

/** Metni sese çevirip geldikçe (streaming) Buffer parçaları döner — tamamı bitmeden ilk parça Twilio'ya gönderilebilsin diye. */
export async function* synthesizeSpeechStream(text: string, outputFormat: TtsOutputFormat): AsyncGenerator<Buffer> {
  const res = await fetch(ELEVENLABS_STREAM_URL(VOICE_ID, outputFormat), {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS hatası: ${res.status} ${body}`);
  }

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    yield Buffer.from(chunk);
  }
}
