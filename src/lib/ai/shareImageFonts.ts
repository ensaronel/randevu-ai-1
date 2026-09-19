// ImageResponse (Satori) tarayıcı değil — Google Fonts'un normalde <link> ile
// tarayıcıya verdiği @font-face'i çözemiyor, gerçek font dosyasını (ttf/otf)
// isteğe cevap üretilirken bizzat indirip `fonts` parametresiyle vermemiz
// gerekiyor. Modül seviyesinde bellek içi cache — aynı sunucu instance'ı sıcak
// kaldığı sürece (Vercel'de garanti değil ama olduğunda) tekrar indirmiyoruz.
const fontDataCache = new Map<string, ArrayBuffer>();

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const cacheKey = `${family}-${weight}`;
  const cached = fontDataCache.get(cacheKey);
  if (cached) return cached;

  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  // Modern bir User-Agent göndermeden istemek Google'ın woff2 yerine ttf/otf
  // döndürmesini sağlıyor — Satori bunu doğrudan kullanabiliyor.
  const css = await (await fetch(cssUrl)).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(?:truetype|opentype|woff2)'\)/);
  if (!match) throw new Error(`share image font not found: ${family} ${weight}`);

  const fontResponse = await fetch(match[1]);
  const fontData = await fontResponse.arrayBuffer();
  fontDataCache.set(cacheKey, fontData);
  return fontData;
}

export async function loadShareImageFonts() {
  const [loraBold, manropeRegular, manropeBold, manropeExtraBold] = await Promise.all([
    loadGoogleFont("Lora", 700),
    loadGoogleFont("Manrope", 400),
    loadGoogleFont("Manrope", 700),
    loadGoogleFont("Manrope", 800),
  ]);

  return [
    { name: "Lora", data: loraBold, weight: 700 as const, style: "normal" as const },
    { name: "Manrope", data: manropeRegular, weight: 400 as const, style: "normal" as const },
    { name: "Manrope", data: manropeBold, weight: 700 as const, style: "normal" as const },
    { name: "Manrope", data: manropeExtraBold, weight: 800 as const, style: "normal" as const },
  ];
}
