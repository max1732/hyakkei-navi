// 画面の部品は先に保存、地図タイルは保存済みならそれを使う（圏外でも表示）
const SHELL = 'shell-v2';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'data/tekari.json', 'manifest.webmanifest', 'icon-192.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'cyberjapandata.gsi.go.jp'){
    // 保存した地図 → なければネット
    e.respondWith(caches.match(e.request.url).then(r => r || fetch(e.request)));
    return;
  }
  if (u.origin === location.origin || u.hostname === 'cdnjs.cloudflare.com'){
    // ネット優先、圏外なら保存分
    e.respondWith(fetch(u.origin === location.origin ? e.request.url : e.request, u.origin === location.origin ? { cache:'no-cache' } : undefined).then(r => { if (r.ok){ const c = r.clone(); caches.open(SHELL).then(ca => ca.put(e.request.url, c)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch:true }).then(r => r || caches.match('index.html'))));
  }
});
