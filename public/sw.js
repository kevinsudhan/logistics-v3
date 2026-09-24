/*
 * The service worker: what lets the home-screen app open like an app.
 *
 * Deliberately small, because a service worker that caches the wrong thing
 * keeps serving yesterday's build after a deploy:
 *
 *   - Pages (navigations) go to the network first, so a deploy is seen on the
 *     next open; the last page kept is used only when there is no network, so
 *     the app still opens on a lift or a flight.
 *   - /assets/ files are named by their contents (the build hashes them), so a
 *     cached one can never be stale; they are served from the cache and kept.
 *   - Everything else — the database, Microsoft, maps — is not touched.
 *
 * Bump VERSION to drop every cache on the next open.
 */
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(SHELL).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
