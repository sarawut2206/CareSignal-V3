/* ============================================================
   cs-referral-forms.js — แบบฟอร์มส่งต่อสหวิชาชีพ (โมดูลร่วม)
   ------------------------------------------------------------
   ใช้ร่วมกันสามที่ ให้ทุกฝ่ายเห็นเอกสารฉบับเดียวกัน
     · คอนโซลเจ้าหน้าที่  — ผู้ประสานงานสร้างใบส่งต่อ · ผู้เชี่ยวชาญอ่านแล้วตอบกลับ
     · แอปครอบครัว         — อ่านผลที่ผู้เชี่ยวชาญยืนยันแล้วเป็นภาษาคนทั่วไป
     · โหมดสาธิต           — สร้างชุดข้อมูลรูปแบบเดียวกับฐานข้อมูลจริง

   ต้นแบบ: CDC STEADI (2017/2019)
     A · แบบฟอร์มแกนกลาง       ← Fall Prevention Patient Referral + Fall Risk Factors Checklist
     B · แพทย์                  ← Patient Referral (reason for referral) + Risk Factors Checklist
     C · เภสัชกร                ← STEADI-Rx Provider Consult – Medication (+ SAFE framework)
     D · พยาบาล                 ← Measuring Orthostatic Blood Pressure + Risk Factors Checklist
     E · นักกายภาพบำบัด          ← TUG (observations) · 4-Stage Balance · 30-Second Chair Stand
                                   + Recommended Fall Prevention Program

   หลักที่ยึด (ตามเอกสารต้นแบบและ NICE NG249)
     1. แยก "สิ่งที่ระบบหรือผู้เอาประกันบันทึก" ออกจาก "ข้อสรุปของผู้เชี่ยวชาญ" —
        ทุกแถวบอกที่มา: จากระบบ · ผู้เอาประกันตอบ · ผู้เชี่ยวชาญกรอก
     2. ส่งเฉพาะข้อมูลที่วิชาชีพนั้นต้องใช้ตัดสินใจ (แกนกลาง + โมดูลของวิชาชีพ)
     3. ระบบไม่วินิจฉัย ไม่สั่งหยุด/ปรับยา — ใช้คำว่า "ควรทบทวน" เสมอ
     4. ทุกใบตอบ 5 คำถาม: ส่งต่อใคร · พบอะไร · หลักฐานอยู่ไหนและเชื่อได้แค่ไหน ·
        ต้องการให้ตอบอะไร · ต้องตอบเมื่อใดด้วยสถานะอะไร
     5. คำตอบของผู้เชี่ยวชาญเป็นโครงสร้าง มีปุ่มมาตรฐาน 6 แบบเหมือนกันทุกวิชาชีพ
   ============================================================ */
(function (root) {
  "use strict";

  /* ---------- ตัวช่วยพื้นฐาน ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function n1(v) { return v == null || isNaN(+v) ? "—" : (+v).toFixed(1); }
  function has(v) { return v !== null && v !== undefined && v !== ""; }
  function dt(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return String(iso); }
  }
  function d0(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return String(iso); }
  }

  /* ============================================================
     พจนานุกรมรหัส → ข้อความ (ตรงกับที่แอปสมาชิกบันทึก)
     ============================================================ */
  var L = {
    dest: { doctor: "แพทย์", pharmacist: "เภสัชกร", physio: "นักกายภาพบำบัด", nurse: "พยาบาล", family: "ครอบครัว", community: "ชุมชน" },
    level: { stable: "เขียว · คงที่", watch: "เหลือง · เฝ้าสังเกต", decline: "ส้ม · ถดถอย", urgent: "แดง · เร่งด่วน" },
    fallCount: { 0: "ไม่เคย", 1: "1 ครั้ง", 2: "2 ครั้ง", 3: "3 ครั้ง", 4: "4 ครั้งขึ้นไป", 9: "จำไม่ได้" },
    fallWhen: { 0: "ภายใน 30 วัน", 1: "1–3 เดือนก่อน", 2: "4–6 เดือนก่อน", 3: "7–12 เดือนก่อน" },
    fallInjury: { 0: "ไม่มี", 1: "ฟกช้ำ/แผลเล็กน้อย", 2: "ต้องพบแพทย์", 3: "เข้าโรงพยาบาล", 4: "กระดูกหัก", 5: "ศีรษะกระแทก" },
    fallLoc: { 0: "ไม่มี", 1: "ไม่แน่ใจ", 2: "มี" },
    fallGetup: { 0: "ลุกได้ทันที", 1: "ลุกได้แต่ใช้เวลานาน", 2: "ต้องมีคนช่วย", 3: "ลุกเองไม่ได้" },
    yn3: { 0: "ไม่มี", 1: "ไม่แน่ใจ", 2: "มี" },
    helper: { 0: "มีผู้ดูแลอยู่ข้าง ๆ", 1: "ทำคนเดียว" },
    homeHelper: { alone: "อยู่คนเดียว", day: "มีคนอยู่บางเวลา", full: "มีคนอยู่ด้วยตลอด" },
    hazard: { rug: "พรมหรือสายไฟบนทางเดิน", wet: "พื้นห้องน้ำ/ครัวลื่น ไม่มีแผ่นกันลื่น", light: "ทางเดินกลางคืนหรือบันไดมืด",
      rail: "ห้องน้ำไม่มีราวจับ / ลุกจากโถลำบาก", stair: "บันไดไม่มีราวทั้งสองข้าง", shoe: "รองเท้าแตะหลวมหรือเท้าเปล่าบนพื้นลื่น", reach: "ของใช้อยู่สูงต้องปีนหยิบ" },
    medSym: { drowsy: "ง่วงมากผิดปกติ", dizzy: "เวียนศีรษะ", ortho: "หน้ามืดเมื่อลุกยืน", gait: "เดินเซ", blur: "ตามัว", confuse: "สับสน", none: "ไม่มี" },
    medChange: { start: "เริ่มยาใหม่", up: "เพิ่มขนาดยา", down: "ลดขนาดยา", stop: "หยุดยา", time: "เปลี่ยนเวลาใช้ยา", none: "ไม่มี/ไม่แน่ใจ" },
    /* รหัสกลุ่มตรงกับตาราง FRID ใน cs-meds.js — เพิ่มที่นั่นต้องเพิ่มที่นี่ด้วย */
    frid: { bzd: "ยานอนหลับ / ยาคลายกังวล (Benzodiazepine, Z-drug)", antidep: "ยาต้านซึมเศร้า", antipsy: "ยาต้านโรคจิต",
      anticonv: "ยากันชัก / ยาปวดเส้นประสาท", opioid: "ยาแก้ปวดกลุ่ม opioid", anticho: "ยาต้านโคลิเนอร์จิก", relax: "ยาคลายกล้ามเนื้อ",
      antihist: "ยาแก้แพ้ที่ทำให้ง่วง", antihtn: "ยาลดความดันบางกลุ่ม", diuretic: "ยาขับปัสสาวะ", alpha: "ยาต่อมลูกหมาก / ยาที่ทำให้ความดันตก",
      bladder: "ยารักษากระเพาะปัสสาวะไว", hypnotic: "ยานอนหลับ", none: "ไม่อยู่ในกลุ่มเสี่ยงหกล้ม", unknown: "ยังจัดกลุ่มไม่ได้" },
    fridLevel: { 2: "หลักฐานเข้ม", 1: "ปานกลาง", 0: "ไม่เสี่ยง" },
    balStage: ["เท้าชิดกัน", "กึ่งต่อเท้า", "ต่อเท้าเป็นเส้นตรง", "ยืนขาเดียว"],
    endedBy: { human: "ผู้ใช้/ผู้ดูแลกดจบ", gesture: "ผู้ใช้สั่งจบด้วยการยกมือหรือรีโมต", camera: "กล้องเห็นนั่งลง (ต้องยืนยัน)", imu: "เซ็นเซอร์คาดเอวเห็นนั่งลง (ผู้ดูแลตรวจแล้วบันทึก)", timeout: "หมดเวลา", carer: "ผู้ดูแลกดจบ" },
    src: { sys: "จากระบบ", self: "ผู้เอาประกันตอบ", fam: "ครอบครัวรายงาน", pro: "ผู้เชี่ยวชาญกรอก", imu: "เซ็นเซอร์คาดเอว", prog: "เกณฑ์ภายในโปรแกรม" },
    verdict: { confirm: "ยืนยัน", not_confirm: "ไม่ยืนยัน", need_more_info: "ขอข้อมูลเพิ่ม", advised: "ให้คำแนะนำ", refer_other: "ส่งต่อวิชาชีพอื่น", follow_up: "นัดติดตาม" },
    nextStep: { sufficient: "ข้อมูลเพียงพอ ไม่ต้องทำเพิ่ม", need_more_info: "ขอข้อมูลเพิ่มเติม", book_assessment: "นัดประเมินต่อ", refer_doctor: "ส่งต่อแพทย์", refer_other: "ส่งต่อวิชาชีพอื่น", follow_plan: "ติดตามตามแผน" },
    urgency: { today: "ด่วนวันนี้", h24: "ภายใน 24 ชั่วโมง", h72: "ภายใน 72 ชั่วโมง", routine: "นัดตามปกติ" }
  };

  /* คำตอบมาตรฐานของผู้เชี่ยวชาญ → ขั้นตอนถัดไปของผู้ประสานงาน (เข้ากับของเดิม) */
  var VERDICT_NEXT = { confirm: "follow_plan", not_confirm: "sufficient", need_more_info: "need_more_info", advised: "follow_plan", refer_other: "refer_other", follow_up: "book_assessment" };

  /* เหตุผลการส่งต่อ — จาก Fall Prevention Patient Referral (CDC) แปลไทย + ที่เพิ่มตามบริบท */
  var REASONS = [
    { k: "gait", nm: "ปัญหาการเดินหรือการเคลื่อนไหว", to: ["physio", "doctor"] },
    { k: "balance", nm: "การทรงตัวบกพร่อง", to: ["physio", "doctor"] },
    { k: "weak", nm: "กำลังขาลดลง", to: ["physio"] },
    { k: "ortho", nm: "หน้ามืดเมื่อเปลี่ยนท่า (สงสัยความดันตกเมื่อลุกยืน)", to: ["doctor", "nurse", "pharmacist"] },
    { k: "neuro", nm: "สงสัยภาวะทางระบบประสาท (เช่น พาร์กินสัน สมองเสื่อม)", to: ["doctor"] },
    { k: "meds", nm: "ทบทวนยาและให้คำปรึกษาเรื่องยา", to: ["pharmacist", "doctor"] },
    { k: "footwear", nm: "รองเท้าไม่เหมาะสม", to: ["nurse", "physio"] },
    { k: "foot", nm: "ความผิดปกติของเท้า", to: ["doctor", "physio"] },
    { k: "vision", nm: "การมองเห็นลดลง / ไม่ได้ตรวจตาเกิน 1 ปี", to: ["doctor", "nurse"] },
    { k: "home", nm: "ประเมินความปลอดภัยในบ้าน", to: ["nurse"] },
    { k: "recurrent", nm: "หกล้มซ้ำ หรือล้มแล้วบาดเจ็บ/หมดสติ/ลุกเองไม่ได้", to: ["doctor", "nurse"] },
    { k: "adl", nm: "กิจวัตรประจำวันลดลง ต้องการผู้ช่วย", to: ["nurse", "physio"] },
    { k: "fear", nm: "กลัวล้มจนจำกัดกิจกรรม", to: ["physio", "nurse"] }
  ];

  /* ข้อสังเกตขณะทำ TUG — จาก STEADI TUG Assessment (observations) */
  var TUG_OBS = [
    { k: "slow", nm: "ก้าวช้า ลังเล" }, { k: "lob", nm: "เสียสมดุล" }, { k: "short", nm: "ก้าวสั้น" }, { k: "arm", nm: "แขนแกว่งน้อยหรือไม่แกว่ง" },
    { k: "wall", nm: "ต้องเกาะผนังหรือเฟอร์นิเจอร์" }, { k: "shuffle", nm: "ลากเท้า" }, { k: "enbloc", nm: "หมุนตัวทั้งตัว (en bloc)" }, { k: "device", nm: "ใช้อุปกรณ์ช่วยเดินไม่ถูกวิธี" }
  ];

  /* รายการปัจจัยเสี่ยงตาม STEADI Fall Risk Factors Checklist — ใช้ในแบบแพทย์และพยาบาล */
  var RISK_ROWS = [
    { g: "ประวัติหกล้ม", k: "fell", nm: "หกล้มในปีที่ผ่านมา" },
    { g: "ประวัติหกล้ม", k: "worried", nm: "กังวลว่าจะล้ม หรือรู้สึกไม่มั่นคงขณะยืน/เดิน" },
    { g: "โรคประจำตัว", k: "heart", nm: "ปัญหาอัตราการเต้นของหัวใจ / หัวใจเต้นผิดจังหวะ" },
    { g: "โรคประจำตัว", k: "cognitive", nm: "การรู้คิดบกพร่อง" },
    { g: "โรคประจำตัว", k: "incont", nm: "กลั้นปัสสาวะไม่อยู่" },
    { g: "โรคประจำตัว", k: "depress", nm: "ภาวะซึมเศร้า" },
    { g: "โรคประจำตัว", k: "foot", nm: "ปัญหาที่เท้า" },
    { g: "โรคประจำตัว", k: "other", nm: "โรคอื่นที่กระทบการเคลื่อนไหว" },
    { g: "ยา", k: "psycho", nm: "ยาออกฤทธิ์ต่อจิตประสาท" },
    { g: "ยา", k: "opioid", nm: "โอปิออยด์" },
    { g: "ยา", k: "sedate", nm: "ยาที่ทำให้ง่วงหรือสับสน" },
    { g: "ยา", k: "hypot", nm: "ยาที่ทำให้ความดันต่ำ" },
    { g: "การเดิน กำลัง และการทรงตัว", k: "tug12", nm: "TUG ตั้งแต่ 12 วินาทีขึ้นไป" },
    { g: "การเดิน กำลัง และการทรงตัว", k: "chair", nm: "ลุกนั่งช้ากว่าเกณฑ์อายุ (FTSST) / Chair Stand ต่ำกว่าเกณฑ์" },
    { g: "การเดิน กำลัง และการทรงตัว", k: "tandem", nm: "ยืนต่อเท้าเป็นเส้นตรงได้ไม่ถึง 10 วินาที" },
    { g: "การมองเห็น", k: "vision", nm: "สายตาแย่กว่า 20/40 หรือไม่ได้ตรวจตาเกิน 1 ปี" },
    { g: "ความดันตกเมื่อลุกยืน", k: "ortho", nm: "ความดันตัวบน ≥20 หรือตัวล่าง ≥10 mmHg เมื่อลุกยืน หรือมีอาการหน้ามืด" }
  ];

  /* ============================================================
     สกัดข้อเท็จจริงจากชุดข้อมูล — คืนค่าพร้อม "ที่มา" ทุกแถว
     รองรับชุดข้อมูลรุ่น 2 (v:2) และรุ่นเก่า (ไม่มี v) ที่ยังค้างในฐานข้อมูล
     ============================================================ */
  function derive(pkg) {
    pkg = pkg || {};
    var m = pkg.mobility || {}, meds = pkg.meds || {}, medItems = meds.items || pkg.medications || [];
    var falls = pkg.falls || {}, sym = pkg.symptoms || {}, sc = pkg.screen || {}, bal = pkg.balance || {}, home = pkg.home || {}, q = pkg.quality || {};
    var adl = pkg.adl || {}, risk = pkg.risk || {};
    /* ชุดเก่า: falls12m/injured/unconscious/cannot_rise */
    var fallCount = has(falls.count) ? +falls.count : (has(falls.falls12m) ? +falls.falls12m : null);
    var fallInjury = has(falls.injury) ? +falls.injury : (falls.injured === true ? 2 : (falls.injured === false ? 0 : null));
    var fallLoc = has(falls.loc) ? +falls.loc : (falls.unconscious === true ? 2 : (falls.unconscious === false ? 0 : null));
    var fallGetup = has(falls.getup) ? +falls.getup : (falls.cannot_rise === true ? 3 : (falls.cannot_rise === false ? 0 : null));
    var high = has(meds.high) ? +meds.high : medItems.filter(function (x) { return x.frid_level === 2; }).length;
    var mod = has(meds.mod) ? +meds.mod : medItems.filter(function (x) { return x.frid_level === 1; }).length;
    var nMeds = has(meds.n) ? +meds.n : medItems.length;
    var tandem = null;
    if (bal.stages && bal.stages.length) { var s3 = bal.stages[2]; if (s3 && !s3.skipped) tandem = has(s3.held) ? +s3.held : null; }
    var alone = home.helper === "alone" || home.alone === true || (sym.helper === 1) || (q.safety_verdict && q.safety_verdict.alone === true);
    return {
      tugLast: has(m.tug_last) ? +m.tug_last : null, tugFirst: has(m.tug_first) ? +m.tug_first : null,
      ftsstLast: has(m.ftsst_last) ? +m.ftsst_last : null, ftsstFirst: has(m.ftsst_first) ? +m.ftsst_first : null,
      tug12: has(m.tug_last) ? +m.tug_last >= 12 : null,
      ftsstSlow: has(m.ftsst_last) ? +m.ftsst_last >= 12 : null,   /* เกณฑ์ไทย 65–74 ปี 11.5 · 75+ 12.1 — ใช้ 12 เป็นค่ากลางเมื่อไม่รู้อายุ */
      tandem: tandem, tandemFail: tandem === null ? null : tandem < 10,
      balPassed: has(bal.passed) ? +bal.passed : null, balStages: bal.stages || null, balAloneSkip: !!bal.alone_skip,
      fallCount: fallCount, fallWhen: has(falls.when) ? +falls.when : null, fallInjury: fallInjury, fallLoc: fallLoc, fallGetup: fallGetup,
      fell: has(sc.fell) ? !!sc.fell : (fallCount === null ? null : fallCount > 0),
      unsteady: has(sc.unsteady) ? !!sc.unsteady : null, worried: has(sc.worried) ? !!sc.worried : null,
      faint: has(sym.faint) ? +sym.faint : null, chest: has(sym.chest) ? +sym.chest : null, stroke: has(sym.stroke) ? +sym.stroke : null, injuryRecent: has(sym.injury) ? +sym.injury : null,
      medSym: meds.symptoms || [], medChanged: meds.changed || [],
      orthoSym: (meds.symptoms || []).indexOf("ortho") >= 0 || (has(sym.faint) && +sym.faint === 2),
      nMeds: nMeds, high: high, mod: mod, poly: nMeds >= 4, medItems: medItems,
      flagged: medItems.filter(function (x) { return x.frid_level === 2 || x.frid_level === 1; }),
      hazards: home.hazards || [], homeHelper: home.helper || (home.alone === true ? "alone" : (home.alone === false ? "full" : null)), homeCount: has(home.count) ? +home.count : (home.hazards ? home.hazards.length : null),
      alone: alone,
      adlFirst: has(adl.first) ? +adl.first : null, adlLast: has(adl.last) ? +adl.last : null,
      barthel: has(adl.barthel_total) ? +adl.barthel_total : null, barthelBand: adl.barthel_band || null,
      method: q.method || m.method || null, verified: q.identity_verified, notTested: !!q.not_tested,
      distanceOk: m.tug && has(m.tug.distance_ok) ? !!m.tug.distance_ok : null, endedBy: m.tug ? m.tug.ended_by : null,
      tugOut: m.tug ? m.tug.out : null, tugBack: m.tug ? m.tug.back : null, tugReaction: m.tug ? m.tug.reaction : null,
      imu: pkg.imu || m.imu || null,   /* เซ็นเซอร์คาดเอว (SQL 29) */
      safetyVerdict: q.safety_verdict || null,
      level: risk.level || null, tier: risk.tier, score: risk.score, max: risk.max, flags: risk.flags || [],
      nAssess: m.n_assessments || 0, firstAt: m.first_at, lastAt: m.last_at,
      pharmRecs: pkg.pharm_recs || []
    };
  }

  /* ค่าที่ระบบเติมให้ในตาราง "ปัจจัยเสี่ยง" ของ STEADI — true/false/null(ไม่ทราบ) + ที่มา */
  function riskPrefill(d) {
    var f = {};
    f.fell = { v: d.fell, s: "self" }; f.worried = { v: (d.worried === null && d.unsteady === null) ? null : !!(d.worried || d.unsteady), s: "self" };
    f.heart = { v: null }; f.cognitive = { v: null }; f.incont = { v: null }; f.depress = { v: null }; f.foot = { v: null }; f.other = { v: null };
    var grp = {}; d.medItems.forEach(function (x) { grp[x.frid_group] = 1; });
    /* จัดกลุ่มตามแถวของ STEADI Checklist จากรหัส FRID ของ cs-meds.js */
    f.psycho = { v: d.medItems.length ? !!(grp.bzd || grp.antidep || grp.antipsy || grp.anticonv || grp.hypnotic) : null, s: "sys" };
    f.opioid = { v: d.medItems.length ? !!grp.opioid : null, s: "sys" };
    f.sedate = { v: d.medItems.length ? !!(grp.bzd || grp.hypnotic || grp.antihist || grp.anticho || grp.relax || grp.bladder) : (d.medSym.indexOf("drowsy") >= 0 || d.medSym.indexOf("confuse") >= 0 ? true : null), s: "sys" };
    f.hypot = { v: d.medItems.length ? !!(grp.antihtn || grp.diuretic || grp.alpha) : null, s: "sys" };
    f.tug12 = { v: d.tug12, s: "sys" }; f.chair = { v: d.ftsstSlow, s: "sys" }; f.tandem = { v: d.tandemFail, s: "sys" };
    f.vision = { v: null }; f.ortho = { v: d.orthoSym ? true : null, s: "self" };
    return f;
  }

  /* ============================================================
     ส่วนแสดงผล — เอกสารสไตล์ CDC: หัวเรื่อง · แถบหัวข้อฟ้า · ตารางสองคอลัมน์ · ช่อง ใช่/ไม่ใช่
     ============================================================ */
  var CSS = [
    ".rfdoc{background:#fff;color:#111827;border:1px solid #D1D5DB;border-radius:6px;padding:0;font-size:13.5px;line-height:1.6;overflow:hidden}",
    ".rfdoc .rfhead{padding:18px 22px 12px;border-bottom:2px solid #111827;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}",
    ".rfdoc .rfhead .kk{font-size:12px;color:#374151;font-weight:700;letter-spacing:.02em}",
    ".rfdoc .rfhead h2{margin:2px 0 2px;font-size:21px;color:#111827;line-height:1.25}",
    ".rfdoc .rfhead .sub{margin:0;color:#4B5563;font-size:13px}",
    ".rfdoc .rfhead .meta{margin-left:auto;display:grid;grid-template-columns:auto auto;gap:1px 10px;font-size:12px;color:#4B5563;text-align:right}",
    ".rfdoc .rfhead .meta b{color:#111827;font-size:12.5px}",
    ".rfdoc table.rfid{width:100%;border-collapse:collapse;margin:0}",
    ".rfdoc table.rfid td{border-bottom:1px solid #D1D5DB;border-right:1px solid #E5E7EB;padding:8px 12px;vertical-align:top;font-size:13px}",
    ".rfdoc table.rfid td:last-child{border-right:0}.rfdoc table.rfid span{display:block;font-size:11px;color:#6B7280}",
    ".rfdoc b.mono{font-family:ui-monospace,Menlo,monospace}.rfdoc b.bad{color:#B91C1C}.rfdoc b.warn{color:#B45309}",
    ".rfdoc .rfbar{background:none;color:#111827;font-weight:700;font-size:14px;padding:12px 22px 4px;border-top:1px solid #D1D5DB;margin-top:6px}",
    ".rfdoc .rfbar small{font-weight:400;color:#6B7280;margin-left:8px;font-size:12px}",
    ".rfdoc .rfbody{padding:2px 22px 8px}.rfdoc .rfbody p{margin:4px 0}.rfdoc .dim{color:#6B7280}",
    ".rfdoc ul.rfl{display:block;margin:4px 0 6px 20px;padding:0;list-style:disc}.rfdoc ul.rfl li{margin:1px 0;break-inside:avoid}.rfdoc ul.rfl.two{columns:2;column-gap:28px}",
    ".rfdoc table.rfct{width:calc(100% - 44px);margin:4px 22px 8px;border-collapse:collapse;font-size:13px}",
    ".rfdoc table.rfct th{background:#F3F4F6;color:#374151;font-weight:700;font-size:12px;text-align:left;padding:6px 8px;border:1px solid #D1D5DB}",
    ".rfdoc table.rfct td{padding:6px 8px;border:1px solid #D1D5DB;vertical-align:top}",
    ".rfdoc table.rfct td.v{font-weight:600}.rfdoc table.rfct td.v small{display:block;font-weight:400;color:#4B5563;font-size:12px}",
    ".rfdoc table.rfct td.ref{color:#4B5563;font-size:12px}",
    ".rfdoc table.rfct td.st{font-weight:700;white-space:nowrap;background:none}.rfdoc table.rfct td.st-bad{color:#B91C1C}.rfdoc table.rfct td.st-warn{color:#B45309}.rfdoc table.rfct td.st-ok{color:#15803D}",
    ".rfdoc .rfnote{margin:6px 22px 8px;font-size:11.5px;color:#4B5563;line-height:1.55}.rfdoc .foot{padding:4px 22px 10px}",
    ".rfdoc .rfgrid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;padding:6px 22px}",
    ".rfdoc .rfgrid.one{grid-template-columns:1fr}",
    ".rfdoc .rfrow{display:grid;grid-template-columns:150px 1fr auto;gap:8px;padding:6px 0;border-bottom:1px solid #EAEFF5;align-items:baseline}",
    ".rfdoc .rfrow .k{color:#4F5F78;font-size:12.5px}.rfdoc .rfrow .v{font-weight:600}.rfdoc .rfrow .v.mono{font-family:ui-monospace,Menlo,monospace}",
    ".rfdoc .rfrow .v.warn{color:#B45309}.rfdoc .rfrow .v.bad{color:#B91C1C}.rfdoc .rfrow .v.dim{color:#7B8AA1;font-weight:500}",
    ".rfdoc .src{font-size:10.5px;color:#6B7280;border:1px solid #E5E7EB;border-radius:4px;padding:0 5px;white-space:nowrap}",
    ".rfdoc .src.sys{color:#1E3A8A;border-color:#C7D2FE}.rfdoc .src.self{color:#6B21A8;border-color:#E9D5FF}.rfdoc .src.pro{color:#166534;border-color:#BBF7D0}",
    ".rfdoc table.rft{width:100%;border-collapse:collapse;font-size:13px;margin:0}",
    ".rfdoc table.rft th{background:#F1F5F9;color:#4F5F78;font-size:11px;letter-spacing:.05em;text-transform:uppercase;text-align:left;padding:7px 10px;border-bottom:1px solid #D9E1EC}",
    ".rfdoc table.rft td{padding:7px 10px;border-bottom:1px solid #EAEFF5;vertical-align:top}",
    ".rfdoc table.rft td.c{text-align:center;white-space:nowrap}.rfdoc table.rft td.num{font-family:ui-monospace,Menlo,monospace;text-align:right;white-space:nowrap}",
    ".rfdoc .grp td{background:#F7F9FC;font-weight:700;color:#143A74;font-size:12px}",
    ".rfdoc .yn{display:inline-flex;gap:10px;font-size:12.5px}.rfdoc .yn label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}",
    ".rfdoc .yn input{margin:0}.rfdoc .yn .auto{font-size:10.5px;color:#1D4E9A}",
    ".rfdoc .box{margin:8px 22px;border:1px solid #D9E1EC;border-radius:8px;padding:10px 12px;background:#F7F9FC}",
    ".rfdoc .box.blue{background:#EAF3FC;border-color:#C9DAF3}.rfdoc .box.green{background:#F0FDF4;border-color:#BBF7D0}.rfdoc .box.amber{background:#FFF7ED;border-color:#FED7AA}",
    ".rfdoc .box.red{background:#FEF2F2;border-color:#FECACA;color:#7F1D1D}",
    ".rfdoc .box b.t{display:block;margin-bottom:4px;color:#143A74}",
    ".rfdoc ol.qs{margin:6px 0 6px 20px;padding:0}.rfdoc ol.qs li{margin:3px 0}",
    ".rfdoc .chips{display:flex;flex-wrap:wrap;gap:6px}.rfdoc .chip{background:#F1F5F9;border:1px solid #D9E1EC;border-radius:99px;padding:3px 10px;font-size:12px}",
    ".rfdoc .chip.on{background:#E8F0FB;border-color:#1D4E9A;color:#143A74;font-weight:600}.rfdoc .chip.bad{background:#FEE2E2;border-color:#FCA5A5;color:#991B1B;font-weight:600}",
    ".rfdoc .chip.warn{background:#FEF3C7;border-color:#FCD34D;color:#92400E;font-weight:600}",
    ".rfdoc .rfform{padding:6px 22px 18px}",
    ".rfdoc .rfform .f{margin:10px 0}.rfdoc .rfform label.l{display:block;font-size:12.5px;font-weight:700;color:#4F5F78;margin-bottom:4px}",
    ".rfdoc .rfform input[type=text],.rfdoc .rfform input[type=number],.rfdoc .rfform input[type=date],.rfdoc .rfform textarea,.rfdoc .rfform select{width:100%;font-family:inherit;font-size:14px;padding:9px 10px;border:1.5px solid #D9E1EC;border-radius:8px;background:#fff;color:#16233B}",
    ".rfdoc .rfform textarea{min-height:64px;resize:vertical}",
    ".rfdoc .rfform .cbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 14px}.rfdoc .rfform .cbs label{display:flex;gap:7px;align-items:flex-start;font-size:13px;cursor:pointer;padding:3px 0}",
    ".rfdoc .rfform .cbs input{margin-top:3px}",
    ".rfdoc .verdicts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}",
    ".rfdoc .verdicts label{border:1.5px solid #D9E1EC;border-radius:10px;padding:10px 12px;cursor:pointer;display:flex;gap:8px;align-items:center;font-weight:600;font-size:13.5px;background:#fff}",
    ".rfdoc .verdicts label:has(input:checked){border-color:#1D4E9A;background:#E8F0FB;color:#143A74}",
    ".rfdoc .rfform .rec{display:grid;grid-template-columns:1.1fr 1fr 1.2fr;gap:8px;margin:6px 0}",
    ".rfdoc .sig{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px 22px 16px;background:#EAF3FC;border-top:2px solid #1D4E9A;font-size:12.5px;color:#143A74}",
    ".rfdoc .sig b{display:block;color:#16233B}",
    ".rfdoc .foot{padding:8px 22px 12px;font-size:11px;color:#7B8AA1;border-top:1px solid #EAEFF5}",
    ".rfsum{border:1px solid #BBF7D0;background:#F0FDF4;border-radius:10px;padding:12px 15px;margin:10px 0;font-size:13.5px}",
    ".rfsum b.h{display:block;color:#15803D;margin-bottom:6px}.rfsum .row{display:grid;grid-template-columns:120px 1fr;gap:5px 10px;font-size:13px}",
    ".rfsum .row span:nth-child(odd){color:#7B8AA1}.rfsum .vd{display:inline-block;background:#DCFCE7;color:#166534;border-radius:99px;padding:2px 10px;font-weight:700;font-size:12px;margin-bottom:6px}",
    ".rfsum ul{margin:4px 0 0 18px;padding:0}.rfsum li{margin:2px 0}",
    "@media(max-width:700px){.rfdoc ul.rfl.two{columns:1}.rfdoc table.rfid tr{display:grid;grid-template-columns:1fr 1fr}.rfdoc table.rfct{font-size:12.5px}.rfdoc .rfgrid{grid-template-columns:1fr}.rfdoc .rfrow{grid-template-columns:120px 1fr auto}.rfdoc .sig{grid-template-columns:1fr}.rfdoc .rfform .rec{grid-template-columns:1fr}}",
    "@media print{.rfdoc{border:0;border-radius:0;font-size:10.5pt;line-height:1.45}.rfdoc .rfhead{padding:10px 14px 8px}.rfdoc .rfbar{padding:8px 14px 2px}.rfdoc .rfbody{padding:2px 14px 6px}.rfdoc table.rfct{width:calc(100% - 28px);margin:4px 14px 6px}.rfdoc table.rfct td,.rfdoc table.rfct th{padding:4px 7px}.rfdoc .rfnote{margin:4px 14px 6px}.rfdoc table.rfct th{-webkit-print-color-adjust:exact;print-color-adjust:exact}.rfdoc tr,.rfdoc .box{break-inside:avoid}.rfdoc .rfform,.rf-noprint{display:none!important}.rfdoc .rfbar{-webkit-print-color-adjust:exact;print-color-adjust:exact}}"
  ].join("\n");

  function srcTag(s) { return s ? '<span class="src ' + esc(s) + '">' + esc(L.src[s] || s) + '</span>' : ""; }
  function row(k, v, opts) {
    opts = opts || {};
    return '<div class="rfrow"><span class="k">' + esc(k) + '</span><span class="v' + (opts.cls ? " " + opts.cls : "") + '">' + (opts.raw ? v : esc(v)) + '</span>' + srcTag(opts.src) + '</div>';
  }
  function bar(t, small) { return '<div class="rfbar">' + esc(t) + (small ? '<small>' + esc(small) + '</small>' : "") + '</div>'; }
  function yesno(v) { return v === true ? "ใช่" : v === false ? "ไม่ใช่" : "ไม่ทราบ"; }
  function cls3(v) { return v === true ? "bad" : v === false ? "" : "dim"; }

  /* ---------- A · แกนกลาง ---------- */
  /* รหัสสัญญาณ → ข้อความ (ธงจาก cs-score.js และสัญญาณเคส S1–S7) — ไม่ให้รหัสดิบหลุดไปในเอกสาร */
  var FLAG_NM = {
    B1: "หกล้มตั้งแต่ 2 ครั้งใน 12 เดือน", B2: "ล้มแล้วบาดเจ็บจนต้องพบแพทย์", B4: "ล้มแล้วลุกขึ้นเองไม่ได้",
    B6: "ยาเสี่ยงหกล้มสูง ≥ 2 รายการ ร่วมกับทรงตัวได้ไม่เกิน 1 ท่า", B7: "หกล้ม 1 ครั้งใน 12 เดือน",
    B8: "รู้สึกไม่มั่นคงหรือกังวลว่าจะล้ม", B9: "ลุกนั่ง 5 ครั้งช้ากว่าเกณฑ์อายุ", B10: "ลุกเดิน 3 เมตรใช้เวลา ≥ 12 วินาที",
    B11: "ยืนต่อเท้าได้ไม่ครบ 10 วินาที", B12: "ใช้ยาประจำตั้งแต่ 4 รายการ", B13: "พบยาที่อาจเพิ่มความเสี่ยงหกล้ม",
    B16: "ทำกิจวัตรประจำวันเองได้ไม่ครบ", R1: "ลุกนั่งช้าลงจากครั้งก่อนเกินค่าการเปลี่ยนแปลงที่มีความหมาย",
    R3: "ลุกเดินช้าลงจากครั้งก่อน ≥ 2 วินาที", R8: "ทรงตัวได้น้อยท่ากว่าครั้งก่อน",
    S1: "หกล้มครั้งใหม่", S2: "หกล้มซ้ำ/บาดเจ็บ", S3: "ความเสี่ยงจากยา", S4: "กำลังขาและการทรงตัวถดถอย",
    S5: "เดินช้าลง", S6: "กิจวัตรประจำวันลดลง", S7: "ธงแดงด้านความปลอดภัย"
  };
  function reasonName(k, ctx) {
    var f = REASONS.filter(function (z) { return z.k === k; })[0];
    return f ? f.nm : FLAG_NM[k] || (ctx.sigNm && ctx.sigNm[k]) || k;
  }
  /* แถวตารางข้อมูลทางคลินิก: หัวข้อ · ผล · เกณฑ์อ้างอิง · แปลผล */
  function crow(nm, val, ref, st) {
    var S = { bad: ["ผิดปกติ", "st-bad"], warn: ["ควรติดตาม", "st-warn"], ok: ["ปกติ", "st-ok"] }[st] || ["—", ""];
    return '<tr><td>' + esc(nm) + '</td><td class="v">' + val + '</td><td class="ref">' + esc(ref || "") + '</td><td class="st ' + S[1] + '">' + S[0] + '</td></tr>';
  }
  function coreHTML(r, ctx) {
    ctx = ctx || {};
    var pkg = r.package || {}, d = derive(pkg), pr = r.profiles || ctx.profile || {};
    var dest = r.destination, destNm = L.dest[dest] || dest;
    var age = pr.age || (pr.birth_year_be ? (ctx.beNow || (new Date().getFullYear() + 543)) - pr.birth_year_be : null);
    var cut = age == null ? 12.1 : age < 65 ? 10 : age < 75 ? 11.5 : 12.1;
    var reasons = [], seen = {};
    (r.reasons || []).forEach(function (x) { var k = typeof x === "string" ? x : (x.k || x.id || x.text); if (k && !seen[k]) { seen[k] = 1; reasons.push(k); } });
    var h = '';

    /* หัวเอกสาร */
    h += '<div class="rfhead"><div><div class="kk">CareSignal · แบบสรุปข้อมูลเพื่อการส่งต่อ</div>' +
      '<h2>ถึง ' + esc(destNm) + '</h2>' +
      '<p class="sub">' + esc(ctx.title || "ขอความเห็นเพื่อทบทวนความเสี่ยงหกล้มและวางแผนดูแล") + '</p></div>' +
      '<div class="meta"><span>เลขที่</span><b>' + esc(String(r.id || "").slice(-8).toUpperCase() || "—") + '</b>' +
      '<span>วันที่ส่ง</span><b>' + esc(dt(r.created_at)) + '</b>' +
      '<span>ขอคำตอบภายใน</span><b' + (r.reply_due && new Date(r.reply_due) < new Date() && !r.review ? ' style="color:#B91C1C"' : '') + '>' + esc(dt(r.reply_due)) + '</b></div></div>';

    /* ผู้รับบริการ — เท่าที่จำเป็น (PDPA) */
    h += '<table class="rfid"><tr>' +
      '<td><span>รหัส</span><b class="mono">' + esc(pr.pseudonym || "—") + '</b></td>' +
      '<td><span>ชื่อ</span><b>' + esc(pr.display_name || "—") + '</b></td>' +
      '<td><span>อายุ / เพศ</span><b>' + (age ? age + " ปี" : "—") + ' · ' + (pr.sex === "f" ? "หญิง" : pr.sex === "m" ? "ชาย" : "—") + '</b></td>' +
      '<td><span>อุปกรณ์ช่วยเดิน</span><b>' + esc(pr.mobility_aid || ctx.mobilityAid || "ไม่ระบุ") + '</b></td>' +
      '<td><span>ระดับสัญญาณ</span><b class="' + (r.level === "urgent" ? "bad" : r.level === "decline" ? "warn" : "") + '">' + esc(L.level[r.level] || r.level || "—") + '</b></td>' +
      '</tr></table>';

    /* 1 · เหตุผลและคำถาม */
    var qs = r.questions || [];
    h += bar("1. เหตุผลการส่งต่อและคำถามถึง" + destNm) + '<div class="rfbody">' +
      (reasons.length ? '<ul class="rfl two">' + reasons.map(function (k) { return '<li>' + esc(reasonName(k, ctx)) + '</li>'; }).join("") + '</ul>' : '<p class="dim">ไม่ได้ระบุเหตุผล</p>') +
      (r.action ? '<p><b>สิ่งที่ขอให้ทำ:</b> ' + esc(r.action) + '</p>' : '') +
      (qs.length ? '<p style="margin-bottom:2px"><b>คำถาม:</b></p><ol class="qs">' + qs.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join("") + '</ol>' : '') +
      '</div>';

    /* ฉุกเฉิน — แสดงเฉพาะเมื่อมี */
    var reds = (d.safetyVerdict && d.safetyVerdict.reds) || [];
    if (reds.indexOf("chest") >= 0 || reds.indexOf("stroke") >= 0 || d.chest === 2 || d.stroke === 2)
      h += '<div class="box red"><b class="t">อาการที่ต้องประเมินทันที</b>ผู้รับบริการตอบว่ามีอาการ' +
        (reds.indexOf("chest") >= 0 || d.chest === 2 ? "เจ็บหน้าอก/หายใจลำบาก " : "") + (reds.indexOf("stroke") >= 0 || d.stroke === 2 ? "อ่อนแรงเฉียบพลัน/หน้าเบี้ยว/พูดไม่ชัด" : "") +
        ' ในวันที่ประเมิน — ระบบหยุดการทดสอบท่าทาง</div>';

    /* 2 · ข้อมูลทางคลินิกที่สำคัญ — แสดงเฉพาะที่มีข้อมูล */
    var rows = [], miss = [];
    if (d.fallCount !== null && d.fallCount !== 9) {
      var fx = [];
      if (d.fallInjury !== null && d.fallInjury > 0) fx.push(L.fallInjury[d.fallInjury]);
      if (d.fallLoc === 2) fx.push("หมดสติ/จำเหตุการณ์ไม่ได้");
      if (d.fallGetup !== null && d.fallGetup >= 2) fx.push(L.fallGetup[d.fallGetup]);
      if (d.fallWhen !== null && d.fallCount > 0) fx.push("ครั้งล่าสุด " + L.fallWhen[d.fallWhen]);
      if (d.unsteady === true) fx.push("รู้สึกไม่มั่นคง"); if (d.worried === true) fx.push("กลัวล้ม");
      rows.push(crow("หกล้มใน 12 เดือน", (d.fallCount === 0 ? "ไม่เคย" : L.fallCount[d.fallCount]) + (fx.length ? '<small>' + esc(fx.join(" · ")) + '</small>' : ''),
        "ล้ม ≥ 1 ครั้ง หรือไม่มั่นคง/กลัวล้ม = คัดกรองบวก (STEADI)", d.fallCount >= 2 || d.fallInjury >= 2 || d.fallLoc === 2 || d.fallGetup >= 2 ? "bad" : d.fallCount === 1 || d.unsteady === true || d.worried === true ? "warn" : "ok"));
    } else if (d.fallCount === 9) rows.push(crow("หกล้มใน 12 เดือน", "จำไม่ได้", "", "warn"));
    else miss.push("ประวัติหกล้ม");
    if ((d.fallCount === null || d.fallCount === 9) && (d.unsteady === true || d.worried === true))
      rows.push(crow("ไม่มั่นคงขณะยืน/เดิน หรือกลัวล้ม", [d.unsteady === true ? "ไม่มั่นคง" : "", d.worried === true ? "กลัวล้ม" : ""].filter(Boolean).join(" · "), "คำถามคัดกรอง STEADI", "warn"));
    var sym = [];
    if (d.faint >= 1) sym.push(d.faint === 2 ? "หน้ามืด/เวียนศีรษะมาก" : "หน้ามืดเล็กน้อย");
    if (d.injuryRecent >= 1) sym.push("เพิ่งล้ม/ผ่าตัด/ห้ามลงน้ำหนัก");
    d.medSym.filter(function (k) { return k !== "none"; }).forEach(function (k) { sym.push((L.medSym[k] || k) + " (หลังใช้ยา)"); });
    if (sym.length) rows.push(crow("อาการวันที่ประเมิน", esc(sym.join(" · ")), "", d.orthoSym || d.faint === 2 ? "bad" : "warn"));
    if (d.tugLast !== null) rows.push(crow("ลุกเดิน 3 เมตร (TUG)", n1(d.tugLast) + " วินาที" + (d.tugFirst !== null && d.nAssess > 1 ? '<small>ครั้งแรก ' + n1(d.tugFirst) + ' วินาที</small>' : ''), "< 12 วินาที (CDC STEADI)", d.tug12 ? "bad" : "ok"));
    else miss.push("ลุกเดิน 3 เมตร");
    if (d.ftsstLast !== null) rows.push(crow("ลุกนั่ง 5 ครั้ง (5×STS)", n1(d.ftsstLast) + " วินาที" + (d.ftsstFirst !== null && d.nAssess > 1 ? '<small>ครั้งแรก ' + n1(d.ftsstFirst) + ' วินาที</small>' : ''), "≤ " + cut + " วินาที ตามอายุ (Poncumhak 2014)", +d.ftsstLast > cut ? "warn" : "ok"));
    else miss.push("ลุกนั่ง 5 ครั้ง");
    if (d.balPassed !== null) rows.push(crow("ทรงตัว 4 ท่า", "ผ่าน " + d.balPassed + " จาก 4 ท่า" + (d.tandem !== null ? '<small>ยืนต่อเท้า ' + d.tandem + ' วินาที</small>' : ''), "ยืนต่อเท้าครบ 10 วินาที (4-Stage)", d.balPassed < 3 ? "warn" : "ok"));
    else miss.push("ทรงตัว");
    if (d.nMeds || d.high || d.mod) {
      rows.push(crow("ยาที่ใช้ประจำ", (d.nMeds ? d.nMeds + " รายการ" : "—") + '<small>เสี่ยงหกล้ม: หลักฐานเข้ม ' + d.high + ' · ปานกลาง ' + d.mod + '</small>',
        "STOPPFall 2021 · ยาประจำ ≥ 4 รายการ", d.high ? "bad" : d.mod || d.poly ? "warn" : "ok"));
    } else miss.push("รายการยา");
    if (d.barthel !== null) rows.push(crow("กิจวัตรประจำวัน (Barthel)", d.barthel + " / 20" + (d.barthelBand ? '<small>' + esc(d.barthelBand) + '</small>' : ''), "20 = ช่วยเหลือตัวเองได้ · < 12 พึ่งพิง", d.barthel < 12 ? "bad" : d.barthel < 20 ? "warn" : "ok"));
    else if (d.adlLast !== null) rows.push(crow("กิจวัตรประจำวัน", ["พึ่งพามาก", "ต้องช่วยบางส่วน", "ทำเองได้"][d.adlLast] || String(d.adlLast), "", d.adlLast >= 2 ? "ok" : d.adlLast === 1 ? "warn" : "bad"));
    else miss.push("กิจวัตรประจำวัน");
    if (d.hazards.length || d.homeCount !== null || d.homeHelper)
      rows.push(crow("ความปลอดภัยในบ้าน", (d.hazards.length ? esc(d.hazards.map(function (k) { return L.hazard[k] || k; }).join(" · ")) : (d.homeCount ? "จุดเสี่ยง " + d.homeCount + " จุด" : "ไม่พบจุดเสี่ยง")) +
        (d.homeHelper === "alone" ? '<small>อยู่คนเดียว</small>' : ''), "CDC Check for Safety", d.hazards.length || d.homeCount ? "warn" : "ok"));
    h += bar("2. ข้อมูลทางคลินิกที่สำคัญ") +
      (rows.length ? '<table class="rfct"><thead><tr><th style="width:26%">หัวข้อ</th><th style="width:30%">ผล</th><th>เกณฑ์อ้างอิง</th><th style="width:12%">แปลผล</th></tr></thead><tbody>' + rows.join("") + '</tbody></table>'
                   : '<div class="rfbody"><p class="dim">ยังไม่มีผลการทดสอบในระบบ</p></div>') +
      (d.flagged.length ? '<div class="rfbody"><b>ยาที่ควรทบทวน:</b> ' +
        d.flagged.map(function (x) { return esc(x.inn || x.brand_text || "ยังไม่ระบุตัวยา") + ' (' + esc(L.frid[x.frid_group] || x.frid_group || "") + (x.dose_text ? ', ' + esc(x.dose_text) : '') + ')'; }).join(" · ") +
        ' <span class="dim">— ตั้งธงตามกลุ่มยา การปรับยาเป็นดุลยพินิจของผู้สั่งใช้</span></div>' : '') +
      (miss.length ? '<div class="rfbody"><p class="dim">ยังไม่มีข้อมูล: ' + esc(miss.join(" · ")) + '</p></div>' : '');

    /* ค่าจากเซ็นเซอร์คาดเอว — แสดงเฉพาะเมื่อมี */
    if (d.imu) h += imuHTML(d.imu);

    /* ที่มาของข้อมูล — บรรทัดเดียวแทนป้ายทุกแถว */
    var MTH = { camera_aruco: "กล้อง + ป้ายสัญลักษณ์", "camera-pose": "กล้องมือถือ", camera: "กล้องมือถือ", manual: "ครอบครัวจับเวลา", imu: "เซ็นเซอร์คาดเอว" };
    h += '<div class="rfnote"><b>ที่มาของข้อมูล</b> — ' + srcTag("sys") + ' ผลทดสอบวัดที่บ้าน' +
      (d.method ? 'โดย' + esc(MTH[d.method] || d.method) : '') + (d.nAssess ? ' · ประเมิน ' + d.nAssess + ' ครั้ง ล่าสุด ' + esc(d0(d.lastAt)) : '') +
      (d.alone ? ' · ทดสอบคนเดียว' : '') + ' · ' + srcTag("self") + ' ประวัติ อาการ และยาจากผู้รับบริการ/ครอบครัว' +
      ' · ความยินยอมใช้ข้อมูลเพื่อการดูแล: ' + ((pkg.consent && pkg.consent.assessment) ? "มี" : "ยังไม่พบบันทึก") + '</div>';
    return h;
  }

  /* ---------- B/C/D/E · โมดูลตามวิชาชีพ (ส่วนอ่าน + ส่วนกรอกตอบ) ---------- */
  function ynCell(name, pre, autoTag) {
    var v = pre && pre.v;
    return '<div class="yn">' +
      '<label><input type="radio" name="' + name + '" value="yes"' + (v === true ? " checked" : "") + '> ใช่</label>' +
      '<label><input type="radio" name="' + name + '" value="no"' + (v === false ? " checked" : "") + '> ไม่ใช่</label>' +
      '<label><input type="radio" name="' + name + '" value="unknown"' + (v === null || v === undefined ? " checked" : "") + '> ไม่ทราบ</label>' +
      (autoTag && pre && pre.s ? '<span class="auto">' + esc(L.src[pre.s]) + '</span>' : "") + '</div>';
  }
  function riskTable(d, rows) {
    var pre = riskPrefill(d), g = null, h = '<table class="rft"><thead><tr><th>ปัจจัยเสี่ยง (STEADI Checklist)</th><th style="width:230px">พบหรือไม่</th><th style="width:26%">บันทึก</th></tr></thead><tbody>';
    rows.forEach(function (rw) {
      if (rw.g !== g) { g = rw.g; h += '<tr class="grp"><td colspan="3">' + esc(g) + '</td></tr>'; }
      h += '<tr><td>' + esc(rw.nm) + '</td><td>' + ynCell("rf_" + rw.k, pre[rw.k], true) + '</td><td><input type="text" name="rfn_" data-k="' + rw.k + '" placeholder="หมายเหตุ" style="width:100%;font-size:12.5px;padding:5px 7px;border:1px solid #D9E1EC;border-radius:6px;font-family:inherit"></td></tr>';
    });
    return h + '</tbody></table>';
  }
  function cbs(name, list, checked) {
    checked = checked || [];
    return '<div class="cbs">' + list.map(function (o) { return '<label><input type="checkbox" name="' + name + '" value="' + esc(o.k) + '"' + (checked.indexOf(o.k) >= 0 ? " checked" : "") + '> <span>' + esc(o.nm) + '</span></label>'; }).join("") + '</div>';
  }
  function verdictHTML() {
    return '<div class="f"><label class="l">คำตอบ * <span style="font-weight:400">(ปุ่มมาตรฐานเหมือนกันทุกวิชาชีพ)</span></label><div class="verdicts">' +
      Object.keys(L.verdict).map(function (k) { return '<label><input type="radio" name="verdict" value="' + k + '"> ' + esc(L.verdict[k]) + '</label>'; }).join("") + '</div></div>';
  }
  function commonTail(dest) {
    return verdictHTML() +
      '<div class="f"><label class="l">ข้อค้นพบ * <span style="font-weight:400">(สิ่งที่ท่านพบจากการทบทวน — ครอบครัวจะได้อ่านข้อความนี้)</span></label><textarea name="finding" placeholder="เขียนเป็นประโยคที่คนทั่วไปเข้าใจ"></textarea></div>' +
      '<div class="f"><label class="l">คำแนะนำ</label><textarea name="recommend" placeholder="สิ่งที่แนะนำให้ผู้เอาประกัน ครอบครัว หรือทีมดูแลทำ — ระบบไม่สั่งหยุดหรือปรับยา ความเห็นเรื่องยาให้ระบุว่าควรปรึกษาผู้สั่งใช้"></textarea></div>' +
      '<div class="f" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label class="l">ระดับเร่งด่วนของสิ่งที่แนะนำ</label><select name="urgency">' +
      Object.keys(L.urgency).map(function (k) { return '<option value="' + k + '"' + (k === "routine" ? " selected" : "") + '>' + esc(L.urgency[k]) + '</option>'; }).join("") + '</select></div>' +
      '<div><label class="l">นัดติดตาม / ประเมินซ้ำ</label><input type="date" name="follow_date"></div></div>' +
      (dest !== "doctor" ? '<div class="f"><label class="l">ต้องประสานแพทย์หรือไม่</label><div class="yn"><label><input type="radio" name="need_doctor" value="yes"> ต้องประสาน</label><label><input type="radio" name="need_doctor" value="no" checked> ไม่ต้อง</label></div></div>' : "") +
      '<div class="f"><label class="l">หมายเหตุถึงผู้ประสานงาน</label><input type="text" name="note" placeholder="ไม่บังคับ"></div>';
  }

  var MOD = {};

  /* C · เภสัชกร — STEADI-Rx Provider Consult – Medication */
  MOD.pharmacist = function (r, d) {
    var pre = { fell: { v: d.fell, s: "self" }, worried: { v: d.worried, s: "self" }, unsteady: { v: d.unsteady, s: "self" }, ortho: { v: d.orthoSym ? true : null, s: "self" }, poly: { v: d.nMeds ? d.poly : null, s: "sys" }, high: { v: d.medItems.length ? d.high > 0 : null, s: "sys" } };
    var factors = [["fell", "หกล้มในปีที่ผ่านมา"], ["worried", "กังวลว่าจะล้ม"], ["unsteady", "รู้สึกไม่มั่นคงขณะยืนหรือเดิน"], ["ortho", "หน้ามืด/เวียนศีรษะเมื่อเปลี่ยนจากนอนเป็นยืน"], ["poly", "ใช้ยาประจำตั้งแต่ 4 รายการ"], ["high", "ใช้ยากลุ่มเสี่ยงสูงอย่างน้อย 1 รายการ"]];
    var read = bar("C · แบบทบทวนยาเพื่อลดความเสี่ยงหกล้ม", "โครงจาก STEADI-Rx Provider Consult – Medication (2019) และกรอบ SAFE") +
      '<div style="padding:0 22px"><table class="rft"><thead><tr><th>ปัจจัยเสี่ยงที่พบ</th><th style="width:230px">มีหรือไม่</th></tr></thead><tbody>' +
      factors.map(function (f) { return '<tr><td>' + esc(f[1]) + '</td><td>' + ynCell("px_" + f[0], pre[f[0]], true) + '</td></tr>'; }).join("") +
      '</tbody></table></div>' +
      (d.flagged.length ? '<div class="box amber"><b class="t">ยาที่ระบบตั้งธงว่าควรทบทวน (' + d.flagged.length + ')</b>' +
        d.flagged.map(function (x) { return '<div>• <b>' + esc(x.inn || x.brand_text || "ยังไม่ระบุตัวยา") + '</b> — ' + esc(L.frid[x.frid_group] || x.frid_group || "") + ' · ' + esc(L.fridLevel[x.frid_level] || "") + '</div>'; }).join("") +
        '<div style="margin-top:6px;font-size:12px;color:#92400E">ตั้งธงจากกลุ่มยาตามกฎที่ประกาศไว้ ไม่ใช่คำแนะนำให้หยุดยา — การปรับยาเป็นของผู้สั่งใช้</div></div>' : '<div class="box green">ไม่พบยาในกลุ่มเสี่ยงจากที่ระบบจัดกลุ่มได้' + (d.medItems.some(function (x) { return x.frid_group === "unknown" || !x.frid_group; }) ? ' — แต่มีรายการที่ยังจัดกลุ่มไม่ได้ ควรตรวจสอบ' : "") + '</div>');
    var medOpts = '<option value="">— เลือกตัวยา —</option>' + d.medItems.map(function (x) { var nm = x.inn || x.brand_text || "ยังไม่ระบุ"; return '<option value="' + esc(nm) + '">' + esc(nm) + '</option>'; }).join("") + '<option value="__other">อื่น ๆ / ระบุเอง</option>';
    var form = '<div class="rfform"><div class="f"><label class="l">ควรได้รับการประเมินการเดิน กำลัง และการทรงตัวเพิ่มเติมหรือไม่ <span style="font-weight:400">(ตาม AGS/BGS เมื่อพบปัจจัยเสี่ยง)</span></label>' +
      '<div class="yn"><label><input type="radio" name="eval_gait" value="yes"> ควร — แนะนำส่งนักกายภาพบำบัด</label><label><input type="radio" name="eval_gait" value="no"> ไม่จำเป็นตอนนี้</label></div></div>' +
      '<div class="f"><label class="l">ปัญหาจากการใช้ยา และข้อเสนอแนะ <span style="font-weight:400">(กรอกได้สูงสุด 3 รายการ ตามแบบ STEADI-Rx — แพทย์ผู้สั่งใช้จะเป็นผู้ตอบรับ)</span></label>' +
      [0, 1, 2].map(function (i) {
        return '<div class="rec"><select name="mp_med_' + i + '">' + medOpts + '</select>' +
          '<select name="mp_problem_' + i + '"><option value="">— ปัญหา —</option><option>ยากลุ่มเสี่ยงสูงต่อการหกล้ม</option><option>ยาซ้ำซ้อน/เสริมฤทธิ์กัน</option><option>ขนาดยาสูงเมื่อเทียบอายุ/ไต</option><option>รับประทานไม่ตรงตามสั่ง</option><option>ใช้ยาเองโดยไม่มีใบสั่ง (OTC/สมุนไพร)</option><option>เวลารับประทานเพิ่มความเสี่ยงกลางคืน</option><option>อื่น ๆ</option></select>' +
          '<input type="text" name="mp_rec_' + i + '" placeholder="ข้อเสนอแนะ เช่น ทบทวนกับผู้สั่งใช้เรื่องลดขนาด/เปลี่ยนยา"></div>';
      }).join("") + '</div>' +
      '<div class="f"><label class="l">ให้ความรู้ผู้เอาประกัน/ผู้ดูแลแล้วเรื่อง (SAFE · Educate)</label>' +
      cbs("educate", [{ k: "why", nm: "เหตุผลที่ควรทบทวนยา" }, { k: "timing", nm: "เวลารับประทานที่ปลอดภัยกว่า" }, { k: "watch", nm: "อาการที่ต้องเฝ้าระวัง" }, { k: "rise", nm: "วิธีลุกช้า ๆ กันหน้ามืด" }, { k: "otc", nm: "ยา OTC/สมุนไพรที่ควรเลี่ยง" }]) + '</div>' +
      commonTail("pharmacist") + '</div>';
    return read + form;
  };

  /* B · แพทย์ — Patient Referral + Risk Factors Checklist + ตอบรับข้อเสนอเภสัชกร */
  MOD.doctor = function (r, d) {
    var read = bar("B · แบบประเมินสาเหตุร่วมและแผนดูแล (แพทย์)", "โครงจาก CDC Fall Prevention Patient Referral + Fall Risk Factors Checklist (2017)") +
      '<div style="padding:0 22px 8px">' + riskTable(d, RISK_ROWS) + '</div>' +
      (d.pharmRecs.length ? '<div class="box amber"><b class="t">ข้อเสนอจากเภสัชกร (STEADI-Rx) — โปรดตอบรับ</b>' +
        d.pharmRecs.map(function (p, i) {
          return '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed #FED7AA"><div><b>' + esc(p.med || "") + '</b> — ' + esc(p.problem || "") + '<br><span style="color:#92400E">' + esc(p.recommend || "") + '</span></div>' +
            '<div class="yn" style="flex-direction:column;align-items:flex-start;gap:2px"><label><input type="radio" name="pr_' + i + '" value="accept"> รับข้อเสนอ</label><label><input type="radio" name="pr_' + i + '" value="decline"> ไม่รับ</label><label><input type="radio" name="pr_' + i + '" value="discuss" checked> จะหารือกับผู้เอาประกันก่อน</label></div></div>';
        }).join("") + '</div>' : "");
    var form = '<div class="rfform">' +
      '<div class="f"><label class="l">แผนที่แพทย์กำหนด</label>' +
      cbs("plan", [{ k: "eval", nm: "ประเมินสาเหตุเพิ่มเติม (เช่น ความดันเปลี่ยนท่า หัวใจ ระบบประสาท)" }, { k: "medrev", nm: "ทบทวน/ปรับยาตามข้อเสนอเภสัชกร" }, { k: "pt", nm: "ส่งกายภาพบำบัด ฝึกการเดินและทรงตัว" }, { k: "ot", nm: "ประเมินความปลอดภัยบ้านโดยพยาบาล/นักกิจกรรมบำบัด" }, { k: "eye", nm: "ส่งตรวจสายตา" }, { k: "foot", nm: "ตรวจเท้า/รองเท้า" }, { k: "specialist", nm: "ส่งต่อเฉพาะทาง" }, { k: "program", nm: "โปรแกรมออกกำลังกายลดความเสี่ยงหกล้ม" }]) + '</div>' +
      '<div class="f"><label class="l">ข้อห้ามหรือข้อควรระวังในการออกกำลังกาย/กายภาพ</label><div class="yn"><label><input type="radio" name="contra" value="no" checked> ไม่มี</label><label><input type="radio" name="contra" value="yes"> มี (ระบุในข้อค้นพบ)</label></div></div>' +
      commonTail("doctor") + '</div>';
    return read + form;
  };

  /* E · นักกายภาพบำบัด — TUG observations · 4-Stage · Chair Stand · Recommended Program */
  MOD.physio = function (r, d) {
    var stages = d.balStages || [];
    var read = bar("E · แบบประเมินการเคลื่อนไหว การทรงตัว และโปรแกรมฝึก", "โครงจาก STEADI TUG · 4-Stage Balance · 30-Second Chair Stand · Recommended Fall Prevention Program") +
      '<div class="rfgrid">' +
      row("TUG จากแอป", d.tugLast === null ? "ไม่ได้ทำ" : n1(d.tugLast) + " วินาที" + (d.tugOut != null ? " · ขาไป " + n1(d.tugOut) + " ขากลับ " + n1(d.tugBack) : "") + (d.tugReaction != null ? " · ตอบสนองต่อสัญญาณเริ่ม " + n1(d.tugReaction) + " วิ" : ""), { src: "sys", cls: d.tug12 ? "bad" : "" }) +
      row("เกณฑ์ STEADI", "ตั้งแต่ 12 วินาทีขึ้นไป = เสี่ยงหกล้ม", { cls: "dim" }) +
      row("FTSST จากแอป", d.ftsstLast === null ? "ไม่ได้ทำ" : n1(d.ftsstLast) + " วินาที", { src: "sys", cls: d.ftsstSlow ? "warn" : "" }) +
      row("เกณฑ์ไทย", "< 65 ปี 10.0 · 65–74 ปี 11.5 · 75+ ปี 12.1 วินาที", { cls: "dim" }) +
      '</div>' +
      '<div style="padding:0 22px 6px"><table class="rft"><thead><tr><th>ท่าทรงตัว (4-Stage)</th><th class="c">เวลาจากแอป</th><th class="c">ผล</th><th>หมายเหตุจากระบบ</th><th style="width:120px">ประเมินซ้ำ (วินาที)</th></tr></thead><tbody>' +
      L.balStage.map(function (nm, i) {
        var s = stages[i];
        return '<tr><td>' + (i + 1) + '. ' + esc(nm) + '</td><td class="num">' + (s && !s.skipped && has(s.held) ? (+s.held).toFixed(1) : "—") + '</td>' +
          '<td class="c">' + (s ? (s.skipped ? "ไม่ได้ทำ" : s.pass ? "ผ่าน" : "ไม่ผ่าน") : "—") + '</td><td style="font-size:12px;color:#4F5F78">' + esc(s && s.reason ? s.reason : (s && s.decidedBy === "human" ? "ผู้ดูแลยืนยันผล" : "")) + '</td>' +
          '<td><input type="number" name="bal_' + i + '" min="0" max="60" step="0.5" placeholder="วินาที" style="width:100%;font-size:12.5px;padding:5px 7px;border:1px solid #D9E1EC;border-radius:6px;font-family:inherit"></td></tr>';
      }).join("") + '</tbody></table><div style="font-size:11.5px;color:#7B8AA1;margin-top:4px">ยืนต่อเท้าเป็นเส้นตรงได้ไม่ถึง 10 วินาที = เสี่ยงหกล้มเพิ่มขึ้น (STEADI) · ท่ายืนขาเดียวถูกข้ามอัตโนมัติเมื่อทำคนเดียว</div></div>';
    var form = '<div class="rfform">' +
      '<div class="f"><label class="l">ข้อสังเกตขณะเดิน/ทำ TUG <span style="font-weight:400">(รายการจาก STEADI TUG — ติ๊กที่ท่านสังเกตเองหรือครอบครัวรายงาน)</span></label>' + cbs("obs", TUG_OBS) + '</div>' +
      '<div class="f" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
      '<div><label class="l">TUG ประเมินซ้ำ (วินาที)</label><input type="number" name="tug_re" step="0.1" min="0" placeholder="ถ้าวัดเอง"></div>' +
      '<div><label class="l">Chair Stand 30 วินาที (ครั้ง)</label><input type="number" name="chair30" step="1" min="0" placeholder="ถ้าวัดเอง"></div>' +
      '<div><label class="l">อุปกรณ์ช่วยเดิน</label><select name="aid"><option value="">ไม่ใช้</option><option>ไม้เท้า</option><option>ไม้เท้า 4 ขา</option><option>Walker</option><option>รถเข็น</option></select></div></div>' +
      '<div class="f"><label class="l">เป้าหมายของผู้เอาประกัน <span style="font-weight:400">(ถามผู้เอาประกันเอง เช่น เดินไปตลาดเอง เข้าห้องน้ำกลางคืนได้ปลอดภัย)</span></label><input type="text" name="goal"></div>' +
      '<div class="f"><label class="l">โปรแกรมที่แนะนำ <span style="font-weight:400">(Recommended Fall Prevention Program — ต้องเน้นการทรงตัวและกำลัง เพิ่มความยากขึ้นเรื่อย ๆ และสะสมอย่างน้อย 50 ชั่วโมง)</span></label>' +
      [0, 1].map(function (i) { return '<div class="rec"><input type="text" name="pg_name_' + i + '" placeholder="โปรแกรม เช่น ฝึกทรงตัว-กำลังขาที่บ้าน / ไทเก๊ก"><input type="text" name="pg_where_' + i + '" placeholder="สถานที่"><input type="text" name="pg_when_' + i + '" placeholder="วัน-เวลา · ความถี่ · ค่าใช้จ่าย"></div>'; }).join("") + '</div>' +
      '<div class="f"><label class="l">ข้อควรระวังระหว่างฝึก</label><input type="text" name="caution" placeholder="เช่น ต้องมีคนอยู่ข้าง ๆ ทุกครั้ง · หยุดเมื่อเวียนศีรษะ"></div>' +
      commonTail("physio") + '</div>';
    return read + form;
  };

  /* D · พยาบาล — ประเมินความปลอดภัย อาการ ความดันเปลี่ยนท่า และประสานงาน */
  MOD.nurse = function (r, d) {
    var read = bar("D · แบบประเมินการพยาบาลและการประสานการดูแล", "โครงจาก STEADI Measuring Orthostatic Blood Pressure + Risk Factors Checklist") +
      '<div class="rfgrid">' +
      row("อยู่คนเดียว", d.homeHelper ? L.homeHelper[d.homeHelper] : (d.alone ? "อยู่คนเดียว" : "—"), { src: "self", cls: d.homeHelper === "alone" ? "bad" : "" }) +
      row("ลุกเองไม่ได้หลังล้ม", d.fallGetup === null ? "—" : L.fallGetup[d.fallGetup], { src: "self", cls: d.fallGetup >= 2 ? "bad" : "" }) +
      row("จุดเสี่ยงในบ้าน", d.hazards.length ? d.hazards.map(function (k) { return L.hazard[k] || k; }).join(" · ") : (d.homeCount ? d.homeCount + " ข้อ" : "ไม่พบ"), { src: "self" }) +
      row("กิจวัตร", d.barthel !== null ? "Barthel " + d.barthel + "/20" + (d.barthelBand ? " · " + d.barthelBand : "") : "—", { src: "self" }) +
      '</div>';
    function bpRow(k, nm, t) {
      return '<tr><td><b>' + nm + '</b><br><span style="color:#7B8AA1;font-size:12px">' + t + '</span></td>' +
        '<td><div style="display:flex;gap:4px;align-items:center"><input type="number" name="bp_' + k + '_s" placeholder="SBP" style="width:64px;padding:5px;border:1px solid #D9E1EC;border-radius:6px;font-family:inherit"> / <input type="number" name="bp_' + k + '_d" placeholder="DBP" style="width:64px;padding:5px;border:1px solid #D9E1EC;border-radius:6px;font-family:inherit"></div></td>' +
        '<td><input type="number" name="bp_' + k + '_hr" placeholder="HR" style="width:64px;padding:5px;border:1px solid #D9E1EC;border-radius:6px;font-family:inherit"></td>' +
        '<td><input type="text" name="bp_' + k + '_sym" placeholder="อาการร่วม" style="width:100%;padding:5px;border:1px solid #D9E1EC;border-radius:6px;font-family:inherit"></td></tr>';
    }
    var form = '<div class="rfform">' +
      '<div class="f"><label class="l">ความดันเปลี่ยนท่า (Orthostatic BP) <span style="font-weight:400">— นอน 5 นาที วัด → ยืน วัดที่ 1 และ 3 นาที · ผิดปกติเมื่อตัวบนลด ≥20 หรือตัวล่างลด ≥10 mmHg หรือมีอาการ</span></label>' +
      '<table class="rft"><thead><tr><th>ท่า</th><th>ความดัน</th><th>ชีพจร</th><th>อาการร่วม</th></tr></thead><tbody>' + bpRow("lie", "นอน", "5 นาที") + bpRow("s1", "ยืน", "1 นาที") + bpRow("s3", "ยืน", "3 นาที") + '</tbody></table>' +
      '<div id="orthoCalc" style="font-size:12.5px;margin-top:6px;color:#4F5F78">กรอกค่าแล้วระบบจะคำนวณผลต่างให้ — การแปลผลเป็นของท่าน</div></div>' +
      '<div class="f"><label class="l">อาการที่ประเมินวันนี้</label>' + cbs("sym", [{ k: "dizzy", nm: "เวียนศีรษะ/หน้ามืด" }, { k: "fatigue", nm: "อ่อนเพลีย" }, { k: "pain", nm: "ปวด" }, { k: "fear", nm: "กลัวล้ม" }, { k: "incont", nm: "กลั้นปัสสาวะไม่อยู่" }, { k: "sleep", nm: "ปัญหาการนอน" }, { k: "vision", nm: "มองเห็นไม่ชัด" }, { k: "cognitive", nm: "สับสน/หลงลืม" }]) + '</div>' +
      '<div class="f"><label class="l">การเคลื่อนย้ายและกิจวัตร (ระดับความช่วยเหลือ)</label><div class="cbs">' +
      [["transfer", "ย้ายเตียง–เก้าอี้"], ["toilet", "เข้าห้องน้ำ"], ["walk", "เดินในบ้าน"], ["stairs", "ขึ้นลงบันได"]].map(function (a) { return '<label style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><span>' + a[1] + '</span><select name="adl_' + a[0] + '" style="font-size:12.5px;padding:4px"><option value="">—</option><option value="indep">ทำเองได้</option><option value="super">ต้องมีคนดู</option><option value="assist">ต้องช่วย</option><option value="dep">ทำเองไม่ได้</option></select></label>'; }).join("") + '</div></div>' +
      '<div class="f"><label class="l">การรับประทานยา</label><div class="yn"><label><input type="radio" name="meds_admin" value="self"> จัดยาเองได้</label><label><input type="radio" name="meds_admin" value="helped"> มีผู้จัดยาให้</label><label><input type="radio" name="meds_admin" value="problem"> มีปัญหา (ระบุในข้อค้นพบ)</label></div></div>' +
      '<div class="f"><label class="l">ความปลอดภัยบ้านที่ควรแก้ก่อน</label>' + cbs("home_fix", Object.keys(L.hazard).map(function (k) { return { k: k, nm: L.hazard[k] }; }), d.hazards) + '<label class="l" style="margin-top:6px">ต้องประเมินละเอียด (Thai-HFHAT) หรือไม่</label><div class="yn"><label><input type="radio" name="hfhat" value="yes"> ควรนัดเยี่ยมบ้านประเมินละเอียด</label><label><input type="radio" name="hfhat" value="no" checked> คัดกรองสั้นเพียงพอ</label></div></div>' +
      '<div class="f"><label class="l">ให้คำแนะนำแล้วเรื่อง</label>' + cbs("education", [{ k: "prevent", nm: "การลดความเสี่ยงหกล้มในบ้าน" }, { k: "help", nm: "วิธีขอความช่วยเหลือ / เบอร์ฉุกเฉิน" }, { k: "getup", nm: "การลุกจากพื้นอย่างปลอดภัย" }, { k: "rise", nm: "ลุกช้า ๆ กันหน้ามืด" }, { k: "shoes", nm: "รองเท้าที่เหมาะสม" }, { k: "device", nm: "การใช้อุปกรณ์ช่วยเดิน" }]) + '</div>' +
      '<div class="f"><label class="l">ประสานงานต่อ</label>' + cbs("coord", [{ k: "doctor", nm: "แพทย์" }, { k: "pharmacist", nm: "เภสัชกร" }, { k: "physio", nm: "นักกายภาพบำบัด" }, { k: "community", nm: "อสม./ชุมชน" }, { k: "family", nm: "ครอบครัว" }]) + '</div>' +
      '<div class="f"><label class="l">สถานะการติดต่อวันนี้</label><select name="contact"><option value="reached">ติดต่อสำเร็จ</option><option value="unreached">ติดต่อไม่สำเร็จ</option><option value="visit">เยี่ยมบ้านแล้ว</option><option value="emergency">ส่งต่อฉุกเฉิน</option></select></div>' +
      commonTail("nurse") + '</div>';
    return read + form;
  };

  /* ปลายทางอื่น (ครอบครัว/ชุมชน) — แกนกลาง + คำตอบมาตรฐาน */
  MOD.generic = function (r, d) { return bar("แบบตอบกลับ") + '<div class="rfform">' + commonTail("generic") + '</div>'; };

  /* ---------- ประกอบเอกสารทั้งใบ ---------- */
  function docHTML(r, ctx) {
    ctx = ctx || {};
    var d = derive(r.package || {});
    var mod = MOD[r.destination] || MOD.generic;
    var body = coreHTML(r, ctx);
    if (ctx.mode === "preview") {
      /* ผู้ประสานงานดูก่อนส่ง — ไม่มีส่วนกรอกตอบ */
      body += bar("สิ่งที่" + (L.dest[r.destination] || r.destination) + "จะเห็นและต้องตอบ", "โมดูล " + ({ doctor: "B", pharmacist: "C", nurse: "D", physio: "E" }[r.destination] || "ทั่วไป")) +
        '<div class="box">' + esc({ doctor: "ตารางปัจจัยเสี่ยง STEADI ที่ระบบเติมให้บางส่วน · ข้อเสนอจากเภสัชกร (ถ้ามี) ให้ตอบรับ · แผนดูแล ข้อห้าม และระดับเร่งด่วน",
          pharmacist: "ตารางปัจจัยเสี่ยง 6 ข้อแบบ STEADI-Rx · ยาที่ระบบตั้งธง · ปัญหาการใช้ยาและข้อเสนอแนะสูงสุด 3 รายการ · ควรประเมินการเดิน/ทรงตัวหรือไม่",
          physio: "TUG/FTSST พร้อมคุณภาพข้อมูล · ตาราง 4 ท่าพร้อมช่องประเมินซ้ำ · ข้อสังเกตขณะเดิน 8 ข้อ · โปรแกรมฝึกที่แนะนำ",
          nurse: "ตารางความดันเปลี่ยนท่า 3 ท่า · อาการ · ระดับความช่วยเหลือ · ความปลอดภัยบ้าน · การให้คำแนะนำ · การประสานงาน" }[r.destination] || "คำตอบมาตรฐานและข้อค้นพบ") + '</div>';
    } else if (ctx.mode === "review" && r.review) {
      body += reviewDocHTML(r);
    } else if (ctx.mode === "readonly") {
      /* ผู้ประสานงานเปิดดูใบที่ส่งไปแล้ว — ไม่มีส่วนกรอก */
      body += r.review ? reviewDocHTML(r) : '<div class="rfnote rf-noprint"><b>สถานะ</b> — รอ' + esc(L.dest[r.destination] || r.destination) + 'ตอบกลับ' + (r.acknowledged_at ? ' · รับเรื่องแล้ว ' + esc(dt(r.acknowledged_at)) : ' · ยังไม่มีผู้รับเรื่อง') + '</div>';
    } else {
      body += mod(r, d);
      body += '<div class="sig"><div><b>ผู้ตอบ</b>' + esc(ctx.reviewerName || "—") + (ctx.reviewerOrg ? " · " + esc(ctx.reviewerOrg) : "") + '</div><div><b>วันที่ตอบ</b>บันทึกอัตโนมัติเมื่อกดส่ง · ชื่อท่านจะอยู่ในบันทึกตรวจสอบ</div></div>';
    }
    body += '<div class="foot">เอกสารเพื่อการเฝ้าระวังและประสานการดูแล ไม่ใช่การวินิจฉัย ไม่ใช่ใบสั่งยา และไม่ใช้พิจารณาสินไหม · โครงจาก CDC STEADI · NICE NG249</div>';
    return '<div class="rfdoc" data-dest="' + esc(r.destination) + '">' + body + '</div>';
  }

  /* ============================================================
     ค่าวัดจากเซ็นเซอร์คาดเอว (cs-imu.js · firmware/CareSignal-Waist)
     ทุกแถวบอก "ค่า · เกณฑ์/ค่าอ้างอิง · ที่มา" — เกณฑ์ตัวเลขที่งานวิจัยยังไม่ได้กำหนดเป็นสากล
     ติดป้าย "เกณฑ์ภายในโปรแกรม" ให้ผู้เชี่ยวชาญใช้ดุลยพินิจ ไม่ใช่การวินิจฉัย
     ============================================================ */
  var IMU_SRC = {
    steadi: "CDC STEADI — Timed Up & Go (2017)", wfg: "World Guidelines for Falls Prevention 2022 (ความเร็วเดิน < 0.8 ม./วิ = เสี่ยงสูง)",
    itug: "Salarian 2010 (iTUG) · Weiss 2011 (instrumented TUG, Physiol Meas)", ists: "Van Lummel 2013 (Gait & Posture) · Millor 2013 (J NeuroEng Rehabil)",
    isway: "Mancini 2012 — ISway (J NeuroEng Rehabil)", gait: "Moe-Nilssen & Helbostad 2004 (J Biomech)", prog: "เกณฑ์ภายในโปรแกรม CareSignal"
  };
  function sec1(ms) { return ms == null ? "—" : (ms / 1000).toFixed(1) + " วิ"; }
  function imuRows(imu) {
    var G = [];
    function grp(nm, sub) { var g = { g: nm, sub: sub, rows: [] }; G.push(g); return g; }
    function add(g, nm, v, ref, cls, src) { g.rows.push({ nm: nm, v: v, ref: ref, cls: cls || "", src: src || "prog" }); }
    if (!imu) return G;
    var F = imu.ftsst, T = imu.tug, B = imu.balance;
    if (F && F.ftsst) {
      var f = F.ftsst, g = grp("ลุกนั่ง 5 ครั้ง — instrumented 5×STS", "ช่วงลุกและกำลังจากเซ็นเซอร์ที่เอว");
      add(g, "เวลารวม (นับจากสัญญาณเริ่ม)", sec1(F.totalMs) + (F.status !== "ok" ? " · ทำไม่ครบ" : ""), "ค่าตัดไทยตามอายุ 10.0 / 11.5 / 12.1 วิ", F.totalMs != null && F.totalMs >= 12000 ? "warn" : "", "sys");
      add(g, "เวลาตอบสนองหลังสัญญาณเริ่ม", sec1(F.reactionMs), "> 1.0 วิ ควรสังเกต (การได้ยิน ความตั้งใจ การรู้คิด)", F.reactionMs > 1000 ? "warn" : "", "prog");
      var rm = f.repMs || [];
      add(g, "เวลาแต่ละครั้ง (1→5)", rm.length ? rm.map(function (m) { return (m / 1000).toFixed(1); }).join(" · ") + " วิ" : "—", "ครั้งท้ายช้ากว่าครั้งแรกเกิน 30% = ล้าเร็ว", rm.length >= 2 && rm[rm.length - 1] > rm[0] * 1.3 ? "warn" : "", "prog");
      add(g, "ความสม่ำเสมอของแต่ละครั้ง (CV)", f.stsCv == null ? "—" : f.stsCv + " %", "> 20% = ไม่สม่ำเสมอ ควรสังเกตการควบคุมการเคลื่อนไหว", f.stsCv > 20 ? "warn" : "", "prog");
      add(g, "ช่วงลุกจากเก้าอี้เฉลี่ย (เริ่มก้ม → ยืนสุด)", sec1(f.stsMeanMs), "ยิ่งนานยิ่งบ่งชี้กำลังขา/การควบคุมลดลง · > 2.0 วิ ควรสังเกต", f.stsMeanMs > 2000 ? "warn" : "", "ists");
      add(g, "ความเร็วก้มลำตัวสูงสุด", f.peakOmega == null ? "—" : f.peakOmega + " องศา/วิ", "< 40 องศา/วิ = ลุกช้า ระมัดระวังตัว", f.peakOmega != null && f.peakOmega < 40 ? "warn" : "", "ists");
      add(g, "ความเร่งแนวตั้งสูงสุดขณะลุก (ดัชนีกำลัง)", f.peakAv == null ? "—" : f.peakAv.toFixed(2) + " g", "< 0.15 g = กำลังขาลดลง", f.peakAv != null && f.peakAv < 0.15 ? "warn" : "", "ists");
      add(g, "มุมก้มลำตัวสูงสุด", f.tiltMax == null ? "—" : f.tiltMax + "°", "> 45° = ใช้แรงเหวี่ยงลำตัวชดเชยกำลังขา", f.tiltMax > 45 ? "warn" : "", "prog");
    }
    if (T && T.tug) {
      var t = T.tug, g2 = grp("ลุกเดิน 3 เมตร — instrumented TUG", "แยกช่วงย่อยตามงานวิจัย iTUG");
      add(g2, "เวลารวม (นับจากสัญญาณเริ่ม)", sec1(T.totalMs) + (T.status !== "ok" ? " · ทำไม่ครบ" : ""), "ตั้งแต่ 12 วิ = เสี่ยงหกล้ม", T.totalMs != null && T.totalMs >= 12000 ? "bad" : "", "steadi");
      add(g2, "เวลาตอบสนองหลังสัญญาณเริ่ม", sec1(T.reactionMs), "> 1.0 วิ ควรสังเกต", T.reactionMs > 1000 ? "warn" : "", "prog");
      add(g2, "ลุกจากเก้าอี้ (sit-to-stand)", sec1(t.stsMs), "> 2.0 วิ ควรสังเกต", t.stsMs > 2000 ? "warn" : "", "itug");
      add(g2, "เดินไป / เดินกลับ", sec1(t.walkOutMs) + " / " + sec1(t.walkBackMs), "ขากลับช้ากว่าขาไปเกิน 30% = ล้าหรือลังเลหลังหมุน", t.walkOutMs != null && t.walkBackMs > t.walkOutMs * 1.3 ? "warn" : "", "itug");
      add(g2, "หมุนตัวกลับ", t.turnSeen ? sec1(t.turnMs) + (t.turnDeg != null ? " · " + Math.round(t.turnDeg) + "°" : "") + (t.turnPeak != null ? " · เร็วสุด " + Math.round(t.turnPeak) + " องศา/วิ" : "") : "ไม่พบการหมุนชัดเจน", "หมุนนานกว่า 3.0 วิ หรือหมุนทั้งตัวช้า สัมพันธ์กับความเสี่ยงล้ม", !t.turnSeen || t.turnMs > 3000 ? "warn" : "", "itug");
      add(g2, "หมุนก่อนนั่ง", sec1(t.turn2Ms), "ข้อมูลประกอบ (มักหมุนไม่สุด)", "", "itug");
      add(g2, "นั่งลง (stand-to-sit)", sec1(t.sitMs), "> 2.0 วิ หรือทิ้งตัวลง (< 0.5 วิ) ควรสังเกต", t.sitMs != null && (t.sitMs > 2000 || t.sitMs < 500) ? "warn" : "", "prog");
      add(g2, "จำนวนก้าว · จังหวะก้าว", (t.steps || 0) + " ก้าว" + (t.cadence != null ? " · " + Math.round(t.cadence) + " ก้าว/นาที" : ""), "< 90 ก้าว/นาที = เดินช้า", t.cadence != null && t.cadence < 90 ? "warn" : "", "gait");
      add(g2, "ความสม่ำเสมอของก้าว (CV)", t.stepCv == null ? "—" : t.stepCv + " %", "> 10% = ก้าวไม่สม่ำเสมอ", t.stepCv > 10 ? "warn" : "", "gait");
      add(g2, "ความเร็วเดินโดยประมาณ (ระยะ 3 ม. × 2)", t.speed == null ? "—" : t.speed.toFixed(2) + " ม./วิ", "< 0.8 ม./วิ = เสี่ยงสูง (ค่ามาตรฐานควรวัดบนทางเดิน 4 ม.)", t.speed != null && t.speed < 0.8 ? "bad" : t.speed != null && t.speed < 1.0 ? "warn" : "", "wfg");
    }
    if (B && B.length) {
      var g3 = grp("ท่าทรงตัว — การแกว่งของลำตัว (accelerometric sway)", "ไม่มีเกณฑ์สากล ให้เทียบกับครั้งก่อนของคนเดียวกัน ค่ามากขึ้น = แกว่งมากขึ้น");
      B.forEach(function (x, i) {
        var b = x && x.balance; if (!b) return;
        add(g3, (i + 1) + ". " + (L.balStage[i] || "ท่าที่ " + (i + 1)), "ยืน " + b.heldSec + " วิ · RMS " + b.rms + " ม./วิ² · แกนหลัก/รอง " + b.major + " / " + b.minor + " · พื้นที่ 95% " + b.area + " · jerk " + b.jerk + " · ความถี่ " + b.freq + " Hz" + (b.stepped ? " · ขยับตัวมาก/ก้าว" : ""),
          "RMS และพื้นที่วงรีเพิ่มขึ้นเมื่อการควบคุมท่าทางลดลง · ท่ายากขึ้นค่าควรเพิ่มขึ้นตามลำดับ", b.stepped ? "warn" : "", "isway");
      });
    }
    var any = F || T || (B && B.filter(Boolean)[0]);
    if (any) {
      var g4 = grp("อุปกรณ์และคุณภาพสัญญาณ", "");
      var imp = [F, T].concat(B || []).filter(function (x) { return x && x.impact; })[0];
      if (imp) add(g4, "แรงกระแทกระหว่างทดสอบ", imp.maxG + " g ที่ " + sec1(imp.impactAt), "> 3 g = อาจล้มหรือกระแทก ตรวจสอบเหตุการณ์", "bad", "prog");
      add(g4, "อุปกรณ์", (imu.device === "nano33ble-rev2" ? "Arduino Nano 33 BLE Sense Rev2 (BMI270) ที่เอว" : (imu.device || "เซ็นเซอร์คาดเอว")) + (imu.fw ? " · " + imu.fw : "") + (any.fsHz ? " · " + any.fsHz + " Hz" : ""), "ค่าที่ได้จากเซ็นเซอร์ตัวเดียวที่บ้าน ยังไม่ผ่านการเทียบกับห้องตรวจการเคลื่อนไหวในกลุ่มผู้สูงอายุไทย", "", "sys");
    }
    return G;
  }
  function imuHTML(imu) {
    var G = imuRows(imu); if (!G.length) return "";
    var h = bar("ค่าวัดจากเซ็นเซอร์คาดเอว (instrumented TUG · 5×STS · การแกว่งขณะยืน)", "ตัวเลขประกอบการพิจารณาของแพทย์/นักกายภาพ — ไม่ใช่การวินิจฉัย · เกณฑ์ที่มีงานวิจัยรองรับระบุที่มาไว้ ที่เหลือเป็นเกณฑ์ภายในโปรแกรม");
    h += '<div style="padding:0 22px 6px">';
    G.forEach(function (g) {
      h += '<table class="rft"><thead><tr><th style="width:30%">' + esc(g.g) + (g.sub ? '<div style="font-weight:400;font-size:11px;color:#7B8AA1">' + esc(g.sub) + '</div>' : "") + '</th><th style="width:28%">ค่าที่วัดได้</th><th>เกณฑ์ / ค่าอ้างอิง</th><th style="width:16%">ที่มา</th></tr></thead><tbody>' +
        g.rows.map(function (r) { return '<tr class="' + esc(r.cls) + '"><td>' + esc(r.nm) + '</td><td class="num"' + (r.cls === "bad" ? ' style="color:#B91C1C;font-weight:700"' : r.cls === "warn" ? ' style="color:#B45309;font-weight:700"' : "") + '>' + esc(r.v) + '</td><td style="font-size:12px;color:#4F5F78">' + esc(r.ref) + '</td><td style="font-size:11px;color:#7B8AA1">' + esc(IMU_SRC[r.src] || L.src[r.src] || r.src) + '</td></tr>'; }).join("") +
        '</tbody></table>';
    });
    h += '<div style="font-size:11.5px;color:#7B8AA1;margin-top:4px">ค่าเหล่านี้คือสิ่งที่ห้องตรวจการเคลื่อนไหววัดด้วยเซ็นเซอร์ที่เอว (ตำแหน่งใกล้จุดศูนย์ถ่วง) ระบบไม่ใช้ค่าเหล่านี้เปลี่ยนคะแนนความเสี่ยงหลัก — ใช้ให้ผู้เชี่ยวชาญเห็น "ลุกอย่างไร หมุนอย่างไร แกว่งแค่ไหน" นอกเหนือจากเวลารวม</div></div>';
    return h;
  }

  /* ---------- อ่านค่าจากฟอร์มตอบ → โครงสร้าง ---------- */
  function collect(root, dest) {
    function val(n) { var e = root.querySelector('[name="' + n + '"]'); return e ? String(e.value || "").trim() : ""; }
    function radio(n) { var e = root.querySelector('[name="' + n + '"]:checked'); return e ? e.value : null; }
    function checks(n) { return [].map.call(root.querySelectorAll('[name="' + n + '"]:checked'), function (e) { return e.value; }); }
    function yn(v) { return v === "yes" ? true : v === "no" ? false : null; }
    var verdict = radio("verdict"), finding = val("finding"), recommend = val("recommend");
    var errs = [];
    if (!verdict) errs.push("เลือกคำตอบมาตรฐาน 1 ข้อ");
    if (finding.length < 5) errs.push("เขียนข้อค้นพบอย่างน้อย 1 ประโยค");
    var form = { v: 2, dest: dest, verdict: verdict, urgency: val("urgency") || "routine", follow_date: val("follow_date") || null, need_doctor: yn(radio("need_doctor")), note: val("note") || null };
    if (dest === "pharmacist") {
      form.factors = {}; ["fell", "worried", "unsteady", "ortho", "poly", "high"].forEach(function (k) { form.factors[k] = yn(radio("px_" + k)); });
      form.eval_gait = yn(radio("eval_gait"));
      form.problems = [0, 1, 2].map(function (i) { var m = val("mp_med_" + i), p = val("mp_problem_" + i), rc = val("mp_rec_" + i); return (m || p || rc) ? { med: m === "__other" ? "อื่น ๆ" : m, problem: p, recommend: rc } : null; }).filter(Boolean);
      form.educate = checks("educate");
      if (form.problems.some(function (p) { return /หยุดยา(?!เอง)|ให้หยุด/.test(p.recommend || ""); })) errs.push("ข้อเสนอเรื่องยาให้ใช้ถ้อยคำว่า \"ทบทวนกับผู้สั่งใช้\" — ระบบไม่ส่งคำสั่งหยุดยาถึงผู้เอาประกันโดยตรง");
    } else if (dest === "doctor") {
      form.factors = {}; RISK_ROWS.forEach(function (rw) { form.factors[rw.k] = yn(radio("rf_" + rw.k)); var nEl = root.querySelector('[name="rfn_"][data-k="' + rw.k + '"]'); if (nEl && nEl.value.trim()) form.factors[rw.k + "_note"] = nEl.value.trim(); });
      form.plan = checks("plan"); form.contra = yn(radio("contra"));
      form.pharm_response = [].map.call(root.querySelectorAll('[name^="pr_"]:checked'), function (e) { return { i: +e.name.slice(3), response: e.value }; });
    } else if (dest === "physio") {
      form.obs = checks("obs"); form.tug_re = val("tug_re") ? +val("tug_re") : null; form.chair30 = val("chair30") ? +val("chair30") : null; form.aid = val("aid") || null;
      form.balance_re = [0, 1, 2, 3].map(function (i) { var v = val("bal_" + i); return v === "" ? null : +v; });
      form.goal = val("goal") || null; form.caution = val("caution") || null;
      form.programs = [0, 1].map(function (i) { var a = val("pg_name_" + i), b = val("pg_where_" + i), c = val("pg_when_" + i); return (a || b || c) ? { name: a, where: b, when: c } : null; }).filter(Boolean);
    } else if (dest === "nurse") {
      form.ortho = {}; ["lie", "s1", "s3"].forEach(function (k) { form.ortho[k] = { s: val("bp_" + k + "_s") ? +val("bp_" + k + "_s") : null, d: val("bp_" + k + "_d") ? +val("bp_" + k + "_d") : null, hr: val("bp_" + k + "_hr") ? +val("bp_" + k + "_hr") : null, sym: val("bp_" + k + "_sym") || null }; });
      form.ortho.abnormal = orthoAbnormal(form.ortho);
      form.symptoms = checks("sym"); form.adl = { transfer: val("adl_transfer") || null, toilet: val("adl_toilet") || null, walk: val("adl_walk") || null, stairs: val("adl_stairs") || null };
      form.meds_admin = radio("meds_admin"); form.home_fix = checks("home_fix"); form.hfhat = yn(radio("hfhat")); form.education = checks("education"); form.coord = checks("coord"); form.contact = val("contact") || null;
    }
    return { ok: !errs.length, errors: errs, finding: finding, recommend: recommend || null, next_step: VERDICT_NEXT[verdict] || "follow_plan", note: form.note, form: form };
  }
  function orthoAbnormal(o) {
    if (!o || !o.lie || o.lie.s == null) return null;
    var ab = false;
    ["s1", "s3"].forEach(function (k) { var x = o[k]; if (!x) return; if (x.s != null && o.lie.s - x.s >= 20) ab = true; if (x.d != null && o.lie.d != null && o.lie.d - x.d >= 10) ab = true; if (x.sym) ab = true; });
    return ab;
  }
  /* ผู้ช่วยคำนวณผลต่างความดันแบบสด (พยาบาล) */
  function bindOrtho(root) {
    var out = root.querySelector("#orthoCalc"); if (!out) return;
    function upd() {
      var g = function (n) { var e = root.querySelector('[name="' + n + '"]'); return e && e.value !== "" ? +e.value : null; };
      var o = { lie: { s: g("bp_lie_s"), d: g("bp_lie_d") }, s1: { s: g("bp_s1_s"), d: g("bp_s1_d"), sym: (root.querySelector('[name="bp_s1_sym"]') || {}).value }, s3: { s: g("bp_s3_s"), d: g("bp_s3_d"), sym: (root.querySelector('[name="bp_s3_sym"]') || {}).value } };
      if (o.lie.s == null) { out.textContent = "กรอกค่าแล้วระบบจะคำนวณผลต่างให้ — การแปลผลเป็นของท่าน"; return; }
      var parts = [];
      ["s1", "s3"].forEach(function (k) { if (o[k].s != null) parts.push((k === "s1" ? "1 นาที" : "3 นาที") + ": ตัวบนลด " + (o.lie.s - o[k].s) + (o[k].d != null && o.lie.d != null ? " · ตัวล่างลด " + (o.lie.d - o[k].d) : "")); });
      var ab = orthoAbnormal(o);
      out.innerHTML = esc(parts.join(" · ")) + (ab === null ? "" : ab ? ' — <b style="color:#B91C1C">เข้าเกณฑ์ผิดปกติของ STEADI</b>' : ' — <b style="color:#166534">ไม่เข้าเกณฑ์ผิดปกติ</b>');
    }
    root.querySelectorAll('[name^="bp_"]').forEach(function (e) { e.addEventListener("input", upd); });
  }

  /* ---------- สรุปผลที่ส่งกลับ (อ่านอย่างเดียว) ---------- */
  function reviewDocHTML(r) {
    var v = r.review || {}, f = v.form || {};
    var h = bar("ผลที่" + (L.dest[r.destination] || r.destination) + "ส่งกลับ", "ตอบเมื่อ " + dt(r.reviewed_at)) +
      '<div class="box green"><b class="t">' + esc(L.verdict[f.verdict] || L.nextStep[v.next_step] || "ส่งผลกลับแล้ว") + '</b>' +
      '<div><b>ข้อค้นพบ:</b> ' + esc(v.finding || "—") + '</div>' + (v.recommend ? '<div><b>คำแนะนำ:</b> ' + esc(v.recommend) + '</div>' : "") +
      '<div><b>ขั้นตอนถัดไปของทีมดูแล:</b> ' + esc(L.nextStep[v.next_step] || v.next_step || "—") + (f.urgency ? ' · ' + esc(L.urgency[f.urgency] || f.urgency) : "") + (f.follow_date ? ' · นัดติดตาม ' + esc(d0(f.follow_date)) : "") + '</div>' +
      (f.need_doctor ? '<div><b>ต้องประสานแพทย์:</b> ใช่</div>' : "") + (v.note ? '<div><b>หมายเหตุ:</b> ' + esc(v.note) + '</div>' : "") + '</div>';
    h += '<div style="padding:0 22px 12px">' + moduleSummaryHTML(r, false) + '</div>';
    return h;
  }
  function moduleSummaryHTML(r, plain) {
    var v = r.review || {}, f = v.form || {}, out = [];
    if (!f.dest) return "";
    if (f.dest === "pharmacist") {
      var fac = f.factors || {}, yes = Object.keys(fac).filter(function (k) { return fac[k] === true; });
      if (yes.length) out.push("ปัจจัยเสี่ยงที่เภสัชกรยืนยัน: " + yes.map(function (k) { return { fell: "หกล้มในปีที่ผ่านมา", worried: "กังวลว่าจะล้ม", unsteady: "ไม่มั่นคงขณะเดิน", ortho: "หน้ามืดเมื่อลุกยืน", poly: "ใช้ยาตั้งแต่ 4 รายการ", high: "มียากลุ่มเสี่ยงสูง" }[k]; }).join(" · "));
      (f.problems || []).forEach(function (p) { out.push("ยา " + (p.med || "—") + ": " + (p.problem || "") + (p.recommend ? " → " + p.recommend : "")); });
      if (f.eval_gait === true) out.push("แนะนำให้ประเมินการเดินและการทรงตุ้วเพิ่มเติม (นักกายภาพบำบัด)".replace("ตุ้ว", "ตัว"));
      if ((f.educate || []).length) out.push("ให้ความรู้แล้ว " + f.educate.length + " เรื่อง");
    } else if (f.dest === "doctor") {
      var fc = f.factors || {}, yesD = RISK_ROWS.filter(function (rw) { return fc[rw.k] === true; });
      if (yesD.length) out.push("ปัจจัยเสี่ยงที่แพทย์ยืนยัน: " + yesD.map(function (rw) { return rw.nm; }).join(" · "));
      if ((f.plan || []).length) out.push("แผน: " + f.plan.map(function (k) { return { eval: "ประเมินสาเหตุเพิ่ม", medrev: "ทบทวน/ปรับยา", pt: "กายภาพบำบัด", ot: "ประเมินบ้าน", eye: "ตรวจสายตา", foot: "ตรวจเท้า", specialist: "ส่งต่อเฉพาะทาง", program: "โปรแกรมออกกำลังกาย" }[k] || k; }).join(" · "));
      if (f.contra === true) out.push("มีข้อควรระวังในการออกกำลังกาย — ดูข้อค้นพบ");
      if ((f.pharm_response || []).length) out.push("ตอบรับข้อเสนอเภสัชกรแล้ว " + f.pharm_response.length + " รายการ");
    } else if (f.dest === "physio") {
      if ((f.obs || []).length) out.push("ข้อสังเกตขณะเดิน: " + f.obs.map(function (k) { var o = TUG_OBS.filter(function (z) { return z.k === k; })[0]; return o ? o.nm : k; }).join(" · "));
      if (f.tug_re != null) out.push("TUG ประเมินซ้ำ " + f.tug_re + " วินาที"); if (f.chair30 != null) out.push("Chair Stand 30 วินาที " + f.chair30 + " ครั้ง");
      if (f.aid) out.push("อุปกรณ์ช่วยเดิน: " + f.aid); if (f.goal) out.push("เป้าหมาย: " + f.goal);
      (f.programs || []).forEach(function (p) { out.push("โปรแกรม: " + [p.name, p.where, p.when].filter(Boolean).join(" · ")); });
      if (f.caution) out.push("ข้อควรระวัง: " + f.caution);
    } else if (f.dest === "nurse") {
      if (f.ortho && f.ortho.lie && f.ortho.lie.s != null) out.push("ความดันเปลี่ยนท่า: นอน " + f.ortho.lie.s + "/" + (f.ortho.lie.d || "—") + (f.ortho.s1 && f.ortho.s1.s != null ? " → ยืน 1 นาที " + f.ortho.s1.s + "/" + (f.ortho.s1.d || "—") : "") + (f.ortho.s3 && f.ortho.s3.s != null ? " → 3 นาที " + f.ortho.s3.s + "/" + (f.ortho.s3.d || "—") : "") + (f.ortho.abnormal ? " — เข้าเกณฑ์ผิดปกติ" : f.ortho.abnormal === false ? " — ปกติ" : ""));
      if ((f.symptoms || []).length) out.push("อาการ: " + f.symptoms.length + " ข้อ");
      if ((f.home_fix || []).length) out.push("บ้านที่ควรแก้ก่อน: " + f.home_fix.map(function (k) { return L.hazard[k] || k; }).join(" · "));
      if (f.hfhat === true) out.push("นัดเยี่ยมบ้านประเมินละเอียด");
      if ((f.education || []).length) out.push("ให้คำแนะนำแล้ว " + f.education.length + " เรื่อง");
      if ((f.coord || []).length) out.push("ประสานต่อ: " + f.coord.map(function (k) { return L.dest[k] || k; }).join(" · "));
    }
    if (!out.length) return "";
    return '<ul style="margin:6px 0 0 18px;padding:0;font-size:' + (plain ? "14px" : "13px") + '">' + out.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul>';
  }
  /* การ์ดสรุปสำหรับผู้ประสานงานและครอบครัว */
  function summaryHTML(r, opts) {
    opts = opts || {};
    var v = r.review; if (!v) return "";
    var f = v.form || {};
    return '<div class="rfsum">' + (opts.title !== false ? '<b class="h">✓ ผลจาก' + esc(L.dest[r.destination] || r.destination) + (r.reviewed_at ? ' · ' + esc(dt(r.reviewed_at)) : "") + '</b>' : "") +
      (f.verdict ? '<span class="vd">' + esc(L.verdict[f.verdict]) + '</span>' : "") +
      '<div class="row"><span>ข้อค้นพบ</span><span>' + esc(v.finding || "—") + '</span>' +
      (v.recommend ? '<span>คำแนะนำ</span><span>' + esc(v.recommend) + '</span>' : "") +
      '<span>ขั้นตอนถัดไป</span><span><b style="display:inline">' + esc(L.nextStep[v.next_step] || v.next_step || "—") + '</b>' + (f.urgency && f.urgency !== "routine" ? ' · ' + esc(L.urgency[f.urgency]) : "") + (f.follow_date ? ' · นัด ' + esc(d0(f.follow_date)) : "") + '</span>' +
      (v.note && !opts.plain ? '<span>หมายเหตุ</span><span>' + esc(v.note) + '</span>' : "") + '</div>' +
      moduleSummaryHTML(r, !!opts.plain) + '</div>';
  }

  function injectCSS(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null); if (!doc || doc.getElementById("rfcss")) return;
    var s = doc.createElement("style"); s.id = "rfcss"; s.textContent = CSS; doc.head.appendChild(s);
  }

  root.CSReferralForms = {
    L: L, REASONS: REASONS, TUG_OBS: TUG_OBS, RISK_ROWS: RISK_ROWS, VERDICT_NEXT: VERDICT_NEXT, CSS: CSS,
    derive: derive, riskPrefill: riskPrefill, docHTML: docHTML, collect: collect, bindOrtho: bindOrtho, imuRows: imuRows, imuHTML: imuHTML, IMU_SRC: IMU_SRC,
    summaryHTML: summaryHTML, moduleSummaryHTML: moduleSummaryHTML, reviewDocHTML: reviewDocHTML, orthoAbnormal: orthoAbnormal, injectCSS: injectCSS,
    reasonsFor: function (dest) { return REASONS.filter(function (z) { return z.to.indexOf(dest) >= 0; }); },
    /* เสนอเหตุผลจากชุดข้อมูล — ผู้ประสานงานยังต้องกดเลือกเอง */
    suggestReasons: function (pkg, dest) {
      var d = derive(pkg), s = [];
      if (d.tug12 || d.ftsstSlow) s.push("gait"); if (d.tandemFail) s.push("balance"); if (d.ftsstSlow) s.push("weak");
      if (d.orthoSym || d.faint === 2) s.push("ortho"); if (d.high || d.poly) s.push("meds");
      if (d.fallCount >= 2 || d.fallInjury >= 2 || d.fallLoc === 2 || d.fallGetup >= 2) s.push("recurrent");
      if (d.hazards.length >= 2 || d.homeHelper === "alone") s.push("home"); if (d.barthel !== null && d.barthel < 15) s.push("adl"); if (d.worried) s.push("fear");
      return s.filter(function (k) { var z = REASONS.filter(function (x) { return x.k === k; })[0]; return z && z.to.indexOf(dest) >= 0; });
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CSReferralForms;
})(typeof window !== "undefined" ? window : this);
