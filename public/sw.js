// Network-first app shell cache (never caches any /api/ response, so private data is not stored).
const C = "heat-v2";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(["/", "/style.css", "/live.js", "/manifest.webmanifest"]))); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
