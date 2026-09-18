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
   ไฟล์นี้ไม่ใช่ทะเบียนยาทั้งประเทศ — เป็นตัวยาสำคัญที่พบบ่อยในผู้สูงอายุไทย
   ครบทุกระบบของร่างกาย ทั้งยาที่เพิ่มความเสี่ยงหกล้มและยาที่ไม่เพิ่ม (จำนวนดูที่ DRUGS.length)
   ทุกตัวมีข้อมูลประกอบใน INFO: ชื่อไทย กลุ่มยา ใช้รักษา และข้อควรระวัง

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
    ["trihexyphenidyl","N04AA01","anticho", ["artane","benzhexol","trihexyphenidyl","ไตรเฮกซีเฟนิดิล"]],
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
    ["dutasteride",   "G04CB02", "none",     ["avodart","dutasteride"]],
    /* ============================================================
       ขยายฐาน (ก.ย. 2569): ยาที่พบบ่อยในผู้สูงอายุไทยครบทุกระบบ
       อ้างอิงรายการจากบัญชียาหลักแห่งชาติและยาที่ผู้สูงอายุได้รับบ่อย
       รหัส ATC ตาม WHO · กลุ่ม FRID ตรงกับกฎ cs_atc_to_frid ฝั่งเซิร์ฟเวอร์
       (ข้อยกเว้นที่จงใจมีเอกสารในเทสต์ test_meds_kb.mjs)
       ============================================================ */
    /* ---- ระดับ 2: ยานอนหลับ/คลายกังวลเพิ่มเติม ---- */
    ["bromazepam",    "N05BA08", "bzd",      ["lexotan","bromazepam","โบรมาซีแพม"]],
    ["clobazam",      "N05BA09", "bzd",      ["frisium","clobazam"]],
    ["oxazepam",      "N05BA04", "bzd",      ["serax","oxazepam"]],
    ["estazolam",     "N05CD04", "bzd",      ["eurodin","estazolam"]],
    ["triazolam",     "N05CD05", "bzd",      ["halcion","triazolam"]],
    ["nitrazepam",    "N05CD02", "bzd",      ["mogadon","nitrazepam"]],
    ["eszopiclone",   "N05CF04", "bzd",      ["lunesta","eszopiclone"]],
    /* ---- ระดับ 2: ยาต้านซึมเศร้าเพิ่มเติม ---- */
    ["clomipramine",  "N06AA04", "antidep",  ["anafranil","clomipramine"]],
    ["dosulepin",     "N06AA16", "antidep",  ["prothiaden","dosulepin","dothiepin"]],
    ["desvenlafaxine","N06AX23", "antidep",  ["pristiq","desvenlafaxine"]],
    ["vortioxetine",  "N06AX26", "antidep",  ["brintellix","trintellix","vortioxetine"]],
    ["agomelatine",   "N06AX22", "antidep",  ["valdoxan","agomelatine"]],
    ["mianserin",     "N06AX03", "antidep",  ["tolvon","mianserin"]],
    ["tianeptine",    "N06AX14", "antidep",  ["stablon","tianeptine"]],
    ["moclobemide",   "N06AG02", "antidep",  ["aurorix","moclobemide"]],
    /* ---- ระดับ 2: ยาต้านโรคจิตเพิ่มเติม (prochlorperazine ใช้แก้เวียนศีรษะบ่อยในไทย) ---- */
    ["fluphenazine",  "N05AB02", "antipsy",  ["modecate","fluphenazine"]],
    ["trifluoperazine","N05AB06","antipsy",  ["stelazine","trifluoperazine"]],
    ["prochlorperazine","N05AB04","antipsy", ["stemetil","prochlorperazine"]],
    ["thioridazine",  "N05AC02", "antipsy",  ["melleril","thioridazine"]],
    ["ziprasidone",   "N05AE04", "antipsy",  ["geodon","ziprasidone"]],
    ["lurasidone",    "N05AE05", "antipsy",  ["latuda","lurasidone"]],
    ["paliperidone",  "N05AX13", "antipsy",  ["invega","paliperidone"]],
    ["amisulpride",   "N05AL05", "antipsy",  ["solian","amisulpride"]],
    /* ---- ระดับ 2: ยากันชักเพิ่มเติม ---- */
    ["oxcarbazepine", "N03AF02", "anticonv", ["trileptal","oxcarbazepine"]],
    ["lacosamide",    "N03AX18", "anticonv", ["vimpat","lacosamide"]],
    ["zonisamide",    "N03AX15", "anticonv", ["zonegran","zonisamide"]],
    ["primidone",     "N03AA03", "anticonv", ["mysoline","primidone"]],
    /* ---- ระดับ 2: opioid เพิ่มเติม และสูตรผสมกับพาราเซตามอล ---- */
    ["tapentadol",    "N02AX06", "opioid",   ["nucynta","tapentadol"]],
    ["buprenorphine", "N02AE01", "opioid",   ["transtec","norspan","buprenorphine"]],
    ["hydromorphone", "N02AA03", "opioid",   ["jurnista","hydromorphone"]],
    ["tramadol paracetamol","N02AJ13","opioid",["ultracet","tramadol/paracetamol"]],
    ["codeine paracetamol","N02AJ06","opioid",["paracetamol codeine","co-codamol"]],
    /* ---- ระดับ 2: ต้านโคลิเนอร์จิก ---- */
    ["biperiden",     "N04AA02", "anticho",  ["akineton","biperiden"]],
    /* ---- ระดับ 1: ยากระเพาะปัสสาวะไว (mirabegron ไม่ใช่ต้านโคลิเนอร์จิก — ข้อยกเว้น) ---- */
    ["trospium",      "G04BD09", "bladder",  ["spasmex","trospium"]],
    ["darifenacin",   "G04BD10", "bladder",  ["enablex","emselex","darifenacin"]],
    ["fesoterodine",  "G04BD11", "bladder",  ["toviaz","fesoterodine"]],
    ["propiverine",   "G04BD06", "bladder",  ["mictonorm","propiverine"]],
    ["flavoxate",     "G04BD02", "bladder",  ["genurin","urispas","flavoxate"]],
    ["mirabegron",    "G04BD12", "none",     ["betmiga","mirabegron"]],
    /* ---- ระดับ 1: ยาแก้แพ้ที่ทำให้ง่วง (triprolidine อยู่ R06AX แต่เป็นรุ่นแรก — ข้อยกเว้น) ---- */
    ["doxylamine",    "R06AA09", "antihist", ["unisom","doxylamine"]],
    ["meclizine",     "R06AE05", "antihist", ["bonamine","meclizine","meclozine"]],
    ["triprolidine",  "R06AX07", "antihist", ["actifed","triprolidine"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ยาแก้แพ้รุ่นใหม่ ---- */
    ["levocetirizine","R06AE09", "none",     ["xyzal","levocetirizine"]],
    ["desloratadine", "R06AX27", "none",     ["aerius","desloratadine"]],
    ["bilastine",     "R06AX29", "none",     ["bilaxten","bilastine"]],
    /* ---- ระดับ 1: ยาคลายกล้ามเนื้อเพิ่มเติม ---- */
    ["methocarbamol", "M03BA03", "relax",    ["robaxin","methocarbamol"]],
    ["carisoprodol",  "M03BA02", "relax",    ["soma","carisoprodol"]],
    ["chlorzoxazone", "M03BB03", "relax",    ["parafon","chlorzoxazone"]],
    /* ---- ระดับ 1: ยาลดความดันเพิ่มเติม ---- */
    ["felodipine",    "C08CA02", "antihtn",  ["plendil","felodipine"]],
    ["lercanidipine", "C08CA13", "antihtn",  ["zanidip","lercanidipine"]],
    ["nicardipine",   "C08CA04", "antihtn",  ["cardene","nicardipine"]],
    ["manidipine",    "C08CA11", "antihtn",  ["madiplot","manidipine"]],
    ["diltiazem",     "C08DB01", "antihtn",  ["herbesser","diltiazem"]],
    ["verapamil",     "C08DA01", "antihtn",  ["isoptin","verapamil"]],
    ["captopril",     "C09AA01", "antihtn",  ["capoten","captopril"]],
    ["ramipril",      "C09AA05", "antihtn",  ["tritace","ramipril"]],
    ["perindopril",   "C09AA04", "antihtn",  ["coversyl","perindopril"]],
    ["irbesartan",    "C09CA04", "antihtn",  ["aprovel","irbesartan"]],
    ["candesartan",   "C09CA06", "antihtn",  ["blopress","candesartan"]],
    ["telmisartan",   "C09CA07", "antihtn",  ["micardis","telmisartan"]],
    ["olmesartan",    "C09CA08", "antihtn",  ["olmetec","olmesartan"]],
    ["sacubitril valsartan","C09DX04","antihtn",["entresto","sacubitril"]],
    ["nebivolol",     "C07AB12", "antihtn",  ["nebilet","nebivolol"]],
    ["labetalol",     "C07AG01", "antihtn",  ["trandate","labetalol"]],
    ["moxonidine",    "C02AC05", "antihtn",  ["physiotens","moxonidine"]],
    ["minoxidil",     "C02DC01", "antihtn",  ["loniten","minoxidil"]],
    /* ---- ระดับ 1: ยาขับปัสสาวะ และยาลดความดันสูตรผสมยาขับปัสสาวะ ---- */
    ["amiloride",     "C03DB01", "diuretic", ["moduretic","amiloride"]],
    ["chlorthalidone","C03BA04", "diuretic", ["hygroton","chlorthalidone"]],
    ["bumetanide",    "C03CA02", "diuretic", ["burinex","bumetanide"]],
    ["eplerenone",    "C03DA04", "diuretic", ["inspra","eplerenone"]],
    ["valsartan hctz","C09DA03", "diuretic", ["co-diovan","valsartan hydrochlorothiazide"]],
    ["telmisartan hctz","C09DA07","diuretic",["micardis plus","telmisartan hydrochlorothiazide"]],
    ["irbesartan hctz","C09DA04","diuretic", ["coaprovel","co-aprovel"]],
    ["enalapril hctz","C09BA02", "diuretic", ["co-renitec","enalapril hydrochlorothiazide"]],
    ["bisoprolol hctz","C07BB07","diuretic", ["ziac","lodoz"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: เบาหวาน ---- */
    ["vildagliptin",  "A10BH02", "none",     ["galvus","vildagliptin"]],
    ["linagliptin",   "A10BH05", "none",     ["trajenta","linagliptin"]],
    ["saxagliptin",   "A10BH03", "none",     ["onglyza","saxagliptin"]],
    ["sitagliptin metformin","A10BD07","none",["janumet"]],
    ["empagliflozin", "A10BK03", "none",     ["jardiance","empagliflozin"]],
    ["dapagliflozin", "A10BK01", "none",     ["forxiga","dapagliflozin"]],
    ["canagliflozin", "A10BK02", "none",     ["invokana","canagliflozin"]],
    ["acarbose",      "A10BF01", "none",     ["glucobay","acarbose"]],
    ["repaglinide",   "A10BX02", "none",     ["novonorm","repaglinide"]],
    ["liraglutide",   "A10BJ02", "none",     ["victoza","saxenda","liraglutide"]],
    ["semaglutide",   "A10BJ06", "none",     ["ozempic","rybelsus","semaglutide"]],
    ["dulaglutide",   "A10BJ05", "none",     ["trulicity","dulaglutide"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ไขมันในเลือด ---- */
    ["pravastatin",   "C10AA03", "none",     ["pravachol","pravastatin"]],
    ["pitavastatin",  "C10AA08", "none",     ["livalo","pitavastatin"]],
    ["lovastatin",    "C10AA02", "none",     ["mevacor","lovastatin"]],
    ["fenofibrate",   "C10AB05", "none",     ["lipanthyl","fenofibrate"]],
    ["gemfibrozil",   "C10AB04", "none",     ["lopid","gemfibrozil"]],
    ["ezetimibe",     "C10AX09", "none",     ["ezetrol","ezetimibe"]],
    ["omega-3",       "C10AX06", "none",     ["omega 3","fish oil","น้ำมันปลา"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ต้านเกล็ดเลือด/ต้านการแข็งตัวของเลือด (ล้มแล้วเลือดออกง่าย) ---- */
    ["rivaroxaban",   "B01AF01", "none",     ["xarelto","rivaroxaban"]],
    ["apixaban",      "B01AF02", "none",     ["eliquis","apixaban"]],
    ["edoxaban",      "B01AF03", "none",     ["lixiana","edoxaban"]],
    ["dabigatran",    "B01AE07", "none",     ["pradaxa","dabigatran"]],
    ["ticagrelor",    "B01AC24", "none",     ["brilinta","ticagrelor"]],
    ["prasugrel",     "B01AC22", "none",     ["effient","prasugrel"]],
    ["cilostazol",    "B01AC23", "none",     ["pletaal","cilostazol"]],
    ["dipyridamole",  "B01AC07", "none",     ["persantin","dipyridamole"]],
    ["enoxaparin",    "B01AB05", "none",     ["clexane","enoxaparin"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: หัวใจ ---- */
    ["ivabradine",    "C01EB17", "none",     ["coralan","procoralan","ivabradine"]],
    ["trimetazidine", "C01EB15", "none",     ["vastarel","trimetazidine"]],
    ["ranolazine",    "C01EB18", "none",     ["ranexa","ranolazine"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ทางเดินอาหาร ---- */
    ["famotidine",    "A02BA03", "none",     ["pepcid","famotidine"]],
    ["rabeprazole",   "A02BC04", "none",     ["pariet","rabeprazole"]],
    ["dexlansoprazole","A02BC06","none",     ["dexilant","dexlansoprazole"]],
    ["sucralfate",    "A02BX02", "none",     ["ulsanic","sucralfate"]],
    ["aluminium hydroxide","A02AB01","none", ["alum milk","antacid"]],
    ["magnesium hydroxide","A02AA04","none", ["milk of magnesia","magnesia"]],
    ["alginate",      "A02BX13", "none",     ["gaviscon","alginate"]],
    ["metoclopramide","A03FA01", "none",     ["plasil","metoclopramide"]],
    ["ondansetron",   "A04AA01", "none",     ["zofran","ondansetron"]],
    ["loperamide",    "A07DA03", "none",     ["imodium","loperamide"]],
    ["bisacodyl",     "A06AB02", "none",     ["dulcolax","bisacodyl"]],
    ["senna",         "A06AB06", "none",     ["senokot","sennoside","มะขามแขก"]],
    ["lactulose",     "A06AD11", "none",     ["duphalac","lactulose"]],
    ["macrogol",      "A06AD15", "none",     ["forlax","polyethylene glycol"]],
    ["docusate",      "A06AA02", "none",     ["docusate"]],
    ["psyllium",      "A06AC01", "none",     ["mucilin","metamucil","ispaghula"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ทางเดินหายใจและจมูก ---- */
    ["tiotropium",    "R03BB04", "none",     ["spiriva","tiotropium"]],
    ["ipratropium",   "R03BB01", "none",     ["atrovent","berodual","ipratropium"]],
    ["salmeterol fluticasone","R03AK06","none",["seretide","salmeterol"]],
    ["budesonide formoterol","R03AK07","none",["symbicort","formoterol"]],
    ["theophylline",  "R03DA04", "none",     ["xanthium","theophylline"]],
    ["fluticasone nasal","R01AD08","none",   ["flixonase","fluticasone"]],
    ["mometasone nasal","R01AD09","none",    ["nasonex","mometasone"]],
    ["pseudoephedrine","R01BA02","none",     ["sudafed","pseudoephedrine"]],
    ["oxymetazoline", "R01AA05", "none",     ["iliadin","oxymetazoline"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ปวด ข้อ กระดูก ---- */
    ["meloxicam",     "M01AC06", "none",     ["mobic","meloxicam"]],
    ["piroxicam",     "M01AC01", "none",     ["feldene","piroxicam"]],
    ["indomethacin",  "M01AB01", "none",     ["indocid","indomethacin"]],
    ["aceclofenac",   "M01AB16", "none",     ["airtal","aceclofenac"]],
    ["glucosamine",   "M01AX05", "none",     ["viartril","glucosamine"]],
    ["diacerein",     "M01AX21", "none",     ["artrodar","diacerein"]],
    ["febuxostat",    "M04AA03", "none",     ["feburic","adenuric","febuxostat"]],
    ["probenecid",    "M04AB01", "none",     ["probenecid"]],
    ["alendronate",   "M05BA04", "none",     ["fosamax","alendronate"]],
    ["risedronate",   "M05BA07", "none",     ["actonel","risedronate"]],
    ["ibandronate",   "M05BA06", "none",     ["bonviva","ibandronate"]],
    ["zoledronic acid","M05BA08","none",     ["aclasta","zoledronic"]],
    ["denosumab",     "M05BX04", "none",     ["prolia","denosumab"]],
    ["calcitriol",    "A11CC04", "none",     ["rocaltrol","calcitriol"]],
    ["alfacalcidol",  "A11CC03", "none",     ["one-alpha","alfacalcidol"]],
    ["cholecalciferol","A11CC05","none",     ["cholecalciferol"]],
    ["ergocalciferol","A11CC01", "none",     ["ergocalciferol"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ต่อมไร้ท่อ สเตียรอยด์ ---- */
    ["methimazole",   "H03BB02", "none",     ["tapazole","methimazole","thiamazole"]],
    ["propylthiouracil","H03BA02","none",    ["ptu","propylthiouracil"]],
    ["dexamethasone", "H02AB02", "none",     ["dexamethasone","เดกซาเมทาโซน"]],
    ["hydrocortisone","H02AB09", "none",     ["hydrocortisone"]],
    ["methylprednisolone","H02AB04","none",  ["medrol","methylprednisolone"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ทางเดินปัสสาวะ ---- */
    ["sildenafil",    "G04BE03", "none",     ["viagra","sildenafil"]],
    ["tadalafil",     "G04BE08", "none",     ["cialis","tadalafil"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยงตาม STOPPFall แต่มีข้อควรระวัง: สมองเสื่อม พาร์กินสัน ---- */
    ["rivastigmine",  "N06DA03", "none",     ["exelon","rivastigmine"]],
    ["galantamine",   "N06DA04", "none",     ["reminyl","galantamine"]],
    ["pramipexole",   "N04BC05", "none",     ["sifrol","pramipexole"]],
    ["ropinirole",    "N04BC04", "none",     ["requip","ropinirole"]],
    ["rasagiline",    "N04BD02", "none",     ["azilect","rasagiline"]],
    ["selegiline",    "N04BD01", "none",     ["jumex","selegiline"]],
    ["amantadine",    "N04BB01", "none",     ["symmetrel","amantadine"]],
    ["entacapone",    "N04BX02", "none",     ["comtan","entacapone"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ยาหยอดตา ---- */
    ["timolol eye",   "S01ED01", "none",     ["timolol","timoptol"]],
    ["latanoprost",   "S01EE01", "none",     ["xalatan","latanoprost"]],
    ["brimonidine",   "S01EA05", "none",     ["alphagan","brimonidine"]],
    ["artificial tears","S01KA02","none",    ["hypromellose","tears naturale","น้ำตาเทียม"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: ยาต้านการติดเชื้อ ---- */
    ["amoxicillin clavulanate","J01CR02","none",["augmentin","amoxiclav"]],
    ["cephalexin",    "J01DB01", "none",     ["keflex","cephalexin","cefalexin"]],
    ["cefuroxime",    "J01DC02", "none",     ["zinnat","cefuroxime"]],
    ["ciprofloxacin", "J01MA02", "none",     ["ciprobay","ciprofloxacin"]],
    ["levofloxacin",  "J01MA12", "none",     ["cravit","levofloxacin"]],
    ["norfloxacin",   "J01MA06", "none",     ["norflox","norfloxacin"]],
    ["azithromycin",  "J01FA10", "none",     ["zithromax","azithromycin"]],
    ["clarithromycin","J01FA09", "none",     ["klacid","clarithromycin"]],
    ["doxycycline",   "J01AA02", "none",     ["vibramycin","doxycycline"]],
    ["co-trimoxazole","J01EE01", "none",     ["bactrim","sulfamethoxazole"]],
    ["nitrofurantoin","J01XE01", "none",     ["macrodantin","nitrofurantoin"]],
    ["metronidazole", "P01AB01", "none",     ["flagyl","metronidazole"]],
    ["acyclovir",     "J05AB01", "none",     ["zovirax","acyclovir","aciclovir"]],
    ["valacyclovir",  "J05AB11", "none",     ["valtrex","valacyclovir"]],
    ["oseltamivir",   "J05AH02", "none",     ["tamiflu","oseltamivir"]],
    ["fluconazole",   "J02AC01", "none",     ["diflucan","fluconazole"]],
    /* ---- ไม่อยู่ในกลุ่มเสี่ยง: วิตามิน เกลือแร่ สมุนไพร อื่น ๆ ---- */
    ["thiamine",      "A11DA01", "none",     ["thiamine","ไทอามีน"]],
    ["vitamin b complex","A11EA","none",     ["b-complex","วิตามินบีรวม"]],
    ["cyanocobalamin","B03BA01", "none",     ["cyanocobalamin"]],
    ["mecobalamin",   "B03BA05", "none",     ["methycobal","mecobalamin"]],
    ["potassium chloride","A12BA01","none",  ["kcl","slow-k"]],
    ["ginkgo biloba", "N06DX02", "none",     ["ginkgo","tanakan"]],
    ["melatonin",     "N05CH01", "none",     ["circadin","melatonin"]],
    ["sulfasalazine", "A07EC01", "none",     ["salazopyrin","sulfasalazine"]],
    ["leflunomide",   "L04AA13", "none",     ["arava","leflunomide"]]
  ];


  /* ============================================================
     ข้อมูลประกอบรายตัว — สำหรับครอบครัว เภสัชกร และใบส่งต่อ
     CLS: รหัสกลุ่มการรักษา → [ชื่อกลุ่ม, ใช้รักษา]
     INFO: ตัวยา → [ชื่อไทย, รหัสกลุ่ม, ข้อควรระวัง (ถ้ามี)]
     ข้อควรระวังที่ขึ้นต้นด้วย "Beers 2023:" มาจาก AGS Beers Criteria 2023
     ข้อที่เหลือเป็นอาการข้างเคียงที่เกี่ยวกับการล้มตามข้อมูลยามาตรฐาน
     ห้ามเขียนข้อความเชิงสั่งหยุด/ปรับยาในไฟล์นี้
     ============================================================ */
  var CLS = {
    bzd: ["ยานอนหลับ/คลายกังวล กลุ่มเบนโซไดอะซีปีน", "นอนไม่หลับ วิตกกังวล"],
    zdrug: ["ยานอนหลับ กลุ่ม Z-drug", "นอนไม่หลับ"],
    tca: ["ยาต้านซึมเศร้ากลุ่มไตรไซคลิก", "ซึมเศร้า ปวดปลายประสาท นอนไม่หลับ"],
    ssri: ["ยาต้านซึมเศร้ากลุ่ม SSRI", "ซึมเศร้า วิตกกังวล"],
    adoth: ["ยาต้านซึมเศร้ากลุ่มอื่น", "ซึมเศร้า นอนไม่หลับ"],
    apsy: ["ยาต้านโรคจิต", "โรคจิต ภาวะสับสน พฤติกรรมผิดปกติ"],
    apsy_vert: ["ยาต้านโรคจิตที่ใช้แก้คลื่นไส้/เวียนศีรษะ", "คลื่นไส้ อาเจียน เวียนศีรษะ"],
    aed: ["ยากันชัก", "โรคลมชัก"],
    npain: ["ยากันชักที่ใช้แก้ปวดปลายประสาท", "ปวดปลายประสาท ชาปลายมือปลายเท้า"],
    opi: ["ยาแก้ปวดกลุ่มโอปิออยด์", "ปวดปานกลางถึงรุนแรง"],
    opicough: ["ยาแก้ไอกลุ่มโอปิออยด์", "ไอแห้ง"],
    opidep: ["ยารักษาการติดสารกลุ่มโอปิออยด์", "บำบัดการติดยา"],
    achpd: ["ยาต้านโคลิเนอร์จิกสำหรับอาการสั่น", "พาร์กินสัน อาการข้างเคียงจากยาต้านโรคจิต"],
    spas: ["ยาแก้ปวดเกร็งท้อง ฤทธิ์ต้านโคลิเนอร์จิก", "ปวดเกร็งท้อง ลำไส้บีบตัว"],
    oab: ["ยารักษากระเพาะปัสสาวะไวเกิน", "ปัสสาวะบ่อย ปวดปัสสาวะรีบด่วน กลั้นไม่อยู่"],
    ah1: ["ยาแก้แพ้รุ่นแรก (ทำให้ง่วง)", "แพ้อากาศ น้ำมูก ผื่นคัน"],
    ah2: ["ยาแก้แพ้รุ่นใหม่ (ง่วงน้อย)", "แพ้อากาศ ผื่นคัน ลมพิษ"],
    vert: ["ยาแก้เวียนศีรษะ/บ้านหมุน", "เวียนศีรษะ บ้านหมุน เมารถ"],
    cough_s: ["ยากดอาการไอ", "ไอแห้ง"],
    relax: ["ยาคลายกล้ามเนื้อ", "ปวดตึงกล้ามเนื้อ กล้ามเนื้อเกร็ง"],
    ccb: ["ยาลดความดันกลุ่มยับยั้งแคลเซียม", "ความดันโลหิตสูง เจ็บหน้าอก"],
    ccb_hr: ["ยากลุ่มยับยั้งแคลเซียมที่ลดอัตราการเต้นหัวใจ", "ความดันสูง หัวใจเต้นเร็ว เจ็บหน้าอก"],
    acei: ["ยาลดความดันกลุ่ม ACE inhibitor", "ความดันโลหิตสูง หัวใจล้มเหลว ป้องกันไตเสื่อมจากเบาหวาน"],
    arb: ["ยาลดความดันกลุ่ม ARB", "ความดันโลหิตสูง หัวใจล้มเหลว ป้องกันไตเสื่อมจากเบาหวาน"],
    arni: ["ยารักษาหัวใจล้มเหลวกลุ่ม ARNI", "หัวใจล้มเหลว"],
    bb: ["ยากลุ่มเบต้าบล็อกเกอร์", "ความดันโลหิตสูง หัวใจเต้นเร็ว หัวใจล้มเหลว"],
    central: ["ยาลดความดันออกฤทธิ์ที่สมอง", "ความดันโลหิตสูง"],
    vasod: ["ยาขยายหลอดเลือดโดยตรง", "ความดันโลหิตสูง"],
    nitrate: ["ยาขยายหลอดเลือดหัวใจกลุ่มไนเตรต", "เจ็บหน้าอกจากหัวใจขาดเลือด"],
    loop: ["ยาขับปัสสาวะกลุ่มลูป", "บวมน้ำ หัวใจล้มเหลว"],
    thz: ["ยาขับปัสสาวะกลุ่มไทอะไซด์", "ความดันโลหิตสูง บวมน้ำ"],
    ksp: ["ยาขับปัสสาวะชนิดเก็บโพแทสเซียม", "หัวใจล้มเหลว ความดันสูง บวมน้ำ"],
    combod: ["ยาลดความดันสูตรผสมยาขับปัสสาวะ", "ความดันโลหิตสูง"],
    comboh: ["ยาลดความดันสูตรผสม", "ความดันโลหิตสูง"],
    ahtn: ["ยาแอลฟาบล็อกเกอร์", "ความดันโลหิตสูง ต่อมลูกหมากโต"],
    abph: ["ยาแอลฟาบล็อกเกอร์สำหรับต่อมลูกหมาก", "ปัสสาวะลำบากจากต่อมลูกหมากโต"],
    met: ["ยาเบาหวานกลุ่มไบกัวไนด์", "เบาหวานชนิดที่ 2"],
    su: ["ยาเบาหวานกลุ่มซัลโฟนิลยูเรีย", "เบาหวานชนิดที่ 2"],
    dmo: ["ยาเบาหวานชนิดรับประทานกลุ่มอื่น", "เบาหวานชนิดที่ 2"],
    sglt2: ["ยาเบาหวานกลุ่ม SGLT2 inhibitor", "เบาหวานชนิดที่ 2 หัวใจล้มเหลว ไตเสื่อม"],
    glp1: ["ยาเบาหวานชนิดฉีดกลุ่ม GLP-1", "เบาหวานชนิดที่ 2 ลดน้ำหนัก"],
    ins: ["อินซูลิน", "เบาหวาน"],
    lipid: ["ยาลดไขมันในเลือด", "ไขมันในเลือดสูง ป้องกันโรคหัวใจและหลอดเลือดสมอง"],
    aplt: ["ยาต้านเกล็ดเลือด", "ป้องกันหลอดเลือดหัวใจและสมองอุดตัน"],
    acoag: ["ยาต้านการแข็งตัวของเลือด", "หัวใจเต้นผิดจังหวะ ลิ่มเลือดอุดตัน"],
    cardio: ["ยาโรคหัวใจ", "หัวใจเต้นผิดจังหวะ หัวใจล้มเหลว เจ็บหน้าอก"],
    analg: ["ยาแก้ปวดลดไข้", "ปวด ไข้"],
    nsaid: ["ยาแก้ปวดต้านการอักเสบ (NSAIDs)", "ปวดข้อ ปวดกล้ามเนื้อ อักเสบ"],
    joint: ["ยาบำรุงข้อ", "ข้อเข่าเสื่อม"],
    gout: ["ยารักษาโรคเก๊าท์", "เก๊าท์ กรดยูริกสูง"],
    ppi: ["ยาลดกรดกลุ่ม PPI", "กรดไหลย้อน แผลในกระเพาะ"],
    h2: ["ยาลดกรดกลุ่ม H2 blocker", "กรดไหลย้อน แผลในกระเพาะ"],
    antac: ["ยาลดกรด/เคลือบกระเพาะ", "แสบท้อง อาหารไม่ย่อย"],
    gi: ["ยาระบบทางเดินอาหาร", "ท้องอืด คลื่นไส้ อาหารไม่ย่อย"],
    emet: ["ยาแก้คลื่นไส้อาเจียน", "คลื่นไส้ อาเจียน"],
    lax: ["ยาระบาย", "ท้องผูก"],
    diar: ["ยาแก้ท้องเสีย", "ท้องเสีย"],
    resp: ["ยาขยายหลอดลม/ยาสูดพ่น", "หอบหืด ถุงลมโป่งพอง"],
    muco: ["ยาละลายเสมหะ/ขับเสมหะ", "ไอมีเสมหะ"],
    nasal: ["ยาลดน้ำมูก/ยาพ่นจมูก", "คัดจมูก ภูมิแพ้จมูก"],
    thy: ["ยาไทรอยด์", "ไทรอยด์ทำงานผิดปกติ"],
    ster: ["ยาสเตียรอยด์", "การอักเสบ ภูมิแพ้ โรคภูมิคุ้มกัน"],
    bone: ["ยารักษาโรคกระดูกพรุน", "กระดูกพรุน ป้องกันกระดูกหัก"],
    vit: ["วิตามินและแร่ธาตุ", "เสริมวิตามิน แร่ธาตุ โลหิตจาง"],
    dem: ["ยารักษาภาวะสมองเสื่อม", "อัลไซเมอร์ สมองเสื่อม"],
    pd: ["ยารักษาโรคพาร์กินสัน", "พาร์กินสัน"],
    bph5: ["ยารักษาต่อมลูกหมากโตกลุ่ม 5-alpha reductase", "ต่อมลูกหมากโต"],
    pde5: ["ยากลุ่ม PDE5 inhibitor", "หย่อนสมรรถภาพทางเพศ ต่อมลูกหมากโต"],
    oab3: ["ยารักษากระเพาะปัสสาวะไวเกินกลุ่ม beta-3", "ปัสสาวะบ่อย ปวดปัสสาวะรีบด่วน"],
    eye: ["ยาหยอดตา", "ต้อหิน ตาแห้ง"],
    abx: ["ยาปฏิชีวนะ", "การติดเชื้อแบคทีเรีย"],
    avir: ["ยาต้านไวรัส", "งูสวัด เริม ไข้หวัดใหญ่"],
    afun: ["ยาต้านเชื้อรา", "การติดเชื้อรา"],
    dmard: ["ยารักษาข้ออักเสบรูมาตอยด์/โรคภูมิคุ้มกัน", "ข้ออักเสบรูมาตอยด์ โรคภูมิคุ้มกัน"],
    herb: ["สมุนไพร/อาหารเสริม", "เสริมสุขภาพ"],
    sleepo: ["ยาช่วยนอนกลุ่มอื่น", "นอนไม่หลับ"],
    elec: ["เกลือแร่", "โพแทสเซียมต่ำ"]
  };
  var N_BZD = "Beers 2023: ควรหลีกเลี่ยงในผู้สูงอายุ — เพิ่มความเสี่ยงสับสน หกล้ม และกระดูกหัก";
  var N_ACH = "Beers 2023: ฤทธิ์ต้านโคลิเนอร์จิกสูง ควรหลีกเลี่ยง — ง่วง สับสน ตาพร่ามัว";
  var N_SSRI = "อาจทำให้โซเดียมในเลือดต่ำ เวียนศีรษะ และเพิ่มความเสี่ยงหกล้ม";
  var N_APSY = "Beers 2023: หลีกเลี่ยงในผู้มีภาวะสมองเสื่อมเว้นแต่จำเป็น — ง่วง ความดันตกเมื่อลุก";
  var N_OPI = "ง่วง เวียนศีรษะ สับสน ท้องผูก";
  var N_AED = "เวียนศีรษะ ง่วง เดินเซ";
  var N_REL = "Beers 2023: ควรหลีกเลี่ยง — ง่วงและฤทธิ์ต้านโคลิเนอร์จิก";
  var N_ORTHO = "อาจทำให้หน้ามืดเมื่อลุกยืน โดยเฉพาะช่วงเริ่มยาหรือปรับขนาด";
  var N_DIUR = "ปัสสาวะบ่อยรวมถึงกลางคืน ความดันตก เกลือแร่ผิดปกติ";
  var N_ALPHA = "Beers 2023: หลีกเลี่ยงการใช้เป็นยาลดความดัน — ความดันตกเมื่อลุกยืน";
  var N_HYPO = "ระวังน้ำตาลในเลือดต่ำ ซึ่งทำให้หน้ามืด สับสน และล้มได้";
  var N_SU = "Beers 2023: ระวังน้ำตาลในเลือดต่ำ — ไม่ควรใช้เป็นยาลำดับแรก";
  var N_BLEED = "ถ้าหกล้ม เลือดออกง่ายและรุนแรงกว่าปกติ โดยเฉพาะศีรษะกระแทก ควรพบแพทย์ทันที";
  var N_NSAID = "Beers 2023: หลีกเลี่ยงการใช้ต่อเนื่อง — เลือดออกในกระเพาะ ไตเสื่อม ความดันสูง";
  var N_PPI = "Beers 2023: หลีกเลี่ยงการใช้เกิน 8 สัปดาห์โดยไม่มีข้อบ่งชี้ — สัมพันธ์กับกระดูกหัก";
  var N_DA = "อาจทำให้ความดันตกเมื่อลุกยืน ง่วง หรือหลับกะทันหัน";
  var N_CHEI = "Beers 2023: หลีกเลี่ยงในผู้ที่เคยเป็นลมหมดสติ — อาจทำให้หัวใจเต้นช้า";
  var N_FQ = "อาจทำให้เวียนศีรษะ สับสน และเอ็นอักเสบ";
  var INFO = {
    "diazepam": ["ไดอะซีแพม", "bzd", N_BZD], "lorazepam": ["ลอราซีแพม", "bzd", N_BZD], "alprazolam": ["อัลปราโซแลม", "bzd", N_BZD],
    "clonazepam": ["โคลนาซีแพม", "bzd", N_BZD], "clorazepate": ["คลอราซีเพต", "bzd", N_BZD], "chlordiazepoxide": ["คลอร์ไดอะซีพอกไซด์", "bzd", N_BZD],
    "midazolam": ["มิดาโซแลม", "bzd", N_BZD], "zolpidem": ["โซลพิเดม", "zdrug", N_BZD], "zopiclone": ["โซพิโคลน", "zdrug", N_BZD],
    "temazepam": ["เทมาซีแพม", "bzd", N_BZD], "flurazepam": ["ฟลูราซีแพม", "bzd", N_BZD], "bromazepam": ["โบรมาซีแพม", "bzd", N_BZD],
    "clobazam": ["โคลบาแซม", "bzd", N_BZD], "oxazepam": ["ออกซาซีแพม", "bzd", N_BZD], "estazolam": ["เอสตาโซแลม", "bzd", N_BZD],
    "triazolam": ["ไตรอะโซแลม", "bzd", N_BZD], "nitrazepam": ["ไนตราซีแพม", "bzd", N_BZD], "eszopiclone": ["เอสโซพิโคลน", "zdrug", N_BZD],
    "amitriptyline": ["อะมิทริปไทลีน", "tca", N_ACH], "nortriptyline": ["นอร์ทริปไทลีน", "tca", N_ACH], "imipramine": ["อิมิพรามีน", "tca", N_ACH],
    "clomipramine": ["คลอมิพรามีน", "tca", N_ACH], "doxepin": ["ด็อกเซปิน", "tca", "Beers 2023: หลีกเลี่ยงขนาดเกิน 6 มก./วัน — ฤทธิ์ต้านโคลิเนอร์จิก"],
    "dosulepin": ["โดซูเลปิน", "tca", N_ACH],
    "fluoxetine": ["ฟลูออกซิทีน", "ssri", N_SSRI], "sertraline": ["เซอร์ทราลีน", "ssri", N_SSRI], "escitalopram": ["เอสซิตาโลแพรม", "ssri", N_SSRI],
    "citalopram": ["ซิตาโลแพรม", "ssri", N_SSRI], "paroxetine": ["พาร็อกซิทีน", "ssri", N_ACH], "fluvoxamine": ["ฟลูวอกซามีน", "ssri", N_SSRI],
    "venlafaxine": ["เวนลาฟาซีน", "adoth", N_SSRI], "desvenlafaxine": ["เดสเวนลาฟาซีน", "adoth", N_SSRI], "duloxetine": ["ดูล็อกซิทีน", "adoth", N_SSRI],
    "mirtazapine": ["เมอร์ทาซาปีน", "adoth", "ง่วงมาก โดยเฉพาะช่วงแรก"], "trazodone": ["ทราโซโดน", "adoth", "ง่วง ความดันตกเมื่อลุกยืน"],
    "bupropion": ["บูโพรพิออน", "adoth", "อาจทำให้ชักในผู้ที่มีความเสี่ยง"], "vortioxetine": ["วอร์ทิออกซิทีน", "adoth", N_SSRI],
    "agomelatine": ["อะโกเมลาทีน", "adoth", "ต้องตรวจการทำงานของตับเป็นระยะ"], "mianserin": ["ไมแอนเซอริน", "adoth", "ง่วง"],
    "tianeptine": ["เทียเนปทีน", "adoth", "เวียนศีรษะ ง่วง"], "moclobemide": ["โมโคลบีไมด์", "adoth", "ระวังยาตีกันหลายชนิด"],
    "haloperidol": ["ฮาโลเพอริดอล", "apsy", N_APSY], "chlorpromazine": ["คลอร์โพรมาซีน", "apsy", N_APSY], "perphenazine": ["เพอร์เฟนาซีน", "apsy", N_APSY],
    "risperidone": ["ริสเพอริโดน", "apsy", N_APSY], "quetiapine": ["เควไทอะปีน", "apsy", N_APSY], "olanzapine": ["โอแลนซาปีน", "apsy", N_APSY],
    "aripiprazole": ["อาริพิปราโซล", "apsy", N_APSY], "clozapine": ["โคลซาปีน", "apsy", N_APSY], "sulpiride": ["ซัลพิไรด์", "apsy", N_APSY],
    "fluphenazine": ["ฟลูเฟนาซีน", "apsy", N_APSY], "trifluoperazine": ["ไตรฟลูโอเพอราซีน", "apsy", N_APSY],
    "prochlorperazine": ["โพรคลอร์เพอราซีน", "apsy_vert", "ง่วง อาจทำให้อาการคล้ายพาร์กินสันเมื่อใช้นาน"],
    "thioridazine": ["ไทโอริดาซีน", "apsy", N_APSY], "ziprasidone": ["ซิปราซิโดน", "apsy", N_APSY], "lurasidone": ["ลูราซิโดน", "apsy", N_APSY],
    "paliperidone": ["พาลิเพอริโดน", "apsy", N_APSY], "amisulpride": ["อะมิซัลไพรด์", "apsy", N_APSY],
    "gabapentin": ["กาบาเพนติน", "npain", N_AED], "pregabalin": ["พรีกาบาลิน", "npain", N_AED], "phenytoin": ["ฟีนิโทอิน", "aed", N_AED],
    "carbamazepine": ["คาร์บามาเซปีน", "aed", N_AED + " โซเดียมต่ำ"], "valproate": ["วาลโพรเอต", "aed", N_AED + " มือสั่น"],
    "levetiracetam": ["ลีวีไทราซีแทม", "aed", "ง่วง อารมณ์เปลี่ยน"], "topiramate": ["โทพิราเมต", "aed", "มึนงง สับสน"],
    "lamotrigine": ["ลาโมไตรจีน", "aed", "เวียนศีรษะ ตาพร่ามัว"], "phenobarbital": ["ฟีโนบาร์บิทาล", "aed", "ง่วงมาก " + N_AED],
    "oxcarbazepine": ["ออกซ์คาร์บาเซปีน", "aed", N_AED + " โซเดียมต่ำ"], "lacosamide": ["ลาโคซาไมด์", "aed", N_AED],
    "zonisamide": ["โซนิซาไมด์", "aed", N_AED], "primidone": ["พริมิโดน", "aed", "ง่วงมาก " + N_AED],
    "tramadol": ["ทรามาดอล", "opi", N_OPI + " อาจทำให้ชักและโซเดียมต่ำ"], "codeine": ["โคเดอีน", "opicough", N_OPI],
    "morphine": ["มอร์ฟีน", "opi", N_OPI], "fentanyl": ["เฟนทานิล", "opi", N_OPI], "oxycodone": ["ออกซีโคโดน", "opi", N_OPI],
    "methadone": ["เมทาโดน", "opidep", N_OPI], "pethidine": ["เพทิดีน", "opi", "Beers 2023: ควรหลีกเลี่ยง — สับสน ชัก"],
    "tapentadol": ["ทาเพนทาดอล", "opi", N_OPI], "buprenorphine": ["บูพรีนอร์ฟีน", "opi", N_OPI], "hydromorphone": ["ไฮโดรมอร์โฟน", "opi", N_OPI],
    "tramadol paracetamol": ["ทรามาดอลผสมพาราเซตามอล", "opi", N_OPI], "codeine paracetamol": ["โคเดอีนผสมพาราเซตามอล", "opi", N_OPI],
    "oxybutynin": ["ออกซีบิวทีนิน", "oab", N_ACH], "tolterodine": ["โทลเทอโรดีน", "oab", N_ACH], "solifenacin": ["โซลิเฟนาซิน", "oab", N_ACH],
    "trospium": ["ทรอสเปียม", "oab", N_ACH], "darifenacin": ["ดาริเฟนาซิน", "oab", N_ACH], "fesoterodine": ["ฟีโซเทอโรดีน", "oab", N_ACH],
    "propiverine": ["โพรพิเวอรีน", "oab", N_ACH], "flavoxate": ["ฟลาโวเซต", "oab", N_ACH],
    "mirabegron": ["มิราเบกรอน", "oab3", "ไม่มีฤทธิ์ต้านโคลิเนอร์จิก อาจทำให้ความดันสูงขึ้น"],
    "trihexyphenidyl": ["ไตรเฮกซีเฟนิดิล", "achpd", N_ACH], "benztropine": ["เบนซ์โทรปีน", "achpd", N_ACH], "biperiden": ["ไบเพอริเดน", "achpd", N_ACH],
    "hyoscine": ["ไฮออสซีน บิวทิลโบรไมด์", "spas", N_ACH], "dicyclomine": ["ไดไซโคลมีน", "spas", N_ACH], "atropine": ["อะโทรปีน", "spas", N_ACH],
    "chlorpheniramine": ["คลอร์เฟนิรามีน", "ah1", N_ACH], "diphenhydramine": ["ไดเฟนไฮดรามีน", "ah1", N_ACH], "hydroxyzine": ["ไฮดรอกซีซีน", "ah1", N_ACH],
    "hydroxyzine hcl": ["ไฮดรอกซีซีน ไฮโดรคลอไรด์", "ah1", N_ACH], "dimenhydrinate": ["ไดเมนไฮดริเนต", "vert", N_ACH],
    "brompheniramine": ["บรอมเฟนิรามีน", "ah1", N_ACH], "cyproheptadine": ["ไซโปรเฮปตาดีน", "ah1", N_ACH], "promethazine": ["โพรเมทาซีน", "ah1", N_ACH],
    "dexchlorpheniramine": ["เด็กซ์คลอร์เฟนิรามีน", "ah1", N_ACH], "doxylamine": ["ด็อกซิลามีน", "ah1", N_ACH], "meclizine": ["เมคลิซีน", "vert", N_ACH],
    "triprolidine": ["ไตรโพรลิดีน", "ah1", N_ACH],
    "loratadine": ["ลอราทาดีน", "ah2", null], "cetirizine": ["เซทิริซีน", "ah2", "อาจง่วงเล็กน้อยในบางคน"], "fexofenadine": ["เฟกโซเฟนาดีน", "ah2", null],
    "levocetirizine": ["ลีโวเซทิริซีน", "ah2", "อาจง่วงเล็กน้อยในบางคน"], "desloratadine": ["เดสลอราทาดีน", "ah2", null], "bilastine": ["บิลาสทีน", "ah2", null],
    "cinnarizine": ["ซินนาริซีน", "vert", "ง่วง อาจทำให้อาการคล้ายพาร์กินสันเมื่อใช้นาน"], "flunarizine": ["ฟลูนาริซีน", "vert", "ง่วง อาจทำให้อาการคล้ายพาร์กินสันและซึมเศร้าเมื่อใช้นาน"],
    "betahistine": ["เบตาฮีสทีน", "vert", null], "dextromethorphan": ["เด็กซ์โทรเมทอร์แฟน", "cough_s", "ง่วง เวียนศีรษะ"],
    "orphenadrine": ["ออร์เฟเนดรีน", "relax", N_REL], "tolperisone": ["โทลเพอริโซน", "relax", "อาจเวียนศีรษะ ง่วง"], "baclofen": ["แบคโลเฟน", "relax", "ง่วง อ่อนแรง สับสน"],
    "tizanidine": ["ทิซานิดีน", "relax", "ง่วง ความดันตก"], "eperisone": ["อีเพอริโซน", "relax", "อาจเวียนศีรษะ ง่วง"], "cyclobenzaprine": ["ไซโคลเบนซาพรีน", "relax", N_REL],
    "methocarbamol": ["เมโธคาร์บามอล", "relax", N_REL], "carisoprodol": ["คาริโซโพรดอล", "relax", N_REL], "chlorzoxazone": ["คลอร์ซอกซาโซน", "relax", N_REL],
    "amlodipine": ["แอมโลดิพีน", "ccb", "ข้อเท้าบวม " + N_ORTHO], "nifedipine": ["นิเฟดิพีน", "ccb", "Beers 2023: หลีกเลี่ยงชนิดออกฤทธิ์เร็ว — ความดันตก"],
    "felodipine": ["เฟโลดิพีน", "ccb", N_ORTHO], "lercanidipine": ["เลอคานิดิพีน", "ccb", N_ORTHO], "nicardipine": ["นิคาร์ดิพีน", "ccb", N_ORTHO],
    "manidipine": ["มานิดิพีน", "ccb", N_ORTHO], "diltiazem": ["ดิลไทอะเซม", "ccb_hr", "หัวใจเต้นช้า " + N_ORTHO], "verapamil": ["เวอราพามิล", "ccb_hr", "หัวใจเต้นช้า ท้องผูก"],
    "enalapril": ["อีนาลาพริล", "acei", "ไอแห้ง " + N_ORTHO], "lisinopril": ["ลิซิโนพริล", "acei", "ไอแห้ง " + N_ORTHO], "captopril": ["แคปโตพริล", "acei", N_ORTHO],
    "ramipril": ["รามิพริล", "acei", N_ORTHO], "perindopril": ["เพอรินโดพริล", "acei", N_ORTHO],
    "losartan": ["โลซาร์แทน", "arb", N_ORTHO], "valsartan": ["วาลซาร์แทน", "arb", N_ORTHO], "irbesartan": ["เออร์เบซาร์แทน", "arb", N_ORTHO],
    "candesartan": ["แคนดีซาร์แทน", "arb", N_ORTHO], "telmisartan": ["เทลมิซาร์แทน", "arb", N_ORTHO], "olmesartan": ["โอลมีซาร์แทน", "arb", N_ORTHO],
    "sacubitril valsartan": ["ซาคูบิทริลผสมวาลซาร์แทน", "arni", N_ORTHO], "amlodipine valsartan": ["แอมโลดิพีนผสมวาลซาร์แทน", "comboh", N_ORTHO],
    "atenolol": ["อะทีโนลอล", "bb", "หัวใจเต้นช้า เหนื่อยง่าย"], "metoprolol": ["เมโทโพรลอล", "bb", "หัวใจเต้นช้า เหนื่อยง่าย"],
    "propranolol": ["โพรพราโนลอล", "bb", "หัวใจเต้นช้า เหนื่อยง่าย"], "carvedilol": ["คาร์วีไดลอล", "bb", "หัวใจเต้นช้า " + N_ORTHO],
    "bisoprolol": ["บิโซโพรลอล", "bb", "หัวใจเต้นช้า เหนื่อยง่าย"], "nebivolol": ["เนบิโวลอล", "bb", "หัวใจเต้นช้า เหนื่อยง่าย"], "labetalol": ["ลาเบทาลอล", "bb", N_ORTHO],
    "clonidine": ["โคลนิดีน", "central", "Beers 2023: หลีกเลี่ยงการใช้เป็นยาลดความดันลำดับแรก — ง่วง หัวใจเต้นช้า ความดันตก"],
    "methyldopa": ["เมทิลโดปา", "central", "Beers 2023: หลีกเลี่ยงการใช้เป็นยาลดความดันลำดับแรก — ง่วง ความดันตก"],
    "moxonidine": ["ม็อกโซนิดีน", "central", "ง่วง ความดันตก"], "hydralazine": ["ไฮดราลาซีน", "vasod", N_ORTHO], "minoxidil": ["ไมน็อกซิดิล", "vasod", "บวมน้ำ " + N_ORTHO],
    "isosorbide": ["ไอโซซอร์ไบด์ (ไดไนเตรต/โมโนไนเตรต)", "nitrate", "ปวดศีรษะ " + N_ORTHO],
    "nitroglycerin": ["ไนโตรกลีเซอรีน", "nitrate", "หน้ามืดได้ ควรนั่งก่อนใช้ยาอมใต้ลิ้น"],
    "furosemide": ["ฟูโรซีไมด์", "loop", N_DIUR], "torsemide": ["ทอร์ซีไมด์", "loop", N_DIUR], "bumetanide": ["บูเมทาไนด์", "loop", N_DIUR],
    "hydrochlorothiazide": ["ไฮโดรคลอโรไทอะไซด์", "thz", N_DIUR], "indapamide": ["อินดาพาไมด์", "thz", N_DIUR], "chlorthalidone": ["คลอร์ทาลิโดน", "thz", N_DIUR],
    "spironolactone": ["สไปโรโนแลคโตน", "ksp", "โพแทสเซียมสูง " + N_DIUR], "amiloride": ["อะมิโลไรด์", "ksp", "โพแทสเซียมสูง " + N_DIUR],
    "eplerenone": ["เอเพลอรีโนน", "ksp", "โพแทสเซียมสูง"],
    "losartan hctz": ["โลซาร์แทนผสมไฮโดรคลอโรไทอะไซด์", "combod", N_DIUR], "valsartan hctz": ["วาลซาร์แทนผสมไฮโดรคลอโรไทอะไซด์", "combod", N_DIUR],
    "telmisartan hctz": ["เทลมิซาร์แทนผสมไฮโดรคลอโรไทอะไซด์", "combod", N_DIUR], "irbesartan hctz": ["เออร์เบซาร์แทนผสมไฮโดรคลอโรไทอะไซด์", "combod", N_DIUR],
    "enalapril hctz": ["อีนาลาพริลผสมไฮโดรคลอโรไทอะไซด์", "combod", N_DIUR], "bisoprolol hctz": ["บิโซโพรลอลผสมไฮโดรคลอโรไทอะไซด์", "combod", N_DIUR],
    "doxazosin": ["ด็อกซาโซซิน", "ahtn", N_ALPHA], "prazosin": ["พราโซซิน", "ahtn", N_ALPHA], "terazosin": ["เทราโซซิน", "ahtn", N_ALPHA],
    "tamsulosin": ["แทมซูโลซิน", "abph", N_ORTHO], "alfuzosin": ["อัลฟูโซซิน", "abph", N_ORTHO], "silodosin": ["ซิโลโดซิน", "abph", N_ORTHO],
    "tamsulosin dutasteride": ["แทมซูโลซินผสมดูทาสเตอไรด์", "abph", N_ORTHO],
    "metformin": ["เมทฟอร์มิน", "met", "ท้องอืด ท้องเสีย ขาดวิตามินบี 12 เมื่อใช้นาน"],
    "glipizide": ["กลิพิไซด์", "su", N_SU], "gliclazide": ["กลิคลาไซด์", "su", N_SU], "glibenclamide": ["ไกลเบนคลาไมด์", "su", "Beers 2023: ควรหลีกเลี่ยง — น้ำตาลต่ำนานและรุนแรง"],
    "glimepiride": ["กลิเมพิไรด์", "su", N_SU],
    "sitagliptin": ["ซิทากลิปติน", "dmo", null], "vildagliptin": ["วิลดากลิปติน", "dmo", null], "linagliptin": ["ลินากลิปติน", "dmo", null],
    "saxagliptin": ["แซกซากลิปติน", "dmo", null], "sitagliptin metformin": ["ซิทากลิปตินผสมเมทฟอร์มิน", "dmo", null],
    "pioglitazone": ["ไพโอกลิตาโซน", "dmo", "บวมน้ำ เพิ่มความเสี่ยงกระดูกหัก"], "acarbose": ["อะคาร์โบส", "dmo", "ท้องอืด"], "repaglinide": ["รีพาไกลไนด์", "dmo", N_HYPO],
    "empagliflozin": ["เอ็มพากลิโฟลซิน", "sglt2", "ปัสสาวะบ่อย อาจขาดน้ำและความดันตก"], "dapagliflozin": ["ดาพากลิโฟลซิน", "sglt2", "ปัสสาวะบ่อย อาจขาดน้ำและความดันตก"],
    "canagliflozin": ["คานากลิโฟลซิน", "sglt2", "ปัสสาวะบ่อย อาจขาดน้ำและความดันตก"],
    "liraglutide": ["ลิรากลูไทด์", "glp1", "คลื่นไส้ เบื่ออาหาร"], "semaglutide": ["เซมากลูไทด์", "glp1", "คลื่นไส้ เบื่ออาหาร"], "dulaglutide": ["ดูลากลูไทด์", "glp1", "คลื่นไส้ เบื่ออาหาร"],
    "insulin": ["อินซูลิน", "ins", N_HYPO],
    "simvastatin": ["ซิมวาสแตติน", "lipid", "ปวดเมื่อยกล้ามเนื้อในบางคน"], "atorvastatin": ["อะทอร์วาสแตติน", "lipid", "ปวดเมื่อยกล้ามเนื้อในบางคน"],
    "rosuvastatin": ["โรซูวาสแตติน", "lipid", "ปวดเมื่อยกล้ามเนื้อในบางคน"], "pravastatin": ["พราวาสแตติน", "lipid", null], "pitavastatin": ["พิทาวาสแตติน", "lipid", null],
    "lovastatin": ["โลวาสแตติน", "lipid", null], "fenofibrate": ["ฟีโนไฟเบรต", "lipid", null], "gemfibrozil": ["เจมไฟโบรซิล", "lipid", "ห้ามใช้ร่วมกับสแตตินบางชนิดโดยไม่ปรึกษา"],
    "ezetimibe": ["อีเซทิไมบ์", "lipid", null], "omega-3": ["โอเมก้า 3 (น้ำมันปลา)", "lipid", "อาจเพิ่มแนวโน้มเลือดออกเมื่อใช้ร่วมกับยาต้านเกล็ดเลือด"],
    "aspirin": ["แอสไพริน", "aplt", "Beers 2023: ไม่แนะนำเพื่อป้องกันโรคในผู้ที่ยังไม่เคยเป็น · " + N_BLEED], "clopidogrel": ["โคลพิโดเกรล", "aplt", N_BLEED],
    "ticagrelor": ["ไทคาเกรลอร์", "aplt", N_BLEED], "prasugrel": ["พราซูเกรล", "aplt", N_BLEED], "cilostazol": ["ซิลอสตาซอล", "aplt", "ใจสั่น ปวดศีรษะ · " + N_BLEED],
    "dipyridamole": ["ไดไพริดาโมล", "aplt", "Beers 2023: หลีกเลี่ยงชนิดออกฤทธิ์สั้น — ความดันตก"],
    "warfarin": ["วาร์ฟาริน", "acoag", N_BLEED], "rivaroxaban": ["ริวาร็อกซาแบน", "acoag", N_BLEED], "apixaban": ["อะพิซาแบน", "acoag", N_BLEED],
    "edoxaban": ["อีด็อกซาแบน", "acoag", N_BLEED], "dabigatran": ["ดาบิกาแทรน", "acoag", N_BLEED], "enoxaparin": ["อีน็อกซาพาริน", "acoag", N_BLEED],
    "digoxin": ["ไดจอกซิน", "cardio", "Beers 2023: หลีกเลี่ยงขนาดเกิน 0.125 มก./วัน — เป็นพิษได้ง่ายเมื่อไตเสื่อม"],
    "amiodarone": ["อะมิโอดาโรน", "cardio", "หัวใจเต้นช้า ไทรอยด์ผิดปกติ"], "ivabradine": ["ไอวาบราดีน", "cardio", "หัวใจเต้นช้า เห็นแสงวูบวาบ"],
    "trimetazidine": ["ไตรเมทาซิดีน", "cardio", "อาจทำให้อาการคล้ายพาร์กินสันและเดินไม่มั่นคง"], "ranolazine": ["ราโนลาซีน", "cardio", "เวียนศีรษะ"],
    "paracetamol": ["พาราเซตามอล", "analg", "ไม่ควรเกิน 4 กรัมต่อวัน"], "mefenamic acid": ["กรดมีเฟนามิก", "nsaid", N_NSAID],
    "ibuprofen": ["ไอบูโพรเฟน", "nsaid", N_NSAID], "diclofenac": ["ไดโคลฟีแนค", "nsaid", N_NSAID], "naproxen": ["นาพรอกเซน", "nsaid", N_NSAID],
    "celecoxib": ["เซเลคอกซิบ", "nsaid", N_NSAID], "etoricoxib": ["อีโทริคอกซิบ", "nsaid", N_NSAID], "meloxicam": ["มีล็อกซิแคม", "nsaid", N_NSAID],
    "piroxicam": ["ไพร็อกซิแคม", "nsaid", N_NSAID], "indomethacin": ["อินโดเมทาซิน", "nsaid", "Beers 2023: ควรหลีกเลี่ยง — ผลต่อระบบประสาทมากกว่า NSAIDs อื่น"],
    "aceclofenac": ["อะซีโคลฟีแนค", "nsaid", N_NSAID], "glucosamine": ["กลูโคซามีน", "joint", null], "diacerein": ["ไดอะเซอเรน", "joint", "ท้องเสีย"],
    "allopurinol": ["อัลโลพูรินอล", "gout", "ผื่นแพ้รุนแรงได้ในบางคน"], "colchicine": ["โคลชิซีน", "gout", "ท้องเสีย"],
    "febuxostat": ["ฟีบูโซสแตท", "gout", null], "probenecid": ["โพรเบเนซิด", "gout", null],
    "omeprazole": ["โอเมพราโซล", "ppi", N_PPI], "esomeprazole": ["เอสโอเมพราโซล", "ppi", N_PPI], "lansoprazole": ["แลนโซพราโซล", "ppi", N_PPI],
    "pantoprazole": ["แพนโทพราโซล", "ppi", N_PPI], "rabeprazole": ["ราบีพราโซล", "ppi", N_PPI], "dexlansoprazole": ["เด็กซ์แลนโซพราโซล", "ppi", N_PPI],
    "ranitidine": ["รานิทิดีน", "h2", "อาจสับสนในผู้สูงอายุที่ไตเสื่อม"], "famotidine": ["ฟาโมทิดีน", "h2", "อาจสับสนในผู้สูงอายุที่ไตเสื่อม"],
    "sucralfate": ["ซูคราลเฟต", "antac", "ท้องผูก"], "aluminium hydroxide": ["อะลูมิเนียมไฮดรอกไซด์", "antac", "ท้องผูก"],
    "magnesium hydroxide": ["แมกนีเซียมไฮดรอกไซด์", "lax", "ท้องเสีย ระวังในไตเสื่อม"], "alginate": ["อัลจิเนต", "antac", null],
    "domperidone": ["ดอมเพอริโดน", "gi", "อาจทำให้หัวใจเต้นผิดจังหวะ"], "simethicone": ["ไซเมทิโคน", "gi", null],
    "metoclopramide": ["เมโทโคลพราไมด์", "emet", "Beers 2023: ควรหลีกเลี่ยง ยกเว้นกระเพาะบีบตัวช้า — อาการคล้ายพาร์กินสัน"],
    "ondansetron": ["ออนแดนซีตรอน", "emet", "ท้องผูก ปวดศีรษะ"], "loperamide": ["โลเพอราไมด์", "diar", "ท้องผูก"],
    "bisacodyl": ["บิซาโคดิล", "lax", "ปวดเกร็งท้อง"], "senna": ["มะขามแขก (เซนนา)", "lax", "ปวดเกร็งท้อง"], "lactulose": ["แลคทูโลส", "lax", "ท้องอืด"],
    "macrogol": ["แมคโครกอล", "lax", null], "docusate": ["โดคูเสต", "lax", null], "psyllium": ["ไซเลียม", "lax", "ดื่มน้ำตามให้เพียงพอ"],
    "montelukast": ["มอนเทลูคาสท์", "resp", "อาจมีผลต่ออารมณ์และการนอนในบางคน"], "procaterol": ["โพรคาเทอรอล", "resp", "ใจสั่น มือสั่น"],
    "salbutamol": ["ซัลบูทามอล", "resp", "ใจสั่น มือสั่น"], "budesonide": ["บูเดโซไนด์", "resp", null], "tiotropium": ["ไทโอโทรเปียม", "resp", "ปากแห้ง"],
    "ipratropium": ["ไอพราโทรเปียม", "resp", "ปากแห้ง"], "salmeterol fluticasone": ["ซัลเมเทอรอลผสมฟลูติคาโซน", "resp", "บ้วนปากหลังพ่น"],
    "budesonide formoterol": ["บูเดโซไนด์ผสมฟอร์โมเทอรอล", "resp", "บ้วนปากหลังพ่น"], "theophylline": ["ธีโอฟิลลีน", "resp", "ใจสั่น คลื่นไส้ ระดับยาเป็นพิษได้ง่าย"],
    "acetylcysteine": ["อะเซทิลซิสเทอีน", "muco", null], "carbocisteine": ["คาร์โบซิสเทอีน", "muco", null], "bromhexine": ["บรอมเฮกซีน", "muco", null],
    "ambroxol": ["แอมบรอกซอล", "muco", null], "guaifenesin": ["ไกวเฟนิซิน", "muco", null], "terpin hydrate": ["เทอร์พินไฮเดรต", "muco", null],
    "fluticasone nasal": ["ฟลูติคาโซนพ่นจมูก", "nasal", null], "mometasone nasal": ["โมเมทาโซนพ่นจมูก", "nasal", null],
    "pseudoephedrine": ["ซูโดอีเฟดรีน", "nasal", "ใจสั่น ความดันสูง นอนไม่หลับ"], "oxymetazoline": ["ออกซีเมตาโซลีน", "nasal", "ไม่ควรใช้ต่อเนื่องเกิน 3 วัน"],
    "levothyroxine": ["ลีโวไทร็อกซีน", "thy", "ขนาดเกินทำให้ใจสั่น กระดูกบาง"], "methimazole": ["เมทิมาโซล", "thy", null], "propylthiouracil": ["โพรพิลไทโอยูราซิล", "thy", null],
    "prednisolone": ["เพรดนิโซโลน", "ster", "ใช้นานทำให้กล้ามเนื้ออ่อนแรง กระดูกพรุน น้ำตาลสูง"], "dexamethasone": ["เดกซาเมทาโซน", "ster", "ใช้นานทำให้กล้ามเนื้ออ่อนแรง กระดูกพรุน"],
    "hydrocortisone": ["ไฮโดรคอร์ติโซน", "ster", null], "methylprednisolone": ["เมทิลเพรดนิโซโลน", "ster", "ใช้นานทำให้กล้ามเนื้ออ่อนแรง กระดูกพรุน"],
    "alendronate": ["อะเลนโดรเนต", "bone", "รับประทานตอนท้องว่าง ดื่มน้ำเต็มแก้ว นั่งหรือยืนตัวตรง 30 นาที"], "risedronate": ["ไรซีโดรเนต", "bone", null],
    "ibandronate": ["ไอแบนโดรเนต", "bone", null], "zoledronic acid": ["กรดโซลิโดรนิก", "bone", null], "denosumab": ["ดีโนซูแมบ", "bone", "ไม่ควรหยุดเองโดยไม่ปรึกษาแพทย์"],
    "calcitriol": ["แคลซิไตรออล", "vit", "ระวังแคลเซียมสูง"], "alfacalcidol": ["อัลฟาแคลซิดอล", "vit", "ระวังแคลเซียมสูง"], "cholecalciferol": ["โคลีแคลซิเฟอรอล (วิตามินดี 3)", "vit", null],
    "ergocalciferol": ["เออร์โกแคลซิเฟอรอล (วิตามินดี 2)", "vit", null], "vitamin d": ["วิตามินดี", "vit", null], "calcium": ["แคลเซียม", "vit", "ท้องผูก"],
    "calcium carbonate": ["แคลเซียมคาร์บอเนต", "vit", "ท้องผูก"], "multivitamin": ["วิตามินรวม", "vit", null], "folic acid": ["กรดโฟลิก", "vit", null],
    "ferrous": ["ธาตุเหล็ก", "vit", "ท้องผูก อุจจาระสีดำ"], "ferrous sulfate": ["เฟอรัสซัลเฟต", "vit", "ท้องผูก อุจจาระสีดำ"], "thiamine": ["ไทอามีน (วิตามินบี 1)", "vit", null],
    "vitamin b complex": ["วิตามินบีรวม", "vit", null], "cyanocobalamin": ["ไซยาโนโคบาลามิน (วิตามินบี 12)", "vit", null], "mecobalamin": ["เมโคบาลามิน", "vit", null],
    "potassium chloride": ["โพแทสเซียมคลอไรด์", "elec", "ระวังโพแทสเซียมสูงในไตเสื่อม"],
    "donepezil": ["โดเนพีซิล", "dem", N_CHEI], "rivastigmine": ["ริวาสติกมีน", "dem", N_CHEI], "galantamine": ["กาแลนตามีน", "dem", N_CHEI],
    "memantine": ["เมแมนทีน", "dem", "เวียนศีรษะ สับสน"],
    "levodopa": ["ลีโวโดปา", "pd", N_DA], "pramipexole": ["แพรมิเพ็กโซล", "pd", N_DA], "ropinirole": ["โรพินิโรล", "pd", N_DA],
    "rasagiline": ["ราซาจิลีน", "pd", N_DA], "selegiline": ["เซเลจิลีน", "pd", N_DA], "amantadine": ["อะแมนทาดีน", "pd", "สับสน ประสาทหลอน " + N_DA],
    "entacapone": ["เอนตาคาโปน", "pd", N_DA],
    "finasteride": ["ฟีนาสเตอไรด์", "bph5", null], "dutasteride": ["ดูทาสเตอไรด์", "bph5", null],
    "sildenafil": ["ซิลเดนาฟิล", "pde5", "ห้ามใช้ร่วมกับยาไนเตรต — ความดันตกรุนแรง"], "tadalafil": ["ทาดาลาฟิล", "pde5", "ห้ามใช้ร่วมกับยาไนเตรต — ความดันตกรุนแรง"],
    "timolol eye": ["ทิโมลอลหยอดตา", "eye", "ยาหยอดตาอาจดูดซึมทำให้หัวใจเต้นช้า"], "latanoprost": ["ลาทาโนพรอสต์", "eye", null],
    "brimonidine": ["บริโมนิดีน", "eye", "อาจทำให้ง่วง"], "artificial tears": ["น้ำตาเทียม", "eye", null],
    "amoxicillin": ["อะม็อกซีซิลลิน", "abx", null], "amoxicillin clavulanate": ["อะม็อกซีซิลลินผสมคลาวูลาเนต", "abx", "ท้องเสีย"],
    "cephalexin": ["เซฟาเลกซิน", "abx", null], "cefuroxime": ["เซฟูร็อกซีม", "abx", null], "ciprofloxacin": ["ไซโปรฟล็อกซาซิน", "abx", N_FQ],
    "levofloxacin": ["ลีโวฟล็อกซาซิน", "abx", N_FQ], "norfloxacin": ["นอร์ฟล็อกซาซิน", "abx", N_FQ], "azithromycin": ["อะซิโทรมัยซิน", "abx", null],
    "clarithromycin": ["คลาริโทรมัยซิน", "abx", "ยาตีกันหลายชนิด"], "doxycycline": ["ด็อกซีไซคลิน", "abx", null], "co-trimoxazole": ["โคไตรม็อกซาโซล", "abx", "โพแทสเซียมสูง ผื่นแพ้"],
    "nitrofurantoin": ["ไนโตรฟูแรนโทอิน", "abx", "Beers 2023: หลีกเลี่ยงเมื่อไตเสื่อมมาก"], "metronidazole": ["เมโทรนิดาโซล", "abx", "ห้ามดื่มแอลกอฮอล์"],
    "acyclovir": ["อะไซโคลเวียร์", "avir", "อาจสับสนเมื่อไตเสื่อม"], "valacyclovir": ["วาลาไซโคลเวียร์", "avir", "อาจสับสนเมื่อไตเสื่อม"],
    "oseltamivir": ["โอเซลทามิเวียร์", "avir", null], "fluconazole": ["ฟลูโคนาโซล", "afun", "ยาตีกันหลายชนิด"],
    "hydroxychloroquine": ["ไฮดรอกซีคลอโรควิน", "dmard", "ตรวจตาเป็นระยะ"], "methotrexate": ["เมโทเทร็กเซต", "dmard", "รับประทานสัปดาห์ละครั้ง ไม่ใช่ทุกวัน"],
    "sulfasalazine": ["ซัลฟาซาลาซีน", "dmard", null], "leflunomide": ["เลฟลูโนไมด์", "dmard", null],
    "ginkgo biloba": ["แปะก๊วย", "herb", "เพิ่มความเสี่ยงเลือดออกเมื่อใช้ร่วมกับยาต้านเกล็ดเลือด"], "melatonin": ["เมลาโทนิน", "sleepo", "อาจง่วงตอนเช้า"]
  };
  /* ข้อมูลรายตัวสำหรับหน้าจอ: ชื่อไทย กลุ่ม ใช้รักษา ข้อควรระวัง */
  function info(inn) {
    var x = INFO[inn], d = BY_INN[inn]; if (!x || !d) return null;
    var c = CLS[x[1]] || ["", ""];
    return { inn: inn, th: x[0], cls: c[0], use: c[1], note: x[2] || null, atc: d.atc, frid: d.frid, lv: FRID[d.frid] ? FRID[d.frid].lv : null };
  }

  /* ---------- ดัชนีค้นหา ---------- */
  var INDEX = [];   /* {key, inn} */
  var BY_INN = {};
  DRUGS.forEach(function (d) {
    var inn = d[0];
    BY_INN[inn] = { inn: inn, atc: d[1], frid: d[2], aliases: d[3] };
    var keys = [inn].concat(d[3] || []);
    if (INFO[inn] && keys.map(norm).indexOf(norm(INFO[inn][0])) < 0) keys.push(INFO[inn][0]);
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

  return { FRID: FRID, DRUGS: DRUGS, BY_INN: BY_INN, MSG: MSG, CLS: CLS, INFO: INFO, info: info,
           norm: norm, matchToken: matchToken, extract: extract,
           classify: classify, summarize: summarize };
})();
if (typeof module !== "undefined") module.exports = CSMeds;
