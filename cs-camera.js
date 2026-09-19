/* ============================================================
   cs-camera.js — วัดด้วยกล้อง (ทางเลือกเสริมของแอป V3) · เอนจินรุ่น 2
   ------------------------------------------------------------
   รุ่นแรกยกตัวตรวจจับของ V2 มาตรง ๆ แล้วพบว่าไม่แม่นพอ รุ่นนี้เขียนใหม่โดยแก้ที่ต้นเหตุ:
   1. ท่านั่ง–ยืน ใช้ "มุมเข่า 3 มิติ" (world landmarks ของ MediaPipe หน่วยเมตร ไม่ขึ้นกับมุมกล้อง
      หรือการเอียงมือถือ) รวมกับสัดส่วนสะโพก ถ่วงน้ำหนักตามความชัดของขา — เดิมใช้สะโพกอย่างเดียว
   2. กรองสัญญาณด้วย One-Euro filter (หน่วงน้อยกว่าค่าเฉลี่ยเคลื่อนที่) และหาเวลาข้ามเกณฑ์
      แบบแทรกค่าระหว่างเฟรม — เวลาไม่หยาบเท่าช่วงเฟรมอีกต่อไป
   3. ใช้เวลาจับภาพของเฟรมจริง (requestVideoFrameCallback · captureTime) ไม่ใช่เวลาที่ประมวลผลเสร็จ
   4. ทดสอบความเร็วเครื่องก่อนวัด แล้วลดรุ่นโมเดลทันทีถ้าช้ากว่า ~12 เฟรม/วินาที
      (เดิมเริ่มที่รุ่นหนักสุดเสมอ มือถือได้ 5–8 เฟรม/วินาที จับจังหวะไม่ทัน)
   5. เลือกและล็อกคนที่ถูกวัด เมื่อมีมากกว่าหนึ่งคนในภาพ (เดิมหยิบคนแรกที่โมเดลคืนมา)
   6. ลุกนั่ง: จับเวลาตั้งแต่สัญญาณ "เริ่ม" จนนั่งลงครั้งที่ 5 — ตรงกับวิธีกดจับเวลาเองของแอป
      (เดิมจบตอนยืนครั้งที่ 5 ทำให้ผลจากกล้องสั้นกว่ากดเองราว 1 วินาที)
   7. ลุกเดิน: ประมาณระยะเป็นเมตรจาก "ความสูงลำตัวในภาพ" และการเคลื่อนด้านข้าง แทนความกว้างไหล่
      ซึ่งหดเองตอนหมุนตัว ทำให้จับจุดกลับผิด · ใช้ได้ทั้งเดินออกจากกล้องและเดินขวางกล้อง
   8. ทุกผลมีระดับความน่าเชื่อถือ (เฟรม/วินาที · ความชัดของตัว) ถ้าต่ำจะแนะนำให้วัดซ้ำหรือกดเอง
   หลักเดิมคงไว้: ภาพประมวลผลในเครื่อง ไม่อัปโหลด เก็บเฉพาะตัวเลข · ผลกลับเข้าหน้าจับเวลาให้คนกดบันทึก
   ผลทรงตัวผ่าน/ไม่ผ่านให้คนยืนยันเสมอ · ไม่มีสั่งงานด้วยเสียงหรือยกมือ
   ============================================================ */
(function (g) {
  var ENGINE = "cam-2.0";
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
    var d = Math.hypot((sx - ax) * aspect, sy - ay); return isFinite(d) && d > 0.05 ? d : null;
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

  /* ---------- คะแนนท่าทาง 0 (นั่ง) → 1 (ยืน): รวมมุมเข่า 3 มิติกับสัดส่วนสะโพก ---------- */
  function postureNorm(s, refs) {
    var hN = s.h != null && refs.standRef != null ? (s.h - refs.sitRef) / (refs.standRef - refs.sitRef) : null;
    var kN = s.k != null && refs.sitK != null && refs.standK != null && refs.standK - refs.sitK >= 25 ? (s.k - refs.sitK) / (refs.standK - refs.sitK) : null;
    if (hN == null && kN == null) return null; if (kN == null) return hN; if (hN == null) return kN;
    var w = 0.6 * clamp(((s.kvis || 0) - 0.45) / 0.35, 0, 1);
    return w * kN + (1 - w) * hN;
  }
  function sampleOf(lm, wl) { var ka = kneeAngle3D(wl, lm); return { h: hipRatio(lm), k: ka.k, kvis: ka.vis }; }
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
    this.pp = null; this.pt = null; this.s0 = null; this.s0buf = []; this.cx0 = null; this.E = 0; this.Epk = 0; this.depthPk = 0; this.latPk = 0; this.driftMax = 0; this.sitN = 0;
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
      if (p <= 0.30 && (t - this.t0) > 4000) this.sitN++; else this.sitN = 0;
      if (this.sitN >= 3 && (this.state === "walkBack" || this.E < Math.max(0.2, this.Epk * 0.4))) {
        this.state = "done"; var base = this.goAt != null ? this.goAt : this.t0, tEnd = t - 2 * (t - t0);   /* ถอยกลับ 2 เฟรมที่ใช้ยืนยันว่านั่งแล้ว */
        var depthWalk = this.depthPk >= this.latPk;
        return { event: "finish", elapsed: (tEnd - base) / 1000, reaction: this.goAt != null ? (this.t0 - this.goAt) / 1000 : null,
          out: this.tTurn ? (this.tTurn - base) / 1000 : null, back: this.tTurn ? (tEnd - this.tTurn) / 1000 : null,
          distanceOk: this.Epk >= 0.75, meters: Math.round(this.Epk * 30) / 10, turnSeen: this.tTurn != null, axis: depthWalk ? "depth" : "lateral", drift: depthWalk ? { max: this.driftMax } : null };
      }
    }
    return null;
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
  var POSE = null, MOD = null, FILESET = null, POSE_COUNT = 0, LOCK = null;
  var LEVELS = [
    { k: "heavy", nm: "ละเอียดสูงสุด", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task" },
    { k: "full", nm: "ละเอียดสูง", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task" },
    { k: "lite", nm: "เร็ว", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" }];
  async function createLevel(i, say) {
    var L = LEVELS[i]; if (say) say("กำลังโหลดโมเดล" + L.nm + "…");
    var dels = ["GPU", "CPU"];
    for (var d = 0; d < dels.length; d++) {
      try {
        var p = await MOD.PoseLandmarker.createFromOptions(FILESET, { baseOptions: { modelAssetPath: L.u, delegate: dels[d] }, runningMode: "VIDEO", numPoses: 2, minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5 });
        p.modelLevel = L.k; p.levelIx = i; return p;
      } catch (e) {}
    }
    return null;
  }
  async function loadModel(say) {
    if (POSE) return POSE;
    if (!MOD) { MOD = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14"); FILESET = await MOD.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"); }
    var coarse = false; try { coarse = matchMedia("(pointer:coarse)").matches; } catch (e) {}
    var start = coarse ? 1 : 0;
    try { var si = LEVELS.findIndex(function (l) { return l.k === localStorage.getItem("cs-pose-model2"); }); if (si >= 0) start = si; } catch (e) {}
    for (var i = start; i < LEVELS.length; i++) { POSE = await createLevel(i, say); if (POSE) return POSE; }
    throw new Error("model-load-failed");
  }
  /* วัดเวลาประมวลผลจริง 10 เฟรม ถ้าเกิน ~80 มิลลิวินาทีต่อเฟรม ลดรุ่นทันที (ไม่รอครั้งหน้า) */
  async function tuneModel(video, say) {
    for (var round = 0; round < 2; round++) {
      var sum = 0, n = 0;
      for (var i = 0; i < 12; i++) {
        await new Promise(function (r) { setTimeout(r, 30); });
        var t = performance.now(); try { POSE.detectForVideo(video, t); } catch (e) { continue; }
        if (i >= 2) { sum += performance.now() - t; n++; }
      }
      var avg = n ? sum / n : 0;
      if (avg <= 80 || POSE.levelIx >= LEVELS.length - 1) break;
      if (say) say("เครื่องนี้ประมวลผลช้า กำลังสลับเป็นโมเดลที่เร็วกว่า…");
      var next = await createLevel(POSE.levelIx + 1, say); if (!next) break;
      try { POSE.close(); } catch (e) {} POSE = next;
    }
    try { localStorage.setItem("cs-pose-model2", POSE.modelLevel); } catch (e) {}
  }
  /* เลือกคนที่ถูกวัด: ครั้งแรกเอาคนที่ตัวใหญ่ที่สุดในภาพ จากนั้นล็อกคนที่อยู่ใกล้ตำแหน่งเดิมที่สุด */
  function pickPerson(L) {
    var best = -1, bs = -1;
    for (var i = 0; i < L.length; i++) {
      var lm = L[i], cx = (lm[LM.LHIP].x + lm[LM.RHIP].x) / 2, cy = midY(lm, LM.LHIP, LM.RHIP), h = Math.abs(midY(lm, LM.LANK, LM.RANK) - midY(lm, LM.LSH, LM.RSH));
      var sc = LOCK ? -Math.hypot(cx - LOCK.x, cy - LOCK.y) : h;
      if (best < 0 || sc > bs) { best = i; bs = sc; }
    }
    if (best >= 0) { var m = L[best]; LOCK = { x: (m[LM.LHIP].x + m[LM.RHIP].x) / 2, y: midY(m, LM.LHIP, LM.RHIP) }; }
    return best;
  }
  function detectPose(video, t) {
    if (!POSE) return null; var r = null;
    try { r = POSE.detectForVideo(video, t); } catch (e) { POSE_COUNT = 0; return null; }
    var L = r && r.landmarks ? r.landmarks : []; POSE_COUNT = L.length; if (!L.length) return null;
    var i = pickPerson(L); return { lm: L[i], wl: r.worldLandmarks ? r.worldLandmarks[i] : null };
  }
  function drawPose(ctx, canvas, video, lm) {
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    ctx.clearRect(0, 0, canvas.width, canvas.height); if (!lm) return;
    var pairs = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 31], [28, 32], [11, 13], [13, 15], [12, 14], [14, 16]];
    ctx.lineWidth = Math.max(3, canvas.width / 150); ctx.strokeStyle = "rgba(23,179,161,.9)"; ctx.lineCap = "round";
    pairs.forEach(function (p) { var a = lm[p[0]], b = lm[p[1]]; if (!a || !b || vz(a) < 0.4 || vz(b) < 0.4) return; ctx.beginPath(); ctx.moveTo(a.x * canvas.width, a.y * canvas.height); ctx.lineTo(b.x * canvas.width, b.y * canvas.height); ctx.stroke(); });
    [11, 12, 23, 24, 25, 26, 27, 28].forEach(function (i) { var p = lm[i]; if (!p) return; ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(4, canvas.width / 110), 0, 6.3); ctx.fillStyle = vz(p) < 0.5 ? "#F87171" : (i === 25 || i === 26) ? "#FCD34D" : "#DBEAFE"; ctx.fill(); });
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
    ".cscam .foot{font-size:11.5px;color:rgba(255,255,255,.6);text-align:center;line-height:1.45}.cscam .foot a{color:#9FE3DA;cursor:pointer;text-decoration:underline}"
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
  /* วนตามเฟรมวิดีโอจริง: ไม่ประมวลผลเฟรมซ้ำ และใช้เวลาจับภาพของเฟรมเป็นเวลาอ้างอิง */
  function startLoop(video, fn) {
    stopLoop(); var alive = { on: true }, lastCT = -1; LOOP = alive;
    if (video.requestVideoFrameCallback) {
      var step = function (now, meta) { if (!alive.on || !UI) return; fn(meta && meta.captureTime ? meta.captureTime : now); if (alive.on) video.requestVideoFrameCallback(step); };
      video.requestVideoFrameCallback(step);
    } else {
      var raf = function () { if (!alive.on || !UI) return; if (video.currentTime !== lastCT) { lastCT = video.currentTime; fn(performance.now()); } requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }
  function stopLoop() { if (LOOP) LOOP.on = false; LOOP = null; }
  function close() {
    cdCancel(); stopLoop(); LOCK = null;
    if (STREAM) { STREAM.getTracks().forEach(function (t) { t.stop(); }); STREAM = null; }
    try { speechSynthesis.cancel(); } catch (e) {}
    if (UI) UI.remove(); UI = null;
  }
  function aspectOf(video) { return video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 0.5625; }

  async function open(opts) {
    close(); injectCSS();
    var host = document.querySelector(".phone") || document.body;
    UI = document.createElement("div"); UI.className = "cscam" + (FACING === "user" ? " mirror" : "");
    var KIND_NM = { ftsst: "ลุกนั่ง 5 ครั้ง", tug: "ลุกเดิน 3 เมตร", balance: "ทรงตัว 4 ท่า" };
    UI.innerHTML = '<div class="st"><video id="csV" playsinline muted autoplay></video><canvas id="csK"></canvas>' +
      '<div class="top"><span class="tag" id="csTag">กำลังเปิดกล้อง…</span><button id="csFlip">🔄 สลับกล้อง</button></div></div>' +
      '<div class="dock"><div class="cnt" id="csCnt"><b id="csN">0</b><span id="csOf"></span><span class="clk" id="csClk"></span></div>' +
      '<div class="trk" id="csTrkW" hidden><i id="csTrk"></i></div><div class="chips" id="csChips" hidden></div>' +
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
    try { STREAM = await navigator.mediaDevices.getUserMedia({ video: { facingMode: FACING, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, min: 15 } }, audio: false }); }
    catch (e) { if (FACING !== "user") { FACING = "user"; close(); return open(opts); } tag.textContent = "เปิดกล้องไม่ได้"; status("red", "เปิดกล้องไม่ได้ — อนุญาตกล้องในเบราว์เซอร์ หรือจับเวลาเองแทน"); buttons(toManual); return; }
    if (!UI) return;
    video.srcObject = STREAM;
    await Promise.race([video.play().catch(function () {}), new Promise(function (r) { setTimeout(r, 1500); })]);
    status("yellow", "กำลังโหลดระบบตรวจจับท่าทาง (ครั้งแรกใช้เน็ต)");
    try { await loadModel(function (t) { if (UI) tag.textContent = t; }); if (UI) { status("yellow", "กำลังทดสอบความเร็วของเครื่อง…"); await tuneModel(video, function (t) { if (UI) tag.textContent = t; }); } }
    catch (e) { if (!UI) return; tag.textContent = "โหลดโมเดลไม่สำเร็จ"; status("red", "โหลดระบบไม่สำเร็จ — ต้องต่ออินเทอร์เน็ตครั้งแรก หรือจับเวลาเองแทน"); buttons(toManual); return; }
    if (!UI) return;
    tag.textContent = "พร้อม · โมเดล" + (LEVELS[POSE.levelIx] || {}).nm;
    var fin = function (res) { close(); opts.onDone(res); };
    if (opts.kind === "balance") return runBalance(video, canvas, ctx, opts, fin);
    var refs = opts.refs && opts.refs.sitRef != null && opts.refs.engine === ENGINE ? opts.refs : null;
    var after = function (r) { if (opts.kind === "ftsst") runFtsst(video, canvas, ctx, r, fin); else runTug(video, canvas, ctx, r, fin); };
    if (refs) after(refs); else runCalib(video, canvas, ctx, after);
  }

  /* สอบเทียบ: เก็บทั้งสัดส่วนสะโพกและมุมเข่าของท่านั่งและท่ายืน (มัธยฐาน 12 เฟรมล่าสุด) */
  function runCalib(video, canvas, ctx, done) {
    var sit = null, stand = null, cur = null, H = [], K = [], want = "sit", arming = false;
    coach("<b>ขั้นเตรียม</b> วางมือถือพิงของให้นิ่ง (หรือถือสองมือ) ให้เห็นตั้งแต่ศีรษะถึงเท้า มุมเฉียงด้านข้างดีที่สุด<br>ให้ผู้สูงอายุ<b>นั่ง</b>ก่อน แล้วกดบันทึกท่านั่ง");
    speak("ขั้นเตรียม วางมือถือให้นิ่ง ให้เห็นทั้งตัว ให้ผู้สูงอายุนั่งบนเก้าอี้ แล้วกดบันทึกท่านั่ง");
    function med(a) { var b = a.filter(function (x) { return x != null; }).sort(function (x, y) { return x - y; }); return b.length ? b[Math.floor(b.length / 2)] : null; }
    function btns() { buttons([{ t: sit ? "บันทึกท่านั่งใหม่" : "บันทึกท่านั่ง", cls: sit ? "sec" : "", id: "cSit", dis: !cur, fn: function () { cap("sit"); } }, { t: stand ? "บันทึกท่ายืนใหม่" : "บันทึกท่ายืน", cls: stand ? "sec" : "", id: "cStand", dis: !cur, fn: function () { cap("stand"); } }]); }
    function cap(kind) {
      cdCancel(); arming = false;
      if (!cur || H.length < 6) { status("yellow", "ยังเห็นตัวไม่ชัดหรือยังไม่นิ่ง รอสักครู่"); return; }
      var v = { h: med(H), k: med(K) };
      if (kind === "sit") { sit = v; want = "stand"; speak("บันทึกท่านั่งแล้ว ให้ยืนขึ้น แล้วกดบันทึกท่ายืน"); coach("<b>บันทึกท่านั่งแล้ว ✓</b>" + (v.k != null ? " (เข่า " + Math.round(v.k) + "°)" : "") + " ให้ผู้สูงอายุ<b>ยืนขึ้นตัวตรง</b> แล้วกดบันทึกท่ายืน"); }
      else { stand = v; want = "sit"; speak("บันทึกท่ายืนแล้ว"); coach("<b>บันทึกท่ายืนแล้ว ✓</b>" + (v.k != null ? " (เข่า " + Math.round(v.k) + "°)" : "")); }
      H = []; K = []; btns();
      if (sit && stand) {
        var hOk = stand.h != null && sit.h != null && stand.h - sit.h >= 0.045, kOk = stand.k != null && sit.k != null && stand.k - sit.k >= 40;
        if (!hOk && !kOk) { status("red", "ท่านั่งกับท่ายืนต่างกันน้อยเกินไป บันทึกใหม่ทีละท่า"); speak("ค่าสองท่าต่างกันน้อยเกินไป บันทึกใหม่ทีละท่า"); sit = null; stand = null; want = "sit"; btns(); return; }
        status("green", "สอบเทียบเรียบร้อย" + (kOk ? " · ใช้มุมเข่าร่วมด้วย" : " · มองเข่าไม่ชัด ใช้สะโพกอย่างเดียว")); stopLoop();
        var refs = { engine: ENGINE, sitRef: sit.h, standRef: hOk ? stand.h : null, sitK: kOk ? sit.k : null, standK: kOk ? stand.k : null };
        setTimeout(function () { if (UI) done(refs); }, 700);
      }
    }
    btns();
    startLoop(video, function (t) {
      var d = detectPose(video, t), lm = d && d.lm; drawPose(ctx, canvas, video, lm); var ok = false;
      if (lm) {
        var q = visOK(lm), s = sampleOf(lm, d.wl);
        if (q < 0.85) { cur = null; status("yellow", "ยังเห็นตัวไม่ครบ ถอยให้เห็นตั้งแต่หัวถึงเท้า"); }
        else if (s.h == null) { cur = null; status("yellow", "ถอยห่างอีกนิด ให้เห็นทั้งตัว"); }
        else { cur = s; ok = true; H.push(s.h); K.push(s.kvis >= 0.5 ? s.k : null); if (H.length > 12) { H.shift(); K.shift(); } if (!arming) status("green", "เห็นตัวชัดแล้ว กด" + (want === "sit" ? "บันทึกท่านั่ง" : "บันทึกท่ายืน") + " หรือรอให้นับถอยหลัง"); }
      } else { cur = null; status("yellow", "ยังไม่พบคนในภาพ"); }
      var bs = $("cSit"), bt = $("cStand"); if (bs) bs.disabled = !ok; if (bt) bt.disabled = !ok;
      if (!ok) { H = []; K = []; if (arming) { cdCancel(); arming = false; } }
      var steady = H.length >= 12 && (Math.max.apply(null, H) - Math.min.apply(null, H)) < 0.012;
      var need = want === "sit" ? !sit : !stand, far = want === "sit" || (sit && cur && ((cur.h - sit.h >= 0.045) || (cur.k != null && sit.k != null && cur.k - sit.k >= 40)));
      if (ok && steady && need && far && !arming) { arming = true; var k = want; countdown(k === "sit" ? "เห็นว่านั่งแล้ว" : "เห็นว่ายืนแล้ว", function () { cap(k); }); }
    });
  }

  function runFtsst(video, canvas, ctx, refs, done) {
    var DET = new RepDetector({ target: 5 }), Q = new Quality(), running = false, tGo = 0, lastEvt = 0, readySince = null, arming = false, stall = false, pIdle = new OneEuro(2, 0.6);
    $("csOf").textContent = "/ 5 ครั้ง"; $("csTrkW").hidden = false;
    coach("ให้ผู้สูงอายุ<b>นั่ง กอดอก</b> กด <b>เริ่ม</b> แล้วรอสัญญาณ 3-2-1<br>ลุกยืนให้ตัวตรง แล้วนั่งให้ก้นแตะเก้าอี้ ต่อเนื่อง 5 ครั้ง · จับเวลาถึงตอน<b>นั่งลงครั้งที่ 5</b>");
    speak("ทดสอบลุกนั่ง ห้าครั้ง ให้ผู้สูงอายุนั่ง กอดอก เมื่อพร้อม กดเริ่ม");
    function btns() { buttons(running ? [{ t: "นับไม่ขึ้น · หยุดแล้วจับเวลาเอง", cls: "sec", fn: function () { close(); done({ kind: "ftsst", manual: true }); } }] : [{ t: "▶ เริ่ม (นับ 3-2-1)", fn: arm, dis: arming }]); }
    function arm() { if (running || arming) return; arming = true; btns(); countdown("พร้อมแล้ว", begin); }
    function begin() { arming = false; running = true; tGo = performance.now(); lastEvt = tGo; DET.start(tGo); status("green", "เริ่ม — ลุกนั่งต่อเนื่อง 5 ครั้ง"); coach("ลุกยืนให้ตัวตรง แล้วนั่งลงให้สุด ทำต่อเนื่อง"); btns(); }
    btns();
    startLoop(video, function (t) {
      var d = detectPose(video, t), lm = d && d.lm; drawPose(ctx, canvas, video, lm);
      var q = lm ? visOK(lm) : null, p = lm && q >= 0.6 ? postureNorm(sampleOf(lm, d.wl), refs) : null;
      if (running) {
        Q.add(t, q); var ev = DET.push(p, t);
        $("csN").textContent = DET.reps; $("csTrk").style.width = (Math.min(DET.reps, 5) / 5 * 100) + "%"; $("csClk").textContent = ((t - tGo) / 1000).toFixed(1) + " วิ";
        if (ev && (ev.event === "rep" || ev.event === "down")) lastEvt = t;
        if (ev && ev.event === "rep") { status("green", ev.reps >= 5 ? "ยืนครบ 5 ครั้ง — นั่งลงให้เรียบร้อย" : "นับได้ " + ev.reps + " จาก 5 ครั้ง"); speak(["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า นั่งลง"][ev.reps]); }
        if (ev && ev.event === "finish") { stopLoop(); return finish(ev); }
        if (t - lastEvt > 20000 && !stall) { stall = true; status("red", "ระบบนับไม่ขึ้น ลุกให้ตัวตรง นั่งให้สุด หรือกดปุ่มจับเวลาเอง"); }
      } else if (!arming) {
        if (p == null) { readySince = null; status("yellow", lm ? "เห็นตัวไม่ครบ ขยับให้เห็นทั้งตัว" : "ยังไม่พบคนในภาพ"); }
        else { var ps = pIdle.filter(p, t); if (ps < 0.25) { if (readySince == null) readySince = t; status("green", "เห็นท่านั่งแล้ว กดเริ่มเมื่อพร้อม"); if (t - readySince > 3000) arm(); } else { readySince = null; status("yellow", "ให้ผู้สูงอายุนั่งลงบนเก้าอี้ก่อน"); } }
      }
      if (lm) $("csTag").textContent = "เห็นตัว " + Math.round(q * 100) + "%" + (POSE_COUNT > 1 ? " · มี " + POSE_COUNT + " คนในภาพ (ล็อกคนเดิม)" : "");
    });
    function finish(ev) {
      var gaps = []; for (var i = 1; i < DET.stamps.length; i++) gaps.push(Math.round((DET.stamps[i] - DET.stamps[i - 1]) / 100) / 10);
      var cv = null; if (gaps.length > 1) { var m = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length, sd = Math.sqrt(gaps.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / gaps.length); cv = m > 0 ? Math.round(sd / m * 100) / 100 : null; }
      var sec = Math.round(ev.elapsed * 10) / 10, ql = Q.report();
      status(ql.level === "ต่ำ" ? "yellow" : "green", "ครบ 5 ครั้ง " + sec.toFixed(1) + " วินาที · " + qualityText(ql) + (ev.endedStanding ? " · ไม่เห็นตอนนั่งลงครั้งสุดท้าย" : ""));
      speak("ครบห้าครั้ง ใช้เวลา " + Math.round(sec) + " วินาที");
      setTimeout(function () { done({ kind: "ftsst", sec: sec, reps: DET.reps, gaps: gaps, cv: cv, reaction: ev.reaction != null ? Math.round(ev.reaction * 10) / 10 : null, endedStanding: ev.endedStanding, quality: ql, refs: refs }); }, 1600);
    }
  }

  function runTug(video, canvas, ctx, refs, done) {
    var phase = "waitSit", TUG = null, Q = new Quality(), seatedSince = null, arming = false, pIdle = new OneEuro(2, 0.6);
    $("csOf").textContent = "วินาที"; $("csN").textContent = "0.0";
    coach("<b>เตรียม:</b> ทำจุดหมายห่างเก้าอี้ 3 เมตร · วางมือถือให้นิ่ง เห็นทั้งเก้าอี้และทางเดินตลอดเส้น (เดินออกจากกล้องหรือเดินขวางกล้องก็ได้)<br>ได้ยิน “เริ่ม” → ลุก เดินไปจุดหมาย หมุนกลับ มานั่งลง");
    speak("ลุกเดินสามเมตร ให้ผู้สูงอายุนั่งพิงพนักเก้าอี้ วางมือถือให้เห็นทั้งเก้าอี้และทางเดิน เมื่อพร้อม กดเริ่ม");
    function btns() { buttons(phase === "waitSit" ? [{ t: "▶ เริ่ม (นับ 3-2-1)", fn: arm }] : phase === "active" ? [{ t: "ระบบไม่หยุด · จับเวลาเองแทน", cls: "sec", fn: function () { close(); done({ kind: "tug", manual: true }); } }] : []); }
    function arm() { if (phase !== "waitSit") return; phase = "arming"; arming = true; btns(); countdown("พร้อมทดสอบ", begin); }
    function begin() { phase = "active"; TUG = new TugTracker(); TUG.goAt = performance.now(); status("green", "เริ่ม — ลุกขึ้น เดินไปจุดหมาย หมุนกลับ มานั่งลง"); coach("ลุกขึ้น → เดินไปจุดหมาย → หมุนกลับ → นั่งลงพิงพนัก"); btns(); }
    btns();
    startLoop(video, function (t) {
      var d = detectPose(video, t), lm = d && d.lm; drawPose(ctx, canvas, video, lm);
      var q = lm ? visOK(lm) : null, ok = lm && q >= 0.6, p = ok ? postureNorm(sampleOf(lm, d.wl), refs) : null;
      if (phase === "waitSit") {
        var ps = p == null ? null : pIdle.filter(p, t), seated = ps != null && ps < 0.22;
        if (seated) { if (seatedSince == null) seatedSince = t; status("green", "เห็นว่านั่งอยู่แล้ว กดเริ่มเมื่อพร้อม"); if (t - seatedSince > 3000) arm(); }
        else { seatedSince = null; status("yellow", lm ? "ให้ผู้สูงอายุกลับมานั่งพิงพนักก่อน" : "ขยับให้กล้องเห็นทั้งตัวและเก้าอี้"); }
      } else if (phase === "active") {
        Q.add(t, q);
        var ev = TUG.pushFrame(p, ok ? bodyLen(lm, aspectOf(video)) : null, ok ? (lm[LM.LHIP].x + lm[LM.RHIP].x) / 2 * aspectOf(video) : null, t);
        var PH = { waiting: "รอลุก", rising: "กำลังลุก", standing: "ยืนแล้ว", walkOut: "ขาไป " + Math.round(Math.min(1, TUG.E) * 100) + "%", walkBack: "ขากลับ" }; $("csTag").textContent = PH[TUG.state] || "";
        if (ev && ev.event === "walk") { coach("เดินไปให้ถึงจุดหมาย 3 เมตร"); speak("เดินไปที่จุดหมายได้เลย"); }
        if (ev && ev.event === "turn") { coach("ถึงจุดกลับแล้ว เดินกลับมานั่งลง"); speak("เดินกลับมานั่งลงได้เลย"); }
        if (ev && ev.event === "finish") { stopLoop(); return finish(ev); }
        var el = (t - TUG.goAt) / 1000; $("csN").textContent = el.toFixed(1); if (el > 75) coach("นั่งลงแล้วระบบไม่หยุด? กดปุ่มด้านล่างเพื่อจับเวลาเอง");
      }
    });
    function finish(ev) {
      var sec = Math.round(ev.elapsed * 10) / 10, ql = Q.report();
      status(sec >= 12 || ql.level === "ต่ำ" || !ev.distanceOk ? "yellow" : "green", "เสร็จสิ้น " + sec.toFixed(1) + " วินาที · " + (ev.distanceOk ? "เดินครบระยะ" : "ระยะอาจไม่ครบ 3 เมตร") + " (ประมาณ " + ev.meters + " ม.) · " + qualityText(ql));
      speak("เสร็จสิ้น ใช้เวลา " + Math.round(sec) + " วินาที");
      setTimeout(function () { done({ kind: "tug", sec: sec, out: ev.out != null ? Math.round(ev.out * 10) / 10 : null, back: ev.back != null ? Math.round(ev.back * 10) / 10 : null, distanceOk: !!ev.distanceOk, meters: ev.meters, turnSeen: ev.turnSeen, axis: ev.axis,
        drift: ev.drift ? Math.round(ev.drift.max * 100) / 100 : null, gait: gaitLabel(ev.drift), reaction: ev.reaction != null ? Math.round(ev.reaction * 10) / 10 : null, quality: ql, refs: refs }); }, 1600);
    }
  }

  function runBalance(video, canvas, ctx, opts, done) {
    var stage = opts.stage || 0, NM = opts.stageNames || ["ยืนเท้าชิดกัน", "ยืนเท้าเหลื่อม", "ยืนต่อเท้า", "ยืนขาเดียว"], SEC = 10;
    var ENG = new BalanceEngine(stage), Q = new Quality(), phase = "setup", t0 = 0, armed = false, half = false, extraN = 0, pending = null;
    var chips = $("csChips"); chips.hidden = false; chips.innerHTML = NM.map(function (n, i) { return '<span class="' + (i < stage ? "ok" : i === stage ? "on" : "") + '">' + (i + 1) + " " + esc(n.replace(/^ยืน/, "")) + "</span>"; }).join("");
    $("csOf").textContent = "วินาที"; $("csN").textContent = SEC; $("csTrkW").hidden = false;
    coach("<b>ท่าที่ " + (stage + 1) + " · " + esc(NM[stage]) + "</b><br>" + esc(opts.how || "") + "<br>วางมือถือให้นิ่ง · ผู้สูงอายุ<b>ยืนหันข้าง</b>ให้กล้อง ห่าง 2–3 เมตร เห็นเท้าชัด · ลูกหลานยืนอีกข้างพร้อมพยุง");
    speak("ท่าที่ " + (stage + 1) + " " + NM[stage] + " ยืนหันข้างให้กล้อง เมื่อพร้อม กดเริ่ม");
    function startCd(text) { if (phase !== "setup") return; phase = "arming"; buttons([]); countdown(text || "พร้อมแล้ว", beginHold); }
    function beginHold() { phase = "holding"; t0 = performance.now(); ENG.beginHold(t0); status("green", "กำลังจับเวลา ยืนนิ่ง 10 วินาที ลืมตาไว้"); speak("เริ่มจับเวลา ยืนนิ่ง ๆ สิบวินาที"); coach("<b>" + esc(NM[stage]) + "</b> ยืนนิ่ง ๆ อย่าขยับเท้า");
      buttons([{ t: "■ หยุดเพื่อความปลอดภัย", cls: "no", fn: function () { endStage(Math.min((performance.now() - t0) / 1000, SEC), "หยุดเพื่อความปลอดภัย", true); } }]); }
    function endStage(held, reason, safety) {
      if (phase !== "holding") return; phase = "confirm"; stopLoop();
      var o = ENG.observe(), ql = Q.report(); if (extraN > 15) o.obs.push("เห็นคนมากกว่าหนึ่งคนในภาพ หากมีการช่วยพยุงถือว่าไม่ผ่าน");
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
      var d = detectPose(video, t), lm = d && d.lm; drawPose(ctx, canvas, video, lm);
      if (phase === "setup") {
        var gg = ENG.frame(lm, t);
        if (!gg.seen) status("yellow", "ถอยให้กล้องเห็นทั้งตัว แล้วให้ยืนหันข้าง");
        else if (gg.sideOk === false) status("yellow", "หันข้างให้กล้อง เพื่อให้เห็นตำแหน่งเท้าชัด");
        else if (gg.ready && gg.stanceOk) { if (!armed) { armed = true; startCd("จัดเท้าถูกต้องแล้ว"); } }
        else if (gg.ready && gg.stanceOk === false) status("yellow", "กล้องเห็นท่า: " + STANCE_NM[gg.stance] + " — จัดเท้าเป็นท่า " + NM[stage] + " (หรือกดเริ่มถ้าท่าถูกแล้ว)");
        else status(gg.ready ? "green" : "yellow", gg.ready ? "ยืนนิ่งแล้ว มองเท้าไม่ชัด — กดเริ่มเมื่อท่าถูกต้อง" : "ยืนนิ่ง ๆ ในท่า " + NM[stage]);
      } else if (phase === "arming") { ENG.frame(lm, t); }
      else if (phase === "holding") {
        var h = ENG.frame(lm, t), el = (performance.now() - t0) / 1000; Q.add(t, lm ? visOK(lm) : null);
        $("csN").textContent = Math.max(0, SEC - el).toFixed(0); $("csTrk").style.width = Math.min(100, el / SEC * 100) + "%";
        if (POSE_COUNT > 1) extraN++; if (h.remind) speak(h.remind);
        if (!half && el >= SEC / 2) { half = true; speak("เหลืออีก ห้า วินาที"); }
        if (h.dropped) { speak("ระวัง ให้ลูกหลานเข้าไปช่วยพยุง"); return endStage(Math.min(el, SEC), h.why); }
        if (h.fail) return endStage(Math.min(el, SEC), h.why);
        if (el >= SEC) return endStage(SEC, null);
      }
    });
  }

  var PURE = { ENGINE: ENGINE, OneEuro: OneEuro, RepDetector: RepDetector, TugTracker: TugTracker, BalanceEngine: BalanceEngine, Quality: Quality, postureNorm: postureNorm, kneeAngle3D: kneeAngle3D, hipRatio: hipRatio, visOK: visOK, gaitLabel: gaitLabel, crossT: crossT, LM: LM };
  g.CSCam = Object.assign({ open: open, close: close, isOpen: function () { return !!UI; }, supported: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    ttsOn: ttsOn, setTts: function (on) { try { localStorage.setItem("cs3:tts", on ? "on" : "off"); } catch (e) {} } }, PURE);
  if (typeof module !== "undefined" && module.exports) module.exports = PURE;
})(typeof window !== "undefined" ? window : this);
