/**
 * Öncesi/sonrası dönüşüm paylaşımları için şablon — bilinçli olarak gerçek bir
 * reklam kreatifi gibi tasarlandı: TAMAMEN fotoğraf dolu canvas, ayrı bir düz
 * renkli "kart" bloğu YOK (önceki versiyonda alttaki krem blok fotoğrafla
 * çarpışıp amatör durduğu için kaldırıldı) — bunun yerine alt kısımda koyu bir
 * gradyan "scrim" var, metin doğrudan fotoğrafın üzerinde okunuyor. İşletme adı
 * altta büyük değil — iki fotoğrafın dikişinde küçük bir marka rozeti (bkz.
 * BrandDivider) olarak duruyor. Her üretimde
 * 3 fotoğraf kompozisyonundan (layout) ve 3 vurgu renginden (accent) biri
 * SEÇİLİP DB'ye kaydediliyor (bkz. /api/reklam/donusum) — hem aynı görsel her
 * render'da AYNI kalsın diye hem de art arda üretilen içerikler birbirinin
 * birebir aynısı gibi durmasın diye. Instagram Story/Reels boyutu (1080x1920),
 * Satori (next/og ImageResponse) üzerinden render edilir — her çok-çocuklu
 * <div> açıkça display:flex almalı (Satori kısıtı).
 */

export type TransformationLayout = "stacked" | "split" | "hero";
export type TransformationAccent = "amber" | "sage" | "rose";

// "split" ve "hero" kullanıcı geri bildirimiyle geçici olarak devre dışı
// bırakıldı ("diğer şablonları kaldır, onlara sonra bakarız") — sadece "stacked"
// (önce üstte/sonra altta, yatay çizgiyle ayrılmış) + "sage" (yeşil) kaldı,
// kullanıcının beğendiği kombinasyon. PhotoLayer'daki diğer kodlar duruyor,
// ileride buraya geri eklenebilirler.
export const TRANSFORMATION_LAYOUTS: TransformationLayout[] = ["stacked"];
export const TRANSFORMATION_ACCENTS: TransformationAccent[] = ["sage"];

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

/** İki fotoğrafın dikişinde duran küçük "marka rozeti" — ince çizgi—isim—ince
 * çizgi (klasik wordmark/logo lockup hissi). Kullanıcı geri bildirimi: işletme
 * adı altta büyük durmasın, bunun yerine buraya, küçük ve şık bir fontla,
 * "marka dili" gibi otursun. */
function BrandDivider({ businessName, accentColor, top }: { businessName: string; accentColor: string; top: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 0,
        width: 1080,
        height: 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: "0 64px",
      }}
    >
      <div style={{ flexGrow: 1, height: 1, backgroundColor: "rgba(255,255,255,0.85)", display: "flex" }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          backgroundColor: "#ffffff",
          padding: "10px 22px",
          borderRadius: 999,
          boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: accentColor, display: "flex" }} />
        <span style={{ fontFamily: "Lora", fontWeight: 700, fontSize: 25, letterSpacing: 0.5, color: "#1a1f2e", display: "flex" }}>
          {businessName}
        </span>
      </div>
      <div style={{ flexGrow: 1, height: 1, backgroundColor: "rgba(255,255,255,0.85)", display: "flex" }} />
    </div>
  );
}

function PhotoLayer({
  layout,
  beforeDataUrl,
  afterDataUrl,
  accentColor,
  businessName,
}: {
  layout: TransformationLayout;
  beforeDataUrl: string;
  afterDataUrl: string;
  accentColor: string;
  businessName: string;
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

  // "stacked" (varsayılan): önce üstte, sonra altta, aralarında YATAY bir dikiş —
  // artık düz bir çizgi değil, işletme adının oturduğu küçük bir marka rozeti
  // (bkz. BrandDivider) — kullanıcı geri bildirimi: isim altta büyük durmasın,
  // buraya küçük/şık bir "marka dili" olarak otursun.
  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: 1080, height: 1920, display: "flex", flexDirection: "column" }}>
      <Photo src={beforeDataUrl} width={1080} height={958} />
      <Photo src={afterDataUrl} width={1080} height={958} />
      <StickerBadge text="ÖNCE" color={accentColor} rotate={-7} style={{ top: 56, left: 44 }} />
      <StickerBadge text="SONRA" color={accentColor} rotate={6} style={{ top: 1018, right: 44 }} />
      <BrandDivider businessName={businessName} accentColor={accentColor} top={936} />
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
      <PhotoLayer layout={layout} beforeDataUrl={beforeDataUrl} afterDataUrl={afterDataUrl} accentColor={color} businessName={businessName} />

      {/* Alt "scrim" — metin doğrudan fotoğrafın üzerinde, ayrı bir düz renkli blok
          yok. İşletme adı artık burada değil (BrandDivider'a taşındı, dikişin
          üzerinde), bu yüzden scrim daha da kısaltıldı/hafifletildi — kullanıcı
          "siyah geçiş azalsın" dedi. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: 1080,
          height: 560,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          background: "linear-gradient(180deg, rgba(10,10,14,0) 0%, rgba(10,10,14,0.58) 50%, rgba(8,8,11,0.92) 100%)",
          padding: "0 72px 32px",
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
      </div>
    </div>
  );
}
