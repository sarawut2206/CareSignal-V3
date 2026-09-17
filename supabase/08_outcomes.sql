-- ============================================================
-- 08_outcomes.sql — ชั้นวัดผล (ขั้นสุดท้ายของวงจรปิด)
-- ------------------------------------------------------------
-- คัดกรอง → จัดระดับ → แผนป้องกัน → ติดตาม → ส่งต่อ → [วัดผล]
--
-- หลักการออกแบบ 2 ข้อที่ยึดไว้ตลอด
--   1. บริษัทประกันเห็น "รายงานเชิงกลุ่ม" เป็นค่าเริ่มต้น
--      view นี้คืนค่าเป็นตัวเลขรวมแถวเดียว ไม่มี user_id ไม่มีรายบุคคล
--      ต่อให้ query ตรงก็ไล่กลับไปหาตัวบุคคลไม่ได้
--   2. คืนเฉพาะตัวเลขที่ "วัดได้จริงจากฐานข้อมูล"
--      ตัวเลขทางการเงิน (ค่าสินไหม · ROI) ไม่อยู่ในนี้ เพราะระบบยังไม่มี
--      ข้อมูลเคลม การเอาไปคำนวณต่อจึงเป็นการ "จำลอง" ซึ่งต้องแสดงผล
--      แยกส่วนและติดป้ายกำกับให้ชัดที่หน้าจอ ไม่ปนกับผลจริง
-- ============================================================

drop view if exists public.insurer_outcomes;
create or replace view public.insurer_outcomes as
with mem as (
  select id from public.profiles where role = 'user' and share_pool = true
),
latest as (   -- ระดับล่าสุดของแต่ละคน
  select distinct on (r.user_id) r.user_id, r.level, r.created_at
  from public.risk_signals r join mem m on m.id = r.user_id
  order by r.user_id, r.created_at desc
),
prev as (     -- ระดับก่อนหน้า ไว้ดูว่าดีขึ้นหรือแย่ลง
  select user_id, level from (
    select r.user_id, r.level, row_number() over (partition by r.user_id order by r.created_at desc) rn
    from public.risk_signals r join mem m on m.id = r.user_id
  ) t where rn = 2
),
ord as (      -- แปลงระดับเป็นลำดับ เพื่อเทียบว่าดีขึ้น/แย่ลง
  select l.user_id,
    case l.level when 'stable' then 0 when 'watch' then 1 when 'decline' then 2 else 3 end as now_o,
    case p.level when 'stable' then 0 when 'watch' then 1 when 'decline' then 2 else 3 end as prev_o
  from latest l join prev p on p.user_id = l.user_id
),
expo as (     -- คน-ปีในโปรแกรม ใช้เป็นตัวหารของอัตราต่อ 100 คน-ปี
  select coalesce(sum(extract(epoch from (now() - f.first_at)) / 31557600.0), 0) as person_years
  from (select a.user_id, min(a.assessed_at) first_at
        from public.assessments a join mem m on m.id = a.user_id group by a.user_id) f
)
select
  -- ---------- ความครอบคลุมของโปรแกรม ----------
  (select count(*) from mem)                                                        as n_members,
  (select count(*) from public.assessments a join mem m on m.id=a.user_id)          as n_assessments,
  (select count(*) from public.assessments a join mem m on m.id=a.user_id
     where a.assessed_at > now() - interval '30 days')                              as n_assessed_30d,
  -- นับ "จำนวนคน" แยกจาก "จำนวนครั้ง" เพราะคนเดียวประเมินซ้ำได้หลายครั้ง
  -- ถ้าเอาจำนวนครั้งไปหารด้วยจำนวนสมาชิกจะได้ค่าเกิน 100% ซึ่งอ่านแล้วเข้าใจผิด
  (select count(distinct a.user_id) from public.assessments a join mem m on m.id=a.user_id
     where a.assessed_at > now() - interval '30 days')                              as n_active_30d,
  (select count(*) from public.assessments a join mem m on m.id=a.user_id
     where coalesce(a.not_tested,false))                                            as n_not_tested,
  round((select person_years from expo)::numeric, 2)                                as person_years,

  -- ---------- การกระจายความเสี่ยงล่าสุด ----------
  (select count(*) from latest where level='stable')                                as lv_stable,
  (select count(*) from latest where level='watch')                                 as lv_watch,
  (select count(*) from latest where level='decline')                               as lv_decline,
  (select count(*) from latest where level='urgent')                                as lv_urgent,
  (select count(*) from ord where now_o < prev_o)                                   as n_improved,
  (select count(*) from ord where now_o > prev_o)                                   as n_worsened,
  (select count(*) from ord)                                                        as n_comparable,

  -- ---------- แผนป้องกันและการติดตาม ----------
  (select count(*) from public.care_plans c join mem m on m.id=c.user_id)           as n_plans,
  (select count(*) from public.follow_ups f join mem m on m.id=f.user_id
     where f.due_at <= now())                                                       as n_fu_due,
  (select count(*) from public.follow_ups f join mem m on m.id=f.user_id
     where f.due_at <= now() and f.status='done')                                   as n_fu_done,
  (select count(*) from public.follow_ups f join mem m on m.id=f.user_id
     where f.due_at <= now() and f.status<>'done')                                  as n_fu_open,

  -- ---------- การส่งต่อ ----------
  (select count(*) from public.referrals r join mem m on m.id=r.user_id)            as n_ref,
  (select count(*) from public.referrals r join mem m on m.id=r.user_id
     where r.status in ('approved','completed'))                                   as n_ref_confirmed,
  (select count(*) from public.referrals r join mem m on m.id=r.user_id
     where r.completed_at is not null)                                              as n_ref_completed,

  -- ---------- เหตุการณ์ที่รายงานเข้ามาใน 12 เดือน ----------
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='fall'      and e.created_at > now() - interval '365 days')       as ev_fall,
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='near_fall' and e.created_at > now() - interval '365 days')       as ev_near_fall,
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='hospital'  and e.created_at > now() - interval '365 days')       as ev_hospital,
  (select count(*) from public.care_events e join mem m on m.id=e.user_id
     where e.kind='med_change' and e.created_at > now() - interval '365 days')      as ev_med_change
where public.cs_role() in ('insurer','care_manager','admin');

comment on view public.insurer_outcomes is
  'รายงานเชิงกลุ่มสำหรับชั้นวัดผล — คืนค่าเป็นตัวเลขรวมแถวเดียว ไม่มีข้อมูลรายบุคคล · เปิดเฉพาะบทบาทเจ้าหน้าที่ · ไม่มีตัวเลขค่าสินไหมเพราะระบบยังไม่มีข้อมูลเคลม';
