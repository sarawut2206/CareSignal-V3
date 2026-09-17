-- ============================================================
-- 21_insurer_trend.sql — แนวโน้มรายเดือนสำหรับแดชบอร์ดบริษัทประกัน
-- ------------------------------------------------------------
-- ปัญหาที่แก้: insurer_outcomes เป็นภาพนิ่งของ "ตอนนี้" อย่างเดียว
-- แดชบอร์ดจึงตอบไม่ได้ว่าความเสี่ยงในพอร์ตกำลังเพิ่มหรือลด และ
-- โปรแกรมเข้าถึงคนได้มากขึ้นหรือชะลอตัว ซึ่งเป็นคำถามแรกที่ผู้บริหาร
-- ของบริษัทประกันถามเมื่อเปิดหน้าจอ
--
-- ทุกแถวเป็นตัวนับระดับกลุ่มของหนึ่งเดือน ไม่มีข้อมูลรายบุคคลเลย
-- ไม่มีชื่อ ไม่มีรหัสผู้ใช้ ไม่มีคะแนนรายคน — ตรงตามหลักเดียวกับ
-- insurer_outcomes และบังคับสิทธิ์ด้วย cs_role() เหมือนกัน
--
-- เดือนที่ไม่มีข้อมูลจะยังคืนแถวที่เป็นศูนย์ เพื่อให้กราฟมีแกนเวลา
-- ต่อเนื่อง ไม่ใช่เส้นที่กระโดดข้ามช่วงที่เงียบ
-- ============================================================

create or replace view public.insurer_monthly as
with mem as (
  select id from public.profiles where role = 'user' and share_pool = true
),
months as (
  select generate_series(
           date_trunc('month', now()) - interval '11 months',
           date_trunc('month', now()),
           interval '1 month')::date as month
),
/* ลำดับครั้งที่ประเมินคิดจากประวัติทั้งหมด ไม่ใช่เฉพาะ 12 เดือน
   ไม่งั้นคนที่เริ่มก่อนหน้านั้นจะถูกนับเป็น "ประเมินครั้งแรก" ซ้ำ */
asx as (
  select date_trunc('month', a.assessed_at)::date as month,
         a.user_id,
         row_number() over (partition by a.user_id order by a.assessed_at) as rn
  from public.assessments a
  join mem m on m.id = a.user_id
),
sig as (
  select date_trunc('month', r.created_at)::date as month, r.level
  from public.risk_signals r
  join mem m on m.id = r.user_id
),
cs as (
  select date_trunc('month', c.opened_at)::date as month,
         c.opened_at, c.contacted_at, c.sla_hours
  from public.care_cases c
  join mem m on m.id = c.user_id
)
select
  mo.month,
  (select count(*)                from asx where asx.month = mo.month)                    as n_assessments,
  (select count(*)                from asx where asx.month = mo.month and asx.rn = 1)     as n_first_assessments,
  (select count(distinct user_id) from asx where asx.month = mo.month)                    as n_members_assessed,
  (select count(*) from sig where sig.month = mo.month and sig.level = 'stable')          as lv_stable,
  (select count(*) from sig where sig.month = mo.month and sig.level = 'watch')           as lv_watch,
  (select count(*) from sig where sig.month = mo.month and sig.level = 'decline')         as lv_decline,
  (select count(*) from sig where sig.month = mo.month and sig.level = 'urgent')          as lv_urgent,
  (select count(*) from cs  where cs.month  = mo.month)                                   as n_cases_opened,
  (select count(*) from cs  where cs.month  = mo.month and cs.contacted_at is not null)   as n_cases_contacted,
  (select count(*) from cs  where cs.month  = mo.month and cs.contacted_at is not null
     and cs.contacted_at <= cs.opened_at + make_interval(hours => cs.sla_hours))          as n_contacted_in_sla
from months mo
where public.cs_role() in ('insurer', 'care_manager', 'admin')
order by mo.month;

comment on view public.insurer_monthly is
  'แนวโน้มรายเดือน 12 เดือนล่าสุดสำหรับแดชบอร์ดบริษัทประกัน — การประเมิน ผู้เริ่มประเมินครั้งแรก ระดับความเสี่ยงของผลในเดือนนั้น และการเปิด/ติดต่อเคส · ตัวนับระดับกลุ่มล้วน ไม่มีข้อมูลรายบุคคล';

grant select on public.insurer_monthly to authenticated;
