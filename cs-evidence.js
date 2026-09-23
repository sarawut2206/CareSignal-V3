/* ============================================================
   cs-evidence.js — ฐานหลักฐานอ้างอิงของใบส่งต่อ (แหล่งเดียว)
   ------------------------------------------------------------
   ทุกข้อที่ระบบแสดงในใบส่งต่อต้องชี้กลับมาที่รายการอ้างอิงในไฟล์นี้
   ระบบวิเคราะห์ของ CareSignal เป็น "ระบบกฎ" (rule-based) ที่เขียนจากเกณฑ์
   ในเอกสารข้างล่าง ไม่ใช่โมเดลเรียนรู้ของเครื่อง จึงอธิบายได้ทุกข้อว่า
   ทำไมขึ้นสัญญาณ และใช้เกณฑ์ของใคร

   กติกา
     · ห้ามเพิ่มข้อความแนะนำที่ไม่มีแหล่งอ้างอิง
     · ข้อพิจารณาเรื่องยาเขียนถึงผู้เชี่ยวชาญ ใช้คำว่า "พิจารณาทบทวน"
       การปรับหรือหยุดยาเป็นดุลยพินิจของผู้สั่งใช้ยาเท่านั้น
     · เกณฑ์ที่โปรแกรมกำหนดเอง ติดป้าย "เกณฑ์ภายในโปรแกรม" เสมอ
   ============================================================ */
(function (g) {
  var REFS = {
    steadi: "Centers for Disease Control and Prevention (CDC). STEADI — Algorithm for Fall Risk Screening, Assessment, and Intervention among Community-Dwelling Adults 65 Years and Older. 2019.",
    tug: "CDC STEADI. Assessment: Timed Up & Go (TUG). 2017.",
    stage4: "CDC STEADI. Assessment: The 4-Stage Balance Test. 2017.",
    wfg: "Montero-Odasso M, et al. World guidelines for falls prevention and management for older adults: a global initiative. Age and Ageing. 2022;51(9):afac205.",
    ftsst: "Poncumhak P, et al. 2014 — ค่าตัดการทดสอบลุก–นั่ง 5 ครั้ง แยกตามช่วงอายุ (ใช้เป็นค่าตัดของระบบ 10.0 / 11.5 / 12.1 วินาที)",
    mcid: "Meretta BM, Whitney SL, Marchetti GF, Sparto PJ, Muirhead RJ. The five times sit to stand test: responsiveness to change and concurrent validity in adults undergoing vestibular rehabilitation. Journal of Vestibular Research. 2006;16(4–5):233–243.",
    stoppfall: "Seppala LJ, et al. STOPPFall (Screening Tool of Older Persons Prescriptions in older adults with high fall risk): a Delphi study by the EuGMS Task and Finish Group on Fall-Risk-Increasing Drugs. Age and Ageing. 2021;50(4):1189–1199.",
    seppala: "Seppala LJ, et al. Fall-Risk-Increasing Drugs: A Systematic Review and Meta-Analysis (I. Cardiovascular Drugs; II. Psychotropics; III. Others). Journal of the American Medical Directors Association. 2018;19(4).",
    beers: "2023 American Geriatrics Society Beers Criteria® Update Expert Panel. American Geriatrics Society 2023 updated AGS Beers Criteria® for potentially inappropriate medication use in older adults. Journal of the American Geriatrics Society. 2023;71(7):2052–2081.",
    steadirx: "CDC STEADI-Rx. Pharmacist Consultation for Older Adults at Risk of Falling (Coordinated Care Plan). 2019.",
    cochrane: "Sherrington C, et al. Exercise for preventing falls in older people living in the community. Cochrane Database of Systematic Reviews. 2019;1:CD012424.",
    who: "World Health Organization. WHO guidelines on physical activity and sedentary behaviour. Geneva: WHO; 2020.",
    barthel: "Mahoney FI, Barthel DW. Functional evaluation: the Barthel Index. Maryland State Medical Journal. 1965;14:61–65 · ฉบับ 20 คะแนน: Collin C, Wade DT, Davies S, Horne V. The Barthel ADL Index: a reliability study. International Disability Studies. 1988;10(2):61–63.",
    barthelTh: "ดัชนีบาร์เธลเอดีแอล ฉบับภาษาไทย ที่กระทรวงสาธารณสุขใช้คัดกรองผู้สูงอายุ · กลุ่มติดสังคม (≥12) ติดบ้าน (5–11) ติดเตียง (0–4) ตามระบบการดูแลระยะยาว (Long-Term Care) ของกระทรวงสาธารณสุขและ สปสช.",
    cdcHome: "CDC STEADI. Check for Safety: A Home Fall Prevention Checklist for Older Adults. 2017.",
    cochraneHome: "Gillespie LD, et al. Interventions for preventing falls in older people living in the community. Cochrane Database of Systematic Reviews. 2012;(9):CD007146.",
    /* เซ็นเซอร์คาดเอว (instrumented tests) — cs-imu.js · firmware/CareSignal-Waist */
    itug: "Salarian A, Horak FB, Zampieri C, Carlson-Kuhta P, Nutt JG, Aminian K. iTUG, a sensitive and reliable measure of mobility. IEEE Transactions on Neural Systems and Rehabilitation Engineering. 2010;18(3):303–310.",
    weiss: "Weiss A, Herman T, Plotnik M, Brozgol M, Giladi N, Hausdorff JM. An instrumented timed up and go: the added value of an accelerometer for identifying fall risk in idiopathic fallers. Physiological Measurement. 2011;32(12):2003–2018.",
    ists: "Van Lummel RC, Ainsworth E, Lindemann U, Zijlstra W, Chiari L, Van Campen P, Hausdorff JM. Automated approach for quantifying the repeated sit-to-stand using one body fixed sensor in young and older adults. Gait & Posture. 2013;38(1):153–156.",
    millor: "Millor N, Lecumberri P, Gómez M, Martínez-Ramírez A, Izquierdo M. An evaluation of the 30-s chair stand test in older adults: frailty detection based on kinematic parameters from a single inertial unit. Journal of NeuroEngineering and Rehabilitation. 2013;10:86.",
    isway: "Mancini M, Salarian A, Carlson-Kuhta P, Zampieri C, King L, Chiari L, Horak FB. ISway: a sensitive, valid and reliable measure of postural control. Journal of NeuroEngineering and Rehabilitation. 2012;9:59.",
    gaitacc: "Moe-Nilssen R, Helbostad JL. Estimation of gait cycle characteristics by trunk accelerometry. Journal of Biomechanics. 2004;37(1):121–126.",
    program: "เกณฑ์ภายในโปรแกรม CareSignal — กำหนดเพื่อการติดตาม ยังไม่ผ่านการทดสอบความแม่นยำทางคลินิก"
  };

  /* สัญญาณแต่ละข้อ: เกณฑ์ที่ใช้ · เหตุผลทางคลินิก · อ้างอิง */
  var FLAG = {
    B1:  { rule: "หกล้มตั้งแต่ 2 ครั้งใน 12 เดือน", why: "การล้มซ้ำเป็นหนึ่งในเกณฑ์กลุ่มเสี่ยงสูงของแนวทางสากล ซึ่งแนะนำให้ประเมินปัจจัยเสี่ยงหลายด้าน (multifactorial assessment)", refs: ["wfg", "steadi"] },
    B2:  { rule: "ล้มแล้วบาดเจ็บจนต้องพบแพทย์", why: "การล้มที่มีการบาดเจ็บจัดเป็นกลุ่มเสี่ยงสูงตามแนวทางสากล", refs: ["wfg"] },
    B4:  { rule: "ล้มแล้วลุกขึ้นเองไม่ได้", why: "การลุกจากพื้นเองไม่ได้ (lying on the floor) เป็นเกณฑ์กลุ่มเสี่ยงสูงตามแนวทางสากล", refs: ["wfg"] },
    B7:  { rule: "หกล้ม 1 ครั้งใน 12 เดือน", why: "ประวัติการล้มในปีที่ผ่านมาเป็นคำถามคัดกรองหลักของ CDC STEADI", refs: ["steadi"] },
    B8:  { rule: "รู้สึกไม่มั่นคงหรือกังวลว่าจะล้ม", why: "เป็นหนึ่งในสามคำถามคัดกรองหลัก (Three Key Questions) ของ CDC STEADI", refs: ["steadi"] },
    B9:  { rule: "ลุก–นั่ง 5 ครั้ง ช้ากว่าค่าตัดตามอายุ (10.0 / 11.5 / 12.1 วินาที สำหรับอายุ <65 / 65–74 / ≥75 ปี)", why: "สะท้อนกำลังกล้ามเนื้อรยางค์ล่างและการเปลี่ยนท่าที่ลดลง", refs: ["ftsst", "steadi"] },
    B10: { rule: "ลุกเดิน 3 เมตร (TUG) ตั้งแต่ 12 วินาที", why: "CDC STEADI ใช้ TUG ≥ 12 วินาทีเป็นจุดบ่งชี้ความเสี่ยงหกล้ม", refs: ["tug"] },
    B11: { rule: "ยืนต่อเท้าเป็นเส้นตรง (tandem) ไม่ครบ 10 วินาที", why: "CDC 4-Stage Balance Test ถือว่าทำท่าที่ 3 ไม่ครบ 10 วินาทีเป็นความเสี่ยงหกล้มที่เพิ่มขึ้น", refs: ["stage4"] },
    B12: { rule: "ใช้ยาประจำตั้งแต่ 4 รายการ", why: "การใช้ยาหลายรายการร่วมกันเป็นปัจจัยเสี่ยงที่แนวทางสากลแนะนำให้ทบทวนยา", refs: ["wfg", "steadirx"] },
    B13: { rule: "คะแนนยาเสี่ยงหกล้ม (ยาเสี่ยงสูง × 2 + เสี่ยงปานกลาง) ≥ 2", why: "ยาหลายกลุ่มเพิ่มความเสี่ยงหกล้มตามรายการ STOPPFall และการทบทวนวรรณกรรมอย่างเป็นระบบ", refs: ["stoppfall", "seppala"] },
    B6:  { rule: "ยาเสี่ยงหกล้มสูง ≥ 2 รายการ ร่วมกับทรงตัวผ่านไม่เกิน 1 ท่า", why: "ยากลุ่มที่กดระบบประสาทหรือทำให้ความดันตก ร่วมกับการทรงตัวบกพร่อง เพิ่มโอกาสล้มชัดเจน", refs: ["stoppfall", "steadirx"] },
    B16: { rule: "ทำกิจวัตรประจำวันเองได้ไม่ครบ", why: "การพึ่งพิงที่เพิ่มขึ้นเป็นปัจจัยที่แนวทางสากลให้ประเมินร่วมในผู้สูงอายุเสี่ยงหกล้ม", refs: ["wfg"] },
    R1:  { rule: "ลุก–นั่งช้าลงจากครั้งก่อน ≥ 2.3 วินาที หรือ ≥ 15%", why: "2.3 วินาทีเป็นค่าการเปลี่ยนแปลงที่มีความหมายทางคลินิก (MCID) ของการทดสอบนี้", refs: ["mcid", "program"] },
    "R1+": { rule: "ลุก–นั่งเร็วขึ้นจากครั้งก่อน ≥ 2.3 วินาที หรือ ≥ 15%", why: "ดีขึ้นเกินค่าการเปลี่ยนแปลงที่มีความหมายทางคลินิก", refs: ["mcid"] },
    R3:  { rule: "ลุกเดินช้าลงจากครั้งก่อน ≥ 2 วินาที", why: "การเดินช้าลงต่อเนื่องสัมพันธ์กับความเสี่ยงหกล้ม", refs: ["tug", "program"] },
    R8:  { rule: "ทรงตัวผ่านได้น้อยท่ากว่าครั้งก่อน", why: "ท่าทดสอบเรียงจากง่ายไปยาก การทำท่าที่เคยผ่านไม่ได้คือการสูญเสียความสามารถ", refs: ["stage4", "program"] }
  };

  /* กลุ่มยาเสี่ยงหกล้ม: กลไกที่เกี่ยวกับการล้ม และข้อพิจารณาสำหรับเภสัชกร/แพทย์ */
  var FRID = {
    bzd:      { mech: "ง่วงซึม การตอบสนองช้า เสียการทรงตัว", consider: "พิจารณาความจำเป็น ขนาดต่ำสุดที่ได้ผล และแผนลดขนาดแบบค่อยเป็นค่อยไปโดยผู้สั่งใช้", refs: ["stoppfall", "beers", "seppala"] },
    antidep:  { mech: "ง่วงซึม ความดันตกเมื่อเปลี่ยนท่า และโซเดียมต่ำ (กลุ่ม SSRI)", consider: "ทบทวนข้อบ่งใช้ ขนาดยา และเวลาให้ยา ติดตามอาการเวียนศีรษะ", refs: ["stoppfall", "seppala", "beers"] },
    antipsy:  { mech: "ง่วงซึม ความดันตกเมื่อเปลี่ยนท่า อาการคล้ายพาร์กินสัน", consider: "ทบทวนข้อบ่งใช้และขนาดยา โดยเฉพาะการใช้เพื่อพฤติกรรมในภาวะสมองเสื่อม", refs: ["stoppfall", "beers", "seppala"] },
    anticonv: { mech: "เวียนศีรษะ เดินเซ (ataxia) ง่วงซึม", consider: "ทบทวนข้อบ่งใช้ (เช่น ใช้แก้ปวดปลายประสาท) และขนาดยาเทียบการทำงานของไต", refs: ["stoppfall", "seppala"] },
    opioid:   { mech: "ง่วงซึม เวียนศีรษะ สับสน", consider: "ทบทวนความจำเป็น ขนาด และทางเลือกแก้ปวดอื่น", refs: ["stoppfall", "seppala"] },
    anticho:  { mech: "สับสน ตาพร่ามัว ง่วงซึม (ฤทธิ์ต้านโคลิเนอร์จิก)", consider: "ประเมินภาระฤทธิ์ต้านโคลิเนอร์จิกรวม และพิจารณาทางเลือกที่ฤทธิ์น้อยกว่า", refs: ["beers", "stoppfall"] },
    relax:    { mech: "ง่วงซึม อ่อนแรง ฤทธิ์ต้านโคลิเนอร์จิก", consider: "ทบทวนความจำเป็นในการใช้ต่อเนื่อง", refs: ["beers"] },
    antihist: { mech: "ง่วงซึม และฤทธิ์ต้านโคลิเนอร์จิก (ยาแก้แพ้รุ่นแรก)", consider: "พิจารณายาแก้แพ้รุ่นที่ไม่ง่วงแทน หากข้อบ่งใช้เอื้อ", refs: ["beers", "stoppfall"] },
    antihtn:  { mech: "ความดันตกเมื่อเปลี่ยนท่า (orthostatic hypotension)", consider: "วัดความดันท่านอน–ยืน และทบทวนเป้าหมายความดันตามวัย", refs: ["seppala", "stoppfall", "steadirx"] },
    diuretic: { mech: "ความดันตกเมื่อเปลี่ยนท่า ปัสสาวะบ่อย/กลางคืนทำให้ลุกเข้าห้องน้ำ", consider: "ทบทวนขนาดและเวลาให้ยา (เลี่ยงช่วงเย็น) ติดตามเกลือแร่", refs: ["seppala", "stoppfall"] },
    alpha:    { mech: "ความดันตกเมื่อเปลี่ยนท่า โดยเฉพาะช่วงเริ่มยา", consider: "ทบทวนเวลาให้ยา (ก่อนนอน) และอาการหน้ามืดเมื่อลุกยืน", refs: ["stoppfall", "beers"] },
    bladder:  { mech: "ฤทธิ์ต้านโคลิเนอร์จิก สับสน ตาพร่ามัว", consider: "ประเมินภาระฤทธิ์ต้านโคลิเนอร์จิกรวม", refs: ["beers"] }
  };

  var api = { REFS: REFS, FLAG: FLAG, FRID: FRID };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  g.CSEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
