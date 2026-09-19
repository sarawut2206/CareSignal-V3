/* ============================================================
   cs-camera.js — วัดด้วยกล้อง (ทางเลือกเสริมของแอป V3)
   ------------------------------------------------------------
   ยกตัวตรวจจับท่าทางจาก CareSignal V2 (CareSignal-Vision.html) มาทั้งชุด:
     RepDetector   นับลุกนั่ง 5 ครั้งจากสัดส่วนสะโพก-ลำตัว
     TugTracker    ลุกเดิน 3 เมตร: ลุก → เดินออก (ตัวเล็กลง) → หมุน → กลับ → นั่ง
     BalanceEngine ทรงตัว 4 ท่า มุมมองด้านข้าง: ตรวจท่าเท้า นิ่ง และการขยับเท้า
   สิ่งที่ต่างจาก V2
     · ลูกหลานเป็นคนถือมือถือ จึงเริ่มด้วยกล้องหลัง (สลับได้) ไม่ใช่กล้องหน้า
     · ไม่มีสั่งงานด้วยเสียง ยกมือ หรือรีโมต — ใช้ปุ่มบนจอเท่านั้น (คง TTS บอกขั้นตอน)
     · ไม่มีการยืนยันใบหน้า เรดาร์ หรือโหมดวิจัย
     · ผลกลับไปเข้าหน้าจับเวลาเดิมของ V3 (S.sw) ผู้วัดเห็นตัวเลขแล้วกดบันทึกเอง
       จึงใช้กฎคะแนน การส่งต่อ และใบสรุปชุดเดียวกับการจับเวลาเองทุกอย่าง
   หลักเดิม: ภาพประมวลผลในเครื่อง ไม่มีการอัปโหลดภาพหรือวิดีโอ เก็บเฉพาะตัวเลข
   ผลทรงตัวผ่าน/ไม่ผ่านให้คนยืนยันเสมอ กล้องรายงานสิ่งที่เห็นเท่านั้น
   ============================================================ */
(function (g) {
  var LM = { LSH: 11, RSH: 12, LHIP: 23, RHIP: 24, LKNEE: 25, RKNEE: 26, LANK: 27, RANK: 28, LHEEL: 29, RHEEL: 30, LTOE: 31, RTOE: 32 };
  function midY(lm, a, b) { return (lm[a].y + lm[b].y) / 2; }
  function visOK(lm) {
    var need = [LM.LSH, LM.RSH, LM.LHIP, LM.RHIP, LM.LKNEE, LM.RKNEE, LM.LANK, LM.RANK], seen = 0;
    for (var i = 0; i < need.length; i++) { var v = lm[need[i]]; if (v && (v.visibility === undefined || v.visibility > 0.5)) seen++; }
    return seen / need.length;
  }
  /* M = (ข้อเท้า−สะโพก) ÷ (ข้อเท้า−ไหล่) — ไม่ขึ้นกับระยะกล้องหรือส่วนสูง */
  function hipRatio(lm) {
    var sh = midY(lm, LM.LSH, LM.RSH), hip = midY(lm, LM.LHIP, LM.RHIP), ank = midY(lm, LM.LANK, LM.RANK), span = ank - sh;
    if (!isFinite(span) || Math.abs(span) < 0.02) return null;
    return (ank - hip) / span;
  }
  function shoulderWidth(lm) { return Math.hypot(lm[LM.LSH].x - lm[LM.RSH].x, lm[LM.LSH].y - lm[LM.RSH].y); }

  /* ---------- ตัวนับลุกนั่ง (hysteresis กันสั่น · นาฬิกาเริ่มเมื่อเริ่มขยับ) ---------- */
  function RepDetector(o) {
    o = o || {}; this.sitRef = null; this.standRef = null; this.state = "idle"; this.reps = 0; this.stamps = []; this.t0 = null; this.done = false;
    this.target = o.target || 5; this.upFrac = 0.68; this.downFrac = 0.36; this.buf = []; this.smoothN = 5; this.onsetFrac = 0.18; this.moveStart = null;
  }
  RepDetector.prototype.smooth = function (v) { this.buf.push(v); if (this.buf.length > this.smoothN) this.buf.shift(); var s = 0; for (var i = 0; i < this.buf.length; i++) s += this.buf[i]; return s / this.buf.length; };
  RepDetector.prototype.setRefs = function (sit, stand) { this.sitRef = sit; this.standRef = stand; };
  RepDetector.prototype.start = function (t) { this.state = "sit"; this.reps = 0; this.stamps = []; this.t0 = t; this.done = false; this.buf = []; this.moveStart = null; };
  RepDetector.prototype.elapsedAt = function (t) { return (t - (this.moveStart != null ? this.moveStart : this.t0)) / 1000; };
  RepDetector.prototype.push = function (raw, t) {
    if (this.done || this.state === "idle" || this.sitRef == null || this.standRef == null) return null;
    var v = this.smooth(raw), range = this.standRef - this.sitRef, up = this.sitRef + range * this.upFrac, down = this.sitRef + range * this.downFrac;
    if (this.moveStart === null && this.state === "sit" && v >= this.sitRef + range * this.onsetFrac) { this.moveStart = t; return { event: "onset" }; }
    if (this.state === "sit" && v >= up) {
      if (this.moveStart === null) this.moveStart = t;
      this.state = "stand"; this.reps++; this.stamps.push(t);
      if (this.reps >= this.target) { this.done = true; return { event: "finish", reps: this.reps, elapsed: this.elapsedAt(t) }; }
      return { event: "rep", reps: this.reps };
    }
    if (this.state === "stand" && v <= down) { this.state = "sit"; return { event: "down", reps: this.reps }; }
    return null;
  };

  /* ---------- ลุกเดิน 3 เมตร: ใช้ขนาดตัวในภาพเป็นมาตรวัดระยะ ---------- */
  function TugTracker(refs) {
    this.sitRef = refs.sitRef; this.standRef = refs.standRef; this.goAt = null;
    this.state = "waiting"; this.t0 = null; this.tTurn = null; this.t1 = null; this.buf = []; this.onsetFrac = 0.18;
    this.s0 = null; this.s0buf = []; this.sMin = null; this.sw = null; this.cx0 = null; this.maxDrift = 0; this.driftSum = 0; this.driftN = 0;
  }
  TugTracker.prototype.pushFrame = function (raw, sw, cx, t) {
    this.buf.push(raw); if (this.buf.length > 5) this.buf.shift();
    var v = this.buf.reduce(function (a, b) { return a + b; }, 0) / this.buf.length, range = this.standRef - this.sitRef;
    var onset = this.sitRef + range * this.onsetFrac, up = this.sitRef + range * 0.68, down = this.sitRef + range * 0.36;
    if (sw && sw > 0.01) this.sw = this.sw == null ? sw : this.sw * 0.8 + sw * 0.2;
    if (this.state === "waiting" && v >= onset) { this.state = "rising"; this.t0 = t; return { event: "onset" }; }
    if (this.state === "rising" && v >= up) { this.state = "standing"; this.s0buf = []; return { event: "stand" }; }
    if (this.state === "standing") {
      if (this.sw != null) this.s0buf.push(this.sw);
      if (this.s0buf.length >= 15) { this.s0buf.sort(function (a, b) { return a - b; }); this.s0 = this.s0buf[Math.floor(this.s0buf.length / 2)]; this.sMin = this.s0; this.cx0 = cx; this.state = "walkOut"; return { event: "walk" }; }
      return null;
    }
    if ((this.state === "walkOut" || this.state === "walkBack") && this.sw != null && this.s0) {
      if (this.sw < this.sMin) this.sMin = this.sw;
      if (cx != null && this.cx0 != null) { var d = Math.abs(cx - this.cx0) / this.sw; if (d > this.maxDrift) this.maxDrift = d; this.driftSum += d; this.driftN++; }
      if (this.state === "walkOut" && this.sMin <= this.s0 * 0.90 && this.sw >= this.sMin * 1.07) { this.state = "walkBack"; this.tTurn = t; return { event: "turn" }; }
    }
    if ((this.state === "walkOut" || this.state === "walkBack") && v <= down && this.t0 && (t - this.t0) > 4000) {
      this.state = "done"; this.t1 = t; var base = this.goAt != null ? this.goAt : this.t0;
      return { event: "finish", elapsed: (t - base) / 1000, reaction: this.goAt != null ? (this.t0 - this.goAt) / 1000 : null,
        out: this.tTurn ? (this.tTurn - base) / 1000 : null, back: this.tTurn ? (this.t1 - this.tTurn) / 1000 : null,
        distanceOk: this.s0 != null && this.sMin <= this.s0 * 0.82, turnSeen: this.tTurn != null, drift: this.driftN ? { max: this.maxDrift, avg: this.driftSum / this.driftN } : null };
    }
    return null;
  };
  function gaitLabel(d) { if (!d) return "วัดไม่ได้"; return d.max < 0.8 ? "เดินตรงดี" : d.max < 1.6 ? "เบี่ยงเล็กน้อย" : "เบี่ยงมาก ควรเฝ้าระวัง"; }

  /* ---------- ทรงตัว 4 ท่า มุมมองด้านข้าง (เท้าเป็นหลัก · หน่วย = ความยาวเท้า) ---------- */
  var STANCE_NM = ["เท้าชิด", "กึ่งต่อเท้า", "ต่อเท้า", "ยกขาข้างหนึ่ง"];
  function BalanceEngine(stage) {
    this.stage = stage; this.state = "search"; this.c = null; this.torso = null; this.stillN = 0; this.lostN = 0; this.badN = 0;
    this.refC = null; this.refFeet = null; this.refLift = null; this.samples = []; this.liftWarned = false; this.lastLm = null;
    this.stHist = []; this.startStance = null; this.hn = 0; this.hFeet = 0; this.dropN = 0; this.dropped = false; this.stepAt = null;
  }
  BalanceEngine.prototype._read = function (lm) {
    if (!lm) return null;
    function vis(i) { var p = lm[i]; return p && (p.visibility === undefined || p.visibility > 0.4); }
    if (!(vis(LM.LSH) && vis(LM.RSH) && vis(LM.LHIP) && vis(LM.RHIP))) return null;
    var sh = { x: (lm[LM.LSH].x + lm[LM.RSH].x) / 2, y: (lm[LM.LSH].y + lm[LM.RSH].y) / 2 }, hp = { x: (lm[LM.LHIP].x + lm[LM.RHIP].x) / 2, y: (lm[LM.LHIP].y + lm[LM.RHIP].y) / 2 };
    var torso = Math.hypot(sh.x - hp.x, sh.y - hp.y); if (!isFinite(torso) || torso < 0.04) return null;
    var sideOk = Math.abs(lm[LM.LSH].x - lm[LM.RSH].x) / torso < 0.5, f = null;
    if (vis(LM.LANK) && vis(LM.RANK)) {
      function foot(ank, heel, toe) { var xs = [lm[ank].x], ys = [lm[ank].y]; if (vis(heel)) { xs.push(lm[heel].x); ys.push(lm[heel].y); } if (vis(toe)) { xs.push(lm[toe].x); ys.push(lm[toe].y); } var n = xs.length, sx = 0, sy = 0; for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; } return { x: sx / n, y: sy / n }; }
      var Lc = foot(LM.LANK, LM.LHEEL, LM.LTOE), Rc = foot(LM.RANK, LM.RHEEL, LM.RTOE);
      var flL = vis(LM.LHEEL) && vis(LM.LTOE) ? Math.hypot(lm[LM.LTOE].x - lm[LM.LHEEL].x, lm[LM.LTOE].y - lm[LM.LHEEL].y) : null;
      var flR = vis(LM.RHEEL) && vis(LM.RTOE) ? Math.hypot(lm[LM.RTOE].x - lm[LM.RHEEL].x, lm[LM.RTOE].y - lm[LM.RHEEL].y) : null;
      var unit = flL && flR ? (flL + flR) / 2 : (flL || flR || torso * 0.55); if (!isFinite(unit) || unit < 0.02) unit = torso * 0.55;
      f = { L: Lc, R: Rc, unit: unit, gap: Math.abs(Lc.x - Rc.x) / unit, lift: Math.abs(lm[LM.LANK].y - lm[LM.RANK].y) / unit };
    }
    return { c: { x: (sh.x + hp.x) / 2 / torso, y: (sh.y + hp.y) / 2 / torso }, torso: torso, sideOk: sideOk, feet: f };
  };
  BalanceEngine.prototype._stance = function (f) { if (!f) return null; if (f.lift > 0.65) return 3; if (f.gap < 0.40) return 0; if (f.gap < 0.90) return 1; return 2; };
  BalanceEngine.prototype.frame = function (lm) {
    this.lastLm = lm; var r = this._read(lm);
    if (!r) { this.lostN++; this.stillN = 0; return { seen: false, lost: this.lostN, ready: false, fail: this.state === "hold" && this.lostN > 75, why: "กล้องมองไม่เห็นตัวนานเกินไป" }; }
    this.lostN = 0; var prev = this.c;
    this.c = prev ? { x: prev.x * 0.7 + r.c.x * 0.3, y: prev.y * 0.7 + r.c.y * 0.3 } : r.c;
    var mv = prev ? Math.hypot(this.c.x - prev.x, this.c.y - prev.y) : 9;
    var st = r.sideOk ? this._stance(r.feet) : null; this.stHist.push(st); if (this.stHist.length > 15) this.stHist.shift();
    var cnt = {}, best = null, bn = 0; for (var i = 0; i < this.stHist.length; i++) { var v = this.stHist[i]; if (v == null) continue; cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bn) { bn = cnt[v]; best = v; } }
    var stanceSeen = bn >= 8 ? best : null;
    if (this.state !== "hold") {
      if (mv < 0.02) this.stillN++; else this.stillN = 0;
      var ready = this.stillN >= 12; this.state = ready ? "steady" : "search";
      return { seen: true, ready: ready, stance: stanceSeen, stanceOk: stanceSeen == null ? null : stanceSeen === this.stage, sideOk: r.sideOk };
    }
    this.samples.push({ x: this.c.x, y: this.c.y }); this.hn++; if (r.feet) this.hFeet++;
    var res = { seen: true, ready: true, fail: false, why: null, dropped: false, remind: null };
    if (this.refC && (this.c.y - this.refC.y) > 0.55) this.dropN++; else this.dropN = 0;
    if (this.dropN >= 8) { this.dropped = true; res.fail = true; res.dropped = true; res.why = "กล้องเห็นว่านั่งลงหรือทรุดตัว"; return res; }
    if (r.feet && this.refFeet) {
      if (this.stage === 3) { if (this.refLift != null && this.refLift > 0.55 && r.feet.lift < Math.max(0.25, this.refLift * 0.4)) this.badN++; else this.badN = 0; res.why = "เท้าที่ยกลงแตะพื้น"; }
      else { var d = Math.max(Math.hypot(r.feet.L.x - this.refFeet.L.x, r.feet.L.y - this.refFeet.L.y), Math.hypot(r.feet.R.x - this.refFeet.R.x, r.feet.R.y - this.refFeet.R.y)) / this.refFeet.unit; if (d > 0.9) this.badN++; else this.badN = 0; res.why = "ขยับเท้าออกจากตำแหน่งเดิม"; }
    } else { this.badN = 0; res.noFeet = true; }
    if (this.badN >= 10) { res.fail = true; res.stepped = true; if (this.stepAt == null) this.stepAt = this.hn / 30; }
    if (this.stage === 3 && r.feet && !this.liftWarned && this.samples.length > 50 && r.feet.lift < 0.45) { this.liftWarned = true; res.remind = "อย่าลืมยกเท้าข้างหนึ่งขึ้นจากพื้น"; }
    return res;
  };
  BalanceEngine.prototype.beginHold = function () {
    this.state = "hold"; this.samples = []; this.badN = 0; this.lostN = 0; var r = this._read(this.lastLm);
    this.refC = r ? r.c : this.c; this.refFeet = r ? r.feet : null; this.refLift = r && r.feet ? r.feet.lift : null; this.startStance = r && r.sideOk ? this._stance(r.feet) : null;
  };
  BalanceEngine.prototype.observe = function () {
    var feetRatio = this.hn ? this.hFeet / this.hn : 0, obs = [], suggest = "pass";
    if (this.dropped) { obs.push("เห็นว่านั่งลงหรือทรุดตัวระหว่างทดสอบ"); suggest = "fail"; }
    if (this.stepAt != null) { obs.push("เห็นการขยับเท้าที่ประมาณวินาทีที่ " + this.stepAt.toFixed(0)); suggest = "fail"; }
    if (this.lostN > 30) { obs.push("หลุดออกนอกกรอบภาพบางช่วง"); suggest = "unsure"; }
    if (feetRatio < 0.5) { obs.push("กล้องมองไม่เห็นเท้าชัดตลอดการทดสอบ"); if (suggest === "pass") suggest = "unsure"; }
    if (!obs.length) obs.push("ไม่พบการขยับเท้าและไม่พบการทรุดตัว");
    return { obs: obs, suggest: suggest, feetSeen: Math.round(feetRatio * 100) };
  };

  /* ---------- โมเดลตรวจจับท่าทาง (heavy → full → lite ตามที่เครื่องรับไหว) ---------- */
  var POSE = null, POSE_LEVELS = [
    { k: "heavy", nm: "ละเอียดสูงสุด", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task" },
    { k: "full", nm: "ละเอียดสูง", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task" },
    { k: "lite", nm: "มาตรฐาน", u: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" }];
  var PERF = { n: 0, sum: 0, noted: false }, POSE_COUNT = 0;
  async function loadModel(say) {
    if (POSE) return POSE;
    var mod = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");
    var fileset = await mod.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    var start = 0; try { var si = POSE_LEVELS.findIndex(function (l) { return l.k === localStorage.getItem("cs-pose-model"); }); if (si > 0) start = si; } catch (e) {}
    for (var i = start; i < POSE_LEVELS.length; i++) {
      var L = POSE_LEVELS[i]; if (say) say("กำลังโหลดโมเดล" + L.nm + "…");
      try {
        POSE = await mod.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: L.u, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 2, minPoseDetectionConfidence: .6, minPosePresenceConfidence: .6, minTrackingConfidence: .6 });
        POSE.modelLevel = L.k; try { localStorage.setItem("cs-pose-model", L.k); } catch (e2) {}
        return POSE;
      } catch (e3) { POSE = null; }
    }
    throw new Error("model-load-failed");
  }
  function detectPose(video) {
    if (!POSE) return null;
    var t = performance.now(), r = null;
    try { r = POSE.detectForVideo(video, t); } catch (e) { POSE_COUNT = 0; return null; }
    POSE_COUNT = r && r.landmarks ? r.landmarks.length : 0;
    PERF.n++; PERF.sum += performance.now() - t;
    if (!PERF.noted && PERF.n >= 150 && PERF.sum / PERF.n > 110) {
      PERF.noted = true; var i = POSE_LEVELS.findIndex(function (l) { return l.k === POSE.modelLevel; });
      if (i >= 0 && i < POSE_LEVELS.length - 1) { try { localStorage.setItem("cs-pose-model", POSE_LEVELS[i + 1].k); } catch (e2) {} }
    }
    return r && r.landmarks && r.landmarks[0] ? r.landmarks[0] : null;
  }
  function drawPose(ctx, canvas, video, lm) {
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    ctx.clearRect(0, 0, canvas.width, canvas.height); if (!lm) return;
    var pairs = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]];
    ctx.lineWidth = Math.max(3, canvas.width / 150); ctx.strokeStyle = "rgba(23,179,161,.9)"; ctx.lineCap = "round";
    pairs.forEach(function (p) { var a = lm[p[0]], b = lm[p[1]]; if (!a || !b) return; ctx.beginPath(); ctx.moveTo(a.x * canvas.width, a.y * canvas.height); ctx.lineTo(b.x * canvas.width, b.y * canvas.height); ctx.stroke(); });
    [11, 12, 23, 24, 25, 26, 27, 28].forEach(function (i) { var p = lm[i]; if (!p) return; ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(4, canvas.width / 110), 0, 6.3); ctx.fillStyle = (i === 23 || i === 24) ? "#FCD34D" : "#DBEAFE"; ctx.fill(); });
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

  var UI = null, RAF = null, STREAM = null, FACING = "environment", CD = null;
  function $(id) { return UI ? UI.querySelector("#" + id) : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function status(color, text) { var l = $("csL"), t = $("csT"); if (l) l.style.background = { green: "#0E9F6E", yellow: "#F5B93E", red: "#DC2626" }[color] || "#F5B93E"; if (t) t.textContent = text; }
  function coach(html) { var c = $("csC"); if (c) c.innerHTML = html; }
  function buttons(list) {
    var b = $("csB"); if (!b) return; b.innerHTML = "";
    list.forEach(function (x) {
      if (x.row) { var r = document.createElement("div"); r.className = "row"; x.row.forEach(function (y) { r.appendChild(mk(y)); }); b.appendChild(r); return; }
      b.appendChild(mk(x));
    });
    function mk(x) { var e = document.createElement("button"); e.textContent = x.t; if (x.cls) e.className = x.cls; e.disabled = !!x.dis; if (x.id) e.id = x.id; e.addEventListener("click", x.fn); return e; }
  }
  function cdCancel() { if (CD) { clearInterval(CD); CD = null; } }
  /* นับถอยหลัง 3-2-1 ยกเลิกได้ */
  function countdown(text, fire) {
    cdCancel(); var n = 3, W = { 3: "สาม", 2: "สอง", 1: "หนึ่ง" };
    status("green", text + " — เตรียมตัว " + n); speak(text + " เตรียมตัว สาม");
    CD = setInterval(function () { n--; if (n >= 1) { status("green", "เตรียมตัว… " + n); speak(W[n]); } else { cdCancel(); status("green", "เริ่ม"); speak("เริ่ม"); fire(); } }, 1000);
  }
  function close() {
    cdCancel(); if (RAF) cancelAnimationFrame(RAF); RAF = null;
    if (STREAM) { STREAM.getTracks().forEach(function (t) { t.stop(); }); STREAM = null; }
    try { speechSynthesis.cancel(); } catch (e) {}
    if (UI) UI.remove(); UI = null;
  }
  function seatedOf(m, refs) { return m != null && m <= refs.sitRef + (refs.standRef - refs.sitRef) * 0.22; }

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
    status("yellow", "กำลังเปิดกล้อง กรุณารอสักครู่");
    try { STREAM = await navigator.mediaDevices.getUserMedia({ video: { facingMode: FACING, width: { ideal: 720 }, height: { ideal: 1280 } }, audio: false }); }
    catch (e) { if (FACING !== "user") { FACING = "user"; close(); return open(opts); } tag.textContent = "เปิดกล้องไม่ได้"; status("red", "เปิดกล้องไม่ได้ — อนุญาตกล้องในเบราว์เซอร์ หรือจับเวลาเองแทน"); buttons([{ t: "จับเวลาเองแทน", fn: function () { close(); if (opts.onManual) opts.onManual(); } }]); return; }
    if (!UI) return;
    video.srcObject = STREAM;
    await Promise.race([video.play().catch(function () {}), new Promise(function (r) { setTimeout(r, 1500); })]);
    status("yellow", "กำลังโหลดระบบตรวจจับท่าทาง (ครั้งแรกใช้เน็ต)");
    try { await loadModel(function (t) { tag.textContent = t; }); }
    catch (e) { if (!UI) return; tag.textContent = "โหลดโมเดลไม่สำเร็จ"; status("red", "โหลดระบบไม่สำเร็จ — ต้องต่ออินเทอร์เน็ตครั้งแรก หรือจับเวลาเองแทน"); buttons([{ t: "จับเวลาเองแทน", fn: function () { close(); if (opts.onManual) opts.onManual(); } }]); return; }
    if (!UI) return;
    tag.textContent = "ตรวจจับท่าทางแล้ว";
    var fin = function (res) { close(); opts.onDone(res); };
    if (opts.kind === "balance") return runBalance(video, canvas, ctx, opts, fin);
    var refs = opts.refs && opts.refs.sitRef != null ? opts.refs : null;
    var afterCalib = function (r) { if (opts.kind === "ftsst") runFtsst(video, canvas, ctx, r, fin); else runTug(video, canvas, ctx, r, fin); };
    if (refs) afterCalib(refs); else runCalib(video, canvas, ctx, opts, afterCalib);
  }

  /* สอบเทียบ: ผู้วัดกดบันทึกท่านั่งและท่ายืน (กล้องช่วยนับถอยหลังเมื่อนิ่ง) */
  function runCalib(video, canvas, ctx, opts, done) {
    var sitVal = null, standVal = null, cur = null, H = [], want = "sit", arming = false;
    coach("<b>ขั้นเตรียม</b> ให้ผู้สูงอายุ<b>นั่ง</b>บนเก้าอี้ก่อน ถือมือถือให้เห็นตั้งแต่ศีรษะถึงเท้า");
    speak("ขั้นเตรียม ให้ผู้สูงอายุนั่งบนเก้าอี้ก่อน แล้วกดบันทึกท่านั่ง");
    function btns() {
      buttons([{ t: sitVal == null ? "บันทึกท่านั่ง" : "บันทึกท่านั่งใหม่", cls: sitVal == null ? "" : "sec", id: "cSit", dis: cur == null, fn: function () { cap("sit"); } },
        { t: standVal == null ? "บันทึกท่ายืน" : "บันทึกท่ายืนใหม่", cls: standVal == null ? "" : "sec", id: "cStand", dis: cur == null, fn: function () { cap("stand"); } }]);
    }
    function cap(kind) {
      cdCancel(); arming = false;
      if (cur == null) { status("yellow", "ยังเห็นตัวไม่ชัด ขยับให้เห็นทั้งตัว"); return; }
      if (kind === "sit") { sitVal = cur; want = "stand"; speak("บันทึกท่านั่งแล้ว ให้ผู้สูงอายุยืนขึ้น แล้วกดบันทึกท่ายืน"); coach("<b>บันทึกท่านั่งแล้ว ✓</b> ให้ผู้สูงอายุ<b>ยืนขึ้น</b> แล้วกดบันทึกท่ายืน"); }
      else { standVal = cur; want = "sit"; speak("บันทึกท่ายืนแล้ว"); coach("<b>บันทึกท่ายืนแล้ว ✓</b>"); }
      btns();
      if (sitVal != null && standVal != null) {
        if (standVal - sitVal < 0.045) { status("red", "ค่าท่านั่งกับท่ายืนต่างกันน้อยเกินไป บันทึกใหม่ทีละท่า"); speak("ค่าสองท่าต่างกันน้อยเกินไป บันทึกใหม่ทีละท่า"); sitVal = null; standVal = null; want = "sit"; btns(); return; }
        status("green", "สอบเทียบเรียบร้อย"); if (RAF) cancelAnimationFrame(RAF); RAF = null;
        setTimeout(function () { if (UI) done({ sitRef: sitVal, standRef: standVal }); }, 600);
      }
    }
    btns();
    function loop() {
      if (!UI) return;
      var lm = detectPose(video); drawPose(ctx, canvas, video, lm); var ok = false;
      if (lm) {
        var q = visOK(lm), m = hipRatio(lm);
        if (q < 0.85) { cur = null; status("yellow", "ยังเห็นตัวไม่ครบ ถอยมือถือให้เห็นตั้งแต่หัวถึงเท้า"); }
        else if (m == null) { cur = null; status("yellow", "ถอยห่างอีกนิด ให้เห็นทั้งตัว"); }
        else { cur = m; ok = true; H.push(m); if (H.length > 14) H.shift(); if (!arming) status("green", "เห็นตัวชัดแล้ว กด" + (want === "sit" ? "บันทึกท่านั่ง" : "บันทึกท่ายืน") + " หรือรอให้นับถอยหลัง"); }
      } else { cur = null; status("yellow", "ยังไม่พบคนในภาพ"); }
      var bs = $("cSit"), bt = $("cStand"); if (bs) bs.disabled = !ok; if (bt) bt.disabled = !ok;
      if (!ok) { H.length = 0; if (arming) { cdCancel(); arming = false; } }
      var steady = H.length >= 14 && (Math.max.apply(null, H) - Math.min.apply(null, H)) < 0.012;
      var need = want === "sit" ? sitVal == null : standVal == null;
      var far = want === "sit" || (sitVal != null && cur - sitVal >= 0.045);
      if (ok && steady && need && far && !arming) { arming = true; var k = want; countdown(k === "sit" ? "เห็นว่านั่งแล้ว" : "เห็นว่ายืนแล้ว", function () { cap(k); }); }
      RAF = requestAnimationFrame(loop);
    }
    loop();
  }

  function runFtsst(video, canvas, ctx, refs, done) {
    var DET = new RepDetector({ target: 5 }); DET.setRefs(refs.sitRef, refs.standRef);
    var running = false, t0 = 0, lastEvt = 0, readySince = null, arming = false, stallShown = false;
    $("csOf").textContent = "/ 5 ครั้ง"; $("csTrkW").hidden = false;
    coach("ให้ผู้สูงอายุ<b>นั่ง กอดอก</b> เมื่อพร้อมกด <b>เริ่ม</b> หรือรอให้นับถอยหลัง<br>ลุกยืนให้สุด นั่งให้ก้นแตะเก้าอี้ ทำต่อเนื่อง 5 ครั้ง");
    speak("ทดสอบลุกนั่ง ห้าครั้ง ให้ผู้สูงอายุนั่ง กอดอก เมื่อพร้อม กดเริ่ม");
    function stopManual() { close(); done({ kind: "ftsst", manual: true, reps: DET.reps }); }
    function btns() { buttons(running ? [{ t: "นับไม่ขึ้น · หยุดแล้วจับเวลาเอง", cls: "sec", fn: stopManual }] : [{ t: "▶ เริ่มจับเวลา", id: "cGo", fn: begin }]); }
    function begin() {
      if (running) return; cdCancel(); arming = false; running = true; t0 = performance.now(); lastEvt = t0; DET.start(t0);
      status("green", "เริ่มได้เลย นาฬิกาจะเดินเมื่อเริ่มลุก"); speak("เริ่มได้เลย"); coach("ลุกยืนให้สุด แล้วนั่งลงให้สุด ทำต่อเนื่อง"); btns();
    }
    btns();
    function loop() {
      if (!UI) return;
      var lm = detectPose(video); drawPose(ctx, canvas, video, lm);
      if (lm) {
        var q = visOK(lm), m = hipRatio(lm);
        $("csTag").textContent = "คุณภาพภาพ " + Math.round(q * 100) + "%";
        if (m != null && running) {
          var ev = DET.push(m, performance.now());
          $("csN").textContent = DET.reps; $("csTrk").style.width = (DET.reps / 5 * 100) + "%";
          if (ev && (ev.event === "rep" || ev.event === "down")) lastEvt = performance.now();
          if (ev && ev.event === "rep") { status("green", "นับได้ " + ev.reps + " จาก 5 ครั้ง"); speak(["", "หนึ่ง", "สอง", "สาม", "สี่"][ev.reps]); }
          if (ev && ev.event === "finish") { if (RAF) cancelAnimationFrame(RAF); RAF = null; finishFtsst(ev); return; }
        } else if (m != null && !running) {
          var seated = m < (refs.sitRef + refs.standRef) / 2 && q >= 0.8;
          if (seated) { if (readySince == null) readySince = performance.now(); if (!arming && performance.now() - readySince > 2500) { arming = true; countdown("เห็นท่านั่งพร้อมแล้ว", begin); } if (!arming) status("green", "เห็นท่านั่งแล้ว กดเริ่ม หรือรอนับถอยหลัง"); }
          else { readySince = null; if (arming) { cdCancel(); arming = false; } status("yellow", "ให้ผู้สูงอายุนั่งลงบนเก้าอี้ก่อน"); }
        }
        if (q < 0.8 && !running) status("yellow", "เห็นตัวไม่ครบ ขยับมือถือให้เห็นทั้งตัว");
      } else { $("csTag").textContent = "ยังไม่พบคนในภาพ"; readySince = null; }
      if (running) {
        $("csClk").textContent = ((performance.now() - t0) / 1000).toFixed(1) + " วิ";
        if (performance.now() - lastEvt > 20000 && !stallShown) { stallShown = true; status("red", "ระบบนับไม่ขึ้น ลุกให้สุด นั่งให้สุด หรือกดปุ่มจับเวลาเอง"); }
      }
      RAF = requestAnimationFrame(loop);
    }
    loop();
    function finishFtsst(ev) {
      var gaps = []; for (var i = 1; i < DET.stamps.length; i++) gaps.push(Math.round((DET.stamps[i] - DET.stamps[i - 1]) / 100) / 10);
      var cv = null; if (gaps.length > 1) { var mean = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length, sd = Math.sqrt(gaps.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / gaps.length); cv = mean > 0 ? Math.round(sd / mean * 100) / 100 : null; }
      var sec = Math.round(ev.elapsed * 10) / 10;
      status("green", "ครบ 5 ครั้ง ใช้เวลา " + sec.toFixed(1) + " วินาที"); speak("ครบห้าครั้ง ใช้เวลา " + Math.round(sec) + " วินาที");
      setTimeout(function () { done({ kind: "ftsst", sec: sec, reps: DET.reps, gaps: gaps, cv: cv, refs: refs }); }, 1200);
    }
  }

  function runTug(video, canvas, ctx, refs, done) {
    var phase = "waitSit", TUG = null, seatedN = 0, arming = false;
    $("csOf").textContent = "วินาที"; $("csN").textContent = "0.0";
    coach("<b>เตรียม:</b> ทำจุดหมายห่างเก้าอี้ 3 เมตร · ผู้สูงอายุนั่งพิงพนัก · ถือมือถือให้เห็นทั้งเก้าอี้และทางเดิน<br>เมื่อได้ยิน “เริ่ม” → ลุก เดินไปจุดหมาย หมุนกลับ มานั่งลง");
    speak("ลุกเดินสามเมตร ให้ผู้สูงอายุนั่งพิงพนักเก้าอี้ ถือมือถือให้เห็นทั้งเก้าอี้และทางเดิน เมื่อพร้อม กดเริ่ม");
    function manual() { close(); done({ kind: "tug", manual: true }); }
    function btns() { buttons(phase === "waitSit" ? [{ t: "▶ เริ่มทดสอบ", fn: start }] : [{ t: "ระบบไม่หยุด · จับเวลาเองแทน", cls: "sec", fn: manual }]); }
    function start() { if (phase !== "waitSit") return; cdCancel(); phase = "arming"; countdown("พร้อมทดสอบ", begin); btns(); }
    function begin() { phase = "active"; TUG = new TugTracker(refs); TUG.goAt = performance.now(); status("green", "เริ่ม — ลุกขึ้น เดินไปจุดหมาย หมุนกลับ มานั่งลง"); speak("เริ่ม ลุกขึ้น เดินไปที่จุดหมาย หมุนกลับ แล้วกลับมานั่งลง"); coach("ลุกขึ้น → เดินไปจุดหมาย → หมุนกลับ → นั่งลงพิงพนัก"); btns(); }
    btns();
    function loop() {
      if (!UI) return;
      var lm = detectPose(video); drawPose(ctx, canvas, video, lm); var m = lm ? hipRatio(lm) : null;
      if (phase === "waitSit") {
        var seated = seatedOf(m, refs); if (seated) seatedN++; else seatedN = 0;
        if (!lm) status("yellow", "ขยับให้กล้องเห็นทั้งตัวและเก้าอี้"); else if (seated) { if (!arming) status("green", "เห็นว่านั่งอยู่แล้ว กดเริ่ม หรือรอนับถอยหลัง"); } else status("yellow", "ให้ผู้สูงอายุกลับมานั่งพิงพนักก่อน");
        if (seatedN >= 45 && !arming) { arming = true; start(); }
      } else if (phase === "active" && lm && m != null) {
        var ev = TUG.pushFrame(m, shoulderWidth(lm), (lm[LM.LSH].x + lm[LM.RSH].x) / 2, performance.now());
        var PH = { waiting: "รอลุก", rising: "กำลังลุก", standing: "ยืนแล้ว", walkOut: "ขาไป", walkBack: "ขากลับ" }; $("csTag").textContent = PH[TUG.state] || "";
        if (ev && ev.event === "walk") { coach("เดินไปให้ถึงจุดหมาย 3 เมตร"); speak("เดินไปที่จุดหมายได้เลย"); }
        if (ev && ev.event === "turn") { coach("ถึงจุดกลับแล้ว เดินกลับมานั่งลง"); speak("เดินกลับมานั่งลงได้เลย"); }
        if (ev && ev.event === "finish") { if (RAF) cancelAnimationFrame(RAF); RAF = null; finishTug(ev); return; }
      }
      if (phase === "active" && TUG) { var el = (performance.now() - TUG.goAt) / 1000; $("csN").textContent = el.toFixed(1); if (el > 75) coach("นั่งลงแล้วระบบไม่หยุด? กดปุ่มด้านล่างเพื่อจับเวลาเอง"); }
      RAF = requestAnimationFrame(loop);
    }
    loop();
    function finishTug(ev) {
      var sec = Math.round(ev.elapsed * 10) / 10;
      status(sec >= 12 ? "yellow" : "green", "เสร็จสิ้น ใช้เวลา " + sec.toFixed(1) + " วินาที · " + (ev.distanceOk ? "เดินครบระยะ" : "ระยะอาจไม่ครบ 3 เมตร") + " · " + gaitLabel(ev.drift));
      speak("เสร็จสิ้น ใช้เวลา " + Math.round(sec) + " วินาที");
      setTimeout(function () { done({ kind: "tug", sec: sec, out: ev.out != null ? Math.round(ev.out * 10) / 10 : null, back: ev.back != null ? Math.round(ev.back * 10) / 10 : null, distanceOk: !!ev.distanceOk, drift: ev.drift ? Math.round(ev.drift.max * 100) / 100 : null, gait: gaitLabel(ev.drift), reaction: ev.reaction != null ? Math.round(ev.reaction * 10) / 10 : null, refs: refs }); }, 1400);
    }
  }

  function runBalance(video, canvas, ctx, opts, done) {
    var stage = opts.stage || 0, NM = opts.stageNames || ["ยืนเท้าชิดกัน", "ยืนเท้าเหลื่อม", "ยืนต่อเท้า", "ยืนขาเดียว"], SEC = 10;
    var ENG = new BalanceEngine(stage), phase = "setup", t0 = 0, armed = false, halfWarned = false, extraN = 0, pending = null;
    var chips = $("csChips"); chips.hidden = false; chips.innerHTML = NM.map(function (n, i) { return '<span class="' + (i < stage ? "ok" : i === stage ? "on" : "") + '">' + (i + 1) + " " + esc(n.replace(/^ยืน/, "")) + "</span>"; }).join("");
    $("csOf").textContent = "วินาที"; $("csN").textContent = SEC; $("csTrkW").hidden = false;
    coach("<b>ท่าที่ " + (stage + 1) + " · " + esc(NM[stage]) + "</b><br>" + esc(opts.how || "") + "<br>ให้ผู้สูงอายุ<b>ยืนหันข้าง</b>ให้กล้อง ห่าง 2–3 เมตร ลูกหลานยืนอีกข้างพร้อมพยุง");
    speak("ท่าที่ " + (stage + 1) + " " + NM[stage] + " ยืนหันข้างให้กล้อง เมื่อพร้อม กดเริ่ม");
    function btnsSetup() { buttons([{ t: "▶ เริ่มท่านี้", fn: function () { startCd(); } }]); }
    function btnsHold() { buttons([{ t: "■ หยุดเพื่อความปลอดภัย", cls: "no", fn: function () { endStage(Math.min((performance.now() - t0) / 1000, SEC), "หยุดเพื่อความปลอดภัย", true); } }]); }
    function startCd(text) { if (phase !== "setup") return; cdCancel(); phase = "arming"; buttons([]); countdown(text || "พร้อมแล้ว", beginHold); }
    function beginHold() { phase = "holding"; t0 = performance.now(); ENG.beginHold(); halfWarned = false; extraN = 0; status("green", "กำลังจับเวลา ยืนนิ่ง 10 วินาที ลืมตาไว้"); speak("เริ่มจับเวลา ยืนนิ่ง ๆ สิบวินาที"); coach("<b>" + esc(NM[stage]) + "</b> ยืนนิ่ง ๆ อย่าขยับเท้า"); btnsHold(); }
    function endStage(held, reason, safety) {
      if (phase !== "holding") return; phase = "confirm"; cdCancel();
      var o = ENG.observe(); if (extraN > 20) o.obs.push("เห็นคนมากกว่าหนึ่งคนในภาพ หากมีการช่วยพยุงถือว่าไม่ผ่าน");
      pending = { held: Math.round(held * 10) / 10, reason: reason || null, o: o };
      var full = held >= SEC - 0.3;
      $("csObs").hidden = false; $("csObs").innerHTML = "<b>กล้องสังเกตเห็น</b> (ข้อมูลประกอบ ไม่ใช่คำตัดสิน)<br>· " + o.obs.map(esc).join("<br>· ") + "<br>· เห็นเท้าชัด " + o.feetSeen + "% ของเวลา";
      status(o.suggest === "fail" ? "yellow" : "green", (full ? "ครบ 10 วินาที" : "หยุดที่ " + held.toFixed(1) + " วินาที") + " — ลูกหลานยืนยันผล: ยืนได้โดยไม่ขยับเท้าและไม่จับพยุงไหม");
      coach("<b>กรุณายืนยันผล</b> เกณฑ์ CDC: ยืนครบ 10 วินาที โดยไม่ขยับเท้าและไม่ต้องจับพยุง");
      speak((full ? "ครบสิบวินาที " : "หยุดที่ " + held.toFixed(0) + " วินาที ") + "กรุณายืนยันผลบนหน้าจอ");
      if (safety) return settle(false);
      buttons([{ t: "✓ ผ่าน — ยืนครบโดยไม่ขยับเท้า", fn: function () { settle(true); }, dis: !full },
        { t: "✗ ไม่ผ่าน — ขยับเท้าหรือต้องจับพยุง", cls: "sec", fn: function () { settle(false); } }]);
    }
    function settle(pass) {
      if (!pending) return; var p = pending; pending = null; phase = "done";
      done({ kind: "balance", stage: stage, held: p.held, pass: !!pass, obs: p.o.obs, suggest: p.o.suggest, feetSeen: p.o.feetSeen, reason: p.reason });
    }
    btnsSetup();
    function loop() {
      if (!UI) return;
      var lm = detectPose(video); drawPose(ctx, canvas, video, lm);
      if (phase === "setup") {
        var gg = ENG.frame(lm);
        if (!gg.seen) status("yellow", "ถอยให้กล้องเห็นทั้งตัว แล้วให้ยืนหันข้าง");
        else if (gg.sideOk === false && !armed) status("yellow", "หันข้างให้กล้อง เพื่อให้เห็นตำแหน่งเท้าชัด");
        else if (gg.ready && (gg.stanceOk || gg.stance == null)) { if (!armed) { armed = true; startCd(gg.stanceOk ? "จัดเท้าถูกต้องแล้ว" : "พร้อมแล้ว"); } }
        else if (gg.ready && gg.stanceOk === false) status("yellow", "กล้องเห็นท่า: " + STANCE_NM[gg.stance] + " — จัดเท้าเป็นท่า " + NM[stage]);
        else if (!armed) status("yellow", "ยืนนิ่ง ๆ ในท่า " + NM[stage]);
      } else if (phase === "holding") {
        var h = ENG.frame(lm), el = (performance.now() - t0) / 1000;
        $("csN").textContent = Math.max(0, SEC - el).toFixed(0); $("csTrk").style.width = Math.min(100, el / SEC * 100) + "%";
        if (POSE_COUNT > 1) extraN++;
        if (h.remind) speak(h.remind);
        if (!halfWarned && el >= SEC / 2) { halfWarned = true; speak("เหลืออีก ห้า วินาที"); }
        if (h.dropped) { speak("ระวัง ให้ลูกหลานเข้าไปช่วยพยุง"); endStage(Math.min(el, SEC), h.why); return; }
        if (h.fail) { endStage(Math.min(el, SEC), h.why); return; }
        if (el >= SEC) { endStage(SEC, null); return; }
      }
      RAF = requestAnimationFrame(loop);
    }
    loop();
  }

  g.CSCam = { open: open, close: close, isOpen: function () { return !!UI; }, supported: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    ttsOn: ttsOn, setTts: function (on) { try { localStorage.setItem("cs3:tts", on ? "on" : "off"); } catch (e) {} },
    RepDetector: RepDetector, TugTracker: TugTracker, BalanceEngine: BalanceEngine, hipRatio: hipRatio, visOK: visOK, gaitLabel: gaitLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = { RepDetector: RepDetector, TugTracker: TugTracker, BalanceEngine: BalanceEngine, hipRatio: hipRatio, visOK: visOK, gaitLabel: gaitLabel, LM: LM };
})(typeof window !== "undefined" ? window : this);
