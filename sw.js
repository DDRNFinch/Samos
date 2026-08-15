const BUILD='0.4.0';
const CACHE=`samos-${BUILD}`;
const CORE=[
  './',
  './index.html',
  `./styles.css?v=${BUILD}`,
  `./app.js?v=${BUILD}`,
  `./naxos-controller.js?v=${BUILD}`,
  `./manifest.webmanifest?v=${BUILD}`,
  `./icon-192.png?v=${BUILD}`,
  `./icon-512.png?v=${BUILD}`
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>/^samos-/i.test(key)&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      try{client.postMessage({type:'SAMOS_BUILD_ACTIVATED',build:BUILD});}catch(_){ }
      try{await client.navigate(client.url);}catch(_){ }
    }
  })());
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
