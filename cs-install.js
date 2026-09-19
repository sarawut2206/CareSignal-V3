/* ============================================================
   cs-install.js — วิธีติดตั้งลงหน้าจอมือถือ ตามเครื่องและเบราว์เซอร์ที่ใช้จริง
   ใช้ร่วมกันทั้งหน้าเว็บ (index.html) และตัวแอป (CareSignal-App.html)
   ------------------------------------------------------------
   iPhone ไม่มีปุ่มติดตั้งอัตโนมัติ (ไม่มี beforeinstallprompt) ต้องทำจากเมนูแชร์ของเบราว์เซอร์
   - iOS 26 ขึ้นไป: Safari ย้ายปุ่มแชร์ไปอยู่ในเมนู ••• มุมขวาล่าง และมีสวิตช์ "เปิดเป็นเว็บแอป"
     ต้องเปิดไว้ ไม่งั้นได้แค่ที่คั่นหน้าที่เปิดกลับไปใน Safari
   - iOS 16.4 ขึ้นไป: Chrome / Edge / Firefox บน iPhone ก็เพิ่มลงหน้าจอโฮมได้ (ปุ่มแชร์ที่แถบที่อยู่)
   - LINE: ต่อท้ายลิงก์ด้วย openExternalBrowser=1 แล้ว LINE จะเปิดในเบราว์เซอร์ของเครื่องเอง
   - Facebook / Messenger / Instagram: ติดตั้งไม่ได้ ต้องให้ผู้ใช้เลือก "เปิดในเบราว์เซอร์" เอง
   ============================================================ */
(function (g) {
  function info(ua) {
    ua = ua || (g.navigator ? navigator.userAgent : "");
    var touchMac = /Macintosh/.test(ua) && g.navigator && navigator.maxTouchPoints > 1;
    var ios = /iPhone|iPad|iPod/.test(ua) || touchMac, m = ua.match(/OS (\d+)[_.](\d+)/), v = m ? +m[1] + (+m[2]) / 100 : (touchMac ? 17 : 0);
    var sv = ua.match(/Version\/(\d+)/); if (ios && sv && +sv[1] >= 26) v = Math.max(v, +sv[1]);   /* iOS 26 รายงาน OS 18_6 ใน UA แต่ Version/26 */
    return {
      ios: ios, iosVer: v, ipad: /iPad/.test(ua) || touchMac, android: /Android/.test(ua),
      line: /\bLine\//i.test(ua), fb: /FB_IAB|FBAN|FBAV|Messenger|Instagram/i.test(ua), otherInApp: /MicroMessenger|TikTok/i.test(ua),
      chromeIOS: /CriOS/.test(ua), edgeIOS: /EdgiOS/.test(ua), firefoxIOS: /FxiOS/.test(ua)
    };
  }
  function here() { return g.location ? g.location.href : "https://sarawut2206.github.io/CareSignal-V3/CareSignal-App.html"; }
  function externalURL(href) {
    href = href || here(); var u = href.replace(/#.*$/, "");
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "openExternalBrowser=1";
  }
  var ADD = "<b>เพิ่มไปยังหน้าจอโฮม</b> (Add to Home Screen)";
  var WEBAPP = "<li>ถ้ามีสวิตช์ <b>เปิดเป็นเว็บแอป</b> ให้<b>เปิดไว้</b> แล้วแตะ <b>เพิ่ม</b> มุมขวาบน</li>";
  var DONE = '<p class="note">เสร็จแล้วไอคอน <b>CareSignal V3</b> (นาฬิกาจับเวลาสีเขียว) จะอยู่บนหน้าจอโฮม — เปิดจากไอคอนนั้นทุกครั้ง</p>';
  /* คืน { title, html, action?: { label, href } } */
  function guide(ua) {
    var d = info(ua);
    if (d.line) return { title: "เปิดใน " + (d.ios ? "Safari" : "Chrome") + " ก่อน",
      html: "<p>หน้านี้เปิดอยู่ใน LINE ซึ่ง<b>ติดตั้งแอปไม่ได้</b></p><ol><li>แตะปุ่มด้านล่าง LINE จะเปิดหน้านี้ใน" + (d.ios ? " Safari" : "เบราว์เซอร์") + "</li><li>แล้วกด <b>ติดตั้งลงหน้าจอมือถือ</b> อีกครั้ง</li></ol>",
      action: { label: "เปิดใน" + (d.ios ? " Safari" : "เบราว์เซอร์"), href: externalURL() } };
    if (d.fb || d.otherInApp) return { title: "เปิดในเบราว์เซอร์ก่อน",
      html: "<p>หน้านี้เปิดอยู่ในเบราว์เซอร์ที่ฝังมากับแอปแชท ซึ่ง<b>ติดตั้งแอปไม่ได้</b></p><ol><li>แตะปุ่ม <b>⋯</b> ที่มุมขวา" + (d.ios ? "ล่างหรือขวาบน" : "บน") + "</li><li>เลือก <b>เปิดใน" + (d.ios ? " Safari" : "เบราว์เซอร์") + "</b> (หรือ เปิดในเบราว์เซอร์ภายนอก)</li><li>กด <b>ติดตั้งลงหน้าจอมือถือ</b> อีกครั้ง</li></ol>" +
        '<p class="note">หาเมนูไม่เจอ: กดคัดลอกลิงก์ แล้วไปวางในช่องที่อยู่ของ ' + (d.ios ? "Safari" : "Chrome") + "</p>",
      action: { label: "คัดลอกลิงก์", copy: here().replace(/#.*$/, "") } };
    if (d.ios && (d.chromeIOS || d.edgeIOS || d.firefoxIOS)) {
      var nm = d.chromeIOS ? "Chrome" : d.edgeIOS ? "Edge" : "Firefox";
      if (d.iosVer && d.iosVer < 16.4) return { title: "ติดตั้งบน iPhone", html: "<p>iOS รุ่นนี้ (" + Math.floor(d.iosVer) + ") ติดตั้งจาก " + nm + " ไม่ได้ ให้เปิดหน้านี้ใน <b>Safari</b> แล้วกดติดตั้งอีกครั้ง</p>",
        action: { label: "คัดลอกลิงก์ไปเปิดใน Safari", copy: here().replace(/#.*$/, "") } };
      return { title: "ติดตั้งบน iPhone (" + nm + ")",
        html: "<ol><li>แตะปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น ⬆︎) " + (d.chromeIOS ? "ที่ท้ายช่องที่อยู่เว็บด้านบน" : "ในเมนู ⋯") + "</li><li>เลื่อนลงหา " + ADD + "</li>" + WEBAPP + "</ol>" + DONE +
          '<p class="note">ถ้าไม่เจอเมนูนี้ ให้เปิดหน้านี้ใน Safari แทน</p>' };
    }
    if (d.ios) {
      var new26 = d.iosVer >= 26;
      return { title: "ติดตั้งบน " + (d.ipad ? "iPad" : "iPhone") + " (Safari)",
        html: "<ol>" + (new26
          ? "<li>แตะปุ่ม<b>จุดสามจุด ( • • • )</b> ที่มุม" + (d.ipad ? "ขวาบน" : "ขวาล่าง") + " ข้างช่องที่อยู่เว็บ</li><li>แตะ <b>แชร์</b> (⬆︎)</li><li>เลื่อนลง แตะ <b>ดูเพิ่มเติม</b> ถ้ามี แล้วเลือก " + ADD + "</li>"
          : "<li>แตะปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น ⬆︎) ที่แถบ" + (d.ipad ? "บน" : "ล่าง") + "ของ Safari — ถ้าไม่เห็น แตะปุ่ม<b>จุดสามจุด ( • • • )</b> ก่อน</li><li>เลื่อนลงหา " + ADD + "</li>") +
          WEBAPP + "</ol>" + DONE +
          '<p class="note">ไม่เห็นแถบเมนู: แตะที่ด้านล่างของจอหนึ่งครั้งให้แถบโผล่ · ถ้าอยู่ในโหมดส่วนตัว (Private) ให้เปิดแท็บปกติก่อน</p>' };
    }
    if (d.android) return { title: "ติดตั้งบน Android",
      html: "<ol><li>แตะปุ่ม <b>⋮</b> ที่มุมขวาบนของ Chrome</li><li>เลือก <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b></li><li>แตะ <b>ติดตั้ง</b></li></ol>" +
        '<p class="note">ถ้ายังไม่เห็นเมนูนี้ ให้เปิดหน้านี้ค้างไว้สักครู่แล้วลองใหม่</p>' };
    return { title: "ติดตั้งบนคอมพิวเตอร์",
      html: "<ol><li>ดูที่แถบที่อยู่เว็บด้านบน จะมีไอคอนรูปจอที่มีลูกศรลง หรือเครื่องหมาย <b>+</b></li><li>คลิกแล้วเลือก <b>ติดตั้ง</b></li></ol>" +
        '<p class="note">ใช้ได้กับ Chrome และ Edge · Safari บน Mac: เมนู ไฟล์ → เพิ่มไปที่ Dock</p>' };
  }
  /* ปุ่มในหน้าต่างวิธีติดตั้ง: เปิดลิงก์ภายนอก หรือคัดลอกลิงก์ */
  function runAction(a, done) {
    if (!a) return;
    if (a.href) { location.href = a.href; return; }
    if (a.copy) {
      var ok = function () { if (done) done("คัดลอกลิงก์แล้ว"); };
      try { navigator.clipboard.writeText(a.copy).then(ok, function () { prompt("คัดลอกลิงก์นี้", a.copy); }); } catch (e) { prompt("คัดลอกลิงก์นี้", a.copy); }
    }
  }
  var API = { info: info, guide: guide, externalURL: externalURL, runAction: runAction };
  g.CSInstall = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
