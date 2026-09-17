/* CareSignal V3 — ใช้ออฟไลน์ได้หลังเปิดครั้งแรก · ไม่มีการเรียกออกภายนอกนอกจากฟอนต์ */
var VERSION = "caresignal-v3-2";
var FILES = ["./", "./index.html", "./app.html", "./testkit.html", "./cs-score.js", "./cs-hospitals.js", "./cs-backend.js", "./cs-cloud.js",
             "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (r) {
    return r || fetch(e.request).then(function (res) {
      if (res.ok && new URL(e.request.url).origin === location.origin)
        caches.open(VERSION).then(function (c) { c.put(e.request, res.clone()); });
      return res;
    });
  }));
});
