-- ============================================================
-- 14) หน่วยบริการที่ปฏิบัติงาน + ตรวจสถานะสมาชิกก่อนขอความยินยอม
-- ------------------------------------------------------------
-- รับแนวจากขั้นตอนของระบบ Health Link สองข้อ
--
--   1. เมื่อยืนยันตัวตนแล้ว ระบบให้ "เลือกหน่วยบริการสุขภาพที่ท่านประจำอยู่"
--      ทุกครั้งที่เข้าระบบ เพราะระบบเก็บบันทึกการเข้าใช้งาน
--      และผู้ให้บริการคนหนึ่งอาจทำงานหลายแห่ง
--      ของเดิมเราเก็บหน่วยงานเป็นค่านิ่งในโปรไฟล์ ซึ่งตอบไม่ได้ว่า
--      "ตอนที่เปิดดูข้อมูล เขาอยู่ที่ไหน"
--
--   2. ตรวจสถานะการเป็นสมาชิกก่อน แล้วจึงส่งข้อความขอความยินยอมได้
--      Health Link ใช้เลขบัตร 13 หลักค้นหา แต่ CareSignal ไม่ให้ค้นข้ามพอร์ต
--      จึงตรวจจากเคสที่ส่งถึงตนแทน และคืนเฉพาะสถานะ ไม่คืนข้อมูลส่วนบุคคล
-- ============================================================

create table if not exists public.work_sessions (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.profiles(id) on delete cascade,
  org_name   text not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
create index if not exists work_sessions_staff_idx
  on public.work_sessions(staff_id, started_at desc);

comment on table public.work_sessions is
  'หน่วยบริการที่เจ้าหน้าที่ระบุตอนเข้าระบบ — ใช้ตอบว่าใครเปิดดูข้อมูลจากที่ใด';

alter table public.work_sessions enable row level security;

drop policy if exists ws_own on public.work_sessions;
create policy ws_own on public.work_sessions
  for all using (staff_id = auth.uid() or public.cs_is_staff())
  with check (staff_id = auth.uid());

create or replace function public.cs_my_org()
returns text language sql stable security definer set search_path = public as $$
  select org_name from public.work_sessions
   where staff_id = auth.uid() and ended_at is null
   order by started_at desc limit 1
$$;

-- ---------- บันทึกหน่วยบริการไว้กับคำขอ ----------
-- ผู้เอาประกันต้องเห็นว่า "ตอนที่ขอ เขาอยู่หน่วยบริการไหน" เพื่อประกอบการตัดสินใจ
-- เก็บเป็นสำเนา ณ เวลาที่ขอ ไม่ใช่อ่านสดจากโปรไฟล์ซึ่งเปลี่ยนได้ภายหลัง
alter table public.access_requests
  add column if not exists requester_org text;

create or replace function public.stamp_request_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.requester_org is null then
    new.requester_org := coalesce(public.cs_my_org(),
      (select org_name from public.profiles where id = new.requester_id));
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_request_org on public.access_requests;
create trigger trg_stamp_request_org
  before insert on public.access_requests
  for each row execute function public.stamp_request_org();

-- ---------- ตรวจสถานะสมาชิก ----------
create or replace function public.check_membership(target uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare enrolled boolean; has_consent boolean; ch text;
begin
  if not public.cs_is_care_team() then
    raise exception 'ไม่มีสิทธิ์ตรวจสอบสถานะสมาชิก';
  end if;
  if not public.cs_referred_to_me(target) and not public.cs_is_staff() then
    raise exception 'ผู้เอาประกันรายนี้ไม่ได้ถูกส่งต่อมาถึงท่าน';
  end if;

  select true into enrolled from public.profiles where id = target;
  select exists(select 1 from public.consents
                 where user_id = target and purpose = 'assessment'
                   and granted and revoked_at is null) into has_consent;
  select case when phone is not null then 'แอปสมาชิก + เบอร์ที่ลงทะเบียน'
              else 'แอปสมาชิก' end
    into ch from public.profiles where id = target;

  return jsonb_build_object(
    'enrolled',    coalesce(enrolled,false),
    'consented',   coalesce(has_consent,false),
    'channel',     ch,
    'can_request', coalesce(enrolled,false) and coalesce(has_consent,false)
  );
end $$;

grant execute on function public.check_membership(uuid) to authenticated;
grant execute on function public.cs_my_org() to authenticated;
