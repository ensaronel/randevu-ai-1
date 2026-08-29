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
- **Tasarım beyin fırtınası**: 5 ekranlık bir Claude Design canvas'ı hazırlandı (Ana Sayfa, Takvim, Randevu Oluştur, Çalışanlar, 1 masaüstü örneği) — https://claude.ai/code/artifact/a50f2221-e174-4451-8e7a-fc550c217c24 . Masaüstü responsive hâle getirme kodu henüz yazılmadı, sadece 1 örnek ekran tasarlandı.

## Bilinen açık işler / riskler

1. **Meta WhatsApp doğrulaması hâlâ çözülmedi** — tüm WhatsApp özellikleri (AI randevu, hatırlatma, proaktif mesajlar) kod olarak hazır ama gerçek numaraya bağlanamıyor. Bu, Hafta 13-14'ü de blokluyor.
2. **Gemini ücretsiz katman günlük 20 istek sınırına takıldı** (test sırasında bizzat yaşandı) — Hafta 13 pilot öncesi mutlaka çözülmeli: ya Gemini'de faturalandırma açılır (kolay, ucuz) ya da Anthropic Claude Haiku'ya geçilir (`ANTHROPIC_API_KEY` zaten `.env.local`'de yer tutucu olarak var, sadece `src/lib/ai/respond.ts` değişir).
3. **WhatsApp hatırlatma/proaktif mesajları şu an serbest metin gönderiyor** — Meta onaylı bir şablon olmadan bu mesajlar gerçekte reddedilir, Meta onayı tamamlanınca şablona çevrilmeli (`src/lib/reminders.ts`, fill_gap/retention_risk/rhythm_invite mesajları).
4. Veritabanında 3 eski test işletmesi + 3 test hesabı duruyor, silmek için kullanıcı onayı bekleniyor.
5. `supabase/schema.sql`'in sonundaki `pg_cron`/`pg_net` kurulum bloğu, uygulama gerçekten deploy edilip gerçek URL bilinene kadar çalıştırılamaz (yorum satırı olarak bırakıldı).

## Genel prensipler (bu oturumda öğrenilenler)

- **"Build geçti" yeterli kanıt değil** — veritabanına dokunan her değişiklik gerçek Supabase'e karşı, gerçek bir sunucu (`npm run build && npm run start`, `next dev` değil — Windows'ta Turbopack dev modu tekrarlayan şekilde çöküyor) üzerinden test edilmeli.
- Postgres'te `create or replace function` parametre listesi değişince eskisini SİLMEZ, yanına yeni bir overload ekler — imza değişince önce `drop function if exists (eski imza)` gerekir.
- Her hafta/özellik sonunda commit atılıyor (`git log --oneline` ile geçmiş görülebilir).
