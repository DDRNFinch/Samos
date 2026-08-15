const BUILD='0.15.0';
const CACHE=`samos-${BUILD}`;
const ASSETS=[
  './','./index.html',
  `./style.css?v=${BUILD}`,
  `./staff-style.css?v=${BUILD}`,
  `./samos-theme.css?v=${BUILD}`,
  `./evia-animations.js?v=${BUILD}`,
  `./qr-engine.js?v=${BUILD}`,
  `./app.js?v=${BUILD}`,
  `./naxos-controller.js?v=${BUILD}`,
  `./manifest.json?v=${BUILD}`,
  `./icon-192.png?v=${BUILD}`,
  `./icon-512.png?v=${BUILD}`,
  `./icon-maskable-192.png?v=${BUILD}`,
  `./icon-maskable-512.png?v=${BUILD}`,
  `./apple-touch-icon.png?v=${BUILD}`,
  `./favicon-32.png?v=${BUILD}`
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>/^samos-/i.test(k)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING'||event.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(r=>r||caches.match('./index.html'))));
});
