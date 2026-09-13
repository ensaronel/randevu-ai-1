-- Bekleme listesi otomasyonu (2026-09-13). schema.sql'in güncel hâli zaten bu
-- değişiklikleri içeriyor — bu dosya sadece Supabase SQL Editor'e kolay
-- yapıştırmak için ayrı çıkarıldı. Çalıştırdıktan sonra silinebilir.
--
-- Tüm yeni sütunlar nullable/additive - mevcut satırlar etkilenmez, veri kaybı riski yok.

alter table waitlist_entries
  add column if not exists offered_slot jsonb,
  add column if not exists offered_at timestamptz,
  add column if not exists linked_appointment_id uuid references appointments(id);

-- ============================================================
-- Zaman aşımına uğrayan bekleme listesi tekliflerini sıradaki adaya geçirir.
-- BU BLOĞU SADECE UYGULAMA GERÇEKTEN DEPLOY EDİLDİKTEN SONRA ÇALIŞTIR —
-- <UYGULAMA_URL> yerine gerçek deploy adresini, <CRON_SECRET> yerine
-- .env'deki CRON_SECRET değerini yaz.
-- ============================================================
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'bekleme-listesi-zaman-asimi',
--   '*/10 * * * *', -- her 10 dakikada bir
--   $$
--   select net.http_get(
--     url := '<UYGULAMA_URL>/api/cron/waitlist-timeout',
--     headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
--   );
--   $$
-- );
