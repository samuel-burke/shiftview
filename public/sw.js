// ShiftView Service Worker — handles Web Push notifications

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "ShiftView", body: event.data.text() };
  }

  const { title, body, icon, badge, data, tag } = payload;

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title ?? "ShiftView", {
        body:  body ?? "",
        icon:  icon  ?? "/icon-192.png",
        badge: badge ?? "/icon-96.png",
        data:  data  ?? {},
        tag:   tag,
        renotify: !!tag,
      }),
      // Tell any open app windows to refresh their notification list immediately
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          clientList.forEach((client) =>
            client.postMessage({ type: "PUSH_RECEIVED" })
          );
        }),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});
