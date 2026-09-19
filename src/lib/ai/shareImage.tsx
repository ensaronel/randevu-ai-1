import { mascotIconSvg } from "@/lib/mascotIcon";

/**
 * Reklam/paylaşım görselleri için tek şablon — üç lane de (Başarı Anları,
 * Düzenli İçerik, Kampanya) bunu paylaşır, sadece renk + metin değişir.
 * Instagram Story/Reels boyutu (1080x1920). Satori (next/og ImageResponse)
 * üzerinden render edildiği için stil string değil OBJE olmalı, ve birden
 * fazla çocuğu olan her <div> açıkça display:flex almalı — aksi halde Satori
 * "Expected <div> to have explicit display" hatası fırlatıyor.
 */

export type ShareImageAccent = "amber" | "sage" | "rose";

const ACCENTS: Record<ShareImageAccent, { main: string; soft: string }> = {
  // Ayın Rekoru / Sadakat Anı — uygulamanın gerçek accent2 (amber) tokeni.
  amber: { main: "#d9932f", soft: "#f1dfb9" },
  // Düzenli marka içeriği (günlük ipucu/hizmet/personel vitrini) — block2
  // (sage/oklch(42% 0.09 165)) tokeninin sRGB yaklaşık karşılığı.
  sage: { main: "#3f6e5c", soft: "#dcece3" },
  // Kampanya/indirim duyurusu — block1 (rose/oklch(45% 0.13 25)) tokeninin
  // sRGB yaklaşık karşılığı.
  rose: { main: "#a4453f", soft: "#f3ddd4" },
};

export interface ShareImagePayload {
  accent: ShareImageAccent;
  businessName: string;
  eyebrow: string;
  big: string;
  bigSub?: string;
  subtitle: string;
  contextLine: string;
  waving?: boolean;
}

function bigFontSize(text: string): number {
  if (text.length <= 4) return 230;
  if (text.length <= 10) return 120;
  if (text.length <= 20) return 88;
  return 66;
}

export function ShareImage({ accent, businessName, eyebrow, big, bigSub, subtitle, contextLine, waving }: ShareImagePayload) {
  const colors = ACCENTS[accent];

  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: "#f5f3ec",
        fontFamily: "Manrope",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -140,
          right: -140,
          width: 340,
          height: 340,
          borderRadius: 999,
          border: `26px solid ${colors.soft}`,
          opacity: 0.6,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 260,
          left: 96,
          width: 20,
          height: 20,
          backgroundColor: colors.main,
          opacity: 0.55,
          borderRadius: 4,
          transform: "rotate(45deg)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 320,
          left: 140,
          width: 11,
          height: 11,
          backgroundColor: colors.main,
          opacity: 0.4,
          borderRadius: 3,
          transform: "rotate(45deg)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 220,
          left: 160,
          width: 8,
          height: 8,
          backgroundColor: colors.main,
          opacity: 0.7,
          borderRadius: 2,
          transform: "rotate(45deg)",
          display: "flex",
        }}
      />

      <div
        style={{
          position: "relative",
          height: "100%",
          width: "100%",
          boxSizing: "border-box",
          padding: "110px 90px 70px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            alignSelf: "flex-start",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 28px",
            backgroundColor: "#ffffff",
            border: "1px solid #d7dae5",
            borderRadius: 999,
          }}
        >
          <div style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: colors.main, display: "flex" }} />
          <span style={{ fontSize: 30, fontWeight: 700, color: "#1a2032" }}>{businessName}</span>
        </div>

        <div style={{ flexGrow: 1, display: "flex" }} />

        {mascotIconSvg(280, { waving })}

        <div
          style={{
            marginTop: 34,
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: 5,
            textTransform: "uppercase",
            color: colors.main,
          }}
        >
          {eyebrow}
        </div>

        <div
          style={{
            marginTop: 10,
            fontFamily: "Lora",
            fontWeight: 700,
            fontSize: bigFontSize(big),
            lineHeight: 1.15,
            color: "#1e2e4f",
            textAlign: "center",
            display: "flex",
            maxWidth: 900,
          }}
        >
          {big}
        </div>

        {bigSub && (
          <div style={{ marginTop: 4, fontFamily: "Lora", fontWeight: 700, fontSize: 64, color: "#1e2e4f", display: "flex" }}>
            {bigSub}
          </div>
        )}

        <div
          style={{
            marginTop: 30,
            fontSize: 40,
            lineHeight: 1.4,
            color: "#1a2032",
            textAlign: "center",
            maxWidth: 840,
            display: "flex",
          }}
        >
          {subtitle}
        </div>

        <div style={{ flexGrow: 1, display: "flex" }} />

        <div style={{ fontSize: 28, color: "#6b7086", display: "flex" }}>{contextLine}</div>

        <div style={{ marginTop: 36, display: "flex", alignItems: "center", gap: 12 }}>
          {mascotIconSvg(34)}
          <span style={{ fontSize: 26, fontWeight: 700, color: "#1e2e4f" }}>Randevu AI</span>
        </div>
      </div>
    </div>
  );
}
