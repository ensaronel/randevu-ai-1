/**
 * Türkçe para girişini (binlik ayraç "." + ondalık ayraç ",") sayıya çevirir.
 * Virgül varsa noktalar binlik ayraç sayılıp silinir. Virgül yoksa ve tek bir
 * nokta 1-2 haneli bir kesirle bitiyorsa ("45.5" gibi) ondalık ayraç kabul
 * edilir, aksi halde ("1.234" gibi) binlik ayraç sayılıp silinir.
 */
export function parseTLInput(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return NaN;
  if (trimmed.includes(",")) {
    return Number(trimmed.replace(/\./g, "").replace(",", "."));
  }
  const dotMatches = trimmed.match(/\./g);
  if (dotMatches?.length === 1) {
    const decimalPart = trimmed.split(".")[1];
    if (decimalPart.length <= 2) return Number(trimmed);
  }
  return Number(trimmed.replace(/\./g, ""));
}
