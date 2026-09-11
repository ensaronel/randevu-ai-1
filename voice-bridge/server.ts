import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "http";
import { createHmac } from "crypto";
import twilio from "twilio";
import { VoiceCallSession } from "./geminiBridge.js";
import { resolveBusinessIdForTwilioNumber } from "./businessLookup.js";
import { isCallRateLimited } from "./rateLimit.js";
import { createAdminSupabaseClient } from "../src/lib/supabase/admin.js";

const PORT = Number(process.env.PORT ?? 3001);
// Sadece tarayici-uzerinden test yolu (public/call.html) icin - Twilio uzerinden
// GERCEK aramalar artik aranan numaraya (To) bakarak isletmeyi kendisi buluyor,
// bkz. resolveBusinessIdForTwilioNumber. Bu sabit SADECE browserWss'te kullanilir.
const VOICE_TEST_BUSINESS_ID = process.env.VOICE_TEST_BUSINESS_ID ?? "";
const admin = createAdminSupabaseClient();

const app = express();
// Render, HTTPS'i kendi proxy'sinde sonlandırıp bize http olarak iletir — Twilio imza
// doğrulaması gerçek https URL'ini bekler, bu olmadan req.protocol yanlışlıkla "http" kalır
// ve TÜM gerçek Twilio istekleri imza uyuşmazlığıyla reddedilir.
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false })); // Twilio form-encoded POST gönderir
app.use(express.static("public")); // tarayıcıdan-arama test sayfası (public/call.html)

const server = createServer(app);
// noServer: true kullanılıyor çünkü {server, path} ile kurulan iki ayrı WebSocketServer
// aynı http.Server'daki HER 'upgrade' olayını ikisi de dinliyor (ws, path eşleşmesini
// kendi içinde kontrol edip uyuşmazsa soketi 400 ile kapatıyor) — önce kaydedilen /twilio/stream
// sunucusu, /browser/stream isteklerini görür görmez path uyuşmazlığından soketi kapatıyordu,
// browserWss'e sıra hiç gelmiyordu. Tek bir 'upgrade' dinleyicisiyle path'e göre elle
// yönlendirmek bunu önlüyor.
const wss = new WebSocketServer({ noServer: true });
const browserWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const pathname = req.url?.split("?")[0];
  if (pathname === "/twilio/stream") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else if (pathname === "/browser/stream") {
    browserWss.handleUpgrade(req, socket, head, (ws) => browserWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

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

app.post("/twilio/voice", async (req, res) => {
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  if (!isValidTwilioSignature(fullUrl, req.body, req.header("X-Twilio-Signature"))) {
    console.error("[voice] Geçersiz Twilio imzası, istek reddedildi");
    res.status(403).send("forbidden");
    return;
  }

  const from = String(req.body.From ?? "");
  const to = String(req.body.To ?? "");

  if (from && (await isCallRateLimited(from))) {
    console.error(`[voice] Arama sınırı aşıldı: ${from}`);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="tr-TR">Kısa sürede çok fazla arama aldık, lütfen biraz sonra tekrar arayın.</Say>
  <Hangup />
</Response>`);
    return;
  }

  const businessId = await resolveBusinessIdForTwilioNumber(admin, to);

  if (!businessId) {
    console.error(`[voice] Aranan numaraya (${to}) bağlı aktif bir işletme bulunamadı`);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="tr-TR">Üzgünüz, bu hat şu anda hizmet vermiyor.</Say>
  <Hangup />
</Response>`);
    return;
  }

  const wsUrl = `wss://${req.get("host")}/twilio/stream`;

  console.log(`[voice] Gelen arama: ${from} -> işletme ${businessId} (${to})`);
  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="${from}" />
      <Parameter name="businessId" value="${businessId}" />
    </Stream>
  </Connect>
</Response>`);
});

app.get("/", (_req, res) => {
  res.send("randevu-ai voice-bridge çalışıyor.");
});

/**
 * Tarayıcı üzerinden test araması için Twilio Voice SDK'ye kısa ömürlü bir erişim
 * jetonu üretir. Gerçek telefon numarası satın alma/doğrulama gerektirmeyen, deneme
 * hesabında da tamamen çalışan bir test yolu — public/call.html bu jetonu kullanır.
 */
app.get("/voice-token", (_req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWIML_APP_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET || !TWIML_APP_SID) {
    res.status(500).json({ error: "Twilio Voice SDK env değişkenleri eksik" });
    return;
  }

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, {
    identity: "test_kullanici",
    ttl: 3600,
  });
  token.addGrant(
    new VoiceGrant({ outgoingApplicationSid: TWIML_APP_SID, incomingAllow: false })
  );

  res.json({ token: token.toJwt() });
});

interface TwilioStreamMessage {
  event: "connected" | "start" | "media" | "stop" | "mark";
  start?: { streamSid: string; customParameters?: Record<string, string> };
  media?: { payload: string };
  mark?: { name: string };
  streamSid?: string;
}

/** AI'nin end_call aracıyla gönderdiği "mark" isimlendirmesi - Twilio bunu yalnızca kuyruktaki TÜM sesi gerçekten çaldıktan SONRA geri yansıtır, bu yüzden veda cümlesi kesilmeden tam olarak doğru anda hattı kapatmamızı sağlıyor. */
const CALL_END_MARK_NAME = "call_end";

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
      const businessId = msg.start.customParameters?.businessId ?? "";

      if (!businessId) {
        // /twilio/voice zaten businessId'siz bir aramayi hic buraya baglamiyor -
        // buraya duserse beklenmedik bir durumdur, guvenli tarafta kalip kapat.
        console.error("[voice] Stream parametresinde businessId yok, arama işlenemiyor");
        ws.close();
        return;
      }

      callSession = new VoiceCallSession(businessId, from, {
        sendAudioToClient: (base64MuLaw) => {
          if (ws.readyState !== ws.OPEN) return;
          ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: base64MuLaw } }));
        },
        clearClientAudioQueue: () => {
          if (ws.readyState !== ws.OPEN) return;
          ws.send(JSON.stringify({ event: "clear", streamSid }));
        },
        endCall: () => {
          if (ws.readyState !== ws.OPEN) return;
          // Hemen ws.close() cagirmiyoruz - kuyrukta hala calinmamis veda sesi
          // olabilir, mark bunun gercekten calinmasini bekleyip asagida geri doner.
          ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: CALL_END_MARK_NAME } }));
        },
      });
      console.log(`[voice] Arama başladı — arayan: ${from || "(bilinmiyor)"}`);
    } else if (msg.event === "media" && msg.media && callSession) {
      void callSession.pushAudio(msg.media.payload);
    } else if (msg.event === "mark" && msg.mark?.name === CALL_END_MARK_NAME) {
      console.log("[voice] Veda sesi çalındı, AI hattı kapatıyor");
      ws.close();
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

/**
 * Twilio hiç devreye girmeden, doğrudan tarayıcı mikrofonundan Gemini Live'a ses akıtan
 * test yolu (public/call.html). Twilio deneme hesabının "client connections"/"applications"
 * kısıtlamalarını tamamen atlar — telefon numarası veya doğrulama gerektirmez.
 */
browserWss.on("connection", (ws: WebSocket) => {
  let callSession: VoiceCallSession | null = null;
  let sourceSampleRate = 48000;

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      if (!callSession) return;
      const base64 = Buffer.isBuffer(raw) ? raw.toString("base64") : Buffer.from(raw as ArrayBuffer).toString("base64");
      void callSession.pushAudio(base64, sourceSampleRate);
      return;
    }

    let msg: { type: string; sampleRate?: number };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "start") {
      if (!VOICE_TEST_BUSINESS_ID) {
        console.error("[voice] VOICE_TEST_BUSINESS_ID ayarlanmamış, tarayıcı testi işlenemiyor");
        ws.close();
        return;
      }
      sourceSampleRate = msg.sampleRate ?? 48000;
      callSession = new VoiceCallSession(
        VOICE_TEST_BUSINESS_ID,
        `browser_test_${Date.now()}`,
        {
          sendAudioToClient: (base64Pcm24k) => {
            if (ws.readyState !== ws.OPEN) return;
            ws.send(Buffer.from(base64Pcm24k, "base64"));
          },
          clearClientAudioQueue: () => {
            if (ws.readyState !== ws.OPEN) return;
            ws.send(JSON.stringify({ event: "clear" }));
          },
          // Tarayıcı test yolunda Twilio'nun "mark" geri-bildirimi yok (ham PCM,
          // Twilio Media Streams protokolü değil) - kesin çalınma anını bilemiyoruz,
          // bu yüzden kısa bir veda cümlesinin çalınması için sabit bir tampon süre
          // sonra kapatıyoruz. Sadece bu devtool'a özgü bir basitleştirme.
          endCall: () => {
            setTimeout(() => {
              if (ws.readyState === ws.OPEN) ws.close();
            }, 3500);
          },
        },
        "raw-pcm16"
      );
      console.log("[voice] Tarayıcı test araması başladı");
    } else if (msg.type === "stop") {
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
