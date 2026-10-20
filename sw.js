const CACHE = 'gakusai-settlement-v4-1-complete';
const ASSETS = ['./','./index.html','./styles.css','./cloud.css','./app.mjs','./engine.mjs','./cloud-model.mjs','./auth-helpers.mjs','./activity-units.mjs','./v4.mjs','./v4-finance.mjs','./v4.css','./v4.1.css','./config.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install', e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate', e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('gakusai-settlement-') && k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  // 設定ファイルとアプリ本体は更新優先。クラウドの会計データは一切キャッシュしない。
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));}return r;}).catch(()=>caches.match(e.request)));
});
