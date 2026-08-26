// Hand-rolled service worker (not build-generated) — chosen over @serwist/next after confirming
// it doesn't support Turbopack (Next 16's default bundler; @serwist/turbopack is explicitly
// experimental). A plain static file needs no build-time integration at all: Next serves it as-is
// from public/, and ServiceWorkerRegister.tsx registers it client-side.
//
// Scope is deliberately narrow: app-shell/static-asset caching for installability, nothing else.
// /api/v1/* is never intercepted here — track streaming, waveform, cover, and every other
// server-backed request always goes straight to the network. Once offline copy (mobile plan
// Phase C) lands, cached audio/cover/waveform bytes get their own purpose-built OPFS store; this
// worker staying out of that business avoids two caches disagreeing about what's stored for a
// given track.

const CACHE_VERSION = "lf-shell-v1";
const APP_SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL_URLS).catch(() => undefined)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:woff2?|ttf|otf)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  if (isStaticAsset(url)) {
    // Stale-while-revalidate: instant from cache, refreshed in the background.
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    // Network-first for pages, falling back to the cached app shell when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match("/"))),
    );
  }
});
