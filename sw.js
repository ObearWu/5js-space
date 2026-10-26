/*
 * Service worker：只用來收手機推播（不快取任何檔案，網站更新照常生效）。
 * 後端送來的通知內容是 {title, body, url, tag}；點通知就打開（或切到）那一頁。
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

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
