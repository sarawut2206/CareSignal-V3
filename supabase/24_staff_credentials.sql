-- ============================================================
-- 24_staff_credentials.sql — ตรวจสอบใบอนุญาตประกอบวิชาชีพของผู้เชี่ยวชาญ
-- ------------------------------------------------------------
-- ปัญหาเดิม: ผู้ที่ได้รหัสบทบาทแพทย์/เภสัชกร/นักกายภาพ/พยาบาล เห็นเคสได้ทันที
--   ช่อง license_no ใน profiles เป็นข้อความที่เจ้าของบัญชีแก้เองได้ ไม่มีใครตรวจ
-- ของใหม่:
--   1. ผู้เชี่ยวชาญยื่นข้อมูลใบอนุญาต + รูปใบอนุญาต + สถานที่ปฏิบัติงาน + ความยินยอม
--   2. ผู้ดูแลระบบตรวจกับฐานข้อมูลของสภาวิชาชีพเอง แล้วอนุมัติ / ขอข้อมูลเพิ่ม / ปฏิเสธ / เพิกถอน
--   3. จนกว่าจะอนุมัติ (และใบอนุญาตยังไม่หมดอายุ) บัญชีวิชาชีพ "มองไม่เห็นเคสใดเลย"
--      บังคับที่ฐานข้อมูล ผ่าน cs_is_clinician / cs_is_care_team / cs_my_destination
--      / cs_referred_to_me และนโยบายที่เคยเช็กบทบาทเภสัชกรตรง ๆ
-- ระบบไม่ได้เชื่อมกับฐานของสภาวิชาชีพ การตรวจเป็นงานของคน และบันทึกว่าใครตรวจ
-- ด้วยวิธีใด เมื่อใด ลง audit_logs เสมอ
-- รันซ้ำได้ (if not exists / or replace / drop policy if exists)
-- ============================================================

create table if not exists public.staff_credentials (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references public.profiles(id) on delete cascade,
  profession      text not null check (profession in ('doctor','pharmacist','physio','nurse')),
  council         text not null,
  full_name       text not null check (length(trim(full_name)) between 4 and 120),
  license_no      text not null check (license_no ~ '^[0-9A-Za-zก-๙./ -]{3,30}$'),
  license_expiry  date,
  org_province    text,
  org_type        text not null check (org_type in ('hospital','phc','clinic','pharmacy','health_office','other')),
  org_name        text not null check (length(trim(org_name)) between 3 and 200),
  org_hcode       text check (org_hcode is null or org_hcode ~ '^[0-9]{5}$'),
  photo_path      text not null,
  consent_version text not null,
  consent_at      timestamptz not null default now(),
  attest_true     boolean not null check (attest_true),
  status          text not null default 'pending'
                  check (status in ('pending','verified','needs_info','rejected','revoked')),
  verify_method   text,
  review_note     text,
  reviewed_by     uuid references public.profiles(id),
  reviewed_at     timestamptz,
  submitted_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.staff_credentials is
  'ใบอนุญาตประกอบวิชาชีพของผู้เชี่ยวชาญ — สถานะเปลี่ยนได้ทางเดียวคือ admin_review_credential';

alter table public.staff_credentials enable row level security;

drop policy if exists cred_own_read on public.staff_credentials;
create policy cred_own_read on public.staff_credentials
  for select using (user_id = auth.uid() or public.cs_role() = 'admin');

drop policy if exists cred_own_insert on public.staff_credentials;
create policy cred_own_insert on public.staff_credentials
  for insert with check (user_id = auth.uid()
                         and public.cs_role() in ('doctor','pharmacist','physio','nurse')
                         and status = 'pending');

-- แก้ไข/ยื่นใหม่ได้ทุกสถานะยกเว้นถูกเพิกถอน (เช่น ย้ายที่ทำงาน ต่ออายุใบอนุญาต)
-- ทริกเกอร์ด้านล่างดึงสถานะกลับไป "รอตรวจ" ทุกครั้ง จึงแก้เองแล้วยังเห็นเคสต่อไม่ได้
drop policy if exists cred_own_update on public.staff_credentials;
create policy cred_own_update on public.staff_credentials
  for update using (user_id = auth.uid() and status <> 'revoked')
  with check (user_id = auth.uid());

-- สิทธิ์ระดับคอลัมน์: เจ้าของแก้สถานะหรือผลการตรวจของตัวเองไม่ได้
revoke all on public.staff_credentials from anon;
revoke insert, update, delete on public.staff_credentials from authenticated;
grant select on public.staff_credentials to authenticated;
grant insert (user_id, profession, council, full_name, license_no, license_expiry, org_province, org_type,
              org_name, org_hcode, photo_path, consent_version, consent_at, attest_true)
  on public.staff_credentials to authenticated;
grant update (full_name, license_no, license_expiry, org_province, org_type, org_name, org_hcode,
              photo_path, consent_version, consent_at, attest_true)
  on public.staff_credentials to authenticated;

-- ยื่นใหม่ = กลับไปรอตรวจเสมอ และวิชาชีพต้องตรงกับบทบาทของบัญชี
create or replace function public.cred_before_write()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if public.cs_role() <> 'admin' or new.user_id = auth.uid() then
    new.profession := (select role::text from public.profiles where id = new.user_id);
    if new.profession not in ('doctor','pharmacist','physio','nurse') then
      raise exception 'บัญชีนี้ไม่ใช่บทบาทผู้เชี่ยวชาญ';
    end if;
    new.council := case new.profession when 'doctor' then 'แพทยสภา' when 'pharmacist' then 'สภาเภสัชกรรม'
                                       when 'physio' then 'สภากายภาพบำบัด' else 'สภาการพยาบาล' end;
    if tg_op = 'UPDATE' and current_setting('cs.reviewing', true) is distinct from '1' then
      new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.verify_method := null;
      new.submitted_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists trg_cred_before_write on public.staff_credentials;
create trigger trg_cred_before_write before insert or update on public.staff_credentials
  for each row execute function public.cred_before_write();

create or replace function public.cred_after_write()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if current_setting('cs.reviewing', true) is distinct from '1' then
    insert into public.audit_logs(actor_id, actor_role, action, subject_id, detail)
    values (auth.uid(), public.cs_role(), 'credential.submitted', new.user_id,
            'ยื่นข้อมูลใบอนุญาต ' || new.council || ' เลขที่ ' || new.license_no || ' · ' || new.org_name);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_cred_after_write on public.staff_credentials;
create trigger trg_cred_after_write after insert or update on public.staff_credentials
  for each row execute function public.cred_after_write();

-- ---------- รูปใบอนุญาต: บัคเก็ตส่วนตัว เห็นได้เฉพาะเจ้าของและผู้ดูแลระบบ ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-licenses', 'staff-licenses', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists lic_own_rw on storage.objects;
create policy lic_own_rw on storage.objects
  for insert with check (bucket_id = 'staff-licenses' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists lic_own_read on storage.objects;
create policy lic_own_read on storage.objects
  for select using (bucket_id = 'staff-licenses'
                    and ((storage.foldername(name))[1] = auth.uid()::text or public.cs_role() = 'admin'));

-- ---------- ประตูหลัก: ใบอนุญาตผ่านการตรวจและยังไม่หมดอายุ ----------
create or replace function public.cs_credential_ok()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.staff_credentials c
                  where c.user_id = auth.uid() and c.status = 'verified'
                    and (c.license_expiry is null or c.license_expiry >= current_date))
$fn$;
grant execute on function public.cs_credential_ok() to authenticated;

create or replace function public.cs_is_clinician()
returns boolean language sql stable as $fn$
  select public.cs_role() in ('pharmacist','physio','doctor','nurse') and public.cs_credential_ok()
$fn$;

create or replace function public.cs_is_care_team()
returns boolean language sql stable as $fn$
  select public.cs_role() in ('care_manager','admin')
      or (public.cs_role() in ('pharmacist','physio','doctor','nurse') and public.cs_credential_ok())
$fn$;

create or replace function public.cs_my_destination()
returns text language sql stable security definer set search_path = public as $fn$
  select case when not public.cs_credential_ok() then null
    else case public.cs_role()
      when 'pharmacist' then 'pharmacist' when 'physio' then 'physio'
      when 'doctor' then 'doctor' when 'nurse' then 'nurse' else null end end
$fn$;

create or replace function public.cs_referred_to_me(target uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.cs_credential_ok() and exists (
    select 1 from public.referrals r
     where r.user_id = target
       and (r.destination = public.cs_my_destination() or r.assigned_to = auth.uid()))
$fn$;

-- นโยบายที่เคยเช็กบทบาทเภสัชกรตรง ๆ
drop policy if exists meds_pharmacist_read on public.medications;
create policy meds_pharmacist_read on public.medications
  for select using (public.cs_role() = 'pharmacist' and public.cs_credential_ok()
                    and public.cs_referred_to_me(user_id) and public.cs_has_live_access(user_id));
drop policy if exists alias_pharm_rw on public.drug_alias;
create policy alias_pharm_rw on public.drug_alias
  for all using (public.cs_role() = 'admin' or (public.cs_role() = 'pharmacist' and public.cs_credential_ok()))
  with check (public.cs_role() = 'admin' or (public.cs_role() = 'pharmacist' and public.cs_credential_ok()));
drop policy if exists dq_pharm on public.drug_unknown_queue;
create policy dq_pharm on public.drug_unknown_queue
  for all using (public.cs_role() = 'admin' or (public.cs_role() = 'pharmacist' and public.cs_credential_ok()))
  with check (public.cs_role() = 'admin' or (public.cs_role() = 'pharmacist' and public.cs_credential_ok()));

create or replace function public.resolve_unknown_drug(p_queue_id uuid, p_inn text, p_group text, p_atc text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $function$
declare q record; lv smallint;
begin
  if not (public.cs_role() = 'admin' or (public.cs_role() = 'pharmacist' and public.cs_credential_ok())) then
    raise exception 'เฉพาะเภสัชกรที่ผ่านการตรวจใบอนุญาตเท่านั้นที่จัดกลุ่มยาได้';
  end if;
  select * into q from drug_unknown_queue where id = p_queue_id;
  if not found then raise exception 'ไม่พบรายการในคิว'; end if;
  lv := case p_group
          when 'bzd' then 2 when 'antidep' then 2 when 'antipsy' then 2
          when 'anticonv' then 2 when 'opioid' then 2 when 'anticho' then 2
          when 'none' then 0 when 'unknown' then null else 1 end;
  update drug_unknown_queue
     set status='resolved', resolved_inn=p_inn, resolved_group=p_group,
         resolved_by=auth.uid(), resolved_at=now(), note=coalesce(p_note, note)
   where id = p_queue_id;
  if q.medication_id is not null then
    update medications
       set inn=p_inn, atc=p_atc, frid_group=p_group, frid_level=lv,
           confirmed_by='pharmacist', reviewed_at=now(), reviewed_by=auth.uid(), updated_at=now()
     where id = q.medication_id;
  end if;
  if coalesce(q.guess_name,'') <> '' then
    insert into drug_alias(alias, inn, atc, frid_group, frid_level, source, approved_by, approved_at, note)
    values (lower(regexp_replace(trim(q.guess_name), '\s+', ' ', 'g')), p_inn, p_atc,
            p_group, lv, 'pharmacist', auth.uid(), now(), p_note)
    on conflict (alias) do update
      set inn=excluded.inn, atc=excluded.atc, frid_group=excluded.frid_group,
          frid_level=excluded.frid_level, source='pharmacist', approved_by=excluded.approved_by, approved_at=now();
  end if;
  insert into audit_logs(actor_id, action, subject_id, detail, meta)
  values (auth.uid(), 'drug.resolve', q.user_id,
          'เภสัชกรจัดกลุ่มยาที่ระบบไม่รู้จัก เป็น ' || coalesce(p_inn,'ไม่ระบุ') || ' · กลุ่ม ' || coalesce(p_group,'unknown'),
          jsonb_build_object('queue_id', p_queue_id, 'atc', p_atc));
end $function$;

-- เลขใบอนุญาตใน profiles กลายเป็นสำเนาที่ระบบเขียนเองเมื่ออนุมัติ เจ้าของแก้ตรงไม่ได้อีก
revoke update (license_no, license_body) on public.profiles from authenticated;

-- ---------- ผู้ดูแลระบบตรวจสอบ ----------
create or replace function public.admin_review_credential(p_user uuid, p_status text, p_method text, p_note text)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare c public.staff_credentials;
begin
  if public.cs_role() <> 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ตรวจสอบใบอนุญาตได้'; end if;
  if p_user = auth.uid() then raise exception 'ตรวจสอบใบอนุญาตของตัวเองไม่ได้'; end if;
  if p_status not in ('verified','needs_info','rejected','revoked') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  if p_status <> 'verified' and length(coalesce(trim(p_note),'')) < 5 then
    raise exception 'กรุณาระบุเหตุผลให้ผู้ยื่นทราบ';
  end if;
  if p_status = 'verified' and coalesce(p_method,'') = '' then
    raise exception 'กรุณาระบุวิธีที่ใช้ตรวจสอบ';
  end if;
  select * into c from public.staff_credentials where user_id = p_user;
  if c.id is null then raise exception 'ไม่พบข้อมูลใบอนุญาตของบัญชีนี้'; end if;
  if p_status = 'verified' and c.license_expiry is not null and c.license_expiry < current_date then
    raise exception 'ใบอนุญาตหมดอายุแล้ว อนุมัติไม่ได้';
  end if;
  perform set_config('cs.reviewing', '1', true);
  update public.staff_credentials
     set status = p_status, verify_method = p_method, review_note = p_note,
         reviewed_by = auth.uid(), reviewed_at = now()
   where user_id = p_user;
  if p_status = 'verified' then
    update public.profiles set license_no = c.license_no, license_body = c.council, org_name = c.org_name where id = p_user;
  end if;
  insert into public.audit_logs(actor_id, actor_role, action, subject_id, detail)
  values (auth.uid(), 'admin', 'credential.' || p_status, p_user,
          c.council || ' เลขที่ ' || c.license_no || ' → ' || p_status ||
          coalesce(' · วิธีตรวจ ' || p_method, '') || coalesce(' · ' || p_note, ''));
  perform set_config('cs.reviewing', '', true);
  return true;
end $fn$;
grant execute on function public.admin_review_credential(uuid, text, text, text) to authenticated;
