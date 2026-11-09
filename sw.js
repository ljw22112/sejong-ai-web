/* 오프라인 지원: 화면 파일은 캐시 우선, 요건 데이터는 네트워크 우선 */
const VER = "v3";
const SHELL = ["./", "index.html", "assets/style.css", "assets/engine.js", "assets/parser.js", "assets/careers.js", "assets/sheet.js", "assets/grad.js", "assets/timetable.js", "assets/app.js", "assets/icons/icon-192.png", "manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const isData = u.pathname.includes("/data/");
  e.respondWith(isData
    ? fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VER).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request))
    : caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VER).then((c) => c.put(e.request, cp)); return r; })));
});
