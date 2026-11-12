// The site's files, kept on the device.
//
// The network is asked first, so that a new version is picked up as soon as
// there is a signal; if it has not answered in a few seconds, or cannot, the
// copy kept here is used instead. When this is first installed it fetches
// every file on the list the site publishes (precache.json), so that pages
// never opened still work with no signal.
//
// Only this site's own files are handled. Lookups elsewhere, such as the
// wind, go straight to the network and simply fail without one.

const KEPT = 'sportshud-files-1';
const PATIENCE = 3000; // milliseconds to wait for the network when a copy is in hand

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(KEPT);
      try {
        const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
        await Promise.all(list.map((path) => cache.add(new Request(path, { cache: 'reload' })).catch(() => {})));
      } catch {
        // No list, as when working at the desk: files are kept as they are used instead.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== KEPT) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(answer(event.request, url));
});

async function answer(request, url) {
  const cache = await caches.open(KEPT);
  // Nothing on this site depends on what follows "?" in an address, so one copy serves them all.
  const key = url.origin + url.pathname;
  const kept = await cache.match(key);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  if (!kept) return network;
  const patience = new Promise((resolve) => setTimeout(() => resolve(null), PATIENCE));
  const fresh = await Promise.race([network.catch(() => null), patience]);
  // A server in trouble is no better than no server.
  return fresh && fresh.status < 500 ? fresh : kept;
}
