import WebSocket from "ws";

/**
 * `@deepgram/sdk` paketiyle canlı bağlantı denendi (2026-09-16) ama sessizce hiç
 * açılmadı/hiçbir olay tetiklemedi (SDK'nın kendi hatası — API anahtarı ve
 * parametreler ayrı ayrı doğrulandı, ikisi de doğruydu). Ham WebSocket ile AYNI
 * parametrelerle bağlantı sorunsuz açıldı, bu yüzden SDK'ya hiç bağımlı olunmadan
 * doğrudan protokol kullanılıyor.
 */
const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";

export type DeepgramEncoding = "mulaw" | "linear16";

export interface DeepgramTranscript {
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
}

interface DeepgramCallbacks {
  onTranscript: (t: DeepgramTranscript) => void;
  onUtteranceEnd: () => void;
  // vad_events:true sayesinde Deepgram, konuşma başlar başlamaz (herhangi bir transkript
  // beklemeden) bu olayı gönderir — barge-in (müşteri AI konuşurken araya girer) için
  // en erken, en hızlı sinyal budur (bkz. cascadedBridge.ts'teki handleBargeIn).
  onSpeechStarted: () => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

/** Bir aramalık Deepgram canlı transkripsiyon bağlantısı. */
export class DeepgramSttSession {
  private ws: WebSocket;
  private ready: Promise<void>;

  constructor(encoding: DeepgramEncoding, sampleRate: number, callbacks: DeepgramCallbacks) {
    const params = new URLSearchParams({
      model: "nova-3",
      language: "tr",
      encoding,
      sample_rate: String(sampleRate),
      endpointing: "350",
      interim_results: "true",
      utterance_end_ms: "1000",
      vad_events: "true",
      smart_format: "true",
    });

    this.ws = new WebSocket(`${DEEPGRAM_URL}?${params.toString()}`, {
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
    });

    this.ready = new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });

    this.ws.on("error", (err) => callbacks.onError(err));
    this.ws.on("close", () => callbacks.onClose());
    this.ws.on("message", (raw) => {
      let msg: { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "Results") {
        const transcript = msg.channel?.alternatives?.[0]?.transcript ?? "";
        if (!transcript) return;
        callbacks.onTranscript({
          transcript,
          isFinal: !!msg.is_final,
          speechFinal: !!msg.speech_final,
        });
      } else if (msg.type === "UtteranceEnd") {
        callbacks.onUtteranceEnd();
      } else if (msg.type === "SpeechStarted") {
        callbacks.onSpeechStarted();
      }
    });
  }

  async pushAudio(chunk: Buffer): Promise<void> {
    await this.ready;
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(chunk);
  }

  /**
   * Deepgram, ses akışı ~10-12sn boyunca hiç veri almazsa bağlantıyı KENDİLİĞİNDEN
   * kapatıyor (2026-09-18'de canlı testte yakalandı: AI'nin uzun bir cevabı TTS ile
   * çalınırken - isTtsPlaying penceresi boyunca kasıtlı olarak hiç mikrofon sesi
   * gönderilmiyor, bkz. cascadedBridge.ts'teki yorum - bu süre Deepgram'ın eşiğini
   * aşınca bağlantı sessizce koptu, ardından müşteri konuşsa bile STT hiç çalışmadı ve
   * görüşme "ölü hava" zaman aşımıyla kendiliğinden kapandı). Deepgram'ın resmi
   * dokümantasyonundaki KeepAlive mesajı tam bunun için var - gerçek ses göndermeden
   * bağlantıyı canlı tutar.
   */
  sendKeepAlive(): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify({ type: "KeepAlive" }));
  }

  close(): void {
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) {
      try {
        this.ws.close();
      } catch {
        // zaten kapanıyor olabilir, yut
      }
    }
  }
}
