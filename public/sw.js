// ShiftView Service Worker — handles Web Push notifications.
// "Chess" below refers to the in-app chess easter egg played over direct
// messages; tapping a chess-move notification deep-links into that game.

// Activate immediately without waiting for existing tabs to close.
// This ensures notification click handlers always run the latest code.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(clients.claim())
);

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
        // Tell all windows to refresh the notification bell.
        clientList.forEach((c) => c.postMessage({ type: "PUSH_RECEIVED" }));

        // Always show the OS notification. Suppression of the duplicate while
        // the app is open now happens server-side — the server withholds the
        // push from any device that currently has the app in the foreground
        // (per-device presence; see lib/notify.ts), so anything that actually
        // reaches the service worker should be shown. Skipping showNotification
        // here would violate iOS's userVisibleOnly contract, which gets the
        // push subscription revoked after a few offences (then no pushes at
        // all, even when the app is closed).
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

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    // Prefer focusing an already-open window over launching a new one.
    const existing = clientList.find(
      (c) => c.url.startsWith(self.location.origin) && "focus" in c
    );

    if (existing) {
      try {
        const focused = await existing.focus();
        const target = focused ?? existing;
        if (type === "chess_move" && fromUserId) {
          target.postMessage({ type: "OPEN_CHESS", fromUserId, fromName: fromName ?? "" });
        }
        return;
      } catch {
        // focus() failed — fall through to open a fresh window below
      }
    }

    // No usable open window — store the chess intent, then open the app at
    // the root URL. When the page mounts it sends CLIENT_READY and we reply
    // with OPEN_CHESS (see the message handler above).
    if (type === "chess_move" && fromUserId) {
      _pendingChess = { fromUserId, fromName: fromName ?? "" };
    }

    try {
      await clients.openWindow(url ?? "/");
    } catch {
      // openWindow can fail in some browser environments; the user can
      // open the app manually and the CLIENT_READY handshake will still fire.
    }
  })());
});
