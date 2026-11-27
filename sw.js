/* Orbit service worker: lets the app open offline.
   It only caches the app's own files. Your data lives in the app's local storage, never here or on a server.

   Strategy
   - The app page and its manifest: network first. When online you always get the latest version
     (revalidated with GitHub so its 10-minute HTTP cache can't serve a stale copy). If the network
     fails (offline) or is very slow, the saved copy is used, so it still works without signal.
   - Icons: cache first. They rarely change.
   Bump VERSION when releasing so old caches are cleared. */
const VERSION = 'orbit-v21';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
const NETWORK_TIMEOUT_MS = 3000;   // slow network: open the saved copy after 3s (the fresh one still lands for next time)

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function networkFirst(req, key) {
  return caches.open(VERSION).then(cache => new Promise(resolve => {
    let settled = false;
    const useCache = async () => {
      if (settled) return;
      const cached = await cache.match(key, { ignoreSearch: true });
      if (cached && !settled) { settled = true; resolve(cached); }
    };
    const timer = setTimeout(useCache, NETWORK_TIMEOUT_MS);
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(async res => {
      clearTimeout(timer);
      // only a real copy of the app is saved; a Wi-Fi login page or a server error falls back to the saved app
      const good = res.ok && !res.redirected && res.type === 'basic';
      if (good) cache.put(key, res.clone());
      if (!good) await useCache();
      if (!settled) { settled = true; resolve(res); }
    }).catch(async () => {
      clearTimeout(timer);
      await useCache();
      if (!settled) { settled = true; resolve(Response.error()); }
    });
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;   // update checks always go straight to the network
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html') || url.pathname.endsWith('.webmanifest')) {
    e.respondWith(networkFirst(req, req.mode === 'navigate' ? './index.html' : req));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
