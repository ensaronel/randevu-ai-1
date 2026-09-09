import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "http";
import { createHmac } from "crypto";
import { VoiceCallSession } from "./geminiBridge.js";

const PORT = Number(process.env.PORT ?? 3001);
const VOICE_TEST_BUSINESS_ID = process.env.VOICE_TEST_BUSINESS_ID ?? "";

const app = express();
// Render, HTTPS'i kendi proxy'sinde sonlandırıp bize http olarak iletir — Twilio imza
// doğrulaması gerçek https URL'ini bekler, bu olmadan req.protocol yanlışlıkla "http" kalır
// ve TÜM gerçek Twilio istekleri imza uyuşmazlığıyla reddedilir.
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false })); // Twilio form-encoded POST gönderir

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/twilio/stream" });

/**
 * Twilio webhook imza doğrulaması — src/app/api/whatsapp/webhook/route.ts'teki
 * isValidMetaSignature ile AYNI disiplin, Twilio'nun kendi (farklı) algoritmasıyla:
 * tam URL + POST parametrelerinin alfabetik sıralı key+value birleşimi, HMAC-SHA1, base64.
 * https://www.twilio.com/docs/usage/security
 */
function isValidTwilioSignature(
  fullUrl: string,
  params: Record<string, string>,
  signatureHeader: string | undefined
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signatureHeader) return false;

  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], fullUrl);
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  return expected === signatureHeader;
}

app.post("/twilio/voice", (req, res) => {
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  if (!isValidTwilioSignature(fullUrl, req.body, req.header("X-Twilio-Signature"))) {
    console.error("[voice] Geçersiz Twilio imzası, istek reddedildi");
    res.status(403).send("forbidden");
    return;
  }
  if (!VOICE_TEST_BUSINESS_ID) {
    res.status(500).send("VOICE_TEST_BUSINESS_ID ayarlanmamış");
    return;
  }

  const from = String(req.body.From ?? "");
  const wsUrl = `wss://${req.get("host")}/twilio/stream`;

  console.log(`[voice] Gelen arama: ${from}`);
  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="${from}" />
    </Stream>
  </Connect>
</Response>`);
});

app.get("/", (_req, res) => {
  res.send("randevu-ai voice-bridge çalışıyor.");
});

interface TwilioStreamMessage {
  event: "connected" | "start" | "media" | "stop" | "mark";
  start?: { streamSid: string; customParameters?: Record<string, string> };
  media?: { payload: string };
  streamSid?: string;
}

wss.on("connection", (ws: WebSocket) => {
  let streamSid = "";
  let callSession: VoiceCallSession | null = null;

  ws.on("message", (raw) => {
    let msg: TwilioStreamMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.event === "start" && msg.start) {
      streamSid = msg.start.streamSid;
      const from = msg.start.customParameters?.from ?? "";

      if (!VOICE_TEST_BUSINESS_ID) {
        console.error("[voice] VOICE_TEST_BUSINESS_ID ayarlanmamış, arama işlenemiyor");
        ws.close();
        return;
      }

      callSession = new VoiceCallSession(VOICE_TEST_BUSINESS_ID, from, {
        sendAudioToTwilio: (base64MuLaw) => {
          if (ws.readyState !== ws.OPEN) return;
          ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: base64MuLaw } }));
        },
        clearTwilioAudioQueue: () => {
          if (ws.readyState !== ws.OPEN) return;
          ws.send(JSON.stringify({ event: "clear", streamSid }));
        },
      });
      console.log(`[voice] Arama başladı — arayan: ${from || "(bilinmiyor)"}`);
    } else if (msg.event === "media" && msg.media && callSession) {
      void callSession.pushAudio(msg.media.payload);
    } else if (msg.event === "stop") {
      console.log("[voice] Arama bitti");
      void callSession?.stop();
      callSession = null;
    }
  });

  ws.on("close", () => {
    void callSession?.stop();
    callSession = null;
  });
});

server.listen(PORT, () => {
  console.log(`[voice] Köprü sunucusu ${PORT} portunda çalışıyor`);
});
