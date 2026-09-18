// Türkiye 2016'dan beri yaz saati uygulamıyor, sabit UTC+3 — bu yüzden tam bir
// zaman dilimi kütüphanesi yerine sabit ofset kullanmak MVP için güvenli ve
// yeterli. Pazar Türkiye dışına çıkarsa (businesses.timezone alanı zaten var)
// bu dosya gerçek bir TZ kütüphanesiyle (ör. Intl/Temporal) genelleştirilmeli.
const TURKEY_UTC_OFFSET_MINUTES = 3 * 60;

/**
 * `offsetDays` gün önce/sonrasının Türkiye yerel saatiyle gün başlangıcı ve
 * bitişini UTC ISO string olarak döner. Supabase sorgularında
 * `.gte("starts_at", startUtc).lt("starts_at", endUtc)` şeklinde kullanılır.
 */
export function dayRangeUtcISO(offsetDays = 0): { startUtc: string; endUtc: string } {
  const now = new Date();
  const turkeyNow = new Date(now.getTime() + TURKEY_UTC_OFFSET_MINUTES * 60000);
  const y = turkeyNow.getUTCFullYear();
  const m = turkeyNow.getUTCMonth();
  const d = turkeyNow.getUTCDate() + offsetDays;

  const startUtcMs = Date.UTC(y, m, d, 0, 0, 0) - TURKEY_UTC_OFFSET_MINUTES * 60000;
  const endUtcMs = Date.UTC(y, m, d + 1, 0, 0, 0) - TURKEY_UTC_OFFSET_MINUTES * 60000;

  return {
    startUtc: new Date(startUtcMs).toISOString(),
    endUtc: new Date(endUtcMs).toISOString(),
  };
}

/** İçinde bulunulan ayın (Türkiye yerel) başlangıcı ve bitişini UTC ISO olarak döner — aylık prim toplamı için. */
export function monthRangeUtcISO(): { startUtc: string; endUtc: string } {
  const now = new Date();
  const turkeyNow = new Date(now.getTime() + TURKEY_UTC_OFFSET_MINUTES * 60000);
  const y = turkeyNow.getUTCFullYear();
  const m = turkeyNow.getUTCMonth();

  const startUtcMs = Date.UTC(y, m, 1, 0, 0, 0) - TURKEY_UTC_OFFSET_MINUTES * 60000;
  const endUtcMs = Date.UTC(y, m + 1, 1, 0, 0, 0) - TURKEY_UTC_OFFSET_MINUTES * 60000;

  return {
    startUtc: new Date(startUtcMs).toISOString(),
    endUtc: new Date(endUtcMs).toISOString(),
  };
}

/** Verilen iki "YYYY-MM-DD" (Türkiye yerel, ikisi de dahil) tarihi UTC ISO aralığına çevirir. */
export function dateKeyRangeUtcISO(fromKey: string, toKey: string): { startUtc: string; endUtc: string } {
  return { startUtc: `${fromKey}T00:00:00+03:00`, endUtc: `${toKey}T23:59:59.999+03:00` };
}

/** İki "YYYY-MM-DD" arasındaki (ikisi de dahil) gün sayısı — sabit gider payı oranlamak için. */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00Z`).getTime();
  const to = new Date(`${toKey}T00:00:00Z`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;
}

/** "YYYY-MM-DD" tarihine gün ekler/çıkarır (negatif de olabilir). */
export function addDaysToKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function turkeyLocalBaseDate(offsetDays: number): Date {
  const now = new Date();
  const turkeyNow = new Date(now.getTime() + TURKEY_UTC_OFFSET_MINUTES * 60000);
  return new Date(
    Date.UTC(turkeyNow.getUTCFullYear(), turkeyNow.getUTCMonth(), turkeyNow.getUTCDate() + offsetDays)
  );
}

/** working_hours JSON'undaki gün anahtarı: "mon", "tue", ... */
export function weekdayKeyTR(offsetDays = 0): (typeof WEEKDAY_KEYS)[number] {
  return WEEKDAY_KEYS[turkeyLocalBaseDate(offsetDays).getUTCDay()];
}

/** leave_dates / closed_dates ile karşılaştırmak için "YYYY-MM-DD". */
export function dateKeyTR(offsetDays = 0): string {
  return turkeyLocalBaseDate(offsetDays).toISOString().slice(0, 10);
}

/** Herhangi bir UTC ISO zaman damgasını Türkiye yerel "YYYY-MM-DD" anahtarına çevirir. */
export function dateKeyFromIso(iso: string): string {
  const turkeyLocal = new Date(new Date(iso).getTime() + TURKEY_UTC_OFFSET_MINUTES * 60000);
  return turkeyLocal.toISOString().slice(0, 10);
}

export function formatTimeTR(iso: string): string {
  return new Date(iso).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}

// Türkçe ünlü uyumuna göre doğru "-de/-da/-te/-ta" eki — sadece saat rakamının (0-23)
// SÖYLENEN halinin son harfine bakılarak elle çıkarıldı (ör. "on sekiz" -> z -> sesli+ince -> "de").
const HOUR_DATIVE_SUFFIX_TR: Record<number, string> = {
  0: "'da", 1: "'de", 2: "'de", 3: "'te", 4: "'te", 5: "'te", 6: "'da", 7: "'de", 8: "'de", 9: "'da",
  10: "'da", 11: "'de", 12: "'de", 13: "'te", 14: "'te", 15: "'te", 16: "'da", 17: "'de", 18: "'de", 19: "'da",
  20: "'de", 21: "'de", 22: "'de", 23: "'te",
};

/**
 * Sesli AI'nin RANDEVU SAATİNİ TTS'e göndereceği metin için — formatTimeTR'nin "18:00"
 * biçimi yerine "18'de" gibi konuşma-dostu bir biçim üretir. 2026-09-18'de canlı sesli
 * testte kullanıcı "saatleri telaffuz edemiyor" diye bildirdi — ":00" ekiyle biten
 * "HH:00'de" biçimi TTS motorunu (ElevenLabs) rakamları tek tek okumaya ya da garip bir
 * duraklamaya itiyordu. Bu uygulamada randevu saatleri HER ZAMAN tam saattir (dakika hep
 * 00, bkz. availability.ts STEP_MINUTES), bu yüzden dakika kısmını tamamen atıp SADECE
 * saat rakamı + doğru ek ("18'de") vermek hem daha doğal SESLENDİRME hem daha az TTS
 * hatası riski demek. SADECE sesli akışta (voice-bridge) kullanılır — WhatsApp/dashboard
 * metinlerinde formatTimeTR'nin "18:00" biçimi zaten doğru ve tercih edilen biçim.
 */
export function formatHourSpokenTR(iso: string): string {
  const turkeyLocal = new Date(new Date(iso).getTime() + TURKEY_UTC_OFFSET_MINUTES * 60000);
  const hour = turkeyLocal.getUTCHours();
  return `${hour}${HOUR_DATIVE_SUFFIX_TR[hour] ?? "'de"}`;
}

export function formatDateTR(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Istanbul",
  });
}

export function formatTL(amount: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(amount);
}
