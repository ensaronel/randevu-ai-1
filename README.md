# Randevu AI

Randevu bazlı işletmeler (önce güzellik salonu/kuaför) için AI destekli yönetim sistemi. WhatsApp üzerinden gerçek randevu alan bir AI + dashboard'da tek-tık aksiyon alan bir "AI işletme yöneticisi".

Yol haritası: `C:\Users\Muhammed Ensar Önel\.claude\plans\enchanted-painting-waffle.md`

## Tech stack

- Next.js (TypeScript, App Router)
- Supabase (Postgres + Auth)
- Anthropic API (Claude Haiku — WhatsApp AI ve serbest soru-cevap motoru)
- WhatsApp Cloud API (Meta, resmi)

## Kurulum (Hafta 1 — senin yapman gerekenler)

1. **Supabase**
   - supabase.com üzerinden yeni proje oluştur (bölge: Avrupa'ya yakın, örn. Frankfurt).
   - `supabase/schema.sql` dosyasını Supabase SQL Editor'de çalıştır.
   - Project Settings → API'den URL ve anon key'i al, `.env.local` dosyasına yaz (`.env.local.example`'ı kopyala).

2. **Anthropic**
   - console.anthropic.com'da hesap aç, billing ekle, API key oluştur.

3. **Meta / WhatsApp**
   - business.facebook.com'da Business Manager hesabı aç.
   - developers.facebook.com'da bir App oluşturup WhatsApp ürününü ekle.
   - İşletme doğrulama (Business Verification) sürecini başlat.
   - Hatırlatma/boşluk-doldurma/geri-kazanım mesajları için şablon (template) başvurusunu da aynı anda yap — bu, işletme doğrulaması kadar önemli, ikisi de günler sürebilir.

4. **Vercel**
   - vercel.com'da hesap aç, GitHub reposuna bağla (deploy Hafta 3-4 civarı gerekecek).

## Geliştirme

```bash
npm install
npm run dev
```

## Veri güvenliği ilkeleri

- Şema değişiklikleri migration dosyasıyla yapılır, veritabanına elle yıkıcı SQL çalıştırılmaz.
- Silme işlemleri soft-delete (durum alanı) ile yapılır.
- Gerçek işletme verisi girmeden önce (Hafta 13) otomatik yedekleme kurulur.
