import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { appReleases } from "../shared/app-releases.ts";
const files = [
  "/",
  "/icon.svg",
  "/brand/feeledu-logo.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
  ...readdirSync("dist/assets").map((f) => "/assets/" + f),
];
const revision = createHash("sha256")
  .update(
    files
      .map((f) => readFileSync("dist" + (f === "/" ? "/index.html" : f)))
      .map((b) => b.toString("base64"))
      .join(""),
  )
  .digest("hex")
  .slice(0, 16);
const release = {
  revision,
  releaseId: appReleases[0].id,
  releases: appReleases,
};
writeFileSync("dist/app-release.json", JSON.stringify(release));
writeFileSync(
  "dist/sw.js",
  `const CACHE='feeledu-${revision}';
const RELEASE=${JSON.stringify(release)};
const FILES=${JSON.stringify([...files, "/app-release.json"])};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting();if(e.data==='GET_APP_RELEASE')e.ports[0]?.postMessage(RELEASE);if(e.data==='CLAIM_CLIENTS')e.waitUntil(self.clients.claim())});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('feeledu-')&&k!==CACHE).slice(0,-1).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/downloads/'))return;
if(url.pathname==='/app-release.json'&&e.request.cache==='no-store')return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/')));return;}
e.respondWith((async()=>{const cached=await(await caches.open(CACHE)).match(e.request);return cached||await caches.match(e.request)||fetch(e.request)})());});`,
);
console.log("Offline app shell generated:", revision);
