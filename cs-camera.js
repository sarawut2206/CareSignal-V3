/* ============================================================
   cs-camera.js — วัดด้วยกล้อง (ทางเลือกเสริมของแอป V3) · เอนจินรุ่น 3
   ------------------------------------------------------------
   รุ่น 3 (แก้ "กล้องหลังไม่นับ ไม่จับการลุกนั่ง" ของรุ่น 2):
   ก. เวลาที่ส่งให้โมเดลมาจากนาฬิกาเดียวที่เดินหน้าเสมอ (mono) — รุ่น 2 ผสม captureTime ของเฟรม
      กับ performance.now() ถ้าเวลาถอยหลัง MediaPipe จะปฏิเสธทุกเฟรม ระบบจึง "ไม่เห็นคน" ตลอด
   ข. วงรอบเฟรมไม่ตายเมื่อเกิดข้อผิดพลาด (ลงทะเบียนเฟรมถัดไปก่อนประมวลผล + ตัวเฝ้าระวังปลุกวิดีโอ)
   ค. ไม่ต้องเห็นเท้า: ท่านั่ง–ยืนคิดจาก "ต้นขาตั้งแค่ไหน" (ระยะสะโพก→เข่าแนวดิ่ง ÷ ความยาวลำตัว)
      รวมกับมุมเข่า 3 มิติและสัดส่วนสะโพก เมื่อเห็นชัด — ถือมือถือใกล้จนเท้าหลุดกรอบก็ยังนับได้
   ง. ไม่มีขั้นสอบเทียบ: จำท่านั่งตอนกดเริ่ม แล้วปรับช่วงนั่ง↔ยืนเองระหว่างทดสอบ
   จ. มีแถบ "นั่ง ↔ ยืน" แบบสด + เฟรม/วินาที ให้ผู้วัดเห็นทันทีว่ากล้องจับท่าได้หรือไม่
   ฉ. ถ้าโมเดลบน GPU ใช้ไม่ได้ในเครื่องนั้น สลับไป CPU เอง · ขอกล้องแบบผ่อนเงื่อนไขทีละขั้น
   ------------------------------------------------------------
   รุ่น 2 (ยังใช้อยู่):
   1. ท่านั่ง–ยืน ใช้ "มุมเข่า 3 มิติ" (world landmarks ของ MediaPipe หน่วยเมตร ไม่ขึ้นกับมุมกล้อง
      หรือการเอียงมือถือ) รวมกับสัดส่วนสะโพก ถ่วงน้ำหนักตามความชัดของขา — เดิมใช้สะโพกอย่างเดียว
   2. กรองสัญญาณด้วย One-Euro filter (หน่วงน้อยกว่าค่าเฉลี่ยเคลื่อนที่) และหาเวลาข้ามเกณฑ์
      แบบแทรกค่าระหว่างเฟรม — เวลาไม่หยาบเท่าช่วงเฟรมอีกต่อไป
   3. วนตามเฟรมวิดีโอจริง (requestVideoFrameCallback) ไม่ประมวลผลเฟรมซ้ำ
   4. ทดสอบความเร็วเครื่องก่อนวัด แล้วลดรุ่นโมเดลทันทีถ้าช้ากว่า ~14 เฟรม/วินาที
      (เดิมเริ่มที่รุ่นหนักสุดเสมอ มือถือได้ 5–8 เฟรม/วินาที จับจังหวะไม่ทัน)
   5. ติดตามคนเดียว (numPoses 1) ให้โมเดลตามคนเดิมต่อเนื่อง ไม่กระตุก
   6. ลุกนั่ง: จับเวลาตั้งแต่สัญญาณ "เริ่ม" จนนั่งลงครั้งที่ 5 — ตรงกับวิธีกดจับเวลาเองของแอป
      (เดิมจบตอนยืนครั้งที่ 5 ทำให้ผลจากกล้องสั้นกว่ากดเองราว 1 วินาที)
   7. ลุกเดิน: ประมาณระยะเป็นเมตรจาก "ความสูงลำตัวในภาพ" และการเคลื่อนด้านข้าง แทนความกว้างไหล่
      ซึ่งหดเองตอนหมุนตัว ทำให้จับจุดกลับผิด · ใช้ได้ทั้งเดินออกจากกล้องและเดินขวางกล้อง
   8. ทุกผลมีระดับความน่าเชื่อถือ (เฟรม/วินาที · ความชัดของตัว) ถ้าต่ำจะแนะนำให้วัดซ้ำหรือกดเอง
   หลักเดิมคงไว้: ภาพประมวลผลในเครื่อง ไม่อัปโหลด เก็บเฉพาะตัวเลข · ผลกลับเข้าหน้าจับเวลาให้คนกดบันทึก
   ผลทรงตัวผ่าน/ไม่ผ่านให้คนยืนยันเสมอ · ไม่มีสั่งงานด้วยเสียง
   สัญญาณมือ (ลุกนั่ง · ลุกเดิน): ยกสองมือ = เริ่ม · กางแขนด้านข้าง = สิ้นสุด · ยกมือข้างเดียว = บันทึก
   ปุ่มบนจอยังใช้ได้ทุกขั้น · ทำไม่ครบ 5 ครั้ง หรือเดินไม่ครบระยะ บันทึกด้วยสัญญาณมือไม่ได้
   ============================================================ */
(function (g) {
  var ENGINE = "cam-3.0";
  var LM = { NOSE: 0, LSH: 11, RSH: 12, LHIP: 23, RHIP: 24, LKNEE: 25, RKNEE: 26, LANK: 27, RANK: 28, LHEEL: 29, RHEEL: 30, LTOE: 31, RTOE: 32 };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function vz(p) { return p ? (p.visibility === undefined ? 1 : p.visibility) : 0; }
  function midY(lm, a, b) { return (lm[a].y + lm[b].y) / 2; }
  function visOK(lm) {
    var need = [LM.LSH, LM.RSH, LM.LHIP, LM.RHIP, LM.LKNEE, LM.RKNEE, LM.LANK, LM.RANK], seen = 0;
    for (var i = 0; i < need.length; i++) if (vz(lm[need[i]]) > 0.5) seen++;
    return seen / need.length;
  }
  function hipRatio(lm) {
    var sh = midY(lm, LM.LSH, LM.RSH), hip = midY(lm, LM.LHIP, LM.RHIP), ank = midY(lm, LM.LANK, LM.RANK), span = ank - sh;
    if (!isFinite(span) || Math.abs(span) < 0.02) return null;
    return (ank - hip) / span;
  }
  /* มุมเข่า 3 มิติ (องศา) — นั่ง ≈ 90 · ยืน ≈ 170 · เลือกขาข้างที่เห็นชัดกว่า ถ้าชัดทั้งคู่ใช้ค่าเฉลี่ย */
  function kneeAngle3D(wl, lm) {
    if (!wl) return { k: null, vis: 0 };
    function one(h, k, a) {
      var H = wl[h], K = wl[k], A = wl[a]; if (!H || !K || !A) return null;
      var v1 = [H.x - K.x, H.y - K.y, H.z - K.z], v2 = [A.x - K.x, A.y - K.y, A.z - K.z];
      var m = Math.hypot(v1[0], v1[1], v1[2]) * Math.hypot(v2[0], v2[1], v2[2]); if (!m) return null;
      var ang = Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / m, -1, 1)) * 180 / Math.PI;
      return { k: ang, vis: Math.min(vz(lm[h]), vz(lm[k]), vz(lm[a])) };
    }
    var L = one(LM.LHIP, LM.LKNEE, LM.LANK), R = one(LM.RHIP, LM.RKNEE, LM.RANK);
    if (!L && !R) return { k: null, vis: 0 }; if (!L) return R; if (!R) return L;
    if (Math.abs(L.vis - R.vis) > 0.25) return L.vis > R.vis ? L : R;
    return { k: (L.k * L.vis + R.k * R.vis) / Math.max(0.01, L.vis + R.vis), vis: Math.max(L.vis, R.vis) };
  }
  /* ความสูงลำตัวในภาพ (กึ่งกลางไหล่ → กึ่งกลางข้อเท้า) หน่วยเท่าความสูงภาพ — ไม่หดเมื่อหมุนตัว */
  function bodyLen(lm, aspect) {
    var sx = (lm[LM.LSH].x + lm[LM.RSH].x) / 2, sy = midY(lm, LM.LSH, LM.RSH), ax = (lm[LM.LANK].x + lm[LM.RANK].x) / 2, ay = midY(lm, LM.LANK, LM.RANK);
    if (Math.max(vz(lm[LM.LANK]), vz(lm[LM.RANK])) < 0.5) {   /* มองไม่เห็นข้อเท้า: ประมาณจากลำตัว (ไหล่→ข้อเท้า ≈ 2.5 เท่าของไหล่→สะโพก) */
      var hx = (lm[LM.LHIP].x + lm[LM.RHIP].x) / 2, hy = midY(lm, LM.LHIP, LM.RHIP), tr = Math.hypot((sx - hx) * aspect, sy - hy) * 2.5;
      return isFinite(tr) && tr > 0.05 ? tr : null;
    }
    var d = Math.hypot((sx - ax) * aspect, sy - ay); return isFinite(d) && d > 0.05 ? d : null;
  }
  /* ความชัดของส่วนที่ต้องใช้นับ (ไหล่ สะโพก เข่า) — ไม่รวมเท้า */
  function visCore(lm) {
    var need = [LM.LSH, LM.RSH, LM.LHIP, LM.RHIP, LM.LKNEE, LM.RKNEE], s = 0;
    for (var i = 0; i < need.length; i++) s += vz(lm[need[i]]) > 0.5 ? 1 : 0; return s / need.length;
  }

  /* ---------- One-Euro filter (Casiez 2012): เรียบเมื่อช้า ตามทันเมื่อเร็ว ---------- */
  function OneEuro(minCut, beta, dCut) { this.minCut = minCut || 1.5; this.beta = beta == null ? 0.4 : beta; this.dCut = dCut || 1.0; this.x = null; this.dx = 0; this.t = null; }
  OneEuro.prototype.filter = function (x, tMs) {
    if (x == null || !isFinite(x)) return this.x;
    if (this.x == null || this.t == null) { this.x = x; this.t = tMs; return x; }
    var dt = Math.max(1e-3, (tMs - this.t) / 1000); this.t = tMs;
    function alpha(cut) { var tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
    var dx = (x - this.x) / dt, ad = alpha(this.dCut); this.dx = ad * dx + (1 - ad) * this.dx;
    var a = alpha(this.minCut + this.beta * Math.abs(this.dx)); this.x = a * x + (1 - a) * this.x; return this.x;
  };

  /* ---------- นาฬิกาเดียวที่เดินหน้าเสมอ: MediaPipe VIDEO mode ปฏิเสธเวลาที่ซ้ำหรือถอยหลัง ---------- */
  function makeClock(nowFn) { var last = -Infinity; return function () { var t = nowFn(); if (!(t > last)) t = last + 1; last = t; return t; }; }
  var mono = makeClock(function () { return typeof performance !== "undefined" ? performance.now() : Date.now(); });

  /* ---------- ลักษณะท่าทางจากหนึ่งเฟรม (ไม่บังคับให้เห็นเท้า) ----------
     v = ระยะแนวดิ่งสะโพก→เข่า ÷ ความยาวลำตัว (ไหล่→สะโพก): นั่ง ≈ 0–0.4 (ต้นขาแนวนอน) · ยืน ≈ 0.8–0.95 (ต้นขาตั้ง)
     k = มุมเข่า 3 มิติ (ต้องเห็นข้อเท้าพอควร) · h = สัดส่วนสะโพก (ต้องเห็นข้อเท้าชัด) */
  function features(lm, wl, aspect) {
    if (!lm) return null; aspect = aspect || 1;
    /* จุดที่อยู่นอกกรอบภาพ โมเดลเดาตำแหน่งให้ — ห้ามใช้ (เดิมทำให้เห็นว่า "นั่ง" ทั้งที่มองไม่เห็นเข่า) */
    function seen(i, th) { var p = lm[i]; return p && vz(p) >= th && p.x > -0.01 && p.x < 1.01 && p.y > -0.01 && p.y < 1.0 ? vz(p) : 0; }
    var shV = Math.min(vz(lm[LM.LSH]), vz(lm[LM.RSH])), hpV = Math.min(vz(lm[LM.LHIP]), vz(lm[LM.RHIP]));
    if (!seen(LM.LSH, 0.3) && !seen(LM.RSH, 0.3) || !seen(LM.LHIP, 0.3) && !seen(LM.RHIP, 0.3)) return null;
    var sx = (lm[LM.LSH].x + lm[LM.RSH].x) / 2 * aspect, sy = midY(lm, LM.LSH, LM.RSH), hx = (lm[LM.LHIP].x + lm[LM.RHIP].x) / 2 * aspect, hy = midY(lm, LM.LHIP, LM.RHIP);
    var T = Math.hypot(sx - hx, sy - hy); if (!isFinite(T) || T < 0.03) return null;
    var f = { T: T, vis: Math.min(1, (shV + hpV) / 2 + 0.1), v: null, vVis: 0, k: null, kVis: 0, h: null };
    var lk = seen(LM.LKNEE, 0.4), rk = seen(LM.RKNEE, 0.4), sum = 0, w = 0;
    if (lk) { sum += (lm[LM.LKNEE].y - lm[LM.LHIP].y) * lk; w += lk; }
    if (rk) { sum += (lm[LM.RKNEE].y - lm[LM.RHIP].y) * rk; w += rk; }
    if (w > 0) { f.v = sum / w / T; f.vVis = Math.max(lk, rk); }
    var la = seen(LM.LANK, 0.35), ra = seen(LM.RANK, 0.35);
    if (!lk && !rk) return f;
    if (wl && Math.max(la, ra) >= 0.35) { var ka = kneeAngle3D(wl, lm); if (ka.k != null && ka.vis >= 0.3) { f.k = ka.k; f.kVis = ka.vis; } }
    if (Math.min(la, ra) >= 0.5 && shV >= 0.5) f.h = hipRatio(lm);
    return f;
  }
  /* ---------- สัญญาณมือ (ลุกนั่ง · ลุกเดิน) ----------
     ยกสองมือ = เริ่ม · กางแขนออกด้านข้าง = สิ้นสุด · ยกมือข้างเดียว = บันทึก
     ท่าแขนแต่ละข้าง: ใช้พิกัด 3 มิติ (เมตร) ก่อน — ไม่ขึ้นกับมุมกล้อง · ถ้าไม่มีใช้ภาพ 2 มิติ ÷ ความยาวลำตัว
     ข้อมือต้องอยู่ในกรอบภาพและเห็นชัด ไม่เดาจากจุดที่โมเดลเดาให้ */
  var ARM = { L: [LM.LSH, 13, 15, LM.LHIP], R: [LM.RSH, 14, 16, LM.RHIP] };
  function armPose(lm, wl, side, aspect) {
    if (!lm) return null; aspect = aspect || 1; var ix = ARM[side], S = lm[ix[0]], E = lm[ix[1]], W = lm[ix[2]];
    function inF(p, th) { return p && vz(p) >= th && p.x > -0.01 && p.x < 1.01 && p.y > -0.01 && p.y < 1.01; }
    if (!inF(S, 0.5) || !inF(W, 0.5)) return null;
    if (wl && wl[ix[0]] && wl[ix[2]] && wl[ix[1]]) {
      var Sw = wl[ix[0]], Ew = wl[ix[1]], Ww = wl[ix[2]], up = Sw.y - Ww.y, reach = Math.hypot(Ww.x - Sw.x, Ww.z - Sw.z);
      var a = [Sw.x - Ew.x, Sw.y - Ew.y, Sw.z - Ew.z], b = [Ww.x - Ew.x, Ww.y - Ew.y, Ww.z - Ew.z], m = Math.hypot(a[0], a[1], a[2]) * Math.hypot(b[0], b[1], b[2]);
      var elbow = m ? Math.acos(clamp((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / m, -1, 1)) * 180 / Math.PI : 0;
      if (up > 0.20) return "up";
      if (Math.abs(up) < 0.15 && reach > 0.40 && elbow > 140) return "side";
      return "down";
    }
    var H = lm[ix[3]], T = H && vz(H) >= 0.3 ? Math.hypot((S.x - H.x) * aspect, S.y - H.y) : null; if (!T || T < 0.03) return null;
    var dy = (S.y - W.y) / T, dx = Math.abs(W.x - S.x) * aspect / T;
    if (dy > 0.5) return "up";
    if (Math.abs(dy) < 0.35 && dx > 0.8) return "side";
    return "down";
  }
  /* ต้องค้างท่าไว้ (สองมือ 0.6 วิ · ข้างเดียว 0.8 วิ · กางแขน 1 วิ) และต้องลดแขนลงก่อนสั่งครั้งถัดไป
     ท่าหายไป 1–2 เฟรมไม่นับว่าเลิกทำ · ยกมือข้างเดียว ต้องเห็นแขนอีกข้างว่าไม่ได้ยก */
  var HOLD = { both: 600, one: 800, side: 1000 };
  function Gestures() { this.cand = null; this.since = 0; this.lastG = -1e9; this.needRelease = false; }
  Gestures.classify = function (L, R) {
    if (L === "up" && R === "up") return "both";
    if ((L === "up" && (R === "down" || R === "side")) || (R === "up" && (L === "down" || L === "side"))) return "one";
    if ((L === "side" && R !== "up") || (R === "side" && L !== "up")) return "side";
    return null;
  };
  /* allowed: เฉพาะสัญญาณที่ใช้ได้ในขั้นนั้น — ท่าอื่นไม่ถูกนับและไม่ "กิน" สัญญาณที่ต้องการ */
  Gestures.prototype.push = function (L, R, t, allowed) {
    var g = Gestures.classify(L, R); if (allowed && allowed.indexOf(g) < 0) g = null;
    if (g) this.lastG = t; else if (this.cand && t - this.lastG < 250) g = this.cand;
    if (this.needRelease) { if (!g) this.needRelease = false; this.cand = null; return null; }
    if (g !== this.cand) { this.cand = g; this.since = t; return g ? { g: g, progress: 0 } : null; }
    if (!g) return null;
    var pr = (t - this.since) / HOLD[g];
    if (pr >= 1) { this.needRelease = true; this.cand = null; return { fire: g, at: this.since }; }
    return { g: g, progress: pr };
  };

  /* จุดอ้างอิงสัมบูรณ์ (ใช้ก่อนกดเริ่ม เพื่อแสดงแถบสด และดูว่านั่งอยู่หรือยัง) · ช่วงขั้นต่ำระหว่างนั่ง↔ยืน */
  var ABS = { v: [0.30, 0.82], k: [100, 165], h: [0.30, 0.48] }, PRIOR = { v: 0.40, k: 55, h: 0.15 }, WT = { v: 1.0, k: 1.0, h: 0.6 }, KEYS = ["v", "k", "h"];
  function fuse(f, map) {
    var s = 0, w = 0;
    KEYS.forEach(function (key) {
      if (f[key] == null) return; var r = map(key); if (!r) return;
      var q = key === "v" ? clamp((f.vVis - 0.25) / 0.45, 0.15, 1) : key === "k" ? clamp((f.kVis - 0.25) / 0.45, 0.15, 1) : 1;
      s += WT[key] * q * clamp((f[key] - r[0]) / (r[1] - r[0]), -0.2, 1.2); w += WT[key] * q;
    });
    return w ? s / w : null;
  }
  function absPosture(f) { return f ? fuse(f, function (k) { return ABS[k]; }) : null; }

  /* ---------- คะแนนท่าทาง 0 (นั่ง) → 1 (ยืน) แบบปรับตัวเอง ----------
     ก่อนเริ่ม: ใช้จุดอ้างอิงสัมบูรณ์ · กดเริ่ม (ผู้สูงอายุนั่งอยู่): จำค่าท่านั่งของคนนี้ในมุมกล้องนี้
     ระหว่างทดสอบ: ช่วงนั่ง↔ยืน ขยายตามค่าต่ำสุด/สูงสุดที่เห็นจริง (ไม่แคบกว่าช่วงขั้นต่ำ) */
  function Posture(prior) {
    this.P = {}; var self = this; KEYS.forEach(function (k) { self.P[k] = prior && prior[k] ? prior[k] : PRIOR[k]; });
    this.F = {}; this.hist = []; this.R = null; this.last = null;
  }
  Posture.prototype._filt = function (f, t) {
    var o = {}, self = this;
    KEYS.forEach(function (k) { if (f[k] == null) return; if (!self.F[k]) self.F[k] = new OneEuro(1.5, 0.3); o[k] = self.F[k].filter(f[k], t); });
    return o;
  };
  Posture.prototype.push = function (f, t) {
    if (!f) { this.last = null; return null; }
    var fl = this._filt(f, t), self = this; this.hist.push({ t: t, f: fl }); while (this.hist.length && t - this.hist[0].t > 2000) this.hist.shift();
    if (this.R) KEYS.forEach(function (k) {
      if (fl[k] == null) return; var r = self.R[k];
      if (!r) { var a = absPosture({ v: k === "v" ? fl.v : null, k: k === "k" ? fl.k : null, h: k === "h" ? fl.h : null, vVis: 1, kVis: 1 }); var lo = a != null && a > 0.6 ? ABS[k][0] : fl[k]; r = self.R[k] = { lo: lo, hi: lo + self.P[k] }; }
      if (fl[k] < r.lo) { r.lo = fl[k]; r.hi = Math.max(r.hi, r.lo + self.P[k]); }
      if (fl[k] > r.hi) r.hi = fl[k];
    });
    var p = this.R ? fuse(f, function (k) { var r = self.R[k]; return r ? [r.lo, Math.max(r.hi, r.lo + self.P[k])] : null; }) : absPosture(f);
    this.last = p; return p;
  };
  /* กดเริ่ม: ค่าท่านั่ง = มัธยฐาน 1 วินาทีล่าสุด · ถ้าดูเหมือนยืนอยู่ ใช้จุดอ้างอิงสัมบูรณ์แทน แล้วให้ค่าต่ำสุดที่เห็นปรับเอง */
  Posture.prototype.arm = function () {
    var self = this, t1 = this.hist.length ? this.hist[this.hist.length - 1].t : 0, R = {};
    KEYS.forEach(function (k) {
      var xs = self.hist.filter(function (e) { return t1 - e.t <= 1000 && e.f[k] != null; }).map(function (e) { return e.f[k]; }).sort(function (a, b) { return a - b; });
      if (!xs.length) return; var m = xs[Math.floor(xs.length / 2)], one = {}; one[k] = m; one.vVis = 1; one.kVis = 1;
      var a = absPosture(one), lo = a != null && a > 0.6 ? ABS[k][0] : m; R[k] = { lo: lo, hi: lo + self.P[k] };
    });
    this.R = R; return this.seatedAbs();
  };
  Posture.prototype.seatedAbs = function () {
    var e = this.hist[this.hist.length - 1]; if (!e) return null; var f = e.f; f.vVis = 1; f.kVis = 1; var a = absPosture(f); return a == null ? null : a < 0.35;
  };
  /* ช่วงที่เรียนรู้ไว้ใช้เป็นช่วงขั้นต่ำของการวัดถัดไป (เช่น ลุกเดินหลังลุกนั่ง) */
  Posture.prototype.learned = function () {
    var o = { engine: ENGINE }, R = this.R || {}, self = this;
    KEYS.forEach(function (k) { if (R[k]) o[k] = clamp((R[k].hi - R[k].lo) * 0.85, PRIOR[k] * 0.75, PRIOR[k] * 1.8); }); return o;
  };
  /* เวลาที่สัญญาณข้ามเกณฑ์ แทรกค่าระหว่างสองเฟรม */
  function crossT(p0, t0, p1, t1, th) { if (p0 == null || p1 === p0) return t1; return t0 + clamp((th - p0) / (p1 - p0), 0, 1) * (t1 - t0); }

  /* ---------- ตัวนับลุกนั่ง: รับคะแนนท่าทาง 0–1 · จับเวลาจากสัญญาณเริ่มถึงนั่งลงครั้งสุดท้าย ---------- */
  function RepDetector(o) {
    o = o || {}; this.target = o.target || 5; this.up = 0.72; this.down = 0.30; this.onset = 0.15;
    this.state = "idle"; this.reps = 0; this.stamps = []; this.goAt = null; this.moveStart = null; this.done = false; this.f = new OneEuro(2.0, 0.6); this.pp = null; this.pt = null; this.lastStandAt = null;
  }
  RepDetector.prototype.start = function (t) { this.state = "sit"; this.reps = 0; this.stamps = []; this.goAt = t; this.moveStart = null; this.done = false; this.f = new OneEuro(2.0, 0.6); this.pp = null; this.pt = null; };
  RepDetector.prototype._fin = function (tEnd, standing) {
    this.done = true;
    return { event: "finish", reps: this.reps, elapsed: (tEnd - this.goAt) / 1000, reaction: this.moveStart != null ? (this.moveStart - this.goAt) / 1000 : null, endedStanding: !!standing };
  };
  RepDetector.prototype.push = function (pRaw, t) {
    if (this.done || this.state === "idle") return null;
    if (pRaw == null) { if (this.reps >= this.target && this.lastStandAt && t - this.lastStandAt > 6000) return this._fin(this.lastStandAt, true); return null; }
    var p = this.f.filter(pRaw, t), p0 = this.pp, t0 = this.pt, ev = null; this.pp = p; this.pt = t;
    if (this.moveStart === null && this.state === "sit" && p >= this.onset) { this.moveStart = crossT(p0, t0, p, t, this.onset); ev = { event: "onset" }; }
    if (this.state === "sit" && p >= this.up) {
      var ts = crossT(p0, t0, p, t, this.up); if (this.moveStart === null) this.moveStart = ts;
      this.state = "stand"; this.reps++; this.stamps.push(ts); this.lastStandAt = ts; return { event: "rep", reps: this.reps };
    }
    if (this.state === "stand" && p <= this.down) {
      this.state = "sit"; var td = crossT(p0, t0, p, t, this.down);
      if (this.reps >= this.target) return this._fin(td, false);
      return { event: "down", reps: this.reps };
    }
    /* ยืนครบแล้วแต่ไม่นั่งลง (หรือกล้องมองไม่เห็นตอนนั่ง) — ปิดที่เวลายืนครั้งสุดท้าย และติดธงไว้ */
    if (this.reps >= this.target && this.state === "stand" && t - this.lastStandAt > 6000) return this._fin(this.lastStandAt, true);
    return ev;
  };

  /* ---------- ลุกเดิน 3 เมตร: ระยะจากความสูงลำตัวในภาพ + การเคลื่อนด้านข้าง ---------- */
  function TugTracker() {
    this.goAt = null; this.state = "waiting"; this.t0 = null; this.tTurn = null; this.fp = new OneEuro(2.0, 0.6); this.fs = new OneEuro(1.0, 0.3); this.fx = new OneEuro(1.0, 0.3);
    this.pp = null; this.pt = null; this.s0 = null; this.s0buf = []; this.cx0 = null; this.E = 0; this.Epk = 0; this.depthPk = 0; this.latPk = 0; this.driftMax = 0; this.sitN = 0; this.sitCross = null;
  }
  TugTracker.prototype.pushFrame = function (pRaw, size, cx, t) {
    var p = pRaw == null ? this.pp : this.fp.filter(pRaw, t), p0 = this.pp, t0 = this.pt; this.pp = p; this.pt = t;
    var s = size == null ? null : this.fs.filter(size, t), x = cx == null ? null : this.fx.filter(cx, t);
    if (p == null) return null;
    if (this.state === "waiting" && p >= 0.15) { this.state = "rising"; this.t0 = crossT(p0, t0, p, t, 0.15); return { event: "onset" }; }
    if (this.state === "rising" && p >= 0.72) { this.state = "standing"; this.s0buf = []; return { event: "stand" }; }
    if (this.state === "standing") {
      if (s != null) this.s0buf.push(s);
      if (this.s0buf.length >= 8) { var b = this.s0buf.slice().sort(function (a, c) { return a - c; }); this.s0 = b[4]; this.cx0 = x; this.state = "walkOut"; return { event: "walk" }; }
      return null;
    }
    if ((this.state === "walkOut" || this.state === "walkBack") && s != null && this.s0) {
      /* ประมาณระยะเป็นเมตร: ความยาวไหล่→ข้อเท้า ≈ 1.25 ม. และมุมรับภาพแนวตั้งของกล้องมือถือ ≈ 62°
         → ระยะจากกล้องตอนยืนที่เก้าอี้ d0 ≈ 1.04 ÷ (สัดส่วนความสูงลำตัวในภาพ) · คลาดได้ราว ±20% ตามรุ่นกล้อง */
      var d0 = 1.04 / this.s0, eD = Math.abs(d0 * (this.s0 / s - 1)), eL = x != null && this.cx0 != null ? Math.abs(x - this.cx0) / this.s0 * 1.25 : 0;
      this.E = Math.hypot(eD, eL) / 3;   /* 1.0 = เดินไปได้ราว 3 เมตร */
      if (this.E > this.Epk) this.Epk = this.E; if (eD > this.depthPk) this.depthPk = eD; if (eL > this.latPk) this.latPk = eL;
      if (eD >= eL && eL / 1.25 > this.driftMax) this.driftMax = eL / 1.25;   /* เดินแนวลึก: การเบี่ยงซ้ายขวา = ความไม่ตรงของแนวเดิน */
      if (this.state === "walkOut" && this.Epk >= 0.45 && this.E <= this.Epk * 0.85) { this.state = "walkBack"; this.tTurn = t; return { event: "turn" }; }
      if (p0 != null && p0 > 0.30 && p <= 0.30) this.sitCross = crossT(p0, t0, p, t, 0.30);
      if (p <= 0.30 && (t - this.t0) > 4000) this.sitN++; else this.sitN = 0;
      if (this.sitN >= 3 && (this.state === "walkBack" || this.E < Math.max(0.2, this.Epk * 0.4))) return this._fin(t - 2 * (t - t0));   /* ถอยกลับ 2 เฟรมที่ใช้ยืนยันว่านั่งแล้ว */
    }
    return null;
  };
  TugTracker.prototype._fin = function (tEnd) {
    this.state = "done"; var base = this.goAt != null ? this.goAt : this.t0 != null ? this.t0 : tEnd, depthWalk = this.depthPk >= this.latPk;
    return { event: "finish", elapsed: (tEnd - base) / 1000, reaction: this.goAt != null && this.t0 != null ? (this.t0 - this.goAt) / 1000 : null,
      out: this.tTurn ? (this.tTurn - base) / 1000 : null, back: this.tTurn ? (tEnd - this.tTurn) / 1000 : null,
      distanceOk: this.Epk >= 0.75, meters: Math.round(this.Epk * 30) / 10, turnSeen: this.tTurn != null, axis: depthWalk ? "depth" : "lateral", drift: depthWalk ? { max: this.driftMax } : null };
  };
  /* สั่งจบด้วยสัญญาณมือ/ปุ่ม: ถ้ากล้องเห็นว่านั่งลงแล้ว (หลังจุดกลับ ภายใน 8 วิ) ใช้เวลานั่งลงนั้น ไม่ใช่เวลาที่ยกแขน */
  TugTracker.prototype.forceEnd = function (tAt) {
    var sc = this.sitCross, useSit = sc != null && tAt - sc < 8000 && tAt >= sc && (this.tTurn == null || sc > this.tTurn);
    var r = this._fin(useSit ? sc : tAt); r.forced = true; r.sawSit = useSit; return r;
  };
  /* หน่วย: เท่าของความสูงลำตัว (ไหล่→ข้อเท้า ≈ 1.3 ม.) */
  function gaitLabel(d) { if (!d) return "วัดแนวเดินไม่ได้ในมุมนี้"; return d.max < 0.25 ? "เดินตรงดี" : d.max < 0.5 ? "เบี่ยงเล็กน้อย" : "เบี่ยงมาก ควรเฝ้าระวัง"; }

  /* ---------- ทรงตัว 4 ท่า มุมมองด้านข้าง (เท้าเป็นหลัก · หน่วย = ความยาวเท้า · กรองทุกค่า) ---------- */
  var STANCE_NM = ["เท้าชิด", "กึ่งต่อเท้า", "ต่อเท้า", "ยกขาข้างหนึ่ง"];
  function BalanceEngine(stage) {
    this.stage = stage; this.state = "search"; this.c = null; this.stillN = 0; this.lostN = 0; this.badN = 0; this.F = {};
    this.refC = null; this.refFeet = null; this.refLift = null; this.samples = []; this.liftWarned = false; this.last = null;
    this.stHist = []; this.startStance = null; this.hn = 0; this.hFeet = 0; this.dropN = 0; this.dropped = false; this.stepAt = null; this.holdT0 = null;
  }
  BalanceEngine.prototype._f = function (k, v, t, mc, b) { if (!this.F[k]) this.F[k] = new OneEuro(mc || 1.2, b == null ? 0.3 : b); return this.F[k].filter(v, t); };
  BalanceEngine.prototype._read = function (lm, t) {
    if (!lm) return null; var self = this;
    function vis(i) { return vz(lm[i]) > 0.45; }
    if (!(vis(LM.LSH) && vis(LM.RSH) && vis(LM.LHIP) && vis(LM.RHIP))) return null;
    var sh = { x: (lm[LM.LSH].x + lm[LM.RSH].x) / 2, y: midY(lm, LM.LSH, LM.RSH) }, hp = { x: (lm[LM.LHIP].x + lm[LM.RHIP].x) / 2, y: midY(lm, LM.LHIP, LM.RHIP) };
    var torso = Math.hypot(sh.x - hp.x, sh.y - hp.y); if (!isFinite(torso) || torso < 0.04) return null;
    torso = this._f("torso", torso, t, 0.8, 0.1);
    var sideOk = Math.abs(lm[LM.LSH].x - lm[LM.RSH].x) / torso < 0.5, f = null;
    if (vis(LM.LANK) && vis(LM.RANK)) {
      function foot(tag, ank, heel, toe) {
        var xs = [lm[ank].x], ys = [lm[ank].y];
        if (vis(heel)) { xs.push(lm[heel].x); ys.push(lm[heel].y); } if (vis(toe)) { xs.push(lm[toe].x); ys.push(lm[toe].y); }
        var n = xs.length, sx = 0, sy = 0; for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
        return { x: self._f(tag + "x", sx / n, t), y: self._f(tag + "y", sy / n, t) };
      }
      var Lc = foot("L", LM.LANK, LM.LHEEL, LM.LTOE), Rc = foot("R", LM.RANK, LM.RHEEL, LM.RTOE);
      var flL = vis(LM.LHEEL) && vis(LM.LTOE) ? Math.hypot(lm[LM.LTOE].x - lm[LM.LHEEL].x, lm[LM.LTOE].y - lm[LM.LHEEL].y) : null;
      var flR = vis(LM.RHEEL) && vis(LM.RTOE) ? Math.hypot(lm[LM.RTOE].x - lm[LM.RHEEL].x, lm[LM.RTOE].y - lm[LM.RHEEL].y) : null;
      var unit = flL && flR ? Math.max(flL, flR) : (flL || flR || torso * 0.55);   /* เท้าที่หันเข้ากล้องจะดูสั้น ใช้ข้างที่ยาวกว่า */
      if (!isFinite(unit) || unit < 0.02) unit = torso * 0.55; unit = this._f("unit", unit, t, 0.5, 0.05);
      f = { L: Lc, R: Rc, unit: unit, gap: Math.abs(Lc.x - Rc.x) / unit, lift: this._f("lift", Math.abs(lm[LM.LANK].y - lm[LM.RANK].y) / unit, t) };
    }
    return { c: { x: this._f("cx", (sh.x + hp.x) / 2 / torso, t), y: this._f("cy", (sh.y + hp.y) / 2 / torso, t) }, torso: torso, sideOk: sideOk, feet: f };
  };
  BalanceEngine.prototype._stance = function (f) { if (!f) return null; if (f.lift > 0.65) return 3; if (f.gap < 0.40) return 0; if (f.gap < 0.90) return 1; return 2; };
  BalanceEngine.prototype.frame = function (lm, t) {
    t = t == null ? Date.now() : t; var r = this._read(lm, t); this.last = r;
    if (!r) { this.lostN++; this.stillN = 0; return { seen: false, lost: this.lostN, ready: false, fail: this.state === "hold" && this.lostN > 60, why: "กล้องมองไม่เห็นตัวนานเกินไป" }; }
    this.lostN = 0; var prev = this.c; this.c = r.c; var mv = prev ? Math.hypot(this.c.x - prev.x, this.c.y - prev.y) : 9;
    var st = r.sideOk ? this._stance(r.feet) : null; this.stHist.push(st); if (this.stHist.length > 20) this.stHist.shift();
    var cnt = {}, best = null, bn = 0; for (var i = 0; i < this.stHist.length; i++) { var v = this.stHist[i]; if (v == null) continue; cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bn) { bn = cnt[v]; best = v; } }
    var stanceSeen = bn >= 12 ? best : null;
    if (this.state !== "hold") {
      if (mv < 0.015) this.stillN++; else this.stillN = 0;
      var ready = this.stillN >= 10; this.state = ready ? "steady" : "search";
      return { seen: true, ready: ready, stance: stanceSeen, stanceOk: stanceSeen == null ? null : stanceSeen === this.stage, sideOk: r.sideOk };
    }
    this.samples.push({ x: this.c.x, y: this.c.y }); this.hn++; if (r.feet) this.hFeet++;
    var res = { seen: true, ready: true, fail: false, why: null, dropped: false, remind: null };
    if (this.refC && (this.c.y - this.refC.y) > 0.55) this.dropN++; else this.dropN = 0;
    if (this.dropN >= 6) { this.dropped = true; res.fail = true; res.dropped = true; res.why = "กล้องเห็นว่านั่งลงหรือทรุดตัว"; return res; }
    if (r.feet && this.refFeet) {
      if (this.stage === 3) { if (this.refLift != null && this.refLift > 0.55 && r.feet.lift < Math.max(0.25, this.refLift * 0.4)) this.badN++; else this.badN = 0; res.why = "เท้าที่ยกลงแตะพื้น"; }
      else { var d = Math.max(Math.hypot(r.feet.L.x - this.refFeet.L.x, r.feet.L.y - this.refFeet.L.y), Math.hypot(r.feet.R.x - this.refFeet.R.x, r.feet.R.y - this.refFeet.R.y)) / this.refFeet.unit; if (d > 0.8) this.badN++; else this.badN = 0; res.why = "ขยับเท้าออกจากตำแหน่งเดิม"; }
    } else { this.badN = 0; res.noFeet = true; }
    if (this.badN >= 6) { res.fail = true; res.stepped = true; if (this.stepAt == null) this.stepAt = (t - this.holdT0) / 1000; }
    if (this.stage === 3 && r.feet && !this.liftWarned && this.samples.length > 40 && r.feet.lift < 0.45) { this.liftWarned = true; res.remind = "อย่าลืมยกเท้าข้างหนึ่งขึ้นจากพื้น"; }
    return res;
  };
  BalanceEngine.prototype.beginHold = function (t) {
    this.state = "hold"; this.samples = []; this.badN = 0; this.lostN = 0; this.holdT0 = t == null ? Date.now() : t; var r = this.last;
    this.refC = r ? r.c : this.c; this.refFeet = r && r.feet ? { L: { x: r.feet.L.x, y: r.feet.L.y }, R: { x: r.feet.R.x, y: r.feet.R.y }, unit: r.feet.unit } : null;
    this.refLift = r && r.feet ? r.feet.lift : null; this.startStance = r && r.sideOk ? this._stance(r.feet) : null;
  };
  BalanceEngine.prototype.observe = function () {
    var feetRatio = this.hn ? this.hFeet / this.hn : 0, obs = [], suggest = "pass";
    if (this.dropped) { obs.push("เห็นว่านั่งลงหรือทรุดตัวระหว่างทดสอบ"); suggest = "fail"; }
    if (this.stepAt != null) { obs.push("เห็นการขยับเท้าที่ประมาณวินาทีที่ " + this.stepAt.toFixed(1)); suggest = "fail"; }
    if (this.lostN > 30) { obs.push("หลุดออกนอกกรอบภาพบางช่วง"); suggest = "unsure"; }
    if (feetRatio < 0.5) { obs.push("กล้องมองไม่เห็นเท้าชัดตลอดการทดสอบ"); if (suggest === "pass") suggest = "unsure"; }
    if (!obs.length) obs.push("ไม่พบการขยับเท้าและไม่พบการทรุดตัว");
    return { obs: obs, suggest: suggest, feetSeen: Math.round(feetRatio * 100) };
  };

  /* ---------- คุณภาพการวัด: เฟรม/วินาที และความชัดของตัว ---------- */
  function Quality() { this.n = 0; this.t0 = null; this.t1 = null; this.vis = 0; this.miss = 0; }
  Quality.prototype.add = function (t, q) { if (this.t0 == null) this.t0 = t; this.t1 = t; this.n++; if (q == null) this.miss++; else this.vis += q; };
  Quality.prototype.report = function () {
    var dur = (this.t1 - this.t0) / 1000, fps = dur > 0.5 ? (this.n - 1) / dur : null, seen = this.n - this.miss, vis = seen ? this.vis / seen : 0, missPct = this.n ? this.miss / this.n : 1;
    var level = fps != null && fps >= 15 && vis >= 0.85 && missPct < 0.05 ? "สูง" : fps != null && fps >= 10 && vis >= 0.7 && missPct < 0.15 ? "ปานกลาง" : "ต่ำ";
    return { fps: fps == null ? null : Math.round(fps), vis: Math.round(vis * 100), missPct: Math.round(missPct * 100), level: level, engine: ENGINE, model: POSE ? POSE.modelLevel : null };
  };
  function qualityText(q) { return "ความน่าเชื่อถือ" + q.level + " (" + (q.fps == null ? "–" : q.fps) + " เฟรม/วิ · เห็นตัว " + q.vis + "%)"; }

  /* ---------- โมเดล: เริ่มที่รุ่นที่เหมาะกับเครื่อง แล้วทดสอบความเร็วจริงก่อนวัด ---------- */
  var LASTD = null, POSE = null, MOD = null, FILESET = null, POSE_COUNT = 0, DERR = 0, SWAPPING = false;
  var LEVELS = [
    { k: "heavy", nm: "ละเอียดสูงสุด", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task" },
    { k: "full", nm: "ละเอียดสูง", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task" },
    { k: "lite", nm: "เร็ว", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" }];
  /* numPoses 1: โมเดลติดตามคนเดิมต่อเนื่อง (ใส่ 2 ทำให้ตัวค้นหาคนทำงานทุกเฟรม ช้าและกระตุก) */
  async function createLevel(i, say, only) {
    var L = LEVELS[i]; if (say) say("กำลังโหลดโมเดล" + L.nm + "…");
    var dels = only ? [only] : ["GPU", "CPU"];
    for (var d = 0; d < dels.length; d++) {
      try {
        var p = await MOD.PoseLandmarker.createFromOptions(FILESET, { baseOptions: { modelAssetPath: L.u, delegate: dels[d] }, runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: .4, minPosePresenceConfidence: .4, minTrackingConfidence: .4 });
        p.modelLevel = L.k; p.levelIx = i; p.delegate = dels[d]; return p;
      } catch (e) {}
    }
    return null;
  }
  async function loadModel(say) {
    if (POSE) return POSE;
    if (!MOD) { MOD = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14"); FILESET = await MOD.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"); }
    var coarse = false; try { coarse = matchMedia("(pointer:coarse)").matches; } catch (e) {}
    var start = coarse ? 1 : 0, only = null;
    try { var si = LEVELS.findIndex(function (l) { return l.k === localStorage.getItem("cs-pose-model3"); }); if (si >= 0) start = si; only = localStorage.getItem("cs-pose-del3") === "CPU" ? "CPU" : null; } catch (e) {}
    for (var i = start; i < LEVELS.length; i++) { POSE = await createLevel(i, say, only); if (POSE) return POSE; }
    throw new Error("model-load-failed");
  }
  function waitVideo(video, ms) {
    return new Promise(function (res) { var t0 = Date.now(); (function chk() { if (video.readyState >= 2 && video.videoWidth > 0) return res(true); if (Date.now() - t0 > ms) return res(false); setTimeout(chk, 50); })(); });
  }
  /* สลับไปใช้ CPU เมื่อ GPU ของเครื่องนั้นประมวลผลไม่ได้ (บางรุ่นสร้างได้แต่ตรวจจับแล้วพัง) */
  async function toCpu(say) {
    if (SWAPPING || !POSE || POSE.delegate === "CPU") return false; SWAPPING = true;
    try { var p = await createLevel(Math.max(POSE.levelIx, 1), say, "CPU"); if (p) { try { POSE.close(); } catch (e) {} POSE = p; DERR = 0; try { localStorage.setItem("cs-pose-del3", "CPU"); } catch (e) {} return true; } }
    finally { SWAPPING = false; }
    return false;
  }
  /* วัดเวลาประมวลผลจริง ถ้าเกิน ~70 มิลลิวินาทีต่อเฟรม ลดรุ่นทันที · ถ้าตรวจจับพังทุกเฟรม สลับไป CPU */
  async function tuneModel(video, say) {
    await waitVideo(video, 4000);
    for (var round = 0; round < 3; round++) {
      var sum = 0, n = 0, errs = 0;
      for (var i = 0; i < 12; i++) {
        await new Promise(function (r) { setTimeout(r, 30); });
        var t = mono(); try { POSE.detectForVideo(video, t); } catch (e) { errs++; continue; }
        if (i >= 2) { sum += performance.now() - t; n++; }
      }
      if (errs >= 8) { if (await toCpu(say)) continue; break; }
      var avg = n ? sum / n : 0;
      if (avg <= 70 || POSE.levelIx >= LEVELS.length - 1) break;
      if (say) say("เครื่องนี้ประมวลผลช้า กำลังสลับเป็นโมเดลที่เร็วกว่า…");
      var next = await createLevel(POSE.levelIx + 1, say, POSE.delegate); if (!next) break;
      try { POSE.close(); } catch (e) {} POSE = next;
    }
    try { localStorage.setItem("cs-pose-model3", POSE.modelLevel); } catch (e) {}
  }
  function detectPose(video, t) {
    if (!POSE || SWAPPING) return null; var r = null;
    try { r = POSE.detectForVideo(video, t); DERR = 0; }
    catch (e) { POSE_COUNT = 0; if (++DERR === 12) toCpu(); return null; }
    var L = r && r.landmarks ? r.landmarks : []; POSE_COUNT = L.length; if (!L.length) return null;
    LASTD = { lm: L[0], wl: r.worldLandmarks ? r.worldLandmarks[0] : null }; return LASTD;
  }
  function drawPose(ctx, canvas, video, lm) {
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    ctx.clearRect(0, 0, canvas.width, canvas.height); if (!lm) return;
    var pairs = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 31], [28, 32], [11, 13], [13, 15], [12, 14], [14, 16]];
    ctx.lineWidth = Math.max(3, canvas.width / 150); ctx.strokeStyle = "rgba(23,179,161,.9)"; ctx.lineCap = "round";
    pairs.forEach(function (p) { var a = lm[p[0]], b = lm[p[1]]; if (!a || !b || vz(a) < 0.4 || vz(b) < 0.4) return; ctx.beginPath(); ctx.moveTo(a.x * canvas.width, a.y * canvas.height); ctx.lineTo(b.x * canvas.width, b.y * canvas.height); ctx.stroke(); });
    [11, 12, 15, 16, 23, 24, 25, 26, 27, 28].forEach(function (i) { var p = lm[i]; if (!p) return; ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(4, canvas.width / 110), 0, 6.3); ctx.fillStyle = vz(p) < 0.5 ? "#F87171" : (i === 25 || i === 26) ? "#FCD34D" : (i === 15 || i === 16) ? "#F9A8D4" : "#DBEAFE"; ctx.fill(); });
  }

  /* ---------- เสียงบอกขั้นตอน (ปิดได้) ---------- */
  function ttsOn() { try { return localStorage.getItem("cs3:tts") !== "off"; } catch (e) { return true; } }
  function speak(t) {
    if (!ttsOn() || !("speechSynthesis" in window) || !t) return;
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t); u.lang = "th-TH"; u.rate = 0.95; speechSynthesis.speak(u); } catch (e) {}
  }

  /* ---------- หน้าจอกล้อง ---------- */
  var CSS = [
    ".cscam{position:absolute;inset:0;z-index:60;background:#0B1220;color:#fff;display:flex;flex-direction:column;font-family:inherit}",
    ".cscam .st{position:relative;flex:1;min-height:0;background:#000;overflow:hidden}",
    ".cscam video,.cscam canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}",
    ".cscam.mirror video,.cscam.mirror canvas{transform:scaleX(-1)}",
    ".cscam canvas{pointer-events:none}",
    ".cscam .top{position:absolute;left:10px;right:10px;top:calc(env(safe-area-inset-top) + 10px);display:flex;justify-content:space-between;gap:8px;pointer-events:none}",
    ".cscam .tag{background:rgba(11,18,32,.65);backdrop-filter:blur(8px);border-radius:99px;padding:6px 12px;font-size:13px;line-height:1.4}",
    ".cscam .top button{pointer-events:auto;border:0;background:rgba(11,18,32,.65);color:#fff;border-radius:99px;padding:6px 12px;font:inherit;font-size:13px}",
    ".cscam .dock{flex:none;background:#0F1B33;padding:10px 14px calc(env(safe-area-inset-bottom) + 10px);display:flex;flex-direction:column;gap:8px}",
    ".cscam .cnt{display:flex;align-items:baseline;gap:8px}.cscam .cnt b{font-size:40px;line-height:1;font-variant-numeric:tabular-nums}.cscam .cnt span{color:rgba(255,255,255,.65);font-size:14px}.cscam .cnt .clk{margin-left:auto;font-size:26px;color:#FCD34D;font-variant-numeric:tabular-nums}",
    ".cscam .trk{height:5px;background:rgba(255,255,255,.18);border-radius:99px;overflow:hidden}.cscam .trk i{display:block;height:100%;width:0;background:#FCD34D;transition:width .12s linear}",
    ".cscam .chips{display:flex;gap:6px}.cscam .chips span{flex:1;text-align:center;font-size:11.5px;font-weight:700;padding:4px 0;border-radius:9px;background:rgba(255,255,255,.12)}.cscam .chips span.on{background:#F59E0B;color:#1a1300}.cscam .chips span.ok{background:#0E9F6E}.cscam .chips span.bad{background:#DC2626}",
    ".cscam .coach{font-size:14.5px;line-height:1.5;min-height:22px}",
    ".cscam .stat{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.08);border-radius:14px;padding:8px 12px;font-size:14px;font-weight:600;line-height:1.4}.cscam .stat i{width:18px;height:18px;border-radius:50%;flex:none;background:#F5B93E}",
    ".cscam .obs{background:rgba(255,255,255,.08);border-radius:12px;padding:8px 12px;font-size:12.5px;line-height:1.55}",
    ".cscam .btns{display:flex;flex-direction:column;gap:6px}.cscam .btns button{border:0;border-radius:14px;padding:13px;font:inherit;font-size:16px;font-weight:700;cursor:pointer;background:#17B3A1;color:#fff}.cscam .btns button.sec{background:rgba(255,255,255,.12)}.cscam .btns button.no{background:rgba(220,38,38,.85)}.cscam .btns button:disabled{opacity:.45}",
    ".cscam .row{display:flex;gap:6px}.cscam .row button{flex:1}",
    ".cscam .foot{font-size:11.5px;color:rgba(255,255,255,.6);text-align:center;line-height:1.45}.cscam .foot a{color:#9FE3DA;cursor:pointer;text-decoration:underline}",
    ".cscam .gest{display:flex;gap:5px}.cscam .gest[hidden]{display:none}.cscam .gest span{flex:1;text-align:center;font-size:11px;font-weight:700;padding:5px 2px;border-radius:9px;line-height:1.3;background:linear-gradient(90deg,#17B3A1 var(--p,0%),rgba(255,255,255,.14) var(--p,0%))}.cscam .gest span.act{outline:2px solid #FCD34D}.cscam .gest span.dim{opacity:.35}",
    ".cscam .meter{display:flex;align-items:center;gap:10px;font-size:12.5px;font-weight:700;color:rgba(255,255,255,.75)}.cscam .meter[hidden]{display:none}",
    ".cscam .mb{position:relative;flex:1;height:12px;border-radius:99px;background:linear-gradient(90deg,rgba(96,165,250,.45),rgba(252,211,77,.45))}.cscam .mb .th{position:absolute;top:-3px;bottom:-3px;width:2px;background:rgba(255,255,255,.55)}",
    ".cscam .mb b{position:absolute;top:50%;left:0;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(23,179,161,.9);transition:left .08s linear}.cscam .mb b.off{background:#64748B;box-shadow:none;left:50%!important}"
  ].join("\n");
  function injectCSS() { if (document.getElementById("cscamCSS")) return; var s = document.createElement("style"); s.id = "cscamCSS"; s.textContent = CSS; document.head.appendChild(s); }

  var UI = null, LOOP = null, STREAM = null, FACING = "environment", CD = null;
  function $(id) { return UI ? UI.querySelector("#" + id) : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function status(color, text) { var l = $("csL"), t = $("csT"); if (l) l.style.background = { green: "#0E9F6E", yellow: "#F5B93E", red: "#DC2626" }[color] || "#F5B93E"; if (t) t.textContent = text; }
  function coach(html) { var c = $("csC"); if (c) c.innerHTML = html; }
  function buttons(list) {
    var b = $("csB"); if (!b) return; b.innerHTML = "";
    list.forEach(function (x) { var e = document.createElement("button"); e.textContent = x.t; if (x.cls) e.className = x.cls; e.disabled = !!x.dis; if (x.id) e.id = x.id; e.addEventListener("click", x.fn); b.appendChild(e); });
  }
  function cdCancel() { if (CD) { clearInterval(CD); CD = null; } }
  function countdown(text, fire) {
    cdCancel(); var n = 3, W = { 3: "สาม", 2: "สอง", 1: "หนึ่ง" };
    status("green", text + " — เตรียมตัว " + n); speak(text + " เตรียมตัว สาม");
    CD = setInterval(function () { n--; if (n >= 1) { status("green", "เตรียมตัว… " + n); speak(W[n]); } else { cdCancel(); status("green", "เริ่ม"); speak("เริ่ม"); fire(); } }, 1000);
  }
  /* วนตามเฟรมวิดีโอ: ลงทะเบียนเฟรมถัดไปก่อนประมวลผล (ข้อผิดพลาดในเฟรมหนึ่งไม่ทำให้ระบบหยุด)
     เวลาทุกเฟรมมาจาก mono() ตัวเดียว · ตัวเฝ้าระวังปลุกวิดีโอที่ถูกหยุด และสลับวิธีวนถ้าเฟรมไม่มา */
  var FPS = 0, LAST_FR = 0;
  function startLoop(video, fn) {
    stopLoop(); var alive = { on: true, last: mono(), mode: video.requestVideoFrameCallback ? "rvfc" : "raf" }, lastCT = -1; LOOP = alive; FPS = 0; LAST_FR = 0;
    function tick() {
      if (!alive.on || !UI || video.readyState < 2 || !video.videoWidth) return;
      var t = mono(); if (LAST_FR) { var dt = t - LAST_FR; if (dt > 0 && dt < 1000) FPS = FPS ? FPS * 0.9 + 100 / dt : 1000 / dt; } LAST_FR = t; alive.last = t;
      try { fn(t); } catch (e) { try { console.warn("cs-camera", e); } catch (x) {} }
    }
    function step() { if (!alive.on || !UI) return; if (alive.mode === "rvfc") video.requestVideoFrameCallback(step); tick(); }
    function raf() { if (!alive.on || !UI || alive.mode !== "raf") return; requestAnimationFrame(raf); if (video.currentTime !== lastCT || video.currentTime === 0) { lastCT = video.currentTime; tick(); } }
    if (alive.mode === "rvfc") video.requestVideoFrameCallback(step); else requestAnimationFrame(raf);
    alive.wd = setInterval(function () {
      if (!alive.on || !UI) { clearInterval(alive.wd); return; }
      if (video.paused) { var pr = video.play(); if (pr && pr.catch) pr.catch(function () {}); }
      if (mono() - alive.last > 1500 && alive.mode === "rvfc") { alive.mode = "raf"; requestAnimationFrame(raf); }
    }, 1000);
  }
  function stopLoop() { if (LOOP) { LOOP.on = false; clearInterval(LOOP.wd); } LOOP = null; }
  function close() {
    cdCancel(); stopLoop();
    if (STREAM) { STREAM.getTracks().forEach(function (t) { t.stop(); }); STREAM = null; }
    try { speechSynthesis.cancel(); } catch (e) {}
    if (UI) UI.remove(); UI = null;
  }
  function aspectOf(video) { return video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 0.5625; }
  /* แถบสด นั่ง ↔ ยืน และสถานะการมองเห็น — ให้ผู้วัดรู้ทันทีว่ากล้องจับท่าได้ */
  function live(lm, f, p, extra) {
    var pb = $("csPB"), tag = $("csTag");
    if (pb) { if (p == null) pb.className = "off"; else { pb.className = ""; pb.style.left = (clamp(p, 0, 1) * 100) + "%"; } }
    if (!tag) return;
    var fps = Math.round(FPS) + " เฟรม/วิ";
    if (DERR >= 3) tag.textContent = "ระบบตรวจจับขัดข้อง กำลังสลับโหมด… · " + fps;
    else if (!lm) tag.textContent = "ไม่พบคนในภาพ · " + fps;
    else if (!f || (f.v == null && f.k == null && f.h == null)) tag.textContent = "ยังไม่เห็นเข่า · " + fps;
    else tag.textContent = (extra ? extra + " · " : "✓ จับท่าได้ · ") + fps + (f.k != null ? " · เข่า " + Math.round(f.k) + "°" : "");
  }
  function meter(on) { var m = $("csMeter"); if (m) m.hidden = !on; }
  async function getStream() {
    var sets = [{ facingMode: { ideal: FACING }, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } }, { facingMode: { ideal: FACING } }, {}], err = null;
    for (var i = 0; i < sets.length; i++) {
      try { return await navigator.mediaDevices.getUserMedia({ video: sets[i], audio: false }); }
      catch (e) { err = e; if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) break; }
    }
    throw err;
  }

  async function open(opts) {
    close(); injectCSS();
    var host = document.querySelector(".phone") || document.body;
    UI = document.createElement("div"); UI.className = "cscam" + (FACING === "user" ? " mirror" : "");
    var KIND_NM = { ftsst: "ลุกนั่ง 5 ครั้ง", tug: "ลุกเดิน 3 เมตร", balance: "ทรงตัว 4 ท่า" };
    UI.innerHTML = '<div class="st"><video id="csV" playsinline muted autoplay></video><canvas id="csK"></canvas>' +
      '<div class="top"><span class="tag" id="csTag">กำลังเปิดกล้อง…</span><button id="csFlip">🔄 สลับกล้อง</button></div></div>' +
      '<div class="dock"><div class="cnt" id="csCnt"><b id="csN">0</b><span id="csOf"></span><span class="clk" id="csClk"></span></div>' +
      '<div class="meter" id="csMeter" hidden><span>นั่ง</span><div class="mb"><i class="th" style="left:30%"></i><i class="th" style="left:72%"></i><b id="csPB" class="off"></b></div><span>ยืน</span></div>' +
      '<div class="gest" id="csG" hidden></div><div class="trk" id="csTrkW" hidden><i id="csTrk"></i></div><div class="chips" id="csChips" hidden></div>' +
      '<div class="coach" id="csC">' + esc(KIND_NM[opts.kind]) + '</div><div class="stat"><i id="csL"></i><span id="csT">กำลังเตรียมระบบ…</span></div>' +
      '<div class="obs" id="csObs" hidden></div><div class="btns" id="csB"></div>' +
      '<div class="foot">ภาพประมวลผลในเครื่องนี้ ไม่อัปโหลดภาพหรือวิดีโอ · <a id="csMan">จับเวลาเองแทน</a> · <a id="csX">ยกเลิก</a></div></div>';
    host.appendChild(UI);
    $("csMan").addEventListener("click", function () { close(); if (opts.onManual) opts.onManual(); });
    $("csX").addEventListener("click", function () { close(); if (opts.onCancel) opts.onCancel(); });
    $("csFlip").addEventListener("click", function () { FACING = FACING === "user" ? "environment" : "user"; close(); open(opts); });
    var video = $("csV"), canvas = $("csK"), ctx = canvas.getContext("2d"), tag = $("csTag");
    var toManual = [{ t: "จับเวลาเองแทน", fn: function () { close(); if (opts.onManual) opts.onManual(); } }];
    status("yellow", "กำลังเปิดกล้อง กรุณารอสักครู่");
    try { STREAM = await getStream(); }
    catch (e) {
      if (!UI) return;
      var denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      if (!denied && FACING !== "user") { FACING = "user"; close(); return open(opts); }
      tag.textContent = "เปิดกล้องไม่ได้"; status("red", denied ? "ยังไม่ได้อนุญาตให้ใช้กล้อง — กดอนุญาตในเบราว์เซอร์ แล้วเปิดใหม่ หรือจับเวลาเองแทน" : "เปิดกล้องไม่ได้ — จับเวลาเองแทน"); buttons(toManual); return;
    }
    if (!UI) { STREAM.getTracks().forEach(function (t) { t.stop(); }); STREAM = null; return; }
    video.srcObject = STREAM;
    await Promise.race([video.play().catch(function () {}), new Promise(function (r) { setTimeout(r, 1500); })]);
    status("yellow", "กำลังโหลดระบบตรวจจับท่าทาง (ครั้งแรกใช้เน็ต)");
    try { await loadModel(function (t) { if (UI) tag.textContent = t; }); if (UI) { status("yellow", "กำลังทดสอบความเร็วของเครื่อง…"); await tuneModel(video, function (t) { if (UI) tag.textContent = t; }); } }
    catch (e) { if (!UI) return; tag.textContent = "โหลดโมเดลไม่สำเร็จ"; status("red", "โหลดระบบไม่สำเร็จ — ต้องต่ออินเทอร์เน็ตครั้งแรก หรือจับเวลาเองแทน"); buttons(toManual); return; }
    if (!UI) return;
    tag.textContent = "พร้อม · โมเดล" + (LEVELS[POSE.levelIx] || {}).nm + (POSE.delegate === "CPU" ? " (CPU)" : "");
    var fin = function (res) { close(); opts.onDone(res); };
    if (opts.kind === "balance") return runBalance(video, canvas, ctx, opts, fin);
    var prior = opts.refs && opts.refs.engine === ENGINE ? opts.refs : null;
    if (opts.kind === "ftsst") runFtsst(video, canvas, ctx, prior, fin); else runTug(video, canvas, ctx, prior, fin);
  }

  /* แถบสัญญาณมือ: ไฮไลต์ท่าที่ใช้ได้ในขั้นนี้ และเติมแถบตามเวลาที่ค้างท่า */
  var G_ICON = { both: "🙌 สองมือ = เริ่ม", side: "🫲 กางแขน = สิ้นสุด", one: "✋ มือเดียว = บันทึก" };
  function gestBar(allowed, gs) {
    var el = $("csG"); if (!el) return; el.hidden = false;
    if (!el.firstChild) el.innerHTML = ["both", "side", "one"].map(function (k) { return '<span data-g="' + k + '">' + G_ICON[k] + "</span>"; }).join("");
    Array.prototype.forEach.call(el.children, function (s) {
      var k = s.getAttribute("data-g"), ok = allowed.indexOf(k) >= 0, act = ok && gs && gs.g === k;
      s.className = ok ? (act ? "act" : "") : "dim"; s.style.setProperty("--p", act ? Math.round(Math.min(1, gs.progress) * 100) + "%" : "0%");
    });
  }
  function gestOf(G, d, asp, t, allow) { var lm = d && d.lm, wl = d && d.wl; return G.push(armPose(lm, wl, "L", asp), armPose(lm, wl, "R", asp), t, allow); }
  function resetDock() { var o = $("csObs"); if (o) { o.hidden = true; o.innerHTML = ""; } $("csN").textContent = "0"; $("csClk").textContent = ""; $("csTrk").style.width = "0%"; }

  function runFtsst(video, canvas, ctx, prior, done) {
    var PO = new Posture(prior), DET = new RepDetector({ target: 5 }), Q = new Quality(), G = new Gestures(), phase = "idle", tGo = 0, lastEvt = 0, stall = false, result = null;
    resetDock(); $("csOf").textContent = "/ 5 ครั้ง"; $("csTrkW").hidden = false; meter(true);
    coach("ถือมือถือให้นิ่ง ห่าง 2–3 เมตร มุมเฉียงด้านข้าง ให้เห็น<b>ไหล่ สะโพก เข่า และมือ</b><br>ผู้สูงอายุนั่ง แล้ว<b>ยกสองมือ</b>เพื่อเริ่ม · ได้ยิน 3-2-1 ให้กอดอก ลุกนั่ง 5 ครั้ง · <b>กางแขนออกด้านข้าง</b> = สิ้นสุด");
    speak("ทดสอบลุกนั่ง ห้าครั้ง ให้ผู้สูงอายุนั่ง แล้วยกสองมือเพื่อเริ่ม");
    function manual() { close(); done({ kind: "ftsst", manual: true }); }
    function btns() {
      if (phase === "idle") buttons([{ t: "▶ เริ่ม (นับ 3-2-1)", fn: arm }]);
      else if (phase === "arming") buttons([]);
      else if (phase === "running") buttons([{ t: "■ สิ้นสุดการปฏิบัติ", cls: "no", fn: function () { endNow(mono(), "human"); } }, { t: "นับไม่ขึ้น · จับเวลาเองแทน", cls: "sec", fn: manual }]);
      else buttons((result.incomplete ? [] : [{ t: "✓ บันทึก " + result.sec.toFixed(1) + " วินาที", fn: save }]).concat([{ t: "↺ วัดใหม่", cls: "sec", fn: redo }, { t: "กลับไปตรวจในแอปก่อน", cls: "sec", fn: function () { stopLoop(); done(result); } }]));
    }
    function arm() { if (phase !== "idle") return; phase = "arming"; btns(); countdown("พร้อมแล้ว กอดอก", begin); }
    function begin() {
      phase = "running"; var seated = PO.arm(); tGo = mono(); lastEvt = tGo; DET.start(tGo);
      status("green", seated === false ? "เริ่ม — (กล้องเห็นว่ายังไม่นั่งเต็มที่ นั่งให้สุดก่อนลุก)" : "เริ่ม — ลุกนั่งต่อเนื่อง 5 ครั้ง");
      coach("ลุกยืนให้ตัวตรง แล้วนั่งลงให้ก้นแตะเก้าอี้ ทำต่อเนื่อง · ระบบหยุดเองเมื่อนั่งลงครั้งที่ 5 · ต้องการหยุดก่อน: <b>กางแขนออกด้านข้าง</b>"); btns();
    }
    /* สั่งจบ: ครบ 5 ครั้งแล้วแต่กล้องไม่เห็นตอนนั่ง → ใช้เวลาตอนเริ่มยกแขน · ยังไม่ครบ → ทำไม่ครบ (ไม่ให้บันทึกเป็นเวลา) */
    function endNow(tAt, by) {
      if (phase !== "running") return;
      var ev = DET.reps >= 5 ? DET._fin(tAt, false) : { event: "finish", reps: DET.reps, elapsed: (tAt - tGo) / 1000, reaction: null, endedStanding: false, incomplete: true };
      speak(by === "gesture" ? "สิ้นสุดการปฏิบัติ" : ""); finish(ev, by);
    }
    function save() { if (!result || result.incomplete) return; stopLoop(); speak("บันทึกผลแล้ว"); done(Object.assign({}, result, { save: true })); }
    function redo() { runFtsst(video, canvas, ctx, PO.learned(), done); }
    btns();
    startLoop(video, function (t) {
      var d = detectPose(video, t), lm = d && d.lm, asp = aspectOf(video); drawPose(ctx, canvas, video, lm);
      var allow = phase === "idle" ? ["both"] : phase === "running" ? ["side"] : phase === "result" && !result.incomplete ? ["one"] : [];
      var f = lm ? features(lm, d.wl, asp) : null, p = PO.push(f, t), gs = gestOf(G, d, asp, t, allow); live(lm, f, p); gestBar(allow, gs);
      if (phase === "idle") {
        if (gs && gs.fire === "both") { speak("เห็นสัญญาณเริ่ม"); return arm(); }
        if (gs && gs.g === "both") status("green", "เห็นยกสองมือ… ค้างไว้");
        else if (p == null) status("yellow", lm ? "เห็นตัวไม่พอ — ให้เห็นไหล่ สะโพก และเข่า" : "ยังไม่พบคนในภาพ — หันกล้องไปที่ผู้สูงอายุ");
        else if (p < 0.35) status("green", "เห็นท่านั่งแล้ว — ยกสองมือเพื่อเริ่ม หรือกดปุ่มเริ่ม");
        else status("yellow", "ให้ผู้สูงอายุนั่งลงบนเก้าอี้ก่อน (หรือกดเริ่มถ้านั่งอยู่แล้ว)");
      } else if (phase === "running") {
        if (gs && gs.fire === "side") return endNow(gs.at, "gesture");
        Q.add(t, lm ? visCore(lm) : null); var ev = DET.push(p, t);
        $("csN").textContent = DET.reps; $("csTrk").style.width = (Math.min(DET.reps, 5) / 5 * 100) + "%"; $("csClk").textContent = ((t - tGo) / 1000).toFixed(1) + " วิ";
        if (ev && (ev.event === "rep" || ev.event === "down")) { lastEvt = t; stall = false; }
        if (ev && ev.event === "rep") { status("green", ev.reps >= 5 ? "ยืนครบ 5 ครั้ง — นั่งลงให้เรียบร้อย" : "นับได้ " + ev.reps + " จาก 5 ครั้ง"); speak(["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า นั่งลง"][ev.reps]); }
        if (ev && ev.event === "finish") return finish(ev, "camera");
        if (gs && gs.g === "side") status("yellow", "เห็นกางแขน… ค้างไว้เพื่อสิ้นสุด");
        else if (t - lastEvt > 15000 && !stall) { stall = true; status("red", p == null ? "กล้องมองไม่เห็นสะโพก/เข่า ขยับมือถือให้เห็นช่วงล่าง หรือกดจับเวลาเอง" : "ระบบนับไม่ขึ้น ลุกให้ตัวตรง นั่งให้สุด หรือกางแขนเพื่อสิ้นสุด"); }
      } else if (phase === "result") {
        if (gs && gs.fire === "one" && !result.incomplete) return save();
      }
    });
    function finish(ev, by) {
      var gaps = []; for (var i = 1; i < DET.stamps.length; i++) gaps.push(Math.round((DET.stamps[i] - DET.stamps[i - 1]) / 100) / 10);
      var cv = null; if (gaps.length > 1) { var m = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length, sd = Math.sqrt(gaps.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / gaps.length); cv = m > 0 ? Math.round(sd / m * 100) / 100 : null; }
      var sec = Math.round(ev.elapsed * 10) / 10, ql = Q.report();
      result = { kind: "ftsst", sec: sec, reps: DET.reps, gaps: gaps, cv: cv, reaction: ev.reaction != null ? Math.round(ev.reaction * 10) / 10 : null, endedStanding: ev.endedStanding, endedBy: by, incomplete: !!ev.incomplete, quality: ql, refs: PO.learned() };
      phase = "result"; $("csClk").textContent = sec.toFixed(1) + " วิ"; $("csN").textContent = DET.reps;
      if (result.incomplete) {
        status("yellow", "หยุดก่อนครบ 5 ครั้ง (นับได้ " + DET.reps + " ครั้ง)"); speak("หยุดก่อนครบห้าครั้ง");
        coach("ตามเกณฑ์ ถ้าลุกนั่งไม่ครบ 5 ครั้ง ถือว่า<b>ทำไม่ครบ</b> ไม่บันทึกเป็นเวลา · วัดใหม่ หรือกลับไปแอปแล้วเลือก “ข้ามท่านี้ (ทำไม่ได้)”");
      } else {
        status(ql.level === "ต่ำ" ? "yellow" : "green", "ครบ 5 ครั้ง " + sec.toFixed(1) + " วินาที · " + qualityText(ql) + (ev.endedStanding ? " · ไม่เห็นตอนนั่งลงครั้งสุดท้าย" : "") + (by === "gesture" ? " · สิ้นสุดด้วยสัญญาณมือ" : ""));
        speak("ครบห้าครั้ง ใช้เวลา " + Math.round(sec) + " วินาที ยกมือข้างเดียวเพื่อบันทึก");
        coach("<b>ยกมือข้างเดียว</b>ค้างไว้เพื่อบันทึก หรือกดปุ่มด้านล่าง");
      }
      btns();
    }
  }

  function runTug(video, canvas, ctx, prior, done) {
    var PO = new Posture(prior), G = new Gestures(), phase = "idle", TUG = null, Q = new Quality(), result = null;
    resetDock(); $("csOf").textContent = "วินาที"; $("csN").textContent = "0.0"; meter(true);
    coach("<b>เตรียม:</b> ทำจุดหมายห่างเก้าอี้ 3 เมตร · ถือมือถือให้นิ่ง เห็นทั้งเก้าอี้และทางเดิน<br>ผู้สูงอายุนั่งพิงพนัก <b>ยกสองมือ</b>เพื่อเริ่ม → ได้ยิน “เริ่ม” ลุก เดินไปจุดหมาย หมุนกลับ มานั่งลง · <b>กางแขนออกด้านข้าง</b> = สิ้นสุด");
    speak("ลุกเดินสามเมตร ให้ผู้สูงอายุนั่งพิงพนัก แล้วยกสองมือเพื่อเริ่ม");
    function btns() {
      if (phase === "idle") buttons([{ t: "▶ เริ่ม (นับ 3-2-1)", fn: arm }]);
      else if (phase === "arming") buttons([]);
      else if (phase === "active") buttons([{ t: "■ สิ้นสุดการปฏิบัติ", cls: "no", fn: function () { endNow(mono(), "human"); } }, { t: "ระบบไม่หยุด · จับเวลาเองแทน", cls: "sec", fn: function () { close(); done({ kind: "tug", manual: true }); } }]);
      else buttons([{ t: "✓ บันทึก " + result.sec.toFixed(1) + " วินาที", fn: save }, { t: "↺ วัดใหม่", cls: "sec", fn: redo }, { t: "กลับไปตรวจในแอปก่อน", cls: "sec", fn: function () { stopLoop(); done(result); } }]);
    }
    function arm() { if (phase !== "idle") return; phase = "arming"; btns(); countdown("พร้อมทดสอบ", begin); }
    function begin() { phase = "active"; PO.arm(); TUG = new TugTracker(); TUG.goAt = mono(); status("green", "เริ่ม — ลุกขึ้น เดินไปจุดหมาย หมุนกลับ มานั่งลง"); coach("ลุกขึ้น → เดินไปจุดหมาย → หมุนกลับ → นั่งลงพิงพนัก · ระบบหยุดเองเมื่อนั่งลง หรือ<b>กางแขนออกด้านข้าง</b>เพื่อสิ้นสุด"); btns(); }
    function endNow(tAt, by) { if (phase !== "active") return; if (by === "gesture") speak("สิ้นสุดการปฏิบัติ"); finish(TUG.forceEnd(tAt), by); }
    /* ระยะเดินอาจไม่ครบ: ไม่รับการบันทึกด้วยสัญญาณมือ ให้ลูกหลานดูแล้วกดเอง */
    function gestSaveOk() { return result && result.distanceOk; }
    function save() { if (!result) return; stopLoop(); speak("บันทึกผลแล้ว"); done(Object.assign({}, result, { save: true })); }
    function redo() { runTug(video, canvas, ctx, PO.learned(), done); }
    btns();
    startLoop(video, function (t) {
      var d = detectPose(video, t), lm = d && d.lm; drawPose(ctx, canvas, video, lm);
      var allow = phase === "idle" ? ["both"] : phase === "active" ? ["side"] : phase === "result" && gestSaveOk() ? ["one"] : [];
      var asp = aspectOf(video), f = lm ? features(lm, d.wl, asp) : null, p = PO.push(f, t), gs = gestOf(G, d, asp, t, allow); gestBar(allow, gs);
      if (phase === "idle") {
        live(lm, f, p);
        if (gs && gs.fire === "both") { speak("เห็นสัญญาณเริ่ม"); return arm(); }
        if (gs && gs.g === "both") status("green", "เห็นยกสองมือ… ค้างไว้");
        else if (p != null && p < 0.35) status("green", "เห็นว่านั่งอยู่แล้ว — ยกสองมือเพื่อเริ่ม หรือกดปุ่มเริ่ม");
        else status("yellow", p == null ? (lm ? "เห็นตัวไม่พอ — ให้เห็นไหล่ สะโพก และเข่า" : "ยังไม่พบคนในภาพ — ให้เห็นทั้งตัวและเก้าอี้") : "ให้ผู้สูงอายุนั่งพิงพนักก่อน (หรือกดเริ่มถ้านั่งอยู่แล้ว)");
      } else if (phase === "arming") { live(lm, f, p); }
      else if (phase === "active") {
        if (gs && gs.fire === "side") return endNow(gs.at, "gesture");
        Q.add(t, lm ? visCore(lm) : null);
        var ev = TUG.pushFrame(p, f ? bodyLen(lm, asp) : null, f ? (lm[LM.LHIP].x + lm[LM.RHIP].x) / 2 * asp : null, t);
        var PH = { waiting: "รอลุก", rising: "กำลังลุก", standing: "ยืนแล้ว", walkOut: "ขาไป " + Math.round(Math.min(1, TUG.E) * 100) + "%", walkBack: "ขากลับ" }; live(lm, f, p, PH[TUG.state] || "");
        if (ev && ev.event === "walk") { coach("เดินไปให้ถึงจุดหมาย 3 เมตร"); speak("เดินไปที่จุดหมายได้เลย"); }
        if (ev && ev.event === "turn") { coach("ถึงจุดกลับแล้ว เดินกลับมานั่งลง"); speak("เดินกลับมานั่งลงได้เลย"); }
        if (ev && ev.event === "finish") return finish(ev, "camera");
        if (gs && gs.g === "side") status("yellow", "เห็นกางแขน… ค้างไว้เพื่อสิ้นสุด");
        var el = (t - TUG.goAt) / 1000; $("csN").textContent = el.toFixed(1); if (el > 75) coach("นั่งลงแล้วระบบไม่หยุด? กางแขนออกด้านข้าง หรือกดสิ้นสุด");
      } else if (phase === "result") {
        live(lm, f, p);
        if (gs && gs.fire === "one" && gestSaveOk()) return save();
      }
    });
    function finish(ev, by) {
      var sec = Math.round(ev.elapsed * 10) / 10, ql = Q.report();
      result = { kind: "tug", sec: sec, out: ev.out != null ? Math.round(ev.out * 10) / 10 : null, back: ev.back != null ? Math.round(ev.back * 10) / 10 : null, distanceOk: !!ev.distanceOk, meters: ev.meters, turnSeen: ev.turnSeen, axis: ev.axis,
        drift: ev.drift ? Math.round(ev.drift.max * 100) / 100 : null, gait: gaitLabel(ev.drift), reaction: ev.reaction != null ? Math.round(ev.reaction * 10) / 10 : null, endedBy: by, quality: ql, refs: PO.learned() };
      phase = "result"; $("csN").textContent = sec.toFixed(1);
      status(sec >= 12 || ql.level === "ต่ำ" || !ev.distanceOk ? "yellow" : "green", "เสร็จสิ้น " + sec.toFixed(1) + " วินาที · " + (ev.distanceOk ? "เดินครบระยะ" : "ระยะอาจไม่ครบ 3 เมตร") + " (ประมาณ " + ev.meters + " ม.) · " + qualityText(ql) + (by === "gesture" ? " · สิ้นสุดด้วยสัญญาณมือ" + (ev.sawSit ? " (ใช้เวลาที่เห็นนั่งลง)" : "") : ""));
      if (ev.distanceOk) { speak("เสร็จสิ้น ใช้เวลา " + Math.round(sec) + " วินาที ยกมือข้างเดียวเพื่อบันทึก"); coach("<b>ยกมือข้างเดียว</b>ค้างไว้เพื่อบันทึก หรือกดปุ่มด้านล่าง"); }
      else { speak("เสร็จสิ้น ระยะเดินอาจไม่ครบ ให้ลูกหลานตรวจแล้วกดบันทึก"); coach("กล้องประมาณว่าเดินไม่ถึง 3 เมตร — <b>ลูกหลานตรวจแล้วกดบันทึกเอง</b> (ไม่รับการบันทึกด้วยสัญญาณมือ) หรือวัดใหม่"); }
      btns();
    }
  }

  function runBalance(video, canvas, ctx, opts, done) {
    var stage = opts.stage || 0, NM = opts.stageNames || ["ยืนเท้าชิดกัน", "ยืนเท้าเหลื่อม", "ยืนต่อเท้า", "ยืนขาเดียว"], SEC = 10;
    var ENG = new BalanceEngine(stage), Q = new Quality(), phase = "setup", t0 = 0, armed = false, half = false, pending = null;
    var chips = $("csChips"); chips.hidden = false; chips.innerHTML = NM.map(function (n, i) { return '<span class="' + (i < stage ? "ok" : i === stage ? "on" : "") + '">' + (i + 1) + " " + esc(n.replace(/^ยืน/, "")) + "</span>"; }).join("");
    $("csOf").textContent = "วินาที"; $("csN").textContent = SEC; $("csTrkW").hidden = false;
    coach("<b>ท่าที่ " + (stage + 1) + " · " + esc(NM[stage]) + "</b><br>" + esc(opts.how || "") + "<br>วางมือถือให้นิ่ง · ผู้สูงอายุ<b>ยืนหันข้าง</b>ให้กล้อง ห่าง 2–3 เมตร เห็นเท้าชัด · ลูกหลานยืนอีกข้างพร้อมพยุง");
    speak("ท่าที่ " + (stage + 1) + " " + NM[stage] + " ยืนหันข้างให้กล้อง เมื่อพร้อม กดเริ่ม");
    function startCd(text) { if (phase !== "setup") return; phase = "arming"; buttons([]); countdown(text || "พร้อมแล้ว", beginHold); }
    function beginHold() { phase = "holding"; t0 = mono(); ENG.beginHold(t0); status("green", "กำลังจับเวลา ยืนนิ่ง 10 วินาที ลืมตาไว้"); speak("เริ่มจับเวลา ยืนนิ่ง ๆ สิบวินาที"); coach("<b>" + esc(NM[stage]) + "</b> ยืนนิ่ง ๆ อย่าขยับเท้า");
      buttons([{ t: "■ หยุดเพื่อความปลอดภัย", cls: "no", fn: function () { endStage(Math.min((mono() - t0) / 1000, SEC), "หยุดเพื่อความปลอดภัย", true); } }]); }
    function endStage(held, reason, safety) {
      if (phase !== "holding") return; phase = "confirm"; stopLoop();
      var o = ENG.observe(), ql = Q.report();
      pending = { held: Math.round(held * 10) / 10, reason: reason || null, o: o, ql: ql }; var full = held >= SEC - 0.2;
      $("csObs").hidden = false; $("csObs").innerHTML = "<b>กล้องสังเกตเห็น</b> (ข้อมูลประกอบ ไม่ใช่คำตัดสิน)<br>· " + o.obs.map(esc).join("<br>· ") + "<br>· เห็นเท้าชัด " + o.feetSeen + "% ของเวลา · " + esc(qualityText(ql));
      status(o.suggest === "fail" ? "yellow" : "green", (full ? "ครบ 10 วินาที" : "หยุดที่ " + held.toFixed(1) + " วินาที") + " — ลูกหลานยืนยันผล");
      coach("<b>กรุณายืนยันผล</b> เกณฑ์ CDC: ยืนครบ 10 วินาที โดยไม่ขยับเท้าและไม่ต้องจับพยุง");
      speak((full ? "ครบสิบวินาที " : "หยุดที่ " + held.toFixed(0) + " วินาที ") + "กรุณายืนยันผลบนหน้าจอ");
      if (safety) return settle(false);
      buttons([{ t: "✓ ผ่าน — ยืนครบโดยไม่ขยับเท้า", fn: function () { settle(true); }, dis: !full }, { t: "✗ ไม่ผ่าน — ขยับเท้าหรือต้องจับพยุง", cls: "sec", fn: function () { settle(false); } }]);
    }
    function settle(pass) { if (!pending) return; var p = pending; pending = null; done({ kind: "balance", stage: stage, held: p.held, pass: !!pass, obs: p.o.obs, suggest: p.o.suggest, feetSeen: p.o.feetSeen, reason: p.reason, quality: p.ql }); }
    buttons([{ t: "▶ เริ่มท่านี้ (นับ 3-2-1)", fn: function () { startCd(); } }]);
    startLoop(video, function (t) {
      var d = detectPose(video, t), lm = d && d.lm; drawPose(ctx, canvas, video, lm); live(lm, lm ? features(lm, d.wl, aspectOf(video)) : null, null, lm ? "เห็นตัว " + Math.round(visOK(lm) * 100) + "%" : "");
      if (phase === "setup") {
        var gg = ENG.frame(lm, t);
        if (!gg.seen) status("yellow", "ถอยให้กล้องเห็นทั้งตัว แล้วให้ยืนหันข้าง");
        else if (gg.sideOk === false) status("yellow", "หันข้างให้กล้อง เพื่อให้เห็นตำแหน่งเท้าชัด");
        else if (gg.ready && gg.stanceOk) { if (!armed) { armed = true; startCd("จัดเท้าถูกต้องแล้ว"); } }
        else if (gg.ready && gg.stanceOk === false) status("yellow", "กล้องเห็นท่า: " + STANCE_NM[gg.stance] + " — จัดเท้าเป็นท่า " + NM[stage] + " (หรือกดเริ่มถ้าท่าถูกแล้ว)");
        else status(gg.ready ? "green" : "yellow", gg.ready ? "ยืนนิ่งแล้ว มองเท้าไม่ชัด — กดเริ่มเมื่อท่าถูกต้อง" : "ยืนนิ่ง ๆ ในท่า " + NM[stage]);
      } else if (phase === "arming") { ENG.frame(lm, t); }
      else if (phase === "holding") {
        var h = ENG.frame(lm, t), el = (t - t0) / 1000; Q.add(t, lm ? visOK(lm) : null);
        $("csN").textContent = Math.max(0, SEC - el).toFixed(0); $("csTrk").style.width = Math.min(100, el / SEC * 100) + "%";
        if (h.remind) speak(h.remind);
        if (!half && el >= SEC / 2) { half = true; speak("เหลืออีก ห้า วินาที"); }
        if (h.dropped) { speak("ระวัง ให้ลูกหลานเข้าไปช่วยพยุง"); return endStage(Math.min(el, SEC), h.why); }
        if (h.fail) return endStage(Math.min(el, SEC), h.why);
        if (el >= SEC) return endStage(SEC, null);
      }
    });
  }

  var PURE = { ENGINE: ENGINE, OneEuro: OneEuro, RepDetector: RepDetector, TugTracker: TugTracker, BalanceEngine: BalanceEngine, Quality: Quality, Posture: Posture, features: features, armPose: armPose, Gestures: Gestures, absPosture: absPosture, makeClock: makeClock, visCore: visCore, bodyLen: bodyLen, kneeAngle3D: kneeAngle3D, hipRatio: hipRatio, visOK: visOK, gaitLabel: gaitLabel, crossT: crossT, LM: LM };
  g.CSCam = Object.assign({ lastPose: function () { return LASTD; }, open: open, close: close, isOpen: function () { return !!UI; }, supported: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    ttsOn: ttsOn, setTts: function (on) { try { localStorage.setItem("cs3:tts", on ? "on" : "off"); } catch (e) {} } }, PURE);
  if (typeof module !== "undefined" && module.exports) module.exports = PURE;
})(typeof window !== "undefined" ? window : this);
