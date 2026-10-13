/* HRH Pay service worker: makes the app installable and lets the app shell open on a poor connection.
 *
 * Only the app's own files are cached. API responses (/api/...) are never cached or stored, so personal,
 * work-log and payment data never stays on a shared device, and every screen always shows live data.
 *
 *   page loads (navigation)  network first; the last good index.html when offline
 *   /static/* (hashed build) cache first; the file name changes on every release
 *   icons, manifest, fonts   stale while revalidate
 *   /api/*, other origins    not handled: straight to the network
 */
const VERSION = 'v1';
const SHELL = `hrh-shell-${VERSION}`;
const STATIC = `hrh-static-${VERSION}`;
const STATIC_LIMIT = 80; // old hashed bundles from earlier releases are trimmed beyond this
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hrh-') && k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((k) => cache.delete(k)));
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL);
      await cache.put('/', response.clone()); // one copy of the shell serves every client-side route
    }
    return response;
  } catch (err) {
    const cached = await caches.match('/');
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC);
    await cache.put(request, response.clone());
    trim(STATIC, STATIC_LIMIT);
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/openapi.json') return; // live data only, never stored

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/static/')) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.svg') {
    event.respondWith(staleWhileRevalidate(event));
  }
});
