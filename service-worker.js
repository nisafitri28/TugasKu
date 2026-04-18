const CACHE_NAME = 'tugasku-pwa-v8';
const BASE_URL = self.registration.scope;

const APP_SHELL = [
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

async function warmCache() {
  const cache = await caches.open(CACHE_NAME);
  return cache.addAll(APP_SHELL);
}

async function refreshAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL.map(async asset => {
    try {
      const response = await fetch(asset, { cache: 'no-cache' });
      if (response && response.ok) await cache.put(asset, response.clone());
    } catch (error) {
      // Abaikan asset yang sedang tidak bisa diakses saat offline
    }
  }));
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(warmCache().catch(err => console.error('Cache gagal dimuat:', err)));
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

self.addEventListener('sync', event => {
  if (event.tag === 'refresh-app-shell') {
    event.waitUntil(refreshAppShell());
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'refresh-app-shell-periodic') {
    event.waitUntil(refreshAppShell());
  }
});

self.addEventListener('push', event => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || 'Pengingat TugasKu';
  const options = {
    body: payload.body || 'Ada pembaruan tugas atau pengingat deadline baru.',
    icon: payload.icon || 'icons/icon-192x192-A.png',
    badge: payload.badge || 'icons/icon-192x192-A.png',
    tag: payload.tag || 'tugasku-push',
    data: {
      url: payload.url || 'tugas.html'
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || 'tugas.html', BASE_URL).href;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if ('focus' in client) {
        client.navigate(targetUrl);
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  })());
});
