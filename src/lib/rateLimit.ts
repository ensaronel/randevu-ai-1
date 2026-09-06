import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

/** Genel API/sayfa trafiği için IP başına sınır — arama/asistan/randevu gibi tüm istekleri kapsar. */
export const generalLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      prefix: "ratelimit:general",
    })
  : null;

/** WhatsApp webhook'unda AI cevabı ureten yolu, tek bir musterinin spam'ine karsi korur (paylasilan Gemini kotasi). */
export const aiReplyLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "10 m"),
      prefix: "ratelimit:ai-reply",
    })
  : null;

/**
 * Upstash tanımsızsa (env eksikse) rate limit devre dışı kalır, istek engellenmez —
 * yerel geliştirmede Upstash hesabı zorunlu olmasın diye kasıtlı bir "fail open".
 */
export async function isRateLimited(
  limiter: Ratelimit | null,
  key: string
): Promise<boolean> {
  if (!limiter) return false;
  const { success } = await limiter.limit(key);
  return !success;
}
