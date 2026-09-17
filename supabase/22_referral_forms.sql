-- ============================================================
-- 22_referral_forms.sql — แบบฟอร์มส่งต่อสหวิชาชีพ (ต้นแบบ CDC STEADI)
-- ------------------------------------------------------------
-- ปัญหาที่แก้
--   1. ชุดข้อมูลส่งต่อรุ่นเดิมมีแค่ ล้ม/ยา/ลุกนั่ง/กิจวัตร/บ้าน แบบหยาบ
--      ผู้เชี่ยวชาญแต่ละวิชาชีพต้องการข้อมูลคนละชุด (แพทย์อยากรู้อาการ
--      หน้ามืดและหมดสติ · เภสัชกรอยากรู้ยาที่ตั้งธงและอาการหลังใช้ยา ·
--      นักกายภาพอยากรู้เวลาแต่ละท่าและคุณภาพการวัด · พยาบาลอยากรู้ว่า
--      อยู่คนเดียวไหมและลุกเองได้ไหม) จึงต้องเก็บรายละเอียดการประเมิน
--      ทั้งหมดไว้ที่ assessments.detail แล้วให้ build_referral_package
--      สกัดออกมาเป็นชุดข้อมูลรุ่น 2 (v:2) ที่มีทุกส่วนของแบบฟอร์มแกนกลาง
--   2. คำตอบของผู้เชี่ยวชาญเป็นข้อความ 3 ช่องเหมือนกันทุกวิชาชีพ
--      รุ่นนี้เก็บโครงสร้างตามแบบฟอร์มของวิชาชีพนั้นไว้ที่ review.form
--      (เภสัชกร: ปัญหาการใช้ยา+ข้อเสนอแนะ · แพทย์: ปัจจัยเสี่ยงที่ยืนยัน
--      แผน และการตอบรับข้อเสนอเภสัชกร · นักกายภาพ: ข้อสังเกต 4 ท่า โปรแกรม ·
--      พยาบาล: ความดันเปลี่ยนท่า การประสานงาน) พร้อมคำตอบมาตรฐาน 6 แบบ
--      โดยยังคง finding/recommend/next_step ไว้ให้หน้าเดิมทุกหน้าอ่านได้
--
-- ไม่มีข้อมูลใหม่ที่ระบุตัวบุคคล — เป็นรายละเอียดของการประเมินที่ผู้ใช้
-- บันทึกเองอยู่แล้ว และเข้าถึงได้ตามสิทธิ์เดิมของตาราง assessments/referrals
-- ============================================================

-- ---------- รายละเอียดการประเมินครบชุด ----------
alter table public.assessments add column if not exists detail jsonb;
comment on column public.assessments.detail is
  'รายละเอียดที่แบบฟอร์มส่งต่อใช้: steadi{fell,unsteady,worried} · tug{out,back,distance_ok,turn_by,ended_by,reach,drift,reaction} · balance{passed,label,stages[],alone_skip} · barthel{total,sf,band} · method';

-- ---------- ขั้นตอนถัดไปเพิ่ม: ส่งต่อวิชาชีพอื่น (นอกจากแพทย์) ----------
-- ตรวจใน return_review ด้านล่าง ไม่ใช่ enum จึงเพิ่มได้โดยไม่ต้อง alter type

-- ============================================================
-- ชุดข้อมูลส่งต่อรุ่น 2 — ทุกส่วนของแบบฟอร์มแกนกลาง (Form A)
-- ------------------------------------------------------------
-- คงคีย์รุ่นเดิม (falls, mobility, medications, adl, home, risk) ไว้ด้วย
-- เพื่อให้หน้าจอที่ยังอ่านรุ่นเดิมทำงานต่อได้ระหว่างเปลี่ยนผ่าน
-- ============================================================
create or replace function public.build_referral_package(target uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pkg jsonb; first_a record; last_a record; sig record; medsj jsonb; fu_n int; ref_n int;
        det jsonb; sg jsonb; md jsonb; hd jsonb; fd jsonb; n_high int; n_mod int; pharm jsonb;
begin
  if not public.cs_is_staff() then
    raise exception 'เฉพาะผู้ประสานงานที่สร้างชุดส่งต่อได้';
  end if;

  select * into first_a from public.assessments where user_id = target order by assessed_at asc  limit 1;
  select * into last_a  from public.assessments where user_id = target order by assessed_at desc limit 1;
  select * into sig from public.risk_signals where user_id = target order by created_at desc limit 1;

  det := coalesce(last_a.detail, '{}'::jsonb);
  sg  := coalesce(last_a.safety_gate, '{}'::jsonb);
  md  := coalesce(last_a.meds_detail, '{}'::jsonb);
  hd  := coalesce(last_a.home_detail, '{}'::jsonb);
  fd  := coalesce(last_a.falls_detail, '{}'::jsonb);

  /* ยา: เฉพาะที่ยังใช้อยู่ พร้อมกลุ่มเสี่ยงและใครยืนยัน */
  select coalesce(jsonb_agg(jsonb_build_object(
           'inn', inn, 'brand_text', brand_text, 'dose_text', dose_text, 'freq_text', freq_text,
           'frid_group', frid_group, 'frid_level', frid_level, 'confirmed_by', confirmed_by, 'source', source)), '[]'::jsonb),
         count(*) filter (where frid_level = 2), count(*) filter (where frid_level = 1)
    into medsj, n_high, n_mod
    from public.medications where user_id = target and active;

  /* ข้อเสนอจากเภสัชกรครั้งล่าสุด — แพทย์ต้องตอบรับตามแบบ STEADI-Rx */
  select coalesce(r.review->'form'->'problems', '[]'::jsonb) into pharm
    from public.referrals r
   where r.user_id = target and r.destination = 'pharmacist' and r.review is not null
   order by r.reviewed_at desc nulls last limit 1;

  select count(*) into fu_n from public.follow_ups where user_id = target and status = 'pending';
  select count(*) into ref_n from public.referrals where user_id = target
     and status not in ('outcome_recorded','declined');

  pkg := jsonb_build_object(
    'v', 2,
    'built_at', now(),
    'consent', (select jsonb_build_object('assessment', coalesce(bool_or(granted and revoked_at is null), false))
                  from public.consents where user_id = target and purpose = 'assessment'),
    /* STEADI 3 ข้อ */
    'screen', coalesce(det->'steadi', '{}'::jsonb),
    /* ประวัติล้ม (count/when/injury/loc/getup) */
    'falls', fd,
    /* อาการวันที่ประเมิน = คำตอบด่านความปลอดภัย (faint/chest/stroke/injury/helper) */
    'symptoms', coalesce(sg->'answers', sg),
    'meds', jsonb_build_object(
       'n', coalesce((md->>'n')::int, jsonb_array_length(medsj)),
       'high', n_high, 'mod', n_mod,
       'items', medsj,
       'symptoms', coalesce(md->'symptoms', '[]'::jsonb),
       'changed',  coalesce(md->'changed',  '[]'::jsonb)),
    'medications', medsj,                                   -- คีย์รุ่นเดิม
    'mobility', jsonb_build_object(
       'ftsst_first', first_a.ftsst_seconds, 'ftsst_last', last_a.ftsst_seconds,
       'tug_first',   first_a.tug_seconds,   'tug_last',   last_a.tug_seconds,
       'first_at', first_a.assessed_at, 'last_at', last_a.assessed_at,
       'n_assessments', (select count(*) from public.assessments where user_id = target),
       'reps', last_a.reps, 'cadence_cv', last_a.cadence_cv,
       'tug', coalesce(det->'tug', '{}'::jsonb)),
    'balance', coalesce(det->'balance', '{}'::jsonb),
    'adl', jsonb_build_object(
       'first', first_a.parts->'adl', 'last', last_a.parts->'adl',
       'barthel_total', det->'barthel'->'total', 'barthel_sf', det->'barthel'->'sf', 'barthel_band', det->'barthel'->'band'),
    'home', hd,
    'quality', jsonb_build_object(
       'method', last_a.method, 'identity_verified', last_a.identity_verified,
       'not_tested', coalesce(last_a.not_tested, false),
       'safety_verdict', sg->'verdict', 'test_quality', last_a.test_quality),
    'risk', jsonb_build_object(
       'tier', last_a.tier, 'score', last_a.score, 'max', last_a.score_max,
       'level', sig.level, 'flags', coalesce(sig.flags, '[]'::jsonb), 'next_days', sig.next_days),
    'pharm_recs', coalesce(pharm, '[]'::jsonb),
    'open_followups', fu_n,
    'open_referrals', ref_n
  );
  return pkg;
end $$;

grant execute on function public.build_referral_package(uuid) to authenticated;

-- ============================================================
-- ส่งผลทบทวนกลับ พร้อมแบบฟอร์มของวิชาชีพ
-- ------------------------------------------------------------
-- ลายเซ็นใหม่รับ form jsonb; ลายเซ็นเดิม 5 พารามิเตอร์ยังใช้ได้ (ส่ง form ว่าง)
-- คำตอบมาตรฐานต้องเป็นหนึ่งใน 6 แบบ และ next_step เพิ่ม refer_other
-- ============================================================
create or replace function public.return_review(rid uuid, finding text, recommend text,
                                                next_step text, note text, form jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare rec public.referrals; allowed boolean; vd text;
begin
  select * into rec from public.referrals where id = rid;
  if rec.id is null then raise exception 'ไม่พบรายการส่งต่อ'; end if;

  /* ระวัง NULL: assigned_to ยังว่างตอนไม่มีใครรับ → NULL = uid เป็น NULL
     → not (false or NULL or false) = NULL → if ไม่ยก exception → ใครก็ผ่าน
     จึงบังคับให้เป็น boolean จริงก่อนตรวจ (พบจากการทดสอบด้วย session จริง) */
  allowed := coalesce(public.cs_is_staff(), false)
          or coalesce(rec.assigned_to = auth.uid(), false)
          or (coalesce(public.cs_is_clinician(), false)
              and coalesce(rec.destination = public.cs_my_destination(), false));
  if not allowed then raise exception 'รายการนี้ไม่ได้ส่งมาถึงท่าน'; end if;
  if finding is null or length(trim(finding)) < 5 then
    raise exception 'กรุณาเขียนข้อค้นพบอย่างน้อย 1 ประโยค';
  end if;
  if next_step not in ('sufficient','need_more_info','book_assessment','refer_doctor','refer_other','follow_plan') then
    raise exception 'ขั้นตอนถัดไปไม่ถูกต้อง';
  end if;
  vd := form->>'verdict';
  if vd is not null and vd not in ('confirm','not_confirm','need_more_info','advised','refer_other','follow_up') then
    raise exception 'คำตอบมาตรฐานไม่ถูกต้อง';
  end if;
  /* ระบบไม่ส่งคำสั่งหยุดยาถึงผู้เอาประกัน — ต้องเป็นคำว่าทบทวนกับผู้สั่งใช้ */
  if recommend ~ '(ให้หยุดยา|หยุดยาทันที|เลิกยา)' then
    raise exception 'คำแนะนำเรื่องยาให้ใช้ถ้อยคำว่า ทบทวนกับผู้สั่งใช้ — การปรับยาเป็นของผู้สั่งใช้';
  end if;

  update public.referrals
     set review = jsonb_build_object('finding', finding, 'recommend', recommend,
                                     'next_step', next_step, 'note', note,
                                     'form', coalesce(form, '{}'::jsonb) || jsonb_build_object('answered_at', now(), 'answered_role', public.cs_role())),
         reviewed_at = now(), reviewed_by = auth.uid(),
         status = 'review_returned'::cs_referral_status
   where id = rid;

  /* ผู้ประสานงานต้องเห็นว่ามีผลกลับมาแล้ว — ตั้งงานถัดไปของเคส */
  if rec.case_id is not null then
    update public.care_cases
       set next_action = 'ผลทบทวนจาก' ||
             case rec.destination when 'pharmacist' then 'เภสัชกร' when 'physio' then 'นักกายภาพ'
                                  when 'doctor' then 'แพทย์' when 'nurse' then 'พยาบาล'
                                  else rec.destination end || 'กลับมาแล้ว — ปรับแผนดูแล' ||
             case when vd is not null then ' (' || vd || ')' else '' end,
           updated_at = now()
     where id = rec.case_id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, subject_id, detail, meta)
  values (auth.uid(), public.cs_role(), 'referral.review_returned', rec.user_id,
          'ส่งผลทบทวนกลับ: ' || next_step || coalesce(' · ' || vd, ''),
          jsonb_build_object('referral_id', rid, 'form_v', form->'v'));
end $$;

grant execute on function public.return_review(uuid, text, text, text, text, jsonb) to authenticated;

-- ลายเซ็นเดิม — ยังใช้ได้ ส่งต่อไปยังรุ่นใหม่โดยไม่มีแบบฟอร์ม
create or replace function public.return_review(rid uuid, finding text, recommend text,
                                                next_step text, note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.return_review(rid, finding, recommend, next_step, note, null::jsonb);
end $$;

grant execute on function public.return_review(uuid, text, text, text, text) to authenticated;

comment on function public.return_review(uuid, text, text, text, text, jsonb) is
  'ผู้เชี่ยวชาญส่งผลกลับ — finding/recommend/next_step สำหรับทุกหน้าจอ + form ตามแบบฟอร์มของวิชาชีพ (verdict มาตรฐาน 6 แบบ)';
