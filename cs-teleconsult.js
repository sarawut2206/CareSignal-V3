/* ============================================================
   cs-teleconsult.js — นัดตรวจทางวิดีโอคอล · แบบยืนยันผลครั้งสุดท้าย · คำขออนุมัติบริการที่ผู้เชี่ยวชาญแนะนำ
   ------------------------------------------------------------
   แหล่งเดียวของชื่อสถานะ รายการบริการที่แนะนำ แบบฟอร์มยืนยันผล และหน้าตารายงาน
   ใช้ร่วมกันใน CareSignal-Staff.html (ผู้เชี่ยวชาญ ผู้ประสานงาน บริษัทประกัน)
   CareSignal-App.html ของ V3 (ครอบครัว) และ CareSignal-Visit.html (ห้องวิดีโอคอล)
   กฎเดียวกับ supabase/27_teleconsult.sql:
     · ผู้เชี่ยวชาญเสนอเวลา 1–3 ช่วง ครอบครัวเลือก
     · เข้าห้องได้ก่อนนัด 15 นาที ถึง 60 นาทีหลังหมดเวลานัด
     · แบบยืนยันผลต้องลงชื่อ เลขใบอนุญาต และรับรองว่าตรวจเอง แก้ไขไม่ได้หลังส่ง
     · ห้ามคำสั่งหยุดยา — ใช้ถ้อยคำ "ทบทวนกับผู้สั่งใช้ยา"
     · ส่งบริษัทประกันได้เฉพาะผลที่ยืนยันว่าเสี่ยงจริง และครอบครัวยินยอม
       บริษัทประกันเห็นแบบไม่ระบุชื่อ ใช้อนุมัติบริการที่ผู้เชี่ยวชาญแนะนำเท่านั้น
   ============================================================ */
(function (g) {
  var DEST = { doctor: "แพทย์", pharmacist: "เภสัชกร", physio: "นักกายภาพบำบัด", nurse: "พยาบาล" };
  var RISK = {
    confirmed: ["ยืนยันว่ามีความเสี่ยงหกล้มจริง", "#B3261E"],
    uncertain: ["ยังสรุปไม่ได้ ต้องตรวจเพิ่ม", "#8A5300"],
    not_confirmed: ["ไม่พบความเสี่ยงที่ต้องดูแลเพิ่ม", "#0A7A3E"]
  };
  var LEVEL = { low: "ต่ำ", moderate: "ปานกลาง", high: "สูง" };
  var DOMAINS = [["falls", "ประวัติหกล้ม"], ["strength", "กำลังขา"], ["gait", "การเดิน"], ["balance", "การทรงตัว"],
    ["meds", "ยาที่เพิ่มความเสี่ยง"], ["bp", "ความดันตกเมื่อลุกยืน"], ["vision", "สายตา"], ["home", "ความปลอดภัยในบ้าน"],
    ["adl", "กิจวัตรประจำวัน"], ["cognition", "ความจำและการรับรู้"]];
  var SERVICES = [["physio_program", "โปรแกรมฝึกกำลังขาและการทรงตัวกับนักกายภาพบำบัด"], ["exercise_group", "กลุ่มออกกำลังกายลดความเสี่ยงล้ม (Otago · ไทชิ)"],
    ["med_review", "ทบทวนยากับแพทย์ผู้สั่งใช้ยา"], ["doctor_followup", "ติดตามกับแพทย์"], ["home_mod", "ปรับบ้าน: ราวจับ พื้นกันลื่น ไฟกลางคืน"],
    ["assistive", "อุปกรณ์ช่วยเดิน"], ["vision", "ตรวจสายตาและแว่น"], ["caregiver_training", "สอนผู้ดูแลเรื่องการพยุงและลดความเสี่ยงล้ม"],
    ["alarm", "อุปกรณ์แจ้งเหตุฉุกเฉิน"]];
  var DEFAULT_SERVICES = { doctor: ["doctor_followup", "med_review"], pharmacist: ["med_review"], physio: ["physio_program", "assistive"], nurse: ["home_mod", "caregiver_training"] };
  var APPT_ST = { proposed: "รอครอบครัวเลือกเวลา", confirmed: "ยืนยันนัดแล้ว", in_call: "กำลังตรวจ", done: "ตรวจแล้ว", cancelled: "ยกเลิก", no_show: "ไม่มาตามนัด" };
  var CM_ST = { "new": "รอผู้ประสานงานส่งบริษัทประกัน", sent: "ส่งบริษัทประกันแล้ว", not_needed: "ไม่ต้องส่ง", no_consent: "ครอบครัวไม่ยินยอมให้ส่ง" };
  var DECISION = { pending: "รอบริษัทประกันพิจารณา", approved: "อนุมัติบริการทั้งหมด", partial: "อนุมัติบางรายการ", need_info: "ขอข้อมูลเพิ่ม", declined: "ไม่อยู่ในความคุ้มครอง" };
  var NO_STOP = /(ให้หยุดยา|หยุดยาทันที|เลิกยา)/;
  var EARLY_MIN = 15, LATE_MIN = 60;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function nm(list, k) { for (var i = 0; i < list.length; i++) if (list[i][0] === k) return list[i][1]; return k; }
  function when(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "2-digit" }) + " · " +
      d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) + " น.";
  }
  /* ช่วงเวลาที่เข้าห้องได้ — ตรงกับ appt_join() */
  function joinWindow(a, now) {
    now = now || Date.now();
    if (!a || !a.slot_at || ["confirmed", "in_call"].indexOf(a.status) < 0) return { open: false, why: "ยังไม่มีนัดที่ยืนยัน" };
    var t = new Date(a.slot_at).getTime(), from = t - EARLY_MIN * 6e4, to = t + ((a.minutes || 20) + LATE_MIN) * 6e4;
    if (now < from) { var m = Math.ceil((from - now) / 6e4); return { open: false, why: m > 90 ? "เข้าห้องได้ " + EARLY_MIN + " นาทีก่อนนัด" : "เข้าห้องได้ในอีก " + m + " นาที", early: m }; }
    if (now > to) return { open: false, why: "เลยเวลานัดแล้ว" };
    return { open: true, why: "เข้าห้องได้เลย" };
  }
  function visitURL(apptId, as) {
    var q = new URLSearchParams();
    q.set("a", apptId); q.set("as", as);
    try { var d = new URLSearchParams(location.search).get("demo"); if (d) q.set("demo", d); } catch (e) {}
    return "./CareSignal-Visit.html?" + q.toString();
  }
  /* เวลาที่เสนอเริ่มต้น: วันทำการถัดไป 10:00 · 14:00 · และวันถัดไปอีกวัน 10:00 */
  function defaultOptions(now) {
    var d = new Date(now || Date.now()), out = [];
    function next(x) { x = new Date(x); do { x.setDate(x.getDate() + 1); } while (x.getDay() === 0 || x.getDay() === 6); return x; }
    var d1 = next(d), d2 = next(d1);
    [[d1, 10], [d1, 14], [d2, 10]].forEach(function (p) { var x = new Date(p[0]); x.setHours(p[1], 0, 0, 0); out.push(x); });
    return out;
  }
  function localInput(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---------- แบบยืนยันผลครั้งสุดท้าย ---------- */
  function formHTML(a, o) {
    o = o || {};
    var dest = a.destination, pre = DEFAULT_SERVICES[dest] || [];
    var chk = function (name, list, on) {
      return '<div class="tc-grid">' + list.map(function (x) {
        return '<label class="tc-chk"><input type="checkbox" name="' + name + '" value="' + x[0] + '"' + (on.indexOf(x[0]) >= 0 ? " checked" : "") + '> ' + esc(x[1]) + '</label>';
      }).join("") + '</div>';
    };
    return '<div class="tc-form">' +
      '<div class="tc-head"><div><div class="tc-k">แบบยืนยันผลครั้งสุดท้าย · ตรวจทางวิดีโอคอล</div>' +
      '<h3>' + esc(o.who || "") + '</h3><p>' + esc(DEST[dest] || dest) + ' · นัด ' + esc(when(a.slot_at)) + '</p></div></div>' +
      '<div class="tc-note">เอกสารนี้เป็นการยืนยันผลครั้งสุดท้ายของวิชาชีพ ส่งกลับ CareSignal ทันทีเมื่อกดยืนยัน และ<b>แก้ไขไม่ได้</b>ภายหลัง · ' +
        'การตรวจทางวิดีโอมีข้อจำกัด ถ้าต้องตรวจร่างกายโดยตรงให้เลือก "ต้องพบตัวจริง"</div>' +
      '<h4>๑. ผลการยืนยันความเสี่ยงหกล้ม <span class="tc-req">*</span></h4><div class="tc-risk">' +
      ["confirmed", "uncertain", "not_confirmed"].map(function (k) {
        return '<label style="--c:' + RISK[k][1] + '"><input type="radio" name="tcRisk" value="' + k + '"> ' + RISK[k][0] + '</label>';
      }).join("") + '</div>' +
      '<div class="tc-lv"><h4>๒. ระดับความเสี่ยง <span class="tc-req">*</span></h4><div class="tc-risk">' +
      ["high", "moderate", "low"].map(function (k) { return '<label><input type="radio" name="tcLevel" value="' + k + '"> ' + LEVEL[k] + '</label>'; }).join("") + '</div></div>' +
      '<h4>๓. ด้านที่พบปัญหา</h4>' + chk("tcDom", DOMAINS, []) +
      '<h4>๔. ข้อค้นพบจากการตรวจ <span class="tc-req">*</span></h4><textarea id="tcFind" rows="3" placeholder="สิ่งที่ตรวจพบระหว่างวิดีโอคอล เช่น ท่าลุกนั่ง การเดินในบ้าน ยาที่ใช้จริง"></textarea>' +
      '<h4>๕. คำแนะนำ <span class="tc-req">*</span></h4><textarea id="tcRec" rows="3" placeholder="' + (dest === "pharmacist" ? "เรื่องยาใช้ถ้อยคำ &quot;เสนอให้ผู้สั่งใช้ยาทบทวน&quot; — ไม่สั่งหยุดยาเอง" : "สิ่งที่ครอบครัวและทีมดูแลควรทำต่อ") + '"></textarea>' +
      '<h4>๖. บริการที่ผู้เชี่ยวชาญแนะนำ</h4>' + chk("tcSvc", SERVICES, pre) +
      '<div class="tc-row"><label>นัดติดตามภายใน <select id="tcDays"><option value="7">7 วัน</option><option value="14">14 วัน</option><option value="30" selected>30 วัน</option><option value="90">90 วัน</option></select></label>' +
      '<label class="tc-chk"><input type="checkbox" id="tcInPerson"> ต้องพบตัวจริงที่หน่วยบริการ</label></div>' +
      '<h4>๗. ผู้ยืนยันผล <span class="tc-req">*</span></h4><div class="tc-row">' +
      '<label>ชื่อ–สกุล <input id="tcName" value="' + esc(o.signer || "") + '"></label>' +
      '<label>เลขที่ใบอนุญาตประกอบวิชาชีพ <input id="tcLic" value="' + esc(o.license || "") + '"></label></div>' +
      '<label class="tc-att"><input type="checkbox" id="tcAtt"> ข้าพเจ้าตรวจผู้รับบริการผ่านวิดีโอคอลด้วยตนเอง ข้อมูลข้างต้นเป็นความจริงตามวิชาชีพ ' +
      'และทราบว่ายืนยันแล้วแก้ไขไม่ได้</label>' +
      '</div>';
  }
  function collect(root) {
    var q = function (s) { return root.querySelector(s); };
    var all = function (s) { return [].slice.call(root.querySelectorAll(s)).map(function (x) { return x.value; }); };
    var risk = (q('input[name="tcRisk"]:checked') || {}).value, level = (q('input[name="tcLevel"]:checked') || {}).value;
    var d = { risk: risk || null, level: risk === "not_confirmed" ? "low" : (level || null), domains: all('input[name="tcDom"]:checked'),
      findings: q("#tcFind").value.trim(), recommend: q("#tcRec").value.trim(), services: risk === "not_confirmed" ? [] : all('input[name="tcSvc"]:checked'),
      follow_days: +q("#tcDays").value, in_person: q("#tcInPerson").checked, signer_name: q("#tcName").value.trim(), license_no: q("#tcLic").value.trim(),
      attested: q("#tcAtt").checked };
    var e = [];
    if (!d.risk) e.push("เลือกผลการยืนยันความเสี่ยง");
    if (d.risk && d.risk !== "not_confirmed" && !d.level) e.push("เลือกระดับความเสี่ยง");
    if (d.findings.length < 10) e.push("เขียนข้อค้นพบอย่างน้อย 10 ตัวอักษร");
    if (d.recommend.length < 5) e.push("เขียนคำแนะนำ");
    if (NO_STOP.test(d.recommend)) e.push("คำแนะนำเรื่องยาให้ใช้ถ้อยคำว่า ทบทวนกับผู้สั่งใช้ยา — การปรับยาเป็นของผู้สั่งใช้");
    if (!d.signer_name || !d.license_no) e.push("ลงชื่อและเลขที่ใบอนุญาต");
    if (!d.attested) e.push("ติ๊กรับรองว่าตรวจด้วยตนเอง");
    return { ok: !e.length, errors: e, data: d };
  }
  function bindForm(root) {
    var sync = function () {
      var r = (root.querySelector('input[name="tcRisk"]:checked') || {}).value;
      var lv = root.querySelector(".tc-lv"); if (lv) lv.style.display = r === "not_confirmed" ? "none" : "";
    };
    root.addEventListener("change", sync); sync();
  }
  /* ผลที่ส่งกลับใบส่งต่อเดิม — ให้ทุกหน้าที่อ่านผลทบทวน (ผู้ประสานงาน ครอบครัว) เห็นผลนี้ด้วย */
  function toReview(d) {
    return {
      finding: d.findings, recommend: d.recommend,
      next_step: d.risk === "confirmed" ? "follow_plan" : d.risk === "not_confirmed" ? "sufficient" : "book_assessment",
      note: "ยืนยันผลครั้งสุดท้ายหลังวิดีโอคอล" + (d.in_person ? " · ต้องพบตัวจริง" : ""),
      form: { verdict: d.risk === "confirmed" ? "confirm" : d.risk === "not_confirmed" ? "not_confirm" : "follow_up", via: "teleconsult", final: true }
    };
  }

  /* ---------- หน้าตารายงาน (อ่านอย่างเดียว / พิมพ์) ---------- */
  function reportHTML(fr, o) {
    o = o || {};
    var rk = RISK[fr.risk] || ["—", "#555"];
    return '<div class="tc-rep">' +
      '<div class="tc-rep-h"><div><div class="tc-k">แบบยืนยันผลครั้งสุดท้าย · ' + esc(DEST[fr.destination] || fr.destination) + '</div>' +
      (o.who ? '<b>' + esc(o.who) + '</b>' : '') + '</div><span class="tc-pill" style="background:' + rk[1] + '">' + esc(rk[0]) + '</span></div>' +
      (fr.level && fr.risk !== "not_confirmed" ? '<div class="tc-line"><span>ระดับความเสี่ยง</span><b>' + esc(LEVEL[fr.level] || fr.level) + '</b></div>' : '') +
      (fr.domains && fr.domains.length ? '<div class="tc-line"><span>ด้านที่พบปัญหา</span><b>' + fr.domains.map(function (k) { return esc(nm(DOMAINS, k)); }).join(" · ") + '</b></div>' : '') +
      '<div class="tc-line"><span>ข้อค้นพบ</span><b>' + esc(fr.findings) + '</b></div>' +
      '<div class="tc-line"><span>คำแนะนำ</span><b>' + esc(fr.recommend) + '</b></div>' +
      (fr.services && fr.services.length ? '<div class="tc-line"><span>บริการที่ผู้เชี่ยวชาญแนะนำ</span><b>' + fr.services.map(function (k) { return "• " + esc(nm(SERVICES, k)); }).join("<br>") + '</b></div>' : '') +
      '<div class="tc-line"><span>ติดตาม</span><b>' + (fr.follow_days ? "ภายใน " + fr.follow_days + " วัน" : "—") + (fr.in_person ? " · ต้องพบตัวจริงที่หน่วยบริการ" : "") + '</b></div>' +
      (o.hideSigner ? '' : '<div class="tc-sign">ลงชื่อ ' + esc(fr.signer_name) + ' · ใบอนุญาตเลขที่ ' + esc(fr.license_no) + ' · ' + esc(when(fr.signed_at)) +
        '<br><small>รับรองว่าตรวจผ่านวิดีโอคอลด้วยตนเอง · ยืนยันแล้วแก้ไขไม่ได้</small></div>') +
      '</div>';
  }
  /* สรุปสำหรับบริษัทประกัน — ไม่มีชื่อ รหัส เบอร์ หรือถ้อยคำจากข้อค้นพบที่อาจระบุตัวตน */
  function summaryFor(fr, ageBand) {
    var dom = (fr.domains || []).map(function (k) { return nm(DOMAINS, k); });
    return "ผู้เอาประกัน" + (ageBand ? " อายุ " + ageBand : "") + " ได้รับการตรวจทางวิดีโอคอลโดย" + (DEST[fr.destination] || "ผู้เชี่ยวชาญ") +
      " ยืนยันความเสี่ยงหกล้มระดับ" + (LEVEL[fr.level] || "—") + (dom.length ? " ด้าน" + dom.join(" ") : "") +
      " · แนะนำบริการตามรายการ เพื่อลดความเสี่ยงหกล้มและการบาดเจ็บ · ติดตามผลภายใน " + (fr.follow_days || 30) + " วัน";
  }
  function ageBand(birthYearBE) {
    if (!birthYearBE) return null;
    var age = new Date().getFullYear() + 543 - birthYearBE;
    return age < 70 ? "60–69 ปี" : age < 80 ? "70–79 ปี" : "80 ปีขึ้นไป";
  }
  /* ตรวจก่อนส่งให้ตรงกับ cm_send_prevention() */
  function leaksIdentity(text, prof) {
    prof = prof || {};
    if (prof.display_name && prof.display_name.length > 1 && text.indexOf(prof.display_name) >= 0) return "มีชื่อผู้เอาประกัน";
    if (prof.pseudonym && text.indexOf(prof.pseudonym) >= 0) return "มีรหัสสมาชิก";
    if (/0[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{3,4}/.test(text)) return "มีเบอร์โทร";
    return null;
  }

  var CSS = [
    ".tc-form h4{margin:14px 0 6px;font-size:14.5px}.tc-req{color:#B3261E}",
    ".tc-head h3{margin:2px 0}.tc-head p{margin:0;color:#5A6875;font-size:13px}.tc-k{font-size:12px;color:#5A6875;font-weight:600}",
    ".tc-note{background:#FFF8EC;border:1px solid #F1D4A6;border-radius:10px;padding:8px 12px;font-size:12.5px;margin:10px 0;line-height:1.55}",
    ".tc-risk{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}",
    ".tc-risk label{border:1.5px solid #D9E1EC;border-left:5px solid var(--c,#D9E1EC);border-radius:10px;padding:10px 12px;cursor:pointer;font-weight:600;font-size:13.5px;display:flex;gap:8px;align-items:center;background:#fff}",
    ".tc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 12px}",
    ".tc-chk{display:flex;gap:8px;align-items:flex-start;font-size:13.5px;padding:3px 0;cursor:pointer}",
    ".tc-form textarea,.tc-form input:not([type]),.tc-form select{width:100%;font:inherit;font-size:14px;border:1.5px solid #D9E1EC;border-radius:10px;padding:9px 11px;box-sizing:border-box;background:#fff;color:inherit}",
    ".tc-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:end;margin-top:8px}.tc-row label{font-size:13px;display:block}",
    ".tc-att{display:flex;gap:10px;align-items:flex-start;background:#F3FAF8;border:1px solid #CFE3DF;border-radius:10px;padding:10px 12px;margin-top:12px;font-size:13.5px;line-height:1.55;cursor:pointer}",
    ".tc-rep{border:1px solid #D9E1EC;border-radius:12px;padding:12px 14px;background:#fff}",
    ".tc-rep-h{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:6px}",
    ".tc-pill{color:#fff;border-radius:99px;padding:3px 10px;font-size:12px;font-weight:700;white-space:nowrap}",
    ".tc-line{display:grid;grid-template-columns:130px 1fr;gap:8px;padding:6px 0;border-top:1px solid #EEF1F4;font-size:13.5px}.tc-line span{color:#5A6875}.tc-line b{font-weight:500}",
    ".tc-sign{margin-top:8px;padding-top:8px;border-top:1px dashed #C9D2DC;font-size:12.5px;color:#34424F}.tc-sign small{color:#5A6875}",
    "@media (max-width:520px){.tc-line{grid-template-columns:1fr}}"
  ].join("\n");
  function injectCSS() {
    if (typeof document === "undefined" || document.getElementById("tcCSS")) return;
    var s = document.createElement("style"); s.id = "tcCSS"; s.textContent = CSS; (document.head || document.body).appendChild(s);
  }
  if (typeof document !== "undefined") { if (document.head) injectCSS(); else document.addEventListener("DOMContentLoaded", injectCSS); }

  var API = { DEST: DEST, RISK: RISK, LEVEL: LEVEL, DOMAINS: DOMAINS, SERVICES: SERVICES, DEFAULT_SERVICES: DEFAULT_SERVICES,
    APPT_ST: APPT_ST, CM_ST: CM_ST, DECISION: DECISION, EARLY_MIN: EARLY_MIN, LATE_MIN: LATE_MIN,
    when: when, joinWindow: joinWindow, visitURL: visitURL, defaultOptions: defaultOptions, localInput: localInput,
    formHTML: formHTML, collect: collect, bindForm: bindForm, toReview: toReview, reportHTML: reportHTML,
    summaryFor: summaryFor, ageBand: ageBand, leaksIdentity: leaksIdentity, svcName: function (k) { return nm(SERVICES, k); },
    domName: function (k) { return nm(DOMAINS, k); } };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else g.CSTele = API;
})(typeof window !== "undefined" ? window : this);
