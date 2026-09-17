-- ============================================================
-- CareSignal — ส่วนขยาย: ข้อมูลนำร่อง + การตรวจสอบเวชระเบียน
-- ------------------------------------------------------------
-- รันหลัง 01_schema.sql และ 02_rls.sql
--
-- เพิ่ม 2 ระบบ:
--   1) validation_trials  — ข้อมูลตรวจสอบความแม่นยำเครื่องมือวัด (pilot)
--   2) mrv_requests       — คำขอตรวจสอบข้อมูลกับเวชระเบียน (ขอบเขตรายครั้ง)
--
-- หลักการสำคัญ: ไม่มีตารางใดเก็บลายเซ็นใบหน้าหรือข้อมูลชีวมิติ
-- ลายเซ็นใบหน้าอยู่ในเครื่องผู้ใช้เท่านั้น ระบบกลางเก็บเพียง
-- ผลการยืนยัน (identity_verified) ซึ่งเป็นค่าจริง/เท็จ
-- ============================================================

-- ============================================================
-- 1) validation_trials — ตรวจสอบความแม่นยำของเครื่องมือวัด
--    เก็บ "รหัสผู้เข้าร่วม" (P01, P02) ไม่ใช่ชื่อจริง
--    ผู้เข้าร่วมนำร่องไม่ต้องมีบัญชีในระบบ นักวิจัยเป็นผู้บันทึกแทน
-- ============================================================
create table if not exists public.validation_trials (
  id               uuid primary key default gen_random_uuid(),
  researcher_id    uuid not null references public.profiles(id) on delete cascade,
  site             text,                    -- ชื่อสถานที่เก็บข้อมูล เช่น "รพ.สต.ก"
  participant_code text not null,           -- P01, P02 — ไม่ใช่ชื่อจริง
  trial_no         int  not null default 1,
  method           text,
  cs_seconds       numeric(6,2),            -- เวลาที่ระบบวัดได้
  ref1_seconds     numeric(6,2),            -- ผู้จับเวลาคนที่ 1
  ref2_seconds     numeric(6,2),            -- ผู้จับเวลาคนที่ 2
  reps             int,
  reps_correct     boolean,
  cadence_cv       numeric(6,4),
  gaps             numeric(6,2)[],
  sit_ref          numeric(8,4),
  stand_ref        numeric(8,4),
  setup_sec        int,
  tech_fail        boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now()
);
create index if not exists vt_researcher_idx  on public.validation_trials(researcher_id, created_at desc);
create index if not exists vt_participant_idx on public.validation_trials(participant_code);

comment on table public.validation_trials is
  'ข้อมูลตรวจสอบความแม่นยำเครื่องมือวัด (Preliminary Technical Validation) — ไม่ใช่ Clinical Validation · ใช้รหัสผู้เข้าร่วมแทนชื่อจริง';

alter table public.validation_trials enable row level security;

drop policy if exists vt_own on public.validation_trials;
create policy vt_own on public.validation_trials
  for all using (researcher_id = auth.uid() or public.cs_role() = 'admin')
          with check (researcher_id = auth.uid());

-- ============================================================
-- 2) mrv_requests — คำขอตรวจสอบกับเวชระเบียน
--    ขอบเขตรายครั้ง: ระบุโรงพยาบาล ข้อมูลที่ขอ และช่วงเวลา
--    ไม่ใช่ใบเดียวเปิดประตูทุกโรงพยาบาลตลอดชีพ
-- ============================================================
do $$ begin
  create type cs_mrv_status as enum ('pending','sent','completed','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.mrv_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  consent_id     uuid references public.consents(id) on delete set null,
  assessment_id  uuid references public.assessments(id) on delete set null,
  hospital       text not null,
  data_items     text[] not null,           -- {'ประวัติหกล้ม','ยาประจำ'}
  period         text not null,             -- '2568-2569'
  purpose        text not null,             -- underwriting | claim | risk_monitoring
  status         cs_mrv_status not null default 'pending',
  outcome        jsonb,                     -- {"falls":"confirmed","meds":"mismatch"}
  handled_by     uuid references public.profiles(id),
  requested_at   timestamptz not null default now(),
  completed_at   timestamptz
);
create index if not exists mrv_user_idx   on public.mrv_requests(user_id, requested_at desc);
create index if not exists mrv_status_idx on public.mrv_requests(status, requested_at desc);

comment on table public.mrv_requests is
  'คำขอตรวจสอบกับเวชระเบียน — ต้องมีความยินยอม purpose=medical_record_check ที่ยังไม่ถูกถอน และมีขอบเขตเฉพาะครั้ง';

alter table public.mrv_requests enable row level security;

drop policy if exists mrv_select on public.mrv_requests;
create policy mrv_select on public.mrv_requests
  for select using (user_id = auth.uid() or public.cs_is_staff());

drop policy if exists mrv_insert_own on public.mrv_requests;
create policy mrv_insert_own on public.mrv_requests
  for insert with check (user_id = auth.uid());

-- ผู้ใช้ยกเลิกคำขอของตัวเองได้ · เจ้าหน้าที่อัปเดตสถานะและผลได้
drop policy if exists mrv_update on public.mrv_requests;
create policy mrv_update on public.mrv_requests
  for update using (user_id = auth.uid() or public.cs_is_staff())
             with check (user_id = auth.uid() or public.cs_is_staff());

-- ============================================================
-- 3) การ์ด: สร้างคำขอตรวจเวชระเบียนได้เฉพาะเมื่อมีความยินยอมที่ยังไม่ถูกถอน
--    บังคับที่ฐานข้อมูล ไม่ใช่แค่ตรวจในแอป
-- ============================================================
create or replace function public.guard_mrv_consent()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.consents c
   where c.user_id = new.user_id
     and c.purpose = 'medical_record_check'
     and c.granted = true
     and c.revoked_at is null;
  if n = 0 then
    raise exception 'ไม่มีความยินยอมให้ตรวจสอบเวชระเบียน หรือความยินยอมถูกถอนแล้ว';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_mrv on public.mrv_requests;
create trigger trg_guard_mrv before insert on public.mrv_requests
  for each row execute function public.guard_mrv_consent();

-- ============================================================
-- 4) เมื่อการตรวจสอบเสร็จ ให้ปรับธงแหล่งข้อมูลของผลประเมินที่เกี่ยวข้อง
--    เปลี่ยนจาก self_reported เป็น verified_medical_record ได้เฉพาะทางนี้
-- ============================================================
create or replace function public.apply_mrv_outcome()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed')
     and new.assessment_id is not null and new.outcome is not null then
    update public.assessments a set
      falls_source = case when new.outcome->>'falls' = 'confirmed'
                          then 'verified_medical_record'::cs_verification else a.falls_source end,
      meds_source  = case when new.outcome->>'meds'  = 'confirmed'
                          then 'verified_medical_record'::cs_verification else a.meds_source  end,
      adl_source   = case when new.outcome->>'adl'   = 'confirmed'
                          then 'verified_medical_record'::cs_verification else a.adl_source   end
    where a.id = new.assessment_id;
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_apply_mrv on public.mrv_requests;
create trigger trg_apply_mrv before update on public.mrv_requests
  for each row execute function public.apply_mrv_outcome();

-- ============================================================
-- 5) ถอนความยินยอม medical_record_check → ยกเลิกคำขอที่ยังค้างอยู่ทันที
-- ============================================================
create or replace function public.cancel_mrv_on_revoke()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.purpose = 'medical_record_check' and new.revoked_at is not null and old.revoked_at is null then
    update public.mrv_requests
       set status = 'cancelled'
     where user_id = new.user_id and status in ('pending','sent');
  end if;
  return new;
end $$;

drop trigger if exists trg_cancel_mrv on public.consents;
create trigger trg_cancel_mrv after update on public.consents
  for each row execute function public.cancel_mrv_on_revoke();
