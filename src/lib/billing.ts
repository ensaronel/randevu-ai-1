/**
 * Ödeme banka havalesi/nakit ile elle tahsil ediliyor (bir ödeme sağlayıcısı
 * yok) — bu yüzden fiyatlar burada sabit, admin panelinde işletme
 * oluşturulurken paketten otomatik seçilip businesses.monthly_price_tl'e
 * anlık değer olarak (snapshot) yazılıyor. Buradaki sabitler değişse bile
 * mevcut müşterilerin daha önce kaydedilmiş fiyatı değişmez — sadece
 * yeni eklenen işletmeler yeni fiyatı alır.
 */
export const PACKAGE_PRICES_TL: Record<"whatsapp_only" | "whatsapp_and_voice", number> = {
  whatsapp_only: 1500,
  whatsapp_and_voice: 2500,
};

/** Vade tarihinden bu kadar gün sonra hâlâ ödeme onaylanmamışsa hesap otomatik askıya alınır. */
export const PAYMENT_GRACE_DAYS = 5;

function toDateOnlyUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** YYYY-MM-DD (UTC gün, saat dilimi karışıklığı olmadan) */
export function todayDateKey(): string {
  return toDateOnlyUTC(new Date()).toISOString().slice(0, 10);
}

/** Verilen tarihe (YYYY-MM-DD) tam 1 ay ekler — ay sonu taşmalarında (ör. 31 Ocak) JS Date'in kendi davranışına bırakılır (bir sonraki ayın son günü). */
export function addOneMonth(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/** Yeni vade tarihini hesaplar: erken/zamanında ödemede mevcut vadeden, gecikmiş ödemede bugünden 1 ay ileri gider — geç ödeyen, askıda geçen günler için cezalı ekstra ücretlendirilmez. */
export function nextDueDateAfterPayment(currentDueDate: string | null): string {
  const today = todayDateKey();
  const base = currentDueDate && currentDueDate > today ? currentDueDate : today;
  return addOneMonth(base);
}
