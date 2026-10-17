// Service worker so the app (and its 17 MB dictionary) work offline.
// Bump VERSION if you change the dictionary or the asset list.
const VERSION = "v2";
const CACHE = `hanasou-${VERSION}`;

const DICT = [
  "base", "cc", "check", "tid", "tid_map", "tid_pos",
  "unk", "unk_char", "unk_compat", "unk_invoke", "unk_map", "unk_pos",
].map((f) => `vendor/kuromoji/dict/${f}.dat.gz`);

const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "match.js",
  "drills.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/kuromoji/kuromoji.js",
  ...DICT,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The dictionary never changes: serve it from the cache.
// Everything else: try the network first (so edits show up), fall back to the cache offline.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.url.includes("/vendor/kuromoji/dict/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
