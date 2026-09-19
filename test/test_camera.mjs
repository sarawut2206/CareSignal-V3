/* ทดสอบเอนจินกล้องรุ่น 2 ด้วยสัญญาณจำลองที่รู้คำตอบ · node test/test_camera.mjs */
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
{ const refs = { sitRef: 0.30, standRef: 0.55, sitK: 92, standK: 172 };
  ok("คะแนนท่าทาง: เข่าชัดใช้เข่าเป็นหลัก · เข่าไม่ชัดถอยไปใช้สะโพก", Math.abs(K.postureNorm({ h: 0.30, k: 172, kvis: 0.9 }, refs) - 0.6) < 0.01 && K.postureNorm({ h: 0.55, k: 92, kvis: 0.2 }, refs) === 1 && K.postureNorm({ h: null, k: 132, kvis: 0.9 }, refs) === 0.5); }

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
