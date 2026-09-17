-- ============================================================
-- CareSignal — Row Level Security (สิทธิ์เข้าถึงข้อมูล 4 บทบาท)
-- ------------------------------------------------------------
-- ตารางสิทธิ์โดยสรุป:
--
--                    | user      | care_manager   | insurer        | admin
--   profiles         | ของตัวเอง  | อ่านผู้ใช้ทุกคน  | ❌ ไม่มีสิทธิ์  | ทั้งหมด
--   consents         | ของตัวเอง  | อ่านอย่างเดียว  | ❌             | ทั้งหมด
--   assessments      | ของตัวเอง  | อ่านอย่างเดียว  | ❌ (ผ่าน view) | ทั้งหมด
--   risk_signals     | ของตัวเอง  | อ่านอย่างเดียว  | ❌ (ผ่าน view) | ทั้งหมด
--   referrals        | ของตัวเอง  | อ่าน+ตัดสินใจ   | ❌             | ทั้งหมด
--   audit_logs       | ของตัวเอง  | ของที่ตนกระทำ   | ของที่ตนกระทำ  | ทั้งหมด
--
-- บริษัทประกันเข้าถึงข้อมูลได้ทางเดียวคือผ่าน view insurer_portfolio
-- ซึ่งไม่มีชื่อ เบอร์โทร หรือวันเกิดละเอียด — บังคับในระดับฐานข้อมูล
-- ============================================================

alter table public.profiles      enable row level security;
alter table public.consents      enable row level security;
alter table public.assessments   enable row level security;
alter table public.risk_signals  enable row level security;
alter table public.referrals     enable row level security;
alter table public.audit_logs    enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (
    id = auth.uid()
    or public.cs_is_staff()          -- พยาบาล/Care Manager ต้องรู้ว่าใครเป็นใครเพื่อไปเยี่ยมบ้าน
  );

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid() or public.cs_role() = 'admin')
             with check (id = auth.uid() or public.cs_role() = 'admin');

-- ผู้ใช้ห้ามเลื่อนขั้นบทบาทตัวเอง (กันการยกระดับสิทธิ์)
create or replace function public.guard_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and public.cs_role() <> 'admin' then
    raise exception 'ไม่มีสิทธิ์เปลี่ยนบทบาทผู้ใช้';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_role on public.profiles;
create trigger trg_guard_role before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------- consents ----------
drop policy if exists consents_rw_own on public.consents;
create policy consents_rw_own on public.consents
  for all using (user_id = auth.uid() or public.cs_is_staff())
          with check (user_id = auth.uid());

-- ---------- assessments ----------
drop policy if exists assessments_select on public.assessments;
create policy assessments_select on public.assessments
  for select using (user_id = auth.uid() or public.cs_is_staff());

drop policy if exists assessments_insert_own on public.assessments;
create policy assessments_insert_own on public.assessments
  for insert with check (user_id = auth.uid());

-- แก้ไข/ลบผลประเมินย้อนหลังได้เฉพาะ admin — กันการแก้ผลให้ดูดีขึ้น
drop policy if exists assessments_admin_write on public.assessments;
create policy assessments_admin_write on public.assessments
  for update using (public.cs_role() = 'admin');

-- ---------- risk_signals ----------
drop policy if exists risk_select on public.risk_signals;
create policy risk_select on public.risk_signals
  for select using (user_id = auth.uid() or public.cs_is_staff());

drop policy if exists risk_insert_own on public.risk_signals;
create policy risk_insert_own on public.risk_signals
  for insert with check (user_id = auth.uid());

-- ---------- referrals ----------
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
  for select using (user_id = auth.uid() or public.cs_is_staff());

drop policy if exists referrals_insert_own on public.referrals;
create policy referrals_insert_own on public.referrals
  for insert with check (user_id = auth.uid());

-- ตัดสินเคสได้เฉพาะเจ้าหน้าที่
drop policy if exists referrals_staff_update on public.referrals;
create policy referrals_staff_update on public.referrals
  for update using (public.cs_is_staff()) with check (public.cs_is_staff());

-- บังคับในระดับฐานข้อมูล: ผู้ตัดสินเคสต้องเป็นมนุษย์ที่มีบทบาทเจ้าหน้าที่
create or replace function public.guard_referral_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare r cs_role;
begin
  if new.status in ('approved','declined') and old.status = 'pending' then
    select role into r from public.profiles where id = new.decided_by;
    if r is null or r not in ('care_manager','admin') then
      raise exception 'การส่งต่อต้องได้รับการยืนยันจากพยาบาลหรือ Care Manager เท่านั้น';
    end if;
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_referral on public.referrals;
create trigger trg_guard_referral before update on public.referrals
  for each row execute function public.guard_referral_decision();

-- ---------- audit_logs ----------
-- เขียนได้ทุกบทบาท (บันทึกการกระทำของตนเอง) แต่แก้/ลบไม่ได้เลย
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs
  for insert with check (actor_id = auth.uid());

drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs
  for select using (
    subject_id = auth.uid()          -- ผู้ใช้ดูได้ว่าใครทำอะไรกับข้อมูลของตน (สิทธิตาม PDPA)
    or actor_id = auth.uid()
    or public.cs_role() = 'admin'
  );
-- ไม่มี policy สำหรับ update/delete → audit log แก้ไม่ได้ ลบไม่ได้ แม้แต่ admin

-- ============================================================
-- สร้าง profile อัตโนมัติเมื่อมีผู้สมัครใหม่ พร้อมรหัสแฝงชื่อ
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare pseudo text;
begin
  -- md5 อยู่ใน core ของ PostgreSQL ไม่ต้องพึ่ง extension เพิ่ม
  -- ที่มาคือ UUID v4 ซึ่งสุ่มอยู่แล้ว รหัสแฝงชื่อจึงย้อนกลับไม่ได้ในทางปฏิบัติ
  pseudo := 'P-' || upper(substr(md5(new.id::text), 1, 7));
  insert into public.profiles (id, pseudonym, phone, role)
  values (new.id, pseudo, new.phone, 'user')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
