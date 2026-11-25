/* Service worker: permite usar la app sin conexión (stale-while-revalidate). */
const CACHE = 'pd-v2';
const CORE = [
  './',
  './index.html',
  './css/styles.css',
  './js/special.js',
  './js/distributions.js',
  './js/format.js',
  './js/chart.js',
  './js/procedure.js',
  './js/app.js',
  './vendor/katex/katex.min.js',
  './vendor/katex/katex.min.css',
  './icons/icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
