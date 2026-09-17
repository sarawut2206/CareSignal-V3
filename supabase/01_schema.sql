-- ============================================================
-- CareSignal — Production Schema (PostgreSQL / Supabase)
-- ------------------------------------------------------------
-- หลักการที่ schema นี้บังคับใช้ในระดับฐานข้อมูล ไม่ใช่แค่ในแอป:
--   1) ไม่มีคอลัมน์ใดเก็บภาพหรือวิดีโอ — กล้องประมวลผลในเครื่องเท่านั้น
--   2) บริษัทประกันเห็นได้เฉพาะข้อมูลแฝงชื่อ (pseudonymised) ผ่าน view
--   3) ทุกการเข้าถึงข้อมูลผู้อื่นถูกบันทึกใน audit_logs
--   4) ผู้ใช้ถอนความยินยอมได้ และการถอนมีผลปิดการแชร์ทันที (PDPA ม.19)
--   5) ข้อมูลที่ผู้ใช้กรอกเองถูกทำเครื่องหมาย self-reported แยกจากที่ยืนยันแล้ว
-- ============================================================

-- ---------- ประเภทข้อมูล ----------
do $$ begin
  create type cs_role as enum ('user','care_manager','insurer','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cs_risk_level as enum ('stable','watch','decline','urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cs_referral_status as enum ('pending','approved','declined','completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cs_verification as enum ('self_reported','verified_medical_record');
exception when duplicate_object then null; end $$;

-- ============================================================
-- 1) profiles — ผูกกับ auth.users ของ Supabase
--    เก็บเฉพาะสิ่งจำเป็นต่อการให้คะแนน: ปีเกิด เดือนเกิด เพศ
--    ไม่เก็บเลขบัตรประชาชน ไม่เก็บที่อยู่
-- ============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  pseudonym     text unique not null,          -- รหัสแฝงชื่อ P-XXXXXXX ใช้แทนตัวตนในทุก dashboard
  display_name  text,                          -- ชื่อเรียก ใช้เฉพาะในแอปของเจ้าตัวและเคสที่ส่งต่อ
  phone         text,
  role          cs_role not null default 'user',
  birth_year_be int  check (birth_year_be between 2400 and 2600),
  birth_month   int  check (birth_month between 1 and 12),
  sex           text check (sex in ('m','f')),
  share_pool    boolean not null default true, -- ผู้ใช้ปิดการแชร์ข้อมูลสรุปได้เอง
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.profiles.pseudonym is
  'รหัสแฝงชื่อ — ข้อมูลแฝงชื่อยังเป็นข้อมูลส่วนบุคคลตาม PDPA ไม่ใช่ข้อมูลนิรนาม';

-- ============================================================
-- 2) consents — บันทึกความยินยอมแยกตามวัตถุประสงค์ (purpose limitation)
--    ถอนได้ทีละวัตถุประสงค์ ไม่ใช่ all-or-nothing
-- ============================================================
create table if not exists public.consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  purpose      text not null,        -- assessment | share_pool | biometric_face | medical_record_check
  version      text not null,        -- PDPA-1.0
  granted      boolean not null,
  scope        jsonb,                -- ขอบเขต เช่น {"hospital":"รพ.ก","data":["ยาประจำ"],"period":"2568-2569"}
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists consents_user_purpose_idx on public.consents(user_id, purpose);

comment on table public.consents is
  'ความยินยอมแยกตามวัตถุประสงค์ · biometric_face ต้องขอแยกตาม PDPA มาตรา 26 · medical_record_check ระบุขอบเขตรายครั้ง ไม่ใช่ใบเดียวตลอดชีพ';

-- ============================================================
-- 3) assessments — ผลการประเมิน (ไม่มีภาพ มีแต่ตัวเลข)
-- ============================================================
create table if not exists public.assessments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  assessed_at    timestamptz not null default now(),
  method         text not null,            -- camera-pose | manual
  ftsst_seconds  numeric(5,2),             -- ลุกนั่ง 5 ครั้ง
  tug_seconds    numeric(5,2),             -- ลุกเดิน 3 เมตร
  reps           int,
  cadence_cv     numeric(6,4),             -- ความแปรปรวนจังหวะ
  gaps           numeric(5,2)[],           -- เวลาต่อครั้ง
  score          int  not null,
  score_max      int  not null default 12,
  tier           int  not null check (tier between 1 and 4),
  parts          jsonb not null,           -- คะแนนรายด้าน
  -- แหล่งที่มาของคำตอบเชิงประวัติ: กรอกเอง vs ยืนยันกับเวชระเบียน
  falls_source   cs_verification not null default 'self_reported',
  meds_source    cs_verification not null default 'self_reported',
  adl_source     cs_verification not null default 'self_reported',
  identity_verified boolean not null default false,  -- ผ่าน face continuity ระหว่างทดสอบ
  engine_version text not null,
  duration_sec   int,
  created_at     timestamptz not null default now()
);
create index if not exists assessments_user_time_idx on public.assessments(user_id, assessed_at desc);

comment on column public.assessments.falls_source is
  'ค่าเริ่มต้นคือ self_reported — เปลี่ยนเป็น verified_medical_record ได้เฉพาะเมื่อมี consent purpose=medical_record_check และผ่านการตรวจสอบแล้ว';

-- ============================================================
-- 4) risk_signals — ผลของเอนจินกฎ R1–R7 (อธิบายได้ทุกข้อ)
-- ============================================================
create table if not exists public.risk_signals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  assessment_id  uuid references public.assessments(id) on delete cascade,
  level          cs_risk_level not null,
  flags          jsonb not null,      -- [{id:"R1", text:"...", why:"...", severity:2}]
  next_days      int  not null,
  engine_version text not null,
  created_at     timestamptz not null default now()
);
create index if not exists risk_signals_user_time_idx on public.risk_signals(user_id, created_at desc);

-- ============================================================
-- 5) referrals — คิวเคสส่งต่อ · AI สร้างได้ แต่ต้องมีมนุษย์อนุมัติ
-- ============================================================
create table if not exists public.referrals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  risk_signal_id uuid references public.risk_signals(id) on delete set null,
  level          cs_risk_level not null,
  action         text not null,
  sla            text not null,
  reasons        jsonb not null,
  status         cs_referral_status not null default 'pending',
  decided_by     uuid references public.profiles(id),   -- ต้องเป็นมนุษย์เสมอ
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now()
);
create index if not exists referrals_status_idx on public.referrals(status, created_at desc);

comment on column public.referrals.decided_by is
  'ต้องเป็นบัญชี care_manager หรือ admin เท่านั้น — AI ไม่มีสิทธิ์อนุมัติเคสในทุกกรณี (บังคับด้วย trigger)';

-- ============================================================
-- 6) audit_logs — บันทึกทุกการกระทำที่แตะข้อมูลส่วนบุคคล
-- ============================================================
create table if not exists public.audit_logs (
  id           bigserial primary key,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_role   cs_role,
  action       text not null,          -- consent.grant | assessment.create | referral.approve | data.export ...
  subject_id   uuid,                   -- เจ้าของข้อมูลที่ถูกกระทำ
  detail       text,
  meta         jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_actor_idx   on public.audit_logs(actor_id, created_at desc);
create index if not exists audit_subject_idx on public.audit_logs(subject_id, created_at desc);

-- ============================================================
-- 7) ฟังก์ชันช่วย — อ่านบทบาทของผู้ใช้ที่ล็อกอินอยู่
--    ใช้ security definer เพื่ออ่าน profiles ได้โดยไม่วน RLS ซ้ำ
-- ============================================================
create or replace function public.cs_role()
returns cs_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.cs_is_staff()
returns boolean
language sql
stable
as $$
  select public.cs_role() in ('care_manager','admin')
$$;

-- ============================================================
-- 8) view สำหรับบริษัทประกัน — เห็นเฉพาะข้อมูลแฝงชื่อ
--    ไม่มีชื่อ ไม่มีเบอร์โทร ไม่มีวันเกิดแบบละเอียด (ให้เป็นช่วงอายุ)
--    view นี้ทำงานด้วยสิทธิ์ owner จึงต้องมีการ์ดตรวจบทบาทใน WHERE เอง
-- ============================================================
create or replace view public.insurer_portfolio as
select
  p.pseudonym,
  public.cs_age_band(p.birth_year_be)                                              as age_band,
  p.sex,
  a.tier,
  a.score,
  a.ftsst_seconds,
  a.method,
  a.identity_verified,
  r.level                                          as risk_level,
  (select count(*) from public.assessments x where x.user_id = p.id) as n_assessments,
  a.assessed_at                                    as last_assessed_at
from public.profiles p
join lateral (
  select * from public.assessments a2
  where a2.user_id = p.id order by a2.assessed_at desc limit 1
) a on true
left join lateral (
  select * from public.risk_signals r2
  where r2.user_id = p.id order by r2.created_at desc limit 1
) r on true
where p.role = 'user'
  and p.share_pool = true
  -- การ์ดบทบาท: เฉพาะเจ้าหน้าที่เท่านั้นที่เห็นพอร์ต ผู้ใช้ทั่วไปได้ผลลัพธ์ว่างเปล่า
  and public.cs_role() in ('insurer','care_manager','admin');

comment on view public.insurer_portfolio is
  'มุมมองสำหรับบริษัทประกัน — ข้อมูลแฝงชื่อตามหลัก data minimization · ไม่มีชื่อ เบอร์โทร หรือวันเกิดละเอียด · แสดงเฉพาะผู้ที่เปิด share_pool';
