const V = 'kx-v5';
const PENDING = 'kx-pending';
const SHELL = ['/offline.html', '/icon-192.png', '/mark.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V && k !== PENDING).map((k) => caches.delete(k))))
  .then(() => self.registration.navigationPreload && self.registration.navigationPreload.enable()).catch(() => {})
  .then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/cache/')) return;
  if (u.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|woff2)$/.test(u.pathname)) {
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => { const cp = res.clone(); caches.open(V).then((c) => c.put(r, cp)).catch(() => {}); return res; }))
      .catch(() => assetDown()).then((res) => res || assetDown()));
    return;
  }
  if (r.mode === 'navigate') e.respondWith((async () => {
    try {
      const pre = await e.preloadResponse;
      const res = pre || await fetch(r);
      if (res) return res;
    } catch (_) {  }
    return pageDown();
  })());
});

const assetDown = () => new Response('', { status: 503, statusText: 'Service Unavailable', headers: { 'Cache-Control': 'no-store' } });
async function pageDown() {
  try { const hit = await caches.match('/offline.html'); if (hit) return hit; } catch (_) {  }
  return new Response(DOWN_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
const DOWN_HTML = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<meta name="color-scheme" content="light dark"><title>Korvex AI</title><style>html,body{height:100%;margin:0;font:15px/24px system-ui,-apple-system,sans-serif;'
  + 'background:#000;color:#ededed}@media (prefers-color-scheme:light){html,body{background:#fff;color:#1a1a1a}}body{display:grid;place-items:center;text-align:center;padding:24px}'
  + 'p{opacity:.7;margin:8px 0 0}</style></head><body><div><h1 style="font-size:22px;font-weight:500;margin:0">Нет связи с сервером</h1>'
  + '<p>Повторим автоматически · Can’t reach the server, retrying</p></div>'
  + '<script>setInterval(function(){fetch("/",{method:"HEAD",cache:"no-store"}).then(function(r){if(r.ok)location.reload()}).catch(function(){})},5000)</script></body></html>';

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Korvex AI';
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) self.navigator.setAppBadge(d.badge).catch(() => {});
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/' },
    icon: '/icon-192.png', badge: '/icon-192.png', lang: 'ru',
  }));
});

async function openChat(url) {
  const target = new URL(url || '/', self.location.origin).href;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const path = (u) => { const x = new URL(u); return x.pathname; };
  const same = wins.find((c) => path(c.url) === path(target));
  if (same) {
    try { await same.focus(); } catch (_) {  }
    same.postMessage({ type: 'kx-open', url: new URL(target).pathname + new URL(target).hash });
    return same;
  }
  const mine = wins.filter((c) => new URL(c.url).origin === self.location.origin);
  const any = mine.find((c) => c.focused) || mine.find((c) => c.visibilityState === 'visible') || mine[0];
  if (any) {
    if (typeof any.navigate === 'function') {
      try { const w = await any.navigate(target); if (w) { try { await w.focus(); } catch (_) {  } return w; } } catch (_) {  }
    }
    try { await any.focus(); } catch (_) {  }
    any.postMessage({ type: 'kx-open', url: new URL(target).pathname + new URL(target).hash });
    return any;
  }
  return self.clients.openWindow(target);
}
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;
  e.waitUntil(setPending(url).then(() => openChat(url)));
});

async function setPending(url) {
  try {
    const target = new URL(url || '/', self.location.origin);
    const c = await caches.open(PENDING);
    await c.put('/__kx_pending', new Response(JSON.stringify({ url: target.pathname + target.hash, t: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  } catch (_) {  }
}
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'kx-test-open') e.waitUntil(openChat(e.data.url));
});
