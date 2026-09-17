-- ============================================================
-- 19_staff_login.sql — เจ้าหน้าที่เข้าระบบด้วยชื่อผู้ใช้ ไม่ใช่อีเมล
-- ------------------------------------------------------------
-- ที่เปลี่ยน
--   เดิมเจ้าหน้าที่และผู้เชี่ยวชาญต้องมีอีเมลและรหัสผ่านของตัวเองก่อน
--   แล้วค่อยรอผู้ดูแลระบบกำหนดบทบาท ซึ่งแปลว่ามีสองความลับต้องดูแล
--   คือรหัสผ่านที่ผู้ใช้ตั้งเอง กับรหัสเชิญที่ผู้ดูแลระบบออก
--
--   ตอนนี้เหลือความลับเดียวที่ผู้ดูแลระบบควบคุม คือ "รหัสเปิดใช้งาน"
--   เจ้าหน้าที่เข้าครั้งแรกด้วยชื่อผู้ใช้ + รหัสนั้น ระบบสร้างบัญชีให้เอง
--   แล้ว "บังคับให้ตั้งรหัสผ่านของตัวเองทันที" ก่อนแตะข้อมูลใด ๆ
--
-- ทำไมต้องบังคับตั้งรหัสผ่าน ไม่ใช่ใช้รหัสเปิดใช้งานต่อไปเรื่อย ๆ
--   รหัสเปิดใช้งานเดินทางผ่านมือผู้ดูแลระบบ กระดาษ หรือแชต
--   ถ้าปล่อยให้มันเป็นรหัสผ่านถาวร ใครที่เคยเห็นก็เข้าได้ตลอดไป
--   และ audit log จะบอกไม่ได้ว่าคนที่ทำคือเจ้าของบัญชีจริงหรือไม่
--
-- อีเมลที่ระบบสร้างให้ (<ชื่อผู้ใช้>@staff.caresignal.local) เป็นแค่กุญแจ
-- ภายในของ Supabase Auth ไม่เคยส่งจดหมายไปที่นั้น และไม่แสดงให้ผู้ใช้เห็น
-- ============================================================

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists must_set_password boolean not null default false;

-- ชื่อผู้ใช้ต้องไม่ซ้ำ เทียบแบบไม่สนตัวพิมพ์ เพราะคนพิมพ์ nurse01 กับ Nurse01 หมายถึงคนเดียวกัน
create unique index if not exists profiles_username_uk
  on public.profiles(lower(username)) where username is not null;

-- ============================================================
-- ล้างธง "ต้องตั้งรหัสผ่าน" — เรียกหลังผู้ใช้ตั้งรหัสผ่านของตัวเองสำเร็จ
-- ------------------------------------------------------------
-- ตัวรหัสผ่านไม่เคยผ่านฟังก์ชันนี้ Supabase Auth เป็นผู้เก็บ
-- ฟังก์ชันนี้แค่บันทึกว่า "ขั้นตอนตั้งรหัสผ่านผ่านแล้ว"
-- ============================================================
create or replace function public.clear_must_set_password()
returns boolean
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then return false; end if;
  update public.profiles set must_set_password = false where id = auth.uid();
  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), public.cs_role(), 'ตั้งรหัสผ่านของตนเอง',
          'ครั้งแรกหลังเปิดใช้งานบัญชีด้วยรหัสจากผู้ดูแลระบบ');
  return true;
end $fn$;

grant execute on function public.clear_must_set_password() to authenticated;

-- ============================================================
-- ผู้ดูแลระบบรีเซ็ตให้ตั้งรหัสผ่านใหม่ได้ เมื่อสงสัยว่ารหัสหลุด
-- ------------------------------------------------------------
-- ไม่ได้ตั้งรหัสผ่านแทนผู้ใช้ แค่ติดธงให้ระบบบังคับตั้งใหม่ในครั้งถัดไป
-- ============================================================
create or replace function public.admin_force_password_reset(p_uid uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
begin
  if public.cs_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;
  update public.profiles set must_set_password = true where id = p_uid;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), 'admin', 'บังคับให้ตั้งรหัสผ่านใหม่', 'บัญชี '||p_uid::text);
  return true;
end $fn$;

grant execute on function public.admin_force_password_reset(uuid) to authenticated;

-- ============================================================
-- รหัสเชิญต้องผูกกับชื่อผู้ใช้ที่ยังไม่มีใครใช้
-- ------------------------------------------------------------
-- เดิมออกรหัสซ้ำชื่อผู้ใช้เดิมได้ แล้วไปพังตอนสร้างบัญชี ซึ่งสายเกินไป
-- ผู้ดูแลระบบจะเพิ่งรู้ตอนเจ้าหน้าที่เอารหัสมากรอกแล้วเข้าไม่ได้
-- ============================================================
create or replace function public.issue_staff_invite(
  p_username text, p_role cs_role, p_display_name text default null,
  p_note text default null, p_days int default 30)
returns table (invite_id uuid, code text)
language plpgsql security definer set search_path = public as $fn$
declare v_code text; v_id uuid; v_user text;
begin
  if public.cs_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ออกรหัสได้';
  end if;
  if p_role = 'user' then
    raise exception 'ช่องทางนี้ออกรหัสให้บทบาทเจ้าหน้าที่เท่านั้น';
  end if;
  v_user := lower(trim(coalesce(p_username,'')));
  if v_user = '' then
    raise exception 'ต้องระบุชื่อผู้ใช้';
  end if;
  -- ชื่อผู้ใช้กลายเป็นส่วนหนึ่งของอีเมลภายใน จึงรับเฉพาะอักขระที่ปลอดภัย
  if v_user !~ '^[a-z0-9][a-z0-9._-]{2,30}$' then
    raise exception 'ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3-31 ตัว และขึ้นต้นด้วยตัวอักษรหรือตัวเลข';
  end if;
  if exists (select 1 from public.profiles where lower(username) = v_user) then
    raise exception 'ชื่อผู้ใช้ % ถูกใช้งานอยู่แล้ว', v_user;
  end if;
  if exists (select 1 from public.staff_invite
              where lower(username) = v_user and used_at is null and revoked_at is null
                and expires_at > now()) then
    raise exception 'มีรหัสที่ยังไม่ถูกใช้ของชื่อผู้ใช้ % อยู่แล้ว — ยกเลิกใบเดิมก่อน', v_user;
  end if;

  -- รหัส 12 ตัวอักษรจากอักขระที่อ่านออกเสียงแล้วไม่กำกวม
  -- ตัด 0 O 1 I L ออก เพราะรหัสนี้ถูกอ่านให้ฟังทางโทรศัพท์บ่อย
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
           1 + floor(random()*31)::int, 1), '')
    into v_code from generate_series(1,12);
  v_code := substr(v_code,1,4)||'-'||substr(v_code,5,4)||'-'||substr(v_code,9,4);

  insert into public.staff_invite(code_hash, code_hint, username, role, display_name, note,
                                  created_by, expires_at)
  values (encode(extensions.digest(v_code,'sha256'),'hex'), right(v_code,4), v_user,
          p_role, p_display_name, p_note, auth.uid(),
          now() + make_interval(days => greatest(1, least(365, coalesce(p_days,30)))))
  returning id into v_id;

  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), 'admin', 'ออกรหัสเปิดใช้งานเจ้าหน้าที่',
          'บทบาท '||p_role||' ให้ชื่อผู้ใช้ '||v_user||' ลงท้าย '||right(v_code,4));

  return query select v_id, v_code;
end $fn$;

grant execute on function public.issue_staff_invite(text, cs_role, text, text, int) to authenticated;

-- ============================================================
-- เส้นทางแลกรหัสแบบเดิม (ผู้ใช้ที่ล็อกอินอยู่แล้ว) ยังต้องใช้ได้
-- แต่ต้องบังคับตั้งรหัสผ่านใหม่ด้วย เพื่อไม่ให้มีสองมาตรฐาน
-- ============================================================
create or replace function public.redeem_staff_invite(p_code text)
returns table (ok boolean, role cs_role, msg text)
language plpgsql security definer set search_path = public as $fn$
declare v record; v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return query select false, null::cs_role, 'ยังไม่ได้เข้าสู่ระบบ'; return;
  end if;

  select * into v from public.staff_invite
   where code_hash = encode(extensions.digest(upper(trim(p_code)),'sha256'),'hex');

  if not found then
    -- ไม่บอกว่าผิดตรงไหน เพื่อไม่ให้ไล่เดารหัสทีละหลักได้
    insert into public.audit_logs(actor_id, action, detail)
    values (v_uid, 'ใช้รหัสเปิดใช้งานไม่สำเร็จ', 'ไม่พบรหัสที่ตรงกัน');
    return query select false, null::cs_role, 'รหัสไม่ถูกต้อง หรือถูกใช้ไปแล้ว'; return;
  end if;
  if v.revoked_at is not null then
    return query select false, null::cs_role, 'รหัสนี้ถูกยกเลิกแล้ว'; return;
  end if;
  if v.used_at is not null then
    return query select false, null::cs_role, 'รหัสไม่ถูกต้อง หรือถูกใช้ไปแล้ว'; return;
  end if;
  if v.expires_at < now() then
    return query select false, null::cs_role, 'รหัสหมดอายุแล้ว ขอรหัสใหม่จากผู้ดูแลระบบ'; return;
  end if;
  if exists (select 1 from public.profiles where lower(username) = v.username and id <> v_uid) then
    return query select false, null::cs_role, 'ชื่อผู้ใช้ของรหัสนี้ถูกใช้งานแล้ว'; return;
  end if;

  update public.staff_invite set used_at = now(), used_by = v_uid where id = v.id;
  -- บทบาทมาจากรหัส ไม่ได้มาจากสิ่งที่ผู้สมัครกรอก จึงยกระดับตัวเองไม่ได้
  update public.profiles
     set role = v.role,
         username = v.username,
         must_set_password = true,
         display_name = coalesce(nullif(trim(v.display_name),''), display_name)
   where id = v_uid;

  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (v_uid, v.role, 'เปิดใช้งานบัญชีด้วยรหัสจากผู้ดูแลระบบ',
          'ได้รับบทบาท '||v.role||' จากรหัสลงท้าย '||v.code_hint);

  return query select true, v.role, 'ยืนยันรหัสเรียบร้อย';
end $fn$;

grant execute on function public.redeem_staff_invite(text) to authenticated;

-- ============================================================
-- สิทธิ์ระดับคอลัมน์ของ profiles
-- ------------------------------------------------------------
-- RLS ตัดสินว่า "แถวไหน" แก้ได้ แต่ไม่ได้ตัดสินว่า "คอลัมน์ไหน"
-- เดิม authenticated มีสิทธิ์ UPDATE ทั้งตาราง จึงยิง PATCH ตรงไปที่ API
-- แล้วตั้ง role ของตัวเองเป็น admin หรือปลดธง must_set_password ได้
-- โดยไม่ต้องแตะหน้าเว็บเลย · ตัดสิทธิ์ระดับตารางออก แล้วคืนเฉพาะคอลัมน์
-- ที่เจ้าของโปรไฟล์ควรแก้เองได้จริง คอลัมน์ที่ตัดสินสิทธิ์เหลือทางเดียว
-- คือฟังก์ชัน security definer ที่ตรวจสิทธิ์และบันทึกไว้เสมอ
-- ============================================================
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

grant update (display_name, phone, birth_year_be, birth_month, sex, share_pool,
              province, carer_phone, carer_name, mobility_aid,
              license_no, license_body, org_name)
  on public.profiles to authenticated;

-- เปลี่ยนบทบาทต้องผ่านฟังก์ชันที่ตรวจสิทธิ์ กันเปลี่ยนของตัวเอง
-- และกันไม่ให้ผู้ดูแลระบบคนสุดท้ายหายไปจากระบบ
create or replace function public.admin_set_role(p_uid uuid, p_role cs_role)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_old cs_role;
begin
  if public.cs_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนบทบาทได้';
  end if;
  if p_uid = auth.uid() then
    raise exception 'เปลี่ยนบทบาทของตัวเองไม่ได้';
  end if;
  select role into v_old from public.profiles where id = p_uid;
  if v_old is null then return false; end if;
  if v_old = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'ต้องเหลือผู้ดูแลระบบอย่างน้อยหนึ่งบัญชี';
  end if;
  update public.profiles set role = p_role where id = p_uid;
  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), 'admin', 'เปลี่ยนบทบาทผู้ใช้',
          'บัญชี '||p_uid::text||' จาก '||v_old||' เป็น '||p_role);
  return true;
end $fn$;

grant execute on function public.admin_set_role(uuid, cs_role) to authenticated;
