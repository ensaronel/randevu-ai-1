import { mascotIconSvg } from "@/lib/mascotIcon";

/**
 * Öncesi/sonrası dönüşüm paylaşımları için ayrı bir şablon — standart ShareImage'dan
 * (tek renk kartı) bilerek farklı: gerçek fotoğraf içerdiği için daha "reklam kreatifi"
 * hissi hedefleniyor. Bilinçli tasarım kararları: fotoğraflar canvas'ın büyük
 * çoğunluğunu kaplar (metin bloğu için boş/gevşek alan bırakmamak için), işletme adı
 * ayrı bir üst şerit yerine fotoğrafın ÜZERİNE bindirilmiş rozet, kategori (owner'ın
 * notu, ör. "kaş ekimi") çapraz şeride yazılıp AI metniyle aynı konuya kilitleniyor,
 * ve gerçek bir CTA butonu var (küçük bir logo yerine). Instagram Story/Reels boyutu
 * (1080x1920), Satori (next/og ImageResponse) üzerinden render edilir — bkz.
 * shareImage.tsx'teki "explicit display:flex" notu, burada da geçerli.
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
  category?: string;
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
}

const ACCENT = "#a4453f"; // block1/rose — mevcut kampanya rengiyle aynı aile, "büyük an" hissi için sıcak/canlı
const INK = "#1a1f2e";

function StickerBadge({ text, rotate, style }: { text: string; rotate: number; style?: Record<string, string | number> }) {
  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        alignItems: "center",
        backgroundColor: "#ffffff",
        color: ACCENT,
        fontSize: 24,
        fontWeight: 800,
        letterSpacing: 2,
        padding: "9px 20px",
        borderRadius: 999,
        border: `3px solid ${ACCENT}`,
        transform: `rotate(${rotate}deg)`,
        boxShadow: "0 4px 14px rgba(0,0,0,0.16)",
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
  category,
}: TransformationShareImageProps) {
  // toUpperCase() Türkçe'yi bilmiyor ("kaş ekimi" -> "KAŞ EKIMI", noktasız I) —
  // toLocaleUpperCase("tr-TR") "İ" ile doğru çeviriyor.
  const ribbonText = category ? category.toLocaleUpperCase("tr-TR") : "DÖNÜŞÜM";

  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: INK,
        fontFamily: "Manrope",
      }}
    >
      {/* Fotoğraf bloğu: canvas'ın büyük çoğunluğu — bir reklam kreatifinde görsel
          hep baskın olmalı, metin bloğu ikincil. */}
      <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori render'ı, data URI ile besleniyor */}
        <img
          src={beforeDataUrl}
          width={1080}
          height={660}
          style={{ width: 1080, height: 660, objectFit: "cover", display: "flex" }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori render'ı, data URI ile besleniyor */}
        <img
          src={afterDataUrl}
          width={1080}
          height={660}
          style={{ width: 1080, height: 660, objectFit: "cover", display: "flex" }}
        />

        {/* İşletme adı — ayrı bir üst şerit yerine fotoğrafın üzerine bindirilmiş
            rozet (üstte boşluk bırakmamak için). */}
        <div
          style={{
            position: "absolute",
            top: 44,
            left: 44,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 22px",
            backgroundColor: "rgba(255,255,255,0.94)",
            borderRadius: 999,
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: ACCENT, display: "flex" }} />
          <span style={{ fontSize: 24, fontWeight: 700, color: INK }}>{businessName}</span>
        </div>

        <StickerBadge text="ÖNCE" rotate={-7} style={{ top: 200, left: 44 }} />
        <StickerBadge text="SONRA" rotate={6} style={{ bottom: 44, right: 44 }} />

        {/* Ortadaki çapraz şerit — owner not girdiyse (ör. "kaş ekimi") konu burada
            geçer, AI metni de aynı konuya kilitleniyor (bkz. transformationCaption.ts). */}
        <div
          style={{
            position: "absolute",
            top: 620,
            left: -40,
            width: 1160,
            height: 96,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: ACCENT,
            transform: "rotate(-3deg)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
          }}
        >
          <span style={{ fontSize: 42, fontWeight: 800, color: "#ffffff", letterSpacing: 3 }}>{ribbonText} ✨</span>
        </div>
      </div>

      {/* Metin bloğu — sıkı, boşluksuz: başlık, tek satır özet, gerçek bir CTA butonu.
          flexGrow:1 ile kalan yüksekliği DOLDURUYOR (krem zemin köşelere kadar
          uzuyor) ama içerik üstte sıkışık duruyor — dev bir boşluk yerine normal
          bir alt çerçeve payı hissi veriyor. */}
      <div
        style={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "52px 76px 0",
          textAlign: "center",
          backgroundColor: "#f5f3ec",
        }}
      >
        <div
          style={{
            fontFamily: "Lora",
            fontWeight: 700,
            fontSize: 52,
            lineHeight: 1.15,
            color: "#1e2e4f",
            display: "flex",
            maxWidth: 900,
          }}
        >
          {headline}
        </div>

        <div
          style={{
            marginTop: 16,
            fontSize: 27,
            lineHeight: 1.4,
            color: "#4b5266",
            maxWidth: 820,
            display: "flex",
          }}
        >
          {caption}
        </div>

        <div
          style={{
            marginTop: 34,
            display: "flex",
            alignItems: "center",
            gap: 10,
            backgroundColor: ACCENT,
            color: "#ffffff",
            fontSize: 28,
            fontWeight: 800,
            padding: "18px 40px",
            borderRadius: 999,
            boxShadow: "0 10px 24px rgba(164,69,63,0.35)",
          }}
        >
          Randevu Al
          <span style={{ display: "flex" }}>→</span>
        </div>

        <div style={{ marginTop: 30, display: "flex", alignItems: "center", gap: 10, paddingBottom: 40 }}>
          {mascotIconSvg(48, { celebrating: true })}
          <span style={{ fontSize: 20, fontWeight: 700, color: "#8b91a3" }}>Randevu AI</span>
        </div>
      </div>
    </div>
  );
}
