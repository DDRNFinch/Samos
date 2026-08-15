const BUILD='0.7.0';
const CACHE=`samos-${BUILD}`;
const CORE=[
  './',
  './index.html',
  `./styles.css?v=${BUILD}`,
  `./app.js?v=${BUILD}`,
  `./naxos-controller.js?v=${BUILD}`,
  `./manifest.webmanifest?v=${BUILD}`,
  `./icon-192.png?v=${BUILD}`,
  `./icon-512.png?v=${BUILD}`,
  `./icon-maskable-192.png?v=${BUILD}`,
  `./icon-maskable-512.png?v=${BUILD}`,
  `./apple-touch-icon.png?v=${BUILD}`,
  `./favicon-32.png?v=${BUILD}`
];

async function cacheFreshShell(){
  const cache=await caches.open(CACHE);
  for(const url of CORE){
    try{
      const response=await fetch(url,{cache:'no-store'});
      if(response&&response.ok)await cache.put(url,response.clone());
    }catch(_){ }
  }
}

self.addEventListener('install',event=>{
  event.waitUntil(cacheFreshShell().then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>/^samos-/i.test(key)&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      try{client.postMessage({type:'SAMOS_BUILD_ACTIVATED',build:BUILD});}catch(_){ }
    }
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

async function networkFirst(request){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response&&response.ok)cache.put(request,response.clone());
    return response;
  }catch(_){
    return (await cache.match(request)) || (request.mode==='navigate' ? await cache.match('./index.html') : Response.error());
  }
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(networkFirst(event.request));
});
