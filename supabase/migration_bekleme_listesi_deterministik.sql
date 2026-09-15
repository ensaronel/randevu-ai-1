-- 2026-09-15: WhatsApp botunun "müşteri dolu günü sordu, alternatif güne randevu aldı,
-- ama sonra orijinal dolu gün için bekleme listesi teklifini unuttu" sorunu (2026-09-14'te
-- eklenen prompt kuralına rağmen 2026-09-15'te canlı testte hâlâ ara sıra tekrarlandı —
-- modelin birkaç mesaj önceki sohbet geçmişini hatırlamasına dayanan bir kural, olasılıksal
-- bir LLM davranışı olduğu için tam güvenilir değildi). Bu sütun, bu teklifi modele
-- bırakmak yerine respond.ts'te KOD SEVİYESİNDE garanti eder: create_appointment farklı bir
-- güne başarıyla sonuçlandığında kod bu alanı okuyup teklif cümlesini kendisi ekler.
-- supabase/schema.sql'in güncel hâli zaten bu sütunu içeriyor, bu dosya sadece Supabase
-- SQL Editor'e kolay yapıştırmak için ayrı çıkarıldı. Çalıştırdıktan sonra silinebilir.

alter table customers add column if not exists pending_busy_offer jsonb;
