-- ============================================================
-- 05_family.sql — ระบบบัญชีครอบครัว: เชิญ → ขอเชื่อม → อนุมัติ → กำหนดสิทธิ์
-- ------------------------------------------------------------
-- หลักการ (ตามที่เจ้าของโครงการกำหนด):
--   "การรู้รหัสสมาชิก ไม่เท่ากับ มีสิทธิ์อ่านข้อมูลสุขภาพ"
--   Account ≠ Permission — ครอบครัวมีบัญชีของตัวเอง และเห็นข้อมูล
--   ผู้เอาประกันได้เฉพาะสิ่งที่ผู้เอาประกันอนุมัติเป็นรายการ
--
-- การไหล: ผู้เอาประกันสร้างรหัสเชิญ 6 หลัก (หมดอายุ 24 ชม.)
--   → ครอบครัวกรอกรหัส → เกิดคำขอสถานะ pending (ยังอ่านอะไรไม่ได้)
--   → ผู้เอาประกันอนุมัติพร้อมเลือกสิทธิ์รายข้อ → จึงอ่านได้ตามสิทธิ์
--   สิทธิ์ทั้งหมดบังคับที่ Row Level Security ไม่ใช่ที่หน้าจอ
-- ============================================================

-- ---------- ตาราง ----------
create table if not exists public.caregiver_invites (
  code       text primary key,
  member_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by    uuid references public.profiles(id),
  used_at    timestamptz
);

create table if not exists public.caregiver_links (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.profiles(id) on delete cascade,
  carer_id     uuid not null references public.profiles(id) on delete cascade,
  relationship text,
  status       text not null default 'pending'
               check (status in ('pending','approved','declined','revoked')),
  -- สิทธิ์รายข้อ ค่าเริ่มต้นคือชุดที่ผู้เอาประกันเห็นตอนกดอนุมัติ (แก้ได้ทุกข้อ)
  permissions  jsonb not null default
    '{"status":true,"trend":true,"results":true,"adl":true,"alerts":true,"meds":false}'::jsonb,
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  constraint caregiver_links_no_self check (member_id <> carer_id),
  unique (member_id, carer_id)
);

create table if not exists public.family_notifications (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.profiles(id) on delete cascade,
  carer_id   uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  body       text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create table if not exists public.family_checkins (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.profiles(id) on delete cascade,
  carer_id   uuid not null references public.profiles(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.caregiver_invites    enable row level security;
alter table public.caregiver_links      enable row level security;
alter table public.family_notifications enable row level security;
alter table public.family_checkins      enable row level security;

-- ---------- นโยบายสิทธิ์ ----------
-- รหัสเชิญ: เจ้าของเห็น/ลบของตัวเองเท่านั้น การใช้รหัสทำผ่านฟังก์ชัน
-- security definer ข้างล่าง จึงไม่มีทาง "กวาดหา" รหัสของคนอื่นจากตาราง
drop policy if exists invites_member on public.caregiver_invites;
create policy invites_member on public.caregiver_invites
  for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- ลิงก์: ผู้เอาประกันเห็นและแก้ (อนุมัติ/สิทธิ์/ถอน) ของตัวเอง
-- ครอบครัวเห็นลิงก์ของตัวเอง แต่แก้อะไรไม่ได้นอกจากถอนคำขอตัวเอง
drop policy if exists links_member_all  on public.caregiver_links;
drop policy if exists links_carer_read  on public.caregiver_links;
drop policy if exists links_carer_cancel on public.caregiver_links;
create policy links_member_all on public.caregiver_links
  for all using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy links_carer_read on public.caregiver_links
  for select using (carer_id = auth.uid());
create policy links_carer_cancel on public.caregiver_links
  for update using (carer_id = auth.uid())
  with check (carer_id = auth.uid() and status in ('pending','revoked'));

-- แจ้งเตือน: ครอบครัวอ่าน/ติ๊กอ่านของตัวเอง ผู้เอาประกันเห็นว่าระบบแจ้งอะไรไป
drop policy if exists notif_carer  on public.family_notifications;
drop policy if exists notif_member on public.family_notifications;
create policy notif_carer on public.family_notifications
  for select using (carer_id = auth.uid());
drop policy if exists notif_carer_read on public.family_notifications;
create policy notif_carer_read on public.family_notifications
  for update using (carer_id = auth.uid()) with check (carer_id = auth.uid());
create policy notif_member on public.family_notifications
  for select using (member_id = auth.uid());

-- บันทึกเยี่ยม: ทั้งสองฝ่ายของลิงก์ที่อนุมัติแล้ว
drop policy if exists checkin_rw on public.family_checkins;
create policy checkin_rw on public.family_checkins
  for all using (carer_id = auth.uid() or member_id = auth.uid())
  with check (carer_id = auth.uid());

-- ---------- สิทธิ์อ่านข้อมูลสุขภาพของครอบครัว (หัวใจของระบบ) ----------
-- อ่าน "ผลประเมิน" ได้เฉพาะเมื่อลิงก์อนุมัติแล้ว และติ๊กสิทธิ์ results
drop policy if exists assessments_family_read on public.assessments;
create policy assessments_family_read on public.assessments
  for select using (
    exists (select 1 from public.caregiver_links l
            where l.member_id = assessments.user_id
              and l.carer_id  = auth.uid()
              and l.status    = 'approved'
              and coalesce(l.permissions->>'results','false') = 'true')
  );

-- อ่าน "สัญญาณความเสี่ยง" ตามสิทธิ์ trend
drop policy if exists risk_family_read on public.risk_signals;
create policy risk_family_read on public.risk_signals
  for select using (
    exists (select 1 from public.caregiver_links l
            where l.member_id = risk_signals.user_id
              and l.carer_id  = auth.uid()
              and l.status    = 'approved'
              and coalesce(l.permissions->>'trend','false') = 'true')
  );

-- อ่าน "การส่งต่อ/สถานะ Care Manager" ตามสิทธิ์ alerts
drop policy if exists referrals_family_read on public.referrals;
create policy referrals_family_read on public.referrals
  for select using (
    exists (select 1 from public.caregiver_links l
            where l.member_id = referrals.user_id
              and l.carer_id  = auth.uid()
              and l.status    = 'approved'
              and coalesce(l.permissions->>'alerts','false') = 'true')
  );

-- ---------- วิวรายชื่อคนที่ฉันดูแล (จำกัดคอลัมน์ ไม่มีเบอร์/ปีเกิดเต็ม) ----------
create or replace view public.family_members as
  select l.id as link_id, l.member_id, l.status, l.permissions, l.relationship,
         l.requested_at, l.decided_at,
         p.display_name, p.pseudonym,
         case when p.birth_year_be is null then null
              else (extract(year from now())::int + 543 - p.birth_year_be) end as age
  from public.caregiver_links l
  join public.profiles p on p.id = l.member_id
  where l.carer_id = auth.uid();

-- ---------- ฟังก์ชันสร้าง/ใช้รหัสเชิญ ----------
-- หมายเหตุ: วิว my_carers (ให้ผู้เอาประกันเห็นชื่อผู้ขอเชื่อมต่อ) อยู่ใน 06_family_notify.sql
--          เพราะเพิ่มภายหลังพร้อมระบบแจ้งเตือน 2 ชั้น

create or replace function public.cs_create_invite()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code text; v_exp timestamptz; n int := 0;
begin
  if auth.uid() is null then raise exception 'no session'; end if;
  -- ลบรหัสเก่าที่ยังไม่ถูกใช้ของคนนี้ทิ้ง เหลือรหัสล่าสุดรหัสเดียวเสมอ
  delete from caregiver_invites where member_id = auth.uid() and used_by is null;
  loop
    v_code := lpad((floor(random()*1000000))::int::text, 6, '0');
    exit when not exists (select 1 from caregiver_invites where code = v_code);
    n := n + 1; if n > 20 then raise exception 'code space exhausted'; end if;
  end loop;
  v_exp := now() + interval '24 hours';
  insert into caregiver_invites (code, member_id, expires_at) values (v_code, auth.uid(), v_exp);
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

create or replace function public.cs_redeem_invite(p_code text, p_relationship text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_inv caregiver_invites%rowtype; v_name text;
begin
  if auth.uid() is null then raise exception 'no session'; end if;
  select * into v_inv from caregiver_invites
   where code = p_code and used_by is null and expires_at > now();
  if not found then raise exception 'invalid_or_expired'; end if;
  if v_inv.member_id = auth.uid() then raise exception 'self_link'; end if;

  -- สร้าง/รื้อคำขอเป็นสถานะรอ ผู้เอาประกันต้องอนุมัติเสมอ แม้เคยถูกถอนสิทธิ์
  insert into caregiver_links (member_id, carer_id, relationship, status, requested_at, decided_at)
  values (v_inv.member_id, auth.uid(), p_relationship, 'pending', now(), null)
  on conflict (member_id, carer_id) do update
    set status='pending', relationship=excluded.relationship,
        requested_at=now(), decided_at=null;

  update caregiver_invites set used_by = auth.uid(), used_at = now() where code = p_code;
  select display_name into v_name from profiles where id = v_inv.member_id;
  return jsonb_build_object('member_id', v_inv.member_id, 'member_name', coalesce(v_name,'ผู้เอาประกัน'));
end $$;

-- ---------- แจ้งเตือนครอบครัวอัตโนมัติ ----------
-- เมื่อเกิดสัญญาณความเสี่ยงใหม่ → แจ้งครอบครัวทุกคนที่ได้รับสิทธิ์ alerts
create or replace function public.notify_family_on_risk()
returns trigger language plpgsql security definer set search_path=public as $$
declare lv_nm text;
begin
  lv_nm := case new.level when 'urgent' then 'ต้องดูแลเร่งด่วน 🔴'
                          when 'decline' then 'มีการถดถอย 🟠'
                          when 'watch' then 'ควรเฝ้าสังเกต 🟡'
                          else 'คงที่ 🟢' end;
  insert into family_notifications (member_id, carer_id, kind, body)
  select new.user_id, l.carer_id, 'risk',
         'ผลประเมินล่าสุด: ' || lv_nm ||
         case when new.level in ('decline','urgent')
              then ' — ควรติดต่อหรือแวะเยี่ยม' else '' end
  from caregiver_links l
  where l.member_id = new.user_id and l.status = 'approved'
    and coalesce(l.permissions->>'alerts','false') = 'true';
  return new;
end $$;
drop trigger if exists trg_notify_family_risk on public.risk_signals;
create trigger trg_notify_family_risk
  after insert on public.risk_signals
  for each row execute function public.notify_family_on_risk();

-- เมื่อ Care Manager รับเคส → แจ้งครอบครัว
create or replace function public.notify_family_on_referral()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status = 'approved' and old.status = 'pending' then
    insert into family_notifications (member_id, carer_id, kind, body)
    select new.user_id, l.carer_id, 'cm',
           'ทีมดูแล (Care Manager) รับเคสแล้ว และจะติดต่อดูแลตามขั้นตอน'
    from caregiver_links l
    where l.member_id = new.user_id and l.status = 'approved'
      and coalesce(l.permissions->>'alerts','false') = 'true';
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_family_referral on public.referrals;
create trigger trg_notify_family_referral
  after update on public.referrals
  for each row execute function public.notify_family_on_referral();
