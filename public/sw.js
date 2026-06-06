// ShiftView Service Worker — handles Web Push notifications

// Chess action pending delivery to a cold-started page.
// Set in notificationclick, cleared once the page sends CLIENT_READY.
let _pendingChess = null;

// The page sends CLIENT_READY once its SW message listener is mounted.
// If there's a pending chess action (cold-start tap), we reply immediately.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLIENT_READY" && _pendingChess && event.source) {
    const pending = _pendingChess;
    _pendingChess = null;
    event.source.postMessage({ type: "OPEN_CHESS", ...pending });
  }
});

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

        // App is in the background or closed.
        // Refresh the in-app bell count for any open (but hidden) windows.
        clientList.forEach((c) => c.postMessage({ type: "PUSH_RECEIVED" }));

        // Respect the user's OS notification preference (_osEnabled is set by
        // the server and included in the push payload).
        if (data?._osEnabled === false) return;

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
        // Prefer an already-open window so we don't need to launch a new one.
        const existing = clientList.find(
          (c) => c.url.startsWith(self.location.origin) && "focus" in c
        );
        if (existing) {
          existing.focus();
          if (type === "chess_move" && fromUserId) {
            existing.postMessage({ type: "OPEN_CHESS", fromUserId, fromName: fromName ?? "" });
          }
          return;
        }

        // No open window — store the chess intent and open the app at "/".
        // Once the page mounts and sends CLIENT_READY, we deliver OPEN_CHESS.
        // Using "/" avoids any URL-based page-load errors from the browser or
        // Next.js when non-root paths are opened cold via the SW.
        if (type === "chess_move" && fromUserId) {
          _pendingChess = { fromUserId, fromName: fromName ?? "" };
        }
        return clients.openWindow(url ?? "/");
      })
  );
});
