/* ============================================================
   cs-body.js — หุ่นร่างกาย 7 ด้าน (ใช้ร่วม คอนโซลเจ้าหน้าที่ · แอปครอบครัว V3)
   ------------------------------------------------------------
   ทั้ง 7 ด้านคือชุดทดสอบที่ครอบครัวทำที่บ้าน ผูกกับส่วนของร่างกายที่เกี่ยวข้อง
     1 ลุกนั่ง 5 ครั้ง → ต้นขา        2 ลุกเดิน 3 เมตร → หน้าแข้ง
     3 ทรงตัว 4 ท่า   → เท้า          4 ยา             → ศีรษะ
     5 ประวัติหกล้ม   → สะโพก         6 กิจวัตรประจำวัน → แขนและมือ
     7 ความปลอดภัยในบ้าน → แท่นพื้นใต้หุ่น (สิ่งแวดล้อม)
   สถานะของแต่ละด้าน: ok · warn · bad · none (ยังไม่ได้ทดสอบ)
   ผู้เรียกเป็นผู้ตัดสินสถานะด้วยเกณฑ์ของตัวเอง — ไฟล์นี้วาดอย่างเดียว
   แอปครอบครัวส่ง bad มาเป็น warn เสมอ (ไม่ใช้สีแดงกับครอบครัว)
   สีใส่ในตัว SVG เอง ไม่พึ่ง CSS ของหน้า จึงหน้าตาเหมือนกันทุกที่
   ============================================================ */
(function (g) {
  var KEYS = ["ftsst", "tug", "bal", "meds", "falls", "adl", "home"];
  var NO = { ftsst: 1, tug: 2, bal: 3, meds: 4, falls: 5, adl: 6, home: 7 };
  var FILL = { none: "#A9B6C6", ok: "#6FCF97", warn: "#F5C542", bad: "#EF5350" };
  var PIN = { none: "#7B8AA1", ok: "#16A34A", warn: "#D97706", bad: "#DC2626" };
  var PLAT = { none: ["#E7ECF3", "#D5DDE8"], ok: ["#DDF5E7", "#6FCF97"], warn: ["#FDF1C7", "#F5C542"], bad: ["#FDF1C7", "#F5C542"] };
  var PINS = { meds: [120, 34], adl: [190, 196], falls: [120, 238], ftsst: [103, 300], tug: [137, 376], bal: [103, 420], home: [196, 432] };
  var P = {
    head: "M120 8 C136 8 146 22 146 38 C146 54 136 68 120 68 C104 68 94 54 94 38 C94 22 104 8 120 8 Z",
    neck: "M110 66 L130 66 L132 80 L108 80 Z",
    torso: "M78 92 C82 80 102 76 120 76 C138 76 158 80 162 92 C167 112 164 142 158 168 C155 188 156 206 156 222 L84 222 C84 206 85 188 82 168 C76 142 73 112 78 92 Z",
    hips: "M84 222 L156 222 C160 236 160 248 154 258 L86 258 C80 248 80 236 84 222 Z",
    armU: "M80 88 C66 92 60 104 58 118 L52 168 C56 174 64 174 68 168 L74 120 Z",
    armF: "M52 170 C48 190 44 212 42 230 C46 236 54 236 56 230 L66 172 Z",
    hand: "M40 232 C34 240 34 254 42 260 C50 262 56 254 56 244 L56 232 Z",
    thigh: "M88 256 L118 256 L117 300 C116 318 114 332 112 342 C106 346 98 346 94 342 C92 318 88 286 88 256 Z",
    shin: "M94 346 L112 346 C112 370 110 392 108 408 C104 412 99 412 96 408 C95 388 94 366 94 346 Z",
    foot: "M96 410 L108 410 C110 416 116 420 118 424 C112 428 98 428 90 425 C92 420 95 414 96 410 Z"
  };
  /* สะท้อนซ้าย-ขวา: x → 240 − x (พิกัดในเส้นทางเป็นคู่ "x y" เสมอ) */
  function mir(d) { return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, function (_, x, y) { return (240 - (+x)) + " " + y; }); }
  function st(S, k) { var v = S && S[k]; return FILL[v] ? v : "none"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* S = { ftsst:"warn", tug:"ok", ... } · o.titles = { ftsst:"1. ลุกนั่ง 5 ครั้ง", ... } · o.label = aria-label */
  function figure(S, o) {
    o = o || {};
    var base = 'fill="#A9B6C6" stroke="#fff" stroke-width="1.6"';
    function rg(k, d) { return '<path class="rg ' + st(S, k) + '" data-cmp="' + k + '" d="' + d + '" fill="' + FILL[st(S, k)] + '" stroke="#fff" stroke-width="1.6"/>'; }
    var pl = PLAT[st(S, "home")];
    var body =
      '<ellipse cx="120" cy="430" rx="96" ry="13" fill="' + pl[0] + '" stroke="' + pl[1] + '" stroke-width="1.2" data-cmp="home"/>' +
      rg("meds", P.head) + '<path ' + base + ' d="' + P.neck + '"/>' + '<path ' + base + ' d="' + P.torso + '"/>' +
      '<path d="M104 104 C112 110 128 110 136 104 M120 118 L120 200" fill="none" stroke="#fff" stroke-width="1.2" opacity=".55"/>' +
      rg("falls", P.hips) +
      rg("adl", P.armU) + rg("adl", mir(P.armU)) + rg("adl", P.armF) + rg("adl", mir(P.armF)) + rg("adl", P.hand) + rg("adl", mir(P.hand)) +
      rg("ftsst", P.thigh) + rg("ftsst", mir(P.thigh)) + rg("tug", P.shin) + rg("tug", mir(P.shin)) + rg("bal", P.foot) + rg("bal", mir(P.foot));
    var pins = KEYS.map(function (k) {
      var p = PINS[k], s = st(S, k);
      return '<g class="pin ' + s + '" data-cmp="' + k + '" style="cursor:pointer"><title>' + esc((o.titles && o.titles[k]) || NO[k]) + '</title>' +
        '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="11" fill="' + PIN[s] + '" stroke="#fff" stroke-width="2"/>' +
        '<text x="' + p[0] + '" y="' + (p[1] + 0.5) + '" fill="#fff" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="inherit">' + NO[k] + '</text></g>';
    }).join("");
    return '<svg viewBox="0 0 240 448" role="img" aria-label="' + esc(o.label || "หุ่นร่างกายแสดงผลการทดสอบ 7 ด้าน") + '">' + body + pins + '</svg>';
  }
  var API = { KEYS: KEYS, NO: NO, FILL: FILL, PIN: PIN, figure: figure, mirror: mir };
  g.CSBody = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
