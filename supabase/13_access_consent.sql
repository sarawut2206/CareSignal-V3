-- ============================================================
-- 13) ขอความยินยอมรายครั้ง + ตัวตนวิชาชีพ
-- ------------------------------------------------------------
-- รับแนวจากระบบ Health Link (BDI/depa) ซึ่งเป็นระบบแลกเปลี่ยนข้อมูล
-- สุขภาพระดับประเทศ สองเรื่องที่นำมาใช้:
--
--   1. ความยินยอม "รายครั้ง" ไม่ใช่ยินยอมครั้งเดียวใช้ตลอด
--      ผู้เชี่ยวชาญภายนอกต้องกดขอ → ผู้เอาประกันกดอนุญาตในแอป
--      → เปิดดูได้ชั่วคราว → หมดอายุเอง
--      Health Link ให้เวลาผู้ป่วยตอบ 5 นาที และให้แพทย์กด
--      "ตรวจสอบความยินยอม" เพื่ออัปเดตหน้าจอ — ใช้แบบเดียวกัน
--
--   2. ตัวตนวิชาชีพที่ตรวจสอบย้อนได้
--      Health Link ผูกกับเลขใบประกอบวิชาชีพและให้เลือกสถานพยาบาล
--      ที่กำลังปฏิบัติงาน เพราะระบบเก็บบันทึกการเข้าใช้งาน
--
-- เหตุผลที่ต่างจาก Health Link:
--   Health Link ให้แพทย์ค้นหาผู้ป่วยคนไหนก็ได้ด้วยเลขบัตรประชาชน
--   เพราะแพทย์ต้องเปิดดูคนที่เพิ่งเดินเข้ามารักษา
--   CareSignal ไม่ทำแบบนั้น — เห็นได้เฉพาะเคสที่ถูกส่งถึงตนเท่านั้น
--   การค้นหาข้ามพอร์ตจะทำลายการแยกสิทธิ์ที่วางไว้
-- ============================================================

-- ---------- ตัวตนวิชาชีพ ----------
alter table public.profiles
  add column if not exists license_no  text,   -- เลขใบประกอบวิชาชีพ
  add column if not exists license_body text,  -- สภาที่ออกให้ เช่น แพทยสภา สภาเภสัชกรรม
  add column if not exists org_name    text;   -- หน่วยงาน/สถานพยาบาลที่ปฏิบัติงานอยู่

comment on column public.profiles.license_no is
  'เลขใบประกอบวิชาชีพ — บันทึกไว้เพื่อให้ตรวจย้อนได้ว่าใครเปิดดูข้อมูล '
  'ระบบนี้ยังไม่ได้เชื่อมกับฐานของสภาวิชาชีพ จึงยังตรวจสอบความถูกต้องอัตโนมัติไม่ได้';

-- ============================================================
-- คำขอเข้าถึงข้อมูลรายครั้ง
-- ============================================================
create table if not exists public.access_requests (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.profiles(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  referral_id  uuid references public.referrals(id) on delete set null,
  scope        text not null default 'clinical',   -- clinical | medications
  reason       text,
  status       text not null default 'pending'
                 check (status in ('pending','granted','denied','expired')),
  requested_at timestamptz not null default now(),
  -- Health Link ให้ผู้ป่วยตอบภายใน 5 นาที ถ้าไม่ทันต้องกดขอใหม่
  expires_at   timestamptz not null default now() + interval '5 minutes',
  decided_at   timestamptz,
  -- เมื่ออนุญาตแล้ว เปิดดูได้ถึงเมื่อไร (ไม่ใช่ตลอดไป)
  access_until timestamptz
);

create index if not exists access_req_member_idx
  on public.access_requests(member_id, status, requested_at desc);
create index if not exists access_req_requester_idx
  on public.access_requests(requester_id, status);

comment on table public.access_requests is
  'คำขอเปิดดูข้อมูลคลินิกรายครั้ง — ผู้เอาประกันเป็นผู้อนุญาต ไม่ใช่ระบบอนุญาตแทน';

alter table public.access_requests enable row level security;

-- เจ้าของข้อมูลเห็นคำขอที่ส่งถึงตน · ผู้ขอเห็นคำขอของตน · ผู้ประสานงานเห็นเพื่อติดตาม
drop policy if exists areq_select on public.access_requests;
create policy areq_select on public.access_requests
  for select using (
    member_id = auth.uid() or requester_id = auth.uid() or public.cs_is_staff()
  );

-- ผู้เชี่ยวชาญสร้างคำขอได้เฉพาะในนามตนเอง และเฉพาะคนที่มีเคสส่งมาถึงตน
drop policy if exists areq_insert on public.access_requests;
create policy areq_insert on public.access_requests
  for insert with check (
    requester_id = auth.uid()
    and public.cs_is_care_team()
    and public.cs_referred_to_me(member_id)
  );

-- เจ้าของข้อมูลเท่านั้นที่ตัดสินคำขอ
drop policy if exists areq_decide on public.access_requests;
create policy areq_decide on public.access_requests
  for update using (member_id = auth.uid()) with check (member_id = auth.uid());

-- ---------- ตรวจว่ามีสิทธิ์เปิดดูอยู่หรือไม่ ----------
create or replace function public.cs_has_live_access(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.access_requests a
     where a.member_id    = target
       and a.requester_id = auth.uid()
       and a.status       = 'granted'
       and a.access_until > now()
  )
$$;

comment on function public.cs_has_live_access is
  'มีความยินยอมที่ผู้เอาประกันเพิ่งอนุญาต และยังไม่หมดอายุ';

-- ---------- ตัดสินคำขอ (ฝั่งผู้เอาประกัน) ----------
create or replace function public.decide_access(rid uuid, approve boolean, hours int default 8)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare rec public.access_requests;
begin
  select * into rec from public.access_requests where id = rid;
  if rec.id is null then raise exception 'ไม่พบคำขอ'; end if;
  if rec.member_id <> auth.uid() then
    raise exception 'ผู้เอาประกันเท่านั้นที่อนุญาตได้';
  end if;
  if rec.status <> 'pending' then raise exception 'คำขอนี้ตัดสินไปแล้ว'; end if;
  if rec.expires_at < now() then
    update public.access_requests set status='expired' where id = rid;
    raise exception 'คำขอหมดเวลาแล้ว กรุณาให้ผู้เชี่ยวชาญขอใหม่';
  end if;

  update public.access_requests
     set status       = case when approve then 'granted' else 'denied' end,
         decided_at   = now(),
         access_until = case when approve
                             then now() + make_interval(hours => greatest(1, least(24, hours)))
                             else null end
   where id = rid;

  insert into public.audit_logs(actor_id, actor_role, action, subject_id, detail, meta)
  values (auth.uid(), public.cs_role(),
          case when approve then 'consent.grant_access' else 'consent.deny_access' end,
          auth.uid(),
          case when approve then 'อนุญาตให้เปิดดูข้อมูลชั่วคราว' else 'ไม่อนุญาตให้เปิดดูข้อมูล' end,
          jsonb_build_object('request_id', rid, 'requester', rec.requester_id));
end $$;

grant execute on function public.decide_access(uuid, boolean, int) to authenticated;

-- ---------- ปิดคำขอที่หมดเวลาเอง ----------
create or replace function public.expire_access_requests()
returns void
language sql
security definer
set search_path = public
as $$
  update public.access_requests
     set status = 'expired'
   where status = 'pending' and expires_at < now()
$$;

grant execute on function public.expire_access_requests() to authenticated;

-- ============================================================
-- บังคับความยินยอมรายครั้งกับข้อมูลที่ละเอียดอ่อนที่สุด
-- ------------------------------------------------------------
-- รายการยาและผลประเมินย้อนหลัง ต้องมีความยินยอมที่ยังไม่หมดอายุ
-- ส่วนตัวรายการส่งต่อ (ชื่อแฝง · งานที่ต้องทำ · ระดับความเร่งด่วน)
-- ยังเห็นได้โดยไม่ต้องขอ เพื่อให้จัดลำดับงานและรู้ว่าต้องขอกับใคร
--
-- ผู้ประสานงาน (care_manager) ไม่ถูกกั้น เพราะเป็นทีมดูแลที่ผู้เอาประกัน
-- ยินยอมไว้ตั้งแต่สมัคร ต่างจากผู้เชี่ยวชาญภายนอกที่เป็นบุคคลที่สาม
-- ============================================================
drop policy if exists meds_pharmacist_read on public.medications;
create policy meds_pharmacist_read on public.medications
  for select using (
    public.cs_role() = 'pharmacist'
    and public.cs_referred_to_me(user_id)
    and public.cs_has_live_access(user_id)
  );

drop policy if exists assessments_clinician_read on public.assessments;
create policy assessments_clinician_read on public.assessments
  for select using (
    public.cs_is_clinician()
    and public.cs_referred_to_me(user_id)
    and public.cs_has_live_access(user_id)
  );

-- ---------- แจ้งเตือนผู้เอาประกันเมื่อมีคำขอ ----------
create or replace function public.notify_access_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(display_name, 'ผู้เชี่ยวชาญ') || ' (' ||
         case role::text when 'pharmacist' then 'เภสัชกร'
                         when 'physio' then 'นักกายภาพบำบัด'
                         when 'doctor' then 'แพทย์'
                         when 'nurse'  then 'พยาบาล'
                         else role::text end || ')'
    into who from public.profiles where id = new.requester_id;

  insert into public.audit_logs(actor_id, actor_role, action, subject_id, detail, meta)
  values (new.requester_id, public.cs_role(), 'consent.request_access', new.member_id,
          who || ' ขอเปิดดูข้อมูลของท่าน', jsonb_build_object('request_id', new.id));
  return new;
end $$;

drop trigger if exists trg_notify_access_request on public.access_requests;
create trigger trg_notify_access_request
  after insert on public.access_requests
  for each row execute function public.notify_access_request();
