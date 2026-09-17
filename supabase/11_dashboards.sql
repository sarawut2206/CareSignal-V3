-- ============================================================
-- 11_dashboards.sql — แยกสองแดชบอร์ดให้ขาดจากกัน
-- ------------------------------------------------------------
-- Care Manager  = "วันนี้ต้องทำอะไรกับใคร"  → ข้อมูลรายบุคคลเท่าที่จำเป็น
-- บริษัทประกัน  = "พอร์ตเสี่ยงตรงไหน โปรแกรมได้ผลไหม" → ภาพรวมล้วน
--
-- การเปลี่ยนที่สำคัญที่สุดในไฟล์นี้
--   insurer_portfolio เดิมส่ง "แถวรายบุคคล" พร้อมคะแนนและเวลาลุกนั่ง
--   ให้บริษัทประกัน ซึ่งเกินความจำเป็นตามหลัก data minimization
--   ต่อให้แฝงชื่อแล้วก็ยังเป็นข้อมูลสุขภาพรายบุคคลตาม PDPA
--   รุ่นนี้ตัดค่ารายคนออก เหลือเฉพาะสิ่งที่ใช้บริหารพอร์ตจริง
--   และเพิ่มการกดเซลล์เล็ก (n < 10) กันการระบุตัวบุคคลทางอ้อม
-- ============================================================

-- ---------- จำนวนขั้นต่ำต่อกลุ่มก่อนแสดงผล ----------
create or replace function public.cs_min_cell() returns int
language sql immutable as $$ select 10 $$;

-- ============================================================
-- ส่วนที่ 1 — Care Manager
-- ============================================================

-- ---------- บันทึกการติดต่อ (contact log) ----------
create table if not exists public.contact_log (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid references public.care_cases(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  by_staff   uuid references public.profiles(id),
  channel    text,      -- phone | line | visit | family
  result     text not null,  -- reached | no_answer | refused | family_confirmed | booked | referred_ok | new_event
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists contact_log_case_idx on public.contact_log(case_id, created_at desc);

alter table public.contact_log enable row level security;
drop policy if exists clog_staff on public.contact_log;
drop policy if exists clog_own on public.contact_log;
create policy clog_staff on public.contact_log
  for all using (cs_is_staff()) with check (cs_is_staff());
create policy clog_own on public.contact_log
  for select using (user_id = auth.uid());

-- ---------- เคส: เจ้าของงาน · งานถัดไป · กำหนดวัน · ติดต่อไม่ได้กี่ครั้ง ----------
alter table public.care_cases
  add column if not exists next_action  text,
  add column if not exists due_at       timestamptz,
  add column if not exists attempts     int not null default 0,
  add column if not exists unreachable  boolean not null default false;

-- ตั้งกำหนดติดต่อครั้งแรกจาก SLA ตอนเปิดเคส
update public.care_cases set due_at = opened_at + (sla_hours || ' hours')::interval
 where due_at is null;

create or replace function public.set_case_due()
returns trigger language plpgsql as $$
begin
  if new.due_at is null then
    new.due_at := new.opened_at + (new.sla_hours || ' hours')::interval;
  end if;
  return new;
end $$;
drop trigger if exists trg_case_due on public.care_cases;
create trigger trg_case_due before insert on public.care_cases
  for each row execute function public.set_case_due();

-- ---------- คิวงานของ Care Manager ----------
-- รวมทุกอย่างที่ต้องใช้ตัดสินใจไว้ในแถวเดียว เพื่อไม่ต้องยิงหลายคำสั่งบนมือถือ
create or replace view public.cm_worklist as
select
  c.id, c.user_id, c.level, c.status, c.signals, c.opened_at, c.due_at,
  c.contacted_at, c.attempts, c.unreachable, c.next_action, c.assigned_to,
  c.sla_hours,
  p.pseudonym, p.display_name, p.phone, p.birth_year_be, p.sex,
  p.carer_phone, p.province,
  (extract(year from now())::int + 543) - p.birth_year_be              as age,
  (c.contacted_at is null and now() > c.due_at)                        as overdue,
  (select count(*) from public.referrals r
     where r.user_id = c.user_id
       and r.status in ('pending','recommended','approved','acknowledged'))  as ref_open,
  (select count(*) from public.med_reviews mr
     where mr.user_id = c.user_id and mr.status = 'pending')           as med_review_open,
  (select count(*) from public.follow_ups f
     where f.user_id = c.user_id and f.status = 'pending' and f.due_at <= now()) as fu_due,
  (select max(e.created_at) from public.care_events e
     where e.user_id = c.user_id)                                      as last_event_at,
  /* ลำดับความสำคัญ: แดงก่อน → เกินกำหนด → ใกล้ครบ → ติดต่อไม่ได้ท้ายสุด */
  (case c.level when 'urgent' then 0 when 'decline' then 1 when 'watch' then 2 else 3 end * 1000
   + case when c.contacted_at is null and now() > c.due_at then 0 else 100 end
   + case when c.unreachable then 50 else 0 end
   + least(99, greatest(0, extract(epoch from (c.due_at - now()))/3600))::int
  )                                                                    as priority
from public.care_cases c
join public.profiles p on p.id = c.user_id
where c.status not in ('stable','closed')
  and public.cs_is_staff();

comment on view public.cm_worklist is
  'คิวงานของ Care Manager — ข้อมูลรายบุคคลเท่าที่จำเป็นต่อการติดต่อและตัดสินใจ · เปิดเฉพาะบทบาทเจ้าหน้าที่ดูแล (ไม่รวมบริษัทประกัน)';

-- ============================================================
-- ส่วนที่ 2 — บริษัทประกัน (ภาพรวมล้วน)
-- ============================================================

-- ---------- ปิดช่องข้อมูลรายบุคคล ----------
-- เดิม view นี้ส่งคะแนนและเวลาลุกนั่งรายคน — เกินความจำเป็น
-- รุ่นใหม่เหลือเฉพาะระดับความเสี่ยงและความสม่ำเสมอของการติดตาม
-- ซึ่งเป็นสิ่งที่ใช้บริหารพอร์ตได้จริงโดยไม่ต้องรู้ค่าทางคลินิกรายคน
drop view if exists public.insurer_portfolio;
create or replace view public.insurer_portfolio as
select
  p.pseudonym,
  public.cs_age_band(p.birth_year_be)                                                    as age_band,
  p.sex,
  r.level                                                as risk_level,
  (select count(*) from public.assessments x where x.user_id = p.id) as n_assessments,
  date_trunc('month', a.assessed_at)                     as last_assessed_month,
  (a.assessed_at > now() - interval '90 days')           as active_monitored
from public.profiles p
join lateral (
  select * from public.assessments a2
  where a2.user_id = p.id order by a2.assessed_at desc limit 1
) a on true
left join lateral (
  select * from public.risk_signals r2
  where r2.user_id = p.id order by r2.created_at desc limit 1
) r on true
where p.role = 'user' and p.share_pool = true
  and public.cs_role() in ('insurer','care_manager','admin');

comment on view public.insurer_portfolio is
  'มุมมองบริษัทประกัน — เหลือเฉพาะระดับความเสี่ยงและความต่อเนื่องของการติดตาม · ไม่มีคะแนน ไม่มีเวลาลุกนั่ง ไม่มีวันที่ละเอียด ตามหลัก data minimization';

-- ---------- กรวยประชากร (denominator ชัดเจน) ----------
create or replace view public.insurer_funnel as
select
  (select count(*) from public.profiles where role='user')                       as eligible,
  (select count(*) from public.profiles where role='user' and share_pool)        as enrolled,
  (select count(distinct a.user_id) from public.assessments a
     join public.profiles p on p.id=a.user_id where p.share_pool)                as assessed,
  (select count(distinct a.user_id) from public.assessments a
     join public.profiles p on p.id=a.user_id
     where p.share_pool and a.assessed_at > now() - interval '90 days')          as active_monitored,
  (select count(distinct a.user_id) from public.assessments a
     join public.profiles p on p.id=a.user_id
     where p.share_pool and a.assessed_at > now() - interval '30 days')          as active_30d
where public.cs_role() in ('insurer','care_manager','admin');

-- ---------- การกระจายความเสี่ยงแยกกลุ่ม (กดเซลล์เล็ก) ----------
-- กลุ่มที่มีสมาชิกน้อยกว่าเกณฑ์จะไม่แสดงตัวเลข เพื่อกันการระบุตัวทางอ้อม
create or replace view public.insurer_strata as
with mem as (
  select p.id, p.sex, p.province,
    public.cs_age_band(p.birth_year_be) as age_band
  from public.profiles p where p.role='user' and p.share_pool
),
lv as (
  select distinct on (r.user_id) r.user_id, r.level
  from public.risk_signals r join mem m on m.id=r.user_id
  order by r.user_id, r.created_at desc
),
g as (
  select 'age' as dim, m.age_band as bucket, count(*) n,
         count(*) filter (where l.level='stable')  green,
         count(*) filter (where l.level='watch')   yellow,
         count(*) filter (where l.level in ('decline','urgent')) red
  from mem m left join lv l on l.user_id=m.id group by m.age_band
  union all
  select 'sex', coalesce(m.sex::text,'—'), count(*),
         count(*) filter (where l.level='stable'),
         count(*) filter (where l.level='watch'),
         count(*) filter (where l.level in ('decline','urgent'))
  from mem m left join lv l on l.user_id=m.id group by m.sex
  union all
  select 'province', coalesce(m.province,'ไม่ระบุ'), count(*),
         count(*) filter (where l.level='stable'),
         count(*) filter (where l.level='watch'),
         count(*) filter (where l.level in ('decline','urgent'))
  from mem m left join lv l on l.user_id=m.id group by m.province
)
select dim, bucket, n,
  case when n >= public.cs_min_cell() then green  end as green,
  case when n >= public.cs_min_cell() then yellow end as yellow,
  case when n >= public.cs_min_cell() then red    end as red,
  (n < public.cs_min_cell())                          as suppressed
from g
where public.cs_role() in ('insurer','care_manager','admin');

comment on view public.insurer_strata is
  'การกระจายความเสี่ยงแยกกลุ่ม — กลุ่มที่มีสมาชิกน้อยกว่าเกณฑ์ขั้นต่ำจะถูกกดตัวเลขไว้ (suppressed) เพื่อป้องกันการระบุตัวบุคคลทางอ้อม';

-- ---------- สัดส่วนชนิดสัญญาณ (ใช้เลือกลงทุน intervention) ----------
create or replace view public.insurer_signals as
with sig as (
  select jsonb_array_elements(coalesce(r.signals,'[]'::jsonb))->>'k' as k
  from public.risk_signals r
  join public.profiles p on p.id=r.user_id and p.share_pool
  where r.created_at > now() - interval '365 days'
)
select k as signal, count(*) as n,
       round(100.0*count(*)/nullif(sum(count(*)) over (),0),1) as pct
from sig where k is not null group by k
having public.cs_role() in ('insurer','care_manager','admin')
order by count(*) desc;

-- ---------- เพิ่มตัวชี้วัดการดูแลใน insurer_outcomes ----------
drop view if exists public.insurer_outcomes;
create or replace view public.insurer_outcomes as
with mem as (select id from public.profiles where role='user' and share_pool = true),
latest as (
  select distinct on (r.user_id) r.user_id, r.level, r.created_at
  from public.risk_signals r join mem m on m.id=r.user_id
  order by r.user_id, r.created_at desc),
prev as (
  select user_id, level from (
    select r.user_id, r.level, row_number() over (partition by r.user_id order by r.created_at desc) rn
    from public.risk_signals r join mem m on m.id=r.user_id) t where rn=2),
ord as (
  select l.user_id,
    case l.level when 'stable' then 0 when 'watch' then 1 when 'decline' then 2 else 3 end now_o,
    case p.level when 'stable' then 0 when 'watch' then 1 when 'decline' then 2 else 3 end prev_o
  from latest l join prev p on p.user_id=l.user_id),
expo as (
  select coalesce(sum(extract(epoch from (now()-f.first_at))/31557600.0),0) person_years
  from (select a.user_id, min(a.assessed_at) first_at from public.assessments a
        join mem m on m.id=a.user_id group by a.user_id) f),
cs as (select c.* from public.care_cases c join mem m on m.id=c.user_id)
select
  (select count(*) from mem)                                                     as n_members,
  (select count(*) from public.assessments a join mem m on m.id=a.user_id)       as n_assessments,
  (select count(*) from public.assessments a join mem m on m.id=a.user_id
     where a.assessed_at > now()-interval '30 days')                             as n_assessed_30d,
  (select count(distinct a.user_id) from public.assessments a join mem m on m.id=a.user_id
     where a.assessed_at > now()-interval '30 days')                             as n_active_30d,
  (select count(distinct a.user_id) from public.assessments a join mem m on m.id=a.user_id) as n_ever_assessed,
  (select count(*) from public.assessments a join mem m on m.id=a.user_id
     where coalesce(a.not_tested,false))                                         as n_not_tested,
  round((select person_years from expo)::numeric,2)                              as person_years,
  (select count(*) from latest where level='stable')                             as lv_stable,
  (select count(*) from latest where level='watch')                              as lv_watch,
  (select count(*) from latest where level='decline')                            as lv_decline,
  (select count(*) from latest where level='urgent')                             as lv_urgent,
  (select count(*) from ord where now_o<prev_o)                                  as n_improved,
  (select count(*) from ord where now_o>prev_o)                                  as n_worsened,
  (select count(*) from ord)                                                     as n_comparable,
  (select count(*) from cs)                                                      as case_total,
  (select count(*) from cs where status='new')                                   as case_new,
  (select count(*) from cs where status not in ('new','stable','closed'))        as case_working,
  (select count(*) from cs where status in ('stable','closed'))                  as case_closed,
  (select count(*) from cs where status='stable')                                as case_stable,
  (select count(*) from cs where contacted_at is not null)                       as case_contacted,
  (select count(*) from cs where contacted_at is not null
     and contacted_at <= opened_at + (sla_hours||' hours')::interval)            as case_contacted_in_sla,
  (select count(*) from cs where status not in ('stable','closed')
     and now() > opened_at + (sla_hours||' hours')::interval
     and contacted_at is null)                                                   as case_overdue,
  (select count(*) from cs where unreachable)                                    as case_unreachable,
  /* เคสที่เคยปิดแล้วกลับมาเปิดใหม่ = re-escalation */
  (select count(*) from (select user_id from cs group by user_id having count(*)>1) x) as case_reescalated,
  (select count(*) from public.care_plans c join mem m on m.id=c.user_id)        as n_plans,
  (select count(*) from public.follow_ups f join mem m on m.id=f.user_id
     where f.due_at<=now())                                                      as n_fu_due,
  (select count(*) from public.follow_ups f join mem m on m.id=f.user_id
     where f.due_at<=now() and f.status='done')                                  as n_fu_done,
  (select count(*) from public.follow_ups f join mem m on m.id=f.user_id
     where f.due_at<=now() and f.status<>'done')                                 as n_fu_open,
  (select count(*) from public.referrals r join mem m on m.id=r.user_id)         as n_ref,
  (select count(*) from public.referrals r join mem m on m.id=r.user_id
     where r.status in ('approved','acknowledged','booked','completed','outcome_recorded')) as n_ref_confirmed,
  (select count(*) from public.referrals r join mem m on m.id=r.user_id
     where r.booked_at is not null)                                              as n_ref_booked,
  (select count(*) from public.referrals r join mem m on m.id=r.user_id
     where r.completed_at is not null)                                           as n_ref_completed,
  (select count(*) from public.referrals r join mem m on m.id=r.user_id
     where r.outcome is not null)                                                as n_ref_outcome,
  (select count(*) from public.referrals r join mem m on m.id=r.user_id
     where r.status in ('declined','unreachable'))                               as n_ref_lost,
  /* ทบทวนยา — ตัวชี้วัดของ Medication Pipeline */
  (select count(*) from public.med_reviews v join mem m on m.id=v.user_id)       as n_medrev,
  (select count(*) from public.med_reviews v join mem m on m.id=v.user_id
     where v.status='done')                                                      as n_medrev_done,
  (select count(*) from public.med_reviews v join mem m on m.id=v.user_id
     where v.status='pending')                                                   as n_medrev_open,
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='fall' and e.created_at > now()-interval '365 days')           as ev_fall,
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='near_fall' and e.created_at > now()-interval '365 days')      as ev_near_fall,
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='hospital' and e.created_at > now()-interval '365 days')       as ev_hospital,
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='med_change' and e.created_at > now()-interval '365 days')     as ev_med_change,
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='adl_drop' and e.created_at > now()-interval '365 days')       as ev_adl_drop
where public.cs_role() in ('insurer','care_manager','admin');

comment on view public.insurer_outcomes is
  'รายงานเชิงกลุ่มสำหรับบริษัทประกัน — ประชากร ความเสี่ยง การดูแล ผลลัพธ์ · คืนค่าแถวเดียว ไม่มีข้อมูลรายบุคคล · ไม่มีตัวเลขเบี้ยหรือค่าสินไหม';
