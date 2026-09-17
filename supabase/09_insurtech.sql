-- ============================================================
-- 09_insurtech.sql — Pre-claim workflow + Care coordination
-- ------------------------------------------------------------
-- ทำให้สายงานต่อกันจริงตั้งแต่ต้นจนจบ ไม่ใช่แค่เปลี่ยนสีบนหน้าจอ
--
--   ข้อมูลดิจิทัล → สัญญาณเสี่ยงตามเวลา → เปิดเคสก่อนเกิดการเคลม
--   → ประสานการดูแล → วัดผลลัพธ์ → ภาพรวมพอร์ต
--
-- หลักที่ยึด
--   * "สัญญาณ" ต้องสร้าง "งาน" ไม่ใช่แค่ป้ายสี — เคสจึงเปิดอัตโนมัติ
--     ด้วยทริกเกอร์ในฐานข้อมูล ไม่ฝากไว้กับโค้ดหน้าจอซึ่งข้ามได้
--   * การส่งต่อต้องตามได้ว่า "ไปถึงปลายทางจริงไหม" จึงมีสถานะครบ
--     ตั้งแต่แนะนำ จนถึงบันทึกผลลัพธ์
--   * ระบบนี้ไม่วินิจฉัยโรค ไม่สั่งหยุดยา ไม่ตัดสินการเคลม
--     และไม่คำนวณเบี้ย — ทุกการตัดสินใจทางคลินิกเป็นของมนุษย์
-- ============================================================

-- ---------- สถานะเคส (pre-claim workflow) ----------
do $$ begin
  create type cs_case_status as enum (
    'new',            -- เพิ่งเปิดจากสัญญาณ ยังไม่มีคนรับ
    'reviewing',      -- เจ้าหน้าที่รับเคสแล้ว กำลังทบทวน
    'contacted',      -- ติดต่อผู้เอาประกัน/ครอบครัวได้แล้ว
    'referred',       -- ส่งต่อผู้เชี่ยวชาญแล้ว
    'intervention',   -- อยู่ระหว่างการดูแล/แก้ไข
    'follow_up_due',  -- ถึงกำหนดติดตามผล
    'stable',         -- ดีขึ้น/คงที่ ปิดเคส
    'closed'          -- ปิดด้วยเหตุอื่น (ติดต่อไม่ได้ ปฏิเสธ ย้ายออก)
  );
exception when duplicate_object then null; end $$;

-- ---------- สถานะการส่งต่อ ให้ตามได้จนถึงผลลัพธ์ ----------
-- ของเดิมมีแค่ pending/approved/declined/completed ซึ่งบอกได้แค่ว่า
-- "พยาบาลอนุมัติหรือยัง" แต่ไม่รู้ว่าผู้เอาประกันไปถึงปลายทางหรือเปล่า
alter type cs_referral_status add value if not exists 'acknowledged';
alter type cs_referral_status add value if not exists 'booked';
alter type cs_referral_status add value if not exists 'outcome_recorded';
alter type cs_referral_status add value if not exists 'unreachable';

-- ---------- เคส ----------
create table if not exists public.care_cases (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  risk_signal_id uuid references public.risk_signals(id) on delete set null,
  level          cs_risk_level not null,
  signals        jsonb not null default '[]'::jsonb,  -- [{k:"S2",nm:"...",sev:3}]
  status         cs_case_status not null default 'new',
  assigned_to    uuid references public.profiles(id),
  sla_hours      int not null default 72,             -- เวลาที่ควรติดต่อได้ภายใน
  opened_at      timestamptz not null default now(),
  contacted_at   timestamptz,
  closed_at      timestamptz,
  close_reason   text,
  note           text,
  updated_at     timestamptz not null default now()
);
create index if not exists care_cases_status_idx on public.care_cases(status, opened_at desc);
create index if not exists care_cases_user_idx   on public.care_cases(user_id, opened_at desc);
-- เปิดได้ทีละหนึ่งเคสต่อคน: เคสที่ยังไม่ปิดต้องไม่ซ้ำ
create unique index if not exists care_cases_one_open_idx
  on public.care_cases(user_id) where status not in ('stable','closed');

-- ---------- ข้อมูลการส่งต่อที่ตามผลได้ ----------
alter table public.referrals
  add column if not exists case_id         uuid references public.care_cases(id) on delete set null,
  add column if not exists destination     text,        -- doctor | pharmacist | physio | nurse | family | community
  add column if not exists acknowledged_at timestamptz,
  add column if not exists booked_at       timestamptz,
  add column if not exists outcome         jsonb;       -- {result, note, recorded_by}

-- ---------- เปิดเคสอัตโนมัติเมื่อสัญญาณเป็นเหลือง/ส้ม/แดง ----------
-- บังคับที่ฐานข้อมูล เพื่อให้ต่อให้เข้าทางไหนก็เปิดเคสเสมอ
create or replace function public.open_case_on_signal()
returns trigger language plpgsql security definer set search_path=public as $$
declare sla int;
begin
  if new.level not in ('watch','decline','urgent') then return new; end if;
  sla := case new.level when 'urgent' then 24 when 'decline' then 48 else 72 end;

  -- มีเคสเปิดค้างอยู่แล้ว: ยกระดับความเร่งด่วนแทนการเปิดซ้ำ
  update care_cases
     set level      = new.level,
         signals    = new.flags,
         sla_hours  = least(sla_hours, sla),
         risk_signal_id = new.id,
         status     = case when status in ('stable','closed') then status
                           when new.level = 'urgent' and status = 'new' then 'new'
                           else status end,
         updated_at = now()
   where user_id = new.user_id and status not in ('stable','closed');
  if found then return new; end if;

  insert into care_cases (user_id, risk_signal_id, level, signals, sla_hours)
  values (new.user_id, new.id, new.level, new.flags, sla);
  return new;
end $$;
drop trigger if exists trg_open_case_on_signal on public.risk_signals;
create trigger trg_open_case_on_signal
  after insert on public.risk_signals
  for each row execute function public.open_case_on_signal();

-- ---------- สิทธิ์ ----------
alter table public.care_cases enable row level security;

-- เจ้าของข้อมูลเห็นเคสของตัวเอง (อ่านอย่างเดียว — สถานะเป็นงานของเจ้าหน้าที่)
drop policy if exists cases_own    on public.care_cases;
drop policy if exists cases_staff  on public.care_cases;
drop policy if exists cases_family on public.care_cases;
create policy cases_own on public.care_cases
  for select using (user_id = auth.uid());
create policy cases_staff on public.care_cases
  for all using (cs_is_staff()) with check (cs_is_staff());
create policy cases_family on public.care_cases
  for select using (
    exists (select 1 from public.caregiver_links l
            where l.member_id = care_cases.user_id and l.carer_id = auth.uid()
              and l.status='approved' and coalesce(l.permissions->>'status','false')='true')
  );

comment on table public.care_cases is
  'เคสก่อนการเคลม — เปิดอัตโนมัติจากสัญญาณเสี่ยง เพื่อให้มีคนรับผิดชอบติดตามจริง ไม่ใช่แค่เปลี่ยนสีบนหน้าจอ';
comment on type cs_case_status is
  'วงจรชีวิตของเคส: new → reviewing → contacted → referred → intervention → follow_up_due → stable/closed';

-- ---------- ภาพรวมพอร์ต: เพิ่มตัวชี้วัดเคสและการส่งต่อ ----------
-- (ดูไฟล์ 08_outcomes.sql สำหรับ view เต็ม — รุ่นนี้เพิ่มกลุ่ม care/outcome
--  case_total · case_new · case_working · case_closed · case_contacted ·
--  case_contacted_in_sla · case_overdue · n_ref_booked · n_ref_outcome · n_ref_lost
--  ทั้งหมดเป็นค่ารวมของพอร์ต ไม่มี user_id และไม่มีตัวเลขเบี้ย/ค่าสินไหม)

-- ---------- เพิ่มภายหลัง: สถานะเคสให้ครบวงจรตามที่ตกลง ----------
-- แยก "ตกลงแผนแล้ว" ออกจาก "ส่งต่อแล้ว" และแยก "นัดหมายแล้ว" ออกจาก
-- "ไปพบแล้ว" เพราะสามอย่างนี้ล้มเหลวคนละแบบและต้องวัดแยกกัน:
--   ตกลงแผนไม่ได้ = ปัญหาการสื่อสาร
--   นัดไม่ได้      = ปัญหาการเข้าถึงบริการ
--   นัดแล้วไม่ไป   = ปัญหาการเดินทางหรือแรงจูงใจ
-- ถ้ารวมเป็นสถานะเดียว จะรู้แค่ว่า "ไม่สำเร็จ" แต่แก้ไม่ถูกจุด
alter type cs_case_status add value if not exists 'care_plan_agreed'   after 'contacted';
alter type cs_case_status add value if not exists 'appointment_booked' after 'referred';
alter type cs_case_status add value if not exists 'service_completed'  after 'appointment_booked';
-- วงจรเต็ม: new → reviewing → contacted → care_plan_agreed → referred
--           → appointment_booked → service_completed → follow_up_due → stable/closed
