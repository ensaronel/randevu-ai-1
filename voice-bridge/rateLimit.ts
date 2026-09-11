import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * src/lib/rateLimit.ts ile AYNI Upstash hesabı/deseni ama BURADA ayrıca
 * kuruldu (import edilmedi) - voice-bridge kendi node_modules'una sahip ayrı
 * bir npm projesi, ana projenin @upstash/ratelimit modül örneğini
 * paylaşamıyor (TypeScript farklı paket kopyalarını nominal olarak farklı
 * tip sayar). WhatsApp tarafında musteri basina mesaj siniri var, sesli
 * tarafta HICBIR arama sinirlamasi yoktu (2026-09-11 denetiminde bulundu) -
 * gercek Twilio dakika + Gemini Live ses maliyeti oldugu icin bu, dogrudan
 * cebi koruyan bir onlem.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

/** Aynı numaradan 30 dakikada en fazla 5 yeni arama - normal bir müşteri için fazlasıyla yeterli, spam/döngü aramaları maliyete dönüşmeden durdurur. */
const callLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "30 m"),
      prefix: "ratelimit:voice-call",
    })
  : null;

/** Upstash env eksikse (yerel geliştirme) sınırlama devre dışı kalır - fail open, aynı src/lib/rateLimit.ts deseni. */
export async function isCallRateLimited(callerNumber: string): Promise<boolean> {
  if (!callLimiter) return false;
  const { success } = await callLimiter.limit(callerNumber);
  return !success;
}
