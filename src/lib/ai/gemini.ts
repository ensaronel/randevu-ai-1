import {
  GoogleGenAI,
  ApiError,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { AI_MODELS } from "@/lib/ai/model";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const [PRIMARY_MODEL, ...FALLBACK_MODELS] = AI_MODELS;

/**
 * Deneme sırası: ana model takılırsa (zaman aşımı/5xx) bir kez daha denenir, çünkü ana model normalde
 * 2-4 sn'de cevap verir; yedek modeller ücretsiz katmanda 20-50 sn sürüyor veya 503 veriyor.
 * Kota bittiğinde (429) veya model yoksa (404) AYNI modeli tekrar denemenin anlamı yok, doğrudan sıradakine geçilir.
 */
const ATTEMPTS: { model: string; timeoutMs: number }[] = [
  { model: PRIMARY_MODEL, timeoutMs: 12_000 },
  { model: PRIMARY_MODEL, timeoutMs: 12_000 },
  ...FALLBACK_MODELS.map((model) => ({ model, timeoutMs: 25_000 })),
];

/** Günlük kotası dolan modeller, sonraki isteklerin boşuna denemesin diye bir süre atlanır (sunucu örneği başına bellekte). */
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
const cooldownUntil = new Map<string, number>();

function isDailyQuotaError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429 && /PerDay|per day/i.test(err.message);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 404 || err.status === 429 || err.status >= 500;
  return true; // zaman aşımı (AbortError) ve ağ hataları
}

/** Çağıran taraflar (Danışman vb.) kullanıcıya "servis yoğun" demek için bu tür hataları ayırt edebilsin. */
export function isAiUnavailableError(err: unknown): boolean {
  return isRetryable(err);
}

/**
 * Tüm Gemini çağrılarının ortak girişi. Her deneme kendi zaman aşımıyla sınırlıdır; geçici hata /
 * aşırı yük / takılma / kota bitişinde sıradaki denemeye geçer. Hepsi başarısız olursa son hatayı
 * fırlatır (çağıran taraf kendi güvenli yedek davranışına sahiptir).
 */
export async function generateContentResilient(params: Omit<GenerateContentParameters, "model">): Promise<GenerateContentResponse> {
  let lastError: unknown;
  const skipThisCall = new Set<string>();

  for (const attempt of ATTEMPTS) {
    if (skipThisCall.has(attempt.model)) continue;
    if ((cooldownUntil.get(attempt.model) ?? 0) > Date.now() && attempt !== ATTEMPTS[ATTEMPTS.length - 1]) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attempt.timeoutMs);
    try {
      return await ai.models.generateContent({
        ...params,
        model: attempt.model,
        config: {
          // Gemini 3 modelleri varsayılan olarak uzun "düşünür"; araç çağıran sohbet akışlarında bu
          // saniyeler ekler. Düşük seviye hızı korur, araç seçimi doğruluğu yeterli.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          ...params.config,
          abortSignal: controller.signal,
        },
      });
    } catch (err) {
      lastError = err;
      const reason = err instanceof ApiError ? `HTTP ${err.status}` : err instanceof Error ? err.name : "hata";
      console.warn(`[gemini] ${attempt.model} başarısız (${reason})`);
      if (!isRetryable(err)) throw err;
      if (err instanceof ApiError && (err.status === 429 || err.status === 404)) {
        skipThisCall.add(attempt.model);
        if (isDailyQuotaError(err)) cooldownUntil.set(attempt.model, Date.now() + QUOTA_COOLDOWN_MS);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
