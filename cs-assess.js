/* ============================================================
   cs-assess.js — แบบประเมินเพิ่มเติมที่ลูกหลานทำให้ได้ที่บ้าน
     1. ดัชนีบาร์เธลเอดีแอล (Barthel ADL Index) ฉบับภาษาไทย 10 ข้อ คะแนนเต็ม 20
     2. สำรวจความปลอดภัยในบ้าน — จุดเสี่ยงที่แก้ไขได้ พร้อมวิธีแก้
   ------------------------------------------------------------
   หลัก
   · ไม่เปลี่ยนคะแนนความเสี่ยงหกล้มหลัก (cs-score.js ต้องตรงกับ V2)
     บาร์เธลแปลงเป็นค่า adl 0–2 เดิม: 20 = 2 · 12–19 = 1 · 0–11 = 0
   · ข้อมูลส่งขึ้นระบบกลางในรูปแบบที่ใบส่งต่อ (cs-referral-forms.js · SQL 22) อ่านอยู่แล้ว
       detail.barthel = { total, band, items } · home_detail = { hazards[], helper, none, done, items[] }
     รหัสจุดเสี่ยงหลัก 7 ตัวตรงกับ V2 (rug wet light rail stair shoe reach)
   · คำแนะนำทุกข้อมีแหล่งอ้างอิง (SRC) — ข้อที่โปรแกรมกำหนดเองติดป้าย "เกณฑ์ภายในโปรแกรม"
   ============================================================ */
(function (g) {
  /* ที่มาแบบย่อสำหรับหน้าจอมือถือ · รายการเต็มอยู่ใน cs-evidence.js (ใบส่งต่อ) */
  var SRC = {
    cdcHome: "CDC STEADI · Check for Safety: A Home Fall Prevention Checklist (2017)",
    cochraneHome: "Gillespie et al. · Cochrane Review CD007146 (2012): ปรับสภาพบ้านลดอัตราการล้ม โดยเฉพาะในกลุ่มเสี่ยงสูง",
    wfg: "World Guidelines for Falls Prevention (Montero-Odasso et al., Age and Ageing 2022)",
    barthel: "Barthel Index (Mahoney & Barthel 1965) · ฉบับ 20 คะแนน (Collin et al. 1988)",
    barthelTh: "ดัชนีบาร์เธลเอดีแอล ฉบับภาษาไทย · กลุ่มติดสังคม ≥12 / ติดบ้าน 5–11 / ติดเตียง 0–4 ตามระบบดูแลระยะยาว (LTC) กระทรวงสาธารณสุข–สปสช.",
    program: "เกณฑ์ภายในโปรแกรม CareSignal (ยังไม่ผ่านการทดสอบความแม่นยำทางคลินิก)"
  };

  /* ---------- 1. Barthel ADL ฉบับภาษาไทย (0–20) ---------- */
  var BARTHEL = [
    { k: "feed", nm: "รับประทานอาหาร", q: "เมื่อเตรียมอาหารไว้ให้ ตักอาหารเข้าปากได้เองแค่ไหน", o: [
      [0, "ตักเองไม่ได้ ต้องมีคนป้อน"], [1, "ตักเองได้ แต่ต้องมีคนช่วย เช่น ตัดเป็นชิ้นเล็กหรือเตรียมช้อนไว้ให้"], [2, "ตักและกินเองได้ตามปกติ"]] },
    { k: "groom", nm: "ล้างหน้า หวีผม แปรงฟัน โกนหนวด", q: "ใน 1–2 วันที่ผ่านมา ล้างหน้า หวีผม แปรงฟัน (โกนหนวด) ได้เองไหม", o: [
      [0, "ต้องมีคนช่วยทำให้"], [1, "ทำเองได้ (รวมกรณีที่ต้องเตรียมอุปกรณ์ไว้ให้)"]] },
    { k: "transfer", nm: "ลุกจากที่นอนไปนั่งเก้าอี้", q: "ลุกจากที่นอน แล้วย้ายไปนั่งเก้าอี้ได้เองแค่ไหน", o: [
      [0, "นั่งไม่ได้ (นั่งแล้วล้ม) หรือต้องใช้ 2 คนยก"], [1, "ต้องช่วยมาก เช่น คนแข็งแรง 1 คน หรือคนทั่วไป 2 คนพยุงขึ้น"], [2, "ช่วยเล็กน้อย เช่น พยุงนิดหน่อย บอกให้ทำ หรือต้องมีคนคอยดู"], [3, "ทำได้เอง"]] },
    { k: "toilet", nm: "ใช้ห้องส้วม", q: "เข้าห้องส้วมได้เองแค่ไหน (นั่ง–ลุกจากโถ ทำความสะอาด ใส่–ถอดเสื้อผ้า)", o: [
      [0, "ช่วยตัวเองไม่ได้"], [1, "ทำได้บ้าง (อย่างน้อยทำความสะอาดตัวเองได้) แต่ต้องมีคนช่วยบางอย่าง"], [2, "ทำได้เองทั้งหมด"]] },
    { k: "mobility", nm: "เคลื่อนที่ภายในบ้าน", q: "เดินหรือเคลื่อนที่ภายในห้องหรือในบ้านได้แค่ไหน", o: [
      [0, "เคลื่อนที่ไปไหนไม่ได้"], [1, "ใช้รถเข็นเคลื่อนที่ได้เอง (ไม่ต้องมีคนเข็น) เข้าออกประตู–มุมห้องได้"], [2, "เดินได้แต่ต้องมีคนพยุง บอกให้ทำ หรือคอยดูเพื่อความปลอดภัย"], [3, "เดินได้เอง (ใช้ไม้เท้าได้)"]] },
    { k: "dress", nm: "สวมใส่เสื้อผ้า", q: "สวมใส่เสื้อผ้าได้เองแค่ไหน", o: [
      [0, "ต้องมีคนใส่ให้ ช่วยตัวเองแทบไม่ได้"], [1, "ทำเองได้ราวครึ่งหนึ่ง ที่เหลือต้องมีคนช่วย"], [2, "ทำได้เอง รวมติดกระดุม รูดซิป (ใช้เสื้อผ้าที่ดัดแปลงได้)"]] },
    { k: "stairs", nm: "ขึ้นลงบันได 1 ชั้น", q: "ขึ้นลงบันได 1 ชั้นได้เองแค่ไหน", o: [
      [0, "ทำไม่ได้"], [1, "ต้องมีคนช่วย"], [2, "ขึ้นลงได้เอง (ถ้าใช้อุปกรณ์ช่วยเดิน ต้องถือขึ้นลงเองได้)"]] },
    { k: "bath", nm: "อาบน้ำ", q: "อาบน้ำได้เองไหม", o: [
      [0, "ต้องมีคนช่วยหรือทำให้"], [1, "อาบน้ำเองได้"]] },
    { k: "bowel", nm: "กลั้นอุจจาระ", q: "ในสัปดาห์ที่ผ่านมา กลั้นอุจจาระได้แค่ไหน", o: [
      [0, "กลั้นไม่ได้ หรือต้องสวนอุจจาระเป็นประจำ"], [1, "กลั้นไม่ได้บางครั้ง (น้อยกว่าสัปดาห์ละ 1 ครั้ง)"], [2, "กลั้นได้ตามปกติ"]] },
    { k: "bladder", nm: "กลั้นปัสสาวะ", q: "ในสัปดาห์ที่ผ่านมา กลั้นปัสสาวะได้แค่ไหน", o: [
      [0, "กลั้นไม่ได้ หรือใส่สายสวนแต่ดูแลเองไม่ได้"], [1, "กลั้นไม่ได้บางครั้ง (น้อยกว่าวันละ 1 ครั้ง)"], [2, "กลั้นได้ตามปกติ"]] }
  ];
  var BARTHEL_MAX = BARTHEL.reduce(function (s, it) { return s + it.o[it.o.length - 1][0]; }, 0);   /* 20 */

  /* กลุ่มตามกระทรวงสาธารณสุข + ระดับย่อยของโปรแกรมภายในกลุ่มติดสังคม */
  function band(total) {
    if (total == null) return null;
    if (total >= 20) return { k: "independent", nm: "ติดสังคม · ช่วยเหลือตัวเองได้เต็มที่", short: "ติดสังคม", dep: false, cls: "ok",
      desc: "ทำกิจวัตรประจำวันได้เองทุกข้อ", src: ["barthel", "barthelTh"] };
    if (total >= 12) return { k: "social", nm: "ติดสังคม · เริ่มต้องการความช่วยเหลือบางด้าน", short: "ติดสังคม", dep: false, cls: "watch",
      desc: "ยังช่วยเหลือตัวเองและออกนอกบ้านได้ แต่บางกิจวัตรต้องมีคนช่วย — เป็นช่วงที่ควรเฝ้าระวังก่อนเข้าสู่ภาวะพึ่งพิง", src: ["barthelTh", "program"] };
    if (total >= 5) return { k: "home", nm: "ติดบ้าน · อยู่ในภาวะพึ่งพิง", short: "ติดบ้าน", dep: true, cls: "dep",
      desc: "ต้องมีคนช่วยในกิจวัตรหลายด้าน เข้าเกณฑ์การดูแลระยะยาว (LTC) ควรให้ทีมดูแลประเมินและวางแผนการดูแล", src: ["barthelTh"] };
    return { k: "bed", nm: "ติดเตียง · พึ่งพิงสูง", short: "ติดเตียง", dep: true, cls: "dep",
      desc: "ต้องพึ่งพาผู้อื่นเกือบทุกกิจวัตร เข้าเกณฑ์การดูแลระยะยาว (LTC) ควรให้ทีมดูแลประเมินและวางแผนการดูแล", src: ["barthelTh"] };
  }
  function barthel(ans) {
    ans = ans || {}; var total = 0, n = 0, weak = [];
    BARTHEL.forEach(function (it) {
      var v = ans[it.k]; if (v == null) return; n++; total += v;
      var mx = it.o[it.o.length - 1][0]; if (v < mx) weak.push({ k: it.k, nm: it.nm, v: v, max: mx, txt: (it.o.filter(function (o) { return o[0] === v; })[0] || [])[1] });
    });
    var complete = n === BARTHEL.length, t = complete ? total : null;
    return { total: t, partial: total, answered: n, complete: complete, max: BARTHEL_MAX, band: band(t), weak: weak,
             adl: t == null ? null : t >= 20 ? 2 : t >= 12 ? 1 : 0 };   /* ค่า adl 0–2 เดิมของคะแนนหลัก (ตรงกับ V2) */
  }
  /* เทียบกับครั้งก่อน: ลดลงตั้งแต่ 2 คะแนน หรือเปลี่ยนกลุ่มไปทางพึ่งพิง = ควรแจ้งทีมดูแล (เกณฑ์ภายในโปรแกรม) */
  function barthelChange(prev, cur) {
    if (!prev || !cur || prev.total == null || cur.total == null) return null;
    var d = cur.total - prev.total, pb = band(prev.total), cb = band(cur.total), order = ["bed", "home", "social", "independent"];
    var worseBand = order.indexOf(cb.k) < order.indexOf(pb.k);
    return { delta: d, worse: d <= -2 || worseBand, better: d >= 2, worseBand: worseBand, from: prev.total, to: cur.total, src: ["program"] };
  }

  /* ---------- 2. สำรวจความปลอดภัยในบ้าน ----------
     แต่ละข้อถามว่า "มีจุดเสี่ยงนี้ไหม" · base = รหัสหลัก 7 ตัวที่ใบส่งต่อรู้จัก (null = ข้อมูลประกอบ)
     pri 1 = แก้ก่อน (ห้องน้ำ บันได ทางเดินกลางคืน — จุดที่ล้มบ่อยและบาดเจ็บรุนแรง) */
  var HOME = [
    { area: "floor", nm: "พื้นและทางเดิน", ic: "🧶" },
    { area: "bath", nm: "ห้องน้ำ", ic: "🚿" },
    { area: "light", nm: "แสงสว่าง", ic: "💡" },
    { area: "stairs", nm: "บันได", ic: "🪜", gate: "บ้านมีบันไดที่ผู้สูงอายุใช้เป็นประจำไหม" },
    { area: "kitchen", nm: "ห้องครัวและของใช้", ic: "📦" },
    { area: "shoe", nm: "รองเท้า", ic: "🥿" },
    { area: "help", nm: "ถ้าล้มแล้วขอความช่วยเหลือ", ic: "📞" }
  ];
  var HAZ = [
    { k: "rug_loose", area: "floor", base: "rug", pri: 2, q: "มีพรมเช็ดเท้าหรือพรมผืนเล็กที่ไม่ยึดติดพื้น", fix: "เอาพรมผืนเล็กออก หรือใช้แผ่นยางกันลื่นรองใต้พรม / เทปกาวสองหน้ายึดให้แน่น", src: ["cdcHome"] },
    { k: "clutter", area: "floor", base: "rug", pri: 2, q: "มีของวางบนพื้นทางเดิน เช่น กล่อง รองเท้า ผ้า หนังสือ", fix: "เก็บของออกจากพื้นทางเดินและบันไดเป็นประจำ ให้ทางเดินโล่ง", src: ["cdcHome"] },
    { k: "cord", area: "floor", base: "rug", pri: 2, q: "มีสายไฟหรือสายโทรศัพท์พาดผ่านทางเดิน", fix: "เก็บสายชิดผนัง ใช้รางเก็บสาย หรือเพิ่มปลั๊กใกล้จุดใช้งาน ไม่ให้สายพาดทางเดิน", src: ["cdcHome"] },
    { k: "slick", area: "floor", base: "wet", pri: 2, q: "พื้นในบ้านลื่น เช่น กระเบื้องมัน พื้นขัดเงา หรือมีน้ำหกบ่อย", fix: "เช็ดพื้นให้แห้งทันที ใช้แผ่นกันลื่นหรือเทปกันลื่นบริเวณที่เปียกบ่อย", src: ["cdcHome", "cochraneHome"] },
    { k: "uneven", area: "floor", base: "rug", pri: 2, q: "มีพื้นต่างระดับ ธรณีประตู หรือขั้นเล็ก ๆ ที่มองเห็นไม่ชัด", fix: "ซ่อมพื้นที่ไม่เรียบ ติดแถบสีตัดกันที่ขอบขั้น หรือทำทางลาด", src: ["cdcHome"] },
    { k: "bath_slip", area: "bath", base: "wet", pri: 1, q: "พื้นห้องน้ำลื่น ไม่มีแผ่นยางหรือแถบกันลื่น", fix: "วางแผ่นยางกันลื่นหรือติดแถบกันลื่นบริเวณอาบน้ำและหน้าโถส้วม", src: ["cdcHome"] },
    { k: "bath_rail", area: "bath", base: "rail", pri: 1, q: "ไม่มีราวจับข้างโถส้วมหรือบริเวณอาบน้ำ", fix: "ติดราวจับที่ยึดกับผนังแน่นหนา ข้างโถส้วมและที่อาบน้ำ (ห้ามใช้ราวแขวนผ้าแทน)", src: ["cdcHome", "cochraneHome"] },
    { k: "squat", area: "bath", base: "rail", pri: 1, q: "ใช้ส้วมนั่งยอง หรือลุกจากโถส้วมลำบาก", fix: "เปลี่ยนเป็นโถนั่งราบ หรือใช้เก้าอี้นั่งถ่ายครอบส้วมนั่งยอง และติดราวจับช่วยลุก", src: ["cdcHome"] },
    { k: "night_path", area: "light", base: "light", pri: 1, q: "ทางจากเตียงไปห้องน้ำมืดตอนกลางคืน", fix: "ติดไฟกลางคืน (ไฟดวงเล็กหรือไฟเซนเซอร์) ตามทางจากห้องนอนถึงห้องน้ำ", src: ["cdcHome"] },
    { k: "bed_lamp", area: "light", base: "light", pri: 2, q: "ไฟหรือสวิตช์ไฟใกล้เตียงเอื้อมไม่ถึง", fix: "วางโคมไฟหรือสวิตช์ให้เอื้อมถึงได้จากบนเตียง เปิดไฟก่อนลุกทุกครั้ง", src: ["cdcHome"] },
    { k: "dim", area: "light", base: "light", pri: 2, q: "บางจุดในบ้านมืด หลอดไฟขาด หรือแสงไม่พอ", fix: "เปลี่ยนหลอดที่ขาด เพิ่มหลอดไฟที่สว่างขึ้นในจุดที่เดินบ่อย", src: ["cdcHome"] },
    { k: "stair_rail", area: "stairs", base: "stair", pri: 1, q: "บันไดไม่มีราวจับ มีข้างเดียว หรือราวโยก", fix: "ติดราวจับทั้งสองข้างให้ยาวตลอดแนวบันได และยึดให้แน่น", src: ["cdcHome"] },
    { k: "stair_light", area: "stairs", base: "light", pri: 1, q: "บันไดมืด หรือมีสวิตช์ไฟแค่ด้านเดียว", fix: "ติดไฟส่องบันได และให้มีสวิตช์ทั้งด้านบนและด้านล่าง", src: ["cdcHome"] },
    { k: "stair_step", area: "stairs", base: "stair", pri: 1, q: "ขั้นบันไดชำรุด ไม่เท่ากัน ลื่น หรือมีของวาง", fix: "ซ่อมขั้นที่ชำรุด ติดแถบกันลื่นที่ขอบขั้น และไม่วางของบนบันได", src: ["cdcHome"] },
    { k: "reach_high", area: "kitchen", base: "reach", pri: 2, q: "ของใช้ประจำอยู่สูง ต้องปีนหรือเขย่งหยิบ", fix: "ย้ายของที่ใช้บ่อยมาไว้ระดับเอว ไม่ต้องปีนหรือเขย่ง", src: ["cdcHome"] },
    { k: "stool", area: "kitchen", base: "reach", pri: 2, q: "ใช้เก้าอี้หรือม้านั่งที่โยกเยกปีนหยิบของ", fix: "ใช้บันไดพับที่มั่นคงและมีที่จับ ห้ามปีนเก้าอี้", src: ["cdcHome"] },
    { k: "shoe_loose", area: "shoe", base: "shoe", pri: 2, q: "ใส่รองเท้าแตะหลวม ไม่หุ้มส้น หรือเดินใส่ถุงเท้า / เท้าเปล่าบนพื้นลื่น", fix: "ใส่รองเท้าที่พอดีเท้า หุ้มส้น พื้นบางแต่กันลื่น ทั้งในและนอกบ้าน", src: ["cdcHome"] },
    { k: "no_phone", area: "help", base: null, pri: 2, q: "ถ้าล้มแล้วลุกไม่ได้ ไม่มีโทรศัพท์หรือกริ่งเรียกอยู่ใกล้ตัว", fix: "วางโทรศัพท์ไว้ในระดับที่เอื้อมถึงจากพื้น ติดเบอร์ฉุกเฉินตัวใหญ่ไว้ใกล้โทรศัพท์ และพกโทรศัพท์ติดตัว", src: ["cdcHome"] }
  ];
  var BASE_NM = { rug: "พรมหรือสายไฟบนทางเดิน", wet: "พื้นห้องน้ำ/ครัวลื่น", light: "ทางเดินกลางคืนหรือบันไดมืด", rail: "ห้องน้ำไม่มีราวจับ / ลุกจากโถลำบาก", stair: "บันไดไม่มีราวหรือชำรุด", shoe: "รองเท้าไม่ปลอดภัย", reach: "ของใช้อยู่สูงต้องปีนหยิบ" };

  /* ans = { <k>: true (มีจุดเสี่ยง) | false, stairs: true/false (มีบันได), helper, fixed: {<k>: ISO} } */
  function homeResult(ans) {
    ans = ans || {}; var fixed = ans.fixed || {};
    var items = HAZ.filter(function (h) { return !(h.area === "stairs" && ans.stairs === false); });
    var answered = items.filter(function (h) { return ans[h.k] != null; }).length;
    var found = items.filter(function (h) { return ans[h.k] === true; });
    var open = found.filter(function (h) { return !fixed[h.k]; }).sort(function (a, b) { return a.pri - b.pri; });
    var bases = [];
    open.forEach(function (h) { if (h.base && bases.indexOf(h.base) < 0) bases.push(h.base); });
    return { total: items.length, answered: answered, complete: answered === items.length && ans.stairs != null && !!ans.helper,
             found: found.length, open: open, fixedN: found.length - open.length, priority: open.filter(function (h) { return h.pri === 1; }).length,
             bases: bases, helper: ans.helper || null };
  }
  /* รูปแบบที่ระบบกลาง/ใบส่งต่อ V2 อ่านได้ (assessments.home_detail) */
  function homeDetail(ans, at) {
    var r = homeResult(ans);
    return { done: true, none: r.open.length === 0, hazards: r.bases, helper: r.helper, count: r.open.length, priority: r.priority,
             items: r.open.map(function (h) { return { k: h.k, base: h.base, pri: h.pri, t: h.q }; }), fixed: r.fixedN, checked_at: at || null, v: 3 };
  }

  var API = { SRC: SRC, BARTHEL: BARTHEL, BARTHEL_MAX: BARTHEL_MAX, band: band, barthel: barthel, barthelChange: barthelChange,
              HOME: HOME, HAZ: HAZ, BASE_NM: BASE_NM, homeResult: homeResult, homeDetail: homeDetail };
  g.CSAssess = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
