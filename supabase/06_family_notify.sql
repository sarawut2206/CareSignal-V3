-- ============================================================
-- 06_family_notify.sql — แจ้งเตือน 2 ชั้น + บันทึกการเยี่ยม
-- ------------------------------------------------------------
-- ชั้นที่ 1 (สิทธิ์)  : ผู้เอาประกันเลือกว่า "ให้แจ้งเรื่องอะไรได้บ้าง"
--                      เก็บเป็น notify_types บน caregiver_links
-- ชั้นที่ 2 (ช่องทาง): ครอบครัวเลือกว่า "ฉันอยากรับอย่างไร"
--                      เก็บที่ family_notify_prefs ของบัญชีครอบครัวเอง
--
-- แยกสองชั้นเพราะสิทธิ์ในการเปิดเผยข้อมูล กับ ความต้องการรับการแจ้งเตือน
-- เป็นคนละเรื่องกัน — ผู้เอาประกันไม่ควรถูกบังคับให้กำหนดช่องทางของคนอื่น
-- และครอบครัวไม่ควรเปิดรับหัวข้อที่เจ้าของข้อมูลไม่ได้อนุญาต
-- ============================================================

alter table public.caregiver_links
  add column if not exists notify_types jsonb not null default
  '{"status_change":true,"orange_red":true,"new_fall":true,"adl_drop":true,"due_reminder":true}'::jsonb;

create table if not exists public.family_notify_prefs (
  carer_id   uuid primary key references public.profiles(id) on delete cascade,
  channels   jsonb not null default '{"inapp":true,"push":false,"sms":false}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.family_notify_prefs enable row level security;
drop policy if exists prefs_own on public.family_notify_prefs;
create policy prefs_own on public.family_notify_prefs
  for all using (carer_id = auth.uid()) with check (carer_id = auth.uid());

alter table public.family_notifications
  add column if not exists topic text;

-- ผู้เอาประกันต้องเห็น "ชื่อ" ของคนที่ขอเชื่อมต่อ จึงจะตัดสินใจอนุมัติได้
-- แต่ RLS ของ profiles ห้ามอ่านโปรไฟล์ผู้อื่น จึงเปิดผ่านวิวที่จำกัดคอลัมน์
-- และกรองด้วย member_id = auth.uid() — เห็นได้เฉพาะคนที่ขอเชื่อมกับตัวเอง
create or replace view public.my_carers as
  select l.id, l.member_id, l.carer_id, l.relationship, l.status,
         l.permissions, l.notify_types, l.requested_at, l.decided_at,
         p.display_name as carer_name
  from public.caregiver_links l
  join public.profiles p on p.id = l.carer_id
  where l.member_id = auth.uid();

-- ---------- ทริกเกอร์แจ้งเตือน: เคารพชั้นที่ 1 เป็นรายหัวข้อ ----------
create or replace function public.notify_family_on_risk()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  lv_nm text; flags_txt text; has_fall boolean; has_adl boolean; prev_level text;
begin
  lv_nm := case new.level::text when 'urgent' then 'ต้องดูแลเร่งด่วน'
                                when 'decline' then 'มีการถดถอย'
                                when 'watch'   then 'ควรเฝ้าสังเกต'
                                else 'คงที่' end;
  flags_txt := coalesce(new.flags::text, '');
  has_fall  := flags_txt like '%"R3"%';                      -- กฎหกล้มใหม่
  has_adl   := flags_txt like '%"R6"%' or flags_txt like '%"R9"%';  -- ADL/บาร์เธลลด

  select r.level::text into prev_level from risk_signals r
   where r.user_id = new.user_id and r.id <> new.id
   order by r.created_at desc limit 1;

  insert into family_notifications (member_id, carer_id, kind, topic, body)
  select new.user_id, l.carer_id, 'risk', 'status_change',
         'สถานะเปลี่ยนเป็น: ' || lv_nm
  from caregiver_links l
  where l.member_id = new.user_id and l.status = 'approved'
    and coalesce(l.permissions->>'alerts','false') = 'true'
    and coalesce(l.notify_types->>'status_change','false') = 'true'
    and prev_level is not null and prev_level <> new.level::text;

  insert into family_notifications (member_id, carer_id, kind, topic, body)
  select new.user_id, l.carer_id, 'risk', 'orange_red',
         'ผลประเมินล่าสุดอยู่ในระดับ ' || lv_nm || ' — ควรติดต่อหรือแวะเยี่ยม'
  from caregiver_links l
  where l.member_id = new.user_id and l.status = 'approved'
    and coalesce(l.permissions->>'alerts','false') = 'true'
    and coalesce(l.notify_types->>'orange_red','false') = 'true'
    and new.level::text in ('decline','urgent');

  insert into family_notifications (member_id, carer_id, kind, topic, body)
  select new.user_id, l.carer_id, 'risk', 'new_fall',
         'ระบบพบการหกล้มครั้งใหม่จากการประเมินล่าสุด'
  from caregiver_links l
  where l.member_id = new.user_id and l.status = 'approved'
    and coalesce(l.permissions->>'alerts','false') = 'true'
    and coalesce(l.notify_types->>'new_fall','false') = 'true'
    and has_fall;

  insert into family_notifications (member_id, carer_id, kind, topic, body)
  select new.user_id, l.carer_id, 'risk', 'adl_drop',
         'ความสามารถทำกิจวัตรประจำวันลดลงจากครั้งก่อน'
  from caregiver_links l
  where l.member_id = new.user_id and l.status = 'approved'
    and coalesce(l.permissions->>'alerts','false') = 'true'
    and coalesce(l.notify_types->>'adl_drop','false') = 'true'
    and has_adl;

  insert into family_notifications (member_id, carer_id, kind, topic, body)
  select new.user_id, l.carer_id, 'due', 'due_reminder',
         'ควรประเมินซ้ำภายใน ' || coalesce(new.next_days, 90) || ' วัน'
  from caregiver_links l
  where l.member_id = new.user_id and l.status = 'approved'
    and coalesce(l.permissions->>'alerts','false') = 'true'
    and coalesce(l.notify_types->>'due_reminder','false') = 'true';

  return new;
end $$;

create or replace function public.notify_family_on_referral()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status = 'approved' and old.status = 'pending' then
    insert into family_notifications (member_id, carer_id, kind, topic, body)
    select new.user_id, l.carer_id, 'cm', 'status_change',
           'ทีมดูแล (Care Manager) รับเคสแล้ว และจะติดต่อดูแลตามขั้นตอน'
    from caregiver_links l
    where l.member_id = new.user_id and l.status = 'approved'
      and coalesce(l.permissions->>'alerts','false') = 'true'
      and coalesce(l.notify_types->>'status_change','false') = 'true';
  end if;
  return new;
end $$;
