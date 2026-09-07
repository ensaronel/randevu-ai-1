"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type Status = "checking" | "unsupported" | "off" | "on" | "denied";

export default function PushNotificationSettings() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function check() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      setStatus(existing ? "on" : "off");
    }
    check().catch(() => setStatus("unsupported"));
  }, []);

  async function enable() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setStatus("on");
    } catch {
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking" || status === "unsupported") return null;

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-1">
      <span className="font-semibold text-sm">Bildirimler</span>
      {status === "denied" ? (
        <p className="text-[12.5px] text-ink-muted">
          Bildirim izni tarayıcı ayarlarından engellenmiş — açmak için tarayıcının site ayarlarından izin vermen gerekiyor.
        </p>
      ) : (
        <>
          <p className="text-[12.5px] text-ink-muted">
            WhatsApp üzerinden yeni bir randevu oluştuğunda veya iptal edildiğinde bu cihaza bildirim gönderilsin.
          </p>
          <button
            onClick={status === "on" ? disable : enable}
            disabled={busy}
            className={`mt-2 self-start rounded-full px-4 py-2 text-[13px] font-semibold disabled:opacity-50 ${
              status === "on" ? "bg-bad/10 text-bad" : "bg-accent text-white"
            }`}
          >
            {busy ? "..." : status === "on" ? "Bildirimleri Kapat" : "Bildirimleri Aç"}
          </button>
        </>
      )}
    </div>
  );
}
