/**
 * Öncesi/sonrası dönüşüm paylaşımları için şablon — bilinçli olarak gerçek bir
 * reklam kreatifi gibi tasarlandı: TAMAMEN fotoğraf dolu canvas, ayrı bir düz
 * renkli "kart" bloğu YOK (önceki versiyonda alttaki krem blok fotoğrafla
 * çarpışıp amatör durduğu için kaldırıldı) — bunun yerine alt kısımda koyu bir
 * gradyan "scrim" var, metin doğrudan fotoğrafın üzerinde okunuyor. İşletme adı
 * bu scrim'in EN ALTINDA, büyük ve belirgin duruyor (imza gibi). Her üretimde
 * 3 fotoğraf kompozisyonundan (layout) ve 3 vurgu renginden (accent) biri
 * SEÇİLİP DB'ye kaydediliyor (bkz. /api/reklam/donusum) — hem aynı görsel her
 * render'da AYNI kalsın diye hem de art arda üretilen içerikler birbirinin
 * birebir aynısı gibi durmasın diye. Instagram Story/Reels boyutu (1080x1920),
 * Satori (next/og ImageResponse) üzerinden render edilir — her çok-çocuklu
 * <div> açıkça display:flex almalı (Satori kısıtı).
 */

export type TransformationLayout = "stacked" | "split" | "hero";
export type TransformationAccent = "amber" | "sage" | "rose";

export const TRANSFORMATION_LAYOUTS: TransformationLayout[] = ["stacked", "split", "hero"];
export const TRANSFORMATION_ACCENTS: TransformationAccent[] = ["amber", "sage", "rose"];

const ACCENT_COLORS: Record<TransformationAccent, string> = {
  amber: "#d9932f",
  sage: "#3f6e5c",
  rose: "#a4453f",
};

/** action_objects.share_image'da SAKLANAN şekil — fotoğrafın kendisi değil, Storage
 * yolu tutulur (bkz. /api/reklam/donusum ve /api/reklam/[id]/image). */
export interface TransformationSharePayload {
  kind: "transformation";
  businessName: string;
  beforePath: string;
  afterPath: string;
  headline: string;
  caption: string;
  category?: string;
  layout: TransformationLayout;
  accent: TransformationAccent;
}

/** Render ANINDA komponente verilen prop'lar — Storage'dan indirilip data URI'ye
 * çevrilmiş hali (Satori uzak URL yerine data URI ile daha güvenilir çalışıyor). */
export interface TransformationShareImageProps {
  businessName: string;
  beforeDataUrl: string;
  afterDataUrl: string;
  headline: string;
  caption: string;
  category?: string;
  layout: TransformationLayout;
  accent: TransformationAccent;
}

function StickerBadge({
  text,
  color,
  rotate,
  style,
}: {
  text: string;
  color: string;
  rotate: number;
  style: Record<string, string | number>;
}) {
  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        alignItems: "center",
        backgroundColor: "#ffffff",
        color,
        fontSize: 24,
        fontWeight: 800,
        letterSpacing: 2,
        padding: "9px 20px",
        borderRadius: 999,
        border: `3px solid ${color}`,
        transform: `rotate(${rotate}deg)`,
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        ...style,
      }}
    >
      {text}
    </div>
  );
}

function Photo({ src, width, height, style }: { src: string; width: number; height: number; style?: Record<string, string | number> }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Satori render'ı, data URI ile besleniyor
    <img src={src} width={width} height={height} style={{ width, height, objectFit: "cover", display: "flex", ...style }} />
  );
}

function PhotoLayer({
  layout,
  beforeDataUrl,
  afterDataUrl,
  accentColor,
}: {
  layout: TransformationLayout;
  beforeDataUrl: string;
  afterDataUrl: string;
  accentColor: string;
}) {
  if (layout === "split") {
    return (
      <div style={{ position: "absolute", top: 0, left: 0, width: 1080, height: 1920, display: "flex" }}>
        <Photo src={beforeDataUrl} width={538} height={1920} />
        <div style={{ width: 4, height: 1920, backgroundColor: "#ffffff", display: "flex" }} />
        <Photo src={afterDataUrl} width={538} height={1920} />
        <StickerBadge text="ÖNCE" color={accentColor} rotate={-7} style={{ top: 56, left: 40 }} />
        <StickerBadge text="SONRA" color={accentColor} rotate={6} style={{ top: 56, right: 40 }} />
      </div>
    );
  }

  if (layout === "hero") {
    return (
      <div style={{ position: "absolute", top: 0, left: 0, width: 1080, height: 1920, display: "flex" }}>
        <Photo src={afterDataUrl} width={1080} height={1920} />
        <div
          style={{
            position: "absolute",
            top: 120,
            left: 56,
            width: 320,
            height: 420,
            borderRadius: 22,
            overflow: "hidden",
            border: "6px solid #ffffff",
            boxShadow: "0 16px 36px rgba(0,0,0,0.45)",
            display: "flex",
          }}
        >
          <Photo src={beforeDataUrl} width={320} height={420} />
        </div>
        <StickerBadge text="ÖNCE" color={accentColor} rotate={-6} style={{ top: 76, left: 40 }} />
      </div>
    );
  }

  // "stacked" (varsayılan): önce üstte, sonra altta
  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: 1080, height: 1920, display: "flex", flexDirection: "column" }}>
      <Photo src={beforeDataUrl} width={1080} height={960} />
      <Photo src={afterDataUrl} width={1080} height={960} />
      <StickerBadge text="ÖNCE" color={accentColor} rotate={-7} style={{ top: 56, left: 44 }} />
    </div>
  );
}

export function TransformationShareImage({
  businessName,
  beforeDataUrl,
  afterDataUrl,
  headline,
  caption,
  category,
  layout,
  accent,
}: TransformationShareImageProps) {
  const color = ACCENT_COLORS[accent];
  // toUpperCase() Türkçe'yi bilmiyor ("kaş ekimi" -> "KAŞ EKIMI", noktasız I) —
  // toLocaleUpperCase("tr-TR") "İ" ile doğru çeviriyor.
  const tag = category ? category.toLocaleUpperCase("tr-TR") : "DÖNÜŞÜM";

  return (
    <div style={{ width: 1080, height: 1920, display: "flex", position: "relative", backgroundColor: "#12141a" }}>
      <PhotoLayer layout={layout} beforeDataUrl={beforeDataUrl} afterDataUrl={afterDataUrl} accentColor={color} />

      {/* Alt "scrim" — metin doğrudan fotoğrafın üzerinde, ayrı bir düz renkli blok
          yok (önceki versiyondaki "arka plan sırıtıyor" sorununu bu çözüyor). */}
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: 1080,
          height: 920,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          background: "linear-gradient(180deg, rgba(10,10,14,0) 0%, rgba(10,10,14,0.6) 40%, rgba(8,8,11,0.97) 100%)",
          padding: "0 72px 60px",
          fontFamily: "Manrope",
        }}
      >
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            backgroundColor: color,
            color: "#ffffff",
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: 2,
            padding: "8px 20px",
            borderRadius: 999,
          }}
        >
          {tag} ✨
        </div>

        <div
          style={{
            marginTop: 18,
            fontFamily: "Lora",
            fontWeight: 700,
            fontSize: 54,
            lineHeight: 1.14,
            color: "#ffffff",
            display: "flex",
            maxWidth: 920,
          }}
        >
          {headline}
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 27,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.82)",
            maxWidth: 880,
            display: "flex",
          }}
        >
          {caption}
        </div>

        <div
          style={{
            marginTop: 28,
            display: "flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 10,
            backgroundColor: color,
            color: "#ffffff",
            fontSize: 26,
            fontWeight: 800,
            padding: "16px 36px",
            borderRadius: 999,
            boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
          }}
        >
          Randevu Al
          <span style={{ display: "flex" }}>→</span>
        </div>

        {/* İşletme adı — imza gibi en altta, büyük ve belirgin. */}
        <div style={{ marginTop: 34, width: 64, height: 4, backgroundColor: color, borderRadius: 2, display: "flex" }} />
        <div style={{ marginTop: 16, fontSize: 46, fontWeight: 800, color: "#ffffff", display: "flex", maxWidth: 920 }}>
          {businessName}
        </div>
      </div>
    </div>
  );
}
