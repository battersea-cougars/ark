// App-shell service worker: the app opens offline. Navigations try the network first and fall back to the cached
// shell; built assets (hashed names) are cached as they're used. API calls are never cached here.
// And notifications in a browser (Web Push, ADR 0108, #24): a push shows one; tapping it opens its page in the app.
// On the dev server it's registered as sw.js?dev (src/app/web-push.ts) and does notifications only: a cached shell
// would serve stale modules there.
const CACHE = "team-shell-v1";
const SHELL = !new URL(self.location.href).searchParams.has("dev");

self.addEventListener("install", (event) => {
  if (SHELL) event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !SHELL || k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (!SHELL) return;
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
  }
});

// A notification from the club (worker/push/webpush.ts): { title, body, path, tag }. The tag means the same notice
// sent again replaces itself rather than showing twice.
self.addEventListener("push", (event) => {
  let n;
  try {
    n = event.data?.json() ?? {};
  } catch {
    n = { body: event.data?.text() };
  }
  const path = typeof n.path === "string" && n.path.startsWith("/") ? n.path : "/";
  event.waitUntil(
    self.registration.showNotification(n.title || "Battersea Cougars", {
      body: n.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: n.tag || undefined,
      data: { path },
    }),
  );
});

// Tapped: the app's open window goes to its page (the app moves there itself, no reload), or a new one opens on it
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === location.origin);
      if (!open) return self.clients.openWindow(path);
      await open.focus();
      open.postMessage({ type: "notification-tap", path });
    }),
  );
});

// The push service renewed or dropped the subscription (Firefox does): subscribe again with the same key, and give
// the new one to the club for this sign-in (the session cookie goes with a same-origin request). The old one is
// forgotten when its push service says it's gone.
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  const renewed = event.newSubscription
    ? Promise.resolve(event.newSubscription)
    : key && self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  // Neither: the app subscribes again the next time it opens (web-push.ts startWebPush)
  if (!renewed) return;
  event.waitUntil(
    renewed
      .then((subscription) =>
        fetch("/api/auth/device", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform: "web", subscription: subscription.toJSON() }),
        }),
      )
      .catch(() => {}),
  );
});
