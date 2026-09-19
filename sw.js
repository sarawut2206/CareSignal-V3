/* ============================================================
   CareSignal Service Worker — ทำให้ระบบใช้ออฟไลน์ได้หลังเปิดครั้งแรก
   ------------------------------------------------------------
   เหตุผลที่ต้องมี: กลุ่มเป้าหมายคือผู้สูงอายุที่บ้าน ซึ่งอินเทอร์เน็ต
   อาจไม่เสถียร · V3 ไม่ใช้กล้อง จึงแคชเฉพาะหน้าเว็บ สคริปต์ และฟอนต์

   กลยุทธ์แคช:
   - ไฟล์ของแอปเอง (same-origin)     → network-first: ออนไลน์ได้เวอร์ชันใหม่,
                                        ออฟไลน์ใช้สำเนาล่าสุดที่แคชไว้
   - CDN (MediaPipe / โมเดล / ฟอนต์) → cache-first: ไฟล์ใหญ่และแทบไม่เปลี่ยน
                                        โหลดครั้งเดียวพอ
   หมายเหตุความเป็นส่วนตัว: Service Worker นี้แคชเฉพาะ "ไฟล์โปรแกรม"
   ไม่แตะข้อมูลผู้ใช้ และไม่มีการส่งข้อมูลใดออกจากเครื่อง
   ============================================================ */
var VERSION = "cs3-site-18";
/* โฮสต์ที่เก็บเฉพาะไฟล์คงที่ (ไลบรารี โมเดล ฟอนต์) — แคชได้ */
var STATIC_HOSTS = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|storage\.googleapis\.com|esm\.sh|cdnjs\.cloudflare\.com)$/;

/* V2 กับ V3 อยู่บนโดเมนเดียวกัน (sarawut2206.github.io) แคชจึงอยู่ถังเดียวกัน
   ลบเฉพาะแคชของ V3 เอง (ขึ้นต้น cs3-) ห้ามลบของ V2 */
var PREFIX = "cs3-";

/* รับคำสั่งจากหน้าเว็บให้สลับเป็นเวอร์ชันใหม่ทันที (ใช้โดยระบบแจ้งอัปเดต) */
self.addEventListener("message", function (e) {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

var APP_SHELL = [
  "./",
  "./index.html",
  "./CareSignal-App.html",
  "./demo.html",
  "./CareSignal-Portfolio-Dashboard.html",
  "./CareSignal-Staff.html",
  "./CareSignal-Journey.html",
  "./cs-meds.js",
  "./cs-evidence.js",
  "./cs-hospitals.js",
  "./cs-demo.js",
  "./cs-referral-forms.js",
  "./cs-teleconsult.js",
  "./cs-camera.js",
  "./CareSignal-Visit.html",
  "./cs-backend.js",
  "./cs-cloud.js",
  "./cs-score.js",
  "./testkit.html",
  "./manifest-staff.json",
  "./manifest.json",
  "./logo-mark.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./favicon-64.png",
  "./apple-touch-icon.png"
];

/* ดึงไฟล์โดยข้ามแคชของเบราว์เซอร์เสมอ
   เหตุผล: GitHub Pages ส่ง Cache-Control ให้ HTML อยู่หลายนาที ถ้าไม่บังคับ
   ตรวจกับเซิร์ฟเวอร์ Service Worker จะเก็บสำเนาเก่าไว้ต่อ ทำให้ผู้ใช้ที่
   ติดตั้งแอปไว้ค้างเวอร์ชันเดิมแม้ deploy ใหม่แล้ว */
function fetchFresh(req) {
  return fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" }));
}

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) {
        return Promise.all(APP_SHELL.map(function (u) {
          return fetchFresh(new Request(u))
            .then(function (res) { if (res && res.ok) return c.put(u, res); })
            .catch(function () { /* ไฟล์เดียวพลาด ไม่ควรทำให้ติดตั้งล้มทั้งชุด */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          /* รวมแคชของ V3 รุ่นแรก (caresignal-v3-*) ที่เก็บหน้าแรกแบบเก่าไว้แบบ cache-first */
          return (k.indexOf(PREFIX) === 0 || /^caresignal-v3-/.test(k)) && k !== VERSION;
        })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  if (url.origin === self.location.origin) {
    /* ไฟล์แอป: network-first และบังคับตรวจกับเซิร์ฟเวอร์เสมอเมื่อออนไลน์ */
    e.respondWith(
      fetchFresh(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) {
          return m || caches.match("./index.html");
        });
      })
    );
  } else {
    /* ข้อมูลจากฐานข้อมูล (Supabase) และบริการอื่นต้องสดเสมอ — ไม่แตะเลย
       เดิมแคชทุกคำขอข้ามโดเมน ทำให้คิวงานเจ้าหน้าที่ได้คำตอบชุดแรก (0 เคส) ซ้ำตลอด
       แม้ฐานข้อมูลจะมีเคสใหม่แล้ว */
    if (!STATIC_HOSTS.test(url.hostname)) return;
    /* CDN (โมเดล ไลบรารี ฟอนต์): cache-first */
    e.respondWith(
      caches.match(req).then(function (m) {
        if (m) return m;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) {
            var copy = res.clone();
            caches.open(VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
  }
});
