/* ============================================================
   cs-incident.js — การแจ้งเหตุ (Incident report / First Notice of Loss)
   ------------------------------------------------------------
   แหล่งเดียวของ: ชนิดเหตุ · สถานที่ · การบาดเจ็บ · ผลต่อชีวิตประจำวัน · การจัดความรุนแรง
   ใช้ร่วมกันใน แอปครอบครัว V3 · คอนโซลเจ้าหน้าที่ · แดชบอร์ดบริษัทประกัน · โหมดสาธิต
   หลัก
   · ครอบครัวแจ้ง → ทีมดูแลได้รับทันที (care_events → เปิด/ยกระดับเคส)
   · บริษัทประกันเห็นเฉพาะ "ภาพรวมไม่ระบุตัวตน" (summarize) — ไม่มีชื่อ ไม่มี user_id
     ถ้าครอบครัวจะใช้สิทธิ์เคลม แอปทำใบสรุปให้ครอบครัวส่งเอง ระบบไม่ส่งแทน
   · ข้อมูลการแจ้งเหตุไม่ใช้พิจารณาสินไหมหรือเบี้ยรายบุคคล
   · เกณฑ์ความรุนแรง: ล้มแล้วบาดเจ็บจนต้องพบแพทย์ / ลุกเองไม่ได้ / นอนบนพื้นนาน = กลุ่มเสี่ยงสูง
     ตาม World Guidelines for Falls Prevention 2022 · ศีรษะกระแทก หมดสติ = ต้องโทร 1669
   ============================================================ */
(function (g) {
  var KINDS = {
    fall:      { nm: "หกล้ม", ic: "🤕", desc: "ล้มลงถึงพื้นหรือที่ต่ำกว่า" },
    near_fall: { nm: "เกือบล้ม", ic: "😰", desc: "สะดุด ลื่น เซ แต่ยังคว้าจับไว้ได้" },
    accident:  { nm: "อุบัติเหตุอื่น", ic: "⚠️", desc: "เช่น ถูกชน ของหล่นทับ ลวก ถูกของมีคม" },
    hospital:  { nm: "เข้าโรงพยาบาล / ห้องฉุกเฉิน", ic: "🏥", desc: "ไปห้องฉุกเฉินหรือนอนโรงพยาบาล ด้วยเหตุใดก็ตาม" },
    adl_drop:  { nm: "ช่วยเหลือตัวเองได้แย่ลงทันที", ic: "🛏️", desc: "จู่ ๆ เดินไม่ไหว ลุกไม่ได้ หรือต้องมีคนช่วยมากขึ้น" },
    med_change: { nm: "ปรับยา", ic: "💊", desc: "" }, dizzy: { nm: "เวียนหัว", ic: "😵", desc: "" }
  };
  var ACC = { hit: "ถูกรถหรือคนชน", struck: "ของหล่นทับ / กระแทก", burn: "น้ำร้อนลวก / ไฟไหม้", cut: "ถูกของมีคม", animal: "สัตว์กัดหรือข่วน", choke: "สำลักอาหาร", other: "อื่น ๆ" };
  var PLACE = { bathroom: "ห้องน้ำ", bedroom: "ห้องนอน / ข้างเตียง", stairs: "บันได", kitchen: "ห้องครัว", walkway: "ทางเดินในบ้าน", yard: "หน้าบ้าน / สนาม", away: "นอกบ้าน / ที่สาธารณะ", other: "อื่น ๆ" };
  /* สถานที่ → หมวดในแบบสำรวจความปลอดภัยในบ้าน (cs-assess.js) */
  var PLACE_AREA = { bathroom: "bath", bedroom: "light", stairs: "stairs", kitchen: "kitchen", walkway: "floor", yard: "floor" };
  var ACTIVITY = { night_toilet: "ลุกเข้าห้องน้ำตอนกลางคืน", getting_up: "ลุกจากเตียงหรือเก้าอี้", walking: "เดินในบ้าน", stairs: "ขึ้นลงบันได", bathing: "อาบน้ำ", reaching: "เอื้อมหยิบของ / ปีน", outdoor: "เดินนอกบ้าน", other: "อื่น ๆ / ไม่ทราบ" };
  var WHEN = { morning: "เช้า", day: "กลางวัน", evening: "เย็น", night: "กลางคืน" };
  var INJURY = { none: "ไม่บาดเจ็บ", minor: "ฟกช้ำ แผลเล็กน้อย", doctor: "ต้องพบแพทย์", admit: "นอนโรงพยาบาล", fracture: "กระดูกหัก" };
  var GETUP = { self_now: "ลุกเองได้ทันที", self_slow: "ลุกเองได้แต่ใช้เวลานาน", helped: "ต้องมีคนช่วยพยุง", cannot: "ลุกเองไม่ได้" };
  var LIE = { lt5: "ไม่ถึง 5 นาที", m5to60: "5 นาที – 1 ชั่วโมง", gt60: "นานกว่า 1 ชั่วโมง", unknown: "ไม่ทราบ (ไม่มีใครเห็น)" };
  var IMPACT = { same: "เดินและทำกิจวัตรได้เหมือนเดิม", walk_worse: "เดินได้แย่ลง / เจ็บเวลาเดิน", need_help: "ต้องมีคนช่วยมากขึ้น", bedbound: "ลุกจากเตียงไม่ได้ / ติดเตียง" };

  /* ความรุนแรง → ระดับเคสและกำหนดติดต่อกลับ (ตรงกับทริกเกอร์ SQL 23/28) */
  function severity(x) {
    x = x || {};
    if (x.kind === "hospital") return "high";
    if (x.head || x.loc || x.getup === "cannot" || x.lie === "gt60" || x.impact === "bedbound" || x.impact === "need_help" ||
        ["doctor", "admit", "fracture"].indexOf(x.injury) >= 0) return "high";
    if (x.kind === "near_fall" && (!x.injury || x.injury === "none")) return "low";
    if ((x.injury === "none" || !x.injury) && (!x.getup || x.getup === "self_now") && (!x.impact || x.impact === "same")) return x.kind === "fall" ? "medium" : "low";
    return "medium";
  }
  var SEV = { high: { nm: "รุนแรง", sla: 24, cls: "bad" }, medium: { nm: "ปานกลาง", sla: 48, cls: "warn" }, low: { nm: "เล็กน้อย", sla: 72, cls: "ok" } };
  /* ต้องโทร 1669 ทันที (แสดงก่อนกรอกฟอร์ม และเตือนซ้ำเมื่อติ๊ก) */
  function redFlags(x) {
    x = x || {}; var r = [];
    if (x.head) r.push("ศีรษะกระแทก"); if (x.loc) r.push("หมดสติหรือจำเหตุการณ์ไม่ได้");
    if (x.getup === "cannot") r.push("ลุกเองไม่ได้"); if (x.injury === "fracture") r.push("สงสัยกระดูกหัก");
    return r;
  }
  function lbl(map, k) { return k ? (map[k] || k) : ""; }
  /* ข้อความสั้นหนึ่งบรรทัด ใช้ในคอนโซลเจ้าหน้าที่และประวัติ */
  function describe(kind, d) {
    d = d || {}; var p = [];
    if (kind === "accident" && d.acc_type) p.push(lbl(ACC, d.acc_type));
    if (d.place) p.push(lbl(PLACE, d.place)); else if (d.where) p.push(d.where);
    if (d.activity) p.push(lbl(ACTIVITY, d.activity));
    if (d.when_part) p.push(lbl(WHEN, d.when_part));
    if (d.injury_code) p.push(lbl(INJURY, d.injury_code)); else if (d.injury) p.push(d.injury);
    if (d.head) p.push("ศีรษะกระแทก"); if (d.loc) p.push("หมดสติ");
    if (d.getup_code) p.push(lbl(GETUP, d.getup_code)); else if (d.getup) p.push(d.getup);
    if (d.lie === "gt60") p.push("นอนบนพื้นนานกว่า 1 ชม.");
    if (d.impact && d.impact !== "same") p.push(lbl(IMPACT, d.impact));
    if (d.hospital_name) p.push("รพ. " + d.hospital_name);
    return p.join(" · ");
  }
  /* ข้อมูลที่ส่งเข้า care_events.detail — มีทั้งรหัส (ใช้นับ) และข้อความไทย (ทริกเกอร์ SQL 23 อ่าน where/injury) */
  function toDetail(x) {
    return { v: 2, kind: x.kind, when_date: x.when_date || null, when_part: x.when_part || null,
      place: x.place || null, where: x.place ? lbl(PLACE, x.place) + (x.place_note ? " (" + x.place_note + ")" : "") : (x.place_note || null),
      activity: x.activity || null, acc_type: x.acc_type || null,
      injury_code: x.injury || null, injury: x.injury ? lbl(INJURY, x.injury) : null, body: x.body || null,
      head: !!x.head, loc: !!x.loc, getup_code: x.getup || null, getup: x.getup ? lbl(GETUP, x.getup) : null, lie: x.lie || null,
      impact: x.impact || null, hospital_name: x.hospital_name || null, note: x.note || null, red_flags: redFlags(x) };
  }

  /* ---------- ภาพรวมไม่ระบุตัวตน (แดชบอร์ดบริษัทประกัน) ----------
     events = [{kind, severity, detail, created_at}] · ไม่รับ/ไม่คืน user_id หรือชื่อ
     กลุ่มที่นับได้น้อยกว่า 3 ครั้งจะแสดงเป็น "<3" กันการเดาตัวบุคคล */
  function summarize(events, days) {
    var since = Date.now() - (days || 365) * 864e5, E = (events || []).filter(function (e) { return new Date(e.created_at).getTime() >= since; });
    function count(f) { var o = {}; E.forEach(function (e) { var k = f(e); if (k) o[k] = (o[k] || 0) + 1; }); return o; }
    var d = function (e) { return e.detail || {}; };
    return {
      total: E.length,
      by_kind: count(function (e) { return e.kind; }),
      by_severity: count(function (e) { return e.severity || "medium"; }),
      by_place: count(function (e) { return (e.kind === "fall" || e.kind === "near_fall") ? d(e).place || null : null; }),
      by_activity: count(function (e) { return e.kind === "fall" ? d(e).activity || null : null; }),
      serious: { admit_or_fracture: E.filter(function (e) { return ["admit", "fracture"].indexOf(d(e).injury_code) >= 0; }).length,
                 head: E.filter(function (e) { return d(e).head; }).length,
                 long_lie: E.filter(function (e) { return d(e).lie === "gt60" || d(e).getup_code === "cannot"; }).length,
                 new_dependency: E.filter(function (e) { return d(e).impact === "bedbound" || d(e).impact === "need_help" || e.kind === "adl_drop"; }).length },
      days: days || 365
    };
  }
  function small(n) { return n > 0 && n < 3 ? "<3" : String(n || 0); }

  var API = { KINDS: KINDS, ACC: ACC, PLACE: PLACE, PLACE_AREA: PLACE_AREA, ACTIVITY: ACTIVITY, WHEN: WHEN, INJURY: INJURY, GETUP: GETUP, LIE: LIE, IMPACT: IMPACT,
              SEV: SEV, severity: severity, redFlags: redFlags, describe: describe, toDetail: toDetail, summarize: summarize, small: small, label: lbl };
  g.CSIncident = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
