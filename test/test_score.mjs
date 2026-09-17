/* ทดสอบเกณฑ์คะแนน V3 ให้ตรงกับ V2 · node test/test_score.mjs */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const S = require("../cs-score.js");
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log("  ตก: " + n + (x !== undefined ? " — " + JSON.stringify(x) : "")); } };

ok("ค่าตัดตามอายุ 60/70/80 = 10.0/11.5/12.1", S.ftsstCut(60) === 10.0 && S.ftsstCut(70) === 11.5 && S.ftsstCut(80) === 12.1);
ok("ขอบเขตอายุ 64→10.0, 65→11.5, 74→11.5, 75→12.1", S.ftsstCut(64) === 10 && S.ftsstCut(65) === 11.5 && S.ftsstCut(74) === 11.5 && S.ftsstCut(75) === 12.1);

const best = S.score({ age: 68, ftsst: 9, fallsCount: 0, medsCount: 1, adl: 2 });
ok("ดีทุกข้อ = 9/9 ระดับ 4", best.score === 9 && best.max === 9 && best.tier === 4, best);
const worst = S.score({ age: 68, ftsst: 70, fallsCount: 3, medsCount: 3, adl: 0 });
ok("แย่ทุกข้อ = 0/9 ระดับ 1", worst.score === 0 && worst.tier === 1, worst);
ok("ลุกนั่ง cut+2 ได้ 3 · cut+4.5 ได้ 2 · ≤60 ได้ 1", S.score({ age: 68, ftsst: 13.5 }).parts.ftsst === 3 && S.score({ age: 68, ftsst: 16 }).parts.ftsst === 2 && S.score({ age: 68, ftsst: 40 }).parts.ftsst === 1);
ok("ล้ม 1 ครั้งได้ 1 · จำไม่ได้(9) ได้ 2 เท่าไม่ล้ม", S.score({ age: 68, fallsCount: 1 }).parts.falls === 1 && S.score({ age: 68, fallsCount: 9 }).parts.falls === 2);
ok("ยา ≥4 รายการ (รหัส 2) ได้ 0 · ไม่แน่ใจ(9) ได้ 1", S.score({ age: 68, medsCount: 2 }).parts.meds === 0 && S.score({ age: 68, medsCount: 9 }).parts.meds === 1);
ok("ขอบระดับ: 8→4, 6→3, 4→2, 3→1", S.score({ age: 60, ftsst: 9, fallsCount: 0, medsCount: 2, adl: 2 }).tier === 4 && S.score({ age: 60, ftsst: 9, fallsCount: 3, medsCount: 2, adl: 2 }).tier === 3 && S.score({ age: 60, ftsst: 9, fallsCount: 3, medsCount: 2, adl: 0 }).tier === 2 && S.score({ age: 60, ftsst: 13, fallsCount: 3, medsCount: 2, adl: 0 }).tier === 1);

const f = S.flags({ age: 65, ftsst: 13, tug: 12, balance: 5, fallsCount: 3, injury: 2, getup: 3, worried: true, medsCount: 2, adl: 1 });
ok("ธงแดง B1 B2 B4 ครบ", f.level === "urgent" && ["B1", "B2", "B4"].every((id) => f.reds.some((r) => r.id === id)), f.reds.map((r) => r.id));
ok("ธงเหลือง B8 B9 B10 B11 B12 B16 ครบ", ["B8", "B9", "B10", "B11", "B12", "B16"].every((id) => f.yellows.some((r) => r.id === id)), f.yellows.map((r) => r.id));
ok("ไม่มีสัญญาณ = stable", S.flags({ age: 65, ftsst: 9, tug: 8, balance: 10, fallsCount: 0, worried: false, medsCount: 1, adl: 2 }).level === "stable");
ok("ลุกเดิน 11.9 ไม่ติดธง · 12.0 ติด", !S.flags({ age: 65, tug: 11.9 }).yellows.length && S.flags({ age: 65, tug: 12 }).yellows.some((r) => r.id === "B10"));

ok("แนวโน้ม: ช้าลง 2.3 วิ ติด R1", S.trend({ ftsst: 10 }, { ftsst: 12.3 }).some((t) => t.id === "R1"));
ok("แนวโน้ม: ช้าลง 15% ติด R1 แม้ไม่ถึง 2.3 วิ", S.trend({ ftsst: 8 }, { ftsst: 9.3 }).some((t) => t.id === "R1"));
ok("แนวโน้ม: ช้าลง 1 วิ ไม่ติด", !S.trend({ ftsst: 10 }, { ftsst: 11 }).length);
ok("แนวโน้ม: เร็วขึ้น 3 วิ เป็นข่าวดี", S.trend({ ftsst: 14 }, { ftsst: 11 }).some((t) => t.good));
ok("แนวโน้ม: เคยยืน 10 วิ ครั้งนี้ 6 ติด R8", S.trend({ balance: 10 }, { balance: 6 }).some((t) => t.id === "R8"));
ok("ไม่มีครั้งก่อน = ไม่มีแนวโน้ม", S.trend(null, { ftsst: 20 }).length === 0);

ok("ความปลอดภัย: เจ็บหน้าอก = urgent", S.safety({ chest: true }).urgent && !S.safety({ chest: true }).safe);
ok("ความปลอดภัย: เพิ่งล้ม = ไม่ปลอดภัยแต่ไม่ urgent", !S.safety({ injury: true }).safe && !S.safety({ injury: true }).urgent);
ok("ค่าจับเวลาสมเหตุสมผล: ลุกนั่ง 0 วิ ไม่ผ่าน · 12 วิ ผ่าน · 200 วิ ไม่ผ่าน", !S.plausible("ftsst", 0) && S.plausible("ftsst", 12) && !S.plausible("ftsst", 200));
ok("นัดวัดซ้ำ 90/30/14 วัน", S.nextDueDays(4) === 90 && S.nextDueDays(3) === 30 && S.nextDueDays(2) === 14 && S.nextDueDays(1) === 14);

/* ทรงตัว 4 ท่า — เกณฑ์เดียวกับ V2 (balPassed < 3) */
ok("ทรงตัวผ่าน 2/4 ท่า ติด B11", S.flags({ age: 70, balPassed: 2 }).yellows.some((y) => y.id === "B11"));
ok("ทรงตัวผ่าน 3/4 ท่า ไม่ติด แม้ขาเดียวไม่ผ่าน", !S.flags({ age: 70, balPassed: 3, balance: 10 }).yellows.some((y) => y.id === "B11"));
ok("ผ่าน 3 ท่า ใช้ balPassed ก่อนวินาที", !S.flags({ age: 70, balPassed: 3, balance: 4 }).yellows.length);
ok("แนวโน้ม: เคยผ่าน 4 ท่า ครั้งนี้ 2 ท่า ติด R8", S.trend({ balPassed: 4 }, { balPassed: 2 }).some((t) => t.id === "R8"));
ok("แนวโน้ม: ผ่านเท่าเดิม ไม่ติด", !S.trend({ balPassed: 3 }, { balPassed: 3 }).length);

/* เอกสารต้องไม่อ้างเกินจริง และต้องไม่มีความลับ */
const PAGES = ["index.html", "CareSignal-App.html", "testkit.html"];
const html = PAGES.map((f) => readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
ok("ไม่มีรหัสตั้งต้นผู้ดูแลระบบในหน้าเว็บ", !/ZHJE|รหัสผ่านคือ/i.test(html));
ok("ไม่อ้างว่าป้องกันการล้มได้ หรือแทนการตรวจโรงพยาบาล", !/ป้องกันการล้มได้แน่|แทนการตรวจที่โรงพยาบาลได้|วินิจฉัยได้/.test(html));
ok("ทุกหน้าบอกว่าไม่ใช่การวินิจฉัย", PAGES.every((f) => /ไม่ใช่การวินิจฉัย|ไม่วินิจฉัยโรค/.test(readFileSync(new URL("../" + f, import.meta.url), "utf8"))));
ok("ฝังวิดีโอครบ 3 คลิปทั้งในหน้ารวมและในแอป", ["KQaDdX66OUM", "o_HM_3u0TZk", "AO88b5YLFg0"].every((id) => PAGES.slice(0, 2).every((f) => readFileSync(new URL("../" + f, import.meta.url), "utf8").includes(id))));
ok("ให้เครดิตเจ้าของวิดีโอทั้งในหน้ารวมและในแอป", PAGES.slice(0, 2).every((f) => /Siriraj Health Policy/.test(readFileSync(new URL("../" + f, import.meta.url), "utf8")) && /สูงวัยไม่ล้ม BWSTT/.test(readFileSync(new URL("../" + f, import.meta.url), "utf8"))));
ok("แอปลูกหลานไม่ขอใช้กล้อง", !/getUserMedia|mediapipe/i.test(readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8")));
ok("โคลนระบบ V2 ครบ: คอนโซล แดชบอร์ด ใบส่งต่อ เดโม ฐานข้อมูล", ["CareSignal-Staff.html", "CareSignal-Portfolio-Dashboard.html", "CareSignal-Journey.html", "cs-referral-forms.js", "cs-demo.js", "cs-backend.js", "supabase/22_referral_forms.sql"].every((f) => { try { readFileSync(new URL("../" + f, import.meta.url)); return true; } catch (e) { return false; } }));
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
ok("service worker ไม่ลบแคชของ V2 (โดเมนเดียวกัน)", /indexOf\(PREFIX\) === 0/.test(sw) && !/CareSignal-Vision|cs-aruco/.test(sw));
ok("แอปมีทาง 1669 และไม่มีปุ่มฉุกเฉินที่อ้างว่าเรามีทีมช่วย", /tel:1669/.test(html) && !/ทีมฉุกเฉินของเรา/.test(html));
ok("index อ้างตัวเลขจากการสัมภาษณ์จริง 5/5 และ 3/3", /5\/5/.test(html) && /3\/3/.test(html));
ok("index ลิงก์กลับไป V2", /CareSignal-V2\//.test(html));

/* ---------- ชั้นเชื่อมระบบกลาง (cs-cloud.js ส่วนฟังก์ชันล้วน) ---------- */
{
  const C = require("../cs-cloud.js");
  let p2 = 0, f2 = 0;
  const ok2 = (n, c, x) => { if (c) p2++; else { f2++; console.log("  ตก: " + n + (x !== undefined ? " — " + JSON.stringify(x) : "")); } };
  const mk = (o) => Object.assign({ date: "2026-09-17T10:00:00Z", ftsst: 9, tug: 8, balance: 10, fallsCount: 0, injury: null, getup: null, worried: false, medsCount: 1, adl: 2,
                                    score: 9, max: 9, tier: 4, parts: {}, flags: { reds: [], yellows: [] }, trend: [], skipped: {} }, o);
  const clean = C.levelOf(mk({}));
  ok2("ไม่มีธง = stable ไม่ส่งต่อ นัด 90 วัน", clean.level === "stable" && !clean.referral.need && clean.nextDays === 90, clean);
  const yel = C.levelOf(mk({ tier: 3, flags: { reds: [], yellows: [{ id: "B9", text: "x", why: "y" }] } }));
  ok2("เหลืองอย่างเดียว = watch เปิดเคสแต่ไม่ส่งต่อ", yel.level === "watch" && !yel.referral.need && yel.signals[0].k === "S4" && yel.signals[0].dest === "physio", yel);
  const red = C.levelOf(mk({ tier: 2, flags: { reds: [{ id: "B1", text: "x", why: "y" }], yellows: [] } }));
  ok2("ธงแดง = urgent ส่งต่อพยาบาล 72 ชม. สัญญาณ S2 → แพทย์", red.level === "urgent" && red.referral.need && /พยาบาล/.test(red.referral.nm) && red.signals[0].k === "S2", red);
  const tr = C.levelOf(mk({ tier: 2, trend: [{ id: "R1", text: "ช้าลง", why: "MCID" }] }));
  ok2("แย่ลงจากเดิม + ระดับส้ม = decline → Care Manager โทร", tr.level === "decline" && /Care Manager/.test(tr.referral.nm) && tr.flags[0].sev === 2, tr);
  const adl = C.levelOf(mk({ tier: 3, flags: { reds: [], yellows: [{ id: "B16", text: "adl", why: "w" }] } }));
  ok2("ADL ลด = urgent สัญญาณ S6 → พยาบาล (เหมือน V2 R6)", adl.level === "urgent" && adl.signals.some((s) => s.k === "S6" && s.dest === "nurse"), adl);
  ok2("ธงมีรูปแบบ {id,text,why,sev} ที่คอนโซล V2 อ่านได้", red.flags.every((f) => f.id && f.text && f.why && f.sev));

  const pay = C.payloadOf(mk({ balance: 6, note: "ปวดเข่า", fallsCount: 3, injury: 2, getup: 3, medsCount: 2 }), { name: "ป้า", age: 68 }, "ครูแซม");
  ok2("payload: method manual · reps 5 · engine carer · ไม่อ้างยืนยันตัวตน", pay.method === "manual" && pay.reps === 5 && pay.engine === "3.0.0-carer" && pay.verified === false);
  ok2("payload: detail.measured_by carer + tug.ended_by carer (ใบส่งต่ออ่านได้)", pay.detail.measured_by === "carer" && pay.detail.tug.ended_by === "carer" && pay.testQuality.ended_by === "carer");
  ok2("payload: ข้อมูลรุ่นแรก ยืนต่อเท้า 6 วิ → passed 2 และมี label", pay.detail.balance.passed === 2 && /6 วินาที/.test(pay.detail.balance.label));
  const pay4 = C.payloadOf(mk({ balance: 4.2, balPassed: 2, balStages: [10, 10, 4.2] }), { name: "ป้า", age: 68 }, "ครูแซม");
  ok2("payload: ทรงตัว 4 ท่า ส่ง passed และ stages รายท่า", pay4.detail.balance.passed === 2 && pay4.detail.balance.stages.length === 3 && pay4.detail.balance.stages[2].stage === "tandem" && pay4.detail.balance.stages[2].passed === false && /2 จาก 4/.test(pay4.detail.balance.label));
  ok2("payload: ประวัติล้มและยาไปครบ", pay.fallsDetail.count === 3 && pay.fallsDetail.getup === 3 && pay.medsDetail.count === 2 && pay.detail.steadi.fell === true);
  ok2("payload: ข้ามทุกท่า = not_tested", C.payloadOf(mk({ ftsst: null, tug: null, balance: null }), { name: "x", age: 70 }, "y").notTested === true);
  ok2("ล้มบาดเจ็บต้องพบแพทย์ = high · ไม่บาดเจ็บลุกได้ทันที = low", C.fallSeverity({ injury: "ต้องพบแพทย์", getup: "ได้ทันที" }) === "high" && C.fallSeverity({ injury: "ไม่บาดเจ็บ", getup: "ได้ทันที" }) === "low" && C.fallSeverity({ injury: "ฟกช้ำ แผลเล็กน้อย", getup: "ได้แต่ช้า" }) === "medium");
  ok2("ปีเกิด พ.ศ. จากอายุ", C.birthYearBE(68) === new Date().getFullYear() + 543 - 68);
  const sql = readFileSync(new URL("../supabase/23_v3_carer.sql", import.meta.url), "utf8");
  ok2("migration 23: รันซ้ำได้ (if not exists / or replace) และมีทริกเกอร์ล้ม→เคส", /add column if not exists/.test(sql) && /create or replace function public\.open_case_on_fall_event/.test(sql) && /drop trigger if exists trg_open_case_on_fall_event/.test(sql));
  ok2("migration 23: ไม่แตะ RLS ให้ anon และไม่มี secret", !/to anon/.test(sql) && !/sb_secret|ZHJE/.test(sql));
  console.log("  cloud: " + p2 + " ผ่าน / " + f2 + " ตก");
  pass += p2; fail += f2;
}
/* รอบ 2: ยาจากรูป · ส้ม/แดงรอผู้เชี่ยวชาญ · คำแนะนำมีแหล่งอ้างอิง · ใบสรุปแพทย์ */
{
  const b13 = S.flags({ age: 70, fridTotal: 2, fridHigh: 1, balPassed: 4 });
  ok("ยาเสี่ยงหกล้มรวม ≥ 2 = B13 (เหลือง)", b13.yellows.some((x) => x.id === "B13") && !b13.reds.length, b13);
  ok("ยาเสี่ยงรวม 1 ไม่ติด B13", !S.flags({ age: 70, fridTotal: 1 }).yellows.some((x) => x.id === "B13"));
  const b6 = S.flags({ age: 70, fridTotal: 4, fridHigh: 2, balPassed: 1 });
  ok("ยาเสี่ยงสูง ≥ 2 + ทรงตัว ≤ 1 ท่า = B6 (แดง)", b6.reds.some((x) => x.id === "B6") && b6.level === "urgent", b6);
  ok("ยาเสี่ยงสูง 2 แต่ทรงตัวผ่าน 2 ท่า ไม่ติด B6", !S.flags({ age: 70, fridHigh: 2, balPassed: 2 }).reds.length);
  ok("ข้อความระดับสีไม่มีคำแนะนำที่ไม่มีแหล่งอ้างอิง", ![1, 2, 3, 4].some((t) => /ไม่ปล่อย|วันละ|2–4 สัปดาห์/.test(S.TIER[t].advice)));
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  ok("ส้ม/แดง ตั้ง pending = tier ≤ 2", /rec\.pending = tier <= 2/.test(app));
  ok("หน้ารอผลไม่แสดงระดับสี", /function renderResult[\s\S]*?if \(pending\(r\)\)[\s\S]*?return;\s*\}/.test(app) && !/if \(pending\(r\)\) \{[^}]*T\.nm/.test(app));
  ok("ตรวจผลยืนยันจาก review ของใบส่งต่อ + ปิดเคส", /function applyConfirmations/.test(app) && /rv\.review\.form/.test(app) && /closed_at/.test(app));
  ok("แจ้งเตือนเมื่อยืนยัน (toast + Notification)", /function notifyConfirmed/.test(app) && /new Notification\(/.test(app));
  ok("ตรวจผลซ้ำเป็นระยะ", /setInterval\(function \(\) \{ if \(CSCloud\.connected\(\) && D\.assessments\.some\(pending\)\)/.test(app));
  const ev = app.slice(app.indexOf("var EVID = {"), app.indexOf("function evidItem"));
  const keys = ev.match(/^\s{2}\w+:\s*\{ t:/gm) || [];
  ok("คำแนะนำทุกข้อมีแหล่งอ้างอิง (src)", keys.length >= 8 && (ev.match(/src: "/g) || []).length === keys.length, keys.length);
  ok("อ้าง CDC STEADI · WHO 2020 · Cochrane 2019 · World Guidelines 2022 · STOPPFall · 1669", ["CDC STEADI", "WHO Guidelines on Physical Activity", "Cochrane", "World Guidelines for Falls Prevention", "STOPPFall", "1669"].every((k) => ev.includes(k)));
  ok("ลบคำแนะนำที่ไม่มีที่มาออกแล้ว", !/ลุกนั่ง 10 ครั้ง วันละ|ไม่ปล่อยอยู่คนเดียว|ไม่ปล่อยให้อยู่คนเดียว/.test(app));
  ok("ขั้นตอนถ่ายรูปยาอยู่ใน FLOW หลังทรงตัว", /var FLOW = \["safety", "ftsst", "tug", "balance", "meds", "q", "confirm"\]/.test(app));
  ok("ถ่ายรูปด้วย input file (ไม่เปิดกล้องสด) + OCR + ส่งเภสัชกร", /capture="environment"/.test(app) && /tesseract\.js@5/.test(app) && /uploadMedPhoto/.test(app) && /saveMed\(/.test(app) && !/getUserMedia/.test(app));
  ok("ไม่มีคำสั่งหยุดยา", !/ให้หยุดยา|หยุดยาทันที/.test(app));
  ok("ใบสรุปแพทย์เป็นหน้าในแอป + พิมพ์จากแท็บใหม่เมื่อฝังในกรอบ", /function renderDoc/.test(app) && /window\.top !== window/.test(app) && /\?print=/.test(app));
  ok("แอปโหลด cs-meds.js", /<script src="\.\/cs-meds\.js"><\/script>/.test(app));
  const C = require("../cs-cloud.js");
  const pm = C.payloadOf({ date: "2026-09-18", ftsst: 12, tier: 2, pending: true, medsCount: 2, fridHigh: 1, fridTotal: 3, medsItems: [{ inn: "diazepam", frid: "bzd", lv: 2 }], flags: { reds: [], yellows: [] }, trend: [] }, { name: "x", age: 70 }, "y");
  ok("payload: ส่งรายการยาและคะแนน FRID + สถานะรอผู้เชี่ยวชาญ", pm.medsDetail.n === 1 && pm.medsDetail.frid_total === 3 && pm.detail.pending_expert === true, pm.medsDetail);
}
console.log("  " + pass + " ผ่าน / " + fail + " ตก");
process.exit(fail ? 1 : 0);
