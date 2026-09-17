/* ============================================================
   CareSignal Backend Adapter
   ------------------------------------------------------------
   ชั้นเชื่อมต่อ Supabase ที่ใช้ร่วมกันทั้ง App / Vision / Web

   หลักการออกแบบ:
   1) ถ้าไม่ได้ตั้งค่า Supabase หรือเชื่อมต่อไม่ได้ → ระบบตกกลับไปใช้
      localStorage อัตโนมัติ เดโมจึงทำงานได้เสมอแม้เน็ตล่มกลางเวที
   2) ไม่มีฟังก์ชันใดในไฟล์นี้ส่งภาพหรือวิดีโอ — ส่งเฉพาะตัวเลข
   3) ทุกการกระทำที่แตะข้อมูลส่วนบุคคลเขียน audit log ฝั่งเซิร์ฟเวอร์

   การตั้งค่า: แก้ CS_CONFIG ด้านล่างด้วยค่าจาก
   Supabase → Project Settings → API
   ============================================================ */

var CS_CONFIG = {
  url:     "https://runhkdaizcxhaohajrsn.supabase.co",
  /* Publishable key (ชื่อเดิม: anon key) — ปลอดภัยที่จะอยู่ในโค้ดฝั่งหน้าเว็บ
     เพราะ Row Level Security เป็นตัวคุมสิทธิ์จริง ไม่ใช่ตัว key
     ห้ามใส่ Secret key (sb_secret_...) ลงในไฟล์นี้เด็ดขาด */
  anonKey: "sb_publishable_E0EBdKWexniC2JbwpGaUXQ_PIzDdYYh",
  /* โดเมนสังเคราะห์สำหรับแปลงเบอร์โทรเป็นตัวระบุภายในระบบ auth
     ไม่มีการส่งอีเมลจริงไปที่โดเมนนี้ เพราะต้องปิด "Confirm email" ใน Supabase
     (Authentication → Sign In / Providers → Email → Confirm email = OFF)
     เมื่อสลับไปใช้ OTP ทาง SMS จริงแล้ว ส่วนนี้จะถูกเลิกใช้ */
  phoneDomain: "caresignal.app"
};

var CSBackend = (function () {
  var sb = null;              /* Supabase client */
  var ready = false;
  var mode = "local";         /* cloud | local */
  var profile = null;

  /* ---------- โหลดไลบรารี Supabase แบบ dynamic (ไม่บล็อกหน้าเว็บ) ---------- */
  async function init() {
    if (!CS_CONFIG.url || !CS_CONFIG.anonKey) { mode = "local"; return false; }
    try {
      var mod = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
      /* แยกช่องเก็บ session ตามบริบทของหน้า:
         "member" = แอปผู้เอาประกัน (Vision / App) · "staff" = แดชบอร์ดเจ้าหน้าที่ (Web)
         ก่อนหน้านี้ทุกหน้าบน origin เดียวกันแชร์คีย์เดียว ทำให้เปิดแอปสมาชิก
         ค้างไว้แล้วล็อกอินเจ้าหน้าที่อีกแท็บ token ทับกัน — หน้าเจ้าหน้าที่
         จึงอ่านโปรไฟล์ได้เป็นคนละบัญชีกับที่เพิ่งล็อกอิน (บทบาทเพี้ยน) */
      var scope = (typeof window !== "undefined" && window.CS_AUTH_SCOPE) || "member";
      sb = mod.createClient(CS_CONFIG.url, CS_CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true,
                storageKey: "cs-auth-" + scope }
      });
      /* เก็บกวาดคีย์รวมรุ่นเก่า กัน session ค้างข้ามบริบท */
      try {
        var ref = CS_CONFIG.url.split("//")[1].split(".")[0];
        localStorage.removeItem("sb-" + ref + "-auth-token");
      } catch (e) {}
      ready = true; mode = "cloud";
      return true;
    } catch (e) {
      console.warn("[CareSignal] เชื่อมต่อฐานข้อมูลกลางไม่ได้ ใช้โหมดในเครื่องแทน", e);
      mode = "local"; return false;
    }
  }

  function isCloud() { return ready && mode === "cloud"; }
  function client()  { return sb; }
  function getMode() { return mode; }

  /* ============================================================
     ยืนยันตัวตน
     ------------------------------------------------------------
     ผู้สูงอายุ: เบอร์โทร + PIN 4 หลัก
       เบอร์โทรถูกแปลงเป็นอีเมลสังเคราะห์ภายใน (ไม่ส่งอีเมลจริง)
       เพื่อให้ใช้ระบบ auth มาตรฐานของ Supabase ได้เต็มรูปแบบ
       สลับเป็น OTP ทาง SMS ได้ทันทีเมื่อสมัครผู้ให้บริการ SMS แล้ว
       โดยไม่ต้องแก้โครงสร้างข้อมูล
     เจ้าหน้าที่: อีเมล + รหัสผ่าน (+ TOTP MFA ผ่าน Supabase)
     ============================================================ */
  function phoneToEmail(phone) {
    var digits = String(phone).replace(/\D/g, "");
    return "u" + digits + "@" + (CS_CONFIG.phoneDomain || "caresignal.app");
  }
  function pinToPassword(phone, pin) {
    /* ผูก PIN กับเบอร์โทร เพื่อไม่ให้ PIN สั้น ๆ ซ้ำกันกลายเป็นรหัสผ่านเดียวกัน */
    return "cs:" + String(phone).replace(/\D/g, "") + ":" + String(pin);
  }

  async function signUpUser(phone, pin, meta) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.auth.signUp({
      email: phoneToEmail(phone),
      password: pinToPassword(phone, pin),
      options: { data: { phone: phone, kind: "user" } }
    });
    if (r.error) throw r.error;
    if (meta) await updateProfile(meta);
    return r.data.user;
  }

  async function signInUser(phone, pin) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.auth.signInWithPassword({
      email: phoneToEmail(phone),
      password: pinToPassword(phone, pin)
    });
    if (r.error) throw r.error;
    await loadProfile();
    return r.data.user;
  }

  /* ============================================================
     การเข้าระบบของเจ้าหน้าที่
     ------------------------------------------------------------
     เจ้าหน้าที่และผู้เชี่ยวชาญไม่มีอีเมลในระบบนี้ ใช้ "ชื่อผู้ใช้" ที่ผู้ดูแล
     ระบบตั้งให้ตอนออกรหัส · Supabase Auth ต้องการอีเมลเป็นกุญแจ เราจึง
     ประกอบอีเมลภายในขึ้นจากชื่อผู้ใช้ โดเมนนี้ไม่มีอยู่จริงและไม่เคยมี
     จดหมายส่งไปถึง — เป็นแค่รูปแบบกุญแจ ไม่ใช่ช่องทางติดต่อ

     ผู้ดูแลระบบยังเข้าด้วยอีเมลจริงได้ตามเดิม ฟังก์ชันจึงดูที่ "@"
     ถ้ามี ถือว่าเป็นอีเมล ถ้าไม่มี ถือว่าเป็นชื่อผู้ใช้
     ============================================================ */
  var STAFF_DOMAIN = "staff.caresignal.local";
  function staffEmail(id) {
    var v = String(id || "").trim();
    return v.indexOf("@") >= 0 ? v.toLowerCase() : v.toLowerCase() + "@" + STAFF_DOMAIN;
  }

  async function signInStaff(idOrEmail, password) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.auth.signInWithPassword({ email: staffEmail(idOrEmail), password: password });
    if (r.error) throw r.error;
    await loadProfile();
    return r.data.user;
  }

  /* เปิดใช้งานบัญชีครั้งแรกด้วยรหัสจากผู้ดูแลระบบ
     การสร้างบัญชีทำที่ Edge Function เพราะต้องใช้สิทธิ์ที่ห้ามอยู่ในหน้าเว็บ
     ฟังก์ชันนั้นตรวจรหัสก่อนสร้างบัญชี จึงไม่มีบัญชีใดเกิดโดยไม่มีรหัส */
  async function activateStaff(username, code) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.functions.invoke("staff-activate",
      { body: { username: username, code: code } });
    /* ฟังก์ชันตอบสถานะ 400 พร้อมเหตุผลที่อ่านได้ — ต้องอ่านจากตัว response
       ไม่ใช่โยน error ทิ้ง มิฉะนั้นผู้ใช้จะเห็นแต่คำว่าล้มเหลว */
    if (r.error) {
      var m = null;
      try { m = (await r.error.context.json()).msg } catch (e) {}
      return { ok: false, msg: m || "เปิดใช้งานไม่สำเร็จ" };
    }
    return r.data || { ok: false, msg: "ไม่ทราบผล" };
  }

  /* ตั้งรหัสผ่านของตัวเอง — ตัวรหัสผ่านไปที่ Supabase Auth โดยตรง
     ฐานข้อมูลของเราเก็บแค่ธงว่าผ่านขั้นตอนนี้แล้ว */
  async function setOwnPassword(pw) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.auth.updateUser({ password: pw });
    if (r.error) throw r.error;
    var c = await sb.rpc("clear_must_set_password");
    if (c.error) throw c.error;
    await loadProfile();
    return true;
  }

  async function forcePasswordReset(uid) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("admin_force_password_reset", { p_uid: uid });
    if (r.error) throw r.error;
    return r.data === true;
  }

  async function signOut() { if (isCloud()) await sb.auth.signOut(); profile = null; }

  async function currentUser() {
    if (!isCloud()) return null;
    var r = await sb.auth.getUser();
    return r.data ? r.data.user : null;
  }

  /* ---------- MFA (TOTP) สำหรับเจ้าหน้าที่ ---------- */
  async function mfaEnroll() {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.auth.mfa.enroll({ factorType: "totp" });
    if (r.error) throw r.error;
    return r.data;   /* มี qr_code (SVG) และ secret ให้แสดงบนหน้าจอ */
  }
  async function mfaVerify(factorId, code) {
    var ch = await sb.auth.mfa.challenge({ factorId: factorId });
    if (ch.error) throw ch.error;
    var r = await sb.auth.mfa.verify({ factorId: factorId, challengeId: ch.data.id, code: code });
    if (r.error) throw r.error;
    return r.data;
  }
  async function mfaFactors() {
    if (!isCloud()) return { totp: [] };
    var r = await sb.auth.mfa.listFactors();
    return r.data || { totp: [] };
  }

  /* ============================================================
     โปรไฟล์
     ============================================================ */
  async function loadProfile() {
    if (!isCloud()) return null;
    var u = await currentUser(); if (!u) return null;
    var r = await sb.from("profiles").select("*").eq("id", u.id).single();
    profile = r.data || null;
    return profile;
  }
  function getProfile() { return profile; }

  async function updateProfile(fields) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("profiles").update(fields).eq("id", u.id).select().single();
    if (r.error) throw r.error;
    profile = r.data;
    return profile;
  }

  /* ============================================================
     ความยินยอม — แยกตามวัตถุประสงค์ ถอนได้ทีละอัน
     ============================================================ */
  async function grantConsent(purpose, version, scope) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("consents").insert({
      user_id: u.id, purpose: purpose, version: version || "PDPA-1.0",
      granted: true, scope: scope || null
    }).select().single();
    if (r.error) throw r.error;
    await audit("consent.grant", u.id, "ยินยอมวัตถุประสงค์: " + purpose, { scope: scope });
    return r.data;
  }

  async function revokeConsent(purpose) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("consents").update({ revoked_at: new Date().toISOString(), granted: false })
      .eq("user_id", u.id).eq("purpose", purpose).is("revoked_at", null);
    if (r.error) throw r.error;
    /* ถอนความยินยอมแชร์ข้อมูล = ปิดการแสดงผลในแดชบอร์ดทันที */
    if (purpose === "share_pool") await updateProfile({ share_pool: false });
    await audit("consent.revoke", u.id, "ถอนความยินยอม: " + purpose);
    return true;
  }

  async function listConsents() {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("consents").select("*").eq("user_id", u.id)
      .order("granted_at", { ascending: false });
    return r.data || [];
  }

  /* ============================================================
     ผลการประเมิน — ส่งเฉพาะตัวเลข ไม่มีภาพ
     ============================================================ */
  async function saveAssessment(a) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var row = {
      user_id: u.id,
      assessed_at: a.at || new Date().toISOString(),
      method: a.method || "manual",
      ftsst_seconds: a.ftsst != null ? a.ftsst : null,
      tug_seconds:   a.tug   != null ? a.tug   : null,
      reps: a.reps != null ? a.reps : null,
      cadence_cv: a.cv != null ? a.cv : null,
      gaps: a.gaps || null,
      score: a.score, score_max: a.max || 12, tier: a.tier,
      parts: a.parts || {},
      falls_source: a.fallsSource || "self_reported",
      meds_source:  a.medsSource  || "self_reported",
      adl_source:   a.adlSource   || "self_reported",
      identity_verified: !!a.verified,
      engine_version: a.engine || "unknown",
      duration_sec: a.durSec != null ? a.durSec : null,
      /* ข้อมูลเชิงลึกของระบบวงจรปิด v2 */
      safety_gate:    a.safetyGate    || null,
      falls_detail:   a.fallsDetail   || null,
      home_detail:    a.homeDetail    || null,
      meds_detail:    a.medsDetail    || null,
      test_quality:   a.testQuality   || null,
      baseline_level: a.baselineLevel || null,
      not_tested:     !!a.notTested,
      /* รายละเอียดที่แบบฟอร์มส่งต่อสหวิชาชีพใช้ (22_referral_forms.sql) */
      detail:         a.detail        || null
    };
    var r = await sb.from("assessments").insert(row).select().single();
    if (r.error) throw r.error;
    await audit("assessment.create", u.id,
      "บันทึกผลประเมิน คะแนน " + a.score + "/" + (a.max || 12) + " วิธี " + row.method);
    return r.data;
  }

  async function listAssessments(limit) {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("assessments").select("*").eq("user_id", u.id)
      .order("assessed_at", { ascending: true }).limit(limit || 100);
    return r.data || [];
  }

  /* ============================================================
     สัญญาณความเสี่ยง + การส่งต่อ
     ============================================================ */
  async function saveRiskSignal(assessmentId, tr) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("risk_signals").insert({
      user_id: u.id, assessment_id: assessmentId,
      level: tr.level, flags: tr.flags || [], signals: tr.signals || [],
      next_days: tr.nextDays,
      engine_version: tr.engine || "unknown"
    }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }

  /* ============================================================
     เคสก่อนการเคลม (pre-claim workflow)
     ------------------------------------------------------------
     เคสไม่ได้เปิดจากฝั่งหน้าจอ — ทริกเกอร์ในฐานข้อมูลเปิดให้เอง
     ทุกครั้งที่บันทึกสัญญาณระดับเหลืองขึ้นไป จึงข้ามไม่ได้
     ฟังก์ชันในนี้มีไว้ "อ่าน" และ "เลื่อนสถานะ" เท่านั้น
     ============================================================ */
  async function myCases(limit) {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("care_cases").select("*")
      .eq("user_id", u.id).order("opened_at", { ascending: false }).limit(limit || 5);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function caseQueue(limit) {
    if (!isCloud()) return [];
    var r = await sb.from("care_cases")
      .select("*, profiles!care_cases_user_id_fkey(pseudonym, display_name, phone, birth_year_be, sex)")
      .not("status", "in", "(stable,closed)")
      .order("opened_at", { ascending: true }).limit(limit || 100);
    if (r.error) { console.warn(r.error); return []; }
    await audit("case.queue", null, "เปิดดูคิวเคส " + (r.data || []).length + " เคส");
    return r.data || [];
  }
  /* เลื่อนสถานะเคส — ทุกครั้งบันทึกว่าใครเป็นคนเลื่อน ลง audit log ที่ลบไม่ได้ */
  async function updateCase(id, status, note) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var patch = { status: status, updated_at: new Date().toISOString(), assigned_to: u.id };
    if (status === "contacted") patch.contacted_at = new Date().toISOString();
    if (status === "stable" || status === "closed") {
      patch.closed_at = new Date().toISOString();
      if (note) patch.close_reason = note;
    }
    if (note) patch.note = note;
    var r = await sb.from("care_cases").update(patch).eq("id", id).select().single();
    if (r.error) throw r.error;
    await audit("case.update", id, "เลื่อนสถานะเคสเป็น " + status + (note ? " · " + note : ""));
    return r.data;
  }
  /* ============================================================
     Care Manager — Action Dashboard
     ------------------------------------------------------------
     คิวงานมาจาก view cm_worklist ซึ่งรวมทุกอย่างที่ต้องใช้ตัดสินใจ
     ไว้ในแถวเดียว (ระดับ · สัญญาณ · กำหนดติดต่อ · เบอร์ · งานค้าง)
     เพื่อไม่ต้องยิงหลายคำสั่งบนมือถือที่สัญญาณไม่ดี
     view นี้เปิดเฉพาะ care_manager/admin — บริษัทประกันอ่านไม่ได้
     ============================================================ */
  /* ---------- งานของฉัน ----------
     view my_work กรองด้วย auth.uid() ในตัวมันเอง ไม่ได้พึ่งการกรองที่หน้าจอ
     ผู้ประสานงานได้เคสที่ตนรับผิดชอบ (หรือยังไม่มีใครรับ)
     วิชาชีพได้เฉพาะรายการส่งต่อที่มาถึงวิชาชีพตน */
  async function myWork() {
    if (!isCloud()) return [];
    var r = await sb.from("my_work").select("*").order("due_at", { ascending: true }).limit(200);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  /* กดรับเคสส่งต่อ — บันทึกว่าใครรับไปทำ ที่ฐานข้อมูล ไม่ใช่แค่ในหน้าจอ */
  async function claimReferral(id) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("claim_referral", { rid: id });
    if (r.error) throw r.error;
    return true;
  }
  /* รายการส่งต่อที่ส่งมาถึงฉัน — RLS จำกัดให้เห็นเฉพาะของวิชาชีพตนอยู่แล้ว */
  async function myReferrals() {
    if (!isCloud()) return [];
    var r = await sb.from("referrals")
      .select("*, profiles!referrals_user_id_fkey(pseudonym, display_name, birth_year_be, sex)")
      .order("created_at", { ascending: false }).limit(200);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }

  /* ---------- จัดการผู้ใช้ (เฉพาะ admin) ----------
     การเปลี่ยนบทบาทถูกล็อกด้วย trigger guard_role_change ที่ฐานข้อมูล
     บัญชีที่ไม่ใช่ admin จะถูกปฏิเสธแม้แก้โค้ดหน้าเว็บ */
  async function listStaff() {
    if (!isCloud()) return [];
    var r = await sb.from("profiles")
      .select("id, role, display_name, pseudonym, created_at")
      .neq("role", "user").order("role", { ascending: true });
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  /* คอลัมน์ role ถูกถอดสิทธิ์ UPDATE ออกจากฝั่งเบราว์เซอร์แล้ว
     ทางเดียวที่เหลือคือฟังก์ชันฝั่งฐานข้อมูล ซึ่งตรวจสิทธิ์ กันไม่ให้เปลี่ยน
     ของตัวเอง กันไม่ให้ผู้ดูแลระบบคนสุดท้ายหายไป และบันทึกทุกครั้ง */
  async function setRole(id, role) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("admin_set_role", { p_uid: id, p_role: role });
    if (r.error) throw r.error;
    return r.data === true;
  }


  /* ============================================================
     เครื่องมือจัดการข้อมูลของผู้ดูแลระบบ
     ------------------------------------------------------------
     การลบทั้งหมดเกิดที่ฐานข้อมูลในฟังก์ชันที่ตรวจสิทธิ์เอง ฝั่งเบราว์เซอร์
     ทำได้แค่ขอให้ลบ · บันทึกตรวจสอบไม่เคยถูกลบไม่ว่าเรียกทางไหน
     ============================================================ */
  async function dataSummary() {
    if (!isCloud()) return [];
    var r = await sb.rpc("admin_data_summary");
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function listAccounts() {
    if (!isCloud()) return [];
    var r = await sb.rpc("admin_list_accounts");
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function purgeMemberData(uid) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("admin_purge_member_data", { p_uid: uid });
    if (r.error) throw r.error;
    return r.data || {};
  }
  async function deleteAccount(uid) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("admin_delete_account", { p_uid: uid });
    if (r.error) throw r.error;
    return r.data || {};
  }
  async function revokeStaff(uid) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("admin_revoke_staff", { p_uid: uid });
    if (r.error) throw r.error;
    return r.data === true;
  }

  /* ============================================================
     รหัสเชิญเจ้าหน้าที่ — ผู้ดูแลระบบออกรหัส แล้วส่งให้เจ้าตัวไปแลก
     ------------------------------------------------------------
     ตัวรหัสจริงมีให้เห็นครั้งเดียวตอนออก ฐานข้อมูลเก็บแต่แฮช
     การตรวจสิทธิ์ทั้งหมดอยู่ที่ฐานข้อมูล ไม่ใช่ที่หน้าเว็บ
     แก้โค้ดฝั่งนี้ก็ยังออกรหัสหรือยกระดับตัวเองไม่ได้
     ============================================================ */
  async function issueInvite(username, role, displayName, note, days) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("issue_staff_invite", {
      p_username: username, p_role: role,
      p_display_name: displayName || null, p_note: note || null,
      p_days: days || 30
    });
    if (r.error) throw r.error;
    /* ฟังก์ชันคืนเป็นตาราง จึงได้อาร์เรย์กลับมา */
    return Array.isArray(r.data) ? r.data[0] : r.data;
  }
  async function listInvites() {
    if (!isCloud()) return [];
    var r = await sb.rpc("list_staff_invites");
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function revokeInvite(id) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("revoke_staff_invite", { p_id: id });
    if (r.error) throw r.error;
    return r.data === true;
  }
  async function redeemStaffInvite(code) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("redeem_staff_invite", { p_code: code });
    if (r.error) throw r.error;
    var out = Array.isArray(r.data) ? r.data[0] : r.data;
    if (out && out.ok) await loadProfile();   /* บทบาทเปลี่ยนแล้ว ต้องโหลดโปรไฟล์ใหม่ */
    return out || { ok: false, msg: "ไม่ทราบผล" };
  }

  /* ============================================================
     ความยินยอมรายครั้ง — รับแนวจากระบบ Health Link
     ------------------------------------------------------------
     ผู้เชี่ยวชาญภายนอกเห็นรายการส่งต่อได้ (ชื่อแฝง งานที่ต้องทำ ระดับ)
     แต่จะเปิดดูรายการยาและผลประเมินย้อนหลังได้ต่อเมื่อผู้เอาประกัน
     กดอนุญาตในแอปของตน และสิทธิ์นั้นหมดอายุเอง
     บังคับด้วย RLS ที่ฐานข้อมูล ไม่ใช่การซ่อนที่หน้าจอ
     ============================================================ */
  /* ---------- หน่วยบริการที่ปฏิบัติงาน ----------
     Health Link ให้เลือกทุกครั้งที่เข้าระบบ เพราะคนหนึ่งอาจทำงานหลายแห่ง
     และระบบต้องตอบได้ว่า "ตอนเปิดดูข้อมูล เขาอยู่ที่ไหน" */
  async function startWorkSession(orgName) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    await sb.from("work_sessions").update({ ended_at: new Date().toISOString() })
      .eq("staff_id", u.id).is("ended_at", null);
    var r = await sb.from("work_sessions").insert({ staff_id: u.id, org_name: orgName })
      .select().single();
    if (r.error) throw r.error;
    await audit("session.start", u.id, "เข้าระบบจากหน่วยบริการ: " + orgName, { org: orgName });
    return r.data;
  }
  async function myOrg() {
    if (!isCloud()) return null;
    var r = await sb.rpc("cs_my_org");
    return r.error ? null : r.data;
  }
  /* หน่วยบริการที่เคยระบุไว้ — ให้เลือกซ้ำได้เร็วโดยไม่ต้องพิมพ์ใหม่ */
  async function myOrgHistory() {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("work_sessions").select("org_name")
      .eq("staff_id", u.id).order("started_at", { ascending: false }).limit(20);
    if (r.error) return [];
    var seen = {}, out = [];
    (r.data || []).forEach(function (x) { if (!seen[x.org_name]) { seen[x.org_name] = 1; out.push(x.org_name) } });
    return out;
  }
  /* ตรวจสถานะสมาชิกก่อนขอความยินยอม — คืนเฉพาะสถานะ ไม่คืนข้อมูลส่วนบุคคล */
  async function checkMembership(memberId) {
    if (!isCloud()) return null;
    var r = await sb.rpc("check_membership", { target: memberId });
    if (r.error) throw r.error;
    return r.data;
  }

  async function requestAccess(memberId, referralId, scope, reason) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("access_requests").insert({
      member_id: memberId, requester_id: u.id, referral_id: referralId || null,
      scope: scope || "clinical", reason: reason || null
    }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }
  /* ตรวจสถานะคำขอล่าสุด — ปุ่ม "ตรวจสอบความยินยอม" ของฝั่งผู้เชี่ยวชาญ */
  async function checkAccess(memberId) {
    if (!isCloud()) return null;
    try { await sb.rpc("expire_access_requests"); } catch (e) {}
    var u = await currentUser(); if (!u) return null;
    var r = await sb.from("access_requests").select("*")
      .eq("member_id", memberId).eq("requester_id", u.id)
      .order("requested_at", { ascending: false }).limit(1);
    if (r.error || !r.data || !r.data.length) return null;
    var a = r.data[0];
    a.live = a.status === "granted" && new Date(a.access_until) > new Date();
    return a;
  }
  /* ฝั่งผู้เอาประกัน: คำขอที่รอการตัดสินของฉัน */
  async function myAccessRequests() {
    if (!isCloud()) return [];
    try { await sb.rpc("expire_access_requests"); } catch (e) {}
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("access_requests")
      .select("*, profiles!access_requests_requester_id_fkey(display_name, role, license_no, license_body, org_name)")
      .eq("member_id", u.id).eq("status", "pending")
      .order("requested_at", { ascending: false });
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function decideAccess(id, approve, hours) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("decide_access", { rid: id, approve: !!approve, hours: hours || 8 });
    if (r.error) throw r.error;
    return true;
  }
  /* ประวัติการเปิดดู — ผู้เอาประกันตรวจย้อนได้ว่าใครขอและได้ดูหรือไม่ */
  async function myAccessLog(limit) {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("access_requests")
      .select("*, profiles!access_requests_requester_id_fkey(display_name, role, org_name)")
      .eq("member_id", u.id).order("requested_at", { ascending: false }).limit(limit || 20);
    return r.data || [];
  }

  async function cmWorklist() {
    if (!isCloud()) return [];
    var r = await sb.from("cm_worklist").select("*").order("priority", { ascending: true }).limit(200);
    if (r.error) { console.warn(r.error); return []; }
    await audit("worklist.view", null, "เปิดคิวงาน " + (r.data || []).length + " เคส");
    return r.data || [];
  }
  /* บันทึกผลการติดต่อ — เลื่อนสถานะเคสให้อัตโนมัติตามผลที่ได้ */
  async function logContact(c, result, note, channel) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("contact_log").insert({
      case_id: c.id, user_id: c.user_id, by_staff: u.id,
      channel: channel || "phone", result: result, note: note || null
    });
    if (r.error) throw r.error;
    var now = new Date().toISOString(), patch = { updated_at: now, assigned_to: u.id };
    if (result === "no_answer") {
      patch.attempts = (c.attempts || 0) + 1;
      if (patch.attempts >= 3) patch.unreachable = true;   /* พยายาม 3 ครั้งแล้วยังไม่ได้ */
    } else {
      patch.attempts = (c.attempts || 0) + 1;
      patch.unreachable = false;
      if (!c.contacted_at) patch.contacted_at = now;
      if (c.status === "new") patch.status = "contacted";
    }
    if (result === "referred_ok") patch.status = "referred";
    if (result === "booked") patch.status = "referred";
    if (result === "refused") { patch.status = "closed"; patch.closed_at = now; patch.close_reason = "ผู้ใช้ปฏิเสธการดูแล"; }
    await sb.from("care_cases").update(patch).eq("id", c.id);
    await audit("contact.log", c.id, "บันทึกการติดต่อ: " + result + (note ? " · " + note : ""));
    return true;
  }
  /* ข้อมูลทั้งหมดของเคสเดียว — ใช้ในหน้ารายละเอียด */
  async function caseDetail(caseId, userId) {
    if (!isCloud()) return null;
    var out = {};
    var q = await Promise.all([
      sb.from("cm_worklist").select("*").eq("id", caseId).limit(1),
      sb.from("assessments").select("assessed_at,score,tier,ftsst_seconds,tug_seconds,parts,falls_detail,meds_detail,safety_gate,not_tested")
        .eq("user_id", userId).order("assessed_at", { ascending: true }).limit(12),
      sb.from("care_events").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
      sb.from("referrals").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(6),
      sb.from("follow_ups").select("*").eq("user_id", userId).order("due_at", { ascending: true }).limit(10),
      sb.from("contact_log").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
      sb.from("care_plans").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1),
      sb.from("medications").select("inn,brand_text,frid_group,frid_level,dose_text").eq("user_id", userId).eq("active", true)
    ]);
    out.c = (q[0].data || [])[0] || null;
    out.assess = q[1].data || []; out.events = q[2].data || []; out.refs = q[3].data || [];
    out.fups = q[4].data || []; out.contacts = q[5].data || []; out.plan = (q[6].data || [])[0] || null;
    out.meds = q[7].data || [];
    await audit("case.open", caseId, "เปิดดูรายละเอียดเคส");
    return out;
  }
  /* สร้างการส่งต่อจากหน้าเคส (Care Manager เป็นผู้ตัดสินใจ) */
  /* ============================================================
     ส่งต่อแบบมีโครงสร้าง — รับแนวจาก MOPH Refer
     ------------------------------------------------------------
     ส่งเป็นชุด: เหตุผล · ข้อมูลประกอบ ณ เวลาส่ง · คำถามที่ต้องการคำตอบ
     ไม่ใช่ส่งแค่คำว่า "แดง" แล้วให้ปลายทางเดาเอง
     ชุดข้อมูลสร้างที่ฐานข้อมูลจากของจริง ไม่ใช่หน้าจอประกอบเอง */
  async function previewPackage(userId) {
    if (!isCloud()) return null;
    var r = await sb.rpc("build_referral_package", { target: userId });
    if (r.error) throw r.error;
    return r.data;
  }
  async function sendReferral(userId, caseId, dest, action, level, reasons, questions, replyHours) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("send_referral", {
      target: userId, cid: caseId || null, dest: dest, action_txt: action,
      lvl: level || "watch", reasons_j: reasons || [], qs: questions || [], reply_hours: replyHours || 48
    });
    if (r.error) throw r.error;
    return r.data;   /* รหัสรายการส่งต่อ */
  }
  /* ส่งผลกลับ — Refer Back: ผู้เชี่ยวชาญเขียนข้อค้นพบ คำแนะนำ และขั้นตอนถัดไป */
  async function returnReview(referralId, finding, recommend, nextStep, note, form) {
    if (!isCloud()) throw new Error("offline");
    /* มี form → ใช้ลายเซ็น 6 พารามิเตอร์ (22_referral_forms.sql) · ไม่มี → ลายเซ็นเดิม */
    var args = { rid: referralId, finding: finding, recommend: recommend || null, next_step: nextStep, note: note || null };
    if (form) args.form = form;
    var r = await sb.rpc("return_review", args);
    if (r.error) throw r.error;
    return true;
  }
  /* ไทม์ไลน์เคส — ดึงจากข้อมูลจริงทุกตาราง เรียงตามเวลา */
  async function caseTimeline(caseId) {
    if (!isCloud()) return [];
    var r = await sb.rpc("case_timeline", { cid: caseId });
    return r.error ? [] : (r.data || []);
  }

  async function createReferralFor(userId, caseId, dest, action, level) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("referrals").insert({
      user_id: userId, case_id: caseId, destination: dest, action: action,
      level: level || "watch", sla: "ตามระดับความเร่งด่วน", reasons: [],
      status: "approved", decided_by: u.id, decided_at: new Date().toISOString()
    }).select().single();
    if (r.error) throw r.error;
    await audit("referral.create", r.data.id, "เปิดการส่งต่อไปยัง " + dest + " · " + action);
    return r.data;
  }
  async function insurerFunnel() {
    if (!isCloud()) return null;
    var r = await sb.from("insurer_funnel").select("*").limit(1);
    return (r.data || [])[0] || null;
  }
  async function insurerStrata() {
    if (!isCloud()) return [];
    var r = await sb.from("insurer_strata").select("*");
    return r.data || [];
  }
  async function insurerSignals() {
    if (!isCloud()) return [];
    var r = await sb.from("insurer_signals").select("*");
    return r.data || [];
  }
  /* แนวโน้มรายเดือน 12 เดือน — view 21_insurer_trend.sql
     ถ้ายังไม่ได้รันไฟล์นั้น view จะไม่มี และ Supabase คืน error
     กรณีนี้คืนอาร์เรย์ว่าง ให้แดชบอร์ดขึ้นสถานะ "ยังไม่มีข้อมูลย้อนหลัง"
     แทนที่จะพังทั้งหน้า */
  async function insurerMonthly() {
    if (!isCloud()) return [];
    var r = await sb.from("insurer_monthly").select("*").order("month", { ascending: true });
    if (r.error) { console.warn("insurer_monthly:", r.error.message); return []; }
    return r.data || [];
  }

  /* ============================================================
     ยา — Medication Classification Pipeline
     ------------------------------------------------------------
     OCR ทำในเครื่อง (Tesseract.js) ไม่มีการส่งภาพไปประมวลผลภายนอก
     รูปซองยาขึ้น storage bucket private (path ขึ้นต้นด้วย user_id
     บังคับด้วย RLS) เพื่อให้เภสัชกรดูตอนทบทวนเท่านั้น
     ============================================================ */
  async function listMeds() {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("medications").select("*")
      .eq("user_id", u.id).eq("active", true).order("created_at", { ascending: false });
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function saveMed(m) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var row = {
      user_id: u.id, inn: m.inn || null, brand_text: m.brand || null,
      dose_text: m.dose || null, freq_text: m.freq || null, atc: m.atc || null,
      frid_group: m.frid || "unknown", frid_level: (m.lv == null ? null : m.lv),
      purpose: m.purpose || null, source: m.source || "manual",
      ocr_text: m.ocr || null, match_conf: (m.conf == null ? null : m.conf),
      photo_path: m.photo || null, confirmed_by: m.by || "user"
    };
    var r = await sb.from("medications").insert(row).select().single();
    if (r.error) throw r.error;
    await audit("med.add", u.id, "บันทึกยา " + (m.inn || m.brand || "ไม่ระบุชื่อ") + " · กลุ่ม " + (m.frid || "unknown") + " · ที่มา " + (m.source || "manual"));
    return r.data;
  }
  async function retireMed(id) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.from("medications").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (r.error) throw r.error;
    await audit("med.retire", null, "ระบุว่าเลิกใช้ยา " + id);
    return true;
  }
  async function uploadMedPhoto(file) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var ext = (file.type === "image/png") ? "png" : (file.type === "image/webp" ? "webp" : "jpg");
    var path = u.id + "/" + Date.now() + "." + ext;
    var r = await sb.storage.from("med-photos").upload(path, file, { contentType: file.type, upsert: false });
    if (r.error) throw r.error;
    await audit("med.photo", u.id, "อัปโหลดรูปซองยาเพื่อให้เภสัชกรดู");
    return path;
  }
  async function medPhotoUrl(path) {
    if (!isCloud() || !path) return null;
    var r = await sb.storage.from("med-photos").createSignedUrl(path, 600);   /* 10 นาที */
    return r.data ? r.data.signedUrl : null;
  }
  /* ---------- ค้นชื่อยาจากทะเบียนตำรับยาของ อย. ----------
     ใช้ต่อจากฐานในเครื่อง 170 ตัวยา เมื่อจับคู่ในเครื่องไม่ได้
     เบราว์เซอร์เรียกเว็บเซอร์วิสของ อย. ตรงไม่ได้ (ไม่มี CORS) จึงผ่าน edge function
     สิ่งที่ส่งออกไปคือ "ชื่อยาที่อ่านได้" อย่างเดียว ไม่มี user id ไม่มีรูป
     ล้มเหลวเมื่อไรให้คืน null แล้วให้ฝั่งเรียกไปทางเภสัชกรแทน ไม่ใช่ให้แอปค้าง */
  async function lookupDrug(name) {
    if (!isCloud() || !name) return null;
    var q = String(name).toLowerCase().trim().replace(/\s+/g, " ");
    if (q.length < 3) return null;
    try {
      var r = await sb.functions.invoke("drug-lookup", { body: { name: q } });
      if (r.error || !r.data || !r.data.found) return null;
      var d = r.data;
      return {
        inn: d.inn || null, atc: d.atc || null, atcKind: d.atc_kind || null,
        frid: d.frid_group || "unknown", lv: (d.frid_level == null ? null : d.frid_level),
        tradeName: d.trade_name || null, regNo: d.reg_no || null,
        drugClass: d.drug_class || null, strength: d.strength || null,
        sourceUrl: d.source_url || null,
        source: d.source || "fda_registry", by: d.classified_by || null
      };
    } catch (e) { return null; }
  }

  /* ยาที่ทั้งฐานในเครื่องและทะเบียน อย. จัดกลุ่มไม่ได้ → เข้าคิวให้เภสัชกร
     แนบรูปฉลากไปด้วย เพราะเภสัชกรต้องเห็นของจริงจึงจะจัดกลุ่มได้ */
  async function queueUnknownDrug(x) {
    if (!isCloud()) return null;
    var u = await currentUser(); if (!u) return null;
    var r = await sb.from("drug_unknown_queue").insert({
      user_id: u.id, medication_id: x.medId || null,
      label_text: (x.ocr || "").slice(0, 800), guess_name: x.name || null,
      photo_path: x.photo || null, registry_hits: x.hits || null
    }).select().single();
    if (r.error) { console.warn(r.error); return null; }
    await audit("drug.queue", u.id, "ส่งยาที่ระบบจัดกลุ่มไม่ได้ให้เภสัชกร · " + (x.name || "ไม่ทราบชื่อ"));
    return r.data;
  }

  /* ---- ฝั่งเภสัชกร: คิวยาที่รอจัดกลุ่ม ---- */
  async function unknownDrugQueue() {
    if (!isCloud()) return [];
    var r = await sb.from("drug_unknown_queue")
      .select("*, profiles!drug_unknown_queue_user_id_fkey(pseudonym, display_name, birth_year_be, sex)")
      .eq("status", "pending").order("created_at", { ascending: true }).limit(100);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function resolveUnknownDrug(id, inn, group, atc, note) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("resolve_unknown_drug", {
      p_queue_id: id, p_inn: inn || null, p_group: group || "unknown",
      p_atc: atc || null, p_note: note || null
    });
    if (r.error) throw r.error;
    return true;
  }

  async function myMedReview() {
    if (!isCloud()) return null;
    var u = await currentUser(); if (!u) return null;
    var r = await sb.from("med_reviews").select("*").eq("user_id", u.id)
      .order("requested_at", { ascending: false }).limit(1);
    return (r.data || [])[0] || null;
  }
  /* ---- ฝั่งเจ้าหน้าที่ ---- */
  async function medReviewQueue() {
    if (!isCloud()) return [];
    var r = await sb.from("med_reviews")
      .select("*, profiles!med_reviews_user_id_fkey(pseudonym, display_name, birth_year_be, sex)")
      .eq("status", "pending").order("requested_at", { ascending: true }).limit(100);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function medsOf(userId) {
    if (!isCloud()) return [];
    var r = await sb.from("medications").select("*").eq("user_id", userId).eq("active", true)
      .order("frid_level", { ascending: false, nullsFirst: true });
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function pharmacistFix(medId, patch) {
    /* เภสัชกรแก้กลุ่ม/ตัวยา — บันทึกว่าใครแก้ */
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var row = { reviewed_at: new Date().toISOString(), reviewed_by: u.id, confirmed_by: "pharmacist",
                updated_at: new Date().toISOString() };
    ["inn", "atc", "frid_group", "frid_level", "review_note", "active"].forEach(function (k) {
      if (patch[k] !== undefined) row[k] = patch[k];
    });
    var r = await sb.from("medications").update(row).eq("id", medId).select().single();
    if (r.error) throw r.error;
    await audit("med.pharmacist_fix", medId, "เภสัชกรยืนยัน/แก้รายการยา → " + (patch.frid_group || "") + " " + (patch.review_note || ""));
    return r.data;
  }
  async function closeMedReview(id, outcome, recommend) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("med_reviews").update({
      status: "done", reviewed_at: new Date().toISOString(), reviewed_by: u.id,
      outcome: outcome || null, recommend: recommend || null
    }).eq("id", id).select().single();
    if (r.error) throw r.error;
    await audit("med.review_done", id, "เภสัชกรปิดการทบทวนยา · " + (recommend || ""));
    return r.data;
  }

  /* เลื่อนสถานะการส่งต่อ จนถึงบันทึกผลลัพธ์ — ตัวชี้วัดว่าไปถึงปลายทางจริง */
  async function updateReferral(id, status, extra) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var now = new Date().toISOString();
    var patch = { status: status };
    if (status === "acknowledged") patch.acknowledged_at = now;
    if (status === "booked") patch.booked_at = now;
    if (status === "completed") { patch.completed_at = now; if (extra && extra.note) patch.completed_note = extra.note; }
    if (status === "outcome_recorded") patch.outcome = (extra && extra.outcome) || { result: "recorded", recorded_at: now };
    if (extra && extra.destination) patch.destination = extra.destination;
    var r = await sb.from("referrals").update(patch).eq("id", id).select().single();
    if (r.error) throw r.error;
    await audit("referral.update", id, "การส่งต่อเปลี่ยนสถานะเป็น " + status);
    return r.data;
  }

  async function createReferral(riskSignalId, tr) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("referrals").insert({
      user_id: u.id, risk_signal_id: riskSignalId,
      destination: (tr.signals && tr.signals[0] && tr.signals[0].dest) || null,
      level: tr.level, action: tr.referral.nm, sla: tr.referral.sla,
      reasons: (tr.flags || []).map(function (f) { return { id: f.id, text: f.text }; }),
      status: "pending"
    }).select().single();
    if (r.error) throw r.error;
    await audit("referral.create", u.id, "สร้างเคสส่งต่อ: " + tr.referral.nm + " " + tr.referral.sla);
    return r.data;
  }

  /* คิวเคสสำหรับเจ้าหน้าที่ — RLS จะคืนค่าว่างถ้าไม่ใช่ care_manager/admin */
  async function listReferralQueue(status) {
    if (!isCloud()) return [];
    var q = sb.from("referrals")
      .select("*, profiles!referrals_user_id_fkey(pseudonym, display_name, birth_year_be, sex)")
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    var r = await q;
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }

  async function decideReferral(id, approved, note) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("referrals").update({
      status: approved ? "approved" : "declined",
      decided_by: u.id, decided_at: new Date().toISOString(), decision_note: note || null
    }).eq("id", id).select().single();
    if (r.error) throw r.error;
    await audit(approved ? "referral.approve" : "referral.decline", r.data.user_id,
      "ผู้เชี่ยวชาญตัดสินเคส " + id);
    return r.data;
  }

  /* ============================================================
     พอร์ตสำหรับบริษัทประกัน — ผ่าน view ที่ไม่มีชื่อ/เบอร์โทร
     ============================================================ */
  async function insurerPortfolio() {
    if (!isCloud()) return [];
    var r = await sb.from("insurer_portfolio").select("*").limit(500);
    if (r.error) { console.warn(r.error); return []; }
    var u = await currentUser();
    if (u) await audit("portfolio.view", null, "เปิดดูพอร์ตความเสี่ยง " + (r.data || []).length + " ราย");
    return r.data || [];
  }

  /* ชั้นวัดผล — รายงานเชิงกลุ่มแถวเดียว ไม่มีข้อมูลรายบุคคลเลย
     ตัวเลขทุกตัวในนี้นับจริงจากฐานข้อมูล ไม่มีการประมาณการทางการเงินปนมา */
  async function insurerOutcomes() {
    if (!isCloud()) return null;
    var r = await sb.from("insurer_outcomes").select("*").limit(1);
    if (r.error) { console.warn(r.error); return null; }
    var row = (r.data || [])[0] || null;
    if (row) await audit("outcomes.view", null, "เปิดดูรายงานผลลัพธ์เชิงกลุ่ม");
    return row;
  }

  /* ============================================================
     Audit log — เขียนได้อย่างเดียว แก้/ลบไม่ได้แม้แต่ admin
     ============================================================ */
  async function audit(action, subjectId, detail, meta) {
    if (!isCloud()) return;
    try {
      var u = await currentUser(); if (!u) return;
      await sb.from("audit_logs").insert({
        actor_id: u.id, actor_role: profile ? profile.role : null,
        action: action, subject_id: subjectId || null,
        detail: detail || null, meta: meta || null
      });
    } catch (e) { /* ห้าม audit ที่ล้มเหลวทำให้ผู้ใช้ทำงานต่อไม่ได้ */ }
  }

  async function listAudit(limit) {
    if (!isCloud()) return [];
    var r = await sb.from("audit_logs").select("*")
      .order("created_at", { ascending: false }).limit(limit || 50);
    return r.data || [];
  }

  /* ============================================================
     ข้อมูลตรวจสอบความแม่นยำเครื่องมือวัด (Preliminary Technical Validation)
     ------------------------------------------------------------
     ผู้เข้าร่วมนำร่องไม่ต้องมีบัญชี — นักวิจัยที่ล็อกอินเป็นผู้บันทึกแทน
     เก็บรหัสผู้เข้าร่วม (P01, P02) ไม่ใช่ชื่อจริง
     ============================================================ */
  async function saveTrial(t) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("validation_trials").insert({
      researcher_id: u.id, site: t.site || null,
      participant_code: t.pid, trial_no: t.trialNo || 1, method: t.method || null,
      cs_seconds: t.csTime != null ? t.csTime : null,
      ref1_seconds: t.ref1 != null ? t.ref1 : null,
      ref2_seconds: t.ref2 != null ? t.ref2 : null,
      reps: t.reps != null ? t.reps : null,
      reps_correct: t.repsCorrect === true ? true : (t.repsCorrect === false ? false : null),
      cadence_cv: t.cv != null ? t.cv : null, gaps: t.gaps || null,
      sit_ref: t.sitRef != null ? t.sitRef : null,
      stand_ref: t.standRef != null ? t.standRef : null,
      setup_sec: t.setupSec != null ? t.setupSec : null,
      tech_fail: !!t.techFail, notes: t.notes || null
    }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }

  async function listTrials(limit) {
    if (!isCloud()) return [];
    var r = await sb.from("validation_trials").select("*")
      .order("created_at", { ascending: true }).limit(limit || 1000);
    return r.data || [];
  }

  /* ============================================================
     การตรวจสอบกับเวชระเบียน (Medical Record Verification)
     ------------------------------------------------------------
     ขอบเขตรายครั้ง: ระบุโรงพยาบาล ข้อมูลที่ขอ ช่วงเวลา และวัตถุประสงค์
     ฐานข้อมูลจะปฏิเสธถ้าไม่มีความยินยอมที่ยังไม่ถูกถอน
     ============================================================ */
  async function requestMedicalCheck(req) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("mrv_requests").insert({
      user_id: u.id, assessment_id: req.assessmentId || null,
      hospital: req.hospital, data_items: req.items, period: req.period,
      purpose: req.purpose || "underwriting"
    }).select().single();
    if (r.error) throw r.error;
    await audit("mrv.request", u.id,
      "ขอตรวจสอบเวชระเบียนที่ " + req.hospital + " · " + (req.items || []).join(", ") + " · ช่วง " + req.period);
    return r.data;
  }

  async function listMedicalChecks() {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("mrv_requests").select("*")
      .eq("user_id", u.id).order("requested_at", { ascending: false });
    return r.data || [];
  }

  /* สำหรับเจ้าหน้าที่: บันทึกผลการตรวจสอบ → ระบบปรับธงแหล่งข้อมูลให้อัตโนมัติ */
  async function completeMedicalCheck(id, outcome) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("mrv_requests").update({
      status: "completed", outcome: outcome, handled_by: u.id
    }).eq("id", id).select().single();
    if (r.error) throw r.error;
    await audit("mrv.complete", r.data.user_id, "บันทึกผลตรวจสอบเวชระเบียน: " + JSON.stringify(outcome));
    return r.data;
  }

  /* ============================================================
     ลายเซ็นใบหน้า — ผูกกับบัญชีคลาวด์แต่ "ไม่อัปโหลด"
     ------------------------------------------------------------
     สำคัญ: ตัวลายเซ็นเก็บใน localStorage ของเครื่องเท่านั้น
     ระบบกลางเก็บเพียงผลการยืนยัน (identity_verified) ซึ่งเป็นค่าจริง/เท็จ
     การผูกกับบัญชีทำโดยใช้ user id ของคลาวด์เป็นกุญแจในเครื่อง
     เพื่อให้คนละบัญชีบนเครื่องเดียวกันไม่ปะปนกัน
     ============================================================ */
  function faceKey(uid) { return "cs:faceSig:" + uid; }
  async function faceStoreLocal(sig) {
    var u = await currentUser();
    var uid = u ? u.id : "local";
    try { localStorage.setItem(faceKey(uid), JSON.stringify(sig)); } catch (e) {}
    if (u) await audit("biometric.enroll", u.id,
      "ลงทะเบียนลายเซ็นใบหน้า 6 ค่าไว้ในเครื่องผู้ใช้ · ไม่อัปโหลดภาพหรือลายเซ็นขึ้นระบบกลาง");
  }
  async function faceLoadLocal() {
    var u = await currentUser();
    var uid = u ? u.id : "local";
    try { var s = localStorage.getItem(faceKey(uid)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  async function faceClearLocal() {
    var u = await currentUser();
    var uid = u ? u.id : "local";
    try { localStorage.removeItem(faceKey(uid)); } catch (e) {}
  }

  /* ============================================================
     สิทธิลบข้อมูลทั้งหมดตาม PDPA
     ------------------------------------------------------------
     ลบ profile แล้ว cascade ลบ consents/assessments/risk_signals/referrals
     audit_logs คงไว้โดยตัด actor เป็น null เพื่อรักษาความครบถ้วนของร่องรอย
     ============================================================ */
  async function deleteAllMyData() {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    await audit("data.erase", u.id, "ผู้ใช้ใช้สิทธิลบข้อมูลทั้งหมดตาม PDPA");
    var r = await sb.from("profiles").delete().eq("id", u.id);
    if (r.error) throw r.error;
    await signOut();
    return true;
  }


  /* ============================================================
     ระบบครอบครัว — เชิญ → ขอเชื่อม → อนุมัติ → กำหนดสิทธิ์
     ------------------------------------------------------------
     สิทธิ์ทั้งหมดบังคับที่ Row Level Security ฝั่งเซิร์ฟเวอร์:
     ครอบครัวที่ยังไม่ถูกอนุมัติ SELECT อะไรไม่ได้เลย ต่อให้แก้โค้ดนี้
     ============================================================ */
  /* ฝั่งผู้เอาประกัน */
  async function createInvite() {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("cs_create_invite");
    if (r.error) throw r.error;
    return r.data;                       /* {code, expires_at} */
  }
  async function listMyCarers() {
    if (!isCloud()) return [];
    /* ใช้วิว my_carers เพราะ RLS ของ profiles ห้ามอ่านโปรไฟล์ผู้อื่น
       ถ้า join ตรง ๆ ชื่อผู้ขอเชื่อมต่อจะเป็น null ผู้เอาประกันจะตัดสินใจไม่ได้ */
    var r = await sb.from("my_carers").select("*").order("requested_at", { ascending: false });
    if (r.error) { console.warn(r.error); return []; }
    return (r.data || []).map(function (x) {
      x.carer = { display_name: x.carer_name };
      return x;
    });
  }
  async function decideCarer(linkId, approved, permissions) {
    if (!isCloud()) throw new Error("offline");
    var patch = { status: approved ? "approved" : "declined", decided_at: new Date().toISOString() };
    if (approved && permissions) patch.permissions = permissions;
    var r = await sb.from("caregiver_links").update(patch).eq("id", linkId).select().single();
    if (r.error) throw r.error;
    await audit(approved ? "family.approve" : "family.decline", null,
      (approved ? "อนุมัติ" : "ปฏิเสธ") + "คำขอเชื่อมต่อของครอบครัว");
    return r.data;
  }
  async function updateCarerPermissions(linkId, permissions) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.from("caregiver_links").update({ permissions: permissions })
      .eq("id", linkId).select().single();
    if (r.error) throw r.error;
    await audit("family.permissions", null, "แก้สิทธิ์การเข้าถึงของครอบครัว");
    return r.data;
  }
  async function revokeCarer(linkId) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.from("caregiver_links")
      .update({ status: "revoked", decided_at: new Date().toISOString() })
      .eq("id", linkId).select().single();
    if (r.error) throw r.error;
    await audit("family.revoke", null, "ยกเลิกการเชื่อมต่อของครอบครัว");
    return r.data;
  }

  /* ฝั่งครอบครัว */
  async function redeemInvite(code, relationship) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.rpc("cs_redeem_invite", { p_code: code, p_relationship: relationship || null });
    if (r.error) throw r.error;
    return r.data;                       /* {member_id, member_name} */
  }
  async function famMembers() {
    if (!isCloud()) return [];
    var r = await sb.from("family_members").select("*");
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function famAssessments(memberId, limit) {
    if (!isCloud()) return [];
    var r = await sb.from("assessments").select("*")
      .eq("user_id", memberId).order("assessed_at", { ascending: false }).limit(limit || 60);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function famRisk(memberId, limit) {
    if (!isCloud()) return [];
    var r = await sb.from("risk_signals").select("*")
      .eq("user_id", memberId).order("created_at", { ascending: false }).limit(limit || 10);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function famReferrals(memberId, limit) {
    if (!isCloud()) return [];
    var r = await sb.from("referrals").select("*")
      .eq("user_id", memberId).order("created_at", { ascending: false }).limit(limit || 5);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function famNotifications(limit) {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("family_notifications").select("*")
      .eq("carer_id", u.id).order("created_at", { ascending: false }).limit(limit || 40);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function notifRead(id) {
    if (!isCloud()) return;
    await sb.from("family_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  }
  async function famCancelRequest(linkId) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.from("caregiver_links")
      .update({ status: "revoked" }).eq("id", linkId).select().single();
    if (r.error) throw r.error;
    return r.data;
  }


  /* ---------- แจ้งเตือน 2 ชั้น + บันทึกการเยี่ยม ----------
     ชั้นที่ 1 (สิทธิ์): ผู้เอาประกันเลือกว่าจะให้แจ้งเรื่องอะไร — อยู่บน link
     ชั้นที่ 2 (ช่องทาง): ครอบครัวเลือกว่าจะรับทางไหน — อยู่ที่บัญชีครอบครัว
     สองอย่างนี้แยกกันโดยตั้งใจ เพราะสิทธิ์ในการเปิดเผยข้อมูลกับความ
     ต้องการรับแจ้งเตือน เป็นคนละเรื่องกัน */
  async function updateNotifyTypes(linkId, types) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.from("caregiver_links").update({ notify_types: types })
      .eq("id", linkId).select().single();
    if (r.error) throw r.error;
    await audit("family.notify_types", null, "แก้ว่าจะให้แจ้งเตือนครอบครัวเรื่องอะไรบ้าง");
    return r.data;
  }
  async function getNotifyPrefs() {
    if (!isCloud()) return null;
    var u = await currentUser(); if (!u) return null;
    var r = await sb.from("family_notify_prefs").select("*").eq("carer_id", u.id).maybeSingle();
    if (r.error) { console.warn(r.error); return null; }
    return r.data || { carer_id: u.id, channels: { inapp: true, push: false, sms: false } };
  }
  async function saveNotifyPrefs(channels) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("family_notify_prefs")
      .upsert({ carer_id: u.id, channels: channels, updated_at: new Date().toISOString() })
      .select().single();
    if (r.error) throw r.error;
    return r.data;
  }
  async function addCheckin(memberId, note) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("family_checkins")
      .insert({ member_id: memberId, carer_id: u.id, note: note }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }
  async function listCheckins(memberId, limit) {
    if (!isCloud()) return [];
    var r = await sb.from("family_checkins").select("*")
      .eq("member_id", memberId).order("created_at", { ascending: false }).limit(limit || 20);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }


  /* ============================================================
     ระบบวงจรปิด — เหตุการณ์ · แผนดูแล · การติดตาม · การส่งต่อ
     ============================================================ */
  async function reportEvent(kind, detail, severity) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    /* ผู้รายงานอาจเป็นครอบครัว จึงต้องระบุ user_id ของเจ้าของข้อมูลแยกจากผู้รายงาน */
    var owner = (detail && detail.memberId) || u.id;
    var r = await sb.from("care_events").insert({
      user_id: owner, reporter_id: u.id, kind: kind,
      detail: detail || null, severity: severity || "medium"
    }).select().single();
    if (r.error) throw r.error;
    await audit("event." + kind, owner, "รายงานเหตุการณ์: " + kind);
    return r.data;
  }
  async function listEvents(userId, limit) {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("care_events").select("*")
      .eq("user_id", userId || u.id).order("created_at", { ascending: false }).limit(limit || 30);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function savePlan(plan) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var r = await sb.from("care_plans").insert({
      user_id: u.id, assessment_id: plan.assessmentId || null,
      level: plan.level, items: plan.items || [], due_at: plan.dueAt || null
    }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }
  async function latestPlan(userId) {
    if (!isCloud()) return null;
    var u = await currentUser(); if (!u) return null;
    var r = await sb.from("care_plans").select("*")
      .eq("user_id", userId || u.id).order("created_at", { ascending: false }).limit(1);
    if (r.error) { console.warn(r.error); return null; }
    return (r.data || [])[0] || null;
  }
  async function updatePlanItems(planId, items) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.from("care_plans").update({ items: items }).eq("id", planId).select().single();
    if (r.error) throw r.error;
    return r.data;
  }
  async function scheduleFollowUps(planId, list) {
    if (!isCloud()) throw new Error("offline");
    var u = await currentUser(); if (!u) throw new Error("no session");
    var rows = list.map(function (f) {
      return { user_id: u.id, plan_id: planId, kind: f.kind, due_at: f.dueAt };
    });
    var r = await sb.from("follow_ups").insert(rows).select();
    if (r.error) throw r.error;
    return r.data;
  }
  async function listFollowUps(userId, limit) {
    if (!isCloud()) return [];
    var u = await currentUser(); if (!u) return [];
    var r = await sb.from("follow_ups").select("*")
      .eq("user_id", userId || u.id).order("due_at", { ascending: true }).limit(limit || 20);
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  async function completeFollowUp(id, note) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.from("follow_ups")
      .update({ status: "done", done_at: new Date().toISOString(), note: note || null })
      .eq("id", id).select().single();
    if (r.error) throw r.error;
    return r.data;
  }
  async function completeReferral(id, note) {
    if (!isCloud()) throw new Error("offline");
    var r = await sb.from("referrals")
      .update({ completed_at: new Date().toISOString(), completed_note: note || null })
      .eq("id", id).select().single();
    if (r.error) throw r.error;
    await audit("referral.completed", null, "ยืนยันว่าไปพบผู้เชี่ยวชาญแล้ว");
    return r.data;
  }

  return {
    init: init, isCloud: isCloud, mode: getMode, client: client,
    signUpUser: signUpUser, signInUser: signInUser,
     signInStaff: signInStaff,
    signOut: signOut, currentUser: currentUser,
    mfaEnroll: mfaEnroll, mfaVerify: mfaVerify, mfaFactors: mfaFactors,
    loadProfile: loadProfile, getProfile: getProfile, updateProfile: updateProfile,
    grantConsent: grantConsent, revokeConsent: revokeConsent, listConsents: listConsents,
    saveAssessment: saveAssessment, listAssessments: listAssessments,
    saveRiskSignal: saveRiskSignal, createReferral: createReferral,
    listReferralQueue: listReferralQueue, decideReferral: decideReferral,
    insurerPortfolio: insurerPortfolio, insurerOutcomes: insurerOutcomes,
    myCases: myCases, caseQueue: caseQueue, updateCase: updateCase,
    updateReferral: updateReferral,
    cmWorklist: cmWorklist, logContact: logContact, caseDetail: caseDetail,
    myWork: myWork, claimReferral: claimReferral, myReferrals: myReferrals,
    previewPackage: previewPackage, sendReferral: sendReferral, returnReview: returnReview, caseTimeline: caseTimeline,
    requestAccess: requestAccess, checkAccess: checkAccess,
    startWorkSession: startWorkSession, myOrg: myOrg, myOrgHistory: myOrgHistory,
    checkMembership: checkMembership,
    myAccessRequests: myAccessRequests, decideAccess: decideAccess, myAccessLog: myAccessLog,
    listStaff: listStaff, setRole: setRole,
    issueInvite: issueInvite, listInvites: listInvites,
    revokeInvite: revokeInvite, redeemStaffInvite: redeemStaffInvite,
    activateStaff: activateStaff, setOwnPassword: setOwnPassword,
    dataSummary: dataSummary, listAccounts: listAccounts,
    purgeMemberData: purgeMemberData, deleteAccount: deleteAccount, revokeStaff: revokeStaff,
    forcePasswordReset: forcePasswordReset, staffEmail: staffEmail,
    createReferralFor: createReferralFor,
    insurerFunnel: insurerFunnel, insurerStrata: insurerStrata, insurerSignals: insurerSignals,
    insurerMonthly: insurerMonthly,
    listMeds: listMeds, saveMed: saveMed, retireMed: retireMed,
    uploadMedPhoto: uploadMedPhoto, medPhotoUrl: medPhotoUrl, myMedReview: myMedReview,
    lookupDrug: lookupDrug, queueUnknownDrug: queueUnknownDrug,
    unknownDrugQueue: unknownDrugQueue, resolveUnknownDrug: resolveUnknownDrug,
    medReviewQueue: medReviewQueue, medsOf: medsOf, pharmacistFix: pharmacistFix,
    closeMedReview: closeMedReview,
    createInvite: createInvite, listMyCarers: listMyCarers, decideCarer: decideCarer,
    updateCarerPermissions: updateCarerPermissions, revokeCarer: revokeCarer,
    redeemInvite: redeemInvite, famMembers: famMembers, famAssessments: famAssessments,
    famRisk: famRisk, famReferrals: famReferrals, famNotifications: famNotifications,
    notifRead: notifRead, famCancelRequest: famCancelRequest,
    reportEvent: reportEvent, listEvents: listEvents,
    savePlan: savePlan, latestPlan: latestPlan, updatePlanItems: updatePlanItems,
    scheduleFollowUps: scheduleFollowUps, listFollowUps: listFollowUps,
    completeFollowUp: completeFollowUp, completeReferral: completeReferral,
    updateNotifyTypes: updateNotifyTypes, getNotifyPrefs: getNotifyPrefs,
    saveNotifyPrefs: saveNotifyPrefs, addCheckin: addCheckin, listCheckins: listCheckins,
    saveTrial: saveTrial, listTrials: listTrials,
    requestMedicalCheck: requestMedicalCheck, listMedicalChecks: listMedicalChecks,
    completeMedicalCheck: completeMedicalCheck,
    faceStoreLocal: faceStoreLocal, faceLoadLocal: faceLoadLocal, faceClearLocal: faceClearLocal,
    audit: audit, listAudit: listAudit,
    deleteAllMyData: deleteAllMyData
  };
})();
