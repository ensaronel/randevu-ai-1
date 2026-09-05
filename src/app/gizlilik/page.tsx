export default function GizlilikPolitikasi() {
  return (
    <div className="flex flex-col flex-1 bg-bg text-ink">
      <main className="max-w-2xl w-full mx-auto px-6 py-16 flex flex-col gap-6">
        <h1 className="font-display text-3xl font-semibold">Gizlilik Politikası</h1>
        <p className="text-sm text-ink-muted">Son güncelleme: 5 Eylül 2026</p>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-semibold">Hangi bilgileri topluyoruz</h2>
          <p className="text-ink-muted">
            Randevu AI, hizmet verdiği işletmelerin (kuaför/güzellik salonu) müşterileriyle WhatsApp
            üzerinden randevu almasını sağlar. Bu süreçte müşterinin telefon numarası, adı, randevu
            geçmişi ve WhatsApp üzerinden gönderdiği mesajlar ilgili işletme adına saklanır.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-semibold">Bu bilgileri nasıl kullanıyoruz</h2>
          <p className="text-ink-muted">
            Bilgiler yalnızca randevu oluşturma, hatırlatma ve müşteri hizmetleri amacıyla kullanılır.
            Verileriniz pazarlama amacıyla satılmaz, reklam şirketleriyle paylaşılmaz.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-semibold">Hizmet aldığımız alt yükleniciler</h2>
          <p className="text-ink-muted">
            Randevu AI&apos;yi çalıştırabilmek için verileriniz, yalnızca bizim adımıza teknik hizmet
            veren aşağıdaki alt yüklenicilerle paylaşılır — hiçbiri veriyi kendi amaçları için
            kullanmaz veya üçüncü kişilere satmaz:
          </p>
          <ul className="text-ink-muted list-disc pl-5 flex flex-col gap-1">
            <li>
              <strong>Meta / WhatsApp</strong> — mesajlaşmanın gerçekleştiği iletişim kanalı.
            </li>
            <li>
              <strong>Google (Gemini AI)</strong> — WhatsApp mesajınızı anlayıp uygun randevu yanıtını
              üretmek için mesaj içeriği bu yapay zeka servisine iletilir (yurt dışı, ABD merkezli).
            </li>
            <li>
              <strong>Supabase</strong> — tüm verilerin güvenli şekilde saklandığı veritabanı altyapısı
              (yurt dışı sunucu).
            </li>
          </ul>
          <p className="text-ink-muted">
            Verilerin bir kısmının yurt dışındaki bu hizmet sağlayıcılar üzerinden işlenmesi nedeniyle,
            KVKK kapsamındaki yurt dışı veri aktarımı hükümleri geçerlidir.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-semibold">Veri saklama</h2>
          <p className="text-ink-muted">
            Veriler, hizmet verilen işletme bu sistemi kullanmaya devam ettiği sürece saklanır.
            Bir müşteri kaydının silinmesini talep ederse, işletme üzerinden bize ulaşarak talepte
            bulunabilir.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-semibold">İletişim</h2>
          <p className="text-ink-muted">
            Sorularınız için:{" "}
            <a href="mailto:ensarronel@gmail.com" className="font-medium text-accent-ink">
              ensarronel@gmail.com
            </a>
          </p>
        </section>
      </main>
    </div>
  );
}
