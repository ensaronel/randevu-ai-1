// Takvimde her personelin randevu bloğu, hangi ustaya ait olduğu bir bakışta
// anlaşılsın diye kendine özgü bir renk alır (markanın lacivert/amber/yeşil/
// pembe paletiyle uyumlu, personel sayısı arttıkça döngüye girer).
const STAFF_COLORS: { border: string; bg: string; text: string }[] = [
  { border: "var(--accent)", bg: "var(--accent-soft)", text: "var(--accent-ink)" },
  { border: "var(--accent2)", bg: "var(--accent2-soft)", text: "var(--accent2-ink)" },
  { border: "var(--block2-ink)", bg: "var(--block2)", text: "var(--block2-ink)" },
  { border: "var(--block1-ink)", bg: "var(--block1)", text: "var(--block1-ink)" },
  { border: "oklch(55% 0.1 300)", bg: "oklch(93% 0.03 300)", text: "oklch(32% 0.08 300)" },
  { border: "oklch(55% 0.09 210)", bg: "oklch(93% 0.025 210)", text: "oklch(30% 0.07 210)" },
];

export function colorForStaffIndex(index: number) {
  return STAFF_COLORS[index % STAFF_COLORS.length];
}
