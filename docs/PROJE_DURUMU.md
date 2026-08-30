# Randevu AI — Proje Durumu (2026-08-29 itibarıyla)

Bu dosya, yerel makinedeki Claude oturumunun hafızasında olup **repoya işlenmemiş** kararları/durumu bulut oturumuna taşımak için yazıldı. Ana yol haritası: `docs/PLAN.md`.

## Tamamlanan haftalar (hepsi gerçek verilerle uçtan uca test edildi, sadece `npm run build`'e güvenilmedi)

- **Hafta 1-4**: Kurulum, CRUD, Dashboard/Takvim, WhatsApp webhook + KVKK.
- **Hafta 5**: AI randevu beyni (Gemini, `gemini-3.6-flash`) + eskalasyon.
- **Hafta 6-7**: Onay/red + no-show takibi, Gün Sonu Mutabakat + prim/komisyon.
- **Hafta 8**: Gece çalışan AI finans yorumu (cron).
- **Hafta 9**: Proaktif AI — boşluk doldurma (anlık), risk tespiti + ritim daveti (gece).
- **Hafta 10**: Hizmetler/Çalışanlar/Ayarlar self-servis ekranları + personel performansı.
- **Hafta 11**: Serbest doğal dil soru-cevap AI asistanı (`/asistan`).
- **Ek özellikler**: AI boş günde en yakın uygun günü öneriyor; müşteri adı WhatsApp profilinden alınıyor; randevu oluşturmada AI/owner çakışma kontrolü birleştirildi (kritik bug fix); randevu hatırlatması (24 saat + 1 saat önce, sadece mesaj, `pg_cron`+`pg_net` ile).
- **Hafta 12**: Müşteri profili (CRM) — `/musteriler` liste (arama, yeni müşteri ekleme) + `/musteriler/[id]` detay ekranı (notlar/tercih edilen personel düzenleme, aktif/pasif, toplam harcama, ziyaret sayısı, son ziyaret, randevu geçmişi, AI uyarı rozetleri). Öneri geçmişi (önerildi→onaylandı/reddedildi→sonuç) için yeni tablo gerekmedi — Hafta 9'da eklenen `action_objects` şeması zaten bunu tutuyordu, bu hafta sadece müşteri bazlı görünüme bağlandı. Bulutta kod olarak yazılıp sadece `npm run build` ile doğrulanmıştı; yerelde gerçek Supabase'e karşı uçtan uca test edildi (liste/detay doğru rakamları gösteriyor, not/tercih güncelleme kalıcı, AI önerisi onayla/reddet çalışıyor, pasifleştirme listeden doğru düşüyor) — **kod aslında doğruymuş, sadece test eksikmiş.**

**Sıradaki**: Hafta 13 — Pilot kurulumu + baseline ölçüm.

## Önemli kararlar (repoda yazılı değildi)

- **Fiyatlandırma**: Aylık abonelik, **2.000 TL/ay**, tüm özellikler dahil (kademeli paket yok — ilk müşterilerde basitlik için).
- **Telefon AI (Faz 2)**: WhatsApp kanıtlanınca eklenecek, ayrı bir üst paket olarak **+1.500-2.500 TL/ay** (gerçek dakika-başı maliyeti olduğu için ayrı ücretlendirilmeli).
- **Pilot işletme**: Kullanıcının evinin aşağısındaki bir **erkek kuaförü** — henüz kuaförle kesin anlaşma/görüşme durumu netleşmedi.
- **Tasarım beyin fırtınası**: 5 ekranlık bir Claude Design canvas'ı hazırlandı (Ana Sayfa, Takvim, Randevu Oluştur, Çalışanlar, 1 masaüstü örneği) — https://claude.ai/code/artifact/a50f2221-e174-4451-8e7a-fc550c217c24 . **Kısmen koda işlendi** (bkz. açık işler #6): ortak masaüstü+mobil kabuk (`AppShell`/`Sidebar`) ve Dashboard/Çalışanlar'ın halka grafikli görünümü tamamlandı; Takvim'in gün-şeridi/personel-doluluk-yüzdesi detayları ve "Randevu Oluştur" ekranı (owner'ın manuel randevu oluşturabileceği bir sayfa hiç yoktu, sadece API/AI üzerinden oluşuyor) henüz uygulanmadı.

## Bilinen açık işler / riskler

1. ~~Meta WhatsApp doğrulaması hâlâ çözülmedi~~ — **ÇÖZÜLDÜ**: uygulama Vercel'e deploy edildi (`https://randevu-ai-1.vercel.app`), Meta'da ücretsiz test numarası + webhook kuruldu, uygulama "Live" moda alındı (bunun için ayrıca WABA'yı uygulamaya `/subscribed_apps` ile manuel abone etmek gerekti — yeni Meta arayüzünde bu adım otomatik olmuyor), kalıcı (süresi dolmayan) bir System User access token'ı oluşturuldu. Gerçek bir telefon numarasından gerçek WhatsApp mesajıyla uçtan uca test edildi: müşteri mesaj attı → AI uygun saat önerdi → onayladı → gerçek randevu Supabase'e yazıldı (doğrulandı). Not: `deneme-kuaför` test işletmesine bu test için geçici olarak whatsapp_phone_number_id + 1 personel + 1 hizmet eklendi, pilot işletmenin gerçek verisiyle değiştirilmeli. Tam iş doğrulaması (business verification) hâlâ yapılmadı ama gerekli değil — sadece günde 250 konuşma sınırını kaldırıyor, gerçek pilotta hacme göre değerlendirilecek.
2. ~~Gemini ücretsiz katman günlük 20 istek sınırına takıldı~~ — **ÇÖZÜLDÜ**: model `gemini-3.6-flash`'tan `gemini-3.5-flash-lite`'a geçirildi (`assistant.ts`, `financeCommentary.ts`, `respond.ts`), bu modelin ücretsiz katmanı günde 1000 istek destekliyor, faturalandırma/kart gerekmedi. Gerçek Supabase + gerçek sunucu üzerinden fonksiyon çağırma (check_availability → create_appointment) uçtan uca test edildi, sorunsuz çalışıyor.
3. **WhatsApp hatırlatma/proaktif mesajları şu an serbest metin gönderiyor** — Meta onaylı bir şablon olmadan bu mesajlar gerçekte reddedilir, Meta onayı tamamlanınca şablona çevrilmeli (`src/lib/reminders.ts`, fill_gap/retention_risk/rhythm_invite mesajları).
4. Veritabanında 4 eski test işletmesi + 4 test hesabı duruyor (deneme-kuaför, Test Kuaför, Örnek Kuaför Salonu, E2E Asistan İşletmesi) — kullanıcı onayı alındı ama otomatik güvenlik sınıflandırıcısı kalıcı silme işlemini (DB satırı + auth kullanıcı) engelledi; kullanıcı şimdilik elle silmeyi erteledi, gerçek pilot verisiyle karışmıyorlar (ayrı business_id).
5. ~~`pg_cron`/`pg_net` kurulum bloğu deploy bekliyor~~ — **ÇÖZÜLDÜ**: gerçek Vercel URL'i (`https://randevu-ai-1.vercel.app`) hazır olduğu için Supabase SQL Editor'de çalıştırıldı. `cron.job` tablosunda doğrulandı: jobid 1, jobname `randevu-hatirlatmalari`, `*/10 * * * *` (her 10 dakikada bir) `/api/cron/reminders`'ı tetikliyor. `schema.sql`'deki blok hâlâ yorum satırı olarak duruyor (gerçek secret içerdiği için commit edilmedi), gerçek SQL Supabase projesinde canlı.
6. **Tasarım implementasyonu kısmi** — `AppShell`/`Sidebar` (masaüstünde sol menü, mobilde alt menü) tüm sayfalara uygulandı, Dashboard ve Çalışanlar sayfaları halka grafikle (doluluk %) yenilendi; gerçek bir test hesabıyla Playwright üzerinden mobil (390px) ve masaüstü (1440px) genişliklerde ekran görüntüsüyle doğrulandı. Takvim sadece kabuğa bağlandı, mockup'taki gün-şeridi/kaydırmalı personel doluluk yüzdesi eklenmedi.
7. ~~"Randevu Oluştur" ekranı hiç yapılmadı~~ — **ÇÖZÜLDÜ**: `/randevu-olustur` sayfası eklendi (müşteri arama/ekleme, hizmet+personel+tarih+saat seçimi, özet onayı). Yeni `/api/appointments/available-slots` endpoint'i, AI'ın `check_availability`'siyle AYNI `findAvailableSlots` motorunu (`src/lib/ai/availability.ts`) kullanıyor — owner ve AI hiçbir zaman farklı müsaitlik hesabına göre karar vermiyor. Dashboard/Takvim'deki "+ Randevu" butonları buraya bağlandı. Gerçek hesapla uçtan uca test edildi: randevu doğru oluşuyor VE aynı saate ikinci deneme (bu ekrandan da, AI'dan da) `staff_conflict` ile engelleniyor — çakışma koruması iki yoldan da ortak.

## Genel prensipler (bu oturumda öğrenilenler)

- **"Build geçti" yeterli kanıt değil** — veritabanına dokunan her değişiklik gerçek Supabase'e karşı, gerçek bir sunucu (`npm run build && npm run start`, `next dev` değil — Windows'ta Turbopack dev modu tekrarlayan şekilde çöküyor) üzerinden test edilmeli.
- Postgres'te `create or replace function` parametre listesi değişince eskisini SİLMEZ, yanına yeni bir overload ekler — imza değişince önce `drop function if exists (eski imza)` gerekir.
- Her hafta/özellik sonunda commit atılıyor (`git log --oneline` ile geçmiş görülebilir).
- Meta'nın yeni WhatsApp kurulum arayüzünde webhook URL'i doğrulansa ve "messages" alanına abone olunsa bile, uygulama WABA'ya `POST /{WABA_ID}/subscribed_apps` ile ayrıca abone edilmezse mesajlar hiç ulaşmıyor (sessizce kayboluyor) — eski arayüzde otomatikti, yenisinde manuel.
- Meta uygulaması "Development" modundayken admin/test hesaplarından gelen mesajlar bile webhook'a düşmüyor; "Live" moda geçmek için sadece bir Privacy Policy URL + App icon + Category yeterli, iş doğrulaması (business verification) gerekmiyor.
- Meta'nın "Try it out" ekranındaki geçici access token'lar çok kısa ömürlü (saatler içinde doluyor) — gerçek geliştirme için Business Settings'te bir System User oluşturup "Asla" (never expire) süreli kalıcı token almak şart.
- WABA'nın `/subscribed_apps` aboneliği ara sıra kendiliğinden düşebiliyor (Meta altyapı tutarsızlığı, sebep belirsiz) — belirti: giden mesaj gönderme çalışırken gelen mesajlar hiç webhook'a düşmüyor (whatsapp_message_log'a inbound satırı hiç eklenmiyor). Çözüm: aynı `POST /{WABA_ID}/subscribed_apps` çağrısını tekrar yapmak (10 saniyelik iş). "AI cevap vermiyor" şikayeti gelirse önce bunu kontrol et.
