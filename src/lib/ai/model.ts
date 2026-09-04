// Bütçe kısıtı nedeniyle şimdilik Gemini'nin ücretsiz katmanı kullanılıyor (kart
// gerektirmiyor) — flash-lite'ın ücretsiz katmanı günde 1000 istek destekliyor
// (eski gemini-3.6-flash'ın günlük 20 istek sınırına takılmıştık). Gerekirse
// plandaki Claude Haiku'ya dönülebilir, mimari (tools.ts/availability.ts)
// sağlayıcıdan bağımsız. Bu projedeki her Gemini çağrısı aynı modeli kullanmalı —
// tek yerden değiştirilebilsin diye üç dosyaya ayrı ayrı yazılmak yerine buradan içe aktarılır.
export const AI_MODEL = "gemini-3.5-flash-lite";
