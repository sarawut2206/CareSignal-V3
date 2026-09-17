/* ============================================================
   cs-demo.js — โหมดสาธิตด้วยข้อมูลสังเคราะห์ (Synthetic demo data)
   ------------------------------------------------------------
   เปิดด้วย  CareSignal-Staff.html?demo=1            (เริ่มเป็นผู้ประสานงาน)
             CareSignal-Staff.html?demo=pharmacist   (หรือ physio doctor nurse admin insurer)
             CareSignal-Portfolio-Dashboard.html?demo=1

   หลักที่ยึด
   1) ไม่แตะฐานข้อมูลจริงแม้แต่คำสั่งเดียว — ทับทุกฟังก์ชันของ CSBackend
      ที่คอนโซลเจ้าหน้าที่และแดชบอร์ดบริษัทประกันเรียก ด้วยข้อมูลในหน่วยความจำ
   2) ทุกหน้าจอมีแถบ "ข้อมูลสาธิต" ค้างไว้ด้านบน ปิดไม่ได้ เพราะกรรมการที่เดินเข้ามา
      กลางทางต้องรู้ทันทีว่าตัวเลขบนจอไม่ใช่ผู้ป่วยจริง
   3) ทุกชื่อขึ้นต้นด้วย "สาธิต" ทุกรหัสขึ้นต้นด้วย "DEMO-" เบอร์โทรเป็นเลขที่โทรไม่ติด
      ข้อมูลจึงแยกจากของจริงได้ด้วยตาเปล่าแม้ในภาพหน้าจอ
   4) ข้อมูลสร้างจากตัวสุ่มที่กำหนดเมล็ดไว้ จึงเหมือนกันทุกครั้งที่เปิด (ซ้อมเดโมได้)
      สิ่งที่กดระหว่างเดโมเก็บไว้ใน sessionStorage ของแท็บนั้น สลับบทบาทแล้วยังต่อเนื่อง
      ปิดแท็บหรือกด "รีเซ็ต" ทุกอย่างกลับเป็นค่าตั้งต้น
   ============================================================ */
(function () {
  if (typeof window === "undefined" || typeof CSBackend === "undefined") return;
  var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
  var want = q.get("demo"); if (!want) return;

  var ROLES = ["care_manager", "pharmacist", "physio", "doctor", "nurse", "admin", "insurer"];
  var ROLE_ALIAS = { "1": "care_manager", cm: "care_manager", care_manager: "care_manager",
    pharm: "pharmacist", pharmacist: "pharmacist", physio: "physio", pt: "physio",
    doctor: "doctor", md: "doctor", nurse: "nurse", admin: "admin", insurer: "insurer" };
  var ROLE_NM = { care_manager: "ผู้ประสานงาน", pharmacist: "เภสัชกร", physio: "นักกายภาพบำบัด",
    doctor: "แพทย์", nurse: "พยาบาล", admin: "ผู้ดูแลระบบ", insurer: "บริษัทประกัน" };
  var role = ROLE_ALIAS[String(want).toLowerCase()] || "care_manager";

  var STORE = "cs-demo-state-v5";   /* เปลี่ยนเลขรุ่นทุกครั้งที่รูปแบบข้อมูลเปลี่ยน แท็บที่เปิดค้างจะได้ไม่ใช้ข้อมูลรุ่นเก่า */
  var ORG = "โรงพยาบาลสาธิต (ข้อมูลสังเคราะห์)";
  var NOW = Date.now();
  var H = 3600e3, D = 24 * H;
  function iso(ms) { return new Date(ms).toISOString(); }
  function ago(hours) { return iso(NOW - hours * H); }
  function ahead(hours) { return iso(NOW + hours * H); }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }
  function uuid(kind, n) { return "0000dem0-" + pad(kind, 4) + "-4000-8000-" + pad(n, 12); }

  /* ตัวสุ่มกำหนดเมล็ด — เดโมต้องซ้ำได้ทุกครั้ง */
  function rng(seed) { var a = seed >>> 0; return function () { a += 0x6D2B79F5; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- บุคลากรสาธิต ---------- */
  var STAFF = ROLES.map(function (r, i) {
    return { id: uuid(9, i + 1), role: r, username: "demo." + r, display_name: "สาธิต " + ROLE_NM[r],
      pseudonym: "DEMO-STAFF-" + pad(i + 1, 2), must_set_password: false, created_at: ago(24 * 60) };
  });
  function staffOf(r) { for (var i = 0; i < STAFF.length; i++) if (STAFF[i].role === r) return STAFF[i]; return STAFF[0]; }

  /* ---------- ชุดข้อมูลสังเคราะห์ ---------- */
  var SIG = {
    S1: { nm: "หกล้มครั้งใหม่", dest: "doctor" }, S2: { nm: "หกล้มซ้ำหรือล้มแล้วบาดเจ็บ", dest: "doctor" },
    S3: { nm: "ความเสี่ยงจากยา", dest: "pharmacist" }, S4: { nm: "กำลังขาและการทรงตัวถดถอย", dest: "physio" },
    S5: { nm: "ความคล่องตัวในการเดินลดลง", dest: "physio" }, S6: { nm: "ทำกิจวัตรประจำวันได้น้อยลง", dest: "nurse" },
    S7: { nm: "ธงแดงด้านความปลอดภัย", dest: "doctor" }
  };
  function sig(k) { return { k: k, nm: SIG[k].nm, dest: SIG[k].dest }; }
  var NAMES = ["สมศรี", "บุญมี", "ประนอม", "สมหญิง", "อำพร", "วิชัย", "ละเอียด", "จำรัส", "สุนีย์", "ประสิทธิ์",
    "ทองดี", "เรณู", "สมาน", "บัวผัน", "ชูศรี", "สงวน", "มาลี", "เพ็ญศรี", "สุรพล", "นงเยาว์",
    "ปราณี", "อุดม", "จินดา", "ไพศาล", "สมจิตร", "วันดี", "ถนอม", "รัตนา", "สุชาติ", "อรุณ",
    "ทองใบ", "ศิริ", "บุญช่วย", "พิมพา", "สมพงษ์", "ลำดวน", "ประภาส", "กัลยา", "สุทิน", "อัมพร"];
  var PROV = ["เชียงใหม่", "เชียงใหม่", "เชียงใหม่", "ลำพูน", "กรุงเทพมหานคร", "กรุงเทพมหานคร", "ขอนแก่น", "นครราชสีมา", "สงขลา", "ชลบุรี"];
  var SLA = { urgent: 24, decline: 48, watch: 72, stable: 168 };
  var NEXT_DAYS = { urgent: 7, decline: 21, watch: 45, stable: 90 };

  /* ---------- ชุดข้อมูลส่งต่อรุ่น 2 — รูปแบบเดียวกับ build_referral_package() ใน 22_referral_forms.sql ----------
     ข้อมูลสาธิตเก็บแบบย่อ (falls12m/injured/…) จึงแปลงเป็นรหัสชุดเดียวกับที่แอปสมาชิกบันทึกจริง */
  var HAZ_ORDER = ["rail", "light", "wet", "rug", "shoe", "stair", "reach"];
  function pkgV2(S, userId) {
    var as = S.assess.filter(function (a) { return a.user_id === userId; }).sort(byTime("assessed_at"));
    if (!as.length) return null;
    var f = as[0], l = as[as.length - 1];
    var sigs = S.signals.filter(function (g) { return g.user_id === userId; }).sort(byTime("created_at"));
    var sg = sigs[sigs.length - 1] || null;
    var meds = S.meds.filter(function (x) { return x.user_id === userId && x.active !== false; }).map(function (x) {
      return { inn: x.inn, brand_text: x.brand_text || null, dose_text: x.dose_text || null, freq_text: x.freq_text || null, frid_group: x.frid_group, frid_level: x.frid_level, confirmed_by: x.confirmed_by, source: x.source || "manual" }; });
    var fd = l.falls_detail || {}, hd = l.home_detail || {}, md = l.meds_detail || {}, sgate = l.safety_gate || {};
    var lv = sg ? sg.level : ({ 1: "stable", 2: "watch", 3: "decline", 4: "urgent" }[l.tier] || "watch");
    var alone = !!(hd.alone || sgate.alone);
    /* ท่าทรงตัว: จากคะแนนย่อย 0–3 = จำนวนท่าที่ผ่าน */
    var passed = l.parts && l.parts.balance != null ? +l.parts.balance : null;
    var stages = null;
    if (passed !== null) {
      stages = [0, 1, 2, 3].map(function (i) {
        var nm = ["เท้าชิดกัน", "กึ่งต่อเท้า", "ต่อเท้าเป็นเส้นตรง", "ยืนขาเดียว"][i];
        if (i === 3 && alone) return { stage: nm, held: 0, pass: false, attempts: 0, skipped: "alone", reason: "ไม่ได้ทำ — ทำคนเดียว ท่ายืนขาเดียวต้องมีผู้ดูแลอยู่ข้าง ๆ ตาม STEADI", decidedBy: "system-safety" };
        if (i < passed) return { stage: nm, held: 10, pass: true, attempts: 1, decidedBy: "human" };
        if (i === passed) return { stage: nm, held: [4, 6, 7, 5][i], pass: false, attempts: 1, decidedBy: "human" };
        return { stage: nm, held: 0, pass: false, attempts: 0, skipped: "stopped", reason: "หยุดหลังท่าก่อนหน้าไม่ผ่าน" };
      });
    }
    var tug = l.tug_seconds != null ? +l.tug_seconds : null;
    var hazards = hd.hazards || HAZ_ORDER.slice(0, Math.max(0, +hd.count || 0));
    var bar = { 2: 20, 1: 17, 0: 13 }[l.parts && l.parts.adl] ; if (l.adl_text) { var mb = /(\d+)\/20/.exec(l.adl_text); if (mb) bar = +mb[1]; }
    var pharm = [];
    S.refs.filter(function (r) { return r.user_id === userId && r.destination === "pharmacist" && r.review && r.review.form && r.review.form.problems; })
      .sort(byTime("reviewed_at", true)).slice(0, 1).forEach(function (r) { pharm = r.review.form.problems; });
    return {
      v: 2, built_at: iso(Date.now()), consent: { assessment: true },
      screen: { fell: (+fd.falls12m || 0) > 0, unsteady: lv === "decline" || lv === "urgent", worried: lv === "urgent" || !!fd.injured },
      falls: { count: fd.falls12m != null ? +fd.falls12m : null, when: fd.falls12m ? 1 : null, injury: fd.injured ? 2 : 0, loc: fd.unconscious ? 2 : 0, getup: fd.cannot_rise ? 3 : 0 },
      symptoms: { faint: (l.meds_detail && l.meds_detail.ortho) ? 2 : 0, chest: 0, stroke: 0, injury: 0, helper: alone ? 1 : 0 },
      meds: { n: md.n != null ? +md.n : meds.length, high: meds.filter(function (x) { return x.frid_level === 2; }).length || (+md.high || 0), mod: meds.filter(function (x) { return x.frid_level === 1; }).length,
        items: meds, symptoms: md.symptoms || (md.high ? ["drowsy"] : []), changed: md.changed || [] },
      medications: meds,
      mobility: { ftsst_first: f.ftsst_seconds, ftsst_last: l.ftsst_seconds, tug_first: f.tug_seconds, tug_last: l.tug_seconds, first_at: f.assessed_at, last_at: l.assessed_at,
        n_assessments: as.length, reps: l.reps || 5, cadence_cv: l.cadence_cv,
        tug: tug == null ? {} : { out: Math.round(tug * 0.48 * 10) / 10, back: Math.round(tug * 0.52 * 10) / 10, distance_ok: l.method === "camera_aruco", turn_by: "marker", ended_by: "gesture", reach: 1, drift: 0.12, reaction: 0.9 } },
      balance: passed === null ? {} : { passed: passed, label: ["ผ่าน 0 ท่า", "ผ่าน 1 ท่า", "ผ่าน 2 ท่า", "ผ่าน 3 ท่า", "ผ่านครบ"][passed] || "", stages: stages, alone_skip: alone },
      adl: { first: f.parts ? f.parts.adl : null, last: l.parts ? l.parts.adl : null, barthel_total: bar != null ? bar : null, barthel_sf: null, barthel_band: bar == null ? null : bar >= 19 ? "ทำเองได้" : bar >= 15 ? "พึ่งพาบางส่วน" : "พึ่งพามาก" },
      home: { hazards: hazards, helper: alone ? "alone" : (hazards.length >= 2 ? "day" : "full"), count: hazards.length, alone: alone },
      quality: { method: l.method, identity_verified: !!l.identity_verified, not_tested: !!l.not_tested, safety_verdict: { safe: sgate.ok !== false, reds: [], alone: alone, urgent: false } },
      risk: { tier: l.tier, score: l.score, max: 12, level: lv, flags: sg ? sg.flags : [], next_days: sg ? sg.next_days : null },
      pharm_recs: pharm,
      open_followups: S.fups.filter(function (x) { return x.user_id === userId && x.status === "pending"; }).length,
      open_referrals: S.refs.filter(function (x) { return x.user_id === userId && ["outcome_recorded", "declined"].indexOf(x.status) < 0; }).length
    };
  }

  function build() {
    var r = rng(20260919), BE = new Date().getFullYear() + 543;
    var S = { v: 1, members: [], assess: [], signals: [], cases: [], refs: [], medrev: [], meds: [], unknown: [],
      fups: [], plans: [], contacts: [], events: [], audit: [], invites: [], access: [], sessions: [] };
    /* ระดับล่าสุดของ 40 คน: 24 คงที่ · 8 เฝ้าสังเกต · 5 ถดถอย · 3 เร่งด่วน (คนแรก ๆ คือเคสเดโม) */
    var LV = ["decline", "urgent", "watch", "decline", "watch", "urgent", "watch", "decline", "watch", "urgent",
      "decline", "watch"];
    /* คนที่ 13–18 คือเคสที่ปิดแล้ว: ครั้งก่อนเฝ้าสังเกต ครั้งล่าสุดคงที่ = ระดับดีขึ้นหลังการดูแล */
    function improved(i) { return i >= 13 && i <= 18; }
    for (var i = 1; i <= 40; i++) {
      var age = 65 + Math.floor(r() * 21), lv = i <= LV.length ? LV[i - 1] : "stable";
      var m = { id: uuid(1, i), pseudonym: "DEMO-" + pad(i, 2), display_name: "สาธิต " + NAMES[i - 1],
        phone: "080000" + pad(i, 4), carer_phone: (i % 3 === 0) ? "089000" + pad(i, 4) : null,
        role: "user", birth_year_be: BE - age, birth_month: 1 + Math.floor(r() * 12), sex: (i % 2) ? "f" : "m",
        province: PROV[i % PROV.length], share_pool: i !== 39 && i !== 40, username: null, must_set_password: false,
        created_at: ago(24 * (100 + Math.floor(r() * 60))), level: lv };
      S.members.push(m);
      /* ผลประเมิน 1–3 ครั้ง ย้อนหลังไม่เกิน 100 วัน ค่าตามระดับ */
      var n = improved(i) ? 2 : 1 + Math.floor(r() * 3), base = { stable: 9.4, watch: 11.2, decline: 12.6, urgent: 14.8 }[lv];
      var tbase = { stable: 9.0, watch: 11.0, decline: 12.8, urgent: 15.5 }[lv];
      for (var k = 0; k < n; k++) {
        var daysAgo = [95, 50, 4][3 - n + k] + Math.floor(r() * 3), last = (k === n - 1);
        var drift = (n - 1 - k) * (lv === "stable" ? 0.1 : -0.9);   /* ครั้งเก่ากว่าดีกว่า = ถดถอย */
        var ft = Math.round((base + drift + (r() - 0.5)) * 10) / 10, tg = Math.round((tbase + drift * 0.8 + (r() - 0.5)) * 10) / 10;
        var score = { stable: 11, watch: 9, decline: 7, urgent: 4 }[lv] + (last ? 0 : 1), tier = { stable: 1, watch: 2, decline: 3, urgent: 4 }[lv];
        var a = { id: uuid(2, i * 10 + k), user_id: m.id, assessed_at: ago(24 * daysAgo), method: "camera_aruco",
          ftsst_seconds: ft, tug_seconds: tg, reps: 5, cadence_cv: Math.round(r() * 0.2 * 1e4) / 1e4, score: Math.min(12, score), score_max: 12, tier: tier,
          parts: (function () { var P = { stable: [3, 3, 3, 1, 1], watch: [2, 2, 3, 1, 1], decline: [2, 1, 2, 1, 1], urgent: [1, 1, 1, 1, 0] }[lv]; return { ftsst: Math.min(3, P[0] + (last ? 0 : 1)), balance: P[1], falls: P[2], meds: P[3], adl: P[4] }; })(),
          falls_detail: { falls12m: lv === "urgent" ? 2 : (lv === "decline" && i % 2 ? 1 : 0), injured: lv === "urgent" && i % 2 === 0, unconscious: false, cannot_rise: lv === "urgent" },
          meds_detail: { n: i % 4 + 1, high: (i % 5 === 1) ? 1 : 0 }, home_detail: { count: i % 4, alone: i % 6 === 0 },
          safety_gate: { ok: true }, not_tested: false, engine_version: "2.1.0", identity_verified: true, created_at: ago(24 * daysAgo) };
        S.assess.push(a);
        var ks = (lv === "stable" && !(improved(i) && !last)) ? [] : (lv === "urgent" ? ["S2", "S4", "S7"] : (lv === "decline" ? ((i % 5 === 1) ? ["S3", "S4"] : ["S4", "S5"]) : ((i % 3 === 0) ? ["S3"] : ["S5"])));
        if (lv === "stable" && improved(i) && !last) ks = ["S5"];
        S.signals.push({ id: uuid(3, i * 10 + k), user_id: m.id, assessment_id: a.id, level: last ? lv : ((lv === "stable" && !improved(i)) ? "stable" : "watch"),
          flags: ks.map(function (x) { return { id: x === "S3" ? "B13" : "B9", text: SIG[x].nm }; }),
          signals: ks.map(sig), next_days: NEXT_DAYS[lv], engine_version: "2.1.0", created_at: ago(24 * daysAgo) });
      }
    }
    /* เคส 12 ราย กระจายทุกขั้นของวงจร — คนแรกคือเคสที่ใช้เดินเดโมสด */
    var CASES = [
      [1, "new", 20, null, 0, false, "ทบทวนสัญญาณและติดต่อครอบครัวภายใน 48 ชม."],
      [2, "new", 30, null, 0, false, "ติดต่อด่วน · หกล้มซ้ำและมีธงแดง"],
      [3, "reviewing", 40, null, 0, false, "ทบทวนรายการยากับเภสัชกร"],
      [4, "contacted", 60, 50, 1, false, "นัดวันโทรยืนยันแผนกับครอบครัว"],
      [5, "care_plan_agreed", 90, 80, 1, false, "ติดตามการฝึกลุกนั่งสัปดาห์ที่ 2"],
      [6, "referred", 100, 92, 2, false, "รอผลจากแพทย์"],
      [7, "referred", 70, 60, 1, false, "รอผลจากนักกายภาพบำบัด"],
      [8, "appointment_booked", 130, 120, 2, false, "ยืนยันว่าไปตามนัด 12 ก.ย."],
      [9, "service_completed", 200, 190, 3, false, "บันทึกผลหลังรับบริการ"],
      [10, "contacted", 96, null, 3, true, "ติดต่อไม่ได้ 3 ครั้ง · ลองผ่านครอบครัว"],
      [11, "contacted", 160, 150, 2, false, "ปรับแผนตามผลทบทวนของนักกายภาพบำบัด"],
      [12, "referred", 110, 100, 1, false, "รอพยาบาลประเมินภาวะพึ่งพิง"]
    ];
    CASES.forEach(function (c, ix) {
      var m = S.members[c[0] - 1], lvl = m.level, opened = NOW - c[2] * H;
      var lastSig = S.signals.filter(function (s) { return s.user_id === m.id; }).pop();
      S.cases.push({ id: uuid(4, c[0]), user_id: m.id, risk_signal_id: lastSig.id, level: lvl, signals: lastSig.signals,
        status: c[1], assigned_to: (c[1] === "new") ? null : staffOf("care_manager").id, sla_hours: SLA[lvl],
        opened_at: iso(opened), due_at: iso(opened + SLA[lvl] * H), contacted_at: c[3] == null ? null : ago(c[3]),
        attempts: c[4], unreachable: c[5], next_action: c[6], closed_at: null, close_reason: null, note: null, updated_at: ago(Math.min(c[2], 3)) });
    });
    /* เคสที่ปิดแล้ว 6 ราย (คงที่หลังดูแล) — ให้ตัวเลขผลลัพธ์มีตัวหาร */
    for (var j = 13; j <= 18; j++) {
      var mm = S.members[j - 1];
      S.cases.push({ id: uuid(4, j), user_id: mm.id, risk_signal_id: null, level: "watch", signals: [sig("S5")], status: "stable",
        assigned_to: staffOf("care_manager").id, sla_hours: 72, opened_at: ago(24 * 70), due_at: ago(24 * 67), contacted_at: ago(24 * 69),
        attempts: 1, unreachable: false, next_action: null, closed_at: ago(24 * 30), close_reason: "ผลประเมินซ้ำดีขึ้น ครอบครัวยืนยันทำตามแผน", note: null, updated_at: ago(24 * 30) });
    }
    /* รายการส่งต่อ 6 รายการ ครบทุกสถานะ */
    function pkg(m) { return pkgV2(S, m.id); }
    var REFS = [
      [3, "pharmacist", "pending", 30, "ทบทวนรายการยา 4 รายการ มียากลุ่มเสี่ยงสูง 1 รายการ", ["ยารายการใดควรทบทวนกับแพทย์ผู้สั่งยา", "มีปฏิกิริยาระหว่างยาที่เพิ่มความเสี่ยงหกล้มหรือไม่"], null],
      [7, "physio", "acknowledged", 60, "ประเมินการเดินและโปรแกรมฝึกกำลังขา", ["ควรเริ่มโปรแกรมฝึกแบบใด", "ต้องใช้อุปกรณ์ช่วยเดินหรือไม่"], null],
      [6, "doctor", "booked", 95, "ทบทวนสาเหตุการล้มซ้ำและภาวะหมดสติ", ["การล้มครั้งล่าสุดมีสาเหตุจากหัวใจหรือระบบประสาทหรือไม่"], null],
      [11, "physio", "review_returned", 150, "ประเมินการทรงตัวและกำหนดโปรแกรมฝึก", ["ท่าใดที่ควรฝึกก่อน"], { finding: "ยืนต่อเท้าได้ 6 วินาที กำลังกล้ามเนื้อขาซ้ายอ่อนกว่าขวา", recommend: "ฝึกลุกนั่งจากเก้าอี้ 10 ครั้ง × 3 รอบ วันเว้นวัน และฝึกยืนต่อเท้าจับโต๊ะ", next_step: "ติดตามตามแผนดูแล", note: "นัดประเมินซ้ำ 4 สัปดาห์" }],
      [12, "nurse", "outcome_recorded", 105, "ประเมินภาวะพึ่งพิงและวางแผนร่วมกับครอบครัว", ["ครอบครัวต้องการอุปกรณ์ช่วยอะไรบ้าง"], { finding: "ต้องการราวจับห้องน้ำและเก้าอี้อาบน้ำ", recommend: "ประสานหน่วยบริการปฐมภูมิติดตั้งราวจับ", next_step: "ข้อมูลเพียงพอ ไม่ต้องทำเพิ่ม", note: null }],
      [9, "physio", "completed", 195, "โปรแกรมฝึกกำลังขาและการทรงตัว 6 สัปดาห์", ["ผลหลังฝึกเป็นอย่างไร"], null]
    ];
    REFS.forEach(function (x, ix) {
      var m = S.members[x[0] - 1], created = NOW - x[3] * H, lvl = m.level;
      var row = { id: uuid(5, ix + 1), user_id: m.id, case_id: uuid(4, x[0]), risk_signal_id: null, level: lvl, destination: x[1],
        action: x[4], sla: "ตามระดับความเร่งด่วน", reasons: (S.signals.filter(function (s) { return s.user_id === m.id; }).pop() || { flags: [] }).flags,
        questions: x[5], status: x[2], reply_due: iso(created + 48 * H), package: null,
        assigned_to: (x[2] === "pending") ? null : staffOf(x[1]).id, decided_by: null, decided_at: null, decision_note: null,
        acknowledged_at: (x[2] === "pending") ? null : iso(created + 5 * H), booked_at: (x[2] === "booked" || x[2] === "completed" || x[2] === "outcome_recorded") ? iso(created + 20 * H) : null,
        completed_at: (x[2] === "completed" || x[2] === "outcome_recorded") ? iso(created + 60 * H) : null, completed_note: null,
        outcome: (x[2] === "outcome_recorded") ? { result: "improved", recorded_at: iso(created + 62 * H) } : null,
        review: x[6], reviewed_at: x[6] ? iso(created + 30 * H) : null, created_at: iso(created) };
      S.refs.push(row);
    });
    /* ยาและการทบทวนยา */
    function med(n, uid, inn, brand, group, lv, dose, by) {
      S.meds.push({ id: uuid(6, n), user_id: uid, inn: inn, brand_text: brand, dose_text: dose, freq_text: "วันละครั้ง", atc: null,
        frid_group: group, frid_level: lv, purpose: null, source: "ocr", ocr_text: brand, match_conf: 0.91, photo_path: null,
        confirmed_by: by || "user", reviewed_at: null, reviewed_by: null, review_note: null, active: true, created_at: ago(24 * 6), updated_at: ago(24 * 6) });
    }
    var m1 = S.members[0], m3 = S.members[2], m6 = S.members[5];
    med(1, m1.id, "lorazepam", "ยานอนหลับ (สาธิต)", "bzd", 2, "0.5 มก. ก่อนนอน");
    med(2, m1.id, "amlodipine", "ยาความดัน (สาธิต)", "antihtn", 1, "5 มก. เช้า");
    med(3, m1.id, "metformin", "ยาเบาหวาน (สาธิต)", "none", 0, "500 มก. เช้า-เย็น");
    med(4, m1.id, null, "ยาสมุนไพรตราสาธิต", "unknown", null, "1 แคปซูล");
    med(5, m3.id, "zolpidem", "ยานอนหลับ (สาธิต)", "bzd", 2, "10 มก. ก่อนนอน");
    med(6, m3.id, "furosemide", "ยาขับปัสสาวะ (สาธิต)", "diuretic", 1, "40 มก. เช้า");
    med(7, m3.id, "amitriptyline", "ยาซึมเศร้า (สาธิต)", "antidep", 2, "10 มก. ก่อนนอน");
    med(8, m3.id, "simvastatin", "ยาไขมัน (สาธิต)", "none", 0, "20 มก. ก่อนนอน");
    med(9, m6.id, "losartan", "ยาความดัน (สาธิต)", "antihtn", 1, "50 มก. เช้า", "pharmacist");
    S.medrev.push({ id: uuid(7, 1), user_id: m1.id, case_id: uuid(4, 1), referral_id: null, requested_at: ago(24 * 5), reason: "ใช้ยากลุ่มเสี่ยงสูง 1 รายการ และมียาที่ระบบไม่รู้จัก",
      summary: { high: 1, mod: 1, unknown: 1, total: 4 }, status: "pending", reviewed_at: null, reviewed_by: null, outcome: null, recommend: null });
    S.medrev.push({ id: uuid(7, 2), user_id: m3.id, case_id: uuid(4, 3), referral_id: uuid(5, 1), requested_at: ago(30), reason: "ใช้ยาตั้งแต่ 4 รายการ และยากลุ่มเสี่ยงสูง 2 รายการ",
      summary: { high: 2, mod: 1, unknown: 0, total: 4 }, status: "pending", reviewed_at: null, reviewed_by: null, outcome: null, recommend: null });
    S.medrev.push({ id: uuid(7, 3), user_id: m6.id, case_id: uuid(4, 6), referral_id: null, requested_at: ago(24 * 9), reason: "เพิ่งปรับยาแล้วมีอาการเวียนศีรษะ",
      summary: { high: 0, mod: 1, unknown: 0, total: 1 }, status: "done", reviewed_at: ago(24 * 8), reviewed_by: staffOf("pharmacist").id, outcome: "consult_doctor", recommend: "แนะนำแพทย์ทบทวนขนาดยาความดัน" });
    S.unknown.push({ id: uuid(8, 1), user_id: m1.id, medication_id: uuid(6, 4), label_text: "ยาสมุนไพรตราสาธิต บำรุงร่างกาย", guess_name: "ยาสมุนไพรตราสาธิต",
      photo_path: null, registry_hits: null, status: "pending", created_at: ago(24 * 5), profiles: null });
    /* แผนดูแล การติดตาม การติดต่อ เหตุการณ์ */
    [5, 9, 11, 4, 8].forEach(function (n, ix) {
      var m = S.members[n - 1];
      S.plans.push({ id: uuid(10, n), user_id: m.id, assessment_id: null, level: m.level, items: [{ id: "P1", nm: "ฝึกลุกนั่งจากเก้าอี้แบบเพิ่มระดับ", done: ix % 2 === 0 }, { id: "P3", nm: "สำรวจจุดเสี่ยงในบ้าน", done: false }], due_at: ahead(24 * 14), created_at: ago(24 * 20) });
      S.fups.push({ id: uuid(11, n * 2), user_id: m.id, plan_id: uuid(10, n), kind: "โทรติดตามการฝึก", due_at: ix < 2 ? ago(6) : ahead(24 * 3), status: ix === 4 ? "done" : "pending", done_at: ix === 4 ? ago(24) : null, note: null });
      S.fups.push({ id: uuid(11, n * 2 + 1), user_id: m.id, plan_id: uuid(10, n), kind: "นัดประเมินซ้ำ", due_at: ahead(24 * NEXT_DAYS[m.level]), status: "pending", done_at: null, note: null });
    });
    var CON = [[4, "phone", "reached", "ครอบครัวรับสาย ยินดีให้ติดตาม", 50], [5, "phone", "plan_confirmed", "ลูกสาวยืนยันจะช่วยฝึกทุกเย็น", 80], [6, "phone", "referred_ok", "ส่งพบแพทย์ รพ.สาธิต", 92],
      [8, "phone", "booked", "นัด 12 ก.ย. 09:00", 120], [10, "phone", "no_answer", "ไม่รับสาย", 90], [10, "phone", "no_answer", "ไม่รับสาย", 66], [10, "line", "no_answer", "ส่งข้อความแล้วไม่ตอบ", 40],
      [11, "phone", "reached", "รับทราบผลจากนักกายภาพ", 150], [9, "visit", "referred_ok", "เยี่ยมบ้านหลังจบโปรแกรม", 190]];
    CON.forEach(function (c, ix) { S.contacts.push({ id: uuid(12, ix + 1), case_id: uuid(4, c[0]), user_id: S.members[c[0] - 1].id, by_staff: staffOf("care_manager").id, channel: c[1], result: c[2], note: c[3], created_at: ago(c[4]) }); });
    var EV = [[2, "fall", "high", 36], [6, "fall", "high", 24 * 5], [10, "near_fall", "medium", 24 * 3], [4, "near_fall", "low", 24 * 8], [2, "hospital", "high", 30], [6, "med_change", "medium", 24 * 4], [21, "fall", "medium", 24 * 40]];
    EV.forEach(function (e, ix) { S.events.push({ id: uuid(13, ix + 1), user_id: S.members[e[0] - 1].id, reporter_id: null, kind: e[1], detail: { by: "family", memberId: S.members[e[0] - 1].id }, severity: e[2], created_at: ago(e[3]), handled_at: null }); });
    /* รหัสเชิญและบันทึกตรวจสอบตั้งต้น */
    S.invites.push({ id: uuid(14, 1), username: "demo.nurse2", role: "nurse", display_name: "สาธิต พยาบาล 2", note: "หอผู้ป่วยอายุรกรรม", code_hint: "DEMO", created_at: ago(24 * 2), expires_at: ahead(24 * 28), used_at: null, revoked_at: null, status: "open" });
    S.invites.push({ id: uuid(14, 2), username: "demo.physio", role: "physio", display_name: "สาธิต นักกายภาพบำบัด", note: null, code_hint: "DEMO", created_at: ago(24 * 40), expires_at: ago(24 * 10), used_at: ago(24 * 39), revoked_at: null, status: "used" });
    var AUD = [["care_manager", "worklist.view", "เปิดคิวงาน 12 เคส", 2], ["care_manager", "contact.log", "บันทึกการติดต่อ: reached · ครอบครัวรับสาย", 50], ["pharmacist", "med.review_done", "เภสัชกรปิดการทบทวนยา · แนะนำแพทย์ทบทวนขนาดยาความดัน", 24 * 8],
      ["physio", "referral.update", "การส่งต่อเปลี่ยนสถานะเป็น review_returned", 120], ["admin", "invite.issue", "ออกรหัสให้ demo.nurse2 บทบาท nurse", 24 * 2], ["care_manager", "case.open", "เปิดดูรายละเอียดเคส", 5],
      ["insurer", "outcomes.view", "เปิดดูรายงานผลลัพธ์เชิงกลุ่ม", 24], ["doctor", "access.request", "ขอความยินยอมเปิดดูข้อมูลคลินิก", 26], ["care_manager", "referral.create", "ส่งต่อไปยัง physio · ประเมินการเดิน", 60]];
    AUD.forEach(function (a, ix) { var st = staffOf(a[0]); S.audit.push({ id: uuid(15, ix + 1), actor_id: st.id, actor_role: a[0], actor_name: st.display_name, action: a[1], subject_id: null, detail: a[2], meta: { demo: true }, created_at: ago(a[3]) }); });
    /* ============================================================
       เคสเดินเรื่อง DEMO-41 — คนเดียวเดินครบวงจรตั้งแต่ต้นจนจบ
       ------------------------------------------------------------
       ใช้กับหน้า CareSignal-Journey.html และปรากฏในคอนโซลทุกบทบาท
       เป็นคนเดียวกัน: อยู่ในคิวงานของผู้ประสานงาน มีใบส่งต่อถึงแพทย์
       เภสัชกร นักกายภาพบำบัด พยาบาล ครบสี่ใบพร้อมผลกลับ และเป็น 1 ราย
       ที่ "ดีขึ้น" ในตัวเลขของบริษัทประกัน (ถดถอย → เฝ้าสังเกต)
       เวลาทั้งหมดนับถอยหลังจากวันนี้ วันที่ 0 = ลูกสาวแจ้งเหตุเมื่อ 44 วันก่อน
       ============================================================ */
    /* ใบส่งต่อที่เพาะไว้ต้องมีชุดข้อมูลรุ่น 2 เหมือนของจริง — สร้างตอนนี้ที่ยาและสัญญาณครบแล้ว */
    S.refs.forEach(function (r) { if (!r.package) r.package = pkgV2(S, r.user_id); });
    (function flagship() {
      var m = { id: uuid(1, 41), pseudonym: "DEMO-41", display_name: "สาธิต บุญเรือน", phone: "0800000041", carer_phone: "0890000041",
        role: "user", birth_year_be: BE - 74, birth_month: 3, sex: "f", province: "เชียงใหม่", share_pool: true, username: null,
        must_set_password: false, created_at: ago(24 * 60), level: "watch", flagship: true };
      S.members.push(m);
      /* วันที่ 0 · ลูกสาวแจ้งเหตุล้มในห้องน้ำ */
      S.events.push({ id: uuid(13, 20), user_id: m.id, reporter_id: null, kind: "fall", detail: { by: "family", memberId: m.id, place: "ห้องน้ำ", time: "กลางคืน" }, severity: "medium", created_at: ago(24 * 44), handled_at: ago(24 * 42) });
      /* วันที่ 2 · ประเมินครั้งที่ 1 — คะแนน 5/12 ระดับถดถอย */
      S.assess.push({ id: uuid(2, 410), user_id: m.id, assessed_at: ago(24 * 42), method: "camera_aruco", ftsst_seconds: 14.1, tug_seconds: 15.2, reps: 5, cadence_cv: 0.183,
        score: 5, score_max: 12, tier: 3, parts: { ftsst: 1, balance: 1, falls: 2, meds: 0, adl: 1 },
        falls_detail: { falls12m: 1, injured: false, unconscious: false, cannot_rise: false },
        meds_detail: { n: 4, high: 1 }, home_detail: { count: 3, alone: true },
        balance_text: "เท้าชิดผ่าน · กึ่งต่อเท้าผ่าน · ต่อเท้า 6 วินาที ไม่ผ่าน · ขาเดียวไม่ทดสอบ (อยู่คนเดียว)", adl_text: "ต้องมีคนช่วยอาบน้ำ 17/20",
        safety_gate: { ok: true, alone: true }, not_tested: false, engine_version: "2.1.0", identity_verified: true, created_at: ago(24 * 42) });
      var k1 = ["S1", "S3", "S4", "S6"];
      S.signals.push({ id: uuid(3, 410), user_id: m.id, assessment_id: uuid(2, 410), level: "decline",
        flags: [{ id: "B7", text: "หกล้มครั้งใหม่ใน 12 เดือน" }, { id: "B13", text: "ยากลุ่มเสี่ยงสูง 1 รายการ และยาที่ระบุตัวไม่ได้ 1 รายการ" }, { id: "B9", text: "ลุกนั่ง 5 ครั้ง 14.1 วินาที เกินเกณฑ์อายุ 12.1" }, { id: "B11", text: "ต้องมีคนช่วยอาบน้ำ" }],
        signals: k1.map(sig), next_days: 21, engine_version: "2.1.0", created_at: ago(24 * 42) });
      /* ยา 4 รายการที่ถ่ายฉลาก — ยานอนหลับถูกหยุดตามแผนแพทย์ในภายหลัง */
      med(10, m.id, "lorazepam", "ยานอนหลับ (สาธิต)", "bzd", 2, "0.5 มก. ก่อนนอน");
      med(11, m.id, "amlodipine", "ยาความดัน (สาธิต)", "antihtn", 1, "5 มก. เช้า");
      med(12, m.id, "metformin", "ยาเบาหวาน (สาธิต)", "none", 0, "500 มก. เช้า-เย็น");
      med(13, m.id, null, "ยาสมุนไพรตราสาธิต", "unknown", null, "1 แคปซูล");
      /* ชุดข้อมูล ณ เวลาส่ง (วันที่ 2) — ยายังใช้อยู่ครบ 4 รายการ ก่อนแพทย์หยุด lorazepam ในวันที่ 38 */
      var flagPkg = pkgV2(S, m.id);
      S.meds.forEach(function (x) { if (x.id === uuid(6, 10)) { x.active = false; x.reviewed_at = ago(24 * 6); x.reviewed_by = staffOf("doctor").id; x.review_note = "หยุดตามแผนแพทย์ ลดครึ่งหนึ่ง 2 สัปดาห์แล้วหยุด"; x.updated_at = ago(24 * 6); } });
      /* เคส — เปิดอัตโนมัติ ติดต่อได้ใน 20 ชั่วโมง ตอนนี้รับบริการครบ รอปิด */
      S.cases.push({ id: uuid(4, 41), user_id: m.id, risk_signal_id: uuid(3, 410), level: "decline", signals: k1.map(sig), status: "service_completed",
        assigned_to: staffOf("care_manager").id, sla_hours: 48, opened_at: ago(24 * 42), due_at: ago(24 * 40), contacted_at: ago(24 * 42 - 20), attempts: 1, unreachable: false,
        next_action: "ยืนยันกับครอบครัวแล้วปิดเคส · นัดประเมินซ้ำ 45 วัน", closed_at: null, close_reason: null, note: "เคสเดินเรื่องสำหรับเดโม", updated_at: ago(24 * 4) });
      var CTF = [[24 * 42 - 20, "phone", "reached", "ลูกสาวรับสาย เล่าว่าล้มในห้องน้ำกลางคืน ยินยอมส่งข้อมูลถึงผู้เชี่ยวชาญ"],
        [24 * 40 + 2, "phone", "plan_confirmed", "ตกลงแผนเบื้องต้น: ไม่เข้าห้องน้ำคนเดียวตอนกลางคืนจนกว่าจะติดราวจับ"],
        [24 * 31, "phone", "plan_confirmed", "รวมผลจากผู้เชี่ยวชาญสี่คน ตกลงแผนดูแล 5 ข้อกับลูกสาว"],
        [24 * 24, "phone", "reached", "ฝึกลุกนั่งได้วันเว้นวัน ราวจับติดตั้งแล้ว"],
        [24 * 17, "phone", "reached", "ลดยานอนหลับตามแพทย์ นอนหลับได้ ไม่เวียนศีรษะ"],
        [24 * 10, "phone", "reached", "ไม่มีล้มหรือเกือบล้มตลอด 3 สัปดาห์ นัดประเมินซ้ำ"]];
      CTF.forEach(function (c, ix) { S.contacts.push({ id: uuid(12, 20 + ix), case_id: uuid(4, 41), user_id: m.id, by_staff: staffOf("care_manager").id, channel: c[1], result: c[2], note: c[3], created_at: ago(c[0]) }); });
      /* ส่งต่อ 4 ทางในวันที่ 4 — ผลกลับครบ และบันทึกผลหลังรับบริการแล้วทุกใบ */
      var made = NOW - 24 * 40 * H;
      var RF = [
        ["pharmacist", 7, 3, null, 24 * 37, 24 * 37, "ทบทวนยา 4 รายการ มียานอนหลับกลุ่มเสี่ยงสูงและยาสมุนไพรที่ระบุตัวไม่ได้",
          ["ยารายการใดเพิ่มความเสี่ยงหกล้ม และควรทบทวนกับแพทย์ผู้สั่งยา", "ยาสมุนไพรที่อ่านฉลากไม่ได้ควรทำอย่างไร"],
          { finding: "ใช้ lorazepam 0.5 มก. ทุกคืนต่อเนื่อง 2 ปี ร่วมกับยาลดความดัน · ยาสมุนไพรระบุส่วนผสมไม่ได้", recommend: "เสนอแพทย์ผู้สั่งยาพิจารณาลด lorazepam แบบค่อยเป็นค่อยไป ไม่หยุดทันที · ทบทวนเวลาให้ยาความดัน · หยุดยาสมุนไพรจนกว่าจะทราบส่วนผสม", next_step: "refer_doctor", note: "ไม่พบปฏิกิริยาระหว่างยาที่ต้องหยุดฉุกเฉิน" },
          { result: "improved", recorded_at: ago(24 * 33), note: "แพทย์รับเรื่องต่อและปรับแผนยาแล้ว" }],
        ["doctor", 8, 6, 24 * 35, 24 * 33, 24 * 33, "ทบทวนสาเหตุการล้มครั้งใหม่ และแผนยาตามที่เภสัชกรเสนอ",
          ["การล้มมีสาเหตุจากความดัน หัวใจ หรือระบบประสาทหรือไม่", "ควรลดยานอนหลับอย่างไร"],
          { finding: "ความดันตกเมื่อลุกยืน 24/10 มม.ปรอท · ไม่มีอาการทางหัวใจ · ไม่มีสัญญาณระบบประสาท · การล้มสัมพันธ์กับลุกเข้าห้องน้ำกลางคืนหลังกินยานอนหลับ", recommend: "ลด lorazepam ลงครึ่งหนึ่ง 2 สัปดาห์แล้วหยุด · ย้ายยาความดันเป็นก่อนนอน · ลุกจากเตียงช้า ๆ นั่งขอบเตียง 1 นาทีก่อนยืน", next_step: "follow_plan", note: "นัดติดตาม 4 สัปดาห์" },
          { result: "improved", recorded_at: ago(24 * 6), note: "หยุดยานอนหลับได้ ไม่มีอาการเวียนศีรษะ" }],
        ["physio", 9, 5, 24 * 36, 24 * 6, 24 * 34, "ประเมินกำลังขาและการทรงตัว กำหนดโปรแกรมฝึกที่บ้าน",
          ["ควรเริ่มโปรแกรมฝึกแบบใด", "ต้องใช้อุปกรณ์ช่วยเดินหรือไม่"],
          { finding: "ลุกนั่ง 5 ครั้ง 14.1 วินาที · ยืนต่อเท้าได้ 6 วินาที · กำลังขาซ้ายอ่อนกว่าขวา · เดินความเร็วปกติ ไม่ต้องใช้อุปกรณ์ช่วยเดิน", recommend: "ฝึกลุกนั่งจากเก้าอี้ 10 ครั้ง × 3 รอบ วันเว้นวัน · ยืนต่อเท้าจับโต๊ะ 30 วินาที × 3 · เดินยกเข่าในบ้าน 5 นาทีทุกวัน นาน 4 สัปดาห์", next_step: "follow_plan", note: "สอนลูกสาวให้ดูท่าและนับครั้ง" },
          { result: "improved", recorded_at: ago(24 * 5), note: "ทำครบ 4 สัปดาห์ ลุกนั่งเร็วขึ้น 2.5 วินาที" }],
        ["nurse", 10, 4, 24 * 34, 24 * 32, 24 * 32, "ประเมินภาวะพึ่งพิงและความปลอดภัยในบ้าน วางแผนร่วมกับครอบครัว",
          ["ครอบครัวต้องการอุปกรณ์ช่วยอะไรบ้าง", "ช่วงเวลาไหนที่ไม่มีคนอยู่ด้วย"],
          { finding: "ต้องมีคนช่วยอาบน้ำ · พื้นห้องน้ำลื่นไม่มีราวจับ · ไม่มีไฟทางเดินกลางคืน · ลูกสาวอยู่ด้วยเฉพาะช่วงเย็น", recommend: "ติดราวจับข้างชักโครกและในที่อาบน้ำ · เก้าอี้อาบน้ำ · ไฟกลางคืนแบบเซ็นเซอร์ · ให้ลูกสาวช่วยอาบน้ำช่วงเย็น", next_step: "sufficient", note: "ประสานหน่วยบริการปฐมภูมิติดตั้งอุปกรณ์" },
          { result: "improved", recorded_at: ago(24 * 30), note: "ติดตั้งราวจับ เก้าอี้อาบน้ำ และไฟกลางคืนแล้ว" }]
      ];
      RF.forEach(function (x) {
        S.refs.push({ id: uuid(5, x[1]), user_id: m.id, case_id: uuid(4, 41), risk_signal_id: uuid(3, 410), level: "decline", destination: x[0],
          action: x[6], sla: "ตามระดับความเร่งด่วน", reasons: S.signals[S.signals.length - 1].flags, questions: x[7], status: "outcome_recorded",
          reply_due: iso(made + 48 * H), package: flagPkg, assigned_to: staffOf(x[0]).id, decided_by: null, decided_at: null, decision_note: null,
          acknowledged_at: iso(made + x[2] * H), booked_at: x[3] == null ? null : ago(x[3]), completed_at: ago(x[4]), completed_note: null,
          outcome: x[9], review: x[8], reviewed_at: ago(x[5]), created_at: iso(made) });
      });
      /* แบบฟอร์มตอบกลับตามวิชาชีพ (โครง CDC STEADI) ของเคสเดินเรื่อง */
      var DEMO_FORM = {
        pharmacist: { v: 2, dest: "pharmacist", verdict: "advised", urgency: "h72", follow_date: null, need_doctor: true,
          factors: { fell: true, worried: true, unsteady: true, ortho: true, poly: true, high: true }, eval_gait: true,
          problems: [{ med: "lorazepam", problem: "ยากลุ่มเสี่ยงสูงต่อการหกล้ม", recommend: "ทบทวนกับผู้สั่งใช้เรื่องลดขนาดหรือเปลี่ยนยา และเลี่ยงรับประทานกลางคืน" },
                     { med: "amlodipine", problem: "เวลารับประทานเพิ่มความเสี่ยงกลางคืน", recommend: "ปรึกษาผู้สั่งใช้เรื่องเลื่อนเวลาเป็นเช้า" }],
          educate: ["why", "timing", "watch", "rise"] },
        doctor: { v: 2, dest: "doctor", verdict: "confirm", urgency: "h72", follow_date: null, need_doctor: null,
          factors: { fell: true, worried: true, heart: false, cognitive: false, incont: false, depress: false, foot: false, other: false, psycho: true, opioid: false, sedate: true, hypot: true, tug12: true, chair: true, tandem: true, vision: null, ortho: true },
          plan: ["eval", "medrev", "pt", "ot"], contra: false, pharm_response: [{ i: 0, response: "accept" }, { i: 1, response: "accept" }] },
        physio: { v: 2, dest: "physio", verdict: "follow_up", urgency: "routine", follow_date: null, need_doctor: false,
          obs: ["slow", "short", "wall"], tug_re: 13.8, chair30: 8, aid: "ไม้เท้า 4 ขา", balance_re: [10, 10, 6, null], goal: "เข้าห้องน้ำกลางคืนได้เองอย่างปลอดภัย",
          programs: [{ name: "ฝึกทรงตัวและกำลังขาที่บ้าน (ชุดท่านั่ง-ยืน)", where: "ที่บ้าน มีลูกสาวอยู่ด้วย", when: "วันละ 15 นาที 5 วัน/สัปดาห์ · ไม่มีค่าใช้จ่าย" }],
          caution: "ต้องมีคนอยู่ข้าง ๆ ทุกครั้งที่ฝึกยืนขาเดียว หยุดเมื่อเวียนศีรษะ" },
        nurse: { v: 2, dest: "nurse", verdict: "advised", urgency: "h72", follow_date: null, need_doctor: false,
          ortho: { lie: { s: 138, d: 82, hr: 72, sym: null }, s1: { s: 116, d: 76, hr: 84, sym: "หน้ามืดเล็กน้อย" }, s3: { s: 124, d: 78, hr: 80, sym: null }, abnormal: true },
          symptoms: ["dizzy", "fear"], adl: { transfer: "indep", toilet: "super", walk: "indep", stairs: "assist" }, meds_admin: "helped",
          home_fix: ["rail", "light", "wet"], hfhat: true, education: ["prevent", "help", "getup", "rise"], coord: ["doctor", "physio", "family"], contact: "visit" }
      };
      S.refs.filter(function (r) { return r.user_id === m.id && r.review && DEMO_FORM[r.destination]; }).forEach(function (r) {
        var fm = {}; for (var k in DEMO_FORM[r.destination]) fm[k] = DEMO_FORM[r.destination][k];
        fm.answered_at = r.reviewed_at; fm.answered_role = r.destination; r.review.form = fm;
      });
      S.refs.filter(function (r) { return r.user_id === m.id && r.destination === "doctor"; }).forEach(function (r) {
        var p2 = {}; for (var k in flagPkg) p2[k] = flagPkg[k]; p2.pharm_recs = DEMO_FORM.pharmacist.problems; r.package = p2;
      });
      S.medrev.push({ id: uuid(7, 4), user_id: m.id, case_id: uuid(4, 41), referral_id: uuid(5, 7), requested_at: ago(24 * 42), reason: "ยา 4 รายการ มียากลุ่มเสี่ยงสูง 1 และระบุตัวไม่ได้ 1",
        summary: { high: 1, mod: 1, unknown: 1, total: 4 }, status: "done", reviewed_at: ago(24 * 37), reviewed_by: staffOf("pharmacist").id, outcome: "consult_doctor", recommend: RF[0][8].recommend });
      /* แผนดูแลที่รวมผลจากผู้เชี่ยวชาญสี่คน และการติดตามรายสัปดาห์ */
      S.plans.push({ id: uuid(10, 41), user_id: m.id, assessment_id: uuid(2, 410), level: "decline", items: [
        { id: "P1", nm: "ลดยานอนหลับตามแผนแพทย์ (ครึ่งหนึ่ง 2 สัปดาห์แล้วหยุด) ย้ายยาความดันเป็นก่อนนอน", done: true },
        { id: "P2", nm: "ฝึกลุกนั่งจากเก้าอี้ 10 ครั้ง × 3 รอบ วันเว้นวัน และยืนต่อเท้าจับโต๊ะ", done: true },
        { id: "P3", nm: "ติดราวจับห้องน้ำ เก้าอี้อาบน้ำ และไฟกลางคืนแบบเซ็นเซอร์", done: true },
        { id: "P4", nm: "ลูกสาวช่วยอาบน้ำช่วงเย็น ไม่เข้าห้องน้ำคนเดียวตอนกลางคืน", done: true },
        { id: "P5", nm: "ประเมินซ้ำที่บ้านใน 21 วัน", done: true }], due_at: ago(24 * 5), created_at: ago(24 * 31) });
      [[410, "โทรติดตามการฝึก", 24 * 24, "done", "ฝึกได้ ราวจับติดแล้ว"], [411, "โทรติดตามการฝึก", 24 * 17, "done", "ลดยานอนหลับตามแพทย์"],
       [412, "โทรติดตามการฝึก", 24 * 10, "done", "ไม่มีล้ม"], [413, "นัดประเมินซ้ำ", 24 * 5, "done", "ประเมินซ้ำแล้ว คะแนน 9/12"],
       [414, "นัดประเมินซ้ำ", -24 * 45, "pending", null]].forEach(function (f) {
        S.fups.push({ id: uuid(11, f[0]), user_id: m.id, plan_id: uuid(10, 41), kind: f[1], due_at: ago(f[2]), status: f[3], done_at: f[3] === "done" ? ago(f[2]) : null, note: f[4] });
      });
      /* วันที่ 39 · ประเมินซ้ำ — 9/12 ระดับเฝ้าสังเกต ประเมินซ้ำถัดไป 45 วัน */
      S.assess.push({ id: uuid(2, 411), user_id: m.id, assessed_at: ago(24 * 5), method: "camera_aruco", ftsst_seconds: 11.6, tug_seconds: 12.4, reps: 5, cadence_cv: 0.121,
        score: 9, score_max: 12, tier: 2, parts: { ftsst: 2, balance: 2, falls: 2, meds: 1, adl: 2 },
        falls_detail: { falls12m: 1, injured: false, unconscious: false, cannot_rise: false },
        meds_detail: { n: 3, high: 0 }, home_detail: { count: 1, alone: true },
        balance_text: "เท้าชิดผ่าน · กึ่งต่อเท้าผ่าน · ต่อเท้า 10 วินาที ผ่าน · ขาเดียวไม่ทดสอบ (อยู่คนเดียว)", adl_text: "อาบน้ำเองได้เมื่อมีเก้าอี้และราวจับ 19/20",
        safety_gate: { ok: true, alone: true }, not_tested: false, engine_version: "2.1.0", identity_verified: true, created_at: ago(24 * 5) });
      S.signals.push({ id: uuid(3, 411), user_id: m.id, assessment_id: uuid(2, 411), level: "watch", flags: [{ id: "B7", text: "หกล้มใน 12 เดือน 1 ครั้ง (ยังนับอยู่)" }],
        signals: [], next_days: 45, engine_version: "2.1.0", created_at: ago(24 * 5) });
      /* บันทึกตรวจสอบของเคสนี้ */
      [["care_manager", "contact.log", "บันทึกการติดต่อ DEMO-41: reached · ลูกสาวรับสาย", 24 * 42 - 20],
       ["care_manager", "referral.send", "ส่งต่อ DEMO-41 ถึง pharmacist · doctor · physio · nurse", 24 * 40],
       ["pharmacist", "referral.review", "ส่งผลทบทวนยา DEMO-41 กลับ · แนะนำพบแพทย์", 24 * 37],
       ["physio", "referral.review", "ส่งผลประเมิน DEMO-41 กลับ · โปรแกรมฝึก 4 สัปดาห์", 24 * 34],
       ["doctor", "referral.review", "ส่งผลตรวจ DEMO-41 กลับ · ลดยานอนหลับ", 24 * 33],
       ["nurse", "referral.review", "ส่งผลเยี่ยมบ้าน DEMO-41 กลับ · ราวจับและเก้าอี้อาบน้ำ", 24 * 32],
       ["care_manager", "case.update", "เคส DEMO-41 เปลี่ยนสถานะเป็น care_plan_agreed", 24 * 31],
       ["care_manager", "case.update", "เคส DEMO-41 เปลี่ยนสถานะเป็น service_completed", 24 * 4]].forEach(function (a, ix) {
        var st = staffOf(a[0]);
        S.audit.push({ id: uuid(15, 60 + ix), actor_id: st.id, actor_role: a[0], actor_name: st.display_name, action: a[1], subject_id: uuid(4, 41), detail: a[2], meta: { demo: true }, created_at: ago(a[3]) });
      });
    })();
    return S;
  }

  /* ---------- สถานะของเดโม เก็บในแท็บ ---------- */
  var S = null;
  function load() {
    try { var s = sessionStorage.getItem(STORE); if (s) { var o = JSON.parse(s); if (o && o.v === 1) return o; } } catch (e) {}
    return build();
  }
  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
  S = load();
  var ME = staffOf(role);
  var signedOut = false;
  var seq = 1000;
  function nid(kind) { return uuid(kind, ++seq + Math.floor(Math.random() * 1e6)); }
  function memberOf(uid) { for (var i = 0; i < S.members.length; i++) if (S.members[i].id === uid) return S.members[i]; return null; }
  function prof(m) { return m ? { pseudonym: m.pseudonym, display_name: m.display_name, phone: m.phone, birth_year_be: m.birth_year_be, sex: m.sex } : null; }
  function byTime(k, desc) { return function (a, b) { var x = a[k] || "", y = b[k] || ""; return desc ? (x < y ? 1 : x > y ? -1 : 0) : (x < y ? -1 : x > y ? 1 : 0); }; }
  function audit(action, subjectId, detail, meta) {
    S.audit.unshift({ id: nid(15), actor_id: ME.id, actor_role: ME.role, actor_name: ME.display_name, action: action, subject_id: subjectId || null, detail: detail || null, meta: meta || { demo: true }, created_at: iso(Date.now()) });
    save(); return Promise.resolve();
  }
  function ageBand(by) { var a = (new Date().getFullYear() + 543) - by; return a < 60 ? "50–59" : a < 70 ? "60–69" : a < 80 ? "70–79" : "80+"; }
  function latestSignal(uid) { var l = null; S.signals.forEach(function (s) { if (s.user_id === uid && (!l || s.created_at > l.created_at)) l = s; }); return l; }
  function prevSignal(uid) { var arr = S.signals.filter(function (s) { return s.user_id === uid; }).sort(byTime("created_at", true)); return arr[1] || null; }
  var LVO = { stable: 0, watch: 1, decline: 2, urgent: 3 };

  /* ---------- คิวงานของผู้ประสานงาน = view cm_worklist ---------- */
  function worklistRow(c) {
    var m = memberOf(c.user_id); if (!m) return null;
    var now = Date.now(), due = new Date(c.due_at).getTime();
    var overdue = !c.contacted_at && now > due;
    var refOpen = S.refs.filter(function (r) { return r.user_id === c.user_id && ["pending", "recommended", "approved", "acknowledged"].indexOf(r.status) >= 0; }).length;
    var mrOpen = S.medrev.filter(function (r) { return r.user_id === c.user_id && r.status === "pending"; }).length;
    var fuDue = S.fups.filter(function (f) { return f.user_id === c.user_id && f.status === "pending" && new Date(f.due_at).getTime() <= now; }).length;
    var lastEv = null; S.events.forEach(function (e) { if (e.user_id === c.user_id && (!lastEv || e.created_at > lastEv)) lastEv = e.created_at; });
    var pri = ({ urgent: 0, decline: 1, watch: 2, stable: 3 }[c.level]) * 1000 + (overdue ? 0 : 100) + (c.unreachable ? 50 : 0) + Math.min(99, Math.max(0, Math.round((due - now) / H)));
    return { id: c.id, user_id: c.user_id, level: c.level, status: c.status, signals: c.signals, opened_at: c.opened_at, due_at: c.due_at,
      contacted_at: c.contacted_at, attempts: c.attempts, unreachable: c.unreachable, next_action: c.next_action, assigned_to: c.assigned_to, sla_hours: c.sla_hours,
      pseudonym: m.pseudonym, display_name: m.display_name, phone: m.phone, birth_year_be: m.birth_year_be, sex: m.sex, carer_phone: m.carer_phone, province: m.province,
      age: (new Date().getFullYear() + 543) - m.birth_year_be, overdue: overdue, ref_open: refOpen, med_review_open: mrOpen, fu_due: fuDue, last_event_at: lastEv, priority: pri };
  }
  function openCases() { return S.cases.filter(function (c) { return c.status !== "stable" && c.status !== "closed"; }); }
  function caseById(id) { for (var i = 0; i < S.cases.length; i++) if (S.cases[i].id === id) return S.cases[i]; return null; }
  function refById(id) { for (var i = 0; i < S.refs.length; i++) if (S.refs[i].id === id) return S.refs[i]; return null; }
  function withProfile(rows) { return rows.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; o.profiles = prof(memberOf(r.user_id)); return o; }); }
  function isClinician() { return ["pharmacist", "physio", "doctor", "nurse"].indexOf(ME.role) >= 0; }
  function isCareTeam() { return ME.role === "care_manager" || ME.role === "admin"; }
  var REPLY_H = { urgent: 24, decline: 72, watch: 168, stable: 168 };

  /* ---------- ทับฟังก์ชันของ CSBackend ---------- */
  var OV = {
    init: function () { return Promise.resolve(true); },
    isCloud: function () { return true; },
    mode: function () { return "demo"; },
    client: function () { return null; },
    currentUser: function () { return Promise.resolve(signedOut ? null : { id: ME.id, email: ME.username + "@demo.local" }); },
    loadProfile: function () { return Promise.resolve(signedOut ? null : ME); },
    getProfile: function () { return signedOut ? null : ME; },
    signInStaff: function (idOrEmail) {
      var u = String(idOrEmail || "").toLowerCase().replace(/@.*$/, "").replace(/^demo\./, "");
      if (ROLE_ALIAS[u]) { role = ROLE_ALIAS[u]; ME = staffOf(role); }
      signedOut = false; audit("session.login", ME.id, "เข้าสู่ระบบ (สาธิต) บทบาท " + ME.role);
      return Promise.resolve({ id: ME.id, email: ME.username + "@demo.local" });
    },
    signOut: function () { signedOut = true; return Promise.resolve(); },
    mfaFactors: function () { return Promise.resolve({ totp: [] }); },
    mfaVerify: function () { return Promise.resolve({}); },
    mfaEnroll: function () { return Promise.reject(new Error("โหมดสาธิตไม่รองรับการตั้ง MFA")); },
    setOwnPassword: function () { ME.must_set_password = false; return Promise.resolve(true); },
    forcePasswordReset: function () { return Promise.resolve(true); },
    activateStaff: function () { return Promise.resolve({ ok: false, msg: "โหมดสาธิต: ใช้ชื่อผู้ใช้ demo.<บทบาท> เข้าได้เลย ไม่ต้องใช้รหัส" }); },
    redeemStaffInvite: function () { return Promise.resolve({ ok: false, msg: "โหมดสาธิต: ไม่มีรหัสจริงให้แลก" }); },
    startWorkSession: function (org) { if (!org) return Promise.reject(new Error("ต้องระบุหน่วยบริการ")); S.sessions.unshift({ org_name: String(org), started_at: iso(Date.now()) }); audit("session.start", ME.id, "เข้าระบบจากหน่วยบริการ: " + org); return Promise.resolve({ org_name: org }); },
    myOrg: function () { return Promise.resolve(ME.role === "insurer" ? null : ((S.sessions[0] && S.sessions[0].org_name) || ORG)); },
    myOrgHistory: function () { var seen = {}, out = []; S.sessions.concat([{ org_name: ORG }]).forEach(function (s) { if (!seen[s.org_name]) { seen[s.org_name] = 1; out.push(s.org_name); } }); return Promise.resolve(out); },

    cmWorklist: function () {
      var rows = openCases().map(worklistRow).filter(Boolean).sort(function (a, b) { return a.priority - b.priority; });
      audit("worklist.view", null, "เปิดคิวงาน " + rows.length + " เคส");
      return Promise.resolve(rows);
    },
    caseQueue: function () { return Promise.resolve(withProfile(openCases()).sort(byTime("opened_at"))); },
    myCases: function () { return Promise.resolve([]); },
    updateCase: function (id, status, note) {
      var c = caseById(id); if (!c) return Promise.reject(new Error("ไม่พบเคส"));
      var now = iso(Date.now()); c.status = status; c.updated_at = now; c.assigned_to = ME.id;
      if (status === "contacted") c.contacted_at = now;
      if (status === "stable" || status === "closed") { c.closed_at = now; if (note) c.close_reason = note; }
      if (note) c.note = note;
      audit("case.update", id, "เลื่อนสถานะเคสเป็น " + status + (note ? " · " + note : ""));
      return Promise.resolve(c);
    },
    logContact: function (c0, result, note, channel) {
      var c = caseById(c0.id); if (!c) return Promise.reject(new Error("ไม่พบเคส"));
      var now = iso(Date.now());
      S.contacts.unshift({ id: nid(12), case_id: c.id, user_id: c.user_id, by_staff: ME.id, channel: channel || "phone", result: result, note: note || null, created_at: now });
      c.updated_at = now; c.assigned_to = ME.id; c.attempts = (c.attempts || 0) + 1;
      if (result === "no_answer") { if (c.attempts >= 3) c.unreachable = true; c.next_action = "ลองติดต่อผ่านครอบครัว"; }
      else { c.unreachable = false; if (!c.contacted_at) c.contacted_at = now; if (c.status === "new") c.status = "contacted"; }
      if (result === "reached") c.next_action = "วางแผนดูแลร่วมกับครอบครัว";
      if (result === "plan_confirmed") { c.status = c.status === "new" || c.status === "contacted" ? "care_plan_agreed" : c.status; c.next_action = "ติดตามการทำตามแผน"; }
      if (result === "referred_ok" || result === "booked") { c.status = "referred"; c.next_action = "รอผลจากผู้เชี่ยวชาญ"; }
      if (result === "refused") { c.status = "closed"; c.closed_at = now; c.close_reason = "ผู้ใช้ปฏิเสธการดูแล"; }
      if (result === "new_event") c.next_action = "ทบทวนเหตุการณ์ใหม่";
      audit("contact.log", c.id, "บันทึกการติดต่อ: " + result + (note ? " · " + note : ""));
      return Promise.resolve(true);
    },
    caseDetail: function (caseId, userId) {
      var c = caseById(caseId), out = {};
      out.c = c ? worklistRow(c) : null;
      out.assess = S.assess.filter(function (a) { return a.user_id === userId; }).sort(byTime("assessed_at"));
      out.events = S.events.filter(function (e) { return e.user_id === userId; }).sort(byTime("created_at", true));
      out.refs = S.refs.filter(function (r) { return r.user_id === userId; }).sort(byTime("created_at", true));
      out.fups = S.fups.filter(function (f) { return f.user_id === userId; }).sort(byTime("due_at"));
      out.contacts = S.contacts.filter(function (x) { return x.user_id === userId; }).sort(byTime("created_at", true));
      out.plan = S.plans.filter(function (p) { return p.user_id === userId; }).sort(byTime("created_at", true))[0] || null;
      out.meds = S.meds.filter(function (x) { return x.user_id === userId && x.active; });
      audit("case.open", caseId, "เปิดดูรายละเอียดเคส");
      return Promise.resolve(out);
    },
    caseTimeline: function (caseId) {
      var c = caseById(caseId); if (!c) return Promise.resolve([]);
      var t = [{ at: c.opened_at, kind: "case", title: "เปิดเคสจากสัญญาณ", detail: (c.signals || []).map(function (s) { return s.nm; }).join(" · ") }];
      S.assess.filter(function (a) { return a.user_id === c.user_id; }).forEach(function (a) { t.push({ at: a.assessed_at, kind: "assessment", title: "ผลประเมิน " + a.score + "/12", detail: "ลุกนั่ง " + a.ftsst_seconds + " วิ · TUG " + a.tug_seconds + " วิ" }); });
      S.contacts.filter(function (x) { return x.user_id === c.user_id; }).forEach(function (x) { t.push({ at: x.created_at, kind: "contact", title: "ติดต่อ: " + x.result, detail: x.note }); });
      S.refs.filter(function (r) { return r.user_id === c.user_id; }).forEach(function (r) { t.push({ at: r.created_at, kind: "referral", title: "ส่งต่อ " + (ROLE_NM[r.destination] || r.destination), detail: r.action }); if (r.review) t.push({ at: r.reviewed_at, kind: "review", title: "ผลทบทวนกลับ", detail: r.review.finding }); });
      S.events.filter(function (e) { return e.user_id === c.user_id; }).forEach(function (e) { t.push({ at: e.created_at, kind: "event", title: "เหตุการณ์: " + e.kind, detail: "รายงานโดยครอบครัว" }); });
      S.medrev.filter(function (r) { return r.user_id === c.user_id; }).forEach(function (r) { t.push({ at: r.requested_at, kind: "med_review", title: "ขอทบทวนยา", detail: r.reason }); if (r.reviewed_at) t.push({ at: r.reviewed_at, kind: "med_review", title: "เภสัชกรปิดการทบทวน", detail: r.recommend }); });
      return Promise.resolve(t.sort(byTime("at")));
    },
    previewPackage: function (userId) {
      var m = memberOf(userId); if (!m) return Promise.resolve(null);
      return Promise.resolve(pkgV2(S, userId));
    },
    sendReferral: function (userId, caseId, dest, action, level, reasons, questions, replyHours) {
      if (!questions || !questions.length) return Promise.reject(new Error("ใบส่งต่อต้องมีคำถามอย่างน้อย 1 ข้อ"));
      var now = Date.now(), id = nid(5);
      return OV.previewPackage(userId).then(function (pk) {
        S.refs.unshift({ id: id, user_id: userId, case_id: caseId || null, risk_signal_id: null, level: level || "watch", destination: dest, action: action, sla: "ตามระดับความเร่งด่วน",
          reasons: reasons || [], questions: questions, status: "pending", reply_due: iso(now + (replyHours || 48) * H), package: pk, assigned_to: null,
          decided_by: null, decided_at: null, decision_note: null, acknowledged_at: null, booked_at: null, completed_at: null, completed_note: null, outcome: null, review: null, reviewed_at: null, created_at: iso(now) });
        var c = caseId ? caseById(caseId) : null;
        if (c) { c.status = "referred"; c.next_action = "รอผลจาก" + (ROLE_NM[dest] || dest); c.updated_at = iso(now); c.assigned_to = c.assigned_to || ME.id; }
        audit("referral.create", id, "ส่งต่อไปยัง " + dest + " · " + action);
        return id;
      });
    },
    createReferralFor: function (userId, caseId, dest, action, level) { return OV.sendReferral(userId, caseId, dest, action, level, [], ["ทบทวนและบันทึกผล"], 48); },
    claimReferral: function (id) {
      var r = refById(id); if (!r) return Promise.reject(new Error("ไม่พบรายการส่งต่อ"));
      r.assigned_to = ME.id; if (r.status === "pending") { r.status = "acknowledged"; r.acknowledged_at = iso(Date.now()); }
      audit("referral.claim", id, "รับเคสส่งต่อ"); return Promise.resolve(true);
    },
    returnReview: function (rid, finding, recommend, nextStep, note, form) {
      var r = refById(rid); if (!r) return Promise.reject(new Error("ไม่พบรายการส่งต่อ"));
      if (!finding || !nextStep) return Promise.reject(new Error("ต้องมีข้อค้นพบและขั้นตอนถัดไป"));
      /* กฎเดียวกับ return_review() ใน 22_referral_forms.sql */
      if (form && form.verdict && ["confirm", "not_confirm", "need_more_info", "advised", "refer_other", "follow_up"].indexOf(form.verdict) < 0) return Promise.reject(new Error("คำตอบมาตรฐานไม่ถูกต้อง"));
      if (/(ให้หยุดยา|หยุดยาทันที|เลิกยา)/.test(recommend || "")) return Promise.reject(new Error("คำแนะนำเรื่องยาให้ใช้ถ้อยคำว่า ทบทวนกับผู้สั่งใช้ — การปรับยาเป็นของผู้สั่งใช้"));
      r.status = "review_returned"; r.review = { finding: finding, recommend: recommend || null, next_step: nextStep, note: note || null };
      if (form) { var fm = {}; for (var k in form) fm[k] = form[k]; fm.answered_at = iso(Date.now()); fm.answered_role = ME.role; r.review.form = fm; }
      r.reviewed_at = iso(Date.now()); r.assigned_to = r.assigned_to || ME.id;
      var c = r.case_id ? caseById(r.case_id) : null;
      if (c) { c.next_action = "ปรับแผนตามผลทบทวนของ" + (ROLE_NM[r.destination] || r.destination) + ": " + nextStep; c.updated_at = iso(Date.now()); }
      audit("referral.update", rid, "การส่งต่อเปลี่ยนสถานะเป็น review_returned"); return Promise.resolve(true);
    },
    updateReferral: function (id, status, extra) {
      var r = refById(id); if (!r) return Promise.reject(new Error("ไม่พบรายการส่งต่อ"));
      var now = iso(Date.now()); r.status = status;
      if (status === "acknowledged") r.acknowledged_at = now;
      if (status === "booked") { r.booked_at = now; var c = r.case_id ? caseById(r.case_id) : null; if (c) c.status = "appointment_booked"; }
      if (status === "completed") { r.completed_at = now; if (extra && extra.note) r.completed_note = extra.note; var c2 = r.case_id ? caseById(r.case_id) : null; if (c2) c2.status = "service_completed"; }
      if (status === "outcome_recorded") r.outcome = (extra && extra.outcome) || { result: "recorded", recorded_at: now };
      if (extra && extra.destination) r.destination = extra.destination;
      audit("referral.update", id, "การส่งต่อเปลี่ยนสถานะเป็น " + status); return Promise.resolve(r);
    },
    decideReferral: function (id, approved, note) { var r = refById(id); if (!r) return Promise.reject(new Error("ไม่พบ")); r.status = approved ? "approved" : "declined"; r.decided_by = ME.id; r.decided_at = iso(Date.now()); r.decision_note = note || null; return Promise.resolve(r); },
    listReferralQueue: function (status) {
      var rows = S.refs.slice();
      if (isClinician()) rows = rows.filter(function (r) { return r.destination === ME.role || r.assigned_to === ME.id; });
      if (status) rows = rows.filter(function (r) { return r.status === status; });
      return Promise.resolve(withProfile(rows).sort(byTime("created_at", true)));
    },
    myReferrals: function () { return OV.listReferralQueue(null); },
    myWork: function () {
      var out = [];
      if (isCareTeam()) openCases().forEach(function (c) {
        if (c.assigned_to && c.assigned_to !== ME.id) return;
        var m = memberOf(c.user_id);
        out.push({ kind: "case", ref_id: c.id, user_id: c.user_id, pseudonym: m.pseudonym, display_name: m.display_name, level: c.level, status: c.status, task: c.next_action, due_at: c.due_at, assigned_to: c.assigned_to, unclaimed: !c.assigned_to, overdue: Date.now() > new Date(c.due_at).getTime(), signals: c.signals });
      });
      if (isClinician()) S.refs.forEach(function (r) {
        if (["outcome_recorded", "declined"].indexOf(r.status) >= 0) return;
        if (r.destination !== ME.role && r.assigned_to !== ME.id) return;
        var m = memberOf(r.user_id), due = new Date(r.created_at).getTime() + (r.level === "urgent" ? 1 : r.level === "decline" ? 3 : 7) * D;
        out.push({ kind: "referral", ref_id: r.id, user_id: r.user_id, pseudonym: m.pseudonym, display_name: m.display_name, level: r.level, status: r.status, task: r.action || "ทบทวนและบันทึกผล", due_at: iso(due), assigned_to: r.assigned_to, unclaimed: !r.assigned_to, overdue: Date.now() > due, signals: r.reasons });
      });
      return Promise.resolve(out.sort(byTime("due_at")));
    },
    checkMembership: function (memberId) { var m = memberOf(memberId); return Promise.resolve(m ? { ok: true, member: true, status: "active", pseudonym: m.pseudonym } : { ok: false, member: false }); },
    requestAccess: function (memberId, referralId, scope, reason) {
      var a = { id: nid(16), member_id: memberId, requester_id: ME.id, referral_id: referralId || null, scope: scope || "clinical", reason: reason || null, status: "granted", requested_at: iso(Date.now()), decided_at: iso(Date.now() + 1000), access_until: iso(Date.now() + 8 * H) };
      S.access.unshift(a); audit("access.request", memberId, "ขอความยินยอมเปิดดูข้อมูลคลินิก (สาธิต: ผู้เอาประกันอนุญาตทันที)"); return Promise.resolve(a);
    },
    checkAccess: function (memberId) {
      var a = S.access.filter(function (x) { return x.member_id === memberId && x.requester_id === ME.id; })[0] || null;
      if (a) a.live = a.status === "granted" && new Date(a.access_until) > new Date();
      return Promise.resolve(a);
    },
    medReviewQueue: function () { return Promise.resolve(withProfile(S.medrev.filter(function (r) { return r.status === "pending"; })).sort(byTime("requested_at"))); },
    medsOf: function (userId) { return Promise.resolve(S.meds.filter(function (x) { return x.user_id === userId && x.active; }).sort(function (a, b) { return (b.frid_level || 0) - (a.frid_level || 0); })); },
    medPhotoUrl: function () { return Promise.resolve(null); },
    pharmacistFix: function (medId, patch) {
      var m = null; S.meds.forEach(function (x) { if (x.id === medId) m = x; }); if (!m) return Promise.reject(new Error("ไม่พบยา"));
      ["inn", "atc", "frid_group", "frid_level", "review_note", "active"].forEach(function (k) { if (patch[k] !== undefined) m[k] = patch[k]; });
      m.reviewed_at = iso(Date.now()); m.reviewed_by = ME.id; m.confirmed_by = "pharmacist"; m.updated_at = m.reviewed_at;
      audit("med.pharmacist_fix", medId, "เภสัชกรยืนยัน/แก้รายการยา → " + (patch.frid_group || "") + " " + (patch.review_note || "")); return Promise.resolve(m);
    },
    closeMedReview: function (id, outcome, recommend) {
      var r = null; S.medrev.forEach(function (x) { if (x.id === id) r = x; }); if (!r) return Promise.reject(new Error("ไม่พบการทบทวนยา"));
      r.status = "done"; r.reviewed_at = iso(Date.now()); r.reviewed_by = ME.id; r.outcome = outcome || null; r.recommend = recommend || null;
      audit("med.review_done", id, "เภสัชกรปิดการทบทวนยา · " + (recommend || ""));
      if (outcome === "consult_doctor") return OV.sendReferral(r.user_id, r.case_id, "doctor", "ทบทวนยาโดยแพทย์ผู้สั่งยา ตามข้อเสนอของเภสัชกร", "decline", [{ id: "B13", text: "ใช้ยากลุ่มเพิ่มความเสี่ยงหกล้ม (FRID)" }], ["ควรปรับหรือหยุดยารายการใด"], 72).then(function () { return r; });
      return Promise.resolve(r);
    },
    unknownDrugQueue: function () { return Promise.resolve(withProfile(S.unknown.filter(function (x) { return x.status === "pending"; }))); },
    resolveUnknownDrug: function (id, inn, group, atc, note) {
      S.unknown.forEach(function (x) { if (x.id === id) { x.status = "resolved"; S.meds.forEach(function (m) { if (m.id === x.medication_id) { m.inn = inn || m.inn; m.frid_group = group || "unknown"; m.atc = atc || null; m.review_note = note || null; m.confirmed_by = "pharmacist"; } }); } });
      audit("drug.resolve", id, "เภสัชกรจัดกลุ่มยาที่ระบบไม่รู้จัก → " + (group || "unknown")); return Promise.resolve(true);
    },

    listStaff: function () { return Promise.resolve(STAFF.map(function (s) { return { id: s.id, role: s.role, display_name: s.display_name, pseudonym: s.pseudonym, created_at: s.created_at }; })); },
    setRole: function (id, r) { if (id === ME.id) return Promise.reject(new Error("เปลี่ยนบทบาทของตัวเองไม่ได้")); STAFF.forEach(function (s) { if (s.id === id) s.role = r; }); audit("role.change", id, "เปลี่ยนบทบาทเป็น " + r); return Promise.resolve(true); },
    dataSummary: function () {
      return Promise.resolve([
        { k: "members", nm: "สมาชิก (ผู้เอาประกัน)", n: S.members.length, deletable: true }, { k: "assessments", nm: "ผลประเมิน", n: S.assess.length, deletable: true },
        { k: "risk_signals", nm: "สัญญาณเสี่ยง", n: S.signals.length, deletable: true }, { k: "care_cases", nm: "เคส", n: S.cases.length, deletable: true },
        { k: "referrals", nm: "การส่งต่อ", n: S.refs.length, deletable: true }, { k: "medications", nm: "รายการยา", n: S.meds.length, deletable: true },
        { k: "med_reviews", nm: "การทบทวนยา", n: S.medrev.length, deletable: true }, { k: "staff", nm: "บัญชีเจ้าหน้าที่", n: STAFF.length, deletable: false },
        { k: "audit_logs", nm: "บันทึกตรวจสอบ (ลบไม่ได้)", n: S.audit.length, deletable: false }, { k: "drug_registry", nm: "ทะเบียนยา (ข้อมูลอ้างอิง)", n: 20, deletable: false }]);
    },
    listAccounts: function () {
      var rows = STAFF.map(function (s) { return { id: s.id, username: s.username, display_name: s.display_name, role: s.role, created_at: s.created_at, n_assess: 0, n_cases: 0, n_meds: 0, has_history: s.role !== "insurer", is_self: s.id === ME.id }; });
      S.members.forEach(function (m) { rows.push({ id: m.id, username: null, display_name: m.display_name, role: "user", created_at: m.created_at, n_assess: S.assess.filter(function (a) { return a.user_id === m.id; }).length, n_cases: S.cases.filter(function (c) { return c.user_id === m.id; }).length, n_meds: S.meds.filter(function (x) { return x.user_id === m.id; }).length, has_history: false, is_self: false }); });
      return Promise.resolve(rows);
    },
    purgeMemberData: function (uid) {
      var n = 0; ["assess", "signals", "cases", "refs", "medrev", "meds", "fups", "plans", "contacts", "events"].forEach(function (k) { var b = S[k].length; S[k] = S[k].filter(function (x) { return x.user_id !== uid; }); n += b - S[k].length; });
      audit("admin.purge", uid, "ลบข้อมูลสุขภาพของสมาชิก " + n + " รายการ (สาธิต)"); return Promise.resolve({ ok: true, deleted: n });
    },
    deleteAccount: function (uid) { return OV.purgeMemberData(uid).then(function (r) { S.members = S.members.filter(function (m) { return m.id !== uid; }); audit("admin.delete", uid, "ลบบัญชี (สาธิต)"); return r; }); },
    revokeStaff: function (uid) { STAFF.forEach(function (s) { if (s.id === uid) s.role = "user"; }); audit("admin.revoke", uid, "เพิกถอนบัญชีเจ้าหน้าที่ (สาธิต)"); return Promise.resolve(true); },
    issueInvite: function (username, r, displayName, note, days) {
      var row = { id: nid(14), username: username, role: r, display_name: displayName || null, note: note || null, code_hint: "DEMO", created_at: iso(Date.now()), expires_at: iso(Date.now() + (days || 30) * D), used_at: null, revoked_at: null, status: "open",
        code: "DEMO-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase() };
      S.invites.unshift(row); audit("invite.issue", row.id, "ออกรหัสให้ " + username + " บทบาท " + r + " (สาธิต: รหัสนี้ใช้จริงไม่ได้)"); return Promise.resolve(row);
    },
    listInvites: function () { return Promise.resolve(S.invites.slice()); },
    revokeInvite: function (id) { S.invites.forEach(function (x) { if (x.id === id) { x.status = "revoked"; x.revoked_at = iso(Date.now()); } }); audit("invite.revoke", id, "ยกเลิกรหัส (สาธิต)"); return Promise.resolve(true); },
    listAudit: function (limit) { return Promise.resolve(S.audit.slice(0, limit || 50)); },
    audit: audit,

    /* ---------- บริษัทประกัน = view insurer_* ---------- */
    insurerPortfolio: function () {
      var rows = S.members.filter(function (m) { return m.share_pool; }).map(function (m) {
        var as = S.assess.filter(function (a) { return a.user_id === m.id; }).sort(byTime("assessed_at")), l = as[as.length - 1], sg = latestSignal(m.id);
        return { pseudonym: m.pseudonym, age_band: ageBand(m.birth_year_be), sex: m.sex, tier: l ? l.tier : null, score: l ? l.score : null, ftsst_seconds: l ? l.ftsst_seconds : null, method: l ? l.method : null, identity_verified: true,
          risk_level: sg ? sg.level : null, n_assessments: as.length, last_assessed_at: l ? l.assessed_at : null, last_assessed_month: l ? l.assessed_at.slice(0, 7) + "-01T00:00:00.000Z" : null, active_monitored: !!(l && new Date(l.assessed_at).getTime() > Date.now() - 90 * D) };
      });
      audit("portfolio.view", null, "เปิดดูพอร์ตความเสี่ยง " + rows.length + " ราย"); return Promise.resolve(rows);
    },
    insurerFunnel: function () {
      var pool = S.members.filter(function (m) { return m.share_pool; }), ids = {}; pool.forEach(function (m) { ids[m.id] = 1; });
      var assessed = {}, act90 = {}, act30 = {};
      S.assess.forEach(function (a) { if (!ids[a.user_id]) return; assessed[a.user_id] = 1; var t = new Date(a.assessed_at).getTime(); if (t > Date.now() - 90 * D) act90[a.user_id] = 1; if (t > Date.now() - 30 * D) act30[a.user_id] = 1; });
      return Promise.resolve({ eligible: S.members.length, enrolled: pool.length, assessed: Object.keys(assessed).length, active_monitored: Object.keys(act90).length, active_30d: Object.keys(act30).length });
    },
    insurerStrata: function () {
      var pool = S.members.filter(function (m) { return m.share_pool; }), g = {};
      function add(dim, bucket, lv) { var k = dim + "|" + bucket; g[k] = g[k] || { dim: dim, bucket: bucket, n: 0, green: 0, yellow: 0, red: 0 }; var o = g[k]; o.n++; if (lv === "stable") o.green++; else if (lv === "watch") o.yellow++; else if (lv) o.red++; }
      pool.forEach(function (m) { var sg = latestSignal(m.id), lv = sg ? sg.level : null; add("age", ageBand(m.birth_year_be), lv); add("sex", m.sex || "—", lv); add("province", m.province || "ไม่ระบุ", lv); });
      return Promise.resolve(Object.keys(g).map(function (k) { var o = g[k], sup = o.n < 10; return { dim: o.dim, bucket: o.bucket, n: o.n, green: sup ? null : o.green, yellow: sup ? null : o.yellow, red: sup ? null : o.red, suppressed: sup }; }));
    },
    insurerSignals: function () {
      var cnt = {}, tot = 0, pool = {}; S.members.forEach(function (m) { if (m.share_pool) pool[m.id] = 1; });
      S.signals.forEach(function (s) { if (!pool[s.user_id]) return; (s.signals || []).forEach(function (x) { cnt[x.k] = (cnt[x.k] || 0) + 1; tot++; }); });
      return Promise.resolve(Object.keys(cnt).map(function (k) { return { signal: k, n: cnt[k], pct: Math.round(1000 * cnt[k] / tot) / 10 }; }).sort(function (a, b) { return b.n - a.n; }));
    },
    /* แนวโน้มรายเดือน — นับจากชุดข้อมูลสาธิตชุดเดียวกัน ด้วยกฎเดียวกับ view
       insurer_monthly ทุกเดือนคืนแถวเสมอแม้ไม่มีข้อมูล กราฟจะได้มีแกนเวลาต่อเนื่อง */
    insurerMonthly: function () {
      var pool = {}; S.members.forEach(function (m) { if (m.share_pool) pool[m.id] = 1; });
      var key = function (iso) { var d = new Date(iso); return d.getFullYear() + "-" + pad(d.getMonth() + 1, 2) + "-01"; };
      var rows = {}, order = [];
      var now = new Date();
      for (var i = 11; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var k = d.getFullYear() + "-" + pad(d.getMonth() + 1, 2) + "-01";
        rows[k] = { month: k, n_assessments: 0, n_first_assessments: 0, n_members_assessed: 0,
          lv_stable: 0, lv_watch: 0, lv_decline: 0, lv_urgent: 0,
          n_cases_opened: 0, n_cases_contacted: 0, n_contacted_in_sla: 0, _seen: {} };
        order.push(k);
      }
      /* ลำดับครั้งที่ประเมินคิดจากประวัติทั้งหมดของคนนั้น เหมือน row_number() ใน view */
      var byUser = {};
      S.assess.forEach(function (a) { if (!pool[a.user_id]) return; (byUser[a.user_id] = byUser[a.user_id] || []).push(a); });
      Object.keys(byUser).forEach(function (uid) {
        byUser[uid].sort(byTime("assessed_at")).forEach(function (a, ix) {
          var r = rows[key(a.assessed_at)]; if (!r) return;
          r.n_assessments++;
          if (ix === 0) r.n_first_assessments++;
          if (!r._seen[uid]) { r._seen[uid] = 1; r.n_members_assessed++; }
        });
      });
      S.signals.forEach(function (g) {
        if (!pool[g.user_id]) return;
        var r = rows[key(g.created_at)]; if (!r) return;
        if (r["lv_" + g.level] !== undefined) r["lv_" + g.level]++;
      });
      S.cases.forEach(function (c) {
        if (!pool[c.user_id]) return;
        var r = rows[key(c.opened_at)]; if (!r) return;
        r.n_cases_opened++;
        if (c.contacted_at) {
          r.n_cases_contacted++;
          if (new Date(c.contacted_at).getTime() <= new Date(c.opened_at).getTime() + (c.sla_hours || 0) * H) r.n_contacted_in_sla++;
        }
      });
      return Promise.resolve(order.map(function (k) { var r = rows[k]; delete r._seen; return r; }));
    },
    insurerOutcomes: function () {
      var pool = {}, n = 0; S.members.forEach(function (m) { if (m.share_pool) { pool[m.id] = 1; n++; } });
      var as = S.assess.filter(function (a) { return pool[a.user_id]; }), now = Date.now();
      var lv = { stable: 0, watch: 0, decline: 0, urgent: 0 }, imp = 0, wor = 0, cmp = 0, ever = {}, act30 = {}, py = 0, first = {};
      Object.keys(pool).forEach(function (uid) { var l = latestSignal(uid), p = prevSignal(uid); if (l) lv[l.level]++; if (l && p) { cmp++; if (LVO[l.level] < LVO[p.level]) imp++; if (LVO[l.level] > LVO[p.level]) wor++; } });
      as.forEach(function (a) { ever[a.user_id] = 1; var t = new Date(a.assessed_at).getTime(); if (t > now - 30 * D) act30[a.user_id] = 1; if (!first[a.user_id] || t < first[a.user_id]) first[a.user_id] = t; });
      Object.keys(first).forEach(function (u) { py += (now - first[u]) / (365.25 * D); });
      var cs = S.cases.filter(function (c) { return pool[c.user_id]; }), rf = S.refs.filter(function (r) { return pool[r.user_id]; }), mr = S.medrev.filter(function (r) { return pool[r.user_id]; }), ev = S.events.filter(function (e) { return pool[e.user_id]; }), fu = S.fups.filter(function (f) { return pool[f.user_id]; });
      function cn(arr, f) { return arr.filter(f).length; }
      return Promise.resolve({
        n_members: n, n_assessments: as.length, n_assessed_30d: cn(as, function (a) { return new Date(a.assessed_at).getTime() > now - 30 * D; }), n_active_30d: Object.keys(act30).length, n_ever_assessed: Object.keys(ever).length,
        n_not_tested: cn(as, function (a) { return a.not_tested; }), person_years: Math.round(py * 100) / 100,
        lv_stable: lv.stable, lv_watch: lv.watch, lv_decline: lv.decline, lv_urgent: lv.urgent, n_improved: imp, n_worsened: wor, n_comparable: cmp,
        case_total: cs.length, case_new: cn(cs, function (c) { return c.status === "new"; }), case_working: cn(cs, function (c) { return ["new", "stable", "closed"].indexOf(c.status) < 0; }), case_closed: cn(cs, function (c) { return c.status === "stable" || c.status === "closed"; }), case_stable: cn(cs, function (c) { return c.status === "stable"; }),
        case_contacted: cn(cs, function (c) { return !!c.contacted_at; }), case_contacted_in_sla: cn(cs, function (c) { return c.contacted_at && new Date(c.contacted_at).getTime() <= new Date(c.opened_at).getTime() + c.sla_hours * H; }),
        case_overdue: cn(cs, function (c) { return !c.contacted_at && c.status !== "stable" && c.status !== "closed" && now > new Date(c.due_at).getTime(); }), case_unreachable: cn(cs, function (c) { return c.unreachable; }), case_reescalated: 0,
        n_plans: S.plans.length, n_fu_due: cn(fu, function (f) { return new Date(f.due_at).getTime() <= now; }), n_fu_done: cn(fu, function (f) { return f.status === "done"; }), n_fu_open: cn(fu, function (f) { return f.status === "pending"; }),
        n_ref: rf.length, n_ref_confirmed: cn(rf, function (r) { return r.status !== "pending"; }), n_ref_booked: cn(rf, function (r) { return !!r.booked_at; }), n_ref_completed: cn(rf, function (r) { return !!r.completed_at; }), n_ref_outcome: cn(rf, function (r) { return r.status === "outcome_recorded"; }), n_ref_lost: cn(rf, function (r) { return r.status === "unreachable" || r.status === "declined"; }),
        n_medrev: mr.length, n_medrev_done: cn(mr, function (r) { return r.status === "done"; }), n_medrev_open: cn(mr, function (r) { return r.status === "pending"; }),
        ev_fall: cn(ev, function (e) { return e.kind === "fall"; }), ev_near_fall: cn(ev, function (e) { return e.kind === "near_fall"; }), ev_hospital: cn(ev, function (e) { return e.kind === "hospital"; }), ev_med_change: cn(ev, function (e) { return e.kind === "med_change"; }), ev_adl_drop: cn(ev, function (e) { return e.kind === "adl_drop"; })
      });
    }
  };
  /* ทุกฟังก์ชันที่แก้ข้อมูลต้องบันทึกสถานะลงแท็บ — ห่อรวมทีเดียว จะได้ไม่ลืม */
  Object.keys(OV).forEach(function (k) {
    var f = OV[k];
    CSBackend[k] = function () { var r = f.apply(OV, arguments); if (r && typeof r.then === "function") return r.then(function (v) { save(); return v; }); save(); return r; };
  });
  /* ฟังก์ชันฝั่งสมาชิกที่คอนโซลไม่ใช้ — ถ้ามีใครเรียกในโหมดสาธิต ให้ล้มแบบบอกเหตุผล ไม่ให้หลุดไปฐานข้อมูลจริง */
  Object.keys(CSBackend).forEach(function (k) { if (!OV[k] && k !== "staffEmail") CSBackend[k] = function () { return Promise.reject(new Error("โหมดสาธิต: ไม่เชื่อมฐานข้อมูลจริง (" + k + ")")); }; });

  /* ---------- แถบกำกับ — ต้องเห็นทุกหน้าจอ ---------- */
  function banner() {
    if (document.getElementById("csDemoBar")) return;
    var b = document.createElement("div"); b.id = "csDemoBar";
    b.setAttribute("role", "status");
    b.style.cssText = "position:sticky;top:0;z-index:9999;background:repeating-linear-gradient(135deg,#7C2D12 0 14px,#9A3412 14px 28px);color:#fff;font:600 13px/1.3 system-ui,sans-serif;padding:6px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 1px 0 #FED7AA";
    var sel = ROLES.map(function (r) { return '<option value="' + r + '"' + (r === role ? " selected" : "") + ">" + ROLE_NM[r] + "</option>"; }).join("");
    b.innerHTML = '<span style="background:#fff;color:#7C2D12;border-radius:4px;padding:1px 7px;font-weight:800;letter-spacing:.02em">ข้อมูลสาธิต</span>' +
      '<span>ข้อมูลสังเคราะห์ทั้งหมด ไม่ใช่บุคคลจริง · ไม่เชื่อมฐานข้อมูล · ทุกชื่อขึ้นต้นด้วย “สาธิต” รหัสขึ้นต้นด้วย DEMO-</span>' +
      '<span style="margin-left:auto;display:flex;gap:6px;align-items:center"><label style="font-weight:500">บทบาท</label><select id="csDemoRole" style="font:inherit;border-radius:4px;border:0;padding:2px 6px">' + sel + '</select>' +
      '<button id="csDemoReset" type="button" style="font:inherit;border:1px solid #fff;background:transparent;color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer">รีเซ็ตข้อมูลสาธิต</button></span>';
    document.body.insertBefore(b, document.body.firstChild);
    /* หน้าจอที่ยึดขอบบน (จอวอร์ด เมนูข้าง) ต้องเลื่อนลงมาใต้แถบ ไม่งั้นแถบจะทับหัวจอ */
    var st = document.createElement("style");
    st.textContent = "#wardRoot.ward{top:var(--cs-demo-h,35px)!important}#side.side{top:var(--cs-demo-h,35px)!important}";
    (document.head || document.body).appendChild(st);
    /* วัดความสูงจริงหลังจัดหน้าแล้ว — วัดตอนแทรกจะได้ค่าเพี้ยนเพราะฟอนต์และความกว้างยังไม่นิ่ง */
    function setH() { var h = b.offsetHeight, root = document.documentElement; if (root && h > 0 && h < 200) root.style.setProperty("--cs-demo-h", h + "px"); }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(setH); else setH();
    if (window.addEventListener) { window.addEventListener("resize", setH); window.addEventListener("load", setH); }
    document.getElementById("csDemoRole").addEventListener("change", function () { var p = new URLSearchParams(location.search); p.set("demo", this.value); location.search = "?" + p.toString(); });
    document.getElementById("csDemoReset").addEventListener("click", function () { try { sessionStorage.removeItem(STORE); } catch (e) {} location.reload(); });
  }
  if (document.body) banner(); else document.addEventListener("DOMContentLoaded", banner);

  window.CS_DEMO = { on: true, role: role, org: ORG, state: function () { return S; }, staff: STAFF, reset: function () { try { sessionStorage.removeItem(STORE); } catch (e) {} S = build(); save(); } };
})();
