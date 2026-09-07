// Push bildirimlerini gostermek disinda HICBIR SEY yapmaz - fetch/cache
// yakalama YOK (bir randevu uygulamasinda bayat/onbellek veri gostermek
// gercek bir risk, bu yuzden bilerek eklenmedi).

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "Randevu AI", body: "" };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Randevu AI", {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
