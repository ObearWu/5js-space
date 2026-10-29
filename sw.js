/*
 * Service worker：收手機推播，並讓沒網路時還打得開頁面。
 * 頁面和程式碼「網路優先」：有網路一律拿最新的（網站更新照常生效），順便存一份；
 * 沒網路（或網路卡住超過 6 秒）才用存的那份。後端 API 和別的網站一概不碰。
 * 後端送來的通知內容是 {title, body, url, tag}；點通知就打開（或切到）那一頁。
 */
const CACHE = "fivejs-pages-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("fivejs-pages-") && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const old = await cache.match(req, { ignoreSearch: true });
    try {
      const ctl = new AbortController(), t = old ? setTimeout(() => ctl.abort(), 6000) : 0;
      const res = await fetch(req, { signal: ctl.signal });
      clearTimeout(t);
      if (res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (old) return old;
      if (req.mode === "navigate") { const home = await cache.match(new URL("./", self.registration.scope).href, { ignoreSearch: true }); if (home) return home; }
      throw err;
    }
  })());
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "大小豬的小空間", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "大小豬的小空間", {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag,
    icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (w.url.split("#")[0] === url.split("#")[0] && "focus" in w) { await w.focus(); return; }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
