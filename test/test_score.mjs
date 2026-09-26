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
ok("การวัดกดเองได้โดยไม่ต้องใช้กล้อง — โค้ดกล้องแยกอยู่ใน cs-camera.js ไม่ปนในแอปหลัก", !/getUserMedia|mediapipe/i.test(readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8")) && /cs-camera\.js/.test(readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8")));
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
  ok("ตรวจผลซ้ำเป็นระยะ", /setInterval\(function \(\) \{ if \(CSCloud\.connected\(\) && \(D\.assessments\.some\(pending\)/.test(app));
  const ev = app.slice(app.indexOf("var EVID = {"), app.indexOf("function evidItem"));
  const keys = ev.match(/^\s{2}\w+:\s*\{ t:/gm) || [];
  ok("คำแนะนำทุกข้อมีแหล่งอ้างอิง (src)", keys.length >= 8 && (ev.match(/src: "/g) || []).length === keys.length, keys.length);
  ok("อ้าง CDC STEADI · WHO 2020 · Cochrane 2019 · World Guidelines 2022 · STOPPFall · 1669", ["CDC STEADI", "WHO Guidelines on Physical Activity", "Cochrane", "World Guidelines for Falls Prevention", "STOPPFall", "1669"].every((k) => ev.includes(k)));
  ok("ลบคำแนะนำที่ไม่มีที่มาออกแล้ว", !/ลุกนั่ง 10 ครั้ง วันละ|ไม่ปล่อยอยู่คนเดียว|ไม่ปล่อยให้อยู่คนเดียว/.test(app));
  ok("ขั้นตอนถ่ายรูปยาอยู่ใน FLOW หลังทรงตัว · ตามด้วยบาร์เธลและสำรวจบ้านก่อนตรวจทาน", /var FLOW = \["safety", "ftsst", "tug", "balance", "meds", "q", "adl", "homechk", "confirm"\]/.test(app));
  ok("ถ่ายรูปยาด้วย input file (ไม่เปิดกล้องสด) + OCR + ส่งเภสัชกร", /capture="environment"/.test(app) && /tesseract\.js@5/.test(app) && /uploadMedPhoto/.test(app) && /saveMed\(/.test(app) && !/getUserMedia/.test(app));
  ok("ไม่มีคำสั่งหยุดยา", !/ให้หยุดยา|หยุดยาทันที/.test(app));
  ok("ใบสรุปแพทย์เป็นหน้าในแอป + พิมพ์จากแท็บใหม่เมื่อฝังในกรอบ", /function renderDoc/.test(app) && /window\.top !== window/.test(app) && /\?print=/.test(app));
  ok("แอปโหลด cs-meds.js", /<script src="\.\/cs-meds\.js"><\/script>/.test(app));
  const C = require("../cs-cloud.js");
  const pm = C.payloadOf({ date: "2026-09-18", ftsst: 12, tier: 2, pending: true, medsCount: 2, fridHigh: 1, fridTotal: 3, medsItems: [{ inn: "diazepam", frid: "bzd", lv: 2 }], flags: { reds: [], yellows: [] }, trend: [] }, { name: "x", age: 70 }, "y");
  ok("payload: ส่งรายการยาและคะแนน FRID + สถานะรอผู้เชี่ยวชาญ", pm.medsDetail.n === 1 && pm.medsDetail.frid_total === 3 && pm.detail.pending_expert === true, pm.medsDetail);
}
/* โหมดติดตั้งลงมือถือ + โลโก้ที่ต้องต่างจาก V2 (อยู่โดเมนเดียวกัน ติดตั้งพร้อมกันได้) */
{
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  const mf = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  ok("manifest: ชื่อย่อไม่ซ้ำ V2 และเปิดที่ตัวแอป", mf.short_name === "CareSignal V3" && mf.start_url === "./CareSignal-App.html" && mf.display === "standalone", mf.short_name);
  ok("manifest: ไอคอนครบทั้งแบบธรรมดาและ maskable", mf.icons.filter((i) => i.purpose === "maskable").length === 2 && mf.icons.filter((i) => i.sizes === "512x512").length === 2);
  ok("manifest: ทางลัดมีวัดวันนี้และบันทึกว่าล้ม", mf.shortcuts.some((x) => /go=fall/.test(x.url)) && mf.shortcuts.length >= 3);
  const png = (f) => readFileSync(new URL("../" + f, import.meta.url));
  for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon-64.png", "logo-mark.png"])
    ok("มีไฟล์ไอคอน " + f, png(f).slice(1, 4).toString() === "PNG" && png(f).length > 1000);
  /* ไอคอน V3 เป็นนาฬิกาจับเวลาเขียว ไม่ใช่โล่น้ำเงินของ V2 — เทียบสีมุมซ้ายบนของภาพจริง */
  const px = (f) => { const b = png(f); let i = 8, out = null;
    while (i < b.length) { const len = b.readUInt32BE(i), typ = b.slice(i + 4, i + 8).toString();
      if (typ === "IHDR") out = { w: b.readUInt32BE(i + 8), h: b.readUInt32BE(i + 12) };
      i += 12 + len; if (typ === "IEND") break; }
    return out; };
  ok("ไอคอน 512 ขนาดถูกต้อง", px("icon-512.png").w === 512 && px("icon-512.png").h === 512, px("icon-512.png"));
  ok("apple-touch-icon 180 · favicon 64", px("apple-touch-icon.png").w === 180 && px("favicon-64.png").w === 64);
  const idx = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  ok("รูปแชร์ชี้ไปที่ V3 ไม่ใช่ V2", /og:image" content="https:\/\/sarawut2206\.github\.io\/CareSignal-V3\/icon-512\.png/.test(idx) && !/CareSignal-V2\/icon-512/.test(idx));
  ok("แอปมีปุ่มติดตั้งบนหน้าแรก", /installApp\(\)">📲 ติดตั้งลงหน้าจอมือถือ/.test(app));
  ok("รับ beforeinstallprompt แล้วเรียกหน้าต่างติดตั้งเอง", /addEventListener\("beforeinstallprompt"/.test(app) && /A2HS\.defer\.prompt\(\)/.test(app));
  {
    const I = require("../cs-install.js"), G = (ua) => I.guide(ua);
    const UA = { ios26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      ios17: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      crios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
      line: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0",
      fb: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]",
      and: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36", pc: "Mozilla/5.0 (Windows NT 10.0) Chrome/140" };
    ok("iPhone iOS 26: ปุ่มแชร์อยู่ในเมนู ••• · ชื่อเมนูไทยถูก · เตือนให้เปิดสวิตช์เปิดเป็นเว็บแอป", /จุดสามจุด/.test(G(UA.ios26).html) && /เพิ่มไปยังหน้าจอโฮม/.test(G(UA.ios26).html) && /เปิดเป็นเว็บแอป/.test(G(UA.ios26).html) && !/•••<\/b> ที่มุม/.test(G(UA.ios17).html));
    ok("Chrome บน iPhone ติดตั้งได้ (iOS 16.4+) ไม่บังคับให้ย้ายไป Safari", /Chrome/.test(G(UA.crios).title) && /เพิ่มไปยังหน้าจอโฮม/.test(G(UA.crios).html));
    ok("LINE มีปุ่มเปิดในเบราว์เซอร์ (openExternalBrowser=1) · Facebook มีปุ่มคัดลอกลิงก์", /openExternalBrowser=1/.test(G(UA.line).action.href) && G(UA.fb).action.copy && /ติดตั้งบน Android/.test(G(UA.and).title) && /คอมพิวเตอร์/.test(G(UA.pc).title));
    ok("แอปและหน้าเว็บใช้คู่มือติดตั้งชุดเดียวกัน · แอปมีไอคอนและแท็ก iPhone", /cs-install\.js/.test(app) && /cs-install\.js/.test(idx) && /CSInstall\.guide\(\)/.test(app) && /CSInstall\.guide\(\)/.test(idx) && /rel="apple-touch-icon"/.test(app) && /apple-mobile-web-app-capable/.test(app));
  }
  ok("ติดตั้งแล้วหรืออยู่ในกรอบเว็บ ไม่ชวนติดตั้งซ้ำ", /function installedApp/.test(app) && /if \(embedded\(\) \|\| installedApp\(\)/.test(app));
  ok("ปิดแถบชวนติดตั้งแล้วจำไว้", /localStorage\.setItem\(A2HS\.key, "no"\)/.test(app));
  ok("ทางลัด ?go= เปิดหน้าที่ต้องการได้", /\["fall", "test", "history", "meds", "video", "appts"\]\.indexOf\(goto\)/.test(app));
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  ok("sw แคชไอคอนและขึ้นเวอร์ชันใหม่", /icon-192\.png/.test(sw) && /apple-touch-icon\.png/.test(sw) && /cs3-site-26/.test(sw));
}

/* ใบส่งต่อแบบเอกสารทางการ: ทุกสัญญาณต้องมีเกณฑ์ เหตุผล และเอกสารอ้างอิง */
{
  const E = require("../cs-evidence.js");
  const src = readFileSync(new URL("../cs-score.js", import.meta.url), "utf8");
  const ids = [...new Set([...src.matchAll(/id: "([BR][0-9+]+)"/g)].map((m) => m[1]))];
  ok("ทุกสัญญาณใน cs-score มีหลักฐานใน cs-evidence", ids.every((k) => E.FLAG[k] && E.FLAG[k].rule && E.FLAG[k].why && E.FLAG[k].refs.length), ids.filter((k) => !E.FLAG[k]));
  const M = require("../cs-meds.js");
  const groups = Object.keys(M.FRID).filter((k) => k !== "none");
  ok("ยาเสี่ยงหกล้มทุกกลุ่มมีกลไก ข้อพิจารณา และอ้างอิง", groups.every((k) => E.FRID[k] && E.FRID[k].mech && E.FRID[k].consider && E.FRID[k].refs.length), groups.filter((k) => !E.FRID[k]));
  const keys = Object.values(E.FLAG).concat(Object.values(E.FRID)).flatMap((x) => x.refs);
  ok("ทุกเลขอ้างอิงชี้ไปที่เอกสารที่มีอยู่จริงในรายการ", keys.every((k) => E.REFS[k]));
  ok("ข้อพิจารณาเรื่องยาไม่สั่งหยุดหรือปรับยาเอง", !Object.values(E.FRID).some((x) => /หยุดยา|ให้หยุด|เลิกยา/.test(x.consider)));
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  ok("ใบส่งต่อมีโลโก้ เลขที่เอกสาร เรื่อง เรียน และส่วนตอบกลับ", /icon-192\.png" alt="CareSignal"/.test(app) && /docNo/.test(app) && /<b>เรื่อง<\/b>/.test(app) && /<b>เรียน<\/b>/.test(app) && /ส่วนที่ ๒ สำหรับผู้รับการส่งต่อ/.test(app));
  ok("ใบส่งต่อบอกว่าเป็นระบบกฎที่อธิบายได้ และไม่ใช่การวินิจฉัย", /ระบบกฎที่อธิบายได้ \(rule-based\)/.test(app) && /ไม่ใช่การวินิจฉัยหรือคำสั่งการรักษา/.test(app));
  ok("พิมพ์ขนาด A4 ขอบตามแบบหนังสือราชการ", /@page\{size:A4;margin:15mm 20mm 20mm 30mm\}/.test(app));
  ok("ผลจากระบบกลางคำนวณสัญญาณใหม่ ไม่ขึ้นว่าไม่พบสัญญาณผิด ๆ", /function recFlags/.test(app) && /rec\.flags = recFlags\(rec, e\)/.test(app));
  const C2 = readFileSync(new URL("../cs-cloud.js", import.meta.url), "utf8");
  ok("ดึงประวัติล้ม ยา ทรงตัว จากระบบกลางมาครบ", /fallsCount: fd\.count/.test(C2) && /balPassed: d\.balance/.test(C2) && /medsCount: md\.count/.test(C2));
  ok("ตัวอักษรปรับได้ 3 ระดับ และแก้มือถือที่เปิดแบบเดสก์ท็อป", /var TXT = \[/.test(app) && /function fitPhone/.test(app) && /innerWidth \/ sw/.test(app));
  ok("การ์ดทีมดูแลไม่แสดงรหัสภาษาอังกฤษ", /REF_ST\[r\.status\]/.test(app) && /DEST_NM\[r\.destination\]/.test(app) && /function thAction/.test(app));
  const sw2 = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  ok("sw แคช cs-evidence.js", /"\.\/cs-evidence\.js"/.test(sw2));
}

/* ทรงตัว 4 ท่า: ไม่จบเองเมื่อท่าใดไม่ครบ 10 วินาที และเก็บเวลาทุกท่า */
{
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  ok("ท่าไม่ครบ 10 วิ มีปุ่มไปท่าถัดไป และปุ่มหยุดตาม CDC", /onclick="balNext\(true\)">บันทึก ' \+ sw\.val\.toFixed\(1\) \+ ' วินาที · ไปท่าที่/.test(app) && /หยุดการทรงตัว \(ตามแนวทาง CDC\)/.test(app));
  ok("ไปท่าที่ยากกว่าหลังไม่ผ่าน ต้องยืนยันว่ามีคนประคอง", /!ok && cont && d\.balStages\.length < 3 &&\s*!confirm\("ท่าถัดไปยากกว่า/.test(app));
  ok("ข้ามท่าเก็บเป็น null ไม่ใช่ 0 วินาที", /function balSkip/.test(app) && /d\.balStages\.push\(null\)/.test(app));
  ok("ระดับที่ผ่านนับแบบ CDC (ผ่านต่อเนื่องจากท่าแรก)", /while \(n < st\.length && st\[n\] != null && st\[n\] >= 10 && !\(d\.balFail && d\.balFail\[n\]\)\) n\+\+/.test(app));
  ok("แสดงผลรายท่าในหน้าผลและใบส่งต่อ", (app.match(/balDetail\(r\.balStages\)/g) || []).length >= 2);
  const C3 = require("../cs-cloud.js");
  const pay = C3.payloadOf({ date: "2026-09-19", ftsst: 10, tier: 3, balStages: [10, 7.2, 3.1, null], balPassed: 1, balance: 3.1, flags: { reds: [], yellows: [] }, trend: [] }, { name: "x", age: 69 }, "y");
  ok("ส่งขึ้นระบบกลางครบ 4 ท่า ท่าที่ข้ามเป็น tested:false", pay.detail.balance.stages.length === 4 && pay.detail.balance.stages[3].tested === false && pay.detail.balance.stages[3].passed === null && pay.detail.balance.stages[1].passed === false, pay.detail.balance.stages);
  const f = S.flags({ age: 69, balPassed: 1, balance: 3.1 });
  ok("ผ่านต่อเนื่อง 1 ท่า = สัญญาณทรงตัว B11", f.yellows.some((x) => x.id === "B11"));
}

/* นัดหมายและการติดตามของครอบครัว */
{
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  const cl = readFileSync(new URL("../cs-cloud.js", import.meta.url), "utf8");
  ok("ดึงนัดติดตามของเจ้าหน้าที่จากระบบกลาง", /B\.listFollowUps\(null, 30\)/.test(cl) && /followUps: fu/.test(cl));
  ok("นัดครบทุกชนิดของตาราง follow_ups", ["checkin_7d", "review_30d", "reassess", "referral_check"].every((k) => new RegExp("\\b" + k + ":\\s+\\[").test(app)));
  ok("รอบวัดซ้ำใช้ nextDueDays ของเครื่องคิดคะแนน", /CSScore\.nextDueDays\(last\.tier\) \* 864e5/.test(app));
  ok("ไฟล์ปฏิทินมีเตือนก่อน 1 วันและวันนัด", /TRIGGER:-P1D/.test(app) && /"TRIGGER:" \+ \(x\.appt \? "-PT15M" : "PT0M"\)/.test(app) && /text\/calendar/.test(app));
  ok("เตือนถึงวันนัดวันละครั้ง", /cs3:duenote/.test(app) && /tag: "cs3-due"/.test(app));
  ok("กระดิ่งพาไปหน้านัดเมื่อมีนัดถึงกำหนด", /if \(apptsDue\(\)\.length\) return go\("appts"\)/.test(app));
}

/* นัดตรวจทางวิดีโอคอล (27_teleconsult.sql) */
{
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  const vis = readFileSync(new URL("../CareSignal-Visit.html", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/27_teleconsult.sql", import.meta.url), "utf8");
  const T = require("../cs-teleconsult.js");
  ok("ครอบครัวเลือกเวลาและเลือกความยินยอมเอง (ไม่ติ๊กไว้ก่อน)", /id="vs_' \+ a\.id \+ '">/.test(app) && /ไม่ติ๊กก็ได้รับการตรวจตามปกติ/.test(app));
  ok("นัดวิดีโอเข้าไปในรายการนัดและปฏิทิน", /kind: "video", at: new Date\(a\.slot_at\)/.test(app) && /x\.appt \? "-PT15M"/.test(app));
  ok("ห้องวิดีโอขอสิทธิ์จาก appt_join ก่อนเปิดกล้อง", vis.indexOf("joinAppointment(APPT)") >= 0 && vis.indexOf("joinAppointment(APPT)") < vis.indexOf("await openMedia()"));
  ok("ห้องวิดีโอไม่บันทึกภาพหรือเสียง", !/MediaRecorder/.test(vis) && /ไม่บันทึกภาพหรือเสียง/.test(vis));
  ok("รหัสห้องไม่เปิดให้อ่านจากตาราง", /revoke select on public\.appointments from anon, authenticated/.test(sql) && !/grant select \([^)]*\broom\b/.test(sql));
  ok("บริษัทประกันไม่ได้รับ user_id ชื่อ หรือรหัสสมาชิก", (() => { const m = sql.match(/function public\.insurer_prevention_list\(\)\s*returns table \(([^)]*)\)/); return m && !/user_id|display_name|pseudonym|phone/.test(m[1]); })());
  ok("ส่งบริษัทได้เฉพาะยืนยันว่าเสี่ยงจริงและครอบครัวยินยอม", /fr\.risk <> 'confirmed'/.test(sql) && /not coalesce\(a\.share_insurer, false\)/.test(sql));
  ok("แบบยืนยันผลต้องลงชื่อ ใบอนุญาต และรับรอง แก้ไขไม่ได้", /attested\s+boolean not null check \(attested\)/.test(sql) && /revoke insert, update, delete on public\.final_reports/.test(sql));
  ok("ตรวจเบอร์โทรในสรุปได้ทุกรูปแบบ", ["081-234-5678", "0812345678", "02-123-4567"].every((x) => T.leaksIdentity(x, {})) && !T.leaksIdentity("อายุ 70–79 ปี ติดตาม 30 วัน", {}));
  const now = Date.parse("2026-09-20T10:00:00Z");
  ok("เข้าห้องได้ก่อนนัด 15 นาทีถึงหลังหมดเวลา 60 นาที",
    !T.joinWindow({ status: "confirmed", slot_at: "2026-09-20T10:20:00Z", minutes: 20 }, now).open &&
    T.joinWindow({ status: "confirmed", slot_at: "2026-09-20T10:15:00Z", minutes: 20 }, now).open &&
    T.joinWindow({ status: "in_call", slot_at: "2026-09-20T08:45:00Z", minutes: 20 }, now).open &&
    !T.joinWindow({ status: "confirmed", slot_at: "2026-09-20T08:30:00Z", minutes: 20 }, now).open);
  ok("ผลยืนยันแปลงกลับใบส่งต่อเดิมได้", T.toReview({ risk: "confirmed", findings: "x", recommend: "y" }).form.verdict === "confirm" && T.toReview({ risk: "not_confirmed", findings: "x", recommend: "y" }).next_step === "sufficient");
}

/* วัดด้วยกล้อง (ทางเลือก) — ตัวตรวจจับยกจาก V2 ทั้งชุด */
{
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  const cam = readFileSync(new URL("../cs-camera.js", import.meta.url), "utf8");
  const cl = readFileSync(new URL("../cs-cloud.js", import.meta.url), "utf8");
  const K = require("../cs-camera.js");
  ok("เลือกได้สองแบบและจำค่าไว้: กดจับเวลาเอง / กล้องช่วยนับ", /cs3:measure/.test(app) && /setMeasureMode\(\\'manual\\'\)/.test(app) && /setMeasureMode\(\\'camera\\'\)/.test(app));
  ok("ผลจากกล้องกลับมาที่หน้าจับเวลาเดิม ผู้วัดกดบันทึกเอง (ผ่านการตรวจค่าผิดปกติ)", /S\.sw = \{ k: k, t: null, t0: 0, val: k === "balance" \? res\.held : res\.sec, cam: res \}/.test(app));
  ok("ทรงตัว: ลูกหลานยืนยันผ่าน/ไม่ผ่านเอง กล้องไม่ตัดสิน", /d\.balFail\[d\.balStages\.length - 1\] = true/.test(app) && /!\(d\.balFail && d\.balFail\[n\]\)/.test(app) && /กล้องสังเกตเห็น<\/b> \(ข้อมูลประกอบ ไม่ใช่คำตัดสิน\)/.test(cam));
  ok("กล้องไม่บันทึกภาพ ไม่มีสั่งงานด้วยเสียง", !/MediaRecorder|SpeechRecognition|webkitSpeechRecognition/.test(cam) && /ไม่อัปโหลดภาพหรือวิดีโอ/.test(cam));
  ok("สัญญาณมือ (ลุกนั่ง/ลุกเดิน): สองมือ=เริ่ม · กางแขน=สิ้นสุด · มือเดียว=บันทึก ผ่าน swSave · ทำไม่ครบไม่บันทึก", /gs\.fire === "both"/.test(cam) && /gs\.fire === "side"/.test(cam) && /gs\.fire === "one" && !result\.incomplete/.test(cam) && /if \(res\.save\) \{[^}]*swSave\(\)/.test(app) && /if \(res\.incomplete\)/.test(app) && !/gestBar\(\[/.test(cam.slice(cam.indexOf("function runBalance"))));
  ok("เริ่มด้วยกล้องหลัง (ลูกหลานถือมือถือ) และสลับกล้องได้", /FACING = "environment"/.test(cam) && /csFlip/.test(cam));
  ok("ระบบกลางรับวิธีวัดต่อท่า และผลทรงตัวที่คนยืนยัน", /methods: \{ ftsst:/.test(cl) && /!\(rec\.balFail && rec\.balFail\[i\]\)/.test(cl));
  ok("เอนจินกล้องรุ่น 3: นาฬิกาเดียวเดินหน้า + ไม่ต้องเห็นเท้า + ไม่มีขั้นสอบเทียบ + แถบนั่ง/ยืนสด + สลับ CPU", K.ENGINE === "cam-3.0" && /worldLandmarks/.test(cam) && /requestVideoFrameCallback/.test(cam) && !/captureTime/.test(cam.replace(/\/\*[\s\S]*?\*\//g, "")) && /detectForVideo\(video, t\)/.test(cam) && /async function tuneModel/.test(cam) && !/function runCalib/.test(cam) && /id="csMeter"/.test(cam) && /async function toCpu/.test(cam) && /numPoses: 1/.test(cam));
  ok("ลุกนั่งจับเวลาถึงนั่งลงครั้งที่ 5 ตรงกับวิธีกดเอง", /if \(this\.reps >= this\.target\) return this\._fin\(td, false\)/.test(cam) && /กดหยุดตอนก้นแตะเก้าอี้ครั้งที่ 5/.test(app));
  const B = new K.BalanceEngine(0);
  ok("BalanceEngine จำแนกท่าจากเท้า: ซ้อน=ชิด · เหลื่อมครึ่ง=กึ่งต่อ · เต็มเท้า=ต่อเท้า · ยก=ขาเดียว", B._stance({ gap: 0.2, lift: 0.1 }) === 0 && B._stance({ gap: 0.6, lift: 0.1 }) === 1 && B._stance({ gap: 1.2, lift: 0.1 }) === 2 && B._stance({ gap: 0.2, lift: 0.9 }) === 3);
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  ok("service worker แคชโมดูลกล้องและโมเดล MediaPipe", /cs-camera\.js/.test(sw) && /storage\\\.googleapis\\\.com/.test(sw));
}

/* บาร์เธลเอดีแอล ฉบับภาษาไทย และสำรวจความปลอดภัยในบ้าน (cs-assess.js) */
{
  const A = require("../cs-assess.js"), C = require("../cs-cloud.js");
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  const full = {}; A.BARTHEL.forEach((it) => { full[it.k] = it.o[it.o.length - 1][0]; });
  const withTotal = (t) => { const a = {}; let left = t; A.BARTHEL.forEach((it) => { const m = it.o[it.o.length - 1][0], v = Math.min(m, left); a[it.k] = v; left -= v; }); return a; };
  ok("บาร์เธล 10 ข้อ คะแนนเต็ม 20 (ตรงฉบับกระทรวงสาธารณสุข: 2+1+3+2+3+2+2+1+2+2)", A.BARTHEL.length === 10 && A.BARTHEL_MAX === 20 && A.barthel(full).total === 20);
  ok("กลุ่ม: 20 ช่วยตัวเองได้เต็มที่ · 12–19 ติดสังคมเริ่มต้องช่วย · 5–11 ติดบ้าน (พึ่งพิง) · 0–4 ติดเตียง",
     A.band(20).k === "independent" && A.band(19).k === "social" && A.band(12).k === "social" && A.band(11).k === "home" && A.band(11).dep && A.band(5).k === "home" && A.band(4).k === "bed" && A.band(0).k === "bed");
  ok("แปลงเป็นค่า adl 0–2 เดิม (คะแนนหกล้มหลักยังตรงกับ V2): 20→2 · 12–19→1 · ≤11→0", A.barthel(withTotal(20)).adl === 2 && A.barthel(withTotal(15)).adl === 1 && A.barthel(withTotal(12)).adl === 1 && A.barthel(withTotal(11)).adl === 0);
  ok("ตอบไม่ครบ → ยังไม่ให้คะแนนรวม · ข้อที่ไม่เต็มแสดงเป็นด้านที่ต้องมีคนช่วย", A.barthel({ feed: 2 }).total === null && A.barthel(Object.assign({}, full, { bath: 0, stairs: 1 })).weak.map((w) => w.k).join() === "stairs,bath");
  ok("เทียบครั้งก่อน: ลดลง ≥2 หรือเปลี่ยนกลุ่มไปทางพึ่งพิง = แย่ลง", A.barthelChange({ total: 18 }, { total: 16 }).worse && !A.barthelChange({ total: 18 }, { total: 17 }).worse && A.barthelChange({ total: 12 }, { total: 11 }).worseBand && A.barthelChange({ total: 14 }, { total: 17 }).better);
  const none = { stairs: false, helper: "full" }; A.HAZ.forEach((h) => { none[h.k] = false; });
  ok("บ้าน: ไม่มีบันได → ไม่ถามข้อบันได · ตอบครบ = complete", A.homeResult(none).complete && A.homeResult(none).total === A.HAZ.filter((h) => h.area !== "stairs").length && A.homeResult({ stairs: true, helper: "full" }).complete === false);
  const some = Object.assign({}, none, { stairs: true, stair_rail: true, stair_light: false, stair_step: false, bath_rail: true, cord: true, helper: "alone" });
  const hr = A.homeResult(some), hd = A.homeDetail(some, "2026-09-19");
  ok("บ้าน: จุดสำคัญ (ห้องน้ำ บันได) ขึ้นก่อน · รหัสหลักตรงกับที่ใบส่งต่อ V2 รู้จัก", hr.open[0].pri === 1 && hr.priority === 2 && hd.hazards.every((k) => ["rug", "wet", "light", "rail", "stair", "shoe", "reach"].indexOf(k) >= 0) && hd.hazards.indexOf("rail") >= 0 && hd.helper === "alone" && hd.count === 3 && !hd.none);
  ok("บ้าน: กด “แก้แล้ว” → ไม่นับเป็นจุดเสี่ยงค้าง", A.homeResult(Object.assign({}, some, { fixed: { bath_rail: "x" } })).open.length === 2 && A.homeResult(Object.assign({}, some, { fixed: { bath_rail: "x" } })).fixedN === 1);
  ok("ครอบคลุมจุดที่ผู้ใช้ขอ: พื้นลื่น แสงน้อย ราวจับ พรม สายไฟ รองเท้า บันได", ["slick", "bath_slip", "night_path", "dim", "bath_rail", "rug_loose", "cord", "shoe_loose", "stair_rail"].every((k) => A.HAZ.some((h) => h.k === k)));
  ok("ทุกคำแนะนำแก้บ้านมีวิธีแก้และแหล่งอ้างอิงที่มีอยู่จริงในรายการ", A.HAZ.every((h) => h.fix && h.src.length && h.src.every((s) => A.SRC[s])) && [20, 15, 8, 2].every((t) => A.band(t).src.every((s) => A.SRC[s])));
  const p = C.payloadOf({ date: "2026-09-19", adl: 1, barthel: { total: 15, band: "ติดสังคม", band_key: "social", weak: ["bath"] }, barthelAns: full, home: hd, skipped: {} }, { age: 70 }, "x");
  ok("ส่งขึ้นระบบกลางในชื่อฟิลด์ที่ใบส่งต่ออ่าน: detail.barthel.total/band · home_detail.hazards/helper", p.detail.barthel.total === 15 && p.detail.barthel.band === "ติดสังคม" && p.homeDetail.hazards.length === 3 && p.homeDetail.helper === "alone" && p.detail.adl === 1);
  ok("แอป: ถามบาร์เธลแยก 10 ข้อ (ตัดคำถามกิจวัตรข้อเดียวเดิม) · มีหน้าบ้านปลอดภัยบนหน้าแรก · ใบส่งต่อมีทั้งสองส่วน",
     !/\{ k: "adl", q:/.test(app) && /function renderAdl/.test(app) && /function renderHomeChk/.test(app) && /go\('homechk'\)/.test(app) && /ดัชนีบาร์เธลเอดีแอล ฉบับภาษาไทย\)<\/b>/.test(app) && /สำรวจความปลอดภัยในบ้าน<\/b>/.test(app) && /cs-assess\.js/.test(readFileSync(new URL("../sw.js", import.meta.url), "utf8")));
}

/* แจ้งเหตุ (cs-incident.js · SQL 28) */
{
  const I = require("../cs-incident.js");
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8"), sql = readFileSync(new URL("../supabase/28_incidents.sql", import.meta.url), "utf8");
  const cl = readFileSync(new URL("../cs-cloud.js", import.meta.url), "utf8"), mf = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  ok("แจ้งได้ 5 ชนิด: ล้ม · เกือบล้ม · อุบัติเหตุอื่น · เข้าโรงพยาบาล · ช่วยเหลือตัวเองแย่ลงทันที", ["fall", "near_fall", "accident", "hospital", "adl_drop"].every((k) => I.KINDS[k] && new RegExp('"' + k + '"').test(app)));
  ok("ความรุนแรง: บาดเจ็บต้องพบแพทย์/ศีรษะกระแทก/ลุกไม่ได้/นอนพื้นนาน/ติดเตียง/เข้าโรงพยาบาล = รุนแรง",
     ["doctor", "admit", "fracture"].every((j) => I.severity({ kind: "fall", injury: j }) === "high") && I.severity({ kind: "fall", injury: "minor", head: true }) === "high" &&
     I.severity({ kind: "fall", injury: "none", getup: "cannot" }) === "high" && I.severity({ kind: "fall", injury: "none", lie: "gt60" }) === "high" &&
     I.severity({ kind: "adl_drop", impact: "bedbound" }) === "high" && I.severity({ kind: "hospital" }) === "high");
  ok("ล้มไม่บาดเจ็บลุกได้ทันที = ปานกลาง (ยังต้องติดต่อ) · เกือบล้มไม่บาดเจ็บ = เล็กน้อย", I.severity({ kind: "fall", injury: "none", getup: "self_now", impact: "same" }) === "medium" && I.severity({ kind: "near_fall" }) === "low");
  ok("ศีรษะกระแทก / หมดสติ / ลุกไม่ได้ / กระดูกหัก → เตือนโทร 1669", I.redFlags({ head: true, loc: true, getup: "cannot", injury: "fracture" }).length === 4 && I.redFlags({ injury: "minor" }).length === 0);
  const det = I.toDetail({ kind: "fall", place: "bathroom", injury: "doctor", getup: "helped", head: true });
  ok("ข้อมูลที่ส่ง: มีทั้งรหัส (ใช้นับ) และข้อความไทยที่ทริกเกอร์เดิมอ่าน (where/injury)", det.place === "bathroom" && det.where === "ห้องน้ำ" && det.injury_code === "doctor" && det.injury === "ต้องพบแพทย์" && det.red_flags.indexOf("ศีรษะกระแทก") >= 0);
  const ev = [{ kind: "fall", severity: "high", detail: { place: "bathroom", injury_code: "fracture", head: true }, created_at: new Date().toISOString(), user_id: "u1" },
    { kind: "fall", severity: "medium", detail: { place: "bathroom" }, created_at: new Date().toISOString(), user_id: "u2" },
    { kind: "accident", severity: "low", detail: {}, created_at: new Date(Date.now() - 400 * 864e5).toISOString(), user_id: "u3" }];
  const sm = I.summarize(ev, 365);
  ok("ภาพรวมบริษัทประกัน: นับตามชนิด/สถานที่/ผลรุนแรง ไม่มี user_id · กลุ่ม 1–2 ครั้งแสดง <3 · ตัดข้อมูลเกิน 12 เดือน",
     sm.total === 2 && sm.by_place.bathroom === 2 && sm.serious.admit_or_fracture === 1 && !/u1|u2|user_id/.test(JSON.stringify(sm)) && I.small(2) === "<3" && I.small(5) === "5");
  ok("migration 28: เปิดเคสทุกชนิดเหตุ · เข้าโรงพยาบาล/รุนแรง = 24 ชม. · ภาพรวมเฉพาะผู้ยินยอม ตรวจบทบาท",
     /'fall','near_fall','accident','hospital','adl_drop'/.test(sql) && /new\.kind = 'hospital' or sev = 'high' then 'urgent'/.test(sql) && /share_pool = true/.test(sql) && /cs_role\(\) in \('insurer','care_manager','admin'\)/.test(sql) && /revoke all on function public\.insurer_incident_summary/.test(sql));
  ok("แอป: ส่งถึงทีมดูแล (reportIncident) · ไม่ส่งข้อมูลรายคนให้บริษัทประกัน · มีใบสรุปให้ครอบครัวส่งเอง · ทางลัดแจ้งเหตุ",
     /async function reportIncident/.test(cl) && /CSCloud\.reportIncident\(rec\)/.test(app) && /ไม่ส่งข้อมูลระบุตัวตนให้บริษัทประกัน/.test(app) && /function incHTML/.test(app) && /when_date: localDay\(\)/.test(app) && !/toISOString\(\)\.slice\(0, 10\)/.test(app) && mf.shortcuts.some((x) => /go=fall/.test(x.url) && /แจ้งเหตุ/.test(x.name)));
}

/* อ่านชื่อยาจากรูปแผงยา — ตัวอย่างจากรูปจริงของผู้ใช้ (แผง BESIX) */
{
  const M = require("../cs-meds.js"), top = (t) => (M.extract(t).candidates[0] || {}).inn || null;
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  ok("แผงยาพิมพ์ชื่อการค้าซ้ำ: BESIX → วิตามินบีรวม (รวมคำที่ OCR อ่านเพี้ยน BES1X / 8ESIX)", top("BESIX BESIX") === "vitamin b complex" && top("BES1X 8ESIX") === "vitamin b complex" && M.rankTokens("BESIX BES1X BESIY vitamin")[0].count === 3);
  ok("ฉลากเขียน Vitamin B1 B6 B12 แยกกัน → วิตามินบีรวม · คำว่า vitamin เดี่ยว ๆ ไม่กลายเป็นวิตามินดี", top("Vitamin B1, B6 & B12") === "vitamin b complex" && top("VITAMIN") === null && top("Amlod1pine 5 mg") === "amlodipine");
  ok("ชื่อถูกตัดท้าย: BESI (ซ้ำ 2 จุด) → BESIX · PARA ไม่เดา (ตรงทั้ง paracetamol และ parafon) · คำเดียวไม่เดา", top("BESI BESI") === "vitamin b complex" && top("PARA PARA") === null && top("BESI") === null);
  ok("อ่านรูป: PaddleOCR ก่อน แล้ว Tesseract ภาษาไทย · ฐานในเครื่องไม่รู้จัก → ทะเบียน อย. → คิวเภสัชกร", /<script src="\.\/cs-ocr\.js"><\/script>/.test(app) && /CSOcr\.read\(img, say\)/.test(app) && /CSBackend\.lookupDrug\(toks\[i\]\.token\)/.test(app) && /CSBackend\.queueUnknownDrug\(/.test(app) && /cs-ocr\.js/.test(readFileSync(new URL("../sw.js", import.meta.url), "utf8")));
  /* สคริปต์ในหน้าต้องคอมไพล์ผ่าน — กันตัวอักษรขึ้นบรรทัดหลุดเข้าไปในสตริงแล้วทั้งแอปใช้ไม่ได้ */
  const vm = await import("node:vm"), bad = [];
  for (const f of ["CareSignal-App.html", "index.html"]) {
    const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => { try { new vm.Script(m[1]); } catch (e) { bad.push(f + "#" + i + " " + e.message); } });
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(src)) bad.push(f + " มีอักขระควบคุมแฝง");
  }
  ["cs-meds.js", "cs-ocr.js", "cs-camera.js", "cs-install.js", "cs-imu.js", "cs-referral-forms.js", "cs-cloud.js", "cs-body.js"].forEach((f) => { const src = readFileSync(new URL("../" + f, import.meta.url), "utf8"); try { new vm.Script(src); } catch (e) { bad.push(f + " " + e.message); } if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(src)) bad.push(f + " มีอักขระควบคุมแฝง"); });
  ok("สคริปต์ทุกหน้าคอมไพล์ผ่าน และไม่มีอักขระควบคุมแฝง", !bad.length, bad);
}

/* บทบาท: คัดกรอง · เฝ้าระวัง · ส่งต่อ — ไม่อ้างว่าระบบป้องกันการล้มเอง (กฎเดียวกับ audit X-141) */
{
  const BANNED = /บริการป้องกัน|แผนป้องกัน|โปรแกรมป้องกัน|ป้องกันก่อน(เกิด)?เคลม|คำขอป้องกัน|ป้องกันการหกล้ม|ป้องกันการล้ม|ป้องกันหกล้ม|ป้องกันล้ม/;
  const hitsP = ["index.html", "CareSignal-App.html", "testkit.html", "cs-cloud.js", "CareSignal-Staff.html", "CareSignal-Portfolio-Dashboard.html", "cs-teleconsult.js", "cs-demo.js", "cs-roi.js", "cs-referral-forms.js"]
    .map((f) => [f, readFileSync(new URL("../" + f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").match(BANNED)]).filter((x) => x[1]).map((x) => x[0] + ":" + x[1][0]);
  ok("ข้อความบอกบทบาทเป็นการคัดกรองและส่งต่อ ไม่อ้างว่าระบบป้องกันการล้มเอง", !hitsP.length, hitsP);
}
/* หุ่นร่างกาย 7 ด้าน (cs-body.js) — ใช้ร่วมคอนโซลกับแอปครอบครัว */
{
  const require2 = (await import("node:module")).createRequire(import.meta.url);
  const B = require2("../cs-body.js");
  const svg = B.figure({ ftsst: "warn", tug: "ok", bal: "none", meds: "bad", falls: "ok", adl: "warn", home: "warn" });
  ok("หุ่นร่างกาย: มีหมุดครบ 7 ด้าน เรียงเลข 1–7", B.KEYS.length === 7 && (svg.match(/class="pin /g) || []).length === 7 && [1,2,3,4,5,6,7].every((n) => svg.includes(">" + n + "</text>")));
  ok("หุ่นร่างกาย: ด้านที่ไม่ส่งสถานะเป็นสีเทา (ยังไม่ได้ทดสอบ)", B.figure({}).includes('fill="' + B.FILL.none + '"') && !B.figure({}).includes(B.FILL.bad));
  ok("หุ่นร่างกาย: สะท้อนซ้าย-ขวาถูกต้อง", B.mirror("M80 88 L52 168") === "M160 88 L188 168");
  const app = readFileSync(new URL("../CareSignal-App.html", import.meta.url), "utf8");
  const fam = (app.match(/function bodyStates\(r\)[\s\S]*?\n\}/) || [""])[0] + (app.match(/function bodyCard\(r\)[\s\S]*?\n\}/) || [""])[0];
  ok("แอปครอบครัว: โหลด cs-body.js และวางหุ่นในหน้าผลทั้งแบบรอผู้เชี่ยวชาญและแบบปกติ",
     /<script src="\.\/cs-body\.js"><\/script>/.test(app) && (app.match(/bodyCard\(r\)/g) || []).length >= 3);
  ok("แอปครอบครัว: ไม่ใช้สีแดง (bad) ไม่แสดงเกณฑ์ตัวเลขทางคลินิก และไม่บอกให้หยุดยา",
     fam.length > 500 && !/"bad"/.test(fam) && !/STEADI|Poncumhak|Barthel|≥|วินาที \(เกณฑ์/.test(fam) && /ห้ามหยุดยาเอง/.test(fam) && !/ให้หยุดยา/.test(fam));
  ok("แอปครอบครัว: ผลที่รอผู้เชี่ยวชาญไม่บอกระดับหรือคำแนะนำในหุ่น", /pending\(r\) \? '<p class="sub"[^>]*>ผู้เชี่ยวชาญจะดูผลอีกครั้ง/.test(fam) && !/TIER|T\.nm|advice/.test(fam));
}

console.log("  " + pass + " ผ่าน / " + fail + " ตก");
process.exit(fail ? 1 : 0);
