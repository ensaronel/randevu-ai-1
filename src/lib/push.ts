import webpush from "web-push";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails("mailto:destek@randevu-ai.app", vapidPublicKey, vapidPrivateKey);
}

/**
 * Bir işletmenin bildirim açık tüm cihazlarına push gönderir — VAPID anahtarları
 * tanımlı değilse (yerel geliştirme, henüz kurulmamış ortam) sessizce hiçbir şey
 * yapmaz, ana akışı (randevu oluşturma/iptal) ASLA kesmez.
 */
export async function sendPushToBusiness(
  businessId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  if (!vapidPublicKey || !vapidPrivateKey) return;

  const admin = createAdminSupabaseClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("business_id", businessId);

  if (!subs || subs.length === 0) return;

  await Promise.all(
    subs.map(async (sub) => {
      const send = () =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      try {
        await send();
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404/410: abonelik artık geçersiz (tarayıcı silmiş/izin kaldırılmış) — temizle.
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
          return;
        }
        // 2026-09-18'de kullanıcı "bazen bildirim gelmiyor, bazen gelir" diye bildirdi —
        // özellikle Apple'ın Web Push röle sunucusu (web.push.apple.com) geçici hatalara
        // (503/zaman aşımı) diğer sağlayıcılara göre daha yatkın; kalıcı geçersizlik
        // (404/410) olmayan HER hatada bir kez daha deniyoruz, sessizce pes etmek yerine.
        console.error("push gönderilemedi, tekrar deneniyor", sub.id, err);
        try {
          await send();
        } catch (retryErr) {
          console.error("push tekrar denemesi de başarısız oldu", sub.id, retryErr);
        }
      }
    })
  );
}
