/**
 * Bir randevunun ücretinin GERÇEKTEN kazanılmış (tahsil edilebilir/edilmiş) sayılıp
 * sayılmayacağını belirler — ciro, personel primi ve AI Danışman'ın finansal
 * cevapları dahil TÜM para hesaplarında AYNI kural kullanılmalı. Önceden bu
 * hesaplar sadece status='cancelled' olanları hariç tutuyordu; bu da HENÜZ
 * GERÇEKLEŞMEMİŞ (gelecekteki) randevuları ve GELMEYEN (no-show) müşterilerin
 * ücretini de gerçek kazanılmış ciro gibi sayıyordu — "Net Kâr" ve personel
 * primi gerçekte tahsil edilmemiş parayı içeriyordu (2026-09-11 denetiminde
 * bulundu). Kural: iptal edilmemiş, henüz gerçekleşmemiş (başlangıç saati hâlâ
 * gelecekte), VE müşterinin gelmediği açıkça işaretlenmemiş (attendance
 * no_show_*) olmalı. attendance hiç işaretlenmemişse (null) — ki günlük
 * pratikte çoğu randevu için owner bunu elle işaretlemiyor — gerçekleşmiş
 * sayılmaya devam eder, sadece AÇIKÇA no-show işaretlenenler hariç tutulur.
 */
export function isRealizedRevenue(
  status: string,
  attendance: string | null | undefined,
  startsAt: string
): boolean {
  if (status === "cancelled") return false;
  if (attendance === "no_show_silent" || attendance === "no_show_notified") return false;
  if (new Date(startsAt).getTime() > Date.now()) return false;
  return true;
}
