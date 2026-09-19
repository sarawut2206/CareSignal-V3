/* ทดสอบเอนจินกล้องรุ่น 3 ด้วยสัญญาณจำลองที่รู้คำตอบ · node test/test_camera.mjs */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const K = require("../cs-camera.js");
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log("  ตก: " + n + (x !== undefined ? " — " + JSON.stringify(x) : "")); } };
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
const smooth = (x) => x * x * (3 - 2 * x);

/* ลุกนั่ง: รอบละ cyc วินาที (ลุก 35% ค้าง 15% นั่ง 35% พัก 15%) เริ่มขยับหลังสัญญาณ react วินาที */
function simFtsst(fps, cyc, noise, react = 0.4) {
  const D = new K.RepDetector({ target: 5 }); D.start(0); let fin = null;
  const pAt = (s) => { s -= react; if (s < 0) return 0; const u = (s % cyc) / cyc; return u < .35 ? smooth(u / .35) : u < .5 ? 1 : u < .85 ? 1 - smooth((u - .5) / .35) : 0; };
  for (let t = 0; t < 60000 && !fin; t += 1000 / fps) { const e = D.push(pAt(t / 1000) + rnd() * noise, t); if (e && e.event === "finish") fin = e; }
  /* คำตอบจริง: นั่งลงครั้งที่ 5 ข้ามเกณฑ์ 0.30 */
  let truth = null; for (let s = react + 4 * cyc + .5 * cyc; s < react + 5 * cyc; s += 0.001) if (pAt(s) <= 0.30) { truth = s; break; }
  return { fin, truth, reps: D.reps };
}
for (const [fps, noise] of [[30, 0.02], [15, 0.03], [10, 0.04]]) {
  const r = simFtsst(fps, 2.4, noise), err = r.fin ? Math.abs(r.fin.elapsed - r.truth) : 99;
  ok(`ลุกนั่ง ${fps} เฟรม/วิ: นับ 5 ครั้ง คลาดไม่เกิน 0.25 วิ`, r.reps === 5 && err <= 0.25, { err: +err.toFixed(3), reps: r.reps });
}
{ const r = simFtsst(30, 1.4, 0.02); ok("ลุกนั่งเร็ว (รอบละ 1.4 วิ) ยังนับครบ 5", r.reps === 5 && r.fin && Math.abs(r.fin.elapsed - r.truth) <= 0.25, r.fin); }
{ /* ลุกไม่สุด (ถึงแค่ 55%) ต้องไม่นับ */
  const D = new K.RepDetector({ target: 5 }); D.start(0);
  for (let t = 0; t < 12000; t += 33) D.push(0.55 * (0.5 - 0.5 * Math.cos(t / 1000 * Math.PI)) + rnd() * 0.02, t);
  ok("ลุกไม่สุด ไม่ถูกนับเป็นครั้ง", D.reps === 0, D.reps); }
{ const r = simFtsst(30, 2.4, 0.02, 0.9); ok("รายงานเวลาตอบสนองหลังสัญญาณเริ่มแยกไว้", r.fin && Math.abs(r.fin.reaction - 0.9) < 0.35, r.fin && r.fin.reaction); }

/* มุมเข่า 3 มิติ: นั่ง 90° ยืน 180° ไม่ขึ้นกับการหมุนรอบแกนตั้ง (มุมกล้อง) */
function legPose(kneeDeg, yaw) {
  const th = (180 - kneeDeg) * Math.PI / 180, hip = [0, 0, 0], knee = [0.45 * Math.sin(th), 0.45 * Math.cos(th) * 0 + 0.45 * (kneeDeg > 135 ? 1 : 0), 0];
  /* ต้นขา: ยืน=ชี้ลง นั่ง=ชี้ไปข้างหน้า · หน้าแข้งชี้ลงเสมอ */
  const a = (180 - kneeDeg) * Math.PI / 180, K3 = [0.45 * Math.sin(a), 0.45 * Math.cos(a), 0], A3 = [K3[0], K3[1] + 0.42, 0];
  const rot = (p) => ({ x: p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), y: p[1], z: -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw), visibility: 0.9 });
  const wl = []; wl[23] = wl[24] = rot(hip); wl[25] = wl[26] = rot(K3); wl[27] = wl[28] = rot(A3); return wl;
}
{ const errs = []; for (const yaw of [0, 0.6, 1.2, 1.57]) for (const kd of [90, 120, 170]) { const wl = legPose(kd, yaw); errs.push(Math.abs(K.kneeAngle3D(wl, wl).k - kd)); }
  ok("มุมเข่า 3 มิติถูกต้องทุกมุมกล้อง (คลาด < 1°)", Math.max(...errs) < 1, Math.max(...errs)); }
/* รุ่น 3: นาฬิกาเดินหน้าเสมอ (MediaPipe ปฏิเสธเวลาซ้ำ/ถอยหลัง ซึ่งทำให้รุ่น 2 ไม่เห็นคนเลย) */
{ const seq = [5, 5, 3, 10, 10]; let i = 0; const c = K.makeClock(() => seq[i++]); const out = seq.map(() => c());
  ok("นาฬิกาที่ส่งให้โมเดลเพิ่มขึ้นทุกครั้ง แม้เวลาระบบซ้ำหรือถอยหลัง", out.every((v, j) => j === 0 || v > out[j - 1]), out); }

/* ภาพจำลองจากกล้องหลังที่ถือสูงระดับอก: ไม่เห็นเท้า (ข้อเท้าหลุดกรอบ) · u = 0 นั่ง → 1 ยืน */
function frontLm(u, side = false, jit = 0) {
  const P = (x, y, v = 0.95) => ({ x: x + rnd() * jit, y: y + rnd() * jit, visibility: v }), m = (a, b) => a + (b - a) * u;
  const sh = m(0.40, 0.18), hip = m(0.62, 0.42), knee = side ? m(0.63, 0.62) : m(0.70, 0.62), lm = [];
  lm[11] = P(.45, sh); lm[12] = P(.55, sh); lm[23] = P(.46, hip); lm[24] = P(.54, hip); lm[25] = P(.46, knee); lm[26] = P(.54, knee);
  lm[27] = P(.46, 1.05, 0.05); lm[28] = P(.54, 1.05, 0.05); return lm;
}
{ const fs = K.features(frontLm(0), null, 0.5625), fu = K.features(frontLm(1), null, 0.5625);
  ok("ไม่เห็นเท้า ก็ยังได้ค่าท่าทางจากสะโพก–เข่า (นั่ง < 0.35 · ยืน > 0.8)", fs && fs.v != null && fs.h == null && K.absPosture(fs) < 0.35 && K.absPosture(fu) > 0.8, [K.absPosture(fs), K.absPosture(fu)]); }
{ const lm = frontLm(0); lm[25] = { x: .46, y: 1.08, visibility: 0.7 }; lm[26] = { x: .54, y: 1.1, visibility: 0.7 }; const f = K.features(lm, null, 0.56);
  ok("เข่าอยู่นอกกรอบภาพ (โมเดลเดาตำแหน่ง) → ไม่นับว่าเห็นท่า ไม่เริ่มวัดเอง", f && f.v == null && K.absPosture(f) === null, f); }
{ ok("มองไม่เห็นสะโพก → ไม่เดาค่า", K.features(frontLm(0).map((p, i) => i === 23 || i === 24 ? { ...p, visibility: 0.1 } : p), null, 0.56) === null); }

/* ลุกนั่งเต็มระบบ (ลักษณะท่าทาง → คะแนนปรับตัวเอง → ตัวนับ) ไม่มีขั้นสอบเทียบ */
function simFull(fps, { side = false, peak = 1, jit = 0.004, cyc = 2.4 } = {}) {
  const PO = new K.Posture(), D = new K.RepDetector({ target: 5 }); let t = 0, fin = null; const dt = 1000 / fps;
  for (; t < 2000; t += dt) PO.push(K.features(frontLm(0, side, jit), null, 0.5625), t);   /* นั่งรอระหว่างนับถอยหลัง */
  const seated = PO.arm(); const go = t; D.start(go);
  const uAt = (s) => { s -= 0.4; if (s < 0) return 0; const u = (s % cyc) / cyc; return peak * (u < .35 ? smooth(u / .35) : u < .5 ? 1 : u < .85 ? 1 - smooth((u - .5) / .35) : 0); };
  for (; t < go + 40000 && !fin; t += dt) { const e = D.push(PO.push(K.features(frontLm(uAt((t - go) / 1000), side, jit), null, 0.5625), t), t); if (e && e.event === "finish") fin = e; }
  return { fin, reps: D.reps, seated, lo: 0.4 + 4.5 * cyc, hi: 0.4 + 5 * cyc };
}
for (const [fps, side] of [[30, false], [15, false], [10, false], [15, true]]) {
  const r = simFull(fps, { side });
  ok(`ลุกนั่งเต็มระบบ ${fps} เฟรม/วิ มุม${side ? "ข้าง" : "หน้าเฉียง"} ไม่เห็นเท้า: นับครบ 5 และเวลาอยู่ในช่วงนั่งลงครั้งที่ 5`, r.seated === true && r.reps === 5 && r.fin && r.fin.elapsed >= r.lo - 0.3 && r.fin.elapsed <= r.hi + 0.3, { reps: r.reps, el: r.fin && r.fin.elapsed, lo: r.lo, hi: r.hi }); }
{ const r = simFull(15, { peak: 0.35 }); ok("เต็มระบบ: ลุกขึ้นแค่ครึ่งทาง ไม่ถูกนับ", r.reps === 0, r.reps); }
{ const PO = new K.Posture(); for (let t = 0; t < 1500; t += 50) PO.push(K.features(frontLm(1), null, 0.5625), t);
  ok("กดเริ่มตอนยังยืนอยู่ → ระบบรู้ว่ายังไม่นั่ง และใช้จุดอ้างอิงท่านั่งมาตรฐานแทน", PO.arm() === false && PO.R.v.lo === 0.30); }

/* ลุกเดิน: mode depth = เดินออกจากกล้อง (ตัวเล็กลง) · lateral = เดินขวางกล้อง · หมุนตัวทำให้ไหล่แคบ แต่ความสูงลำตัวไม่เปลี่ยน */
function simTug(fps, mode, total = 11, far = 1, noise = 0.01) {
  const T = new K.TugTracker(); T.goAt = 0; let fin = null, turnAt = null; const rise = 1.2, sit = 1.2, walk = (total - rise - sit) / 2, d0 = 2.5;
  for (let t = 0; t < 40000 && !fin; t += 1000 / fps) {
    const s = t / 1000 - 0.3; let p = 0, prog = 0;
    if (s > 0 && s < rise) p = smooth(s / rise); else if (s >= rise && s < total - sit) p = 1; else if (s >= total - sit && s < total) p = 1 - smooth((s - (total - sit)) / sit);
    if (s >= rise && s < rise + walk) prog = (s - rise) / walk; else if (s >= rise + walk && s < total - sit) prog = 1 - (s - rise - walk) / walk;
    const dist = 3 * far * prog, size = mode === "depth" ? 1.04 / (d0 + dist) : 1.04 / 4, cx = mode === "depth" ? 0.5 + rnd() * 0.004 : 0.1 + (dist / 1.25) * (1.04 / 4);
    const e = T.pushFrame(p + rnd() * noise * 2, size * (1 + rnd() * noise), cx, t); if (e && e.event === "turn") turnAt = t / 1000; if (e && e.event === "finish") fin = e;
  }
  let truth = 0.3 + total - sit; for (let s = total - sit; s < total; s += 0.001) if (1 - smooth((s - (total - sit)) / sit) <= 0.30) { truth = 0.3 + s; break; }
  return { fin, truth, turnAt, turnTruth: 0.3 + rise + walk };
}
for (const mode of ["depth", "lateral"]) for (const fps of [30, 12]) {
  const r = simTug(fps, mode), err = r.fin ? Math.abs(r.fin.elapsed - r.truth) : 99;
  ok(`ลุกเดิน (${mode}) ${fps} เฟรม/วิ: คลาดไม่เกิน 0.35 วิ · เห็นจุดกลับ · ครบระยะ`, err <= 0.35 && r.fin.turnSeen && r.fin.distanceOk && r.fin.axis === mode && Math.abs(r.turnAt - r.turnTruth) < 1.2, { err: +err.toFixed(2), fin: r.fin, turnAt: r.turnAt });
}
{ const r = simTug(30, "depth", 9, 0.3); ok("เดินไม่ถึง 3 เมตร (ราว 1 เมตร) ติดธงระยะไม่ครบ และประมาณระยะได้ใกล้เคียง", r.fin && r.fin.distanceOk === false && Math.abs(r.fin.meters - 0.9) < 0.3, r.fin); }
{ const r = simTug(30, "depth"); ok("ประมาณระยะเดิน 3 เมตรได้ 2.6–3.4 เมตร", r.fin && r.fin.meters >= 2.6 && r.fin.meters <= 3.4, r.fin && r.fin.meters); }

/* สัญญาณมือ: ภาพ 2 มิติ (ไหล่ 11/12 · ศอก 13/14 · ข้อมือ 15/16 · สะโพก 23/24) */
function armLm(L, R) {
  const P = (x, y, v = 0.95) => ({ x, y, visibility: v }), lm = []; lm[11] = P(.42, .35); lm[12] = P(.58, .35); lm[23] = P(.44, .6); lm[24] = P(.56, .6);
  const put = (s, e, w, sx, dir, pose) => { if (pose === "up") { lm[e] = P(sx, .24); lm[w] = P(sx, .12); } else if (pose === "side") { lm[e] = P(sx + dir * .11, .35); lm[w] = P(sx + dir * .22, .36); } else if (pose === "off") { lm[e] = P(sx, .2); lm[w] = P(sx, -0.05, .8); } else { lm[e] = P(sx, .47); lm[w] = P(sx, .58); } };
  put(11, 13, 15, .42, -1, L); put(12, 14, 16, .58, 1, R); return lm;
}
{ const A = (L, R) => [K.armPose(armLm(L, R), null, "L", 1), K.armPose(armLm(L, R), null, "R", 1)];
  ok("ท่าแขน 2 มิติ: ยก · กางข้าง · ลง · ข้อมือนอกกรอบไม่นับ", A("up", "down").join() === "up,down" && A("side", "down")[0] === "side" && A("down", "down").join() === "down,down" && A("off", "down")[0] === null, [A("up", "down"), A("side", "down"), A("off", "down")]);
  const C = K.Gestures.classify;
  ok("จำแนกสัญญาณ: สองมือ=เริ่ม · มือเดียว=บันทึก · กางแขน=สิ้นสุด · มือเดียวแต่มองไม่เห็นอีกข้าง=ไม่นับ", C("up", "up") === "both" && C("up", "down") === "one" && C("down", "side") === "side" && C("up", null) === null && C("down", "down") === null); }
{ /* 3 มิติ (เมตร, y ชี้ลง): หันข้างให้กล้อง กางแขนชี้เข้าหากล้อง ก็ยังเป็น "กางแขน" */
  const W = (x, y, z) => ({ x, y, z, visibility: .9 }), wl = []; wl[11] = W(-.18, -.45, 0); wl[13] = W(-.2, -.45, -.28); wl[15] = W(-.21, -.44, -.55); wl[23] = W(-.1, 0, 0);
  const lm = armLm("down", "down"); ok("ท่าแขน 3 มิติ: แขนชี้เข้าหากล้อง (ภาพ 2 มิติดูสั้น) ยังเห็นว่ากางแขน", K.armPose(lm, wl, "L", 1) === "side"); }
function runG(seq, fps = 15) { const G = new K.Gestures(), out = []; let t = 0; for (const [L, R, sec] of seq) for (let e = t + sec * 1000; t < e; t += 1000 / fps) { const r = G.push(L, R, t); if (r && r.fire) out.push(r.fire); } return out; }
ok("ยกสองมือค้าง 0.6 วิ = เริ่ม ครั้งเดียว (ค้างนานไม่ยิงซ้ำ)", runG([["down", "down", 1], ["up", "up", 3]]).join() === "both");
ok("ยกมือทีละข้างจนครบสองข้าง ไม่กลายเป็น 'บันทึก'", runG([["down", "down", 1], ["up", "down", 0.4], ["up", "up", 1]]).join() === "both");
ok("กางแขนแวบเดียว (0.5 วิ) ไม่นับ · ค้าง 1 วิ = สิ้นสุด", runG([["side", "down", 0.5], ["down", "down", 1]]).length === 0 && runG([["side", "down", 1.2]]).join() === "side");
ok("ท่าหายไปเฟรมเดียวไม่ทำให้เริ่มนับใหม่", runG([["up", "down", 0.5],[null, null, 0.1], ["up", "down", 0.5]]).join() === "one");
{ /* กางแขนค้างไว้ตั้งแต่ก่อนเริ่ม (ขั้นนั้นรับแค่สองมือ) ต้องไม่ "กิน" สัญญาณ — พอเข้าขั้นวัด กางแขนค้าง 1 วิ ต้องสิ้นสุดได้ */
  const G = new K.Gestures(); let t = 0, fired = null;
  for (; t < 3000; t += 66) G.push("side", "side", t, ["both"]);
  for (const e = t + 1500; t < e && !fired; t += 66) { const r = G.push("side", "side", t, ["side"]); if (r && r.fire) fired = r.fire; }
  ok("ท่าที่ไม่ใช้ในขั้นนั้นไม่ถูกนับ และไม่บล็อกสัญญาณของขั้นถัดไป", fired === "side", fired); }
ok("สั่งซ้ำได้หลังลดแขนลงก่อน", runG([["up", "up", 1], ["down", "down", 0.5], ["up", "up", 1]]).join() === "both,both");
{ /* ลุกเดิน สั่งจบด้วยกางแขน: กล้องเห็นนั่งลงแล้ว → ใช้เวลาที่นั่งลง ไม่ใช่เวลาที่กางแขน */
  const T = new K.TugTracker(); T.goAt = 0; let t = 0; const push = (p, s, sec) => { for (const e = t + sec * 1000; t < e; t += 66) T.pushFrame(p, s, 0.5, t); };
  push(0.05, 0.4, 0.5); push(1, 0.4, 1.5); push(1, 0.25, 3); push(1, 0.4, 3); T.sitN = -1e9; push(0.1, 0.4, 0.3);
  const sat = T.sitCross; push(0.1, 0.4, 2); const r = T.forceEnd(t);
  ok("ลุกเดินสั่งจบด้วยสัญญาณมือ ใช้เวลาที่เห็นนั่งลง", r.forced && r.sawSit && Math.abs(r.elapsed * 1000 - sat) < 1, { r, sat }); }

/* ทรงตัว: จำแนกท่า และจับการก้าวเท้า */
const B = new K.BalanceEngine(0);
ok("จำแนกท่าจากเท้า: ชิด · กึ่งต่อ · ต่อเท้า · ขาเดียว", B._stance({ gap: .2, lift: .1 }) === 0 && B._stance({ gap: .6, lift: .1 }) === 1 && B._stance({ gap: 1.2, lift: .1 }) === 2 && B._stance({ gap: .2, lift: .9 }) === 3);
function sidePose(footShift) { const lm = []; const P = (x, y) => ({ x, y, visibility: 0.95 });
  lm[11] = P(.50, .30); lm[12] = P(.51, .30); lm[23] = P(.50, .55); lm[24] = P(.51, .55); lm[25] = P(.5, .7); lm[26] = P(.5, .7);
  lm[27] = P(.50, .88); lm[29] = P(.48, .90); lm[31] = P(.54, .90); lm[28] = P(.50 + footShift, .88); lm[30] = P(.48 + footShift, .90); lm[32] = P(.54 + footShift, .90); return lm; }
{ const E = new K.BalanceEngine(0); let t = 0; for (let i = 0; i < 30; i++) E.frame(sidePose(0), t += 33); E.beginHold(t);
  let failAt = null; for (let i = 0; i < 300 && failAt == null; i++) { const r = E.frame(sidePose(i > 120 ? 0.08 : 0 + rnd() * 0.002), t += 33); if (r.fail) failAt = i; }
  ok("ยืนนิ่ง 4 วินาทีไม่ถูกจับผิด แล้วก้าวเท้าถูกจับได้ภายใน ~1 วินาที", failAt != null && failAt > 120 && failAt < 160, failAt); }
{ const E = new K.BalanceEngine(0); let t = 0; for (let i = 0; i < 30; i++) E.frame(sidePose(0), t += 33); E.beginHold(t); let bad = false;
  for (let i = 0; i < 300; i++) { const lm = sidePose(0); [27, 28, 29, 30, 31, 32].forEach((k) => { lm[k].x += rnd() * 0.012; lm[k].y += rnd() * 0.008; }); if (E.frame(lm, t += 33).fail) bad = true; }
  ok("จุดเท้าสั่นจากโมเดล (±0.6% ของภาพ) ไม่ถูกนับเป็นการก้าวเท้า", !bad); }
{ const Q = new K.Quality(); for (let i = 0; i < 100; i++) Q.add(i * 125, 0.9); ok("เฟรมเรตต่ำถูกรายงานว่าความน่าเชื่อถือต่ำ", Q.report().fps === 8 && Q.report().level === "ต่ำ", Q.report()); }
console.log("  กล้อง: " + pass + " ผ่าน / " + fail + " ตก"); process.exit(fail ? 1 : 0);
