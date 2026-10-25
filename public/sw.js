/*
 * The service worker: what lets the home-screen app open like an app.
 *
 * Deliberately small, because a service worker that caches the wrong thing
 * keeps serving yesterday's build after a deploy:
 *
 *   - Pages (navigations) go to the network first, so a deploy is seen on the
 *     next open; the last page kept is used when there is no network, or when
 *     the network has not answered in two seconds, so the app still opens on
 *     a lift, a flight or a slow line.
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
      // Navigation preload (25 Oct): the browser asks for the page while this
      // worker is still waking, rather than once it is awake. Where a browser
      // has no such thing, pages are fetched as before.
      .then(() => self.registration.navigationPreload && self.registration.navigationPreload.enable().catch(() => {}))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // The network first, as before — but on a slow one, the page kept from
    // the last open after two seconds, rather than a blank screen for as
    // long as the network takes (6 Oct). The network's answer still replaces
    // the kept page for next time. A kept page asking for a file a later
    // release removed reloads itself (src/main.tsx, vite:preloadError). The
    // network's answer is the one the browser asked for while this woke up.
    const network = Promise.resolve(event.preloadResponse)
      .catch(() => undefined)
      .then((pre) => pre || fetch(req))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy));
        }
        return res;
      });
    const kept = new Promise((resolve) => setTimeout(resolve, 2000)).then(() => caches.match("/"));
    event.respondWith(
      Promise.race([network.catch(() => kept), kept.then((hit) => hit || network)])
        .then((res) => res || network)
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
