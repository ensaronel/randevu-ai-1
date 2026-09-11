/**
 * Twilio Media Streams μ-law 8kHz <-> Gemini Live PCM16 (16kHz giriş / 24kHz çıkış) dönüşümü.
 * Harici bir codec paketine bağımlı olmamak için standart ITU-T G.711 μ-law algoritması
 * elle yazıldı — bu algoritma sabit/iyi belgelenmiş bir bit-manipülasyonu, DSP riski yok.
 * Örnekleme oranı dönüşümü basit lineer enterpolasyon ile yapılıyor — telefon hattı kalitesi
 * (8kHz) için yeterli, daha karmaşık bir filtreye ihtiyaç yok.
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** Tek bir 16-bit PCM örneğini μ-law byte'a çevirir. */
function encodeMuLawSample(sampleIn: number): number {
  let sample = sampleIn;
  const sign = sample < 0 ? 0x80 : 0;
  if (sign) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const muLawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return muLawByte;
}

/** Tek bir μ-law byte'ı 16-bit PCM örneğine çevirir. */
function decodeMuLawSample(muLawByteIn: number): number {
  const muLawByte = ~muLawByteIn & 0xff;
  const sign = muLawByte & 0x80;
  const exponent = (muLawByte >> 4) & 0x07;
  const mantissa = muLawByte & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

/** Twilio'dan gelen μ-law 8kHz buffer'ı -> 16-bit PCM (little-endian) Int16Array, hâlâ 8kHz. */
export function muLawBufferToPcm16(muLaw: Buffer): Int16Array {
  const pcm = new Int16Array(muLaw.length);
  for (let i = 0; i < muLaw.length; i++) {
    pcm[i] = decodeMuLawSample(muLaw[i]);
  }
  return pcm;
}

/** PCM16 (herhangi bir oranda) -> μ-law Buffer, aynı oranda (önce resample çağrılmalı). */
export function pcm16ToMuLawBuffer(pcm: Int16Array): Buffer {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = encodeMuLawSample(pcm[i]);
  }
  return out;
}

/** Basit lineer enterpolasyonla örnekleme oranı dönüşümü (ör. 8000 -> 16000, 24000 -> 8000). */
export function resamplePcm16(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input;

  // Örnekleme oranı DÜŞÜRÜLÜYORSA (ör. tarayıcının 48kHz mikrofonundan Gemini'nin
  // istediği 16kHz'e), önce basit bir alçak-geçiren filtre uygulanmalı — aksi halde
  // Nyquist sınırının (toRate/2) üzerindeki frekanslar (Türkçe'deki "s/ş/ç" gibi tiz
  // sessizler tam da bu bantta) katlanıp (aliasing) gürültüye dönüşüyor, bu da konuşma
  // tanımayı bozup modelin yanlış/anlamsız şeyler duymasına yol açıyor (2026-09-09'da
  // gözlemlendi: transkriptte anlamsız/yabancı kelimeler çıkıyordu). Yükseltme
  // (upsampling, ör. Twilio'nun 8kHz'i) için filtreye gerek yok, aliasing riski yok.
  let source = input;
  if (toRate < fromRate) {
    const cutoffHz = toRate / 2;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / fromRate);
    const filtered = new Int16Array(input.length);
    let prev = input[0] ?? 0;
    for (let i = 0; i < input.length; i++) {
      prev = prev + alpha * (input[i] - prev);
      filtered[i] = Math.round(prev);
    }
    source = filtered;
  }

  const ratio = toRate / fromRate;
  const outLength = Math.round(source.length * ratio);
  const output = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;
    const s0 = source[srcIndex] ?? source[source.length - 1] ?? 0;
    const s1 = source[srcIndex + 1] ?? s0;
    output[i] = Math.round(s0 + (s1 - s0) * frac);
  }
  return output;
}

/** Int16Array -> little-endian Buffer (Gemini'ye base64 olarak gönderilecek ham PCM16). */
export function int16ArrayToBuffer(pcm: Int16Array): Buffer {
  const buf = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    buf.writeInt16LE(pcm[i], i * 2);
  }
  return buf;
}

/** little-endian PCM16 Buffer -> Int16Array (Gemini'den base64 çözüldükten sonra). */
export function bufferToInt16Array(buf: Buffer): Int16Array {
  const pcm = new Int16Array(buf.length / 2);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = buf.readInt16LE(i * 2);
  }
  return pcm;
}

/** Twilio μ-law 8kHz base64 -> Gemini'nin beklediği PCM16 16kHz base64. */
export function twilioMuLawToGeminiPcm16(base64MuLaw: string): string {
  const muLawBuf = Buffer.from(base64MuLaw, "base64");
  const pcm8k = muLawBufferToPcm16(muLawBuf);
  const pcm16k = resamplePcm16(pcm8k, 8000, 16000);
  return int16ArrayToBuffer(pcm16k).toString("base64");
}

/** Gemini'nin ürettiği PCM16 24kHz base64 -> Twilio'nun beklediği μ-law 8kHz base64. */
export function geminiPcm16ToTwilioMuLaw(base64Pcm24k: string): string {
  const pcm24k = bufferToInt16Array(Buffer.from(base64Pcm24k, "base64"));
  const pcm8k = resamplePcm16(pcm24k, 24000, 8000);
  return pcm16ToMuLawBuffer(pcm8k).toString("base64");
}
