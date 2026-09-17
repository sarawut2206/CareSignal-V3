/* ============================================================
   CareSignal Medication Knowledge Base + Matcher
   ------------------------------------------------------------
   ฐานความรู้ยาสำหรับ "Medication Classification Pipeline"

     รูปซองยา → OCR → ผู้ใช้ยืนยันชื่อ → จับคู่ตัวยาสำคัญ
     → รหัส ATC → กลุ่ม FRID → ส่งเภสัชกรยืนยันเมื่อพบความเสี่ยง

   หลักที่ยึด
   1. ระบบ "ปักธง" ไม่ "ตัดสิน" — คำที่ใช้กับผู้ใช้เสมอคือ
      "ควรให้เภสัชกรหรือแพทย์ทบทวนรายการยา" ไม่ใช่ "ยานี้อันตราย"
      และไม่มีทางไหนที่ระบบสั่งหยุด ลด หรือเพิ่มยา
   2. ตัวยาสำคัญ (INN) เป็นแกน — ชื่อการค้าเป็นเพียงทางเข้า
      เพราะชื่อการค้าไทยมีหลายร้อยชื่อต่อตัวยาเดียว
   3. การจับคู่ต้องทน OCR ผิด — ฉลากยาไทยพิมพ์เล็ก ซีด สะกดสลับ
      จึงใช้ระยะแก้ไข (edit distance) + prefix + คำไทยที่พบบ่อยประกอบ
   4. ทุกการจับคู่ส่งกลับพร้อม "ความมั่นใจ" — ต่ำกว่าเกณฑ์ให้ถามคน
      ไม่เดาแทน

   ที่มาของกลุ่ม FRID: STOPPFall (Seppala et al., Age and Ageing 2021)
   และ AGS Beers Criteria 2023 — ใช้ระดับ 2 = หลักฐานเข้ม (ยานอนหลับ
   BZD/Z-drug · ยาต้านซึมเศร้า · ยาต้านโรคจิต · ยากันชัก · opioid ·
   anticholinergic) และระดับ 1 = ปานกลาง/ขึ้นกับบริบท (ยาลดความดัน
   บางกลุ่ม · ยาขับปัสสาวะ · alpha-blocker · ยาแก้แพ้ง่วง · ยาคลาย
   กล้ามเนื้อ · ยากระเพาะปัสสาวะไว)

   รหัส ATC อ้างอิง WHO Collaborating Centre for Drug Statistics
   Methodology · ชั้นเซิร์ฟเวอร์แปลง ATC เป็นกลุ่ม FRID ด้วยกฎเดียวกัน
   ในฟังก์ชัน cs_atc_to_frid ซึ่งทดสอบเทียบกับไฟล์นี้แล้ว 166 จาก 170 ตรงกัน
   ที่เหลือ 4 ตัวเป็นรหัสระดับกลุ่ม กฎจึงส่งให้เภสัชกรแทนการเดา

   ขอบเขตและตำแหน่งของไฟล์นี้ในระบบ (ประกาศไว้ให้ชัด ไม่อ้างเกินจริง)
   ------------------------------------------------------------
   ไฟล์นี้ไม่ใช่ทะเบียนยาทั้งประเทศ — เป็นตัวยาสำคัญ 170 รายการที่พบบ่อย
   ในผู้สูงอายุไทยและเกี่ยวข้องกับความเสี่ยงหกล้ม ทุกรายการมีคนตรวจแล้ว

   ตั้งแต่รุ่นนี้ ไฟล์นี้เป็น "ชั้นแรก" ของสี่ชั้น ไม่ใช่ทั้งหมดอีกต่อไป
     1. ไฟล์นี้            — ตอบได้ทันที ใช้ได้แม้ไม่มีเน็ต
     2. ตาราง drug_alias   — สำเนาของไฟล์นี้ฝั่งเซิร์ฟเวอร์ บวกชื่อที่เภสัชกรยืนยัน
     3. ทะเบียนตำรับยา อย. — ค้นสดผ่าน edge function แล้วแคชไว้
                            (porta.fda.moph.go.th · GET_DATA_DRUG)
     4. คิวเภสัชกร         — เมื่อสามชั้นบนตอบไม่ได้ ส่งคนพร้อมรูปฉลาก

   ยังไม่ได้เชื่อม Thai Medicines Terminology (TMT) ของ สมสท. เพราะไฟล์
   release ต้องสมัครสมาชิกและขอสิทธิ์ในนามโครงการก่อน โครงสร้าง BY_INN
   ออกแบบให้เพิ่มฟิลด์ tmt_id ต่อรายการได้ทันทีเมื่อได้สิทธิ์

   เหตุผลที่ยังต้องมีไฟล์นี้แม้ต่อทะเบียนแล้ว
     * ทำงานได้ตอนไม่มีเน็ต ซึ่งเป็นสภาพจริงของการเยี่ยมบ้าน
     * ทะเบียน อย. หลายรายการไม่มีรหัส ATC บันทึกไว้ หรือมีแค่รหัสหมวดกว้าง
       เทียบกับไฟล์นี้ที่ตรวจทีละตัวแล้ว — ทดสอบเทียบกฎ ATC ฝั่งเซิร์ฟเวอร์
       กับไฟล์นี้พบว่ากฎ ATC ล้วน ๆ ปักธงต่ำกว่าความจริง 9 ตัว
       (codeine · methadone · benztropine · dicyclomine · cinnarizine ·
        flunarizine · dextromethorphan · nitroglycerin · isosorbide)
     * การจับคู่ผิดจากฐานใหญ่อันตรายกว่าการไม่รู้จักยา เพราะยาที่จับคู่ผิด
       จะได้กลุ่ม FRID ผิดตามไปด้วย แล้วกลายเป็นสัญญาณเสี่ยงที่ผิด
       ส่วนยาที่ไม่รู้จักจะไปถึงเภสัชกรเสมอ
   ============================================================ */
var CSMeds = (function () {

  /* ---------- กลุ่ม FRID 12 กลุ่ม (ตรงตามที่ตกลงกับผู้ใช้) ---------- */
  var FRID = {
    bzd:      { nm: "ยานอนหลับ / ยาคลายกังวล (Benzodiazepine, Z-drug)", lv: 2 },
    antidep:  { nm: "ยาต้านซึมเศร้า",                          lv: 2 },
    antipsy:  { nm: "ยาต้านโรคจิต",                            lv: 2 },
    anticonv: { nm: "ยากันชัก / ยาปวดเส้นประสาท",              lv: 2 },
    opioid:   { nm: "ยาแก้ปวดกลุ่ม opioid",                     lv: 2 },
    anticho:  { nm: "ยาต้านโคลิเนอร์จิก",                       lv: 2 },
    relax:    { nm: "ยาคลายกล้ามเนื้อ",                         lv: 1 },
    antihist: { nm: "ยาแก้แพ้ที่ทำให้ง่วง",                     lv: 1 },
    antihtn:  { nm: "ยาลดความดันบางกลุ่ม",                      lv: 1 },
    diuretic: { nm: "ยาขับปัสสาวะ",                             lv: 1 },
    alpha:    { nm: "ยาต่อมลูกหมาก / ยาที่ทำให้ความดันตก",      lv: 1 },
    bladder:  { nm: "ยารักษากระเพาะปัสสาวะไว",                  lv: 1 },
    none:     { nm: "ไม่อยู่ในกลุ่มเสี่ยงหกล้ม",                lv: 0 }
  };

  /* ---------- ตัวยาสำคัญ → ATC → กลุ่ม FRID + ชื่อการค้า/คำไทยที่พบบ่อย ----------
     รูปแบบ: [inn, atc, frid, [aliases...]]
     aliases รวมชื่อการค้าที่พบบ่อยในไทย และคำทับศัพท์ไทยที่คนเขียนบนซองยา */
  var DRUGS = [
    /* ---- Benzodiazepines / Z-drugs (N05BA, N05CD, N05CF) ---- */
    ["diazepam",      "N05BA01", "bzd", ["valium","ไดอะซีแพม","ไดอาซีแพม","diazepam"]],
    ["lorazepam",     "N05BA06", "bzd", ["ativan","ลอราซีแพม","lorazepam"]],
    ["alprazolam",    "N05BA12", "bzd", ["xanax","xanor","อัลปราโซแลม","alprazolam"]],
    ["clonazepam",    "N03AE01", "bzd", ["rivotril","โคลนาซีแพม","clonazepam"]],
    ["clorazepate",   "N05BA05", "bzd", ["tranxene","clorazepate"]],
    ["chlordiazepoxide","N05BA02","bzd", ["librium","chlordiazepoxide"]],
    ["midazolam",     "N05CD08", "bzd", ["dormicum","midazolam"]],
    ["zolpidem",      "N05CF02", "bzd", ["stilnox","ambien","โซลพิเดม","zolpidem"]],
    ["zopiclone",     "N05CF01", "bzd", ["imovane","zopiclone"]],
    /* ---- ยาต้านซึมเศร้า (N06A) ---- */
    ["amitriptyline", "N06AA09", "antidep", ["tryptanol","elavil","อะมิทริปไทลีน","amitriptyline","amitrip"]],
    ["nortriptyline", "N06AA10", "antidep", ["nortrilen","nortriptyline"]],
    ["imipramine",    "N06AA02", "antidep", ["tofranil","imipramine"]],
    ["fluoxetine",    "N06AB03", "antidep", ["prozac","fluoxetine","ฟลูออกซิทีน"]],
    ["sertraline",    "N06AB06", "antidep", ["zoloft","sertraline","เซอร์ทราลีน"]],
    ["escitalopram",  "N06AB10", "antidep", ["lexapro","escitalopram"]],
    ["citalopram",    "N06AB04", "antidep", ["cipram","citalopram"]],
    ["paroxetine",    "N06AB05", "antidep", ["seroxat","paroxetine"]],
    ["fluvoxamine",   "N06AB08", "antidep", ["faverin","fluvoxamine"]],
    ["venlafaxine",   "N06AX16", "antidep", ["effexor","venlafaxine"]],
    ["duloxetine",    "N06AX21", "antidep", ["cymbalta","duloxetine"]],
    ["mirtazapine",   "N06AX11", "antidep", ["remeron","mirtazapine"]],
    ["trazodone",     "N06AX05", "antidep", ["desyrel","trazodone","ทราโซโดน"]],
    ["bupropion",     "N06AX12", "antidep", ["wellbutrin","bupropion"]],
    /* ---- ยาต้านโรคจิต (N05A) ---- */
    ["haloperidol",   "N05AD01", "antipsy", ["haldol","haloperidol","ฮาโลเพอริดอล"]],
    ["chlorpromazine","N05AA01", "antipsy", ["largactil","chlorpromazine"]],
    ["perphenazine",  "N05AB03", "antipsy", ["perphenazine"]],
    ["risperidone",   "N05AX08", "antipsy", ["risperdal","risperidone","ริสเพอริโดน"]],
    ["quetiapine",    "N05AH04", "antipsy", ["seroquel","quetiapine","ควีไทอะปีน"]],
    ["olanzapine",    "N05AH03", "antipsy", ["zyprexa","olanzapine"]],
    ["aripiprazole",  "N05AX12", "antipsy", ["abilify","aripiprazole"]],
    ["clozapine",     "N05AH02", "antipsy", ["clozaril","clozapine"]],
    /* ---- ยากันชัก / ปวดเส้นประสาท (N03A) ---- */
    ["gabapentin",    "N03AX12", "anticonv", ["neurontin","gabapentin","กาบาเพนติน","gaba"]],
    ["pregabalin",    "N03AX16", "anticonv", ["lyrica","pregabalin","พรีกาบาลิน"]],
    ["phenytoin",     "N03AB02", "anticonv", ["dilantin","phenytoin"]],
    ["carbamazepine", "N03AF01", "anticonv", ["tegretol","carbamazepine"]],
    ["valproate",     "N03AG01", "anticonv", ["depakine","valproate","sodium valproate","valproic"]],
    ["levetiracetam", "N03AX14", "anticonv", ["keppra","levetiracetam"]],
    ["topiramate",    "N03AX11", "anticonv", ["topamax","topiramate"]],
    ["lamotrigine",   "N03AX09", "anticonv", ["lamictal","lamotrigine"]],
    ["phenobarbital", "N03AA02", "anticonv", ["phenobarb","phenobarbital"]],
    /* ---- opioid (N02A) ---- */
    ["tramadol",      "N02AX02", "opioid", ["tramal","tramadol","ทรามาดอล"]],
    ["codeine",       "R05DA04", "opioid", ["codeine","โคดีอีน"]],
    ["morphine",      "N02AA01", "opioid", ["morphine","มอร์ฟีน","mst"]],
    ["fentanyl",      "N02AB03", "opioid", ["durogesic","fentanyl"]],
    ["oxycodone",     "N02AA05", "opioid", ["oxycontin","oxycodone"]],
    ["methadone",     "N07BC02", "opioid", ["methadone"]],
    ["pethidine",     "N02AB02", "opioid", ["pethidine","meperidine"]],
    /* ---- anticholinergic ---- */
    ["oxybutynin",    "G04BD04", "bladder", ["ditropan","oxybutynin"]],
    ["tolterodine",   "G04BD07", "bladder", ["detrusitol","tolterodine"]],
    ["solifenacin",   "G04BD08", "bladder", ["vesicare","solifenacin"]],
    ["trihexyphenidyl","N04AA02","anticho", ["artane","benzhexol","trihexyphenidyl","ไตรเฮกซีเฟนิดิล"]],
    ["benztropine",   "N04AC01", "anticho", ["cogentin","benztropine"]],
    ["hyoscine",      "A03BB01", "anticho", ["buscopan","hyoscine","hyoscine butylbromide","บัสโคแพน"]],
    ["dicyclomine",   "A03AA07", "anticho", ["bentyl","dicyclomine"]],
    ["atropine",      "A03BA01", "anticho", ["atropine"]],
    /* ---- ยาระบบทางเดินหายใจ (พบบนฉลากที่ผู้ใช้ถ่ายมาจริง) ----
       montelukast / procaterol / acetylcysteine ไม่อยู่ในกลุ่มเสี่ยงหกล้มตาม STOPPFall
       แต่ต้องมีในฐาน มิฉะนั้นระบบจะตอบว่า "ไม่รู้จักยานี้" ทั้งที่เป็นยาที่ใช้กันทั่วไป
       และผู้ใช้จะเข้าใจผิดว่าถ่ายรูปไม่ดี */
    ["montelukast",   "R03DC03", "none", ["singulair","montelukast","lumont","montulair","montelukast sodium","มอนเทลูคาสต์"]],
    ["procaterol",    "R03CC08", "none", ["meptin","meptin mini","procaterol","โปรคาเทอรอล"]],
    ["acetylcysteine","R05CB01", "none", ["fluimucil","acetylcysteine","cystaline","nac","อะเซทิลซิสเทอีน"]],
    ["carbocisteine", "R05CB03", "none", ["carbocisteine","flemex","มิวโคโซลแวน"]],
    ["bromhexine",    "R05CB02", "none", ["bisolvon","bromhexine","โบรมเฮกซีน"]],
    ["ambroxol",      "R05CB06", "none", ["mucosolvan","ambroxol","แอมบรอกซอล"]],
    ["guaifenesin",   "R05CA03", "none", ["guaifenesin","glyceryl guaiacolate","กลีเซอริล กัวอะยาโคเลต"]],
    ["terpin hydrate","R05CA05", "none", ["terpin hydrate","terpin","เทอร์ปิน ไฮเดรต"]],
    /* dextromethorphan — ยาแก้ไอที่ออกฤทธิ์ต่อระบบประสาทส่วนกลาง
       ทำให้ง่วงและมึนได้ในผู้สูงอายุ จัดเป็นกลุ่มเฝ้าระวังระดับ 1 ให้เภสัชกรดูรวมกับยาอื่น */
    ["dextromethorphan","R05DA09","antihist", ["dextromethorphan","clinicof","romilar","เดกซ์โทรเมทอร์แฟน"]],
    ["budesonide",    "R03BA02", "none", ["pulmicort","budesonide","บูเดโซไนด์"]],
    /* ---- วิตามินและอาหารเสริมที่พบบ่อยบนฉลาก ---- */
    ["multivitamin",  "A11AA03", "none", ["multicap","multivitamin","วิตามินรวม","มัลติแคป"]],
    ["calcium carbonate","A12AA04","none", ["calcium carbonate","calcium","แคลเซียม"]],
    ["ferrous sulfate","B03AA07","none", ["ferrous sulfate","ferrous","ธาตุเหล็ก"]],
    /* ---- ยาที่พบบ่อยอื่น ๆ ---- */
    ["lansoprazole",  "A02BC03", "none", ["prevacid","lansoprazole","แลนโซพราโซล"]],
    ["esomeprazole",  "A02BC05", "none", ["nexium","esomeprazole","เอโซเมพราโซล"]],
    /* ---- ยาแก้แพ้ที่ทำให้ง่วง (R06A รุ่นแรก) ---- */
    ["chlorpheniramine","R06AB04","antihist", ["chlorpheniramine","cpm","คลอเฟนิรามีน","คลอร์เฟนิรามีน","piriton"]],
    ["diphenhydramine","R06AA02","antihist", ["benadryl","diphenhydramine"]],
    ["hydroxyzine",   "N05BB01", "antihist", ["atarax","hydroxyzine","ไฮดรอกไซซีน","hydroxyzine-fc","ucerax"]],
    ["dimenhydrinate","R06AA52", "antihist", ["dramamine","dimenhydrinate","ไดเมนไฮดริเนต"]],
    ["brompheniramine","R06AB01","antihist", ["brompheniramine"]],
    ["cyproheptadine","R06AX02", "antihist", ["periactin","cyproheptadine"]],
    ["promethazine",  "R06AD02", "antihist", ["phenergan","promethazine"]],
    /* ---- ยาคลายกล้ามเนื้อ (M03B) ---- */
    ["orphenadrine",  "M03BC01", "relax", ["norflex","norgesic","orphenadrine","ออร์เฟนาดรีน"]],
    ["tolperisone",   "M03BX04", "relax", ["mydocalm","tolperisone"]],
    ["baclofen",      "M03BX01", "relax", ["lioresal","baclofen"]],
    ["tizanidine",    "M03BX02", "relax", ["sirdalud","tizanidine"]],
    ["eperisone",     "M03BX09", "relax", ["myonal","eperisone"]],
    ["cyclobenzaprine","M03BX08","relax", ["cyclobenzaprine"]],
    /* ---- ยาลดความดันที่สัมพันธ์กับความดันตกเมื่อลุก ---- */
    ["amlodipine",    "C08CA01", "antihtn", ["norvasc","amlodipine","แอมโลดิปีน"]],
    ["nifedipine",    "C08CA05", "antihtn", ["adalat","nifedipine"]],
    ["enalapril",     "C09AA02", "antihtn", ["enaril","enalapril","อีนาลาพริล"]],
    ["lisinopril",    "C09AA03", "antihtn", ["zestril","lisinopril"]],
    ["losartan",      "C09CA01", "antihtn", ["cozaar","losartan","โลซาร์แทน"]],
    ["valsartan",     "C09CA03", "antihtn", ["diovan","valsartan"]],
    ["atenolol",      "C07AB03", "antihtn", ["tenormin","atenolol","อะทีโนลอล"]],
    ["metoprolol",    "C07AB02", "antihtn", ["betaloc","metoprolol"]],
    ["propranolol",   "C07AA05", "antihtn", ["inderal","propranolol"]],
    ["carvedilol",    "C07AG02", "antihtn", ["dilatrend","carvedilol"]],
    ["bisoprolol",    "C07AB07", "antihtn", ["concor","bisoprolol"]],
    ["clonidine",     "C02AC01", "antihtn", ["catapres","clonidine"]],
    ["methyldopa",    "C02AB01", "antihtn", ["aldomet","methyldopa"]],
    ["hydralazine",   "C02DB02", "antihtn", ["apresoline","hydralazine"]],
    ["isosorbide",    "C01DA08", "antihtn", ["isordil","isosorbide","isosorbide dinitrate","isosorbide mononitrate","imdur"]],
    ["nitroglycerin", "C01DA02", "antihtn", ["nitroglycerin","gtn"]],
    /* ---- ยาขับปัสสาวะ (C03) ---- */
    ["furosemide",    "C03CA01", "diuretic", ["lasix","furosemide","ฟูโรซีไมด์"]],
    ["hydrochlorothiazide","C03AA03","diuretic",["hctz","hydrochlorothiazide","dichlotride","ไฮโดรคลอโรไทอาไซด์"]],
    ["spironolactone","C03DA01", "diuretic", ["aldactone","spironolactone"]],
    ["torsemide",     "C03CA04", "diuretic", ["torsemide"]],
    ["indapamide",    "C03BA11", "diuretic", ["natrilix","indapamide"]],
    /* ---- alpha-blocker / ต่อมลูกหมาก ---- */
    ["doxazosin",     "C02CA04", "alpha", ["cardura","doxazosin"]],
    ["prazosin",      "C02CA01", "alpha", ["minipress","prazosin"]],
    ["terazosin",     "G04CA03", "alpha", ["hytrin","terazosin"]],
    ["tamsulosin",    "G04CA02", "alpha", ["harnal","flomax","tamsulosin","แทมซูโลซิน"]],
    ["alfuzosin",     "G04CA01", "alpha", ["xatral","alfuzosin"]],
    ["silodosin",     "G04CA04", "alpha", ["urief","silodosin"]],
    /* ---- ยาที่ไม่ใช่ FRID แต่พบบ่อยมาก (ให้จับคู่ได้ เพื่อบอกผู้ใช้ว่า "ไม่อยู่ในกลุ่มเสี่ยง") ---- */
    ["metformin",     "A10BA02", "none", ["glucophage","metformin","เมทฟอร์มิน"]],
    ["glipizide",     "A10BB07", "none", ["minidiab","glipizide"]],
    ["gliclazide",    "A10BB09", "none", ["diamicron","gliclazide"]],
    ["glibenclamide", "A10BB01", "none", ["daonil","glibenclamide","glyburide"]],
    ["sitagliptin",   "A10BH01", "none", ["januvia","sitagliptin"]],
    ["pioglitazone",  "A10BG03", "none", ["actos","pioglitazone"]],
    ["insulin",       "A10A",    "none", ["insulin","อินซูลิน","mixtard","novomix","lantus"]],
    ["simvastatin",   "C10AA01", "none", ["zocor","simvastatin","ซิมวาสแตติน"]],
    ["atorvastatin",  "C10AA05", "none", ["lipitor","atorvastatin","อะทอร์วาสแตติน"]],
    ["rosuvastatin",  "C10AA07", "none", ["crestor","rosuvastatin"]],
    ["aspirin",       "B01AC06", "none", ["aspirin","แอสไพริน","asa","cardiprin"]],
    ["clopidogrel",   "B01AC04", "none", ["plavix","clopidogrel"]],
    ["warfarin",      "B01AA03", "none", ["orfarin","warfarin","วาร์ฟาริน"]],
    ["paracetamol",   "N02BE01", "none", ["paracetamol","tylenol","sara","พาราเซตามอล","พารา","acetaminophen"]],
    ["ibuprofen",     "M01AE01", "none", ["brufen","ibuprofen","nurofen","ไอบูโพรเฟน","fafen","fafen forte","brufen"]],
    ["diclofenac",    "M01AB05", "none", ["voltaren","diclofenac","ไดโคลฟีแนค"]],
    ["naproxen",      "M01AE02", "none", ["naprosyn","naproxen"]],
    ["celecoxib",     "M01AH01", "none", ["celebrex","celecoxib"]],
    ["etoricoxib",    "M01AH05", "none", ["arcoxia","etoricoxib"]],
    ["omeprazole",    "A02BC01", "none", ["losec","omeprazole","โอเมพราโซล","miracid","omeprazole gpo","miracid"]],
    ["pantoprazole",  "A02BC02", "none", ["controloc","pantoprazole"]],
    ["ranitidine",    "A02BA02", "none", ["zantac","ranitidine"]],
    ["domperidone",   "A03FA03", "none", ["motilium","domperidone"]],
    ["simethicone",   "A03AX13", "none", ["air-x","simethicone"]],
    ["loratadine",    "R06AX13", "none", ["clarityne","loratadine","ลอราทาดีน"]],
    ["cetirizine",    "R06AE07", "none", ["zyrtec","cetirizine","เซทิริซีน"]],
    ["fexofenadine",  "R06AX26", "none", ["telfast","fexofenadine"]],
    ["salbutamol",    "R03AC02", "none", ["ventolin","salbutamol"]],
    ["levothyroxine", "H03AA01", "none", ["eltroxin","levothyroxine","thyroxine"]],
    ["allopurinol",   "M04AA01", "none", ["zyloric","allopurinol"]],
    ["colchicine",    "M04AC01", "none", ["colchicine"]],
    ["prednisolone",  "H02AB06", "none", ["prednisolone","เพรดนิโซโลน"]],
    ["amoxicillin",   "J01CA04", "none", ["amoxil","amoxicillin","อะม็อกซี"]],
    ["calcium",       "A12AA",   "none", ["calcium","แคลเซียม","caltrate"]],
    ["vitamin d",     "A11CC",   "none", ["vitamin d","วิตามินดี","calciferol"]],
    ["folic acid",    "B03BB01", "none", ["folic","โฟลิก","folic acid"]],
    ["ferrous",       "B03AA",   "none", ["ferrous","fbc","ferrous fumarate","ferrous sulfate","ธาตุเหล็ก"]],
    ["donepezil",     "N06DA02", "none", ["aricept","donepezil"]],
    ["memantine",     "N06DX01", "none", ["ebixa","memantine"]],
    ["levodopa",      "N04BA02", "none", ["madopar","sinemet","levodopa"]],
    ["digoxin",       "C01AA05", "none", ["lanoxin","digoxin"]],
    ["amiodarone",    "C01BD01", "none", ["cordarone","amiodarone"]],
    ["betahistine",   "N07CA01", "none", ["serc","betahistine"]],
    ["cinnarizine",   "N07CA02", "antihist", ["stugeron","cinnarizine"]],
    ["flunarizine",   "N07CA03", "antihist", ["sibelium","flunarizine"]],
    /* ---- เพิ่มเติม: ยาที่พบบ่อยในบัญชียาหลักแห่งชาติสำหรับผู้สูงอายุ ---- */
    ["temazepam",     "N05CD07", "bzd",      ["temazepam"]],
    ["flurazepam",    "N05CD01", "bzd",      ["dalmadorm","flurazepam"]],
    ["doxepin",       "N06AA12", "antidep",  ["sinequan","doxepin"]],
    ["sulpiride",     "N05AL01", "antipsy",  ["dogmatil","sulpiride"]],
    ["hydroxyzine hcl","N05BB01","antihist", ["hydroxyzine hydrochloride"]],
    ["dexchlorpheniramine","R06AB02","antihist",["polaramine","dexchlorpheniramine"]],
    ["mefenamic acid","M01AG01", "none",     ["ponstan","mefenamic","mefenamic acid","พอนสแตน"]],
    ["glimepiride",   "A10BB12", "none",     ["amaryl","glimepiride"]],
    ["losartan hctz", "C09DA01", "diuretic", ["hyzaar","losartan hydrochlorothiazide","losartan/hctz"]],
    ["amlodipine valsartan","C09DB01","antihtn",["exforge"]],
    ["hydroxychloroquine","P01BA02","none",  ["plaquenil","hydroxychloroquine"]],
    ["methotrexate",  "L04AX03", "none",     ["methotrexate","mtx"]],
    ["tamsulosin dutasteride","G04CA52","alpha",["duodart"]],
    ["finasteride",   "G04CB01", "none",     ["proscar","finasteride"]],
    ["dutasteride",   "G04CB02", "none",     ["avodart","dutasteride"]]
  ];

  /* ---------- ดัชนีค้นหา ---------- */
  var INDEX = [];   /* {key, inn} */
  var BY_INN = {};
  DRUGS.forEach(function (d) {
    var inn = d[0];
    BY_INN[inn] = { inn: inn, atc: d[1], frid: d[2], aliases: d[3] };
    var keys = [inn].concat(d[3] || []);
    keys.forEach(function (k) { INDEX.push({ key: norm(k), inn: inn }); });
  });

  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/[​\s\-_.,;:()\[\]{}"'`®™]/g, "")
      .replace(/[0-9]+(mg|mcg|ml|g|iu|%|เม็ด|มก\.?|มล\.?)?/g, "");
  }
  /* ระยะแก้ไข (Levenshtein) — จำกัดความยาวเพื่อไม่ให้ช้าบนมือถือ */
  function lev(a, b) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (!la) return lb; if (!lb) return la;
    if (Math.abs(la - lb) > 4) return 99;
    var prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  /* จับคู่คำเดียว → {inn, conf, via} หรือ null
     conf: 1.0 ตรงเป๊ะ · 0.9 prefix ≥5 ตัว · 0.75 edit distance 1 · 0.6 edit distance 2 */
  function matchToken(tok) {
    var t = norm(tok);
    if (t.length < 3) return null;
    var best = null;
    for (var i = 0; i < INDEX.length; i++) {
      var k = INDEX[i].key, c = 0;
      if (k === t) c = 1.0;
      else if (t.length >= 5 && (k.indexOf(t) === 0 || t.indexOf(k) === 0) && Math.min(k.length, t.length) >= 5) c = 0.9;
      else if (k.length >= 5 && t.length >= 5) {
        var d = lev(k, t);
        if (d === 1) c = 0.75; else if (d === 2 && k.length >= 7) c = 0.6;
      }
      if (c > 0 && (!best || c > best.conf)) best = { inn: INDEX[i].inn, conf: c, via: INDEX[i].key };
      if (c === 1) break;
    }
    return best;
  }

  /* ---------- NER แบบกฎ: แยกชื่อยา · ขนาด · หน่วย · วิธีใช้ จากข้อความ OCR ----------
     ฉลากยาไทยมีรูปแบบพอเดาได้: "ชื่อยา 5 mg" · "รับประทาน 1 เม็ด ก่อนนอน"
     ตัวเลข+หน่วยอยู่ติดชื่อยาเสมอ จึงใช้เป็นสมอ */
  var UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|ug|g|ml|iu|%|มก\.?|มล\.?|มิลลิกรัม|กรัม)/gi;
  var FREQ_RE = /(วันละ\s*\d+\s*(?:ครั้ง|เม็ด)|\d+\s*(?:ครั้ง|เม็ด)\s*(?:ต่อ)?วัน|ก่อนนอน|หลังอาหาร|ก่อนอาหาร|เช้า|กลางวัน|เย็น|od|bid|tid|qid|hs|prn|q\d+h)/gi;
  var STOP = /^(tab|tablet|tablets|cap|capsule|caps|เม็ด|แคปซูล|ยา|รับประทาน|ครั้งละ|วันละ|ก่อน|หลัง|อาหาร|นอน|เช้า|เย็น|กลางวัน|the|and|for|with|use|take|film|coated|extended|release|sr|xr|er|forte|plus|mg|ml|mcg)$/i;

  function extract(text) {
    var out = { candidates: [], doses: [], freq: [], raw: text };
    if (!text) return out;
    var m;
    while ((m = UNIT_RE.exec(text)) !== null) out.doses.push(m[1].replace(",", ".") + " " + m[2].toLowerCase());
    while ((m = FREQ_RE.exec(text)) !== null) out.freq.push(m[0]);
    /* แยกคำ: ตัวอักษรอังกฤษต่อเนื่อง หรือคำไทยต่อเนื่อง */
    var toks = text.match(/[A-Za-z][A-Za-z\-]{2,}|[฀-๿]{3,}/g) || [];
    var seen = {};
    toks.forEach(function (tk) {
      if (STOP.test(tk)) return;
      var r = matchToken(tk);
      if (!r || seen[r.inn]) return;
      seen[r.inn] = 1;
      out.candidates.push({ token: tk, inn: r.inn, conf: r.conf, via: r.via });
    });
    /* ลองจับคู่คู่คำ (เช่น "sodium valproate" · "hyoscine butylbromide") */
    var words = text.split(/[\s,;/]+/);
    for (var i = 0; i + 1 < words.length; i++) {
      var pair = words[i] + " " + words[i + 1];
      var r2 = matchToken(pair);
      if (r2 && r2.conf >= 0.9 && !seen[r2.inn]) { seen[r2.inn] = 1; out.candidates.push({ token: pair, inn: r2.inn, conf: r2.conf, via: r2.via }); }
    }
    out.candidates.sort(function (a, b) { return b.conf - a.conf; });
    return out;
  }

  /* ---------- สรุปกลุ่ม FRID จากรายการยาที่ยืนยันแล้ว ---------- */
  function classify(inn) {
    var d = BY_INN[inn];
    if (!d) return { inn: inn, atc: null, frid: "unknown", lv: null, fridNm: "ไม่พบในฐานข้อมูล — ให้เภสัชกรจัดกลุ่ม" };
    return { inn: inn, atc: d.atc, frid: d.frid, lv: FRID[d.frid].lv, fridNm: FRID[d.frid].nm };
  }
  function summarize(list) {
    /* list = [{inn, frid?, lv?}] — คืน {high, mod, unknown, groups[], needsReview} */
    var high = 0, mod = 0, unknown = 0, groups = {};
    (list || []).forEach(function (x) {
      var c = x.frid ? { frid: x.frid, lv: x.lv != null ? x.lv : (FRID[x.frid] ? FRID[x.frid].lv : null) } : classify(x.inn);
      if (c.frid === "unknown" || c.lv == null) { unknown++; return; }
      if (c.lv === 2) high++; else if (c.lv === 1) mod++;
      if (c.lv > 0) groups[c.frid] = (groups[c.frid] || 0) + 1;
    });
    return { high: high, mod: mod, unknown: unknown, groups: Object.keys(groups),
             total: high * 2 + mod,
             needsReview: high > 0 || mod >= 2 || unknown > 0 || (list || []).length >= 5 };
  }

  /* ข้อความมาตรฐานที่ใช้กับผู้ใช้ — จงใจไม่มีคำว่า "อันตราย" หรือ "หยุดยา" */
  var MSG = {
    flagged: "พบยาที่อาจสัมพันธ์กับอาการง่วง เวียนศีรษะ หรือความเสี่ยงหกล้ม ควรนำรายการยาทั้งหมดไปให้เภสัชกรหรือแพทย์ทบทวน — ห้ามหยุดหรือปรับยาเองก่อนพบผู้เชี่ยวชาญ",
    unknown:  "มียาที่ระบบไม่รู้จัก เภสัชกรจะช่วยจัดกลุ่มให้ — ไม่ได้แปลว่ายานั้นมีปัญหา",
    clear:    "ยาที่บันทึกไม่อยู่ในกลุ่มที่เพิ่มความเสี่ยงหกล้ม แต่ควรทบทวนรายการยากับเภสัชกรอย่างน้อยปีละครั้ง"
  };

  return { FRID: FRID, DRUGS: DRUGS, BY_INN: BY_INN, MSG: MSG,
           norm: norm, matchToken: matchToken, extract: extract,
           classify: classify, summarize: summarize };
})();
if (typeof module !== "undefined") module.exports = CSMeds;
