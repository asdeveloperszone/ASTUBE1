// ASTUBE Service Worker — v15.0
// Path: asdeveloperszone.github.io/ASTUBE1

const BASE_PATH  = '/ASTUBE1';
const CACHE_NAME = 'astube-v16.5';

// Files to pre-cache on install
const PRECACHE = [
  BASE_PATH + '/',
  BASE_PATH + '/index.html',
  BASE_PATH + '/search.html',
  BASE_PATH + '/player.html',
  BASE_PATH + '/login.html',
  BASE_PATH + '/profile.html',
  BASE_PATH + '/add-video.html',
  BASE_PATH + '/channel.html',
  BASE_PATH + '/analytics.html',
  BASE_PATH + '/offline.html',
  BASE_PATH + '/style.css',
  BASE_PATH + '/app.js',
  BASE_PATH + '/config.js',
  BASE_PATH + '/manifest.json',
  BASE_PATH + '/icon.png',
  BASE_PATH + '/icon-192.png',
  BASE_PATH + '/icon-512.png'
];

// ── Install ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET, chrome-extension, Firebase, YouTube API, backend calls
  if (req.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname.includes('firebaseio.com'))    return;
  if (url.hostname.includes('googleapis.com'))    return;
  if (url.hostname.includes('gstatic.com'))       return;
  if (url.hostname.includes('ytimg.com'))         return;
  if (url.hostname.includes('googlevideo.com'))   return;
  if (url.hostname.includes('youtube.com'))       return;
  if (url.hostname.includes('ngrok'))             return;
  if (url.hostname.includes('localhost'))         return;

  // Navigation requests — network first, fallback to cache, then offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
          return res;
        })
        .catch(() =>
          caches.match(req)
            .then(cached => cached || caches.match(BASE_PATH + '/offline.html'))
        )
    );
    return;
  }

  // Static assets — cache first, then network
  if (url.pathname.match(/\.(html|css|js|json|png|jpg|svg|ico|webp|woff2?)$/)) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => caches.match(BASE_PATH + '/offline.html'));
      })
    );
    return;
  }

  // CDN resources (Font Awesome, Firebase SDK etc) — cache first
  if (url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone));
        return res;
      }))
    );
    return;
  }

  // Default: network only
  event.respondWith(fetch(req).catch(() => caches.match(BASE_PATH + '/offline.html')));
});

// ── Push notifications (future use) ──────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
