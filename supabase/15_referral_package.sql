-- ============================================================
-- 15) ชุดข้อมูลส่งต่อ + ผลทบทวนส่งกลับ + ไทม์ไลน์เคส
-- ------------------------------------------------------------
-- รับแนวจาก MOPH Refer สามเรื่องที่ใช้กับงานเฝ้าระวังก่อนเคลมได้:
--
--   1. ใบส่งตัวมีโครงสร้าง ไม่ใช่แค่ "ส่งไปหาหมอ"
--      ของเดิม createReferralFor ส่ง reasons = [] ว่างเปล่า ปลายทางรู้แค่ว่า
--      "แดง" แต่ไม่รู้ว่าแดงเพราะอะไร และต้องตรวจเรื่องใด
--      ตอนนี้ส่งเป็นชุด: เหตุผล · ข้อมูลประกอบ ณ เวลาส่ง · คำถามที่ต้องการคำตอบ
--
--   2. ส่งกลับ (Refer Back) — ผู้เชี่ยวชาญต้องตอบกลับเป็นโครงสร้าง
--      ไม่ใช่จบที่ "ได้รับบริการแล้ว" แต่ต้องรู้ว่าความเห็นคืออะไร
--      และผู้ประสานงานต้องทำอะไรต่อ
--
--   3. ไทม์ไลน์ — ทุกฝ่ายเห็นว่าข้อมูลเดินทางไปถึงไหนแล้ว
--
-- สิ่งที่ตั้งใจไม่เอามา: MOPH Refer ส่งผู้ป่วยไปรักษา มีภาพรังสี
-- มีเวชระเบียนเต็ม — CareSignal ส่ง "สัญญาณเสี่ยง" ไปทบทวนและป้องกัน
-- จึงส่งเฉพาะ 4 ด้าน: หกล้ม · การเคลื่อนไหว · ยา · กิจวัตร
-- ============================================================

-- ความปลอดภัยในบ้าน (CDC STEADI home hazards) เก็บแยกคอลัมน์เหมือน falls_detail
alter table public.assessments add column if not exists home_detail jsonb;

alter table public.referrals
  add column if not exists package     jsonb,        -- ชุดข้อมูล ณ เวลาส่ง (สำเนา ไม่ใช่อ้างสด)
  add column if not exists questions   text[],       -- คำถามที่ต้องการให้ผู้เชี่ยวชาญตอบ
  add column if not exists reply_due   timestamptz,  -- กำหนดตอบกลับ
  add column if not exists review      jsonb,        -- ผลทบทวนที่ส่งกลับ
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists sent_by     uuid references public.profiles(id);

comment on column public.referrals.package is
  'ชุดข้อมูล ณ เวลาส่ง — เก็บเป็นสำเนาเพื่อให้ปลายทางเห็นสิ่งเดียวกับที่ต้นทางเห็นตอนตัดสินใจส่ง';
comment on column public.referrals.review is
  'ผลทบทวนส่งกลับ {finding, recommend, next_step, note} — ผู้เชี่ยวชาญมนุษย์เป็นผู้เขียน';

-- สถานะเพิ่ม: ผู้เชี่ยวชาญส่งผลกลับแล้ว (ก่อนผู้ประสานงานจะปรับแผน)
-- คำสั่ง alter type ต้องรันแยกก่อน transaction ที่ใช้ค่านั้น:
--   alter type cs_referral_status add value if not exists 'review_returned';

-- ============================================================
-- สร้างชุดข้อมูลส่งต่อจากข้อมูลจริง ณ เวลานั้น
-- ------------------------------------------------------------
-- security definer เพราะต้องอ่านหลายตารางของผู้เอาประกัน
-- แต่ตรวจก่อนว่าผู้เรียกเป็นผู้ประสานงาน
-- ============================================================
create or replace function public.build_referral_package(target uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pkg jsonb; first_a record; last_a record; fallsj jsonb; medsj jsonb; adlj jsonb;
        fu_n int; ref_n int;
begin
  if not public.cs_is_staff() then
    raise exception 'เฉพาะผู้ประสานงานที่สร้างชุดส่งต่อได้';
  end if;

  select * into first_a from public.assessments where user_id = target order by assessed_at asc  limit 1;
  select * into last_a  from public.assessments where user_id = target order by assessed_at desc limit 1;

  /* หกล้ม: จากคอลัมน์ falls_detail ของผลประเมินล่าสุด (ไม่ใช่ใน parts) */
  fallsj := coalesce(last_a.falls_detail, '{}'::jsonb);

  /* ยา: เฉพาะที่ยังใช้อยู่ พร้อมกลุ่มเสี่ยง */
  select coalesce(jsonb_agg(jsonb_build_object(
           'inn', inn, 'frid_group', frid_group, 'frid_level', frid_level,
           'confirmed_by', confirmed_by)), '[]'::jsonb)
    into medsj from public.medications where user_id = target and active;

  /* กิจวัตร: คะแนนจากผลประเมินล่าสุด */
  adlj := jsonb_build_object(
    'first', first_a.parts->'adl', 'last', last_a.parts->'adl');

  select count(*) into fu_n from public.follow_ups where user_id = target and status = 'pending';
  select count(*) into ref_n from public.referrals where user_id = target
     and status not in ('outcome_recorded','declined');

  pkg := jsonb_build_object(
    'built_at', now(),
    'falls', fallsj,
    'mobility', jsonb_build_object(
       'ftsst_first', first_a.ftsst_seconds, 'ftsst_last', last_a.ftsst_seconds,
       'tug_first',   first_a.tug_seconds,   'tug_last',   last_a.tug_seconds,
       'first_at', first_a.assessed_at, 'last_at', last_a.assessed_at,
       'n_assessments', (select count(*) from public.assessments where user_id = target)),
    'medications', medsj,
    'adl', adlj,
    'home', coalesce(last_a.home_detail, '{}'::jsonb),
    'risk', jsonb_build_object('tier', last_a.tier, 'score', last_a.score, 'max', last_a.score_max),
    'open_followups', fu_n,
    'open_referrals', ref_n,
    'consent', (select jsonb_build_object('assessment', bool_or(granted and revoked_at is null))
                  from public.consents where user_id = target and purpose = 'assessment')
  );
  return pkg;
end $$;

grant execute on function public.build_referral_package(uuid) to authenticated;

-- ============================================================
-- ส่งผลทบทวนกลับ — Refer Back
-- ------------------------------------------------------------
-- ผู้เชี่ยวชาญที่รับเคสนั้นเท่านั้น · ต้องมีข้อสรุปเป็นโครงสร้าง
-- เปลี่ยนสถานะเป็น review_returned และเปิดงานให้ผู้ประสานงานปรับแผน
-- ============================================================
create or replace function public.return_review(rid uuid, finding text, recommend text,
                                                next_step text, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare rec public.referrals; allowed boolean;
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
  if next_step not in ('sufficient','need_more_info','book_assessment','refer_doctor','follow_plan') then
    raise exception 'ขั้นตอนถัดไปไม่ถูกต้อง';
  end if;

  update public.referrals
     set review = jsonb_build_object('finding', finding, 'recommend', recommend,
                                     'next_step', next_step, 'note', note),
         reviewed_at = now(), reviewed_by = auth.uid(),
         status = 'review_returned'::cs_referral_status
   where id = rid;

  /* ผู้ประสานงานต้องเห็นว่ามีผลกลับมาแล้ว — ตั้งงานถัดไปของเคส */
  if rec.case_id is not null then
    update public.care_cases
       set next_action = 'ผลทบทวนจาก' ||
             case rec.destination when 'pharmacist' then 'เภสัชกร' when 'physio' then 'นักกายภาพ'
                                  when 'doctor' then 'แพทย์' when 'nurse' then 'พยาบาล'
                                  else rec.destination end || 'กลับมาแล้ว — ปรับแผนดูแล',
           updated_at = now()
     where id = rec.case_id;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, subject_id, detail, meta)
  values (auth.uid(), public.cs_role(), 'referral.review_returned', rec.user_id,
          'ส่งผลทบทวนกลับ: ' || next_step, jsonb_build_object('referral_id', rid));
end $$;

grant execute on function public.return_review(uuid, text, text, text, text) to authenticated;

-- ============================================================
-- ไทม์ไลน์เคส — ทุกเหตุการณ์เรียงตามเวลา
-- ------------------------------------------------------------
-- ดึงจากข้อมูลที่มีอยู่แล้ว ไม่ได้สร้างตารางใหม่ ไม่มีทางเพี้ยนจากของจริง
-- ============================================================
create or replace function public.case_timeline(cid uuid)
returns table(at timestamptz, kind text, title text, detail text)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.care_cases where id = cid
               and (public.cs_is_staff() or user_id = auth.uid()
                    or public.cs_referred_to_me(user_id)))
  select c.opened_at, 'signal', 'ระบบพบสัญญาณเสี่ยง',
         'ระดับ ' || c.level::text || ' · ต้องติดต่อภายใน ' || c.sla_hours || ' ชม.' from c
  union all
  select c.contacted_at, 'contact', 'ผู้ประสานงานติดต่อแล้ว', null from c where c.contacted_at is not null
  union all
  select cl.created_at, 'contact', 'บันทึกการติดต่อ', cl.result || coalesce(' · ' || cl.note, '')
    from public.contact_log cl, c where cl.case_id = c.id
  union all
  select r.created_at, 'refer', 'ส่งต่อไปยัง' ||
         case r.destination when 'pharmacist' then 'เภสัชกร' when 'physio' then 'นักกายภาพ'
                            when 'doctor' then 'แพทย์' when 'nurse' then 'พยาบาล' else r.destination end,
         r.action from public.referrals r, c where r.case_id = c.id
  union all
  select r.acknowledged_at, 'refer', 'ปลายทางรับเคสแล้ว', null
    from public.referrals r, c where r.case_id = c.id and r.acknowledged_at is not null
  union all
  select r.booked_at, 'refer', 'นัดหมายแล้ว', null
    from public.referrals r, c where r.case_id = c.id and r.booked_at is not null
  union all
  select r.completed_at, 'refer', 'ได้รับบริการแล้ว', r.completed_note
    from public.referrals r, c where r.case_id = c.id and r.completed_at is not null
  union all
  select r.reviewed_at, 'review', 'ผลทบทวนส่งกลับ',
         (r.review->>'finding') from public.referrals r, c where r.case_id = c.id and r.reviewed_at is not null
  union all
  select a.requested_at, 'consent', 'ขอความยินยอมเปิดดูข้อมูล',
         coalesce(a.requester_org, '') || ' · ' || a.status
    from public.access_requests a, c where a.member_id = c.user_id
  union all
  select f.due_at, 'followup', case when f.status = 'done' then 'ติดตามแล้ว' else 'กำหนดติดตาม' end, f.kind
    from public.follow_ups f, c where f.user_id = c.user_id
  order by 1
$$;

grant execute on function public.case_timeline(uuid) to authenticated;

-- ============================================================
-- ผู้ประสานงานต้องสร้างรายการส่งต่อให้ผู้เอาประกันได้
-- ------------------------------------------------------------
-- ของเดิมอนุญาตเฉพาะ user_id = auth.uid() ทำให้ปุ่มส่งต่อในคอนโซล
-- ไม่เคยทำงานจริง — RLS ปฏิเสธเงียบ ๆ และไม่มีใครกดจนถึงตอนนี้
-- ============================================================
drop policy if exists referrals_insert_own on public.referrals;
create policy referrals_insert_own on public.referrals
  for insert with check (user_id = auth.uid() or public.cs_is_staff());

-- ส่งต่อแบบมีโครงสร้างในฟังก์ชันเดียว — ชุดข้อมูลถูกสร้าง ณ เวลาส่งเสมอ
-- และต้องมีคำถามอย่างน้อย 1 ข้อ ไม่มีทางส่งแค่คำว่า "แดง"
create or replace function public.send_referral(target uuid, cid uuid, dest text, action_txt text,
                                                lvl cs_risk_level, reasons_j jsonb, qs text[], reply_hours int default 48)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; pkg jsonb;
begin
  if not public.cs_is_staff() then raise exception 'เฉพาะผู้ประสานงานที่ส่งต่อได้'; end if;
  if dest not in ('pharmacist','physio','doctor','nurse','family','community') then
    raise exception 'ปลายทางไม่ถูกต้อง';
  end if;
  if qs is null or array_length(qs,1) is null then
    raise exception 'ต้องระบุคำถามที่ต้องการให้ผู้เชี่ยวชาญตอบอย่างน้อย 1 ข้อ';
  end if;
  pkg := public.build_referral_package(target);
  insert into public.referrals (user_id, case_id, level, action, sla, reasons, status, destination,
                                package, questions, reply_due, sent_by, decided_by, decided_at)
  values (target, cid, lvl, action_txt, reply_hours || ' ชม.', coalesce(reasons_j,'[]'::jsonb), 'pending', dest,
          pkg, qs, now() + make_interval(hours => greatest(1, reply_hours)), auth.uid(), auth.uid(), now())
  returning id into rid;

  if cid is not null then
    update public.care_cases set status = 'referred', next_action = 'รอ' ||
      case dest when 'pharmacist' then 'เภสัชกร' when 'physio' then 'นักกายภาพ' when 'doctor' then 'แพทย์'
                when 'nurse' then 'พยาบาล' else dest end || 'รับเคสและตอบกลับ', updated_at = now()
     where id = cid;
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, subject_id, detail, meta)
  values (auth.uid(), public.cs_role(), 'referral.sent', target,
          'ส่งต่อไปยัง ' || dest || ' พร้อมชุดข้อมูลและคำถาม ' || array_length(qs,1) || ' ข้อ',
          jsonb_build_object('referral_id', rid, 'case_id', cid));
  return rid;
end $$;
grant execute on function public.send_referral(uuid, uuid, text, text, cs_risk_level, jsonb, text[], int) to authenticated;
