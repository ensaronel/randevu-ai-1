// Bu projedeki HER Gemini çağrısı buradaki listeyi kullanır (bkz. gemini.ts) — model tek
// yerden değiştirilebilsin diye.
//
// 2026-09-23'te canlı testte bulundu: ücretsiz katmandaki "-lite" modeller (gemini-3.5-flash-lite,
// 3.5-flash, 3.6-flash) TEK KELİMELİK bir cevap için bile 20-50 saniye sürüyor, diğerleri
// (3.7/3.8/3.1-flash-lite) "yüksek talep" (503) döndürüyordu. Bir WhatsApp cevabı birden çok model
// çağrısı içerdiği için (araç çağır -> sonuç -> cevap) bu, botun dakikalarca geç cevap vermesine ve
// Danışman'ın zaman aşımına düşmesine yol açıyordu. gemini-3-flash-preview aynı ücretsiz anahtarla
// ~2 saniyede cevap veriyor ve araç çağırmayı doğru yapıyor (8/8 denemede).
//
// Liste sıralıdır: ilki ana model, diğerleri ana model yavaşlarsa/aşırı yüklenirse otomatik devreye
// giren yedeklerdir. gemini-2.5-* modelleri yeni kullanıcılara artık kapalı (404).
export const AI_MODELS = ["gemini-3-flash-preview", "gemini-3.6-flash", "gemini-3.5-flash-lite"] as const;

export const AI_MODEL = AI_MODELS[0];
