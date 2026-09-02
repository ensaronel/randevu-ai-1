# Randevu AI — Kalan (Orta + Düşük + Ertelenen) Düzeltmeler

## Bağlam

Bu, denetimin **ikinci ve son bug-fix paketi** (bkz. `PLAN_kritik_yuksek_duzeltmeler.md` — Grup
A-E: webhook imzası, gizlilik sayfası, çift-rezervasyon kilidi, erteleme çakışma kontrolü,
sahiplik doğrulaması, kayıt akışı, müsaitlik algoritması).

Bu pakette kalan **13 Orta + 8 Düşük öncelikli madde + ertelenen "çoklu-hizmet manuel randevu"
özelliği (madde 8)** tek planda ele alınıyor. Kullanıcıyla netleşen kapsam kararları:
- Madde 16 (prim oranı geçmişe dönük etkilememeli) ve Madde 22 (Gün Sonu'na gider girişi) — ikisi
  de dahil, çünkü muhasebe doğruluğu için önemliler.
- Madde 21 (`businesses.timezone` alanı hiç kullanılmıyor) — kod değişikliği YOK, sadece belgeleme.
- Veri güvenliği prensibi burada da geçerli: yeni şema alanları (commission_rate_snapshot,
  expenses UI'ı) sadece **eklenir**, var olan kayıtlara dokunulmaz; eski randevularda snapshot
  `null` kalacağı için hesaplama otomatik olarak mevcut `staff.commission_rate`'e geri düşer.

## Uygulama Grupları

### Grup F — Webhook sağlamlığı

**F1 (madde 12). Metin dışı mesajlara sessiz kalma** — `src/app/api/whatsapp/webhook/route.ts`
- `body` (metin) yoksa artık `continue` ile sessizce atlanmayacak: müşteriye kısa bir
  "Şu an sadece yazılı mesajları okuyabiliyorum 🙏" yanıtı gönderilecek ve bu, mevcut
  `whatsapp_message_log` insert deseniyle loglanacak (body alanına
  `"[desteklenmeyen mesaj türü: image]"` gibi bir açıklama yazılır).

**F2 (madde 13). Eşzamanlı ikinci mesajda müşteri kaybı** — aynı dosya
- Müşteri insert'i `23505` (unique violation, aynı telefonla yarış durumu) hatası verirse,
  hata yutulmadan tekrar `SELECT` ile müşteri çekilecek ve akışa devam edilecek (mesaj hiç
  işlenmeden atlanmayacak).

### Grup G — Cron güvenilirliği

**G1 (madde 14). İşletme bazlı hata izolasyonu** — `src/lib/nightlySummary.ts`, `src/lib/proactive.ts`
- `runNightlySummaryForAllBusinesses`/`runProactiveInsightsForAllBusinesses` döngülerine per-
  business `try/catch` eklenecek; bir işletmenin hatası diğerlerini durdurmayacak, hata sonuç
  listesine `{businessId, error}` olarak eklenip döndürülecek (böylece 4 test işletmesinden
  birindeki bozuk veri artık gerçek pilot işletmenin gece işlerini engelleyemez).

**G2 (madde 24). CRON_SECRET karşılaştırması** — `src/app/api/cron/reminders/route.ts`, `src/app/api/cron/nightly-summary/route.ts`
- Ortak bir `verifyCronSecret(request): boolean` yardımcı fonksiyonu (`src/lib/api-response.ts`
  içine eklenir) — `crypto.timingSafeEqual` kullanır, `CRON_SECRET` env tanımsızsa otomatik
  `false` döner (fail-closed). İki cron route da bunu kullanacak.

### Grup H — Muhasebe/finans bütünlüğü

**H1 (madde 16). Prim oranını randevu anında sabitle** — `supabase/schema.sql`, `src/lib/staffMetrics.ts`
- `appointment_services` tablosuna nullable `commission_rate_snapshot numeric(5,2)` kolonu
  eklenir. `create_appointment_with_services` RPC'si, her hizmet satırını eklerken ilgili
  `staff.commission_rate`'i okuyup bu kolona yazar.
- `loadStaffMonthlyMetrics`'teki prim hesabı artık önce `svc.commission_rate_snapshot`'a bakar,
  yoksa (eski kayıtlar) `staff.commission_rate`'e düşer — geçmiş veri bozulmaz, yeni kayıtlardan
  itibaren doğru tarihsel oran kullanılır.

**H2 (madde 15). Kapatılmış günde değişiklik uyarısı** — `src/app/gun-sonu/GunSonuClient.tsx`
- Sert bir kilit koymuyoruz (owner'ın hata düzeltme özgürlüğü kalsın) — `reconciledAt` doluyken
  attendance/fiyat değişikliği yapılırsa, ekranda "Bu gün kapatılmıştı, rakamlar güncel değil —
  Yeniden Hesapla'ya bas" uyarısı belirir (state'te basit bir `isStale` bayrağı ile).

**H3 (madde 22). Gün Sonu'na gider girişi** — `src/app/api/gun-sonu/reconcile/route.ts`, `src/lib/validation.ts`, `src/app/gun-sonu/GunSonuClient.tsx`
- `reconcileDaySchema`'ya opsiyonel `expenses: z.number().nonnegative().optional()` eklenir;
  upsert'te verilmezse mevcut kayıttaki değer korunur (yoksa 0).
- Gün Sonu ekranına "Bugünkü giderler (TL)" input'u eklenir, kapatılan günde net kâr
  (ciro - gider) gösterilir. Dashboard'un "tahmini ciro" kartına dokunulmaz (farklı veri kaynağı,
  kapsamı büyütmemek için).

### Grup I — Doğrulama ve küçük sağlamlaştırma

**I1 (madde 17). Çalışma saati sıra/format doğrulaması** — `src/lib/validation.ts`
- `dayShiftSchema` bir `.refine()` ile HH:MM formatı VE bitiş > başlangıç kontrolü yapacak şekilde
  güncellenir; hem `businessUpdateSchema.working_hours` hem `staffCreateSchema`/`staffUpdateSchema`
  bunu kullanır. Geçersiz aralık artık `400 invalid_input` ile reddedilir (şu an sessizce "hiç
  uygun saat yok" sonucuna yol açıyordu).

**I2 (madde 18). PostgREST filtre enjeksiyonu** — `src/lib/ai/assistantTools.ts`, `src/app/api/customers/route.ts`
- Yeni `sanitizeSearchTerm(term: string)` yardımcı fonksiyonu (`,`, `(`, `)`, `%` gibi PostgREST
  `.or()` sözdizimini bozan karakterleri temizler), her iki arama noktasında da kullanılacak.

### Grup J — AI tutarlılığı

**J1 (madde 23). Tekrarlanan model sabiti** — yeni `src/lib/ai/model.ts` (`export const AI_MODEL = "gemini-3.5-flash-lite"`)
- `src/lib/ai/respond.ts`, `src/lib/ai/assistant.ts`, `src/lib/ai/financeCommentary.ts` buradan import eder.

**J2 (madde 20). Sistem mesajlarının AI geçmişine karışması** — `supabase/schema.sql`, webhook route, `src/lib/reminders.ts`, `src/app/api/action-objects/[id]/route.ts`, `src/lib/ai/respond.ts`
- `whatsapp_message_log.message_type` check constraint'ine `'system_notice'` eklenir. KVKK onay
  mesajı, sistem-hatası fallback'i, hatırlatmalar ve proaktif öneri mesajları artık `'freeform'`
  yerine `'system_notice'` ile loglanır. `respond.ts`'teki `loadHistory`, sadece `'freeform'`
  filtrelemeye devam ettiği için bu mesajlar otomatik olarak AI'ın kendi konuşma geçmişinden düşer.

**J3 (madde 19). `/asistan` geçmişinin kalıcı olması** — yeni tablo `assistant_message_log`, `src/app/api/assistant/route.ts`, `src/app/asistan/AsistanClient.tsx`
- `assistant_message_log(id, business_id, role, body, created_at)` eklenir (RLS: "own" politikası,
  diğer tablolarla aynı desen). `/api/assistant` artık client'ın gönderdiği `history`'e güvenmek
  yerine son N mesajı bu tablodan okur, soru+cevabı da buraya yazar. `AsistanClient.tsx`'teki
  client-side state sadece anlık render için kalır, `history` artık API'ye gönderilmez.

### Grup K — Çoklu hizmet manuel randevu (madde 8)

**K1.** `src/app/randevu-olustur/RandevuOlusturClient.tsx`
- `selectedServiceId: string|null` → `selectedServiceIds: string[]`; hizmet chip'leri çoklu-
  seçilebilir hale gelir (tıklayınca ekle/çıkar), toplam süre/fiyat üstte gösterilir.

**K2.** `src/app/api/appointments/available-slots/route.ts`
- Tek `service_id` yerine tekrarlı `service_id` query param'ları (`?service_id=a&service_id=b`)
  kabul edecek şekilde güncellenir, `findAvailableSlots`'a zaten desteklediği `Service[]` dizisi
  geçilir (motor değişmez, D1'deki backtracking düzeltmesi sayesinde doğru çoklu-personel ataması
  şimdiden çalışıyor olacak).

**K3.** Randevu özeti ve `POST /api/appointments` body'si (`services: [...]`) seçilen tüm hizmet+
  personel satırlarını içerecek şekilde güncellenir; toplam fiyat gösterilir.

### Grup L — UX cilası ve küçük sağlamlaştırmalar

- **L1 (Düşük).** Hizmetler/İşletme Ayarları/Müşteri Profili formlarına (`HizmetlerClient`,
  `IsletmeClient`, `MusteriDetayClient`) başarısız `PATCH/POST` sonrası görünür kısa hata mesajı.
- **L2 (Düşük).** `RandevuOlusturClient.tsx` — uygun saat sorgusunda eski/gecikmiş cevabı yok
  sayan bir istek-sırası koruması (`useRef` sayaç).
- **L3 (Düşük).** `GunSonuClient.tsx` — Türkçe ondalık girişini (binlik ayraç dahil) doğru
  ayrıştıran küçük bir `parseTLInput` fonksiyonu.
- **L4 (Düşük).** `src/app/api/onboarding/route.ts` — `23505` unique-violation yakalanıp
  `already_onboarded` (409) olarak dönülür (ham 500 yerine).
- **L5 (Düşük).** `src/app/login/page.tsx` — Supabase'in `resetPasswordForEmail`'i ile
  "Şifremi unuttum" linki + basit bir onay ekranı.
- **L6 (Düşük — billing kill-switch).** `src/lib/auth.ts`, webhook route —
  `business.is_active === false` ise sayfalarda "hesap pasif" ekranına yönlendirme, API'lerde 403,
  webhook'ta mesaj işlenmemesi. Ödeme sistemi kurulmuyor, sadece var olan ama hiç kontrol
  edilmeyen kolon gerçek bir manuel kapatma anahtarına dönüştürülüyor.
- **L7 (Düşük).** `src/app/api/appointments/available-slots/route.ts` —
  `staff_service_expertise` sorgusuna açık `.in("staff_id", ...)` filtresi (savunma katmanı).
- **L8 (Düşük).** `src/app/musteriler/[id]/MusteriDetayClient.tsx` — "tercih edilen personel"
  listesinde pasif personelin adının yanına "(pasif)" etiketi.

### Doküman notu (madde 21)
- `docs/PROJE_DURUMU.md`'ye kısa not: `businesses.timezone` alanı şu an hiçbir yerde okunmuyor,
  tüm tarih/saat hesapları sabit UTC+3 varsayıyor; Türkiye dışına çıkılırsa ele alınmalı, şimdilik
  kasıtlı olarak dokunulmadı.

## Doğrulama Planı

1. Her grup sonrası `npm run build && npm run start` ile gerçek Supabase'e karşı test (mevcut
   proje disiplini — sadece build yeterli kanıt değil).
2. **F**: Webhook'a bir resim/konum mesajı payload'ı simüle edip fallback yanıtın gittiğini,
   ardından art arda aynı yeni numaradan iki hızlı istek gönderip ikisinin de işlendiğini doğrula.
3. **G**: Test işletmelerinden birine kasıtlı bozuk veri koyup nightly cron'u tetikleyip pilot
   işletmenin sonucunun etkilenmediğini doğrula; yanlış CRON_SECRET ile istek atıp 401 aldığını,
   header'ı hiç göndermeden de 401 aldığını doğrula.
4. **H**: Bir personelin prim oranını değiştirip geçmiş ayın priminin DEĞİŞMEDİĞİNİ, yeni
   randevuların yeni orana göre hesaplandığını doğrula; Gün Sonu'na gider girip net kârın doğru
   hesaplandığını doğrula.
5. **I**: Çalışma saatini ters (19:00-09:00) kaydetmeyi dene → 400 dönmeli; virgüllü bir müşteri
   adıyla arama yap → hata vermeden çalışmalı.
6. **J**: Bir KVKK/hatırlatma mesajından sonra AI'a soru sorup modelin bu sistem mesajını kendi
   sözüymüş gibi referans almadığını gözlemle; `/asistan`'da soru sorup sayfayı yenileyip
   geçmişin (varsa okunuyorsa) DB'den geldiğini doğrula.
7. **K**: Manuel ekrandan "saç kesimi + sakal" gibi iki farklı personel gerektiren bir kombinasyonu
   tek randevuda oluşturmayı dene, ikisinin de doğru personele atandığını doğrula.
8. **L**: Her küçük düzeltmeyi ilgili ekranda elle tıklayıp doğrula (hata mesajları görünüyor mu,
   pasif personel etiketleniyor mu, vb.).
