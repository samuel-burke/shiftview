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

// Timestamp of the most recent "app is on screen" heartbeat from any client.
// The page pings APP_FOREGROUND while it's visible (and APP_BACKGROUND the
// moment it's hidden), so we can suppress the OS notification whenever the
// user is actively using the app — the in-app banner covers it instead.
// We use a freshness window rather than reading client.visibilityState at push
// time because that value is unreliable on some platforms (notably iOS PWAs)
// and unavailable when the SW was just respawned to handle the push.
let _foregroundAt = 0;
// Heartbeat cadence is ~15s on the client; allow a margin for a missed beat.
const FOREGROUND_TTL_MS = 45000;

// The page sends CLIENT_READY once its SW message listener is mounted.
// If there's a pending chess action (cold-start tap), we reply immediately.
self.addEventListener("message", (event) => {
  const type = event.data?.type;

  if (type === "APP_FOREGROUND") {
    _foregroundAt = Date.now();
    return;
  }
  if (type === "APP_BACKGROUND") {
    _foregroundAt = 0;
    return;
  }

  if (type === "CLIENT_READY" && _pendingChess && event.source) {
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

        // Skip the OS notification while the user is actively using the app —
        // the page shows its own in-app banner via Supabase Realtime on the
        // notifications table. Two signals, either of which means "in use":
        //   1. a client reports visibilityState "visible" right now, and
        //   2. a recent APP_FOREGROUND heartbeat (covers platforms where the
        //      visibilityState read is unreliable or the SW was just respawned).
        const anyVisible = clientList.some(
          (c) => c.visibilityState === "visible"
        );
        const recentlyForeground =
          _foregroundAt > 0 && Date.now() - _foregroundAt < FOREGROUND_TTL_MS;
        if (anyVisible || recentlyForeground) return;

        // App is in the background or closed; the server only pushes types
        // the user has enabled, so always show.
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
