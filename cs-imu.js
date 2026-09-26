/* ============================================================
   cs-imu.js — เซ็นเซอร์คาดเอว (Arduino Nano 33 BLE Sense Rev2 · BMI270)
   ------------------------------------------------------------
   ทำไมต้องมี: กล้องวัด "เวลา" ได้ แต่บอกไม่ได้ว่าลุกอย่างไร หมุนตัวช้าแค่ไหน
   หรือลำตัวแกว่งขณะยืนมากเพียงใด ค่าเหล่านี้คือสิ่งที่ห้องตรวจการเคลื่อนไหว
   (movement lab) วัดด้วยเซ็นเซอร์ที่เอว และเป็นค่าที่แพทย์/นักกายภาพใช้ประกอบ
   การพิจารณา (instrumented TUG · instrumented 5×STS · การแกว่งขณะยืน)

   หลัก
   · อัลกอริทึมชุดเดียวกับเฟิร์มแวร์ firmware/CareSignal-Waist/cs_imu_core.h
     (ย้ายบรรทัดต่อบรรทัด ค่าคงที่ P ต้องตรงกันทั้งสองฝั่ง) — ฝั่งนี้ทดสอบได้ใน Node
     ตัวอุปกรณ์คำนวณเองแล้วส่งผลมา · โทรศัพท์คำนวณซ้ำจากสัญญาณดิบเพื่อตรวจทาน
   · ไม่ขึ้นกับทิศการติดตั้ง: ใช้เวกเตอร์แรงโน้มถ่วง (complementary filter) หาแนวตั้ง
     และวัดการหมุนในระนาบราบ (ก้มลำตัว) กับรอบแกนตั้ง (หมุนตัว) แยกกัน
   · เว็บบลูทูธใช้ได้บน Android Chrome และคอมพิวเตอร์ · iPhone (Safari) ยังไม่รองรับ
     จึงต้องคงการวัดด้วยกล้องและการกดจับเวลาไว้เสมอ
   · ผลจากเซ็นเซอร์ไม่ข้ามขั้นตอนของคน: ตัวเลขกลับไปหน้าจับเวลาเดิม ผู้วัดกดบันทึกเอง
   · ไม่ใช้ไมโครโฟนบนบอร์ด (ระบบไม่มีเสียงสั่งการ) · ไม่มีการเก็บเสียง
   ============================================================ */
(function (g) {
  var ENGINE = "imu-1.1";
  var SVC = "c5a10000-3b1e-4c1a-9b6c-0000ca7e5161";
  var CH = { ctrl: "c5a10001-3b1e-4c1a-9b6c-0000ca7e5161", state: "c5a10002-3b1e-4c1a-9b6c-0000ca7e5161",
             result: "c5a10003-3b1e-4c1a-9b6c-0000ca7e5161", raw: "c5a10004-3b1e-4c1a-9b6c-0000ca7e5161", info: "c5a10005-3b1e-4c1a-9b6c-0000ca7e5161" };
  var KIND = { ftsst: 1, tug: 2, balance: 3, chair30: 4, walk4: 5 }, KIND_OF = { 1: "ftsst", 2: "tug", 3: "balance", 4: "chair30", 5: "walk4" };
  var CMD = { ARM: 1, GO: 2, STOP: 3, STREAM: 4, RESET: 5, SELFTEST: 6 };
  var EV = { NONE: 0, READY: 1, HOLD: 2, ONSET: 3, STAND: 4, SIT: 5, TURN: 6, STEP: 7, IMPACT: 8, DONE: 9 };
  var EV_NM = ["", "ready", "hold", "onset", "stand", "sit", "turn", "step", "impact", "done"];
  /* ค่าคงที่ของอัลกอริทึม — ต้องตรงกับ cs_imu_core.h ทุกตัว */
  var P = {
    K_G: 0.02,        /* น้ำหนักแก้ทิศแรงโน้มถ่วงด้วยความเร่ง (complementary filter) */
    TAU_V: 1.0,       /* วินาที · ตัวรวมความเร็วแนวตั้งแบบรั่วขณะนิ่ง (กันดริฟต์) */
    TAU_MOVE: 10,     /* วินาที · ขณะเคลื่อนไหวแทบไม่รั่ว จะได้ไม่เหลือเศษความเร็วหลังลุก */
    MOVE_W: 15,       /* องศา/วิ · ลำตัวเริ่มขยับ */
    V_UP: 0.20,       /* เมตร/วิ · ความเร็วแนวตั้งที่ถือว่ากำลังลุก/นั่ง */
    V_END: 0.06,      /* เมตร/วิ · กลับใกล้ศูนย์ = จบการเปลี่ยนท่า */
    D_MIN: 0.12,      /* เมตร · ระยะทางแนวตั้งขั้นต่ำจึงนับเป็นลุก/นั่ง (เดินสั่นไม่ถึง) */
    QUIET_S: 0.3,     /* วินาที · นิ่งนานเท่านี้ = ความเร็วแนวตั้งเป็นศูนย์ (ล้างดริฟต์) */
    YAW_ON: 25,       /* องศา/วิ · กำลังหมุนตัว */
    YAW_OFF_MS: 250,  /* หยุดหมุนนานเท่านี้ = จบการหมุน */
    TURN_MIN: 90,     /* องศา · การหมุนกลับตัวครั้งแรกต้องถึง */
    TURN2_MIN: 60,    /* องศา · หมุนก่อนนั่ง มักไม่สุด */
    STEP_TH: 0.06,    /* g · ยอดความเร่งแนวตั้งของก้าว */
    STEP_MIN_MS: 250, /* ก้าวห่างกันอย่างน้อย */
    IMPACT_G: 3.0,    /* g · แรงกระแทก */
    BAL_SEC: 10,      /* วินาที · ท่าทรงตัว */
    TUG_M: 3,         /* เมตร · ระยะเดิน TUG */
    CAL_N: 100,       /* ตัวอย่างนิ่งก่อนเริ่ม (1 วินาที ที่ 100 Hz) */
    CAL_W: 30,        /* องศา/วิ · นิ่งพอสำหรับตั้งศูนย์ */
    CHAIR_SEC: 30,    /* วินาที · 30-Second Chair Stand (CDC STEADI) */
    WALK_M: 4,        /* เมตร · ทดสอบความเร็วเดิน 4 เมตร (World Guidelines 2022) */
    WALK_END_MS: 1500,/* ไม่มีก้าวนานเท่านี้ = หยุดเดินแล้ว */
    WALK_MIN_STEPS: 4 /* ก้าวขั้นต่ำจึงนับว่าเดินครบ */
  };
  var DEG = Math.PI / 180, RAD = 180 / Math.PI, G0 = 9.81;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) { var n = norm(a); return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 1]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scl(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

  /* ---------- แกนคำนวณ (ฝาแฝดของ cs_imu_core.h) ---------- */
  function makeState(kind, stage) {
    return { kind: kind, stage: stage || 0, phase: "idle", n: 0, tPrev: null, fsSum: 0, g: null, v0: null,
      calN: 0, calSum: [0, 0, 0], calMag: 0, calMove: 0, calW: [0, 0, 0], wB: [0, 0, 0], holds: 0,
      t0: null, onset: null, moveRun: 0, vv: 0, avB: 0, quietRun: 0, lastLowT: null, trans: null, lastEv: null,
      cur: null, reps: [], tiltMax: 0,
      stsEnd: null, sitAt: null, descentAt: null, yawInt: 0, turn: null, turns: [],
      stepEma: 0, stepLp: 0, stepPrev: 0, stepRise: false, lastStepT: -1e9, steps: [],
      bal: { e1: null, e2: null, n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, path: 0, jerk2: 0, sa2: 0, f: null, prev: null, stepped: false },
      impact: false, impactAt: null, maxG: 0, live: null, result: null, done: false };
  }
  function arm(st, t) { st.phase = "cal"; st.calN = 0; st.calSum = [0, 0, 0]; st.calMag = 0; st.calMove = 0; st.calW = [0, 0, 0]; st.wB = [0, 0, 0]; st.tPrev = null; }
  function go(st, t) { if (st.phase !== "ready") return false; st.phase = "run"; st.t0 = t; if (st.kind === "balance") balBegin(st); return true; }
  function balBegin(st) {
    var gv = st.g || [0, 0, 1], ax = Math.abs(gv[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    st.bal.e1 = unit(cross(gv, ax)); st.bal.e2 = unit(cross(gv, st.bal.e1));
  }
  function push(st, t, a, w0) {
    if (st.phase === "idle" || st.done) return null;
    /* ชดเชยค่าคลาดไจโร (bias) ที่วัดได้ระหว่างนิ่ง 1 วินาทีตอนตั้งศูนย์ — ก่อนตั้งศูนย์ wB = 0 */
    var w = [w0[0] - st.wB[0], w0[1] - st.wB[1], w0[2] - st.wB[2]];
    var dt = st.tPrev == null ? 0.01 : clamp((t - st.tPrev) / 1000, 0.002, 0.05); st.tPrev = t; st.n++; st.fsSum += dt;
    var an = norm(a); if (an > st.maxG) st.maxG = an;
    var ev = EV.NONE;
    if (an > P.IMPACT_G && !st.impact) { st.impact = true; st.impactAt = t; ev = EV.IMPACT; }
    if (!st.g) st.g = unit(a);
    /* ทิศแรงโน้มถ่วงในกรอบเซ็นเซอร์: หมุนตามไจโร แล้วดึงเข้าหาความเร่งเล็กน้อย */
    var wr = scl(w, DEG), gp = sub(st.g, scl(cross(wr, st.g), dt)), gu = unit(gp), au = an > 1e-6 ? scl(a, 1 / an) : gu;
    st.g = unit([gu[0] * (1 - P.K_G) + au[0] * P.K_G, gu[1] * (1 - P.K_G) + au[1] * P.K_G, gu[2] * (1 - P.K_G) + au[2] * P.K_G]);
    if (st.phase === "cal") {
      st.calSum[0] += a[0]; st.calSum[1] += a[1]; st.calSum[2] += a[2]; st.calMag += an; st.calN++; var wn = norm(w); if (wn > st.calMove) st.calMove = wn;
      st.calW[0] += w0[0]; st.calW[1] += w0[1]; st.calW[2] += w0[2];
      if (st.calN >= P.CAL_N) {
        if (st.calMove < P.CAL_W) { st.v0 = unit(st.calSum); st.g = st.v0.slice(); st.avB = st.calMag / st.calN - 1; st.wB = scl(st.calW, 1 / st.calN); st.phase = "ready"; ev = EV.READY; }   /* avB = ค่าคลาดของสเกลความเร่งขณะนิ่ง */
        else { st.calN = 0; st.calSum = [0, 0, 0]; st.calMag = 0; st.calMove = 0; st.calW = [0, 0, 0]; st.holds++; ev = EV.HOLD; }
      }
      st.live = { phase: st.phase, ev: ev }; return ev;
    }
    var gd = dot(a, st.g), av = gd - 1, ah = sub(a, scl(st.g, gd)), ahn = norm(ah);
    var tilt = Math.acos(clamp(dot(st.g, st.v0), -1, 1)) * RAD;
    var wg = dot(w, st.g), wh = norm(sub(w, scl(st.g, wg))), yawRate = wg;
    if (st.phase !== "run") { st.live = { phase: st.phase, tilt: tilt, wh: wh, av: av, ev: ev }; return ev; }
    var el = t - st.t0;
    if (tilt > st.tiltMax) st.tiltMax = tilt;
    /* จุดเริ่มขยับ (เวลาตอบสนองหลังสัญญาณเริ่ม) */
    if (st.onset == null) { st.moveRun = wh > P.MOVE_W ? st.moveRun + 1 : 0; if (st.moveRun >= 5) { st.onset = t; ev = EV.ONSET; if (st.kind !== "balance") st.cur = { leanAt: t, peakW: 0, peakAv: 0, quiet: false }; } }
    if (st.kind === "balance") { ev = balStep(st, t, dt, av, ah, ahn, wh, el) || ev; st.live = { phase: "run", tilt: tilt, wh: wh, av: av, el: el, ev: ev }; return ev; }
    /* ความเร็วแนวตั้ง: รวมแบบรั่ว + ปรับค่าคลาดขณะนิ่ง + ล้างศูนย์เมื่อนิ่งเกิน 0.3 วิ (ยืน/นั่งนิ่ง = ความเร็วศูนย์) */
    var quiet = wh < P.MOVE_W && Math.abs(av - st.avB) < 0.05;
    if (quiet) { st.avB += (av - st.avB) * (dt / (2 + dt)); st.quietRun += dt; } else st.quietRun = 0;
    var avd = av - st.avB;
    var tau = Math.abs(avd) > 0.05 || wh > P.MOVE_W ? P.TAU_MOVE : P.TAU_V;
    st.vv += avd * G0 * dt; st.vv *= (1 - dt / tau);
    if (st.quietRun > P.QUIET_S) st.vv = 0;
    if (Math.abs(st.vv) < 2 * P.V_END) st.lastLowT = t;   /* จุดที่ยังนิ่ง = จุดเริ่มของการเปลี่ยนท่าถัดไป */
    var tr = st.trans, lowT = st.lastLowT != null ? st.lastLowT : t;
    if (!tr) { if (st.vv > P.V_UP) st.trans = { dir: 1, start: lowT, d: 0 }; else if (st.vv < -P.V_UP) st.trans = { dir: -1, start: lowT, d: 0 }; }
    else { tr.d += st.vv * dt; if (tr.dir * st.vv < P.V_END) { st.trans = null; if (tr.dir * tr.d >= P.D_MIN) ev = transition(st, tr.dir > 0 ? "stand" : "sit", t, tr.start) || ev; } }
    if (st.cur) {
      if (wh > st.cur.peakW) st.cur.peakW = wh; if (avd > st.cur.peakAv) st.cur.peakAv = avd;
      if (st.cur.leanAt == null) { if (wh < P.MOVE_W) st.cur.quiet = true; st.moveRun = st.cur.quiet && wh > P.MOVE_W ? st.moveRun + 1 : 0; if (st.moveRun >= 3) st.cur.leanAt = t; }
    }
    if (st.kind === "tug" && st.stsEnd != null && st.sitAt == null) {
      ev = turnStep(st, t, dt, yawRate) || ev;
      ev = stepStep(st, t, dt, avd) || ev;
    }
    if (st.kind === "walk4") {
      ev = stepStep(st, t, dt, avd) || ev;
      if (st.steps.length >= P.WALK_MIN_STEPS && t - st.lastStepT > P.WALK_END_MS) { finish(st, t, "ok"); ev = EV.DONE; }
    }
    if (st.kind === "chair30" && el >= P.CHAIR_SEC * 1000) {
      /* กติกา CDC: ครบ 30 วินาทีขณะกำลังลุกขึ้นเกินครึ่งทาง นับเป็น 1 ครั้ง */
      st.half = !!(st.trans && st.trans.dir > 0 && st.trans.d >= P.D_MIN / 2);
      finish(st, t, "ok"); ev = EV.DONE;
    }
    st.live = { phase: "run", tilt: tilt, wh: wh, av: av, vv: st.vv, el: el, ev: ev, yaw: st.yawInt };
    return ev;
  }
  function transition(st, kind, t, start) {
    if (kind === "stand") {
      if (st.lastEv === "stand") return 0; st.lastEv = "stand";
      var c = st.cur || { leanAt: start, peakW: 0, peakAv: 0 };
      st.reps.push({ leanAt: c.leanAt != null ? c.leanAt : start, standAt: t, sts: t - (c.leanAt != null ? c.leanAt : start), peakW: c.peakW, peakAv: c.peakAv, sitAt: null, dur: null });
      if (st.kind === "tug" && st.stsEnd == null) st.stsEnd = t;
      return EV.STAND;
    }
    if (st.lastEv !== "stand") return 0;
    var r = st.reps[st.reps.length - 1]; if (!r || r.sitAt != null) return 0;
    st.lastEv = "sit";
    r.sitAt = t; r.sitStart = start; var prev = st.reps.length > 1 ? st.reps[st.reps.length - 2].sitAt : st.onset; r.dur = t - (prev != null ? prev : st.t0);
    st.cur = { leanAt: null, peakW: 0, peakAv: 0, quiet: false };
    if (st.kind === "ftsst" && st.reps.length >= 5) finish(st, t, "ok");
    if (st.kind === "tug") { st.sitAt = t; st.descentAt = start; finish(st, t, "ok"); }
    return EV.SIT;
  }
  function turnStep(st, t, dt, yawRate) {
    st.yawInt += yawRate * dt; var ay = Math.abs(yawRate), tn = st.turn;
    if (!tn) { if (ay > P.YAW_ON) st.turn = { start: t, sum: 0, peak: 0, lastOn: t }; return 0; }
    tn.sum += yawRate * dt; if (ay > tn.peak) tn.peak = ay; if (ay > P.YAW_ON) tn.lastOn = t;
    if (t - tn.lastOn > P.YAW_OFF_MS) {
      st.turn = null; var need = st.turns.length ? P.TURN2_MIN : P.TURN_MIN;
      if (Math.abs(tn.sum) >= need) { st.turns.push({ start: tn.start, end: tn.lastOn, deg: Math.abs(tn.sum), peak: tn.peak }); return EV.TURN; }
    }
    return 0;
  }
  function stepStep(st, t, dt, av) {
    /* ตัดความถี่ต่ำ (ค่าเฉลี่ย 0.5 วิ) แล้วปรับเรียบ 50 ms → หายอดของแต่ละก้าว */
    st.stepEma += (av - st.stepEma) * (dt / (0.5 + dt)); var hp = av - st.stepEma;
    st.stepLp += (hp - st.stepLp) * (dt / (0.05 + dt));
    var ev = 0;
    if (st.stepLp > st.stepPrev) st.stepRise = true;
    else if (st.stepRise) { st.stepRise = false; if (st.stepPrev > P.STEP_TH && t - st.lastStepT > P.STEP_MIN_MS) { st.lastStepT = t; st.steps.push(t); ev = EV.STEP; } }
    st.stepPrev = st.stepLp; return ev;
  }
  function balStep(st, t, dt, av, ah, ahn, wh, el) {
    var b = st.bal, x = dot(ah, b.e1), y = dot(ah, b.e2);
    b.n++; b.sx += x; b.sy += y; b.sxx += x * x; b.syy += y * y; b.sxy += x * y;
    /* jerk · ระยะทาง · ความถี่เฉลี่ย คิดจากสัญญาณที่ปรับเรียบ 0.15 วิ (การแกว่งที่สนใจ < 2 Hz · ตัดสัญญาณรบกวน) */
    var k = dt / (0.15 + dt); if (!b.f) b.f = ah.slice(); else { b.f[0] += (ah[0] - b.f[0]) * k; b.f[1] += (ah[1] - b.f[1]) * k; b.f[2] += (ah[2] - b.f[2]) * k; }
    b.sa2 += dot(b.f, b.f);
    if (b.prev) { var dx = b.f[0] - b.prev[0], dy = b.f[1] - b.prev[1], dz = b.f[2] - b.prev[2], dn = Math.sqrt(dx * dx + dy * dy + dz * dz); b.path += dn; var j = dn / dt; b.jerk2 += j * j; }
    b.prev = b.f.slice();
    if (wh > 60 || Math.abs(av) > 0.25 || ahn > 0.5) b.stepped = true;
    if (el >= P.BAL_SEC * 1000) { finish(st, t, "ok"); return EV.DONE; }
    return 0;
  }
  function stop(st, t) { if (st.phase === "run" && !st.done) finish(st, t, st.kind === "balance" || st.kind === "walk4" ? "ok" : "incomplete"); else if (!st.done) { st.done = true; st.phase = "done"; st.result = { kind: st.kind, engine: ENGINE, status: "aborted" }; } return st.result; }
  function mean(xs) { return xs.length ? xs.reduce(function (s, x) { return s + x; }, 0) / xs.length : null; }
  function cv(xs) { if (xs.length < 2) return null; var m = mean(xs), v = xs.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (xs.length - 1); return m > 0 ? Math.sqrt(v) / m * 100 : null; }
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }
  function finish(st, t, status) {
    st.done = true; st.phase = "done";
    var fs = st.n > 1 ? (st.n - 1) / st.fsSum : null;
    var res = { kind: st.kind, engine: ENGINE, status: status, totalMs: st.t0 != null ? t - st.t0 : null, reactionMs: st.onset != null ? st.onset - st.t0 : null,
      impact: st.impact, impactAt: st.impactAt != null ? st.impactAt - st.t0 : null, maxG: r2(st.maxG), fsHz: r1(fs), n: st.n, holds: st.holds,
      gyroBias: r2(norm(st.wB)) };
    if (st.kind === "ftsst") {
      var full = st.reps.filter(function (r) { return r.sitAt != null; });
      res.ftsst = { reps: full.length, repMs: full.map(function (r) { return Math.round(r.dur); }), stsMeanMs: full.length ? Math.round(mean(full.map(function (r) { return r.sts; }))) : null,
        stsCv: r1(cv(full.map(function (r) { return r.dur; }))), peakOmega: r1(Math.max.apply(null, [0].concat(st.reps.map(function (r) { return r.peakW; })))),
        peakAv: r2(Math.max.apply(null, [0].concat(st.reps.map(function (r) { return r.peakAv; })))), tiltMax: r1(st.tiltMax) };
      if (status === "ok" && full.length < 5) res.status = "incomplete";
    } else if (st.kind === "chair30") {
      var stands = st.reps.length + (st.half ? 1 : 0);
      res.totalMs = st.t0 != null ? Math.min(P.CHAIR_SEC * 1000, t - st.t0) : null;
      res.chair30 = { stands: stands, full: st.reps.length, half: !!st.half, standMs: st.reps.map(function (r) { return Math.round(r.standAt - st.t0); }),
        peakOmega: r1(Math.max.apply(null, [0].concat(st.reps.map(function (r) { return r.peakW; })))), tiltMax: r1(st.tiltMax) };
      if (status === "ok" && t - st.t0 < P.CHAIR_SEC * 1000 - 50) res.status = "incomplete";
    } else if (st.kind === "walk4") {
      var ss = st.steps, n2 = ss.length, iv = []; for (var q = 1; q < n2; q++) { var dd = ss[q] - ss[q - 1]; if (dd < 2000) iv.push(dd); }
      var mi = iv.length ? mean(iv) : null, dur = n2 >= 2 && mi ? ss[n2 - 1] - ss[0] + mi : null;
      res.totalMs = dur == null ? null : Math.round(dur);
      res.walk4 = { durMs: dur == null ? null : Math.round(dur), steps: n2, cadence: dur ? r1(n2 / (dur / 60000)) : null, stepCv: r1(cv(iv)),
        speed: dur ? r2(P.WALK_M / (dur / 1000)) : null };
      if (n2 < P.WALK_MIN_STEPS) res.status = "incomplete";
    } else if (st.kind === "tug") {
      var t1 = st.turns[0] || null, t2 = st.turns[1] || null, stsEnd = st.stsEnd, endWalk = t2 ? t2.start : st.descentAt;
      var walkOut = t1 && stsEnd != null ? t1.start - stsEnd : null, walkBack = t1 && endWalk != null ? endWalk - t1.end : null;
      var stepsW = st.steps.filter(function (s) { return stsEnd != null && ((t1 ? s < t1.start : endWalk == null || s < endWalk) || (t1 && s >= t1.end && (endWalk == null || s < endWalk))); });
      var ivs = []; for (var i = 1; i < stepsW.length; i++) { var d = stepsW[i] - stepsW[i - 1]; if (d < 2000) ivs.push(d); }
      var walkMs = walkOut != null && walkBack != null ? walkOut + walkBack : null;
      res.tug = { stsMs: stsEnd != null && st.onset != null ? Math.round(stsEnd - st.onset) : null, walkOutMs: walkOut == null ? null : Math.round(walkOut), turnMs: t1 ? Math.round(t1.end - t1.start) : null,
        walkBackMs: walkBack == null ? null : Math.round(walkBack), turn2Ms: t2 ? Math.round(t2.end - t2.start) : null, sitMs: st.sitAt != null && st.descentAt != null ? Math.round(st.sitAt - st.descentAt) : null,
        turnDeg: t1 ? r1(t1.deg) : null, turnPeak: t1 ? r1(t1.peak) : null, turnSeen: !!t1, steps: stepsW.length,
        cadence: walkMs && stepsW.length ? r1(stepsW.length / (walkMs / 60000)) : null, stepCv: r1(cv(ivs)), speed: walkMs ? r2(2 * P.TUG_M / (walkMs / 1000)) : null,
        peakOmega: r1(Math.max.apply(null, [0].concat(st.reps.map(function (r) { return r.peakW; })))), tiltMax: r1(st.tiltMax) };
      if (status === "ok" && st.sitAt == null) res.status = "incomplete";
    } else {
      var b = st.bal, n = b.n || 1, mx = b.sx / n, my = b.sy / n, cxx = b.sxx / n - mx * mx, cyy = b.syy / n - my * my, cxy = b.sxy / n - mx * my;
      var h = (cxx + cyy) / 2, q = Math.sqrt(Math.max(0, ((cxx - cyy) / 2) * ((cxx - cyy) / 2) + cxy * cxy)), l1 = Math.max(0, h + q), l2 = Math.max(0, h - q);
      var held = st.t0 != null ? Math.min(P.BAL_SEC, (t - st.t0) / 1000) : 0;
      /* ความถี่เฉลี่ย = RMS(jerk) / RMS(ความเร่ง) / 2π (ตรงกับความถี่ของคลื่นไซน์) */
      var freq = b.sa2 > 1e-12 ? Math.sqrt(b.jerk2 / n) / Math.sqrt(b.sa2 / n) / (2 * Math.PI) : null;
      res.balance = { heldSec: r1(held), rms: r2(Math.sqrt(Math.max(0, cxx + cyy)) * G0), major: r2(Math.sqrt(l1) * G0), minor: r2(Math.sqrt(l2) * G0),
        area: r2(Math.PI * 2.4478 * 2.4478 * Math.sqrt(l1) * Math.sqrt(l2) * G0 * G0), jerk: r2(Math.sqrt(b.jerk2 / n) * G0), freq: r2(freq),
        path: r2(b.path * G0), stepped: b.stepped };
    }
    st.result = res; return res;
  }
  var Core = { P: P, EV: EV, EV_NM: EV_NM, makeState: makeState, arm: arm, go: go, push: push, stop: stop };

  /* ---------- แพ็กเก็ตผล 84 ไบต์ (เหมือน struct ในเฟิร์มแวร์) ---------- */
  var NIL16 = 0xFFFF;
  function u16(v, k) { return v == null ? NIL16 : clamp(Math.round(v * (k || 1)), 0, 65534); }
  function i16(v, k) { return v == null ? -32768 : clamp(Math.round(v * (k || 1)), -32767, 32767); }
  function pack(res) {
    var b = new ArrayBuffer(84), dv = new DataView(b), f = res.ftsst || {}, tg = res.tug || {}, bl = res.balance || {};
    dv.setUint8(0, 0xC5); dv.setUint8(1, 2); dv.setUint8(2, KIND[res.kind] || 0); dv.setUint8(3, { ok: 0, incomplete: 1, aborted: 2 }[res.status] || 0);
    var c3 = res.chair30 || {}, w4 = res.walk4 || {};
    dv.setUint8(4, res.kind === "chair30" ? (c3.stands || 0) : (f.reps || 0)); dv.setUint8(5, (res.impact ? 1 : 0) | (bl.stepped ? 2 : 0) | (tg.turnSeen ? 4 : 0) | (c3.half ? 8 : 0));
    dv.setUint16(6, u16(res.fsHz, 10), true); dv.setUint32(8, res.totalMs == null ? 0xFFFFFFFF : Math.round(res.totalMs), true); dv.setUint32(12, res.reactionMs == null ? 0xFFFFFFFF : Math.round(res.reactionMs), true);
    dv.setUint16(16, u16(f.stsMeanMs), true); dv.setUint16(18, u16(f.stsCv, 10), true); dv.setInt16(20, i16(f.peakOmega != null ? f.peakOmega : tg.peakOmega, 10), true);
    dv.setInt16(22, i16(f.peakAv, 1000), true); dv.setInt16(24, i16(f.tiltMax != null ? f.tiltMax : tg.tiltMax, 10), true);
    for (var i = 0; i < 5; i++) dv.setUint16(26 + i * 2, u16(f.repMs && f.repMs[i] != null ? f.repMs[i] : null), true);
    dv.setUint16(36, u16(tg.stsMs), true); dv.setUint16(38, u16(tg.walkOutMs), true); dv.setUint16(40, u16(tg.turnMs), true); dv.setUint16(42, u16(tg.walkBackMs), true); dv.setUint16(44, u16(tg.turn2Ms), true); dv.setUint16(46, u16(tg.sitMs), true);
    var gait = res.kind === "walk4" ? w4 : tg;   /* เดิน 4 เมตร ใช้ช่องการเดินชุดเดียวกับ TUG */
    dv.setUint16(48, u16(tg.turnDeg, 10), true); dv.setUint16(50, u16(tg.turnPeak, 10), true); dv.setUint8(52, Math.min(255, gait.steps || 0)); dv.setUint8(53, 0);
    dv.setUint16(54, u16(gait.cadence, 10), true); dv.setUint16(56, u16(gait.stepCv, 10), true); dv.setUint16(58, u16(gait.speed, 100), true);
    dv.setUint16(60, u16(bl.heldSec, 1000), true); dv.setUint16(62, u16(bl.rms, 1000), true); dv.setUint16(64, u16(bl.major, 1000), true); dv.setUint16(66, u16(bl.minor, 1000), true);
    dv.setUint16(68, u16(bl.jerk, 10), true); dv.setUint16(70, u16(bl.freq, 100), true); dv.setUint16(72, u16(bl.path, 100), true);
    dv.setUint16(74, u16(res.maxG, 100), true); dv.setUint32(76, res.impactAt == null ? 0xFFFFFFFF : Math.round(res.impactAt), true); dv.setUint16(80, clamp(res.n || 0, 0, 65535), true); dv.setUint16(82, 0, true);
    return b;
  }
  function g16(dv, o, k) { var v = dv.getUint16(o, true); return v === NIL16 ? null : v / (k || 1); }
  function gi16(dv, o, k) { var v = dv.getInt16(o, true); return v === -32768 ? null : v / (k || 1); }
  function g32(dv, o) { var v = dv.getUint32(o, true); return v === 0xFFFFFFFF ? null : v; }
  function unpack(buf) {
    var dv = buf instanceof DataView ? buf : new DataView(buf.buffer || buf, buf.byteOffset || 0);
    if (dv.byteLength < 84 || dv.getUint8(0) !== 0xC5) return null;
    var kind = KIND_OF[dv.getUint8(2)], fl = dv.getUint8(5);
    var res = { kind: kind, engine: "fw-" + dv.getUint8(1), status: ["ok", "incomplete", "aborted"][dv.getUint8(3)] || "ok", totalMs: g32(dv, 8), reactionMs: g32(dv, 12),
      impact: !!(fl & 1), impactAt: g32(dv, 76), maxG: g16(dv, 74, 100), fsHz: g16(dv, 6, 10), n: dv.getUint16(80, true) };
    if (kind === "ftsst") {
      var reps = []; for (var i = 0; i < 5; i++) { var v = g16(dv, 26 + i * 2); if (v != null) reps.push(v); }
      res.ftsst = { reps: dv.getUint8(4), repMs: reps, stsMeanMs: g16(dv, 16), stsCv: g16(dv, 18, 10), peakOmega: gi16(dv, 20, 10), peakAv: gi16(dv, 22, 1000), tiltMax: gi16(dv, 24, 10) };
    } else if (kind === "tug") {
      res.tug = { stsMs: g16(dv, 36), walkOutMs: g16(dv, 38), turnMs: g16(dv, 40), walkBackMs: g16(dv, 42), turn2Ms: g16(dv, 44), sitMs: g16(dv, 46), turnDeg: g16(dv, 48, 10), turnPeak: g16(dv, 50, 10), turnSeen: !!(fl & 4),
        steps: dv.getUint8(52), cadence: g16(dv, 54, 10), stepCv: g16(dv, 56, 10), speed: g16(dv, 58, 100), peakOmega: gi16(dv, 20, 10), tiltMax: gi16(dv, 24, 10) };
    } else if (kind === "chair30") {
      res.chair30 = { stands: dv.getUint8(4), half: !!(fl & 8), peakOmega: gi16(dv, 20, 10), tiltMax: gi16(dv, 24, 10) };
    } else if (kind === "walk4") {
      res.walk4 = { durMs: res.totalMs, steps: dv.getUint8(52), cadence: g16(dv, 54, 10), stepCv: g16(dv, 56, 10), speed: g16(dv, 58, 100) };
    } else if (kind === "balance") {
      res.balance = { heldSec: g16(dv, 60, 1000), rms: g16(dv, 62, 1000), major: g16(dv, 64, 1000), minor: g16(dv, 66, 1000), jerk: g16(dv, 68, 10), freq: g16(dv, 70, 100), path: g16(dv, 72, 100), stepped: !!(fl & 2) };
    }
    return res;
  }
  function unpackState(dv) {
    if (!dv || dv.byteLength < 16 || dv.getUint8(0) !== 0xC5) return null;
    return { kind: KIND_OF[dv.getUint8(1)], phase: ["idle", "cal", "ready", "run", "done"][dv.getUint8(2)] || "idle", count: dv.getUint8(3), el: dv.getUint32(4, true),
      tilt: dv.getInt16(8, true) / 10, wh: dv.getInt16(10, true) / 10, yaw: dv.getInt16(12, true) / 10, ev: dv.getUint8(14), flags: dv.getUint8(15) };
  }
  function unpackRaw(dv) {
    if (!dv || dv.byteLength < 14) return null;
    return { t: dv.getUint16(0, true), a: [dv.getInt16(2, true) / 1000, dv.getInt16(4, true) / 1000, dv.getInt16(6, true) / 1000], w: [dv.getInt16(8, true) / 10, dv.getInt16(10, true) / 10, dv.getInt16(12, true) / 10] };
  }

  /* ---------- สรุปให้คนอ่าน (แอป) — ตารางเต็มพร้อมเกณฑ์อยู่ใน cs-referral-forms.js (imuRows) ---------- */
  function sec(ms) { return ms == null ? "—" : (ms / 1000).toFixed(1) + " วิ"; }
  function briefLines(res) {
    var o = [];
    if (!res) return o;
    if (res.reactionMs != null) o.push("ตอบสนองหลังสัญญาณเริ่ม " + sec(res.reactionMs));
    if (res.ftsst) { var f = res.ftsst; o.push("ลุกครบ " + f.reps + " ครั้ง · แต่ละครั้ง " + f.repMs.map(function (m) { return (m / 1000).toFixed(1); }).join(" / ") + " วิ"); if (f.stsMeanMs != null) o.push("ช่วงลุกจากเก้าอี้เฉลี่ย " + sec(f.stsMeanMs) + (f.stsCv != null ? " · ความสม่ำเสมอ (CV) " + f.stsCv + "%" : "")); if (f.peakOmega != null) o.push("ความเร็วก้มลำตัวสูงสุด " + f.peakOmega + " องศา/วิ · ก้มมากสุด " + f.tiltMax + "°"); }
    if (res.tug) { var t = res.tug; o.push("ลุกจากเก้าอี้ " + sec(t.stsMs) + " · เดินไป " + sec(t.walkOutMs) + " · หมุนตัว " + sec(t.turnMs) + (t.turnDeg != null ? " (" + Math.round(t.turnDeg) + "°)" : "") + " · เดินกลับ " + sec(t.walkBackMs) + " · นั่งลง " + sec(t.sitMs)); if (t.steps) o.push("ก้าว " + t.steps + " ก้าว · จังหวะ " + (t.cadence != null ? Math.round(t.cadence) + " ก้าว/นาที" : "—") + (t.speed != null ? " · ความเร็วเดินโดยประมาณ " + t.speed.toFixed(2) + " ม./วิ" : "")); if (!t.turnSeen) o.push("ไม่พบการหมุนตัวชัดเจน — ระยะเดินอาจไม่ครบ หรือหมุนช้ามาก"); }
    if (res.chair30) { var c = res.chair30; o.push("ลุกยืนได้ " + c.stands + " ครั้งใน 30 วินาที" + (c.half ? " (รวมครั้งที่ลุกเกินครึ่งทางตอนครบเวลา)" : "")); }
    if (res.walk4) { var wk = res.walk4; o.push("เดิน 4 เมตร " + sec(wk.durMs) + (wk.speed != null ? " · ความเร็ว " + wk.speed.toFixed(2) + " ม./วิ" : "") + (wk.cadence != null ? " · " + Math.round(wk.cadence) + " ก้าว/นาที" : "")); }
    if (res.balance) { var b = res.balance; o.push("ยืนได้ " + b.heldSec + " วิ · แกว่ง (RMS) " + b.rms + " ม./วิ² · แกนหลัก/รอง " + b.major + " / " + b.minor + " · ความถี่ " + b.freq + " Hz"); if (b.stepped) o.push("เซ็นเซอร์เห็นการขยับตัวมากคล้ายก้าวเท้าหรือเสียหลัก — ลูกหลานยืนยัน"); }
    if (res.impact) o.push("พบแรงกระแทก " + res.maxG + " g ที่ " + sec(res.impactAt) + " — ตรวจดูว่าล้มหรือไม่");
    if (res.status === "incomplete") o.push("ทำไม่ครบตามขั้นตอน (หยุดก่อน)");
    return o;
  }

  /* CDC STEADI · 30-Second Chair Stand — ต่ำกว่านี้ = ต่ำกว่าค่าเฉลี่ย เสี่ยงหกล้ม (ชาย/หญิง ตามช่วงอายุ) */
  var CHAIR_NORM = [[60, 64, 14, 12], [65, 69, 12, 11], [70, 74, 12, 10], [75, 79, 11, 10], [80, 84, 10, 9], [85, 89, 8, 8], [90, 94, 7, 4]];
  function chairBelow(stands, age, sex) {
    if (stands == null || age == null || (sex !== "m" && sex !== "f")) return null;
    var row = CHAIR_NORM.filter(function (r) { return age >= r[0] && age <= r[1]; })[0]; if (!row) return null;
    var cut = sex === "m" ? row[2] : row[3]; return { below: stands < cut, cut: cut };
  }
  function slowGait(speed) { return speed == null ? null : speed < 0.8; }   /* World Guidelines 2022 */

  /* ---------- บลูทูธ ---------- */
  var BLE = { dev: null, ch: null, onState: null, onResult: null, onRaw: null, fw: null };
  function supported() { return typeof navigator !== "undefined" && !!navigator.bluetooth; }
  function isiOS() { return typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent || ""); }
  async function connect() {
    if (BLE.dev && BLE.dev.gatt && BLE.dev.gatt.connected) return BLE;
    var dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [SVC] }], optionalServices: [SVC] });
    var srv = await (await dev.gatt.connect()).getPrimaryService(SVC), ch = {};
    for (var k in CH) { try { ch[k] = await srv.getCharacteristic(CH[k]); } catch (e) { ch[k] = null; } }
    BLE.dev = dev; BLE.ch = ch;
    try { BLE.fw = new TextDecoder().decode(await ch.info.readValue()); } catch (e) { BLE.fw = null; }
    if (ch.state) { await ch.state.startNotifications(); ch.state.addEventListener("characteristicvaluechanged", function (e) { var s = unpackState(e.target.value); if (s && BLE.onState) BLE.onState(s); }); }
    if (ch.result) { await ch.result.startNotifications(); ch.result.addEventListener("characteristicvaluechanged", async function () { try { var v = await ch.result.readValue(); var r = unpack(v); if (r && BLE.onResult) BLE.onResult(r); } catch (e) {} }); }
    dev.addEventListener("gattserverdisconnected", function () { BLE.dev = null; if (BLE.onDisconnect) BLE.onDisconnect(); });
    return BLE;
  }
  async function cmd(c, a1, a2) { if (!BLE.ch || !BLE.ch.ctrl) throw new Error("ยังไม่เชื่อมต่อ"); await BLE.ch.ctrl.writeValue(new Uint8Array([c, a1 || 0, a2 || 0, 0])); }
  async function streamOn(on, fn) {
    if (!BLE.ch || !BLE.ch.raw) return false;
    if (on) { BLE.onRaw = fn; await BLE.ch.raw.startNotifications(); BLE.ch.raw.addEventListener("characteristicvaluechanged", rawEv); }
    else { BLE.ch.raw.removeEventListener("characteristicvaluechanged", rawEv); try { await BLE.ch.raw.stopNotifications(); } catch (e) {} BLE.onRaw = null; }
    await cmd(CMD.STREAM, on ? 1 : 0); return true;
  }
  function rawEv(e) { var s = unpackRaw(e.target.value); if (s && BLE.onRaw) BLE.onRaw(s); }
  /* ตรวจเครื่องก่อนใช้: วางนิ่งบนโต๊ะ 2 วินาที → อัตราสุ่มตัวอย่าง · ขนาดแรงโน้มถ่วง · ค่าคลาดและสัญญาณรบกวนไจโร */
  async function selfTest() {
    await cmd(CMD.SELFTEST); await new Promise(function (r) { setTimeout(r, 2600); });
    var s = new TextDecoder().decode(await BLE.ch.info.readValue()); return parseSelfTest(s);
  }
  function parseSelfTest(s) {
    var m = {}; String(s || "").replace(/(\w+)=([-\d.,]+)/g, function (_, k, v) { m[k] = v; return ""; });
    if (!m.fs) return { ok: false, raw: s };
    var fs = +m.fs, gm = +m.g, gb = (m.gb || "0,0,0").split(",").map(Number), gn = +m.gn;
    var checks = { fs: fs >= 90 && fs <= 110, g: Math.abs(gm - 1) <= 0.05, bias: Math.sqrt(gb[0] * gb[0] + gb[1] * gb[1] + gb[2] * gb[2]) <= 3, noise: gn <= 0.5 };
    return { ok: checks.fs && checks.g && checks.bias && checks.noise, fs: fs, g: gm, gyroBias: gb, gyroNoise: gn, checks: checks, raw: s };
  }
  function disconnect() { try { if (BLE.dev && BLE.dev.gatt.connected) BLE.dev.gatt.disconnect(); } catch (e) {} BLE.dev = null; }

  /* ---------- หน้าจอในแอป (โครงเดียวกับกล้อง cs-camera.js) ---------- */
  var CSS = [
    ".csimu{position:absolute;inset:0;z-index:60;background:#0B1220;color:#fff;display:flex;flex-direction:column;font-family:inherit}",
    ".csimu .st{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;text-align:center}",
    ".csimu .big{font-size:64px;line-height:1;font-weight:800;font-variant-numeric:tabular-nums}.csimu .big small{font-size:18px;font-weight:600;color:rgba(255,255,255,.65)}",
    ".csimu .gauge{width:min(80vw,320px);height:14px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden;position:relative}.csimu .gauge i{position:absolute;left:0;top:0;bottom:0;width:0;background:#17B3A1;transition:width .08s linear}",
    ".csimu .lbl{font-size:13px;color:rgba(255,255,255,.7)}.csimu .tag{background:rgba(255,255,255,.1);border-radius:99px;padding:6px 12px;font-size:13px}",
    ".csimu .dock{flex:none;background:#0F1B33;padding:10px 14px calc(env(safe-area-inset-bottom) + 10px);display:flex;flex-direction:column;gap:8px}",
    ".csimu .coach{font-size:14.5px;line-height:1.5;min-height:22px}",
    ".csimu .stat{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.08);border-radius:14px;padding:8px 12px;font-size:14px;font-weight:600;line-height:1.4}.csimu .stat i{width:18px;height:18px;border-radius:50%;flex:none;background:#F5B93E}",
    ".csimu .obs{background:rgba(255,255,255,.08);border-radius:12px;padding:8px 12px;font-size:12.5px;line-height:1.55;max-height:38vh;overflow:auto}",
    ".csimu .btns{display:flex;flex-direction:column;gap:6px}.csimu .btns button{border:0;border-radius:14px;padding:13px;font:inherit;font-size:16px;font-weight:700;cursor:pointer;background:#17B3A1;color:#fff}.csimu .btns button.sec{background:rgba(255,255,255,.14)}.csimu .btns button.no{background:#DC2626}.csimu .btns button:disabled{opacity:.45}",
    ".csimu .foot{font-size:11.5px;color:rgba(255,255,255,.6);text-align:center;line-height:1.45}.csimu .foot a{color:#9FE3DA;cursor:pointer;text-decoration:underline}",
    ".csimu label.sw{display:flex;align-items:center;gap:8px;font-size:12.5px;color:rgba(255,255,255,.75);justify-content:center;background:none;border:0;padding:4px;margin:0;font-weight:400}.csimu label.sw input{width:18px;height:18px;margin:0;accent-color:#17B3A1}"
  ].join("\n");
  var UI = null, CD = null;
  function $(id) { return UI ? UI.querySelector("#" + id) : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function injectCSS() { if (document.getElementById("csimuCSS")) return; var s = document.createElement("style"); s.id = "csimuCSS"; s.textContent = CSS; document.head.appendChild(s); }
  function status(color, text) { var l = $("imL"), t = $("imT"); if (l) l.style.background = { green: "#0E9F6E", yellow: "#F5B93E", red: "#DC2626" }[color] || "#F5B93E"; if (t) t.textContent = text; }
  function coach(html) { var c = $("imC"); if (c) c.innerHTML = html; }
  function buttons(list) { var b = $("imB"); if (!b) return; b.innerHTML = ""; list.forEach(function (x) { var el = document.createElement("button"); el.textContent = x.t; if (x.cls) el.className = x.cls; el.disabled = !!x.dis; el.addEventListener("click", x.fn); b.appendChild(el); }); }
  function speak(t) { if (g.CSCam && !g.CSCam.ttsOn()) return; if (!("speechSynthesis" in g) || !t) return; try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t); u.lang = "th-TH"; u.rate = 0.95; speechSynthesis.speak(u); } catch (e) {} }
  function close() { if (CD) { clearInterval(CD); CD = null; } BLE.onState = BLE.onResult = null; if (BLE.onRaw) streamOn(false).catch(function () {}); if (UI && UI.parentNode) UI.parentNode.removeChild(UI); UI = null; try { speechSynthesis.cancel(); } catch (e) {} }
  var KIND_NM = { ftsst: "ลุกนั่ง 5 ครั้ง", tug: "ลุกเดิน 3 เมตร", balance: "ทรงตัว", chair30: "ลุกยืน 30 วินาที", walk4: "เดิน 4 เมตร" };
  var HOW = { ftsst: "นั่งกลางเก้าอี้ กอดอก · เมื่อได้ยิน \"เริ่ม\" ลุกยืนจนสุดแล้วนั่งลง 5 ครั้งให้เร็วที่สุด", tug: "นั่งพิงพนัก · เมื่อได้ยิน \"เริ่ม\" ลุกเดินไปถึงเส้น 3 เมตร หมุนตัว เดินกลับมานั่ง", balance: "ยืนนิ่งในท่าที่กำหนด 10 วินาที ลูกหลานยืนข้าง ๆ พร้อมพยุง",
    chair30: "นั่งกลางเก้าอี้ กอดอก · เมื่อได้ยิน \"เริ่ม\" ลุกยืนจนสุดแล้วนั่งลง ทำให้ได้มากครั้งที่สุดใน 30 วินาที",
    walk4: "ยืนที่เส้นเริ่ม · เมื่อได้ยิน \"เริ่ม\" เดินตามปกติ ผ่านเส้น 4 เมตร แล้วหยุดยืน" };

  function open(opts) {
    close(); injectCSS();
    var host = document.querySelector(".phone") || document.body, kind = opts.kind, stage = opts.stage || 0;
    UI = document.createElement("div"); UI.className = "csimu";
    UI.innerHTML = '<div class="st"><span class="tag" id="imTag">📡 เซ็นเซอร์คาดเอว</span><div class="big"><span id="imN">–</span><small id="imOf"></small></div>' +
      '<div class="gauge"><i id="imG"></i></div><div class="lbl" id="imL2">' + esc(KIND_NM[kind] + (kind === "balance" ? " ท่าที่ " + (stage + 1) + " · " + ((opts.stageNames || [])[stage] || "") : "")) + '</div>' +
      '<label class="sw"><input type="checkbox" id="imRaw"> บันทึกสัญญาณดิบเพื่องานวิจัย (CSV)</label></div>' +
      '<div class="dock"><div class="coach" id="imC">' + esc(HOW[kind] || "") + '</div><div class="stat"><i id="imL"></i><span id="imT">ยังไม่เชื่อมต่อ</span></div>' +
      '<div class="obs" id="imObs" hidden></div><div class="btns" id="imB"></div>' +
      '<div class="foot">ข้อมูลจากเซ็นเซอร์เป็นตัวเลขการเคลื่อนไหวเท่านั้น ไม่มีภาพ ไม่มีเสียง · <a id="imMan">จับเวลาเองแทน</a> · <a id="imX">ยกเลิก</a></div></div>';
    host.appendChild(UI);
    $("imMan").addEventListener("click", function () { close(); if (opts.onManual) opts.onManual(); });
    $("imX").addEventListener("click", function () { close(); if (opts.onCancel) opts.onCancel(); });
    var fin = function (res) { close(); opts.onDone(res); };
    var twin = null, rawLog = [], devRes = null, phase = "connect", tGo = 0, tick = null, pending = null;
    function setN(v, of) { $("imN").textContent = v; $("imOf").textContent = of || ""; }
    function gauge(p) { $("imG").style.width = clamp(p, 0, 100) + "%"; }
    function elapsed() { return (Date.now() - tGo) / 1000; }
    function show(res, by) {
      var lines = briefLines(res), ob = $("imObs"); ob.hidden = false;
      ob.innerHTML = "<b>เซ็นเซอร์วัดได้</b> (ข้อมูลประกอบ ไม่ใช่คำตัดสิน)<br>· " + lines.map(esc).join("<br>· ") +
        (twin && twin.result && twin.result.totalMs != null && res.totalMs != null ? "<br>· โทรศัพท์คำนวณซ้ำจากสัญญาณดิบได้ " + sec(twin.result.totalMs) + " (ต่าง " + Math.abs(twin.result.totalMs - res.totalMs) / 1000 + " วิ)" : "") +
        (BLE.fw ? "<br>· เฟิร์มแวร์ " + esc(BLE.fw) : "");
    }
    function done(res) {
      if (phase === "result") return; phase = "result"; devRes = res; if (tick) { clearInterval(tick); tick = null; }
      var s = res.totalMs != null ? res.totalMs / 1000 : null;
      if (kind === "balance") {
        var held = res.balance ? res.balance.heldSec : Math.min(P.BAL_SEC, elapsed()); setN(held.toFixed(1), " วินาที"); gauge(100); show(res);
        status(res.balance && res.balance.stepped ? "yellow" : "green", (held >= P.BAL_SEC - 0.2 ? "ครบ 10 วินาที" : "หยุดที่ " + held.toFixed(1) + " วินาที") + " — ลูกหลานยืนยันผล");
        coach("<b>กรุณายืนยันผล</b> เกณฑ์ CDC: ยืนครบ 10 วินาที โดยไม่ขยับเท้าและไม่ต้องจับพยุง"); speak("ครบแล้ว กรุณายืนยันผลบนหน้าจอ");
        pending = { held: Math.round(held * 10) / 10 };
        buttons([{ t: "✓ ผ่าน — ยืนครบโดยไม่ขยับเท้า", fn: function () { settle(true); }, dis: held < P.BAL_SEC - 0.2 }, { t: "✗ ไม่ผ่าน — ขยับเท้าหรือต้องจับพยุง", cls: "sec", fn: function () { settle(false); } }, { t: "↻ วัดใหม่", cls: "sec", fn: rearm }].concat(dlBtn()));
        return;
      }
      if (kind === "chair30") {
        var cn = res.chair30 ? res.chair30.stands : 0; setN(String(cn), " ครั้ง"); gauge(100); show(res);
        status(res.status === "ok" ? "green" : "yellow", (res.status === "ok" ? "ครบ 30 วินาที · " : "หยุดก่อนครบ 30 วินาที · ") + "ลุกยืนได้ " + cn + " ครั้ง");
        coach("ตรวจตัวเลขแล้วกด<b>บันทึก</b>"); speak("ครบเวลา ลุกได้ " + cn + " ครั้ง");
        buttons([{ t: "บันทึก " + cn + " ครั้ง", fn: function () { save(res); } }, { t: "↻ วัดใหม่", cls: "sec", fn: rearm }].concat(dlBtn()));
        return;
      }
      setN(s == null ? "–" : s.toFixed(1), " วินาที"); gauge(100); show(res);
      var warn = res.status !== "ok" || res.impact || (res.tug && !res.tug.turnSeen);
      status(warn ? "yellow" : "green", (res.status === "ok" ? "เสร็จสิ้น " : "หยุดก่อนครบ ") + (s == null ? "" : s.toFixed(1) + " วินาที") + (res.impact ? " · พบแรงกระแทก" : ""));
      coach(res.status === "ok" ? "ตรวจตัวเลขแล้วกด<b>บันทึก</b> — ค่าจะกลับไปหน้าจับเวลาเดิมให้ตรวจอีกครั้ง" : "ทำไม่ครบ · วัดใหม่ หรือบันทึกเท่าที่ได้");
      speak(res.status === "ok" ? "เสร็จสิ้น ใช้เวลา " + Math.round(s) + " วินาที" : "หยุดก่อนครบ");
      buttons([{ t: "บันทึก " + (s == null ? "" : s.toFixed(1) + " วินาที"), fn: function () { save(res); }, dis: s == null }, { t: "↻ วัดใหม่", cls: "sec", fn: rearm }].concat(dlBtn()));
    }
    function settle(pass) { if (!pending) return; var p = pending; pending = null; fin({ kind: "balance", stage: stage, held: p.held, pass: !!pass, imu: devRes, raw: csv(), engine: ENGINE, quality: qual(devRes) }); }
    function qual(res) { var lvl = !res ? "ต่ำ" : res.fsHz != null && res.fsHz < 40 ? "ต่ำ" : res.status !== "ok" ? "ปานกลาง" : "ดี"; return { level: lvl, fps: res ? res.fsHz : null, engine: ENGINE, fw: BLE.fw || null, n: res ? res.n : 0 }; }
    function save(res) { fin({ kind: kind, sec: res.totalMs == null ? null : Math.round(res.totalMs / 100) / 10, reps: res.ftsst ? res.ftsst.reps : res.chair30 ? res.chair30.stands : undefined,
      speed: res.walk4 ? res.walk4.speed : undefined, incomplete: res.status !== "ok", imu: res, raw: csv(), engine: ENGINE, endedBy: "imu", quality: qual(res),
      reaction: res.reactionMs != null ? Math.round(res.reactionMs / 100) / 10 : null, out: res.tug && res.tug.walkOutMs != null ? Math.round(res.tug.walkOutMs / 100) / 10 : null, back: res.tug && res.tug.walkBackMs != null ? Math.round(res.tug.walkBackMs / 100) / 10 : null,
      turnSeen: res.tug ? res.tug.turnSeen : undefined, distanceOk: res.tug ? res.tug.turnSeen : undefined }); }
    function dl() { var c = csv(); if (!c) return; var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([c], { type: "text/csv" })); a.download = "caresignal-imu-" + kind + "-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    function dlBtn() { return rawLog.length ? [{ t: "⬇ สัญญาณดิบ (CSV) สำหรับงานวิจัย", cls: "sec", fn: dl }] : []; }
    function csv() { if (!rawLog.length) return null; return "t_ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps\n" + rawLog.map(function (s) { return [s.t, s.a[0], s.a[1], s.a[2], s.w[0], s.w[1], s.w[2]].join(","); }).join("\n"); }
    async function rearm() {
      phase = "arm"; devRes = null; $("imObs").hidden = true; rawLog = []; twin = makeState(kind, stage); setN("–", ""); gauge(0);
      try { if ($("imRaw").checked) { await streamOn(true, function (s) { rawLog.push(s); if (twin) push(twin, s.t + (rawLog.length > 1 && s.t < rawLog[rawLog.length - 2].t ? 65536 : 0), s.a, s.w); }); } await cmd(CMD.ARM, KIND[kind], stage); }
      catch (e) { status("red", "สั่งอุปกรณ์ไม่ได้: " + (e.message || e)); buttons([{ t: "เชื่อมต่อใหม่", fn: doConnect }]); return; }
      arm(twin, Date.now());
      status("yellow", "ติดเซ็นเซอร์ที่เอวให้แน่น แล้วให้ผู้สูงอายุ" + (kind === "balance" ? "ยืนนิ่ง" : "นั่งนิ่ง") + " 1 วินาที"); coach(esc(HOW[kind]));
      buttons([{ t: "■ ยกเลิก", cls: "sec", fn: function () { close(); if (opts.onCancel) opts.onCancel(); } }]);
    }
    function ready() {
      if (phase !== "arm") return; phase = "ready"; status("green", "เซ็นเซอร์พร้อม · กดเริ่มเมื่อผู้สูงอายุพร้อม"); speak("พร้อมแล้ว กดเริ่มได้");
      buttons([{ t: "▶ เริ่ม (นับ 3-2-1)", fn: startCd }, { t: "■ ยกเลิก", cls: "sec", fn: function () { close(); if (opts.onCancel) opts.onCancel(); } }]);
    }
    function startCd() {
      if (phase !== "ready") return; phase = "cd"; buttons([]); var n = 3; setN(n, ""); speak("สาม"); status("yellow", "เตรียมตัว…");
      CD = setInterval(async function () { n--; if (n > 0) { setN(n, ""); speak(n === 2 ? "สอง" : "หนึ่ง"); return; } clearInterval(CD); CD = null; setN("0.0", " วินาที"); speak("เริ่ม");
        try { await cmd(CMD.GO); } catch (e) { status("red", "สั่งเริ่มไม่ได้"); return; }
        tGo = Date.now(); phase = "run"; if (twin) go(twin, tGo); status("green", "กำลังวัด"); coach(kind === "balance" ? "ยืนนิ่ง ๆ อย่าขยับเท้า" : "ทำท่าตามปกติ ระบบจับเวลาให้");
        buttons([{ t: kind === "balance" ? "■ หยุดเพื่อความปลอดภัย" : kind === "chair30" ? "■ หยุดก่อนครบเวลา" : kind === "walk4" ? "■ สิ้นสุด (หยุดเดินแล้วระบบไม่หยุด)" : "■ สิ้นสุด (นั่งลงแล้วระบบไม่หยุด)", cls: "no", fn: async function () { try { await cmd(CMD.STOP); } catch (e) {} if (twin) stop(twin, Date.now()); setTimeout(function () { if (phase === "run") done(twin && twin.result ? twin.result : { kind: kind, engine: ENGINE, status: "incomplete", totalMs: elapsed() * 1000 }); }, 600); } }]);
        tick = setInterval(function () { if (phase !== "run") return; var el = elapsed(); if (kind === "balance" || kind === "chair30") { var LIM = kind === "balance" ? P.BAL_SEC : P.CHAIR_SEC; setN(Math.max(0, LIM - el).toFixed(0), " วินาที"); gauge(el / LIM * 100); } else setN(el.toFixed(1), " วินาที"); }, 100);
      }, 1000);
    }
    BLE.onState = function (s) {
      if (phase === "arm" && s.phase === "ready") ready();
      if (phase === "arm" && s.ev === EV.HOLD) status("yellow", "ยังขยับอยู่ — ให้นิ่ง 1 วินาที");
      if (phase === "run") { if (kind !== "balance") gauge(clamp(s.tilt / 45 * 100, 0, 100)); if (s.ev === EV.STAND && kind !== "walk4") speak(kind === "ftsst" || kind === "chair30" ? String(s.count) : "เดินไปได้เลย"); if (kind === "chair30") $("imL2").textContent = "ลุกยืนแล้ว " + s.count + " ครั้ง"; if (s.ev === EV.TURN && kind === "tug") speak("เดินกลับมานั่ง"); if (s.ev === EV.IMPACT) speak("ระวัง"); }
    };
    BLE.onResult = function (r) { if (phase === "run" || phase === "cd") done(r); };
    BLE.onDisconnect = function () { if (UI) { status("red", "อุปกรณ์หลุดการเชื่อมต่อ"); buttons([{ t: "เชื่อมต่อใหม่", fn: doConnect }]); } };
    async function doConnect() {
      status("yellow", "กำลังค้นหาอุปกรณ์ CareSignal-Waist…"); buttons([]);
      try { await connect(); } catch (e) { status("red", e && e.name === "NotFoundError" ? "ไม่ได้เลือกอุปกรณ์" : "เชื่อมต่อไม่ได้: " + (e && e.message || e)); buttons([{ t: "ลองอีกครั้ง", fn: doConnect }, { t: "จับเวลาเองแทน", cls: "sec", fn: function () { close(); if (opts.onManual) opts.onManual(); } }]); return; }
      $("imTag").textContent = "📡 เชื่อมต่อแล้ว" + (BLE.fw ? " · " + BLE.fw : ""); rearm();
    }
    if (!supported()) { status("red", isiOS() ? "iPhone ยังเชื่อมต่อเซ็นเซอร์ผ่านเว็บไม่ได้ — ใช้กล้องหรือจับเวลาเองแทน" : "เบราว์เซอร์นี้ไม่รองรับบลูทูธ (ใช้ Chrome บน Android)"); buttons([{ t: "จับเวลาเองแทน", fn: function () { close(); if (opts.onManual) opts.onManual(); } }]); return; }
    buttons([{ t: "🔗 เชื่อมต่อเซ็นเซอร์", fn: doConnect }]);
    if (BLE.dev && BLE.dev.gatt && BLE.dev.gatt.connected) doConnect();
  }

  var PURE = { ENGINE: ENGINE, P: P, EV: EV, EV_NM: EV_NM, KIND: KIND, CMD: CMD, SVC: SVC, CH: CH, Core: Core, makeState: makeState, arm: arm, go: go, push: push, stop: stop, pack: pack, unpack: unpack, unpackState: unpackState, unpackRaw: unpackRaw, briefLines: briefLines,
    CHAIR_NORM: CHAIR_NORM, chairBelow: chairBelow, slowGait: slowGait, parseSelfTest: parseSelfTest };
  g.CSImu = Object.assign({ supported: supported, isiOS: isiOS, connect: connect, disconnect: disconnect, cmd: cmd, selfTest: selfTest, open: open, close: close, isOpen: function () { return !!UI; }, fw: function () { return BLE.fw; } }, PURE);
  if (typeof module !== "undefined" && module.exports) module.exports = PURE;
})(typeof window !== "undefined" ? window : this);
