# Randevu AI — AI Aksiyon Yetkisi ve Ürün İyileştirmeleri

## Bağlam

Tasarım sistemi çalışması sırasında kullanıcıyla yapılan beyin fırtınasında şu ürün eksikleri
tespit edildi: owner'ın hiçbir ekrandan randevu iptal/erteleme yapamaması, Ana Sayfa'nın "boş"
hissettirmesi, Takvim'in yoğunlukta karışması, ve owner'ın AI Asistanının (`/asistan`) sadece
rapor okuyup hiçbir işlem yapamaması. Kullanıcının kendi önerisi: iptal/randevu oluşturma
yetkisini manuel buton yerine (veya onunla birlikte) AI Asistanına vermek — ürünün "AI destekli"
kimliğine daha uygun.

Kapsam büyük olduğu için **Faz 1** (bu oturumda uygulanacak, en yüksek değer/en somut) ve
**Faz 2/3** (belgelenip sıraya alınacak) olarak ikiye ayrıldı.

## Faz 1 — Bu oturumda uygulanacak

**F1. Owner AI Asistanına aksiyon yetkisi** — `src/lib/ai/assistantTools.ts`, `src/lib/ai/assistant.ts`, `supabase/schema.sql`
- Yeni araçlar: `find_customer_appointments` (müşteri adına göre yaklaşan randevularını bulur),
  `check_availability_for_owner` (WhatsApp'taki ile aynı `findAvailableSlots` motorunu kullanır),
  `create_appointment_action`, `cancel_appointment_action`, `reschedule_appointment_action`.
- Güvenlik: WhatsApp botundaki kanıtlanmış desenle aynı — sistem promptu, gerçek bir değişiklik
  (iptal/oluşturma/erteleme) yapmadan önce owner'a "böyle yapayım mı?" diye açıkça sorup onay
  almadan asla ilgili aracı çağırmamasını söylüyor.
- `reschedule_appointment_with_check` RPC'sine, `create_appointment_with_services`'teki gibi
  opsiyonel `p_business_id` parametresi eklenmesi gerekiyor (küçük bir SQL migration) — çünkü
  owner asistanı service-role (admin) client kullanıyor, RLS'nin `current_business_id()`'sine
  güvenemez.

**F2. Ana Sayfa zenginleştirme** — `src/app/dashboard/page.tsx`
- Bugünün kalan randevularının kısa listesi (saat, müşteri, hizmet, personel).
- Gün Sonu henüz kapatılmadıysa hatırlatma kartı.
- Bugün kim çalışıyor (izinliler dahil) satırı.

**F3. Takvim netliği** — `src/app/takvim/page.tsx`
- Bugünse "şu an" çizgisi (kırmızı yatay çizgi).
- Grid, sabit 09:00-19:00 yerine o günkü gerçek en erken açılış/en geç kapanışa göre boyutlanacak.

## Faz 2 — Sıradaki pakette (belgelendi, henüz yapılmadı)

- AI raporlama derinliği: "en popüler hizmet", "en yoğun saatler", "kimi kaybettik" analiz araçları.
- Gece cron'una haftalık proaktif özet mesajı (Pazartesi owner'a WhatsApp'tan geçen haftanın özeti).
- Bekleme listesi görünürlük sayfası (kaç kişi bekliyor, kimler).
- Boş ekranlara (Dashboard sıfır durumu vb.) yönlendirici açıklama metinleri.

## Faz 3 — Daha büyük, ayrı iş olarak değerlendirilecek

- Bildirim merkezi (eskalasyon + AI önerileri + sistem hataları tek ekranda).
- Aylık ciro/gider özetini CSV/PDF olarak dışa aktarma.

## Doğrulama

- F1: Owner asistanına "Ayşe'nin yarınki randevusunu iptal et" gibi bir komut yazıp önce onay
  sorduğunu, "evet" deyince gerçekten iptal ettiğini gerçek verilerle doğrula.
- F2/F3: `npm run build && npm run start` ile gerçek Supabase'e karşı görsel kontrol.
