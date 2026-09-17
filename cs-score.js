/* ============================================================
   cs-score.js — เกณฑ์คะแนนของ CareSignal V3 (ลูกหลานเป็นผู้วัด)
   ------------------------------------------------------------
   ตัวเลขทุกตัวยกมาจาก CareSignal-App.html ของ V2 ตรง ๆ เพื่อให้ผลของ
   สองรุ่นเทียบกันได้ — ต่างกันเพียงว่า V3 ให้คนจับเวลาแทนกล้อง
     · ค่าตัดลุกนั่ง 5 ครั้ง 10.0 / 11.5 / 12.1 วินาที ตามช่วงอายุ (Poncumhak 2014; Intaruk 2021)
     · การเปลี่ยนแปลงที่มีความหมาย ≥ 2.3 วินาที หรือ ≥ 15% (Meretta 2006; Goldberg 2012)
     · ลุกเดิน 3 เมตร ≥ 12 วินาที (CDC STEADI)
     · ยืนต่อเท้าไม่ครบ 10 วินาที (CDC 4-Stage Balance Test)
   ไม่ใช่การวินิจฉัย — ผลเป็นสัญญาณให้ครอบครัวตัดสินใจพาไปพบผู้เชี่ยวชาญ
   ============================================================ */
(function (g) {
  function ftsstCut(age) { return age < 65 ? 10.0 : (age < 75 ? 11.5 : 12.1); }

  /* คำถามความปลอดภัยก่อนทดสอบ — ถ้ามีข้อใดเป็นสีแดง ห้ามทำท่าทดสอบวันนี้ */
  var SAFETY = [
    { k: "faint",  q: "วันนี้มีอาการหน้ามืด เวียนศีรษะมาก หรือเหมือนจะเป็นลมหรือไม่" },
    { k: "chest",  q: "วันนี้มีอาการเจ็บหน้าอก หายใจลำบากผิดปกติ หรือใจสั่นรุนแรงหรือไม่", urgent: true },
    { k: "stroke", q: "มีอาการอ่อนแรงเฉียบพลัน หน้าเบี้ยว พูดไม่ชัด หรือแขนขาชาหรือไม่", urgent: true },
    { k: "injury", q: "เพิ่งหกล้ม บาดเจ็บ ผ่าตัด หรือแพทย์ห้ามเดินลงน้ำหนักหรือไม่" }
  ];
  function safety(ans) {
    var reds = [], urgent = false;
    SAFETY.forEach(function (s) { if (ans[s.k]) { reds.push(s.k); if (s.urgent) urgent = true; } });
    return { safe: !reds.length, reds: reds, urgent: urgent };
  }

  /* ช่วงค่าที่เป็นไปได้ของคนจับเวลาด้วยมือ — นอกช่วงนี้ให้ถามยืนยันก่อนบันทึก */
  var RANGE = { ftsst: [4, 90], tug: [3, 120], balance: [0, 10] };
  function plausible(kind, v) {
    if (v == null || isNaN(v)) return false;
    var r = RANGE[kind]; return v >= r[0] && v <= r[1];
  }

  /* คะแนนหลัก 0–9 (ฐานเดียวกับ V2 ซึ่งไม่รวมการทรงตัวในคะแนนหลัก)
     a = { age, ftsst, fallsCount (0..4, 9=จำไม่ได้), medsCount (0..4, 9=ไม่แน่ใจ), adl (0..2) } */
  function score(a) {
    var s = 0, parts = {};
    var cut = ftsstCut(a.age), f = a.ftsst;
    parts.ftsst = f == null ? 0 : f <= cut ? 4 : f <= cut + 2 ? 3 : f <= cut + 4.5 ? 2 : f <= 60 ? 1 : 0;
    parts.falls = (a.fallsCount == null) ? 0 : ((a.fallsCount === 0 || a.fallsCount === 9) ? 2 : (a.fallsCount === 1 ? 1 : 0));
    parts.meds = (a.medsCount == null) ? 0 : ((a.medsCount >= 2 && a.medsCount !== 9) ? 0 : 1);
    parts.adl = a.adl == null ? 0 : a.adl;
    s = parts.ftsst + parts.falls + parts.meds + parts.adl;
    var tier = s >= 8 ? 4 : s >= 6 ? 3 : s >= 4 ? 2 : 1;
    return { score: s, max: 9, tier: tier, parts: parts, cut: cut };
  }

  /* ธงจากการวัดครั้งนี้ — สีแดงหมายถึงควรพบแพทย์ สีเหลืองหมายถึงเฝ้าดูและปรับสิ่งแวดล้อม */
  function flags(a) {
    var reds = [], yellows = [], cut = ftsstCut(a.age);
    if (a.fallsCount != null && a.fallsCount >= 2 && a.fallsCount !== 9)
      reds.push({ id: "B1", text: "หกล้มตั้งแต่ 2 ครั้งขึ้นไปใน 12 เดือน", why: "การล้มซ้ำเป็นตัวทำนายการล้มครั้งถัดไปที่ชัดที่สุด" });
    if (a.injury >= 2)
      reds.push({ id: "B2", text: "ล้มแล้วบาดเจ็บจนต้องพบแพทย์", why: "การล้มที่มีการบาดเจ็บบ่งชี้ความรุนแรงและความเสี่ยงกระดูกหักซ้ำ" });
    if (a.getup >= 3)
      reds.push({ id: "B4", text: "ล้มแล้วลุกขึ้นเองไม่ได้", why: "เสี่ยงนอนติดพื้นนานหากล้มขณะอยู่คนเดียว" });
    if (a.fallsCount === 1)
      yellows.push({ id: "B7", text: "หกล้ม 1 ครั้งใน 12 เดือน", why: "ล้มครั้งแรกเพิ่มโอกาสล้มซ้ำใน 12 เดือนถัดไปอย่างชัดเจน" });
    if (a.worried)
      yellows.push({ id: "B8", text: "รู้สึกไม่มั่นคงขณะเดิน หรือกังวลว่าจะล้ม", why: "ความรู้สึกของเจ้าตัวเป็นข้อคัดกรองข้อแรกของ CDC STEADI" });
    if (a.ftsst != null && a.ftsst > cut)
      yellows.push({ id: "B9", text: "ลุกนั่ง 5 ครั้งใช้เวลา " + a.ftsst.toFixed(1) + " วินาที เกินเกณฑ์อายุ " + cut + " วินาที", why: "สะท้อนกำลังกล้ามเนื้อขาส่วนล่างที่ลดลง" });
    if (a.tug != null && a.tug >= 12)
      yellows.push({ id: "B10", text: "ลุกเดิน 3 เมตรใช้เวลา " + a.tug.toFixed(1) + " วินาที (เกณฑ์ 12)", why: "เกณฑ์คัดกรองของ CDC STEADI" });
    /* ทรงตัว 4 ท่า: ผ่านไม่ถึงท่าที่ 3 (ยืนต่อเท้า) = เกณฑ์เดียวกับ V2 (balPassed < 3)
       ข้อมูลรุ่นแรกของ V3 มีแค่วินาทีของท่ายืนต่อเท้า จึงยังรองรับ a.balance ด้วย */
    if (a.balPassed != null) {
      if (a.balPassed < 3)
        yellows.push({ id: "B11", text: "ทรงตัวผ่าน " + a.balPassed + " จาก 4 ท่า ยืนต่อเท้าไม่ครบ 10 วินาที", why: "หนึ่งในสัญญาณเสี่ยงตาม CDC 4-Stage Balance Test" });
    } else if (a.balance != null && a.balance < 10)
      yellows.push({ id: "B11", text: "ยืนต่อเท้าได้ " + a.balance + " วินาที ไม่ครบ 10", why: "หนึ่งในสัญญาณเสี่ยงตาม 4-Stage Balance Test" });
    if (a.medsCount != null && a.medsCount >= 2 && a.medsCount !== 9)
      yellows.push({ id: "B12", text: "ใช้ยาประจำตั้งแต่ 4 รายการขึ้นไป", why: "การใช้ยาหลายชนิดสัมพันธ์กับความเสี่ยงหกล้มที่สูงขึ้น ควรให้เภสัชกรทบทวน ไม่ควรหยุดยาเอง" });
    /* ยาเสี่ยงหกล้ม (FRID) จากรูปซองยา — เกณฑ์เดียวกับ V2: คะแนนรวม (สูง×2 + ปานกลาง) ≥ 2 = B13
       ยาเสี่ยงสูง ≥ 2 รายการ ร่วมกับทรงตัวผ่านไม่เกิน 1 ท่า = B6 (แดง) */
    if (a.fridTotal != null && a.fridTotal >= 2)
      yellows.push({ id: "B13", text: "พบยาที่อาจเพิ่มความเสี่ยงหกล้ม", why: "กลุ่มยาตาม STOPPFall (Seppala 2021) ควรให้เภสัชกรหรือแพทย์ทบทวน ห้ามหยุดยาเอง" });
    if (a.fridHigh != null && a.fridHigh >= 2 && a.balPassed != null && a.balPassed <= 1)
      reds.push({ id: "B6", text: "ใช้ยาเสี่ยงหกล้มสูง " + a.fridHigh + " รายการ และทรงตัวได้ไม่เกิน 1 ท่า", why: "ยากลุ่มนี้ร่วมกับการทรงตัวที่ไม่ดีเพิ่มโอกาสล้มชัดเจน (CDC STEADI-Rx)" });
    if (a.adl != null && a.adl <= 1)
      yellows.push({ id: "B16", text: "ทำกิจวัตรประจำวันเองได้ไม่ครบ", why: "การพึ่งพิงที่เริ่มเพิ่มขึ้นเป็นสิ่งที่ประกันดูแลระยะยาวต้องรู้ให้เร็ว" });
    var level = reds.length ? "urgent" : (yellows.length ? "watch" : "stable");
    return { level: level, reds: reds, yellows: yellows };
  }

  /* เทียบกับครั้งก่อนของตัวเอง — prev/cur คือ assessment ที่มี ftsst, tug, balance */
  function trend(prev, cur) {
    var out = [];
    if (!prev) return out;
    if (prev.ftsst != null && cur.ftsst != null) {
      var d = cur.ftsst - prev.ftsst, pct = prev.ftsst ? d / prev.ftsst * 100 : 0;
      if (d >= 2.3 || pct >= 15)
        out.push({ id: "R1", text: "ลุกนั่งช้าลง " + d.toFixed(1) + " วินาทีจากครั้งก่อน", why: "ถึงเกณฑ์การเปลี่ยนแปลงที่มีความหมายทางคลินิก (≥ 2.3 วินาที หรือ ≥ 15%)" });
      else if (d <= -2.3 || pct <= -15)
        out.push({ id: "R1+", text: "ลุกนั่งเร็วขึ้น " + (-d).toFixed(1) + " วินาทีจากครั้งก่อน", good: true, why: "ดีขึ้นเกินเกณฑ์การเปลี่ยนแปลงที่มีความหมาย" });
    }
    if (prev.tug != null && cur.tug != null && cur.tug - prev.tug >= 2)
      out.push({ id: "R3", text: "ลุกเดินช้าลง " + (cur.tug - prev.tug).toFixed(1) + " วินาที", why: "การเดินที่ช้าลงต่อเนื่องสัมพันธ์กับความเสี่ยงหกล้ม" });
    if (prev.balPassed != null && cur.balPassed != null) {
      if (cur.balPassed < prev.balPassed)
        out.push({ id: "R8", text: "ทรงตัวได้ " + cur.balPassed + " ท่า จากเดิม " + prev.balPassed + " ท่า", why: "ท่าทรงตัวเรียงจากง่ายไปยาก การทำท่าที่เคยผ่านไม่ได้ คือการสูญเสียความสามารถ ไม่ใช่ความผันผวนของการวัด" });
    } else if (prev.balance != null && cur.balance != null && prev.balance >= 10 && cur.balance < 10)
      out.push({ id: "R8", text: "เคยยืนต่อเท้าครบ 10 วินาที ครั้งนี้ทำไม่ได้", why: "การทำท่าที่เคยผ่านไม่ได้ คือการสูญเสียความสามารถ ไม่ใช่ความผันผวนของการวัด" });
    return out;
  }

  /* ข้อความสั้นใต้ระดับสี — ไม่ใส่คำแนะนำทางการแพทย์ที่นี่
     คำแนะนำจริงอยู่ใน EVID ของแอป ซึ่งมีแหล่งอ้างอิงทุกข้อ
     ส้ม/แดง แสดงหลังผู้เชี่ยวชาญยืนยันแล้วเท่านั้น */
  var TIER = {
    4: { nm: "เขียว · คงที่", cls: "t4", advice: "ไม่พบสัญญาณเสี่ยงจากการวัดครั้งนี้ ดูสิ่งที่ควรทำต่อด้านล่าง" },
    3: { nm: "เหลือง · เฝ้าสังเกต", cls: "t3", advice: "พบสัญญาณที่ควรเฝ้าดู ดูสิ่งที่ควรทำต่อด้านล่าง" },
    2: { nm: "ส้ม · ถดถอย", cls: "t2", advice: "ผู้เชี่ยวชาญยืนยันแล้ว ทำตามคำแนะนำของผู้เชี่ยวชาญ" },
    1: { nm: "แดง · ต้องพบแพทย์", cls: "t1", advice: "ผู้เชี่ยวชาญยืนยันแล้ว ทำตามคำแนะนำของผู้เชี่ยวชาญ" }
  };
  function nextDueDays(tier) { return tier === 4 ? 90 : tier === 3 ? 30 : 14; }

  g.CSScore = { ftsstCut: ftsstCut, SAFETY: SAFETY, safety: safety, RANGE: RANGE, plausible: plausible,
                score: score, flags: flags, trend: trend, TIER: TIER, nextDueDays: nextDueDays };
})(typeof globalThis !== "undefined" ? globalThis : this);
if (typeof module !== "undefined" && module.exports) module.exports = globalThis.CSScore;
