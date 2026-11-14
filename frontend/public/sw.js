/* HRH Pay service worker: fast start and an offline notice. It never stores data, sign-ins or downloads:
   /api/ requests always go to the network, so nothing private stays on a shared phone. */
const VERSION = 'hrh-pay-v3';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/brand/fhi360-logo.png', '/brand/usa-mark.png', '/brand/tanzania-nembo.png'];

const OFFLINE_PAGE = `<!doctype html><html lang="sw"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HRH Pay · Offline</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f3f2ec;color:#1d302f}
main{max-width:22rem;padding:2rem;text-align:center}img{width:64px;height:64px;border-radius:16px}h1{font-size:1.3rem;margin:1rem 0 .4rem}
p{margin:.3rem 0;color:#667673}button{margin-top:1.2rem;padding:.7rem 1.4rem;border:0;border-radius:10px;background:#176b5d;color:#fff;font:inherit;font-weight:600}
</style></head><body><main><img src="/icons/icon-192.png" alt=""><h1>Hakuna mtandao · You are offline</h1>
<p>Unganisha intaneti kisha jaribu tena.</p><p>Connect to the internet, then try again.</p>
<button onclick="location.reload()">Jaribu tena · Try again</button></main></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/openapi.json') return;

  // Pages: always the latest from the network; the saved copy only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(VERSION).then((cache) => cache.put('/', response.clone()));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))),
    );
    return;
  }

  // Built files are named by their content, so a saved copy is always correct. Icons and logos change rarely.
  if (url.pathname.startsWith('/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/') || url.pathname === '/favicon.svg') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});
