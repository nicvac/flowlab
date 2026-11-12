/* FlowLab — service worker: funziona anche senza rete.
   La pagina si chiede prima alla rete (così c'è sempre l'ultima versione) e, se manca, alla copia salvata. */
const CACHE = 'flowlab-d716f53bacf3';
const CORE = ['./FlowLab.html', './manifest.webmanifest', './icona-192.png', './icona-512.png'];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('flowlab-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // caratteri della pagina: dalla copia salvata, aggiornata in background
  if (FONTS.test(req.url)) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location).pathname)) return;
  // file di FlowLab: prima la rete, poi la copia salvata
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./FlowLab.html') : Response.error()))));
});
