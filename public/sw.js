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
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If any window is currently visible, hand off to in-app UI instead of
        // showing an OS notification (which would be redundant and jarring).
        const focusedClient = clientList.find(
          (c) => c.visibilityState === "visible"
        );

        if (focusedClient) {
          focusedClient.postMessage({ type: "PUSH_FOREGROUND", payload });
          // Still tell all windows to refresh the notification list.
          clientList.forEach((c) => c.postMessage({ type: "PUSH_RECEIVED" }));
          return;
        }

        // App is in the background or closed — use the standard OS notification.
        clientList.forEach((c) => c.postMessage({ type: "PUSH_RECEIVED" }));
        return self.registration.showNotification(title ?? "ShiftView", {
          body:  body ?? "",
          icon:  icon  ?? "/icon-192.png",
          badge: badge ?? "/icon-96.png",
          data:  data  ?? {},
          tag:   tag,
          renotify: !!tag,
        });
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const { type, fromUserId, fromName, url } = data;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Prefer an already-open window so we don't open a duplicate tab.
        const existing = clientList.find(
          (c) => c.url.startsWith(self.location.origin) && "focus" in c
        );
        if (existing) {
          existing.focus();
          // Tell the live app to open the relevant chess board.
          if (type === "chess_move" && fromUserId) {
            existing.postMessage({ type: "OPEN_CHESS", fromUserId, fromName: fromName ?? "" });
          }
          return;
        }
        // No open window — launch the app with a deep-link URL so it can open
        // the correct conversation once it boots.
        const target =
          type === "chess_move" && fromUserId
            ? `/?openChess=${encodeURIComponent(fromUserId)}&name=${encodeURIComponent(fromName ?? "")}`
            : (url ?? "/");
        return clients.openWindow(target);
      })
  );
});
