// sw.js — Disciplan Service Worker (FEA-23)
const CACHE_FONTS='dc-fonts-v1';

const PRECACHE_URLS=[
  '/','/index.html','/manifest.json',
  '/js/config.js','/js/constants.js','/js/helpers.js','/js/state.js',
  '/js/ai-categorize.js','/js/import-engine.js','/js/payslip-parser.js','/js/linking.js',
  '/js/income-stmt.js','/js/portfolio.js','/js/ledger.js','/js/entry.js',
  '/js/import-review.js','/js/balance-sheet.js','/js/tags.js','/js/cashback.js',
  '/js/cross-year.js','/js/export.js','/js/ai-portal.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

// Cache key auto-derived from URL list — rotates whenever modules are added/removed,
// no manual SW_VERSION bump required.
function urlHash(arr){let h=5381;const s=arr.join(',');for(let i=0;i<s.length;i++)h=((h<<5)+h)^s.charCodeAt(i);return(h>>>0).toString(36)}
const CACHE_STATIC='dc-static-'+urlHash(PRECACHE_URLS);

const GFONTS_CSS='https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_STATIC).then(async cache=>{
      await cache.addAll(PRECACHE_URLS);
      try{
        const resp=await fetch(GFONTS_CSS);
        if(resp.ok){const fc=await caches.open(CACHE_FONTS);await fc.put(GFONTS_CSS,resp)}
      }catch(e){}
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=>k.startsWith('dc-static-')&&k!==CACHE_STATIC).map(k=>caches.delete(k)))
    ).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET')return;
  if(url.hostname.includes('supabase.co'))return;
  if(url.hostname.includes('anthropic.com'))return;

  // Google Fonts font files — cache-first
  if(url.hostname==='fonts.gstatic.com'){
    event.respondWith(
      caches.open(CACHE_FONTS).then(cache=>
        cache.match(event.request).then(cached=>{
          if(cached)return cached;
          return fetch(event.request).then(resp=>{if(resp.ok)cache.put(event.request,resp.clone());return resp});
        })
      )
    );
    return;
  }

  // Google Fonts CSS — stale-while-revalidate
  if(url.hostname==='fonts.googleapis.com'){
    event.respondWith(
      caches.open(CACHE_FONTS).then(cache=>
        cache.match(event.request).then(cached=>{
          const fp=fetch(event.request).then(resp=>{if(resp.ok)cache.put(event.request,resp.clone());return resp}).catch(()=>cached);
          return cached||fp;
        })
      )
    );
    return;
  }

  // CDN scripts — cache-first (versioned URLs)
  if(url.hostname==='cdn.jsdelivr.net'||url.hostname==='cdnjs.cloudflare.com'){
    event.respondWith(
      caches.match(event.request).then(cached=>{
        if(cached)return cached;
        return fetch(event.request).then(resp=>{
          if(resp.ok){const c=resp.clone();caches.open(CACHE_STATIC).then(cache=>cache.put(event.request,c))}
          return resp;
        });
      })
    );
    return;
  }

  // App shell (index.html, /) — stale-while-revalidate with update notification
  if(url.origin===self.location.origin){
    event.respondWith(
      caches.open(CACHE_STATIC).then(cache=>
        cache.match(event.request).then(cached=>{
          const fp=fetch(event.request).then(resp=>{
            if(resp.ok){
              cache.put(event.request,resp.clone());
              if(cached){
                resp.clone().text().then(newBody=>{
                  cached.clone().text().then(oldBody=>{
                    if(newBody!==oldBody){
                      self.clients.matchAll().then(clients=>{
                        clients.forEach(c=>c.postMessage({type:'SW_UPDATE_AVAILABLE'}));
                      });
                    }
                  });
                });
              }
            }
            return resp;
          }).catch(()=>cached);
          return cached||fp;
        })
      )
    );
    return;
  }
});
