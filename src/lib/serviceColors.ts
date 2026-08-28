// Hizmet kategorisine göre takvim bloğu rengi (mockup'taki palet ile aynı).
const CATEGORY_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  Kesim: { border: "var(--accent)", bg: "var(--accent-soft)", text: "oklch(30% 0.09 45)" },
  Boya: { border: "oklch(56% 0.11 330)", bg: "oklch(93% 0.03 330)", text: "oklch(30% 0.08 330)" },
  Manikür: { border: "oklch(60% 0.09 190)", bg: "oklch(93% 0.025 190)", text: "oklch(30% 0.06 190)" },
  Pedikür: { border: "oklch(60% 0.09 190)", bg: "oklch(93% 0.025 190)", text: "oklch(30% 0.06 190)" },
  Sakal: { border: "oklch(52% 0.05 65)", bg: "oklch(92% 0.02 65)", text: "oklch(28% 0.03 65)" },
};

const DEFAULT_COLOR = { border: "oklch(55% 0.02 60)", bg: "oklch(92% 0.008 60)", text: "oklch(30% 0.01 60)" };

export function colorForCategory(category: string | null | undefined) {
  if (!category) return DEFAULT_COLOR;
  return CATEGORY_COLORS[category] ?? DEFAULT_COLOR;
}
