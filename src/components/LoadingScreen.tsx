import Mascot from "@/components/Mascot";

/**
 * Sayfa gecisi / ilk acilis yukleme sahnesi - Next.js bir route'un verisini
 * beklerken (loading.tsx boundary'si) veya PWA ilk acilista ekran bosalip
 * kararan bir "donma" hissi vermesin diye, marka maskotuyla sicak bir bekleme
 * ani gosterir.
 */
export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg">
      <div className="animate-mascot-bounce">
        <Mascot size={72} waving />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-loading-dot" style={{ animationDelay: "0ms" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-loading-dot" style={{ animationDelay: "160ms" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-loading-dot" style={{ animationDelay: "320ms" }} />
      </div>
    </div>
  );
}
