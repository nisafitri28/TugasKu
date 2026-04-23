const CACHE_NAME = 'tugasku-pwa-v15';
const BASE_URL = self.registration.scope;
const WIDGET_TAG = 'tugasku-summary';
const WIDGET_TEMPLATE_URL = new URL('widgets/tugasku-widget-template.json', BASE_URL).href;
const WIDGET_DATA_URL = new URL('widgets/tugasku-widget-data.json', BASE_URL).href;
const WIDGET_RUNTIME_DATA_URL = new URL('widgets/tugasku-widget-data.runtime.json', BASE_URL).href;
const SHARED_TARGET_DATA_URL = new URL('shared-target-data.json', BASE_URL).href;

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
  'manifest.json',
  'shared-target-data.json',
  'assets/app.css',
  'assets/app.js',
  'assets/style.css',
  'icons/icon-192x192-A.png',
  'icons/icon-512x512-B.png',
  'icons/screenshot1.png',
  'icons/screenshot2.png',
  'icons/screenshot3.png',
  'icons/screenshot4.png',
  'icons/screenshot5.png',
  'icons/screenshot6.png',
  'icons/screenshot7.png',
  'icons/screenshot8.png',
  'widgets/tugasku-widget-template.json',
  'widgets/tugasku-widget-data.json',
  'widgets/widget-screenshot.png'
].map(path => `${BASE_URL}${path}`);

async function warmCache() {
  const cache = await caches.open(CACHE_NAME);
  return cache.addAll(APP_SHELL);
}

async function getTextAsset(url, { network = true } = {}) {
  if (network) {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (response && response.ok) return await response.text();
    } catch (error) {
      // Fallback ke cache bila sedang offline atau browser memblokir request.
    }
  }
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);
  return cached ? cached.text() : '';
}

async function getWidgetDataText() {
  const runtimeData = await getTextAsset(WIDGET_RUNTIME_DATA_URL, { network: false });
  if (runtimeData) return runtimeData;
  return getTextAsset(WIDGET_DATA_URL);
}

async function updateSummaryWidget() {
  if (!self.widgets || typeof self.widgets.getByTag !== 'function' || typeof self.widgets.updateByTag !== 'function') {
    return;
  }
  const widget = await self.widgets.getByTag(WIDGET_TAG);
  if (!widget) return;
  const templateUrl = widget.definition?.msAcTemplate ? new URL(widget.definition.msAcTemplate, BASE_URL).href : WIDGET_TEMPLATE_URL;
  const template = await getTextAsset(templateUrl);
  const data = await getWidgetDataText();
  if (!template || !data) return;
  await self.widgets.updateByTag(widget.definition?.tag || WIDGET_TAG, { template, data });
}

async function storeWidgetSummary(summary) {
  const safeSummary = {
    title: String(summary?.title || 'TugasKu'),
    subtitle: String(summary?.subtitle || 'Ringkasan cepat tugas kuliah dan deadline terdekat.'),
    total: String(summary?.total || '0'),
    active: String(summary?.active || '0'),
    dueSoon: String(summary?.dueSoon || '0'),
    todayLabel: String(summary?.todayLabel || 'Belum ada deadline dekat.'),
    progress: String(summary?.progress || '0%')
  };
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    WIDGET_RUNTIME_DATA_URL,
    new Response(JSON.stringify(safeSummary, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    })
  );
}


async function storeSharedTargetPayload(payload) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    SHARED_TARGET_DATA_URL,
    new Response(JSON.stringify(payload, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    })
  );
}

async function clearSharedTargetPayload() {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(SHARED_TARGET_DATA_URL);
}

async function handleShareTarget(request) {
  const formData = await request.formData();
  const payload = {
    title: String(formData.get('title') || ''),
    text: String(formData.get('text') || ''),
    url: String(formData.get('url') || '')
  };
  await storeSharedTargetPayload(payload);
  return Response.redirect(`${BASE_URL}tambah.html?share-target=1`, 303);
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
  await updateSummaryWidget();
}

async function openOrFocusWindow(path) {
  const targetUrl = new URL(path, BASE_URL).href;
  const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    if ('focus' in client) {
      try {
        await client.navigate(targetUrl);
      } catch (error) {
        // Abaikan navigasi yang gagal, lalu tetap fokus ke client yang ada.
      }
      return client.focus();
    }
  }
  if (clients.openWindow) return clients.openWindow(targetUrl);
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
    await updateSummaryWidget();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.protocol.startsWith('chrome-extension')) return;

  if (url.origin === self.location.origin && request.method === 'POST' && url.href === `${BASE_URL}tambah.html`) {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (url.origin === self.location.origin && request.method === 'GET' && url.href === SHARED_TARGET_DATA_URL) {
    event.respondWith((async () => {
      const cached = await caches.match(SHARED_TARGET_DATA_URL);
      return cached || new Response('{}', {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    })());
    return;
  }

  if (request.method !== 'GET') return;

  if (url.origin === self.location.origin && url.pathname.endsWith('/manifest.json')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-cache' });
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (error) {
        return (await caches.match(request)) || fetch(request);
      }
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (error) {
        const cachedPage = await caches.match(request);
        if (cachedPage) return cachedPage;

        const normalizedUrl = new URL(request.url);
        const pathname = normalizedUrl.pathname.endsWith('/')
          ? `${normalizedUrl.pathname}index.html`
          : normalizedUrl.pathname;
        const relativePath = pathname.startsWith(self.location.pathname.replace(/service-worker\.js$/, ''))
          ? pathname.slice(self.location.pathname.replace(/service-worker\.js$/, '').length)
          : pathname.replace(/^\//, '');

        const pageFromBase = await caches.match(new URL(relativePath || 'index.html', BASE_URL).href);
        if (pageFromBase) return pageFromBase;

        const homePage = await caches.match(`${BASE_URL}index.html`);
        if (homePage) return homePage;

        return caches.match(`${BASE_URL}offline.html`);
      }
    })());
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
  const targetPath = event.notification.data?.url || 'tugas.html';
  event.waitUntil(openOrFocusWindow(targetPath));
});

self.addEventListener('widgetinstall', event => {
  if (typeof event.waitUntil === 'function') {
    event.waitUntil(updateSummaryWidget());
  }
});

self.addEventListener('widgetclick', event => {
  const actionMap = {
    'open-dashboard': 'index.html',
    'open-tasks': 'tugas.html',
    'new-task': 'tambah.html',
    'open-calendar': 'kalender.html'
  };
  const target = actionMap[event.action];
  if (!target) return;
  if (typeof event.waitUntil === 'function') {
    event.waitUntil(openOrFocusWindow(target));
  }
});

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'CLEAR_SHARED_TARGET') {
    const work = clearSharedTargetPayload();
    if (typeof event.waitUntil === 'function') event.waitUntil(work);
    return;
  }
  if (message.type !== 'UPDATE_WIDGET_SUMMARY') return;
  const work = (async () => {
    await storeWidgetSummary(message.summary || {});
    await updateSummaryWidget();
  })();
  if (typeof event.waitUntil === 'function') event.waitUntil(work);
});
