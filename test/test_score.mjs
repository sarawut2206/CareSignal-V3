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

/* เอกสารต้องไม่อ้างเกินจริง และต้องไม่มีความลับ */
const html = ["index.html", "app.html", "testkit.html"].map((f) => readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
ok("ไม่มีรหัสตั้งต้นผู้ดูแลระบบหรือรหัสผ่านในหน้าเว็บ", !/ZHJE|password|รหัสผ่านคือ/i.test(html));
ok("ไม่อ้างว่าป้องกันการล้มได้ หรือแทนการตรวจโรงพยาบาล", !/ป้องกันการล้มได้แน่|แทนการตรวจที่โรงพยาบาลได้|วินิจฉัยได้/.test(html));
ok("ทุกหน้าบอกว่าไม่ใช่การวินิจฉัย", ["index.html", "app.html", "testkit.html"].every((f) => /ไม่ใช่การวินิจฉัย|ไม่วินิจฉัยโรค/.test(readFileSync(new URL("../" + f, import.meta.url), "utf8"))));
ok("แอปมีทาง 1669 และไม่มีปุ่มฉุกเฉินที่อ้างว่าเรามีทีมช่วย", /tel:1669/.test(html) && !/ทีมฉุกเฉินของเรา/.test(html));
ok("index อ้างตัวเลขจากการสัมภาษณ์จริง 5/5 และ 3/3", /5\/5/.test(html) && /3\/3/.test(html));
ok("index ลิงก์กลับไป V2", /CareSignal-V2\//.test(html));

console.log("  " + pass + " ผ่าน / " + fail + " ตก");
process.exit(fail ? 1 : 0);
