// App-shell service worker: the app opens offline, and at once on poor signal (#115). An opening asks the network for
// the newest shell, but waits at most NETWORK_WAIT_MS before opening the one kept from last time; whenever the
// network's arrives it's kept for the next opening, with the files it names, so a deploy reaches the phone on the
// next open at the latest (and the shell offers a reload as soon as a bootstrap says there's a newer build, ADR 0104).
// Built assets (hashed names) are cached as they're used. API calls are never cached here.
// And notifications in a browser (Web Push, ADR 0108, #24): a push shows one; tapping it opens its page in the app.
// On the dev server it's registered as sw.js?dev (src/app/web-push.ts) and does notifications only: a cached shell
// would serve stale modules there.
const CACHE = "team-shell-v1";
const SHELL = !new URL(self.location.href).searchParams.has("dev");
/** How long an opening waits on the network before the kept shell: a good signal answers well inside it. */
const NETWORK_WAIT_MS = 1500;

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
    const fetched = fetch(request);
    // Kept before anything reads the page: this runs first when it arrives
    event.waitUntil(fetched.then((res) => keepShell(res.clone())).catch(() => {}));
    event.respondWith(opening(fetched));
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

/** The network's page if it answers in time, else the kept shell; nothing kept yet (the first opening), the network's. */
async function opening(fetched) {
  const kept = await caches.match("/");
  if (!kept) return fetched;
  const late = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS, kept));
  return Promise.race([fetched.catch(() => kept), late]);
}

/**
 * The network's shell, kept for the next opening only with every built file it names (its scripts, styles and
 * fonts), so an opening with no signal never meets a page whose files were never fetched. Anything short of that
 * keeps the shell before.
 */
async function keepShell(res) {
  if (!res.ok || res.redirected || !res.headers.get("content-type")?.includes("text/html")) return;
  const html = await res.text();
  const cache = await caches.open(CACHE);
  const named = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
  const missing = [];
  for (const path of named) if (!(await cache.match(path))) missing.push(path);
  const files = await Promise.all(missing.map((path) => fetch(path).catch(() => null)));
  if (files.some((f) => !f?.ok)) return;
  await Promise.all(files.map((f, i) => cache.put(missing[i], f)));
  await cache.put("/", new Response(html, { status: res.status, headers: res.headers }));
}

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
