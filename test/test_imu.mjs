/* ทดสอบแกนคำนวณเซ็นเซอร์คาดเอว (cs-imu.js — ฝาแฝดของ firmware/CareSignal-Waist/cs_imu_core.h)
   ด้วยสัญญาณจำลองที่รู้คำตอบ · node test/test_imu.mjs */
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const I = require("../cs-imu.js");
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log("  ตก: " + n + (x !== undefined ? " — " + JSON.stringify(x) : "")); } };
let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
const ss = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

/* ---------- เครื่องจำลอง: ลำตัว (ก้ม θ · หมุน ψ · สูง z) → ค่าที่เซ็นเซอร์บนเอวอ่านได้ ---------- */
const Ry = (t) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const Rz = (t) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
const Rx = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const mm = (A, B) => A.map((r, i) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mtv = (A, v) => [0, 1, 2].map((j) => A[0][j] * v[0] + A[1][j] * v[1] + A[2][j] * v[2]);   /* Aᵀ·v */
const mv = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
/* โปรไฟล์จากคีย์เฟรม [เวลา, ค่า] เชื่อมด้วย smoothstep */
function prof(keys) { return (t) => { if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; return v0 + (v1 - v0) * ss((t - t0) / (t1 - t0)); } return keys[keys.length - 1][1]; }; }
const d1 = (f, t, h = 1e-3) => (f(t + h) - f(t - h)) / (2 * h);
const d2 = (f, t, h = 2e-3) => (f(t + h) - 2 * f(t) + f(t - h)) / (h * h);
/* run: สร้างตัวอย่างจากโลกจำลอง แล้วป้อนแกนคำนวณ · Rm = ทิศติดตั้งเซ็นเซอร์บนลำตัว */
function run(kind, world, opt = {}) {
  const fs = opt.fs || 100, Rm = opt.Rm || [[1, 0, 0], [0, 1, 0], [0, 0, 1]], noise = opt.noise == null ? 0.01 : opt.noise, react = opt.react == null ? 0.4 : opt.react;
  const st = I.makeState(kind, opt.stage || 0); const evs = [];
  const T = opt.T || 40; let tGo = null; const t0ms = 1000;
  I.arm(st, t0ms);
  for (let k = 0; k * 1000 / fs < T * 1000; k++) {
    const tms = t0ms + k * 1000 / fs, ts = tGo == null ? -1 : (tms - tGo) / 1000 - react;   /* เวลาหลังคนเริ่มขยับ */
    const w = world(ts < 0 ? -1 : ts);   /* ก่อนเริ่ม: นิ่ง */
    const theta = w.theta * D2R, psi = w.psi * D2R, Rs = mm(mm(Rz(psi), Ry(theta)), Rm);
    const aW = [w.ah[0], w.ah[1], w.zdd / 9.81 + 1], wW = [0, 0, w.psiDot]; const ay = mv(Rz(psi), [0, w.thetaDot, 0]); wW[0] += ay[0]; wW[1] += ay[1]; wW[2] += ay[2];
    const gb = opt.bias || [0, 0, 0];
    const a = mtv(Rs, aW).map((v) => v + rnd() * noise), g = mtv(Rs, wW).map((v, i) => v + gb[i] + rnd() * noise * 20);
    const ev = I.push(st, tms, a, g); if (ev) evs.push([ev, tms]);
    if (st.phase === "ready" && tGo == null && (opt.goAt == null || tms >= t0ms + opt.goAt * 1000)) { tGo = tms + 10; I.go(st, tGo); }
    if (opt.stopAt != null && tGo != null && tms - tGo >= opt.stopAt * 1000) { I.stop(st, tms); break; }
    if (st.done) break;
  }
  return { st, res: st.result, evs, tGo };
}
const still = { theta: 0, thetaDot: 0, zdd: 0, psi: 0, psiDot: 0, ah: [0, 0] };
/* ลุกนั่ง 5 ครั้ง: รอบละ cyc วิ — ก้ม 0.4 · ลุกขึ้น 0.3 ม. ใน 0.8 · ยืน 0.3 · นั่งลง 0.8 · พัก */
function ftsstWorld(cyc = 2.4, n = 5) {
  const th = [], zz = [];
  const c = cyc / 2.4;   /* สัดส่วนช่วงย่อยคงเดิม ย่อ/ขยายตามความยาวรอบ */
  for (let i = 0; i < n; i++) { const b = i * cyc; th.push([b, 0], [b + 0.4 * c, 30], [b + 1.2 * c, 0], [b + 1.5 * c, 0], [b + 1.9 * c, 18], [b + 2.3 * c, 0]); zz.push([b, 0], [b + 0.4 * c, 0], [b + 1.2 * c, 0.3], [b + 1.5 * c, 0.3], [b + 2.3 * c, 0]); }
  const fT = prof(th), fZ = prof(zz);
  return { f: (t) => t < 0 ? still : { theta: fT(t), thetaDot: d1(fT, t), zdd: d2(fZ, t), psi: 0, psiDot: 0, ah: [0, 0] }, end: (n - 1) * cyc + 2.3 * c };
}
{ const W = ftsstWorld(); const r = run("ftsst", W.f);
  ok("ลุกนั่ง: นับครบ 5 ครั้ง สถานะ ok", r.res && r.res.status === "ok" && r.res.ftsst.reps === 5, r.res && r.res.ftsst);
  const truth = W.end + 0.4; ok("ลุกนั่ง: เวลารวมคลาดไม่เกิน 0.3 วิ", r.res && Math.abs(r.res.totalMs / 1000 - truth) <= 0.3, { got: r.res && r.res.totalMs / 1000, truth });
  ok("ลุกนั่ง: เวลาตอบสนอง ≈ 0.4 วิ", r.res && r.res.reactionMs != null && Math.abs(r.res.reactionMs / 1000 - 0.4) < 0.25, r.res && r.res.reactionMs);
  ok("ลุกนั่ง: ช่วงลุกจากเก้าอี้เฉลี่ยราว 1.2 วิ (ก้ม+ยืนขึ้น)", r.res && Math.abs(r.res.ftsst.stsMeanMs / 1000 - 1.2) < 0.35, r.res && r.res.ftsst.stsMeanMs);
  ok("ลุกนั่ง: แต่ละครั้งราว 2.4 วิ และสม่ำเสมอ (CV < 10%)", r.res && r.res.ftsst.repMs.slice(1).every((m) => Math.abs(m / 1000 - 2.4) < 0.3) && r.res.ftsst.stsCv < 10, r.res && r.res.ftsst);
  ok("ลุกนั่ง: ก้มมากสุดราว 30° · ความเร็วก้มเป็นบวก", r.res && Math.abs(r.res.ftsst.tiltMax - 30) < 5 && r.res.ftsst.peakOmega > 40, r.res && r.res.ftsst);
  ok("ลุกนั่ง: ไม่มีแรงกระแทก", r.res && !r.res.impact);
}
{ /* ทิศติดตั้งต่างกัน (หมุนบอร์ด 90° · เอียงตามอำเภอใจ) ต้องได้ผลเดียวกัน */
  const W = ftsstWorld(); const base = run("ftsst", W.f).res;
  const Rms = [Rx(90 * D2R), mm(Rz(37 * D2R), Rx(-90 * D2R)), mm(mm(Rx(20 * D2R), Ry(-35 * D2R)), Rz(80 * D2R))];
  const outs = Rms.map((Rm) => run("ftsst", W.f, { Rm }).res);
  ok("ไม่ขึ้นกับทิศติดตั้ง: นับครบ 5 ทุกทิศ", outs.every((o) => o && o.ftsst.reps === 5), outs.map((o) => o && o.ftsst.reps));
  ok("ไม่ขึ้นกับทิศติดตั้ง: เวลารวมต่างกันไม่เกิน 0.15 วิ", outs.every((o) => o && Math.abs(o.totalMs - base.totalMs) <= 150), outs.map((o) => o && o.totalMs));
  ok("ไม่ขึ้นกับทิศติดตั้ง: มุมก้มต่างกันไม่เกิน 3°", outs.every((o) => o && Math.abs(o.ftsst.tiltMax - base.ftsst.tiltMax) <= 3), outs.map((o) => o && o.ftsst.tiltMax));
}
{ const W = ftsstWorld(); const r = run("ftsst", W.f, { fs: 50, noise: 0.02 }); ok("ลุกนั่งที่ 50 Hz (สตรีมผ่านบลูทูธ) ยังนับครบและคลาดไม่เกิน 0.3 วิ", r.res && r.res.ftsst.reps === 5 && Math.abs(r.res.totalMs / 1000 - (W.end + 0.4)) <= 0.3, r.res && r.res.totalMs); }
{ const W = ftsstWorld(1.6); const r = run("ftsst", W.f); ok("ลุกนั่งเร็ว (รอบละ 1.6 วิ) ยังนับครบ 5", r.res && r.res.ftsst.reps === 5, r.res && r.res.ftsst); }
{ /* ลุกไม่สุด: ยกตัวแค่ 6 ซม. ต้องไม่นับ */
  const fZ = prof([[0, 0], [0.5, 0.06], [1.0, 0.06], [1.5, 0]]), fT = prof([[0, 0], [0.3, 15], [1.5, 0]]);
  const r = run("ftsst", (t) => t < 0 ? still : { theta: fT(t % 2.5), thetaDot: d1(fT, t % 2.5), zdd: d2(fZ, t % 2.5), psi: 0, psiDot: 0, ah: [0, 0] }, { stopAt: 14 });
  ok("ยกตัวไม่สุด (6 ซม.) ไม่ถูกนับเป็นครั้ง", r.res && r.res.ftsst.reps === 0 && r.res.status === "incomplete", r.res && r.res.ftsst); }
{ /* หยุดก่อนครบ */
  const W = ftsstWorld(2.4, 3); const r = run("ftsst", W.f, { stopAt: 12 });
  ok("หยุดก่อนครบ: สถานะ incomplete และนับได้ 3", r.res && r.res.status === "incomplete" && r.res.ftsst.reps === 3, r.res && r.res.ftsst); }

/* ลุกเดิน 3 เมตร: ลุก → เดิน 3 ม. (0.8 ม./วิ · 100 ก้าว/นาที) → หมุน 180° ใน 1.5 วิ → เดินกลับ → หมุน 120° → นั่ง */
function tugWorld(o = {}) {
  const spd = o.speed || 0.8, cad = o.cad || 100, amp = o.amp || 0.15, walk = 3 / spd, turn = o.turn || 1.5, turn2 = 1.2, st = 1.2, sit = 0.8;
  const tStand = st, tTurn = tStand + walk, tBack = tTurn + turn, tTurn2 = tBack + walk, tSit = tTurn2 + turn2, tEnd = tSit + sit;
  const fT = prof([[0, 0], [0.4, 30], [st, 0], [tSit, 0], [tSit + 0.4, 18], [tEnd, 0]]);
  const fZ = prof([[0, 0], [0.4, 0], [st, 0.3], [tSit, 0.3], [tEnd, 0]]);
  const fP = prof([[0, 0], [tTurn, 0], [tBack, 180], [tTurn2, 180], [tSit, 300]]);
  const f = (t) => { if (t < 0) return still; const walking = (t > tStand && t < tTurn) || (t > tBack && t < tTurn2); const step = walking ? amp * Math.sin(2 * Math.PI * cad / 60 * t) : 0;
    return { theta: fT(t), thetaDot: d1(fT, t), zdd: d2(fZ, t) + step * 9.81, psi: fP(t), psiDot: d1(fP, t), ah: [walking ? 0.05 * Math.sin(2 * Math.PI * cad / 120 * t) : 0, 0] }; };
  return { f, tStand, tTurn, tBack, tTurn2, tSit, tEnd, walk, turn, stepsPerLeg: walk * cad / 60 };
}
{ const W = tugWorld(); const r = run("tug", W.f, { react: 0.5 }), t = r.res && r.res.tug;
  ok("ลุกเดิน: จบเมื่อนั่งลง สถานะ ok", r.res && r.res.status === "ok", r.res);
  ok("ลุกเดิน: เวลารวมคลาดไม่เกิน 0.3 วิ", r.res && Math.abs(r.res.totalMs / 1000 - (W.tEnd + 0.5)) <= 0.3, { got: r.res && r.res.totalMs / 1000, truth: W.tEnd + 0.5 });
  ok("ลุกเดิน: เห็นการหมุนตัว ≈ 180° ใช้เวลา ≈ 1.5 วิ", t && t.turnSeen && Math.abs(t.turnDeg - 180) < 25 && Math.abs(t.turnMs / 1000 - 1.5) < 0.5, t);
  ok("ลุกเดิน: ขาไป/ขากลับ ≈ 3.75 วิ", t && Math.abs(t.walkOutMs / 1000 - W.walk) < 0.6 && Math.abs(t.walkBackMs / 1000 - W.walk) < 0.6, t);
  ok("ลุกเดิน: นับก้าวราว 12 (6 ต่อขา)", t && Math.abs(t.steps - 2 * W.stepsPerLeg) <= 3, t && t.steps);
  ok("ลุกเดิน: จังหวะก้าว ≈ 100 ก้าว/นาที", t && t.cadence != null && Math.abs(t.cadence - 100) < 15, t && t.cadence);
  ok("ลุกเดิน: ความเร็วเดินโดยประมาณ ≈ 0.8 ม./วิ", t && t.speed != null && Math.abs(t.speed - 0.8) < 0.15, t && t.speed);
  ok("ลุกเดิน: ช่วงลุกจากเก้าอี้ ≈ 1.2 วิ · นั่งลง ≈ 0.8 วิ", t && Math.abs(t.stsMs / 1000 - 1.2) < 0.4 && t.sitMs != null && Math.abs(t.sitMs / 1000 - 0.8) < 0.5, t);
  ok("ลุกเดิน: หมุนก่อนนั่ง (120°) ถูกนับเป็นการหมุนครั้งที่ 2", t && t.turn2Ms != null && t.turn2Ms > 600, t && t.turn2Ms);
}
{ const W = tugWorld({ amp: 0.28, speed: 1.1, cad: 115 }); const r = run("tug", W.f), t = r.res && r.res.tug;
  ok("ลุกเดินเร็ว ก้าวแรง (0.28 g): การเดินไม่ถูกนับเป็นลุก/นั่ง และจบถูกต้อง", r.res && r.res.status === "ok" && r.st.reps.length === 1 && Math.abs(r.res.totalMs / 1000 - (W.tEnd + 0.4)) <= 0.4, { reps: r.st.reps.length, total: r.res && r.res.totalMs }); }
{ const W = tugWorld({ speed: 0.45, cad: 80, turn: 3.2 }); const r = run("tug", W.f, { T: 60 }), t = r.res && r.res.tug;
  ok("ลุกเดินช้า (0.45 ม./วิ · หมุน 3.2 วิ): ยังจับได้ครบ และความเร็ว < 0.8", r.res && r.res.status === "ok" && t.turnSeen && t.speed < 0.6 && Math.abs(t.turnMs / 1000 - 3.2) < 0.7, t); }
{ /* ไม่หมุนตัว (เดินถอยหลังกลับ) → ไม่มี turn แต่ยังจบได้ */
  const W = tugWorld(); const f2 = (t) => { const w = W.f(t); return Object.assign({}, w, { psi: 0, psiDot: 0 }); }; const r = run("tug", f2), t = r.res && r.res.tug;
  ok("ไม่หมุนตัว: turnSeen=false แต่ยังได้เวลารวม", r.res && r.res.status === "ok" && t && !t.turnSeen && t.walkOutMs == null, t); }

/* ท่าทรงตัว 10 วินาที: แกว่งหน้า-หลัง 0.02 g ที่ 0.5 Hz · ซ้าย-ขวา 0.01 g ที่ 0.8 Hz */
function swayWorld(o = {}) { const A = o.ap == null ? 0.02 : o.ap, B = o.ml == null ? 0.01 : o.ml, f1 = 0.5, f2 = 0.8;
  return (t) => t < 0 ? still : { theta: 0, thetaDot: 0, zdd: o.stepAt != null && t > o.stepAt && t < o.stepAt + 0.15 ? 0.4 * 9.81 : 0, psi: 0, psiDot: 0, ah: [A * Math.sin(2 * Math.PI * f1 * t), B * Math.sin(2 * Math.PI * f2 * t)] }; }
{ const r = run("balance", swayWorld(), { react: 0 }), b = r.res && r.res.balance;
  ok("ทรงตัว: จบเองที่ 10 วินาที", r.res && r.res.status === "ok" && b && b.heldSec === 10, b);
  const rmsT = Math.sqrt((0.02 * 0.02 + 0.01 * 0.01) / 2) * 9.81;
  ok("ทรงตัว: RMS การแกว่งใกล้ค่าจริง (±20%)", b && Math.abs(b.rms - rmsT) / rmsT < 0.2, { got: b && b.rms, truth: rmsT });
  ok("ทรงตัว: แกนหลัก ≈ 0.02 g·9.81/√2 · แกนรอง ≈ 0.01 g·9.81/√2", b && Math.abs(b.major - 0.02 * 9.81 / Math.SQRT2) < 0.03 && Math.abs(b.minor - 0.01 * 9.81 / Math.SQRT2) < 0.03, b);
  ok("ทรงตัว: ความถี่หลักราว 0.5 Hz · ไม่มีการก้าว", b && Math.abs(b.freq - 0.5) < 0.2 && !b.stepped, b);
  ok("ทรงตัว: มี DONE event", r.evs.some((e) => e[0] === I.EV.DONE));
}
{ const r = run("balance", swayWorld({ stepAt: 4 }), { react: 0 }), b = r.res && r.res.balance; ok("ทรงตัว: กระโดด/ก้าวแรง → stepped=true", b && b.stepped, b); }
{ const r = run("balance", swayWorld({ ap: 0.06, ml: 0.05 }), { react: 0 }), b = r.res && r.res.balance; ok("ทรงตัว: แกว่งมากได้ RMS มากกว่า (ยังไม่นับเป็นก้าว)", b && b.rms > 0.4 && !b.stepped, b); }
{ const r = run("balance", swayWorld(), { react: 0, stopAt: 6.2 }), b = r.res && r.res.balance; ok("ทรงตัว: หยุดเพื่อความปลอดภัยที่ 6.2 วิ → held 6.2", b && Math.abs(b.heldSec - 6.2) < 0.15, b); }

/* แรงกระแทก */
{ const W = ftsstWorld(2.4, 2); const f = (t) => { const w = W.f(t); return t > 3 && t < 3.03 ? Object.assign({}, w, { zdd: 4 * 9.81 }) : w; };
  const r = run("ftsst", f, { stopAt: 8 }); ok("แรงกระแทก 5 g ถูกบันทึกพร้อมเวลา", r.res && r.res.impact && r.res.maxG > 3 && r.res.impactAt > 2500 && r.res.impactAt < 4000, r.res && { impact: r.res.impact, maxG: r.res.maxG, at: r.res.impactAt }); }

/* ตั้งศูนย์: ขยับระหว่างนิ่ง 1 วิ → HOLD แล้วค่อย READY */
{ const st = I.makeState("ftsst"); I.arm(st, 0); const evs = [];
  for (let k = 0; k < 350; k++) { const t = k * 10, moving = k < 150; const ev = I.push(st, t, [0, 0, 1], moving ? [0, 60 * Math.sin(k / 5), 0] : [0, 0, 0]); if (ev) evs.push(ev); }
  ok("ตั้งศูนย์: ขยับ → HOLD · นิ่งครบ 1 วิ → READY", evs.indexOf(I.EV.HOLD) >= 0 && evs[evs.length - 1] === I.EV.READY && st.phase === "ready", evs);
  ok("ตั้งศูนย์: สั่งเริ่มก่อนพร้อมไม่ได้", (() => { const s2 = I.makeState("tug"); I.arm(s2, 0); return I.go(s2, 5) === false; })()); }

/* แพ็กเก็ตผล 84 ไบต์ ไป-กลับ (เหมือน struct ในเฟิร์มแวร์) */
{ const W = ftsstWorld(); const a = run("ftsst", W.f).res, b = I.unpack(I.pack(a));
  ok("แพ็ก/แกะ ลุกนั่ง: ค่าหลักตรงกัน", b && b.kind === "ftsst" && b.totalMs === Math.round(a.totalMs) && b.ftsst.reps === 5 && b.ftsst.repMs.length === 5 && Math.abs(b.ftsst.stsCv - a.ftsst.stsCv) < 0.11 && Math.abs(b.ftsst.peakOmega - a.ftsst.peakOmega) < 0.11 && b.reactionMs === Math.round(a.reactionMs), b);
  const W2 = tugWorld(); const c = run("tug", W2.f).res, d = I.unpack(I.pack(c));
  ok("แพ็ก/แกะ ลุกเดิน: ช่วงย่อยและความเร็วตรงกัน", d && d.tug.turnSeen && d.tug.walkOutMs === c.tug.walkOutMs && d.tug.turn2Ms === c.tug.turn2Ms && Math.abs(d.tug.speed - c.tug.speed) < 0.011 && d.tug.steps === c.tug.steps, d && d.tug);
  const e = run("balance", swayWorld(), { react: 0 }).res, f = I.unpack(I.pack(e));
  ok("แพ็ก/แกะ ทรงตัว: RMS/แกน/ความถี่ตรงกัน (ทศนิยม 3)", f && Math.abs(f.balance.rms - e.balance.rms) < 0.0011 && Math.abs(f.balance.major - e.balance.major) < 0.0011 && Math.abs(f.balance.freq - e.balance.freq) < 0.011 && f.balance.heldSec === 10, f && f.balance);
  const nul = I.unpack(I.pack({ kind: "tug", status: "incomplete", totalMs: 5000, tug: { turnSeen: false } }));
  ok("แพ็ก/แกะ: ค่าที่ไม่มีเป็น null ไม่ใช่ 0", nul && nul.tug.walkOutMs === null && nul.tug.speed === null && nul.reactionMs === null && nul.status === "incomplete", nul);
  ok("แกะข้อมูลผิดรูป → null", I.unpack(new ArrayBuffer(10)) === null && I.unpackState(new DataView(new ArrayBuffer(4))) === null);
  const sv = new DataView(new ArrayBuffer(16)); sv.setUint8(0, 0xC5); sv.setUint8(1, 3); sv.setUint8(2, 3); sv.setUint8(3, 2); sv.setUint32(4, 4321, true); sv.setInt16(8, 251, true); sv.setUint8(14, 4);
  const s = I.unpackState(sv); ok("แกะสถานะสด: kind/phase/count/เวลา/มุม", s && s.kind === "balance" && s.phase === "run" && s.count === 2 && s.el === 4321 && s.tilt === 25.1 && s.ev === I.EV.STAND, s);
  const rv = new DataView(new ArrayBuffer(14)); rv.setUint16(0, 1234, true); rv.setInt16(2, -1000, true); rv.setInt16(6, 1000, true); rv.setInt16(8, 1234, true);
  const rw = I.unpackRaw(rv); ok("แกะสัญญาณดิบ: มิลลิ-g และ 0.1 องศา/วิ", rw && rw.t === 1234 && rw.a[0] === -1 && rw.a[2] === 1 && rw.w[0] === 123.4, rw);
}
/* ค่าคงที่ต้องตรงกับเฟิร์มแวร์ (อ่านจากไฟล์ .h) */
{ const h = fs.readFileSync(new URL("../firmware/CareSignal-Waist/cs_imu_core.h", import.meta.url), "utf8");
  const P = I.P, want = { CHAIR_SEC: "30", WALK_M: "4", WALK_END_MS: "1500", WALK_MIN_STEPS: "4", K_G: "0.02", TAU_V: "1.0", TAU_MOVE: "10", MOVE_W: "15", V_UP: "0.20", V_END: "0.06", D_MIN: "0.12", QUIET_S: "0.3", YAW_ON: "25", YAW_OFF_MS: "250", TURN_MIN: "90", TURN2_MIN: "60", STEP_TH: "0.06", STEP_MIN_MS: "250", IMPACT_G: "3.0", BAL_SEC: "10", TUG_M: "3", CAL_N: "100", CAL_W: "30" };
  const miss = Object.keys(want).filter((k) => !new RegExp("#define\\s+CS_" + k + "\\s+" + want[k].replace(".", "\\.") + "f?\\b").test(h) || String(P[k]) !== String(+want[k]));
  ok("ค่าคงที่ใน cs_imu_core.h ตรงกับ cs-imu.js ทุกตัว", miss.length === 0, miss);
  ok("เฟิร์มแวร์ไม่แตะไมโครโฟน (PDM) — ระบบไม่มีเสียงสั่งการ", !/PDM\.h|PDM\.begin/.test(h + fs.readFileSync(new URL("../firmware/CareSignal-Waist/CareSignal-Waist.ino", import.meta.url), "utf8")));
  ok("โครง struct 84 ไบต์ประกาศไว้ในเฟิร์มแวร์", /CS_RESULT_BYTES\s+84/.test(h));
}
/* คำอธิบายสั้นสำหรับหน้าจอ */
{ const W = tugWorld(); const r = run("tug", W.f).res, lines = I.briefLines(r);
  ok("สรุปสั้น ลุกเดิน: มีช่วงย่อย ก้าว และความเร็ว", lines.some((l) => /หมุนตัว/.test(l)) && lines.some((l) => /ก้าว\/นาที/.test(l)) && lines.some((l) => /ม\.\/วิ/.test(l)), lines);
  const b = I.briefLines({ kind: "balance", status: "ok", balance: { heldSec: 10, rms: 0.15, major: 0.1, minor: 0.05, freq: 0.5, stepped: true } });
  ok("สรุปสั้น ทรงตัว: บอกว่าเห็นการขยับให้ลูกหลานยืนยัน", b.some((l) => /ยืนยัน/.test(l)), b);
}
/* ---------- รุ่น 1.1: ลุกยืน 30 วินาที (CDC) · เดิน 4 เมตร (WFG 2022) · ชดเชยค่าคลาดไจโร · ตรวจเครื่อง ---------- */
{ /* ลุกยืน 30 วินาที: รอบละ 2.4 วิ เริ่มขยับหลังสัญญาณ 0.4 วิ → ยืนสุดครบ 12 ครั้งก่อน 30 วิ ครั้งที่ 13 กำลังลุกเกินครึ่งทางตอนครบเวลา */
  const W = ftsstWorld(2.4, 14); const r = run("chair30", W.f, { T: 45 }), c = r.res && r.res.chair30;
  ok("ลุกยืน 30 วินาที: จบเองที่ 30 วินาที", r.res && r.res.status === "ok" && Math.abs(r.res.totalMs - 30000) <= 20, r.res && r.res.totalMs);
  ok("ลุกยืน 30 วินาที: ยืนสุดครบ 12 ครั้ง + นับครั้งที่ลุกเกินครึ่งทางตามกติกา CDC = 13", c && c.full === 12 && c.half === true && c.stands === 13, c);
  const W2 = ftsstWorld(3.0, 12); const r2 = run("chair30", W2.f, { T: 45 }), c2 = r2.res && r2.res.chair30;
  /* รอบละ 3 วิ: ยืนสุดที่ 0.4+1.5+3k → k ≤ 9 = 10 ครั้ง · ครั้งที่ 11 เริ่ม 30.4 วิ (ยังไม่ลุก) → ไม่นับครึ่ง */
  ok("ลุกยืน 30 วินาที (ช้า รอบละ 3 วิ): 10 ครั้ง ไม่นับครึ่ง", c2 && c2.stands === 10 && c2.half === false, c2);
  const r3 = run("chair30", W.f, { T: 45, stopAt: 12 }); ok("ลุกยืน 30 วินาที: หยุดก่อนครบ = incomplete พร้อมจำนวนที่ทำได้", r3.res && r3.res.status === "incomplete" && r3.res.chair30.stands >= 4 && r3.res.chair30.stands <= 5, r3.res && r3.res.chair30);
  ok("เกณฑ์ CDC 30-Second Chair Stand: ชาย 72 ปี 11 ครั้ง = ต่ำกว่าค่าเฉลี่ย (เกณฑ์ 12) · หญิง 72 ปี 11 ครั้ง = ไม่ต่ำ (เกณฑ์ 10)",
     I.chairBelow(11, 72, "m").below === true && I.chairBelow(11, 72, "f").below === false && I.chairBelow(11, 55, "m") === null);
}
function walkWorld(speed, cad, amp = 0.15, delay = 0.5) {
  const dur = 4 / speed;
  return { dur, f: (t) => { if (t < 0) return still; const on = t > delay && t < delay + dur; const step = on ? amp * Math.sin(2 * Math.PI * cad / 60 * (t - delay) - Math.PI / 2) : 0;
    return { theta: 0, thetaDot: 0, zdd: step * 9.81, psi: 0, psiDot: 0, ah: [on ? 0.05 * Math.sin(2 * Math.PI * cad / 120 * t) : 0, 0] }; } };
}
for (const [sp, cad] of [[1.0, 110], [0.6, 90], [1.3, 120]]) {
  const W = walkWorld(sp, cad); const r = run("walk4", W.f, { T: 20 }), w = r.res && r.res.walk4;
  ok(`เดิน 4 เมตร ${sp} ม./วิ: ความเร็วคลาดไม่เกิน 12% · จังหวะก้าวคลาดไม่เกิน 10%`, w && Math.abs(w.speed - sp) / sp <= 0.12 && Math.abs(w.cadence - cad) / cad <= 0.10 && r.res.status === "ok", w);
}
{ const W = walkWorld(0.6, 90); const r = run("walk4", W.f, { T: 20 });
  ok("เดิน 4 เมตรช้ากว่า 0.8 ม./วิ = เดินช้า (World Guidelines 2022)", I.slowGait(r.res.walk4.speed) === true && I.slowGait(1.0) === false);
  const r2 = run("walk4", (t) => still, { T: 6, stopAt: 4 }); ok("เดิน 4 เมตร: ไม่เดินเลย = incomplete ไม่มีความเร็ว", r2.res && r2.res.status === "incomplete" && r2.res.walk4.speed === null, r2.res && r2.res.walk4); }
{ /* ค่าคลาดไจโร 1.5 / −1.0 / 0.8 องศา/วิ (ระดับจริงของ BMI270 ที่ยังไม่ปรับเทียบ) */
  const W = tugWorld(), bias = [1.5, -1.0, 0.8];
  const r = run("tug", W.f, { bias }), t = r.res && r.res.tug, est = r.st.wB;
  ok("ประมาณค่าคลาดไจโรจากช่วงนิ่งได้ใกล้ค่าจริง (คลาด < 0.2 องศา/วิ ทุกแกน)", est.every((v, i) => Math.abs(v - bias[i]) < 0.2), est);
  ok("มีค่าคลาดไจโรแล้ว ลุกเดินยังวัดได้: รวมคลาด ≤ 0.3 วิ · หมุนตัว 180° ± 15°", r.res && Math.abs(r.res.totalMs / 1000 - (W.tEnd + 0.4)) <= 0.3 && t.turnSeen && Math.abs(t.turnDeg - 180) <= 15, t);
  ok("ผลบอกขนาดค่าคลาดไจโรเพื่อใช้ตรวจคุณภาพ", r.res.gyroBias > 1.5 && r.res.gyroBias < 2.2, r.res.gyroBias);
  const rs = run("balance", swayWorld(), { react: 0, bias }), b = rs.res.balance;
  ok("ค่าคลาดไจโรไม่ทำให้การแกว่งขณะยืนเพี้ยน (RMS ใกล้ค่าไม่มีค่าคลาด ±15%)", Math.abs(b.rms - run("balance", swayWorld(), { react: 0 }).res.balance.rms) / b.rms < 0.15, b);
}
{ /* แพ็กเก็ตรุ่น 2 */
  const c = run("chair30", ftsstWorld(2.4, 14).f, { T: 45 }).res, cu = I.unpack(I.pack(c));
  ok("แพ็ก/แกะ ลุกยืน 30 วินาที: จำนวนครั้งและธงครึ่งทาง", cu && cu.kind === "chair30" && cu.chair30.stands === 13 && cu.chair30.half === true && cu.engine === "fw-2", cu && cu.chair30);
  const w = run("walk4", walkWorld(1.0, 110).f, { T: 20 }).res, wu = I.unpack(I.pack(w));
  ok("แพ็ก/แกะ เดิน 4 เมตร: เวลา ความเร็ว ก้าว", wu && wu.kind === "walk4" && wu.walk4.durMs === w.walk4.durMs && Math.abs(wu.walk4.speed - w.walk4.speed) < 0.011 && wu.walk4.steps === w.walk4.steps, wu && wu.walk4);
}
{ /* ตรวจเครื่องก่อนใช้ (self-test) — ข้อความจากเฟิร์มแวร์ */
  const good = I.parseSelfTest("ST fs=99.8 g=1.004 gb=0.31,-0.22,0.12 gn=0.06 an=0.003");
  const bad = I.parseSelfTest("ST fs=52.0 g=1.210 gb=4.1,0.2,0.1 gn=0.9 an=0.02");
  ok("ตรวจเครื่อง: ค่าปกติผ่านทุกข้อ", good.ok && good.checks.fs && good.checks.g && good.checks.bias && good.checks.noise, good);
  ok("ตรวจเครื่อง: อัตราสุ่มต่ำ/แรงโน้มถ่วงเพี้ยน/ค่าคลาดสูง ไม่ผ่าน", !bad.ok && !bad.checks.fs && !bad.checks.g && !bad.checks.bias && !bad.checks.noise, bad);
  const h = fs.readFileSync(new URL("../firmware/CareSignal-Waist/CareSignal-Waist.ino", import.meta.url), "utf8");
  ok("เฟิร์มแวร์: มีคำสั่งตรวจเครื่อง รูปแบบข้อความตรงกับตัวอ่าน และบันทึกผ่านสาย USB ได้", /CMD_SELFTEST\s*=\s*6/.test(h) && /"ST fs="/.test(h) && /" gb="/.test(h) && /Serial\.print/.test(h));
  const core = fs.readFileSync(new URL("../firmware/CareSignal-Waist/cs_imu_core.h", import.meta.url), "utf8");
  ok("แกน C: มีท่า ลุกยืน 30 วินาที/เดิน 4 เมตร และชดเชยค่าคลาดไจโร", /CS_KIND_CHAIR30 = 4/.test(core) && /CS_KIND_WALK4 = 5/.test(core) && /s->wB\[0\] = s->calW\[0\] \/ s->calN/.test(core) && /b\[1\] = 2;/.test(core));
}
console.log(`cs-imu: ผ่าน ${pass} · ตก ${fail}`);
process.exit(fail ? 1 : 0);
