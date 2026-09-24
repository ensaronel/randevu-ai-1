import { addDaysToKey, dateKeyTR } from "@/lib/date";

/**
 * Tanıtım (demo) hesabı için ortak yapı taşları. Bu klasördeki betikler SADECE demo/test işletmesine
 * uygulanmak içindir (bkz. seed-demo-business.ts başındaki güvenlik kontrolleri).
 */

// ------------------------------------------------------------------ rastgelelik (sabit tohum)

export function makeRng(seed: number) {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rand = (min: number, max: number) => min + next() * (max - min);
  const int = (min: number, max: number) => Math.floor(rand(min, max + 1));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)];
  const chance = (p: number) => next() < p;
  const weighted = <T,>(items: readonly T[], weights: readonly number[]): T => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };
  /** Ağırlıklı rastgele sıralama (yüksek ağırlık daha önce gelir). */
  const weightedOrder = <T,>(items: readonly T[], weightOf: (item: T) => number): T[] =>
    items
      .map((item) => ({ item, key: Math.pow(next(), 1 / Math.max(0.0001, weightOf(item))) }))
      .sort((x, y) => y.key - x.key)
      .map((x) => x.item);
  return { next, rand, int, pick, chance, weighted, weightedOrder };
}

export type Rng = ReturnType<typeof makeRng>;

// ------------------------------------------------------------------ tarih yardımcıları

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function todayKey(): string {
  return dateKeyTR(0);
}

export function dayKeyOffset(offset: number): string {
  return addDaysToKey(dateKeyTR(0), offset);
}

export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/** Türkiye yerel "YYYY-MM-DD" + gün içi dakika -> UTC ISO. */
export function localIso(dateKey: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return new Date(`${dateKey}T${hh}:${mm}:00+03:00`).toISOString();
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ personel

export interface StaffDef {
  key: string;
  name: string;
  commissionRate: number;
  /** getUTCDay() indeksi (1=Pzt ... 6=Cmt) -> [açılış saati, kapanış saati] */
  hours: Record<number, [number, number]>;
  /** Bugünden itibaren izinli olunan gün ofsetleri. */
  leaveOffsets: number[];
}

export const STAFF: StaffDef[] = [
  {
    key: "elif",
    name: "Elif Yıldız",
    commissionRate: 25,
    hours: { 1: [9, 19], 2: [9, 19], 3: [9, 19], 4: [9, 19], 5: [9, 19], 6: [9, 18] },
    leaveOffsets: [],
  },
  {
    key: "merve",
    name: "Merve Kaya",
    commissionRate: 22,
    hours: { 2: [10, 19], 3: [10, 19], 4: [10, 19], 5: [10, 19], 6: [10, 18] },
    leaveOffsets: [9],
  },
  {
    key: "selin",
    name: "Selin Demir",
    commissionRate: 20,
    hours: { 1: [10, 18], 2: [10, 18], 3: [10, 18], 4: [10, 18], 5: [10, 18], 6: [10, 18] },
    leaveOffsets: [6, 7],
  },
  {
    key: "buse",
    name: "Buse Aydın",
    commissionRate: 20,
    hours: { 1: [9, 18], 2: [9, 18], 3: [9, 18], 4: [9, 18], 5: [9, 18], 6: [9, 18] },
    leaveOffsets: [],
  },
  {
    key: "aysegul",
    name: "Ayşegül Çelik",
    commissionRate: 15,
    hours: { 1: [10, 19], 2: [10, 19], 3: [10, 19], 4: [10, 19], 5: [10, 19], 6: [10, 16] },
    leaveOffsets: [],
  },
];

export function workingHoursJson(hours: Record<number, [number, number]>) {
  const out: Record<string, [string, string]> = {};
  for (const [day, [open, close]] of Object.entries(hours)) {
    out[DAY_KEYS[Number(day)]] = [hhmm(open * 60), hhmm(close * 60)];
  }
  return out;
}

// ------------------------------------------------------------------ hizmetler

export interface ServiceDef {
  key: string;
  name: string;
  category: string;
  duration: number;
  price: number;
  /** Bu hizmeti verebilen personel (tercih sırasıyla). */
  staff: string[];
}

export const SERVICES: ServiceDef[] = [
  { key: "kesim", name: "Kadın Saç Kesimi", category: "Saç", duration: 60, price: 700, staff: ["elif", "merve"] },
  { key: "fon", name: "Fön", category: "Saç", duration: 45, price: 450, staff: ["elif", "merve"] },
  { key: "boya", name: "Saç Boyama (Dip Boya)", category: "Renk", duration: 120, price: 1800, staff: ["merve", "elif"] },
  { key: "rofle", name: "Röfle / Balyaj", category: "Renk", duration: 180, price: 3800, staff: ["merve"] },
  { key: "keratin", name: "Keratin Bakım", category: "Bakım", duration: 150, price: 3200, staff: ["elif", "merve"] },
  { key: "manikur", name: "Manikür", category: "Tırnak", duration: 45, price: 450, staff: ["buse"] },
  { key: "pedikur", name: "Pedikür", category: "Tırnak", duration: 60, price: 600, staff: ["buse"] },
  { key: "kalici_oje", name: "Kalıcı Oje", category: "Tırnak", duration: 60, price: 550, staff: ["buse"] },
  { key: "protez", name: "Protez Tırnak", category: "Tırnak", duration: 120, price: 1300, staff: ["buse"] },
  { key: "kas", name: "Kaş Şekillendirme", category: "Kaş & Kirpik", duration: 30, price: 300, staff: ["selin"] },
  { key: "kirpik", name: "Kirpik Lifting", category: "Kaş & Kirpik", duration: 60, price: 900, staff: ["selin"] },
  { key: "cilt", name: "Profesyonel Cilt Bakımı", category: "Cilt", duration: 75, price: 1400, staff: ["selin"] },
  { key: "lazer_bacak", name: "Lazer Epilasyon - Tüm Bacak", category: "Lazer", duration: 45, price: 1200, staff: ["aysegul"] },
  { key: "lazer_koltuk", name: "Lazer Epilasyon - Koltuk Altı", category: "Lazer", duration: 20, price: 400, staff: ["aysegul"] },
  { key: "lazer_vucut", name: "Lazer Epilasyon - Tüm Vücut", category: "Lazer", duration: 90, price: 2800, staff: ["aysegul"] },
];

export const SERVICE_BY_KEY = new Map(SERVICES.map((s) => [s.key, s]));
export const STAFF_BY_KEY = new Map(STAFF.map((s) => [s.key, s]));

// ------------------------------------------------------------------ isimler

export const FEMALE_NAMES = [
  "Ayşe", "Fatma", "Emine", "Hatice", "Zeynep", "Elif", "Merve", "Esra", "Büşra", "Seda", "Gizem", "Burcu",
  "Pınar", "Derya", "Ebru", "Özlem", "Sevgi", "Nurcan", "Aslı", "Tuğba", "Ceren", "Sibel", "Gamze", "Yasemin",
  "Songül", "Hülya", "Melek", "Neslihan", "Dilara", "Ece", "İrem", "Buse", "Şeyma", "Rabia", "Betül", "Kübra",
  "Sena", "Nihal", "Cansu", "Sema", "Aylin", "Selin", "Berna", "Damla", "Duygu", "Ezgi", "Figen", "Gül",
  "Hande", "İpek", "Jale", "Leyla", "Müge", "Nazlı", "Oya", "Pelin", "Reyhan", "Sinem", "Tülay", "Ülkü",
  "Vildan", "Yağmur", "Zehra", "Deniz", "Nilay", "Bahar", "Canan", "Filiz",
];

export const MALE_NAMES = ["Mehmet", "Ahmet", "Mustafa", "Can", "Emre", "Burak", "Serkan", "Murat", "Kerem", "Onur", "Barış", "Cem"];

export const SURNAMES = [
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir", "Arslan",
  "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Özkan", "Şimşek", "Polat", "Korkmaz", "Erdoğan",
  "Güneş", "Aksoy", "Tekin", "Bulut", "Yalçın", "Türk", "Acar", "Çakır", "Karaca", "Bozkurt", "Erdem", "Güler",
  "Ünal", "Sezer", "Avcı", "Tunç", "Ateş", "Bayram", "Duman", "Uçar", "Keskin", "Taş", "Özer", "Coşkun",
  "Yavuz", "Işık", "Kaplan", "Sönmez", "Eren", "Balcı", "Altun", "Cengiz", "Kahraman", "Toprak", "Ergin",
];

export const CUSTOMER_NOTES = [
  "Hassas cilt, sert ürün kullanılmasın.",
  "Amonyaklı boya kullanılmasın (alerji).",
  "Randevudan önce WhatsApp'tan hatırlatma istiyor.",
  "Öğleden sonra randevuları tercih ediyor.",
  "Elif Hanım'la çalışmak istiyor.",
  "Kalıcı oje çıkarma işlemi de istiyor.",
  "Hamilelik sürecinde, lazer yapılmıyor.",
  "Genelde arkadaşıyla birlikte geliyor.",
];

/** Sahte (gerçek olmayan) müşteri numarası — bkz. src/lib/whatsapp/client.ts isDemoPhone. */
export function demoPhone(n: number): string {
  return `9000000${String(n).padStart(5, "0")}`;
}
