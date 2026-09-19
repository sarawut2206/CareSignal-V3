/* ============================================================
   cs-cloud.js — ชั้นเชื่อม CareSignal V3 กับระบบกลาง (Supabase เดียวกับ V2)
   ------------------------------------------------------------
   หลักคิด: บัญชี 1 บัญชี = ผู้สูงอายุ 1 คน ที่ลูกหลานเป็นผู้ดูแลบัญชีให้
   ผลวัดจึงเขียนลง assessments ด้วย user_id ของบัญชีนั้นตรง ๆ (RLS ของ V2 อนุญาต)
   และ risk_signals → ทริกเกอร์ในฐานข้อมูลเปิดเคสให้เจ้าหน้าที่เอง เหมือน V2 ทุกประการ
   สิ่งที่ต่างคือ method = 'manual' และ detail.measured_by = 'carer'

   ส่วนที่เป็นฟังก์ชันล้วน (levelOf, payloadOf, signalsOf) ทดสอบใน node ได้
   ส่วนที่คุยกับ CSBackend อยู่ใน CSCloud.* และใช้ได้เฉพาะในเบราว์เซอร์
   ============================================================ */
(function (g) {
  var ENGINE = "3.0.0-carer";
  var CADENCE = { stable: 90, watch: 30, decline: 14, urgent: 7 };
  var REFERRAL = {
    urgent:  { nm: "ส่งต่อพยาบาลประเมินที่บ้าน", sla: "ภายใน 72 ชั่วโมง", need: true },
    decline: { nm: "Care Manager โทรติดตาม", sla: "ภายใน 7 วัน", need: true },
    watch:   { nm: "แผนป้องกันด้วยตนเอง + เตือนประเมินซ้ำ", sla: "ไม่ต้องส่งต่อ", need: false },
    stable:  { nm: "ดูแลตนเองตามแผนปกติ", sla: "ไม่ต้องส่งต่อ", need: false }
  };
  /* ชุดสัญญาณเดียวกับ V2 (SIGNAL_DEFS) — ปลายทางที่เจ้าหน้าที่จะส่งต่อ */
  var SIGNAL_DEFS = [
    { k: "S1", nm: "หกล้มครั้งใหม่", rules: ["R3", "B7"], dest: "doctor", act: "ทบทวนสาเหตุการล้มกับแพทย์ และสำรวจจุดเสี่ยงในบ้าน" },
    { k: "S2", nm: "หกล้มซ้ำหรือล้มแล้วบาดเจ็บ", rules: ["B1", "B2", "B3", "B4"], dest: "doctor", act: "พบแพทย์เพื่อหาสาเหตุ — การล้มซ้ำไม่ใช่เรื่องของการทรงตัวอย่างเดียว" },
    { k: "S3", nm: "ความเสี่ยงจากยา", rules: ["R5", "B6", "B12", "B13", "B14"], dest: "pharmacist", act: "ให้เภสัชกรหรือแพทย์ทบทวนรายการยา — ระบบไม่สั่งหยุดหรือปรับยา" },
    { k: "S4", nm: "กำลังขาและการทรงตัวถดถอย", rules: ["R1", "R2", "R4", "R7", "R8", "B9", "B11"], dest: "physio", act: "เข้าโปรแกรมฝึกกำลังขาและการทรงตัว (strength and balance)" },
    { k: "S5", nm: "ความคล่องตัวในการเดินลดลง", rules: ["R10", "R3", "B10"], dest: "physio", act: "ประเมินการเดินและพิจารณาอุปกรณ์ช่วยเดินที่เหมาะสม" },
    { k: "S6", nm: "ทำกิจวัตรประจำวันได้น้อยลง", rules: ["R6", "R9", "B16"], dest: "nurse", act: "ประเมินภาวะพึ่งพิงเชิงลึกและวางแผนการดูแลร่วมกับครอบครัว" }
  ];

  /* ธงจากผลวัด V3 → รูปแบบที่ V2 ใช้ [{id,text,why,sev}] · แดง 3 · แนวโน้มแย่ลง 2 · เหลือง 1 */
  function flagsOf(rec) {
    var out = [];
    (rec.flags.reds || []).forEach(function (f) { out.push({ id: f.id, text: f.text, why: f.why, sev: 3 }); });
    (rec.trend || []).forEach(function (t) { if (!t.good) out.push({ id: t.id, text: t.text, why: t.why, sev: 2 }); });
    (rec.flags.yellows || []).forEach(function (f) { out.push({ id: f.id, text: f.text, why: f.why, sev: 1 }); });
    return out;
  }
  function signalsOf(flags) {
    var by = {}; flags.forEach(function (f) { by[f.id] = f; });
    var out = [];
    SIGNAL_DEFS.forEach(function (d) {
      var hit = d.rules.filter(function (r) { return by[r]; });
      if (!hit.length) return;
      var sev = 0, why = [];
      hit.forEach(function (r) { sev = Math.max(sev, by[r].sev || 1); why.push(by[r].text); });
      out.push({ k: d.k, nm: d.nm, sev: sev, dest: d.dest, act: d.act, rules: hit, why: why });
    });
    out.sort(function (a, b) { return b.sev - a.sev; });
    return out;
  }
  /* ระดับสัญญาณ (cs_risk_level ของฐานข้อมูล) — ใช้กติกาเดียวกับ V2: เอาอันที่แย่กว่าระหว่างคะแนนกับธง */
  function levelOf(rec) {
    var flags = flagsOf(rec), sev = flags.reduce(function (a, b) { return a + b.sev; }, 0);
    var hasADL = flags.some(function (f) { return f.id === "B16"; });
    var byRules = (rec.tier === 1 || hasADL || sev >= 5) ? "urgent" : (rec.tier === 2 || sev >= 3) ? "decline" : sev >= 1 ? "watch" : "stable";
    var byBase = rec.flags.reds && rec.flags.reds.length ? "urgent" : (rec.flags.yellows && rec.flags.yellows.length ? "watch" : "stable");
    var ORD = { stable: 0, watch: 1, decline: 2, urgent: 3 }, NM = ["stable", "watch", "decline", "urgent"];
    var level = NM[Math.max(ORD[byRules], ORD[byBase])];
    return { level: level, flags: flags, signals: signalsOf(flags), nextDays: CADENCE[level], referral: REFERRAL[level], engine: ENGINE };
  }
  /* แถวที่จะเขียนลง assessments ผ่าน CSBackend.saveAssessment — ช่องเดียวกับที่ V2 ส่ง */
  function payloadOf(rec, elder, carerName) {
    var balPassed = rec.balPassed != null ? rec.balPassed
                  : rec.balance == null ? null : (rec.balance >= 10 ? 3 : 2);   /* ข้อมูลรุ่นแรก: รู้แค่ท่ายืนต่อเท้า */
    var STG = ["feet_together", "semi_tandem", "tandem", "one_leg"];
    var stages = (rec.balStages || []).map(function (sec, i) { return { stage: STG[i], seconds: sec, tested: sec != null, passed: sec == null ? null : (sec >= 10 && !(rec.balFail && rec.balFail[i])), by: rec.balCam && rec.balCam[i] ? "camera-pose" : "manual" }; });
    /* วิธีวัดต่อท่า: กล้อง (cs-camera.js ยกจาก V2) หรือกดจับเวลาเอง — โครงสร้างเดียวกับที่ V2 ส่ง */
    var cam = rec.cam || {}, cf = cam.ftsst && !cam.ftsst.manual ? cam.ftsst : null, ct = cam.tug && !cam.tug.manual ? cam.tug : null;
    var anyCam = !!(cf || ct || (rec.balCam && rec.balCam.some(Boolean)));
    return {
      at: rec.date, method: anyCam ? "camera-pose" : "manual", ftsst: rec.ftsst, tug: rec.tug,
      reps: rec.ftsst != null ? (cf ? cf.reps : 5) : null, cv: cf ? cf.cv : null, gaps: cf ? cf.gaps : null,
      score: rec.score, max: rec.max, tier: rec.tier, parts: rec.parts, verified: false,
      engine: ENGINE, durSec: null,
      safetyGate: { answers: rec.safety || null, verdict: { safe: true, mode: "carer" } },
      fallsDetail: { count: rec.fallsCount, injury: rec.injury, getup: rec.getup },
      medsDetail: { count: rec.medsCount, n: rec.medsItems ? rec.medsItems.length : null, items: rec.medsItems || null,
                    frid_high: rec.fridHigh == null ? null : rec.fridHigh, frid_total: rec.fridTotal == null ? null : rec.fridTotal },
      homeDetail: null, notTested: rec.ftsst == null && rec.tug == null && rec.balance == null,
      testQuality: { measured_by: "carer", ended_by: ct ? "camera" : "carer", alone: false, alone_skip: false, distance_ok: rec.tug != null ? (ct ? ct.distanceOk : true) : null },
      detail: {
        method: anyCam ? "camera-pose" : "manual", measured_by: "carer", carer_name: carerName || null, app: "v3",
        cam_engine: anyCam ? ((cf || ct || {}).quality || {}).engine || "cam-2.0" : null, ftsst_quality: cf ? cf.quality || null : null,
        methods: { ftsst: cf ? "camera-pose" : "manual", tug: ct ? "camera-pose" : "manual", balance: rec.balCam && rec.balCam.some(Boolean) ? "camera-pose" : "manual" },
        steadi: { fell: rec.fallsCount != null && rec.fallsCount >= 1 && rec.fallsCount !== 9, worried: !!rec.worried, unsteady: null },
        tug: ct ? { out: ct.out, back: ct.back, distance_ok: ct.distanceOk, turn_by: "camera", back_by: "camera", ended_by: "camera", mark_turn: false, reach: ct.reaction, drift: ct.drift, gait: ct.gait || null, meters: ct.meters == null ? null : ct.meters, quality: ct.quality || null }
                : { out: null, back: null, distance_ok: rec.tug != null ? true : null, turn_by: null, back_by: null, ended_by: "carer", mark_turn: false, reach: null, drift: null },
        balance: { passed: balPassed, seconds: rec.balance,
                   label: balPassed == null ? null : "ทรงตัวผ่าน " + balPassed + " จาก 4 ท่า" + (rec.balance != null ? " · ยืนต่อเท้า " + rec.balance + " วินาที" : ""),
                   stages: stages.length ? stages : null, alone: false, alone_skip: false },
        skipped: rec.skipped || {}, note: rec.note || null,
        adl: rec.adl, pending_expert: !!rec.pending
      }
    };
  }
  function fallSeverity(f) {
    var hi = /พบแพทย์|โรงพยาบาล/.test(f.injury || "") || /ลุกเองไม่ได้/.test(f.getup || "");
    var lo = /ไม่บาดเจ็บ/.test(f.injury || "") && /ได้ทันที/.test(f.getup || "");
    return hi ? "high" : lo ? "low" : "medium";
  }
  function birthYearBE(age) { return new Date().getFullYear() + 543 - age; }

  var pure = { ENGINE: ENGINE, CADENCE: CADENCE, REFERRAL: REFERRAL, SIGNAL_DEFS: SIGNAL_DEFS,
               flagsOf: flagsOf, signalsOf: signalsOf, levelOf: levelOf, payloadOf: payloadOf,
               fallSeverity: fallSeverity, birthYearBE: birthYearBE };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  /* ---------- ส่วนที่คุยกับระบบกลาง (เบราว์เซอร์เท่านั้น) ---------- */
  var B = g.CSBackend, state = { ready: false, user: null, profile: null, error: null };
  async function init() {
    if (!B) { state.error = "no backend"; return state; }
    try {
      await B.init();
      if (B.isCloud()) { state.user = await B.currentUser(); if (state.user) { try { state.profile = await B.loadProfile(); } catch (e) {} } }
      state.ready = true;
    } catch (e) { state.error = String(e.message || e); }
    return state;
  }
  function connected() { return !!(B && B.isCloud() && state.user); }
  function mode() { return !B || !B.isCloud() ? "local" : (state.user ? "cloud" : "signed-out"); }

  async function profileFields(elder, caregiver) {
    return { display_name: elder.name, birth_year_be: birthYearBE(elder.age),
             carer_name: caregiver.name || null, carer_phone: caregiver.phone || null,
             mobility_aid: elder.aid || null };
  }
  /* ลูกหลานเป็นคนกรอกเบอร์และ PIN เองในหน้าจอ — โค้ดนี้ส่งต่อให้ระบบยืนยันตัวตนของ V2 เท่านั้น */
  async function register(phone, pin, elder, caregiver) {
    state.user = await B.signUpUser(phone, pin);
    if (!state.user) throw new Error("signup");
    state.profile = await B.updateProfile(await profileFields(elder, caregiver));
    try { await B.grantConsent("v3.carer_assess", "PDPA-1.0", { by: "carer", carer: caregiver.name || null }); } catch (e) {}
    await B.audit("v3.register", state.user.id, "ลูกหลานเปิดบัญชีให้ผู้สูงอายุผ่าน CareSignal V3");
    return state;
  }
  async function signIn(phone, pin, elder, caregiver) {
    state.user = await B.signInUser(phone, pin);
    state.profile = B.getProfile ? B.getProfile() : null;
    if (elder && caregiver) { try { state.profile = await B.updateProfile(await profileFields(elder, caregiver)); } catch (e) {} }
    return state;
  }
  async function signOut() { await B.signOut(); state.user = null; state.profile = null; }

  /* ผลวัด → assessments → risk_signals (ทริกเกอร์เปิดเคส) → referrals ถ้าระดับส้ม/แดง */
  async function syncAssessment(rec, elder, caregiver) {
    if (!connected()) throw new Error("offline");
    var a = await B.saveAssessment(payloadOf(rec, elder, caregiver.name));
    var tr = levelOf(rec), rs = null, ref = null;
    try {
      rs = await B.saveRiskSignal(a.id, tr);
    } catch (e) {   /* ฐานข้อมูลที่ยังไม่รัน 23_v3_carer.sql ไม่มีคอลัมน์ signals */
      if (/signals/.test(String(e.message || e))) rs = await B.saveRiskSignal(a.id, { level: tr.level, flags: tr.flags, nextDays: tr.nextDays, engine: tr.engine });
      else throw e;
    }
    if (tr.referral.need) { try { ref = await B.createReferral(rs.id, tr); } catch (e) { console.warn("referral", e); } }
    return { assessmentId: a.id, signalId: rs && rs.id, referralId: ref && ref.id, level: tr.level, referral: tr.referral };
  }
  async function reportFall(f) {
    if (!connected()) throw new Error("offline");
    return B.reportEvent("fall", { where: f.where, injury: f.injury, getup: f.getup, app: "v3", reported_by: "carer" }, fallSeverity(f));
  }
  async function careStatus() {
    if (!connected()) return { cases: [], referrals: [], followUps: [], appts: [], prev: [] };
    var cases = await B.myCases(5), refs = [], fu = [];
    try { refs = await B.myReferrals(); } catch (e) {}
    /* นัดติดตามที่เจ้าหน้าที่ตั้งไว้ — แสดงในหน้านัดหมายของครอบครัว */
    try { fu = await B.listFollowUps(null, 30); } catch (e) {}
    /* นัดวิดีโอคอลกับผู้เชี่ยวชาญ ผลยืนยันครั้งสุดท้าย และผลพิจารณาบริการป้องกัน (27_teleconsult.sql) */
    var appts = [], prev = [];
    try { if (B.myAppointments) appts = await B.myAppointments(); } catch (e) {}
    try { if (B.myPrevention) prev = await B.myPrevention(); } catch (e) {}
    return { cases: cases, referrals: refs, followUps: fu, appts: appts, prev: prev };
  }
  async function pullAssessments() {
    if (!connected()) return [];
    var rows = await B.listAssessments(200);
    return rows.map(function (r) {
      var d = r.detail || {}, fd = r.falls_detail || {}, md = r.meds_detail || {};
      return { cloudId: r.id, date: r.assessed_at, ftsst: r.ftsst_seconds, tug: r.tug_seconds,
               balance: d.balance ? d.balance.seconds : null, score: r.score, max: r.score_max, tier: r.tier,
               parts: r.parts || {}, method: r.method, by: d.carer_name || null, fromCloud: true,
               balPassed: d.balance && d.balance.passed != null ? d.balance.passed : null,
               balStages: d.balance && d.balance.stages ? d.balance.stages.map(function (x) { return x.seconds; }) : null,
               fallsCount: fd.count != null ? fd.count : null, injury: fd.injury || null, getup: fd.getup || null,
               worried: d.steadi ? !!d.steadi.worried : null, medsCount: md.count != null ? md.count : null,
               fridHigh: md.frid_high != null ? md.frid_high : null, fridTotal: md.frid_total != null ? md.frid_total : null,
               adl: d.adl != null ? d.adl : null, note: d.note || null };
    });
  }

  g.CSCloud = Object.assign({ init: init, state: state, connected: connected, mode: mode, register: register, signIn: signIn,
                              signOut: signOut, syncAssessment: syncAssessment, reportFall: reportFall, careStatus: careStatus,
                              pullAssessments: pullAssessments }, pure);
})(typeof globalThis !== "undefined" ? globalThis : this);
