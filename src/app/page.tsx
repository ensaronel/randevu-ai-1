import Link from "next/link";

const FEATURES = [
  {
    title: "WhatsApp'tan otomatik randevu",
    description:
      "Müşterileriniz WhatsApp'tan yazdığında yapay zeka uygun saati bulur, onaylar ve randevuyu sisteme işler — siz uğraşmazsınız.",
  },
  {
    title: "Çakışmasız takvim",
    description:
      "Personel ve saat çakışmaları otomatik engellenir; randevu iptal olduğunda tüm kayıtlar tutarlı şekilde güncellenir.",
  },
  {
    title: "Otomatik hatırlatmalar",
    description: "Randevudan 24 saat ve 1 saat önce müşteriye otomatik WhatsApp hatırlatma mesajı gider.",
  },
  {
    title: "Gün sonu mutabakatı ve prim",
    description: "Günlük ciro, personel primleri ve no-show takibi otomatik hesaplanır.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col flex-1 bg-bg text-ink">
      <header className="flex items-center justify-between px-6 py-5 max-w-5xl w-full mx-auto">
        <span className="font-display text-xl font-semibold">Randevu AI</span>
        <Link
          href="/login"
          className="text-sm font-semibold text-accent-ink bg-accent-soft px-4 py-2 rounded-full"
        >
          Giriş Yap
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center px-6">
        <section className="max-w-2xl w-full text-center pt-12 pb-16 flex flex-col items-center gap-5">
          <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-tight">
            Kuaför ve güzellik salonları için
            <br /> yapay zeka destekli randevu asistanı
          </h1>
          <p className="text-lg text-ink-muted max-w-xl">
            Müşterileriniz WhatsApp'tan randevu istesin, yapay zeka sizin yerinize yanıtlasın —
            siz işinize odaklanın.
          </p>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl w-full pb-16">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-2 text-left">
              <h2 className="font-display text-lg font-semibold">{f.title}</h2>
              <p className="text-sm text-ink-muted">{f.description}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-6 px-6">
        <div className="max-w-5xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-ink-muted">
          <span>© {new Date().getFullYear()} Randevu AI</span>
          <a href="mailto:ensarronel@gmail.com" className="font-medium text-accent-ink">
            ensarronel@gmail.com
          </a>
        </div>
      </footer>
    </div>
  );
}
