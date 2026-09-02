# Randevu AI — Kritik + Yüksek Öncelikli Düzeltmeler

## Bağlam

Önceki denetimde (kod değiştirilmeden, sadece inceleme) 28 sorun tespit edildi. Kullanıcıyla
birlikte kapsam netleştirildi:
- Bu pakette sadece **Kritik + Yüksek** öncelikli 10 madde çözülecek (Orta/Düşük sonraki pakette
  — bkz. `PLAN_orta_dusuk_duzeltmeler.md`).
- Madde 8 (manuel ekrana çoklu-hizmet desteği) bu pakete **dahil değil** — bug değil, ayrı özellik
  (diğer plana taşındı).
- Madde 5 (kayıt/onboarding çıkmaz sokağı) için Supabase'de **e-posta doğrulamasını kapatma**
  yaklaşımı seçildi (basit ve bu ürün için yeterli, işletmeler zaten tanıdık/anlaşmalı kişiler).
- Madde 9 (telefon normalizasyonu) sadece **ileriye dönük** uygulanacak, var olan veriye
  dokunulmayacak (veri güvenliği önceliği: mevcut müşteri kayıtları asla riske atılmaz).

Veri güvenliği prensibi burada da geçerli: şema değişiklikleri önce test işletmeleri üzerinde
doğrulanacak, gerçek pilot verisine dokunan hiçbir adım geri dönüşsüz olmayacak (soft-delete/
ekleme mantığı korunacak, DROP sadece zaten var olan "eski overload'u sil" deseniyle sınırlı
kalacak).

## Uygulama Grupları

### Grup A — Acil güvenlik yamaları (bağımsız, hızlı)

**A1. WhatsApp webhook imza doğrulaması** — `src/app/api/whatsapp/webhook/route.ts`
- Meta App Secret'i al (Meta for Developers → Uygulama → Ayarlar → Temel → Uygulama Sırrı),
  `.env.local` + Vercel'e `WHATSAPP_APP_SECRET` olarak ekle.
- `POST` handler'ı `request.json()` yerine önce `request.text()` ile ham gövdeyi okuyacak, Node
  `crypto.createHmac("sha256", APP_SECRET)` ile hesaplanan imzayı `X-Hub-Signature-256` header'ıyla
  `crypto.timingSafeEqual` ile karşılaştıracak, eşleşmezse `403` dönecek, sonra `JSON.parse` edip
  mevcut akışa devam edecek.
- `GET` handler'daki `hub.verify_token` karşılaştırması da `timingSafeEqual`'a çevrilecek.

**A2. Gizlilik politikası sayfasını herkese açık yap** — `src/proxy.ts`
- `PUBLIC_PAGES = ["/", "/gizlilik"]` gibi bir liste tanımlanacak, yönlendirme koşulunda
  `pathname !== "/"` yerine `!PUBLIC_PAGES.includes(pathname)` kullanılacak.
- Canlıda `curl` ile `/gizlilik`'in artık `200` döndüğü doğrulanacak (giriş yapılmadan).

### Grup B — Veritabanı bütünlüğü (schema.sql üzerinde tek oturumda, Supabase SQL Editor'de)

**B1. Çift rezervasyon yarış durumunu kapat** — `supabase/schema.sql` `create_appointment_with_services`
- Çakışma `SELECT count(*)` yapılmadan önce, `p_services`'teki tüm benzersiz `staff_id`'ler
  **sıralanıp** her biri için `pg_advisory_xact_lock(hashtext(staff_id::text))` alınacak (sıralama
  deadlock'u önler; `_xact_` kilidi transaction bitince otomatik düşer, ekstra unlock gerekmez).
  Böylece aynı personele aynı anda gelen iki çakışan istek DB seviyesinde sıraya girer.

**B2. Randevu ertelemeyi çakışma kontrolünden geçir** — yeni RPC + `src/app/api/appointments/[id]/route.ts`
- Yeni fonksiyon `reschedule_appointment_with_check(p_appointment_id, p_starts_at, p_ends_at)`:
  ilgili randevunun `business_id`/`staff_id`'lerini bulur, B1'deki gibi advisory lock alır,
  kendi id'sini hariç tutarak aynı çakışma sorgusunu çalıştırır, uygunsa `starts_at`/`ends_at`'i
  günceller. Aynı `staff_conflict`/`invalid_time_range` hatalarını fırlatır.
- `PATCH /api/appointments/[id]`: body'de `starts_at` veya `ends_at` varsa bu RPC çağrılır (409/400
  eşlemesi `POST /api/appointments` ile aynı olacak); sadece `status`/`attendance` değişiyorsa
  mevcut basit `.update()` yolu korunur.

**B3. Sahiplik doğrulaması eksikliğini kapat**
- `create_appointment_with_services` içine, çakışma kontrolünden önce: `p_customer_id`'nin ve
  `p_services` içindeki her `service_id`/`staff_id`'nin `v_business_id`'ye ait olduğunu doğrulayan
  `EXISTS` kontrolleri eklenecek, aksi halde `invalid_reference` hatası fırlatılacak.
- `src/app/api/staff/[id]/expertise/route.ts`: `service_ids`'in tamamının `owner.business_id`'ye
  ait olduğu, insert'ten önce bir `select ... in (...)` ile doğrulanacak (sayı eşleşmezse `404`).
- Bu üç değişiklik (B1+B2+B3) `schema.sql`'e işlenip **tek seferde** Supabase SQL Editor'de
  çalıştırılacak, önce mevcut test işletmelerinden biriyle (örn. `deneme-kuaför`) çift-rezervasyon
  ve yanlış-id senaryoları elle denenip doğrulanacak, sonra gerçek pilot veri etkilenmeden akışa
  devam edilecek.

### Grup C — Kayıt akışının çıkmaz sokağı

**C1. Supabase'de e-posta doğrulamasını kapat** (manuel adım, birlikte yapılacak)
- Supabase Dashboard → Authentication → Sign In / Providers → Email → "Confirm email" kapatılır.

**C2. Onboarding başarısız olursa kullanıcıyı sıfırlamadan tekrar dene** — `src/app/login/page.tsx`
- `signUp` başarılı olduktan sonra onboarding fetch'i başarısız olursa: mod "signup" formuna
  dönüp kullanıcıyı yeniden `signUp` denemeye (ve "User already registered" hatasına) zorlamak
  yerine, oturum zaten kurulduğu için sadece `/api/onboarding`'i tekrar deneyen bir "Tekrar Dene"
  butonu gösterilecek (business_name/full_name state'te tutulmaya devam eder).
- Daha önce bu hatayı yaşayıp yarım kalmış olabilecek gerçek auth kullanıcısı var mı diye (SADECE
  okuma amaçlı, silme yok) Supabase Auth listesi kontrol edilecek; varsa kullanıcıya bildirilip
  elle tamamlanıp tamamlanmayacağı sorulacak.

### Grup D — Müsaitlik algoritması

**D1. Çoklu hizmet ataması için backtracking** — `src/lib/ai/availability.ts`
- Şu anki açgözlü (`.find()` ile ilk uygun personeli seçen) atama mantığı, küçük bir backtracking
  fonksiyonuna (`tryAssignServices(services, idx, usedStaffIds, ...)`) çevrilecek: bir sonraki
  hizmet için uygun personel bulunamazsa bir önceki hizmetin ataması geri alınıp başka bir aday
  denenecek. Hizmet/personel sayıları küçük olduğu için (tipik 1-3) performans etkisi yok.
- Doğrulama: iki farklı personelden sadece biri her iki hizmeti de yapabilirken diğerinin sadece
  birini yapabildiği bir senaryo elle kurgulanıp (test verisiyle), eskiden "uygun yok" dönen
  kombinasyonun artık doğru şekilde bulunduğu gösterilecek.

## Doğrulama Planı

1. Her grup için `npm run build` geçmeli (mevcut proje disiplini: build yeterli kanıt değil, ayrıca
   gerçek Supabase'e karşı `npm run build && npm run start` ile test edilecek).
2. B grubu (schema.sql): Supabase SQL Editor'de çalıştırıldıktan sonra test işletmesiyle:
   - Aynı personele aynı saat için art arda hızlı iki `POST /api/appointments` isteği → sadece
     biri başarılı, diğeri `409 staff_conflict` dönmeli.
   - `PATCH /api/appointments/[id]` ile bir randevuyu dolu bir saate taşımayı dene → `409` dönmeli.
   - Başka bir işletmenin `customer_id`/`service_id`'siyle randevu oluşturmayı dene → reddedilmeli.
3. A grubu: webhook'a imzasız POST at (curl) → `403` dönmeli; gerçek Meta mesajıyla uçtan uca akış
   hâlâ çalışmalı (imza doğru hesaplanıyor mu). `/gizlilik`'i çıkış yapılmış tarayıcıda aç → içerik
   görünmeli.
4. C grubu: gerçek bir yeni e-posta ile signup dene, e-posta doğrulama kapalıyken anında dashboard'a
   düşmeli; onboarding'i bilerek bozup (geçici olarak) "Tekrar Dene" akışının çalıştığını doğrula.
5. D grubu: iki personelli, biri her iki hizmeti de yapabilen diğeri sadece birini yapabilen bir
   test senaryosuyla `check_availability`/`available-slots`'ın doğru kombinasyonu bulduğunu
   doğrula.
