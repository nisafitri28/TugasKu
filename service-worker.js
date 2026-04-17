const CACHE_NAME = 'tugasku-pwa-v5';
const BASE_URL = self.registration.scope;

const pages = [
  '',
  'index.html',
  'tambah.html',
  'tugas.html',
  'kalender.html',
  'mata-kuliah.html',
  'statistik.html',
  'pengaturan.html',
  'offline.html',
  'assets/app.css',
  'assets/app.js',
  'assets/style.css',
  'manifest.json',
  'icons/icon-192x192-A.png',
  'icons/icon-512x512-B.png',
  'icons/screenshot1.png',
  'icons/screenshot2.png'
].map(path => `${BASE_URL}${path}`);

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(pages)).catch(err => console.error('Cache gagal dimuat:', err)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.protocol.startsWith('chrome-extension')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(`${BASE_URL}offline.html`)));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then(response => response || fetch(request).then(networkResponse => {
      const clone = networkResponse.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      return networkResponse;
    }).catch(() => caches.match(`${BASE_URL}offline.html`))));
  } else {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
  }
});
