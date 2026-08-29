# Randevu Bazlı İşletmeler için AI Destekli Yönetim Sistemi — MVP Yol Haritası (14 Hafta)

## Bağlam

Önceki konuşmalarda şu strateji netleşti: güzellik salonu/kuaför dikeyinde başlayan, WhatsApp üzerinden gerçek randevu işlemleri yapabilen bir AI + randevu/CRM/finans veri çekirdeği + dashboard'da tek-tık aksiyon alabilen bir "AI işletme yöneticisi" kuruyoruz. Rakip araştırması (LunaraBook, Fresha, Zenoti, Menajer.im, AtlasPlan vb.) şunu gösterdi: temel randevu/CRM/finans özellikleri artık standart, telefon sesli AI da hızla emtiaya dönüşüyor — asıl fark, randevu+CRM+finans+personel verisini birleştirip **otonom aksiyon alan** bir katman kurmakta. 4 ekran için bir UI mockup'ı da hazırlandı (dashboard, gün sonu mutabakat, takvim, müşteri profili) — bu plan o tasarımı gerçek, çalışan bir MVP'ye çevirmenin haftalık dökümü.

Plan bir kez gözden geçirildi ve 8 eksik tespit edildi (WhatsApp şablon onayı, AI eskalasyon, KVKK, baseline ölçüm, hata bildirimi, prim/komisyon, hizmet/personel/ayarlar ekranları, serbest doğal dil soru-cevap) — kullanıcı hepsinin MVP kapsamına girmesini istedi. Bu, planı 12 haftadan **14 haftaya** çıkardı (onaylanan 10-14 haftalık aralığın üst sınırı, yeniden onay gerekmiyor).

**Kısıtlar (kullanıcı onaylı):**
- Ekip: tek kişi + Claude Code (kodun tamamını ben yazacağım, kullanıcı iş tarafını ve testi yönetecek)
- Süre hedefi: 10-14 hafta, bu planda 14 hafta üzerinden gidiyoruz
- Pilot: kullanıcının kendi/yakınının işletmesi — dışarıda pilot aramaya gerek yok
- Bütçe: çok sınırlı (bootstrap) — bu, tech stack seçimini doğrudan belirliyor
- Ürün MVP'de bir mobil-öncelikli **responsive web uygulaması** (Next.js) — native app store uygulaması değil

## Tech stack kararı (bootstrap'a göre)

- **Next.js (TypeScript)** — tek repo içinde hem dashboard UI hem API route'ları, Vercel ücretsiz katmanına sorunsuz deploy olur.
- **Supabase (Postgres)** — ücretsiz katmanı MVP ölçeği için yeterli; auth, veritabanı ve zamanlanmış görevler (pg_cron) tek yerden.
- **Anthropic API (Claude Haiku)** — WhatsApp AI'ın ve serbest soru-cevap arayüzünün muhakeme motoru; ucuz, fonksiyon çağırma (tool use) destekli.
- **WhatsApp Cloud API (Meta, resmi)** — aracı firma (BSP) komisyonu ödememek için doğrudan Meta'nın resmi API'si. Hem işletme doğrulaması hem mesaj şablonu onayı 1-2 hafta sürebilir, ikisi de **Hafta 1'de birlikte başlatılacak**.
- **Vercel Cron / Supabase Edge Functions** — sabah özeti, hatırlatmalar, gece taraması gibi zamanlanmış AI işleri için.
- **Hata bildirimi için ek servis yok** — bot bir mesajı işleyemezse veya çökerse, zaten kurulu WhatsApp altyapısı üzerinden işletme sahibinin kendi numarasına uyarı mesajı gönderilecek (ek maliyet yok).

Tahmini aylık maliyet (pilot ölçeğinde, 1 salon): Supabase $0, Vercel $0, Anthropic API ~$5-20, WhatsApp Cloud API çoğu mesaj müşteri-başlatımlı 24 saatlik pencerede ücretsiz — toplam muhtemelen ayda birkaç yüz TL'yi geçmez. Meta'nın güncel Türkiye fiyatlandırması Hafta 1'de doğrulanacak.

## Haftalık plan

**Hafta 1 — Kurulum + Meta doğrulama + mesaj şablonu başvurusu**
- Ben: Next.js + Supabase proje iskeleti, veri modeli tasarımı (işletme, personel, hizmet, müşteri, randevu, günlük finansal özet, aksiyon nesnesi, prim/komisyon kuralı tabloları), repo yapısı.
- Sen: Meta Business Manager hesabı aç, WhatsApp Business doğrulama sürecini başlat, **hatırlatma/boşluk-doldurma/geri-kazanım mesajları için şablon başvurusunu da aynı anda yap** (bu unutulmuştu, en büyük gecikme riski), Anthropic API hesabı + billing, Supabase/Vercel hesabı.
- Doğrulama: Supabase'de tablolar oluşuyor, local'de Next.js ayağa kalkıyor.

**Hafta 2 — Çekirdek veri modeli + temel CRUD**
- Ben: Hizmet, personel, müşteri, randevu CRUD API'leri; işletme sahibi girişi (auth).
- Doğrulama: API üzerinden örnek hizmet/personel/müşteri kaydı oluşturup okunabiliyor.

**Hafta 3 — Dashboard ve Takvim ekranlarının iskeleti**
- Ben: Mockup'taki tasarımı gerçek veriye bağlayan Dashboard ve Takvim ekranları (henüz AI yok, ham veri gösterimi).
- Doğrulama: Girilen randevular takvimde personel bazlı doğru saatte görünüyor.

**Hafta 4 — WhatsApp Cloud API bağlantısı + KVKK aydınlatma akışı**
- Ben: Webhook kurulumu, mesaj alma/gönderme; bir müşteri ilk kez yazdığında kısa bir KVKK aydınlatma/onay mesajı otomatik gönderilmesi (telefon numarası, ziyaret geçmişi, tercih notu gibi verilerin işleneceğine dair) — onay tarihi/saati müşteri kaydına işlenir.
- Sen: Meta doğrulaması tamamlanmışsa gerçek numarayı bağlama; tamamlanmadıysa test numarasıyla devam.
- Doğrulama: WhatsApp'tan yazılan mesaj sistemde görünüyor, KVKK metni ilk mesajda otomatik gidiyor.

**Hafta 5 — AI randevu beyni v1 + eskalasyon**
- Ben: Claude fonksiyon-çağırma ile mesajı ayrıştırma → hizmet/personel eşleştirme (birden fazla hizmet farklı personel gerektiriyorsa ikisini de eşzamanlı ayarlama) → müsaitlik kontrolü → 2-3 "en iyi" saat önerisi → onay sonrası gerçek randevu oluşturma. **AI niyeti anlayamazsa veya güven skoru düşükse**: müşteriye "hemen yardımcı olamadım, size dönüş yapacağız" mesajı + işletme sahibine bildirim — sessizce takılıp kalmıyor.
- Doğrulama: "Yarın saç kesimi istiyorum" mesajına doğru saat önerisi; kasıtlı olarak anlaşılmaz bir mesaj gönderildiğinde eskalasyon çalışıyor.

**Hafta 6 — Uçtan uca WhatsApp akışı + hata bildirimi**
- Ben: Onay/red akışı, 24 saat öncesi otomatik hatırlatma (onaylı şablonla), müşteri kaynaklı iptal/erteleme talebi işleme; sistemde bir hata/çökme olduğunda işletme sahibine otomatik uyarı mesajı.
- Doğrulama: Tam bir randevu döngüsü manuel test ile çalışıyor; kasıtlı bir hata tetiklendiğinde uyarı gerçekten ulaşıyor.

**Hafta 7 — Gün Sonu Mutabakat + prim/komisyon hesaplama**
- Ben: Geldi/haber verdi/haber vermedi işaretleme, +ekle/-indirim düzeltmesi, gerçekleşen ciro hesaplama, no-show verisinin müşteri kaydına işlenmesi; **aynı mutabakat verisinden personel bazlı prim/komisyon hesaplama** (otomatik aylık toplam). Prim oranı için ayar ekranı henüz yok (Hafta 10'da gelecek) — bu haftalık geçici olarak arka planda varsayılan bir oranla tanımlanır.
- Doğrulama: Gün sonu listesi doğru ciroyu üretiyor; bir personelin ay sonu prim toplamı doğru hesaplanıyor.

**Hafta 8 — Dashboard AI özeti + günlük finans yorumu**
- Ben: Her gece çalışan zamanlanmış görev — dünün cirosunu geçen haftaya/aylık ortalamaya kıyaslama, anlamlı sapmalarda kısa AI yorumu üretme, sabah özetine ekleme.
- Doğrulama: Gerçekleşmiş test verisiyle sabah özeti doğru ve gürültüsüz üretiliyor.

**Hafta 9 — Proaktif AI: boşluk doldurma + risk tespiti + kişiye özel ritim daveti**
- Ben: İptal olduğunda bekleme listesi eşleştirme + taslak mesaj + tek-tık gönder (onaylı şablon kullanarak); ziyaret aralığına göre "risk altında" müşteri tespiti ve indirimsiz kişisel mesaj önerisi.
- Ayrıca: müşterinin sabit bir hizmet kombinasyonu + düzenli ziyaret ritmi varsa (örn. "hep saç boyama + manikür, ~5 haftada bir"), ritmi dolmadan önce ona özel, zamanlanmış bir hatırlatma/davet gönderilir — **indirimsiz**, çünkü zaten gelecek bir müşteriye indirim vermek davranış değiştirmiyor, sadece marj kaybettiriyor. İndirim yalnızca davranış değiştirme amaçlı durumlarda kullanılır: müşterinin denemediği bir hizmeti denemesi için (çapraz satış) veya işletmenin doldurmakta zorlandığı bir saate onu çekmek için.
- Doğrulama: Bir randevu iptal edildiğinde uygun bekleme listesi adayı öneriliyor; ziyaret aralığı geçen müşteri dashboard'da uyarı olarak çıkıyor; sabit ritmi olan bir müşteri için ritim dolmadan doğru zamanda, indirimsiz bir davet öneriliyor.

**Hafta 10 — Hizmetler / Çalışanlar / Ayarlar ekranları + personel performansı**
- Ben: İşletme sahibinin kendi başına hizmet ekleyip fiyat/süre girebildiği, personel ekleyip çalışma saati/izin/tatil günü tanımlayabildiği, genel işletme ayarlarını (çalışma saatleri, kapanış günleri) yönetebildiği self-servis ekranlar.
- Ben: Çalışanlar ekranına hafif bir **personel performansı** görünümü — mevcut verilerden (Hafta 7'nin prim/komisyon hesaplaması, randevu kayıtları) türetilen doluluk oranı (booked/available saat), aylık ciro ve no-show/iptal oranı, personel bazlı karşılaştırmalı liste. Yeni veri modeli gerekmiyor, var olan hesaplamaların üstüne bir görünüm. İleri düzey "potansiyel tahmini" (trend/büyüme tahmini gibi) bilinçli olarak MVP dışı bırakıldı — Hafta 9'daki müşteri risk tespiti mantığına benzer bir iyileştirme olarak ileride ayrıca değerlendirilebilir.
- Doğrulama: Yeni bir hizmet veya personel eklendiğinde takvim ve AI eşleştirmesi bunu otomatik tanıyor; personel performansı listesi gerçek randevu/mutabakat verisiyle doğru doluluk oranı ve ciro gösteriyor.

**Hafta 11 — Serbest doğal dil soru-cevap (AI Asistan)**
- Ben: Owner'ın dashboard'dan "Bu ay neden az kazandım?", "Yarın ne yapmalıyım?" gibi serbest soru sorabildiği bir sohbet arayüzü; AI bu soruyu randevu+finans+personel verisine karşı çalıştırıp ilişkilendirilmiş bir cevap üretiyor. **Elindeki veriyle güvenilir bir cevap veremiyorsa uydurmaz** — "bu soruyu yanıtlayacak yeterli veri yok" der. (Finansal bir soruya yanlış güvenle yanlış cevap vermek gerçek bir risk, bu yüzden bu kural WhatsApp AI'dan farklı olarak burada özellikle vurgulanıyor.)
- Doğrulama: Gerçek test verisiyle sorulan bir soruya (örn. "Zeynep'in bu hafta doluluğu nasıl?") doğru ve veriye dayalı cevap alınıyor.

**Hafta 12 — Müşteri profili (CRM) + aksiyon geçmişi**
- Ben: Mockup'taki müşteri profilini gerçek veriye bağlama (geçmiş, harcama, notlar, AI uyarı rozeti) + her AI önerisinin "önerildi → onaylandı/reddedildi → sonuç" geçmişinin kaydı (güven eğrisi altyapısı).
- Doğrulama: Bir müşteri profilinde geçmiş randevular ve AI uyarısı doğru görünüyor; öneri geçmişi veritabanında izlenebiliyor.

**Hafta 13 — Pilot kurulumu + baseline ölçüm**
- Ben: Kullanıcının/yakınının gerçek işletme verisini (hizmetler, personel, mevcut müşteri listesi) sisteme aktarma; UI'da tespit edilen sorunları düzeltme.
- Sen: **Geçişten önce işletmenin mevcut (AI'sız) rakamlarını not et** — son 1 ayın ortalama iptal/no-show oranı, kaç eski müşteri geri gelmiyor, ortalama harcamaları (Hafta 14'teki karşılaştırma ve satış/pitch materyali için şart). Ardından gerçek WhatsApp numarasına geçiş, birkaç gün paralel (manuel yöntemle birlikte) test.
- Doğrulama: Gerçek bir müşteri WhatsApp'tan gerçek bir randevu alabiliyor; baseline rakamlar not edilmiş durumda.

**Hafta 14 — Canlı pilot + iyileştirme**
- Ben: Pilot sırasında çıkan hataları düzeltme, geri bildirime göre ince ayar (mesaj tonu, öneri sıklığı, dashboard netliği).
- Sen: Günlük kullanım, geri bildirim, gün sonu mutabakatını gerçekten uygulama.
- Doğrulama/çıktı: Hafta 13'teki baseline'a karşı somut kıyaslama — kaç randevu AI ile alındı, kaç boşluk dolduruldu, no-show oranı ne kadar düştü, gün sonu mutabakatı ne kadar sürede tamamlandı. Bu sayılar hem MVP başarısının kanıtı hem de kâr hesaplayıcı/pitch materyalinin ilk gerçek vaka verisi olacak.

## Ek görev: Satış/Pitch Aracı — Kâr Hesaplayıcı

Ana 14 haftalık yol haritasına paralel, ayrı bir küçük teslimat: işletme sahiplerine ürünü tanıtırken kullanılacak, soyut vaat yerine **onların kendi rakamlarıyla** somut kayıp/kazanç gösteren basit bir hesaplama aracı.

- **Amaç:** Demo sırasında canlı olarak üç veri sorulur (aylık ortalama iptal/no-show sayısı, ortalama hizmet fiyatı, düzenli gelip de kaybedilen müşteri sayısı ve ortalama harcamaları) → araç anında "ayda tahmini X TL kaybediyorsunuz, sistem bunun bir kısmını geri kazandırabilir" şeklinde somut bir çıktı üretir.
- **Neden ayrı:** Çok hafif bir teslimat (tek sayfa, basit hesap mantığı), ana ürünün teknik altyapısına bağımlı değil — MVP'nin herhangi bir haftasında, hatta Hafta 1-2 gibi erken bir noktada paralel olarak hazırlanabilir.
- **Ne zaman lazım olacak:** Pilot bitmeden önce de başka işletmelerle ön görüşme yapılacaksa erken faydalı; ama en güçlü hali Hafta 14 sonunda pilotun gerçek sonuçlarıyla (gerçek "kurtarılan TL" rakamıyla) güncellenmiş hâli olacak.
- **Tasarım:** Önceki UI mockup'ıyla aynı görsel dil (sıcak/terrakota palet) — telefonda salon sahibinin karşısında açılıp kullanılacak kadar sade ve hızlı olmalı.

## Veri güvenliği ilkeleri (baştan itibaren geçerli)

- Şema değişiklikleri her zaman migration dosyasıyla yapılır — veritabanına elle/ad-hoc yıkıcı SQL çalıştırılmaz, DROP/TRUNCATE/WHERE'siz DELETE asla onaysız çalıştırılmaz.
- "Silme" işlemleri soft-delete (durum/pasif işaretleme) ile yapılır, satır kalıcı olarak silinmez.
- Gerçek işletme verisi girmeye başlamadan önce (Hafta 13) basit bir otomatik yedekleme mekanizması kurulur — Supabase ücretsiz katmanının yedekleme garantisi sınırlı olduğu için bu adım atlanmaz.
- Test/geliştirme her zaman sahte veriyle yapılır; pilot canlıya geçtikten sonra üretim verisi üzerinde deneysel bir değişiklik gerekirse önce kullanıcıya haber verilir.

## Kritik bağımlılıklar / riskler
- **Meta WhatsApp doğrulaması + mesaj şablonu onayı** en büyük zaman riski — ikisi de Hafta 1'de başlatılmazsa Hafta 4, 6 ve 9 kayar.
- **Pilot işletmenin gerçek verisi** (hizmet listesi, fiyatlar, personel çalışma saatleri) Hafta 12 sonuna kadar netleşmeli, yoksa Hafta 13 kurulumu gecikir.
- **Baseline rakamlar** Hafta 13'te geçişten önce mutlaka not edilmeli — sonradan geriye dönük tahmin etmek güvenilmez olur.
- Bütçe çok sınırlı olduğu için ücretli deneme/hata payı az — her hafta sonunda maliyet kontrolü (özellikle Anthropic API kullanım miktarı) yapılacak.

## Bilinçli olarak MVP dışı bırakılanlar (unutulmadı, ertelendi)
- Telefon sesli AI (Faz 2)
- Kapora/depozito mantığı (Faz 2, sadece yüksek bedelli hizmetlerde seçici olarak düşünülecek)
- Personel bazlı ayrı giriş/rol yetkilendirmesi (MVP'de tek owner girişi yeterli, pilot tek işletme olduğu için)
- SaaS'ın kendi ticari web sitesi / ToS / ödeme sistemi (pilot ücretsiz ve dahili; başka işletmelere satışa geçilirken gerekecek)
- Personel "potansiyel tahmini" (trend/büyüme tahmini gibi ileri düzey analiz) — Hafta 10'daki hafif personel performansı görünümünün (doluluk oranı, ciro, no-show oranı) ötesinde; ileride Hafta 9'daki müşteri risk tespiti mantığına benzer bir iyileştirme olarak değerlendirilebilir

## Doğrulama / test yaklaşımı
Her hafta sonunda o haftanın özelliği gerçek (ama düşük hacimli) veriyle manuel olarak uçtan uca test edilecek — otomatik test paketi MVP aşamasında kapsam dışı, hıza öncelik veriliyor. Hafta 13-14'teki pilot, sistemin gerçek dünya doğrulamasıdır.
