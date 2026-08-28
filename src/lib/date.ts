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

export function formatTimeTR(iso: string): string {
  return new Date(iso).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
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
