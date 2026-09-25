"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Sayfa açıkken sunucu verisini arka planda tazeler. WhatsApp'tan gelen randevu (bekleme listesi
 * kabulü, bot randevusu) sayfa yenilenene kadar görünmüyordu — kullanıcı "beni takvime geç yazdı"
 * diye algılıyordu (2026-09-25). Sekme görünürken her `everySeconds` saniyede bir ve sekmeye
 * geri dönüldüğünde router.refresh() çağrılır; istemci durumu (form, açık kart) korunur.
 */
export default function AutoRefresh({ everySeconds }: { everySeconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, everySeconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, everySeconds]);

  return null;
}
