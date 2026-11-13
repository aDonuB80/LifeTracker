// service-worker.js – Cache-first für die App-Hülle. Version bei jeder Änderung erhöhen!
const VERSION = 'lifetrack-v0.4.0';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/dates.js', './js/stats.js', './js/ui.js', './js/state.js',
  './js/food.js', './js/body.js', './js/sport.js', './js/today.js', './js/analysis.js',
  './js/charts.js', './js/backup.js', './js/settings.js', './js/social.js', './js/diary.js', './js/planner.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/star.svg',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den HTTP-Cache, damit wirklich die neue Version geladen wird
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Navigationen (auch mit ?query) immer auf die gecachte index.html
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (hit) return hit;
    try { return await fetch(req); }
    catch { return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
