/** Halka açık paylaşımlarda (reklam görselleri) gerçek isim yerine kullanmak için —
 * "Ayşe Kaya" -> "A.K.". toLocaleUpperCase("tr-TR") kullanıyoruz çünkü düz
 * toUpperCase() Türkçe "i"yi "I"ya çevirir, "İ"ye değil (bkz. transformationShareImage.tsx'teki
 * aynı desen). */
export function getInitials(fullName: string): string {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toLocaleUpperCase("tr-TR"))
    .filter(Boolean)
    .join(".");
  return initials ? `${initials}.` : "Müşterimiz";
}
