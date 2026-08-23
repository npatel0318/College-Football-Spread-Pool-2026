// CFB Pool — service worker
// Strategy:
//   - HTML (index.html): network-first so new deploys land immediately;
//     falls back to cache if offline.
//   - JS / CSS / images (Vite adds content hashes): cache-first since the
//     filename changes on every build, so cached assets are always valid.
//   - Firebase, ESPN, Odds API: network-only — live data must never be cached.
//
// Bump CACHE_NAME whenever you want to force all clients onto a fresh cache
// (e.g. after a major deploy). The activate handler purges old caches.

const CACHE_NAME = 'cfb-pool-v1';

// App-shell files to pre-cache on install
const PRECACHE = ['./', './index.html'];

// Hostnames that must never be cached
const NEVER_CACHE = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'espn.com',
  'site.api.espn.com',
  'the-odds-api.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting(); // activate immediately, don't wait for old SW to die
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

// ── activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim(); // take control of all open tabs immediately
});

// ── fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache live data sources
  if (NEVER_CACHE.some((host) => url.hostname.includes(host))) return;

  // Only intercept same-origin requests
  if (url.origin !== self.location.origin) return;

  const isDocument =
    request.destination === 'document' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html');

  if (isDocument) {
    // Network-first for HTML: picks up new deploys; falls back to cache
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
  } else {
    // Cache-first for hashed assets (JS / CSS / images)
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        });
      })
    );
  }
});
