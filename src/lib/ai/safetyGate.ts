/**
 * Randevu oluşturan/değiştiren/iptal eden araçlar için kod seviyesinde son kontrol.
 * Modelin kendi yargısına (prompt talimatına) güvenmek YETMEDİ — 2026-09-12'de canlı
 * sesli testte müşterinin anlamsız bir sözü saat onayı sanılıp randevu oluşturuldu, hatta
 * bir sonraki turda uydurma bir isimle GERÇEKTEN create_appointment çağrıldı. Model
 * olasılıksal olduğu için salt prompt talimatı bunu güvenilir şekilde önleyemiyor.
 *
 * Bu modül sesli köprü (geminiBridge.ts) VE otomatik regresyon testleri (eval/) tarafından
 * ORTAK kullanılır — aynı güvenlik mantığının iki yerde ayrı ayrı (ve zamanla birbirinden
 * sapabilecek şekilde) yeniden yazılmasını önlemek için tek bir yerde tutulur.
 */
export const BOOKING_MUTATION_TOOLS = new Set([
  "create_appointment",
  "cancel_appointment",
  "reschedule_appointment",
]);

/**
 * Bir sözün TEK BAŞINA gerçek bir onay/seçim OLABİLECEĞİNE dair kaba ama etkili bir
 * sağlama — kesin bir NLU değil, sadece "bu açıkça anlamsız/alakasız bir gürültü"
 * durumunu yakalamak için (ör. "all would be shout out to the", yabancı dilde rastgele bir
 * cümle). Kasıtlı olarak GEVŞEK tutuldu (rakam, saat/gün kelimesi ya da bilinen bir onay/red
 * kelimesi varsa YETERLİ sayılır) — amaç gerçek cevapları yanlışlıkla engellememek, sadece
 * en bariz gürültü/hiçbir-ilgisi-olmayan-metin durumunda son bir fren olmak.
 */
const PLAUSIBLE_REPLY_PATTERN =
  /\d|evet|tamam|olur|olsun|peki|tabi|uyar|onay|kabul|doğru|kaydet|oluştur|ayarla|istiyorum|isterim|alay[ıi]m|ok\b|yes\b|sure\b|hayır|yok\b|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on\b|buçuk|sabah|öğle|akşam|bugün|yarın|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar/i;

function isPlausibleStandalone(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  return PLAUSIBLE_REPLY_PATTERN.test(trimmed);
}

/**
 * Gürültü/anlamsız cümleler genelde uzun, rastgele kelime dizileridir (ör. "all would be
 * shout out to the", "Ma, metti a star yol yol dksfj qwerty asdasd") — gerçek bir isim
 * cevabı ise neredeyse hep kısadır (ör. "Ayşe Kaya"). Bu, ismi tek başına PLAUSIBLE_REPLY_
 * PATTERN'e uymayan (rakam/onay kelimesi içermeyen) ama yine de meşru bir cevap olan
 * turları, uzun gürültü cümlelerinden ayırt etmek için kullanılıyor.
 */
function looksLikeShortNameReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const wordCount = trimmed.split(/\s+/).length;
  return wordCount <= 3 && trimmed.length <= 30;
}

export const AMBIGUOUS_REPLY_ERROR = "Son söylediğiniz net anlaşılamadı, lütfen açıkça tekrar eder misiniz?";

/**
 * Müşterinin en SON söylediği şey (recentUtterances'ın son elemanı) belirleyicidir — bu
 * turda kesin bir onay/rakam/gün kelimesi varsa YETERLİ. Onun tek başına yetersiz ama KISA
 * ve isim gibi görünüyorsa (ör. sadece "Ayşe Kaya"), BİR TUR ÖNCESİNİN meşru olması şartıyla
 * kabul edilir — onay ve isim ayrı turlarda gelebildiği için (bkz. voicePrompt.ts'teki "tek
 * soru sor" kuralı). ÖNEMLİ: sadece "iki tur önce bir yerde meşru bir şey geçti" YETMEZ —
 * SON turun kendisi ya meşru ya da kısa/isim-gibi olmalı; aksi halde eski bir turdaki rakam/
 * onay kelimesi, HEMEN ARDINDAN gelen bambaşka bir gürültü cümlesini "temizlermiş" gibi bir
 * boşluk oluşur (2026-09-12'de eval harness'te canlı yakalandı — bkz. eval/scenarios.ts).
 */
export function isLikelyMeaningfulReply(recentUtterances: string[]): boolean {
  const last = recentUtterances[recentUtterances.length - 1] ?? "";
  if (isPlausibleStandalone(last)) return true;
  if (recentUtterances.length < 2) return false;
  const previous = recentUtterances[recentUtterances.length - 2] ?? "";
  return looksLikeShortNameReply(last) && isPlausibleStandalone(previous);
}

/** Bir araç çağrısı bu güvenlik kapısından geçmeli mi? recentUtterances kronolojik sırada olmalı (en son eleman en son söylenen). */
export function shouldBlockMutation(toolName: string, recentUtterances: string[]): boolean {
  return BOOKING_MUTATION_TOOLS.has(toolName) && !isLikelyMeaningfulReply(recentUtterances);
}

export const NO_SERVICE_MENTIONED_ERROR =
  "Müşteri hangi hizmeti istediğini hiç söylemedi, kendi başına bir hizmet seçme — önce tekrar sor.";

/**
 * Bir hizmet adının, görüşme boyunca müşterinin söylediği HERHANGİ bir şeyde geçip
 * geçmediğini kontrol eder — sadece son 1-2 tur değil, GÖRÜŞMENİN TAMAMI (hizmet genelde
 * bir kez söylenir, her turda tekrar edilmesi beklenmez). 2026-09-12'de canlı testte
 * yakalandı: müşteri "hangi hizmet?" sorusuna anlamsız bir şey söyleyince ("Sotchi que
 * c'est mais"), AI hiç sorulmamış/söylenmemiş bir hizmeti ("Saç Kesimi") KENDİLİĞİNDEN
 * varsayıp check_availability'yi çağırdı — prompt talimatı ("hizmeti kendin varsayma")
 * bunu ÖNLEYEMEDİ. Kasıtlı olarak GEVŞEK (hizmet adının herhangi bir anlamlı kelimesi
 * geçmesi YETERLİ) — amaç gerçek bir bahsi yanlışlıkla engellememek, sadece hiç
 * bahsedilmemiş bir hizmetin uydurulmasını yakalamak.
 */
function serviceMentionedAnywhere(serviceName: string, fullTranscript: string): boolean {
  const normalizedTranscript = fullTranscript.toLowerCase();
  const words = serviceName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3); // "ve", "ile" gibi kısa/anlamsız kelimeleri atla
  if (words.length === 0) return true; // beklenmedik kısa isim - engelleme, yanlış-pozitif riski
  return words.some((w) => normalizedTranscript.includes(w));
}

/**
 * check_availability çağrısı bu güvenlik kapısından geçmeli mi? serviceNames, modelin
 * çağırmak istediği hizmet adları; fullTranscript, görüşme boyunca müşterinin söylediği
 * HER ŞEYİN birleşimi olmalı (recentUtterances'tan farklı olarak TÜM görüşme, sadece son
 * 1-2 tur değil).
 */
export function shouldBlockAvailabilityCheck(serviceNames: string[], fullTranscript: string): boolean {
  if (serviceNames.length === 0) return false;
  return !serviceNames.some((name) => serviceMentionedAnywhere(name, fullTranscript));
}

export interface VerifiedSlot {
  startsAt: string;
  endsAt: string;
  assignments: { serviceName: string; staffName: string }[];
}

/**
 * check_availability BAŞARILI (hatasız) döndüğünde, dönen slotları bu şekle çevirir —
 * create_appointment/reschedule_appointment'ın önerdiği saat/personelin GERÇEKTEN
 * doğrulanmış bir sonuçtan gelip gelmediğini kontrol etmek için kullanılır.
 */
export function parseVerifiedSlotsFromResult(resultJson: string): VerifiedSlot[] {
  try {
    const parsed = JSON.parse(resultJson) as {
      slots?: { starts_at: string; ends_at: string; assignments: { service_name: string; staff_name: string }[] }[];
    };
    return (parsed.slots ?? []).map((s) => ({
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      assignments: s.assignments.map((a) => ({ serviceName: a.service_name, staffName: a.staff_name })),
    }));
  } catch {
    return [];
  }
}

export const UNVERIFIED_SLOT_ERROR =
  "Bu saat/personel kombinasyonu doğrulanmadı — önce check_availability çağırıp GERÇEKTEN dönen bir seçeneği kullan, kendin uydurma.";

/**
 * 2026-09-13'te canlı testte yakalandı: müşteri hizmet adını hiç söylemedi, üç
 * check_availability denemesi de (doğru şekilde) shouldBlockAvailabilityCheck tarafından
 * engellendi — ama model engellenen sonucu görmezden gelip "saat 6'da Ahmet Usta boş"
 * diye KENDİLİĞİNDEN UYDURDU ve bu uydurma bilgiyle create_appointment'ı GERÇEKTEN
 * çağırdı (o anki şans eseri o saat gerçekten boştu, ama garanti değildi). Bu, hizmet-
 * uydurma kapısının kendisinden TAMAMEN BAĞIMSIZ bir hata sınıfı — kapı check_availability'yi
 * doğru engelliyor ama model onu görmezden gelip konuşmaya/rezervasyona devam edebiliyor.
 * Bu fonksiyon, create_appointment/reschedule_appointment'ın önerdiği TAM saat+personel+
 * hizmet kombinasyonunun, o çağrı/görüşme boyunca GERÇEKTEN BAŞARILI olmuş bir
 * check_availability sonucunda yer aldığını doğrular — yoksa engeller.
 */
export function shouldBlockUnverifiedSlot(
  toolName: string,
  proposed: { startsAt: string; endsAt: string; assignments: { serviceName: string; staffName: string }[] },
  verifiedSlots: VerifiedSlot[]
): boolean {
  if (toolName !== "create_appointment" && toolName !== "reschedule_appointment") return false;
  if (proposed.assignments.length === 0) return false; // reschedule_appointment assignments göndermez, bkz. çağrı yeri

  const normalize = (v: string) => v.trim().toLowerCase();
  const matches = verifiedSlots.some(
    (slot) =>
      slot.startsAt === proposed.startsAt &&
      slot.endsAt === proposed.endsAt &&
      proposed.assignments.every((p) =>
        slot.assignments.some(
          (a) => normalize(a.serviceName) === normalize(p.serviceName) && normalize(a.staffName) === normalize(p.staffName)
        )
      )
  );
  return !matches;
}
