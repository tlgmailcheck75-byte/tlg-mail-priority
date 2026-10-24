// TLG Mail Priority — service worker (offline shell + fast loads for the installed app).
// Bump VERSION on every website release so every device picks up the new files.
const VERSION = 'v1';
const CACHE = `tlg-mail-${VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './ui.js',
  './core.js',
  './engine.js',
  './gmail.js',
  './db.js',
  './config.js',
  './defaults.gen.js',
  './demo.js',
  './mime.js',
  './statesync.js',
  './vendor/preact-htm-3.1.1.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tlg-mail-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin GET only: serve from cache first, refresh the copy in the background.
// Google login/APIs and anything cross-origin go straight to the network.
// .wav is left to the network — Safari streams audio with Range requests that cached responses break.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.wav')) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = await c.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res && res.ok) c.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
