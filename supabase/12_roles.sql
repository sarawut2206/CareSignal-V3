-- ============================================================
-- 12) บทบาทวิชาชีพ และ "งานของฉัน"
-- ------------------------------------------------------------
-- ปัญหาของเดิม: ทุกบัญชีที่เป็น care_manager เห็นคิวเดียวกันทั้งหมด
-- และปลายทางการส่งต่อ (เภสัชกร นักกายภาพ แพทย์) ไม่มีบัญชีของตัวเอง
-- จึงพิสูจน์ไม่ได้ว่า "ใครรับเคสไปทำ" และเจ้าหน้าที่ต้องกวาดสายตา
-- หาเคสของตัวเองจากกองรวม
--
-- รอบนี้:
--   * เพิ่มบทบาทวิชาชีพ ให้ปลายทางส่งต่อมีบัญชีจริง
--   * ให้แต่ละคนเห็นเฉพาะงานที่ตัวเองรับผิดชอบเป็นค่าตั้งต้น
--   * บังคับที่ฐานข้อมูล ไม่ใช่แค่กรองที่หน้าจอ
-- ============================================================

-- ---------- บทบาทวิชาชีพ ----------
-- ตรงกับปลายทางในคอลัมน์ referrals.destination ที่มีอยู่แล้ว
-- หมายเหตุ: alter type add value ต้องรันแยกก่อน ไม่รวมใน transaction เดียวกับ
-- คำสั่งที่ใช้ค่าใหม่นั้น มิฉะนั้น Postgres จะปฏิเสธ
--   alter type cs_role add value if not exists 'pharmacist';
--   alter type cs_role add value if not exists 'physio';
--   alter type cs_role add value if not exists 'doctor';
--   alter type cs_role add value if not exists 'nurse';
-- (รันไปแล้วบนฐานข้อมูลจริง — เก็บไว้เป็นบันทึกลำดับการติดตั้ง)

-- ---------- ผู้รับผิดชอบรายการส่งต่อ ----------
-- destination บอกว่าส่งไป "วิชาชีพไหน" แต่ไม่บอกว่า "ใครรับไปทำ"
-- assigned_to จึงเก็บบัญชีของคนที่กดรับเคสนั้นจริง
alter table public.referrals
  add column if not exists assigned_to uuid references public.profiles(id);

create index if not exists referrals_assigned_idx
  on public.referrals(assigned_to, status);
create index if not exists referrals_dest_idx
  on public.referrals(destination, status);

comment on column public.referrals.assigned_to is
  'บัญชีวิชาชีพที่กดรับเคสนี้ไปดำเนินการ — ต่างจาก decided_by ซึ่งเป็นผู้อนุมัติ';

-- ---------- ฟังก์ชันช่วย ----------
-- แปลงบทบาทของผู้ใช้ที่ล็อกอินอยู่ ให้เป็นค่า destination ที่ตรงกัน
create or replace function public.cs_my_destination()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case public.cs_role()
    when 'pharmacist' then 'pharmacist'
    when 'physio'     then 'physio'
    when 'doctor'     then 'doctor'
    when 'nurse'      then 'nurse'
    else null
  end
$$;

-- วิชาชีพที่รับเคสส่งต่อได้ (ไม่รวม care_manager ซึ่งเป็นผู้ประสาน)
create or replace function public.cs_is_clinician()
returns boolean
language sql
stable
as $$
  select public.cs_role() in ('pharmacist','physio','doctor','nurse')
$$;

-- เจ้าหน้าที่ทุกประเภทที่แตะข้อมูลรายบุคคลได้
-- แทนที่ของเดิมที่นับเฉพาะ care_manager กับ admin
create or replace function public.cs_is_care_team()
returns boolean
language sql
stable
as $$
  select public.cs_role() in
    ('care_manager','admin','pharmacist','physio','doctor','nurse')
$$;

-- ============================================================
-- สิทธิ์: วิชาชีพเห็นเฉพาะเคสที่ส่งมาถึงวิชาชีพตน
-- ------------------------------------------------------------
-- เภสัชกรไม่ควรเห็นรายการที่ส่งไปนักกายภาพ และกลับกัน
-- Care Manager เห็นทั้งหมดเพราะเป็นผู้ประสานงาน
-- ============================================================
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
  for select using (
        user_id = auth.uid()                       -- เจ้าของข้อมูลเห็นของตน
     or public.cs_is_staff()                       -- ผู้ประสานงานเห็นทั้งหมด
     or (public.cs_is_clinician() and (
              destination  = public.cs_my_destination()
           or assigned_to  = auth.uid()))          -- วิชาชีพเห็นเฉพาะของตน
  );

drop policy if exists referrals_staff_update on public.referrals;
create policy referrals_staff_update on public.referrals
  for update using (
        public.cs_is_staff()
     or (public.cs_is_clinician() and (
              destination  = public.cs_my_destination()
           or assigned_to  = auth.uid()))
  ) with check (
        public.cs_is_staff()
     or (public.cs_is_clinician() and (
              destination  = public.cs_my_destination()
           or assigned_to  = auth.uid()))
  );

-- ---------- ข้อมูลที่วิชาชีพต้องอ่านได้เพื่อทำงาน ----------
-- อ่านได้เฉพาะของคนที่มีรายการส่งต่อมาถึงตนเท่านั้น ไม่ใช่ทั้งฐาน
create or replace function public.cs_referred_to_me(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.referrals r
     where r.user_id = target
       and (r.destination = public.cs_my_destination() or r.assigned_to = auth.uid())
  )
$$;

drop policy if exists profiles_clinician_read on public.profiles;
create policy profiles_clinician_read on public.profiles
  for select using (public.cs_is_clinician() and public.cs_referred_to_me(id));

drop policy if exists assessments_clinician_read on public.assessments;
create policy assessments_clinician_read on public.assessments
  for select using (public.cs_is_clinician() and public.cs_referred_to_me(user_id));

-- เภสัชกรต้องเห็นรายการยาของคนที่ส่งมาให้ทบทวน
drop policy if exists meds_pharmacist_read on public.medications;
create policy meds_pharmacist_read on public.medications
  for select using (
    public.cs_role() = 'pharmacist' and public.cs_referred_to_me(user_id)
  );

-- ============================================================
-- view: งานของฉัน — รวมทุกอย่างที่ผู้ล็อกอินรับผิดชอบไว้ที่เดียว
-- ------------------------------------------------------------
-- แต่ละแถวคือ "งานหนึ่งชิ้น" ที่ต้องลงมือทำ พร้อมกำหนดเวลา
-- ไม่ใช่รายชื่อคน — เจ้าหน้าที่จะได้เปิดหน้าเดียวแล้วรู้ว่าวันนี้ทำอะไร
-- ============================================================
drop view if exists public.my_work;
create or replace view public.my_work as
-- 1) เคสที่ฉันรับผิดชอบ (หรือยังไม่มีใครรับ และฉันเป็นผู้ประสานงาน)
select
  'case'::text                                   as kind,
  c.id                                           as ref_id,
  c.user_id,
  p.pseudonym,
  p.display_name,
  c.level::text                                  as level,
  c.status::text                                 as status,
  c.next_action                                  as task,
  c.due_at,
  c.assigned_to,
  (c.assigned_to is null)                        as unclaimed,
  (now() > c.due_at)                             as overdue,
  c.signals
from public.care_cases c
join public.profiles p on p.id = c.user_id
where c.status not in ('stable','closed')
  and public.cs_is_staff()
  and (c.assigned_to = auth.uid() or c.assigned_to is null)

union all

-- 2) รายการส่งต่อที่มาถึงวิชาชีพของฉัน
select
  'referral'::text,
  r.id,
  r.user_id,
  p.pseudonym,
  p.display_name,
  r.level::text,
  r.status::text,
  coalesce(r.action, 'ทบทวนและบันทึกผล'),
  -- ยังไม่มีคอลัมน์กำหนดส่งของ referral จึงคิดจากวันที่เปิดตามระดับความเร่งด่วน
  r.created_at + (case r.level
                    when 'urgent'  then interval '1 day'
                    when 'decline' then interval '3 days'
                    else                interval '7 days' end),
  r.assigned_to,
  (r.assigned_to is null),
  (now() > r.created_at + (case r.level
                    when 'urgent'  then interval '1 day'
                    when 'decline' then interval '3 days'
                    else                interval '7 days' end)),
  r.reasons
from public.referrals r
join public.profiles p on p.id = r.user_id
where r.status not in ('outcome_recorded','declined')
  and public.cs_is_clinician()
  and (r.destination = public.cs_my_destination() or r.assigned_to = auth.uid());

comment on view public.my_work is
  'งานที่ผู้ล็อกอินรับผิดชอบ — เคสสำหรับผู้ประสานงาน และรายการส่งต่อสำหรับวิชาชีพ '
  'กรองด้วย auth.uid() ในตัว view เอง ไม่ได้พึ่งการกรองที่หน้าจอ';

grant select on public.my_work to authenticated;

-- ---------- กดรับเคสส่งต่อ ----------
-- บันทึกว่าใครรับไปทำ พร้อมเวลา เพื่อวัดว่าค้างรอผู้รับนานเท่าใด
create or replace function public.claim_referral(rid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare owner_id uuid;
begin
  if not public.cs_is_care_team() then
    raise exception 'ไม่มีสิทธิ์รับเคสนี้';
  end if;

  update public.referrals
     set assigned_to     = auth.uid(),
         acknowledged_at = coalesce(acknowledged_at, now()),
         status          = case when status = 'pending' then 'acknowledged'::cs_referral_status
                                else status end
   where id = rid
     and (public.cs_is_staff()
          or destination = public.cs_my_destination()
          or assigned_to = auth.uid())
  returning user_id into owner_id;

  if owner_id is null then
    raise exception 'ไม่พบรายการ หรือรายการนี้ไม่ได้ส่งมาถึงคุณ';
  end if;

  -- audit_logs ใช้ subject_id = เจ้าของข้อมูลที่ถูกแตะ ส่วนรหัสรายการเก็บใน meta
  insert into public.audit_logs(actor_id, actor_role, action, subject_id, detail, meta)
  values (auth.uid(), public.cs_role(), 'claim_referral', owner_id,
          'กดรับเคสส่งต่อไปดำเนินการ', jsonb_build_object('referral_id', rid));
end $$;

grant execute on function public.claim_referral(uuid) to authenticated;
