import { mascotIconSvg } from "@/lib/mascotIcon";

/**
 * Reklam/paylaşım görselleri için paylaşılan şablon — dönüşüm (transformationShareImage.tsx)
 * DIŞINDAKİ 6 içerik türü (boş randevu, sosyal kanıt, vitrin, ipucu, başarı anı, kampanya)
 * bunu kullanır. Kompozisyon: üstte KOYU/DOYGUN accent renginde bir "afiş" bandı (büyük
 * soluk ikon deseni + işletme rozeti), altta beyaz/krem bir "kart" bandı, ikisinin
 * dikişinde yüzen büyük bir rozet (ikon ya da maskot) — klasik reklam/kampanya şablonu
 * kompozisyonu (bkz. kullanıcı geri bildirimi 2026-09-21: "arka plan sade, daha görsel
 * odaklı olsun, daha reklamcı dursun" — önceki düz krem+küçük ikon hali çok fazla boş
 * alan bırakıyordu). Her `kind` kendi ikonuna ve iç kompozisyonuna sahip. Maskot SADECE
 * "achievement" kutlamalarında. Footer'da ürünümüzün ("Randevu AI") kendi markası YOK.
 * Instagram Story/Reels boyutu (1080x1920). Satori (next/og ImageResponse) üzerinden
 * render edildiği için stil string değil OBJE olmalı, ve birden fazla çocuğu olan her
 * <div> açıkça display:flex almalı.
 */

export type ShareImageKind = "slots" | "social_proof" | "spotlight" | "tip" | "achievement" | "campaign";
export type ShareImageAccent = "amber" | "sage" | "rose";

const ACCENTS: Record<ShareImageAccent, { main: string; soft: string; ink: string }> = {
  amber: { main: "#d9932f", soft: "#f1dfb9", ink: "#6e4f15" },
  sage: { main: "#3f6e5c", soft: "#dcece3", ink: "#1f3a30" },
  rose: { main: "#a4453f", soft: "#f3ddd4", ink: "#5c211d" },
};

export interface ShareImagePayload {
  kind: ShareImageKind;
  accent: ShareImageAccent;
  businessName: string;
  eyebrow: string;
  big: string;
  bigSub?: string;
  subtitle: string;
  contextLine?: string;
  /** slots: saat listesi gibi küçük pill'ler halinde gösterilecek ek veri. */
  chips?: string[];
  waving?: boolean;
  celebrating?: boolean;
}

type Colors = (typeof ACCENTS)[ShareImageAccent];

function bigFontSize(text: string): number {
  if (text.length <= 4) return 240;
  if (text.length <= 10) return 128;
  if (text.length <= 20) return 92;
  return 68;
}

function quoteFontSize(text: string): number {
  if (text.length <= 40) return 64;
  if (text.length <= 70) return 55;
  if (text.length <= 100) return 46;
  return 40;
}

// --- İkonlar — 24x24 viewBox, çizgi/dolgu tabanlı. Her `kind`e kendi hero ikonunu verir,
// hem küçük (rozet içinde) hem büyük (afiş bandında soluk desen) kullanılıyor.

function ClockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 7v5.3l3.6 2.1" />
    </svg>
  );
}

function QuoteIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M4 8c0-2.4 1.8-4.2 4.4-4.6l.4 1.6c-1.6.4-2.4 1.3-2.4 2.4h2.4V13H4V8z" />
      <path d="M13.6 8c0-2.4 1.8-4.2 4.4-4.6l.4 1.6c-1.6.4-2.4 1.3-2.4 2.4H18.4V13h-4.8V8z" />
    </svg>
  );
}

function SparkleIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
    </svg>
  );
}

function LightbulbIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 2.8a5.6 5.6 0 00-3.2 10.2c.6.5 1 1.2 1 2h4.4c0-.8.4-1.5 1-2A5.6 5.6 0 0012 2.8z" />
    </svg>
  );
}

function TrophyIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M7 5H4a3 3 0 003 4M17 5h3a3 3 0 01-3 4" />
      <path d="M12 14v3M9 21h6M9.5 21c0-2 .8-3 2.5-4 1.7 1 2.5 2 2.5 4" />
    </svg>
  );
}

function MegaphoneIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10v4a1 1 0 001 1h2l6 4.5V4.5L6 9H4a1 1 0 00-1 1z" />
      <path d="M15 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />
    </svg>
  );
}

const KIND_ICON: Record<ShareImageKind, typeof ClockIcon> = {
  slots: ClockIcon,
  social_proof: QuoteIcon,
  spotlight: SparkleIcon,
  tip: LightbulbIcon,
  achievement: TrophyIcon,
  campaign: MegaphoneIcon,
};

function Chips({ items, colors }: { items: string[]; colors: Colors }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", maxWidth: 880 }}>
      {items.map((item) => (
        <div
          key={item}
          style={{
            display: "flex",
            backgroundColor: colors.soft,
            color: colors.ink,
            fontSize: 34,
            fontWeight: 800,
            padding: "12px 28px",
            borderRadius: 999,
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function EyebrowTag({ text, colors }: { text: string; colors: Colors }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: 30,
        fontWeight: 800,
        letterSpacing: 4,
        textTransform: "uppercase",
        color: colors.main,
      }}
    >
      {text}
    </div>
  );
}

/** Afiş bandı ile kart bandının dikişinde yüzen büyük rozet — beyaz zemin, güçlü gölge,
 * klasik "kampanya şablonu" hissi. Achievement'ta maskotun kendi rengi kullanılır. */
function FloatingBadge({ kind, colors, waving, celebrating }: { kind: ShareImageKind; colors: Colors; waving?: boolean; celebrating?: boolean }) {
  if (kind === "achievement") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 220,
          height: 220,
          borderRadius: 999,
          backgroundColor: "#ffffff",
          boxShadow: "0 20px 44px rgba(0,0,0,0.22)",
        }}
      >
        {mascotIconSvg(168, { waving, celebrating })}
      </div>
    );
  }

  const Icon = KIND_ICON[kind];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 200,
        height: 200,
        borderRadius: 999,
        backgroundColor: "#ffffff",
        boxShadow: "0 20px 44px rgba(0,0,0,0.22)",
      }}
    >
      <Icon size={92} color={colors.main} />
    </div>
  );
}

/** Kart bandının içeriği — her `kind` kendi düzenini kurar, böylece altı kart birbirinin
 * renk değişmiş hali gibi değil, gerçekten farklı kompozisyonlar gibi durur. */
function CardContent({ payload, colors }: { payload: ShareImagePayload; colors: Colors }) {
  const { kind, eyebrow, big, bigSub, subtitle, chips } = payload;

  if (kind === "social_proof") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 900 }}>
        <div
          style={{
            fontFamily: "Lora",
            fontWeight: 700,
            fontSize: quoteFontSize(big),
            lineHeight: 1.3,
            color: "#1e2e4f",
            textAlign: "center",
            display: "flex",
          }}
        >
          {big}
        </div>
        <div style={{ marginTop: 34, width: 72, height: 4, backgroundColor: colors.main, display: "flex" }} />
        <div style={{ marginTop: 20, fontSize: 34, fontWeight: 800, color: colors.ink, display: "flex" }}>{subtitle}</div>
      </div>
    );
  }

  if (kind === "slots") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 900 }}>
        <EyebrowTag text={eyebrow} colors={colors} />
        <div style={{ marginTop: 10, fontFamily: "Lora", fontWeight: 700, fontSize: bigFontSize(big), color: "#1e2e4f", display: "flex" }}>
          {big}
        </div>
        {bigSub && <div style={{ marginTop: 4, fontSize: 46, fontWeight: 800, color: colors.ink, display: "flex" }}>{bigSub}</div>}
        {chips && chips.length > 0 && (
          <div style={{ marginTop: 36, display: "flex" }}>
            <Chips items={chips} colors={colors} />
          </div>
        )}
        <div style={{ marginTop: 36, fontSize: 38, lineHeight: 1.4, color: "#1a2032", textAlign: "center", maxWidth: 860, display: "flex" }}>
          {subtitle}
        </div>
      </div>
    );
  }

  if (kind === "achievement") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 900 }}>
        <EyebrowTag text={eyebrow} colors={colors} />
        <div style={{ marginTop: 10, fontFamily: "Lora", fontWeight: 700, fontSize: bigFontSize(big), color: "#1e2e4f", display: "flex" }}>
          {big}
        </div>
        {bigSub && <div style={{ marginTop: 4, fontSize: 50, fontWeight: 800, color: colors.ink, display: "flex" }}>{bigSub}</div>}
        <div style={{ marginTop: 34, fontSize: 38, lineHeight: 1.4, color: "#1a2032", textAlign: "center", maxWidth: 860, display: "flex" }}>
          {subtitle}
        </div>
      </div>
    );
  }

  if (kind === "campaign") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 900 }}>
        <EyebrowTag text={eyebrow} colors={colors} />
        <div
          style={{
            marginTop: 10,
            fontFamily: "Lora",
            fontWeight: 700,
            fontSize: bigFontSize(big),
            color: "#1e2e4f",
            textAlign: "center",
            display: "flex",
          }}
        >
          {big}
        </div>
        <div
          style={{
            marginTop: 36,
            display: "flex",
            backgroundColor: colors.soft,
            borderRadius: 24,
            padding: "30px 36px",
            fontSize: 36,
            fontWeight: 600,
            lineHeight: 1.4,
            color: colors.ink,
            textAlign: "center",
            maxWidth: 880,
          }}
        >
          {subtitle}
        </div>
      </div>
    );
  }

  // "spotlight" ve "tip" — aynı sade editoryal kompozisyonu paylaşır, sadece etiket değişir.
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 900 }}>
      <EyebrowTag text={eyebrow} colors={colors} />
      <div style={{ marginTop: 10, fontFamily: "Lora", fontWeight: 700, fontSize: bigFontSize(big), color: "#1e2e4f", textAlign: "center", display: "flex" }}>
        {big}
      </div>
      {bigSub && (
        <div
          style={{
            marginTop: 20,
            display: "flex",
            backgroundColor: colors.soft,
            color: colors.ink,
            fontSize: 32,
            fontWeight: 800,
            padding: "10px 26px",
            borderRadius: 999,
          }}
        >
          {bigSub}
        </div>
      )}
      <div style={{ marginTop: 32, fontSize: 38, lineHeight: 1.4, color: "#1a2032", textAlign: "center", maxWidth: 860, display: "flex" }}>
        {subtitle}
      </div>
    </div>
  );
}

const POSTER_HEIGHT = 620;

export function ShareImage({ accent, businessName, contextLine, ...payload }: ShareImagePayload) {
  const colors = ACCENTS[accent];
  const Icon = KIND_ICON[payload.kind];

  return (
    <div style={{ width: 1080, height: 1920, display: "flex", flexDirection: "column", position: "relative", backgroundColor: colors.main, fontFamily: "Manrope" }}>
      {/* Üst afiş bandı — doygun accent rengi, dev soluk ikon deseni. */}
      <div style={{ position: "absolute", top: 0, left: 0, width: 1080, height: POSTER_HEIGHT, backgroundColor: colors.main, display: "flex" }} />
      {payload.kind !== "achievement" && (
        <div style={{ position: "absolute", top: -70, right: -80, opacity: 0.16, display: "flex" }}>
          <Icon size={460} color="#ffffff" />
        </div>
      )}
      <div style={{ position: "absolute", top: 74, left: 64, display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", backgroundColor: "#ffffff", borderRadius: 999 }}>
        <div style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: colors.main, display: "flex" }} />
        <span style={{ fontSize: 30, fontWeight: 700, color: "#1a2032" }}>{businessName}</span>
      </div>

      {/* Alt kart bandı — beyaz/krem, yukarı yuvarlatılmış köşe. İçerik dikeyde
          ORTALANIR (justifyContent:center) — sabit bir alt boşluk bırakmak yerine,
          metin kısa da uzun da olsa kart her zaman dolu/dengeli görünür. */}
      <div
        style={{
          position: "absolute",
          top: POSTER_HEIGHT,
          left: 0,
          width: 1080,
          height: 1920 - POSTER_HEIGHT,
          backgroundColor: "#faf8f2",
          borderRadius: "64px 64px 0 0",
          boxSizing: "border-box",
          padding: "180px 80px 80px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CardContent payload={{ accent, businessName, contextLine, ...payload }} colors={colors} />

        {contextLine && <div style={{ marginTop: 40, fontSize: 28, color: "#8a8578", display: "flex" }}>{contextLine}</div>}
      </div>

      {/* Rozet — afiş/kart dikişinde SABİT, kart içeriğinin ortalanmasından bağımsız. */}
      <div style={{ position: "absolute", top: POSTER_HEIGHT - 112, left: 0, width: 1080, display: "flex", justifyContent: "center" }}>
        <FloatingBadge kind={payload.kind} colors={colors} waving={payload.waving} celebrating={payload.celebrating} />
      </div>
    </div>
  );
}
