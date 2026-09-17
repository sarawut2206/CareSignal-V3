-- ============================================================
-- 07_closed_loop.sql — ยกระดับเป็นระบบวงจรปิด (เอนจิน 2.0.0)
-- ------------------------------------------------------------
-- คัดกรอง → จัดระดับ → แผนป้องกัน → ติดตาม → ส่งต่อ → วัดผล
--
-- สิ่งที่เพิ่มในรุ่นนี้
--   1. เก็บข้อมูลเชิงลึกของการประเมิน (Safety Gate / ล้ม / ยา)
--   2. care_events — ให้ผู้ใช้และครอบครัวรายงานเหตุการณ์ได้ทันที
--      ไม่ต้องรอรอบประเมินถัดไป (หัวใจที่ทำให้วงจร "ปิด")
--   3. care_plans + follow_ups — แผนดูแลรายบุคคลและตารางติดตาม
--   4. ติดตามว่าไปพบผู้เชี่ยวชาญจริงหรือยัง
-- ============================================================

-- ---------- ข้อมูลเชิงลึกในแต่ละการประเมิน ----------
alter table public.assessments
  add column if not exists safety_gate   jsonb,   -- คำตอบคำถามความปลอดภัย + ผลตัดสิน
  add column if not exists falls_detail  jsonb,   -- ครั้งล่าสุด บาดเจ็บ หมดสติ ลุกเองได้ไหม
  add column if not exists meds_detail   jsonb,   -- ช่วงจำนวน กลุ่ม FRID การปรับยา อาการ
  add column if not exists test_quality  jsonb,   -- ใช้มือช่วย ต้องพยุง เดินเซ อุปกรณ์ช่วยเดิน
  add column if not exists baseline_level text,   -- ระดับจากชั้นคัดกรองพื้นฐาน (ไม่ต้องมีประวัติ)
  add column if not exists not_tested    boolean default false;

-- ---------- เหตุการณ์ที่ผู้ใช้/ครอบครัวรายงานเอง ----------
create table if not exists public.care_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  reporter_id uuid references public.profiles(id),
  kind        text not null,   -- fall | near_fall | med_change | dizzy | hospital | adl_drop | referral_done
  detail      jsonb,
  severity    text,            -- low | medium | high
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

-- ---------- แผนดูแลรายบุคคล + การติดตาม ----------
create table if not exists public.care_plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete set null,
  level         text not null,
  items         jsonb not null default '[]'::jsonb,   -- [{k,nm,done,done_at}]
  due_at        timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.follow_ups (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles(id) on delete cascade,
  plan_id  uuid references public.care_plans(id) on delete cascade,
  kind     text not null,   -- checkin_7d | review_30d | reassess | referral_check
  due_at   timestamptz not null,
  status   text not null default 'pending',   -- pending | done | missed
  done_at  timestamptz,
  note     text
);

-- ---------- ติดตามว่าไปพบผู้เชี่ยวชาญจริงไหม ----------
alter table public.referrals
  add column if not exists completed_at   timestamptz,
  add column if not exists completed_note text,
  add column if not exists referral_type  text;   -- doctor | pharmacist | physio | emergency

alter table public.care_events enable row level security;
alter table public.care_plans  enable row level security;
alter table public.follow_ups  enable row level security;

-- เจ้าของข้อมูลจัดการของตัวเอง · เจ้าหน้าที่อ่านได้ ·
-- ครอบครัวที่ได้รับสิทธิ์ alerts อ่านและรายงานเหตุแทนได้
drop policy if exists events_own on public.care_events;
drop policy if exists events_staff on public.care_events;
drop policy if exists events_family on public.care_events;
create policy events_own on public.care_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy events_staff on public.care_events
  for select using (cs_is_staff());
create policy events_family on public.care_events
  for all using (
    exists (select 1 from public.caregiver_links l
            where l.member_id = care_events.user_id and l.carer_id = auth.uid()
              and l.status='approved' and coalesce(l.permissions->>'alerts','false')='true')
  ) with check (reporter_id = auth.uid());

drop policy if exists plans_own on public.care_plans;
drop policy if exists plans_staff on public.care_plans;
drop policy if exists plans_family on public.care_plans;
create policy plans_own on public.care_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy plans_staff on public.care_plans
  for select using (cs_is_staff());
create policy plans_family on public.care_plans
  for select using (
    exists (select 1 from public.caregiver_links l
            where l.member_id = care_plans.user_id and l.carer_id = auth.uid()
              and l.status='approved' and coalesce(l.permissions->>'status','false')='true')
  );

drop policy if exists follow_own on public.follow_ups;
drop policy if exists follow_staff on public.follow_ups;
drop policy if exists follow_family on public.follow_ups;
create policy follow_own on public.follow_ups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy follow_staff on public.follow_ups
  for select using (cs_is_staff());
create policy follow_family on public.follow_ups
  for select using (
    exists (select 1 from public.caregiver_links l
            where l.member_id = follow_ups.user_id and l.carer_id = auth.uid()
              and l.status='approved' and coalesce(l.permissions->>'status','false')='true')
  );

-- ---------- แจ้งครอบครัวเมื่อมีเหตุการณ์ใหม่ ----------
-- เคารพชั้นสิทธิ์แจ้งเตือนเดียวกับ 06_family_notify.sql
-- และไม่แจ้งกลับไปหาคนที่เป็นผู้รายงานเอง
create or replace function public.notify_family_on_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; topic_key text;
begin
  nm := case new.kind
          when 'fall'       then 'มีการรายงานการหกล้มครั้งใหม่'
          when 'near_fall'  then 'มีการรายงานว่าเกือบล้ม'
          when 'med_change' then 'มีการเปลี่ยนแปลงยาที่ใช้'
          when 'dizzy'      then 'มีอาการเวียนศีรษะหรือหน้ามืด'
          when 'hospital'   then 'มีการเข้ารับการรักษาในโรงพยาบาล'
          when 'adl_drop'   then 'ทำกิจวัตรประจำวันได้น้อยลง'
          else 'มีเหตุการณ์ที่ควรทราบ' end;
  topic_key := case new.kind when 'fall' then 'new_fall'
                             when 'adl_drop' then 'adl_drop'
                             else 'status_change' end;
  insert into family_notifications (member_id, carer_id, kind, topic, body)
  select new.user_id, l.carer_id, 'event', topic_key, nm
  from caregiver_links l
  where l.member_id = new.user_id and l.status='approved'
    and coalesce(l.permissions->>'alerts','false')='true'
    and coalesce(l.notify_types->>topic_key,'false')='true'
    and l.carer_id <> coalesce(new.reporter_id, '00000000-0000-0000-0000-000000000000'::uuid);
  return new;
end $$;
drop trigger if exists trg_notify_family_event on public.care_events;
create trigger trg_notify_family_event
  after insert on public.care_events
  for each row execute function public.notify_family_on_event();
