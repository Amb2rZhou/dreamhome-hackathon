// DreamHome Service Worker
// 网络优先 + 缓存回退：在线永远拿最新代码（避免坑10 的启发式缓存调试旧代码），
// 离线时回退缓存 → 断网也能演预置体验。
const CACHE = 'dh-shell-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/config.js', './js/fal.js', './js/toast.js',
  './js/library.js', './js/glbcache.js', './js/imgutil.js',
  './js/progress.js', './js/pipeline.js',
  './vendor/model-viewer-3.5.0.min.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k.startsWith('dh-shell')).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 第三方（fal 等）不拦
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(req, clone)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
