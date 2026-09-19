import { mascotIconSvg } from "@/lib/mascotIcon";

/**
 * Öncesi/sonrası dönüşüm paylaşımları için ayrı bir şablon — standart ShareImage'dan
 * (tek renk kartı) bilerek farklı: gerçek fotoğraf içerdiği için daha "reklam kreatifi"
 * hissi hedefleniyor (rozet/sticker'lar, kutlayan maskot, çapraz şerit). Instagram
 * Story/Reels boyutu (1080x1920), Satori (next/og ImageResponse) üzerinden render
 * edilir — bkz. shareImage.tsx'teki "explicit display:flex" notu, burada da geçerli.
 */

/** action_objects.share_image'da SAKLANAN şekil — fotoğrafın kendisi değil, Storage
 * yolu tutulur (bkz. /api/reklam/donusum ve /api/reklam/[id]/image). */
export interface TransformationSharePayload {
  kind: "transformation";
  businessName: string;
  beforePath: string;
  afterPath: string;
  headline: string;
  caption: string;
}

/** Render ANINDA komponente verilen prop'lar — Storage'dan indirilip data URI'ye
 * çevrilmiş hali (Satori uzak URL yerine data URI ile daha güvenilir çalışıyor). */
export interface TransformationShareImageProps {
  businessName: string;
  beforeDataUrl: string;
  afterDataUrl: string;
  headline: string;
  caption: string;
}

const ACCENT = "#a4453f"; // block1/rose — mevcut kampanya rengiyle aynı aile, "büyük an" hissi için sıcak/canlı
const ACCENT_SOFT = "#f3ddd4";

function StickerBadge({ text, rotate, style }: { text: string; rotate: number; style?: Record<string, string | number> }) {
  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        alignItems: "center",
        backgroundColor: "#ffffff",
        color: ACCENT,
        fontSize: 26,
        fontWeight: 800,
        letterSpacing: 2,
        padding: "10px 22px",
        borderRadius: 999,
        border: `3px solid ${ACCENT}`,
        transform: `rotate(${rotate}deg)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

export function TransformationShareImage({
  businessName,
  beforeDataUrl,
  afterDataUrl,
  headline,
  caption,
}: TransformationShareImageProps) {
  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: `linear-gradient(160deg, ${ACCENT_SOFT} 0%, #f5f3ec 45%)`,
        fontFamily: "Manrope",
      }}
    >
      <div
        style={{
          padding: "96px 80px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            alignSelf: "center",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 28px",
            backgroundColor: "#ffffff",
            border: "1px solid #d7dae5",
            borderRadius: 999,
          }}
        >
          <div style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: ACCENT, display: "flex" }} />
          <span style={{ fontSize: 30, fontWeight: 700, color: "#1a2032" }}>{businessName}</span>
        </div>
      </div>

      {/* Fotoğraf bloğu: tam genişlik bleed, çapraz şerit ile ikiye bölünmüş */}
      <div style={{ marginTop: 44, display: "flex", flexDirection: "column", position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori render'ı, data URI ile besleniyor */}
        <img
          src={beforeDataUrl}
          width={1080}
          height={540}
          style={{ width: 1080, height: 540, objectFit: "cover", display: "flex" }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori render'ı, data URI ile besleniyor */}
        <img
          src={afterDataUrl}
          width={1080}
          height={540}
          style={{ width: 1080, height: 540, objectFit: "cover", display: "flex" }}
        />

        <StickerBadge text="ÖNCE" rotate={-7} style={{ top: 36, left: 56 }} />
        <StickerBadge text="SONRA" rotate={6} style={{ bottom: 36, right: 56 }} />

        {/* Ortadaki çapraz "DÖNÜŞÜM" şeridi — iki fotoğrafın dikişini kapatıp reklam kreatifi hissi veriyor */}
        <div
          style={{
            position: "absolute",
            top: 500,
            left: -40,
            width: 1160,
            height: 84,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: ACCENT,
            transform: "rotate(-3deg)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
          }}
        >
          <span style={{ fontSize: 40, fontWeight: 800, color: "#ffffff", letterSpacing: 3 }}>DÖNÜŞÜM ✨</span>
        </div>
      </div>

      <div
        style={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "56px 80px 64px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "Lora",
            fontWeight: 700,
            fontSize: 66,
            lineHeight: 1.15,
            color: "#1e2e4f",
            display: "flex",
            maxWidth: 900,
          }}
        >
          {headline}
        </div>

        <div style={{ marginTop: 22, fontSize: 34, lineHeight: 1.5, color: "#1a2032", maxWidth: 860, display: "flex" }}>
          {caption}
        </div>

        <div style={{ flexGrow: 1, display: "flex" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {mascotIconSvg(120, { celebrating: true })}
          <span style={{ fontSize: 28, fontWeight: 700, color: "#1e2e4f" }}>Randevu AI</span>
        </div>
      </div>
    </div>
  );
}
