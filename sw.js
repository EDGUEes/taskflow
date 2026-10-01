const CACHE = 'taskflow-v3n';
const STATIC = ['/', '/index.html', '/css/style.css', '/js/app.js', '/js/seed-data.js', '/manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // NETWORK-FIRST for our own HTML/CSS/JS so code updates apply immediately.
  // Fall back to cache only when offline.
  const isAppFile = url.origin === location.origin && /\.(html|js|css)$|\/$/.test(url.pathname);
  if (isAppFile){
    e.respondWith(
      fetch(e.request).then(r => {
        if (r.ok){ const cl = r.clone(); caches.open(CACHE).then(c=>c.put(e.request, cl)); }
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Cache-first for everything else (icons, libraries)
  e.respondWith(caches.match(e.request).then(cached => {
    const net = fetch(e.request).then(r => { if (r.ok){ const cl=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cl)); } return r; }).catch(()=>cached);
    return cached || net;
  }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.matchAll({type:'window'}).then(w=>{ if(w.length){w[0].focus();return;} clients.openWindow('/'); })); });
