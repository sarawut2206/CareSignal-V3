-- ============================================================
-- 18_staff_invite.sql — รหัสเชิญที่ผู้ดูแลระบบออกให้เจ้าหน้าที่
-- ------------------------------------------------------------
-- ปัญหาที่แก้
--   เดิมใครก็สมัครบัญชีเจ้าหน้าที่เองได้ แล้วรอผู้ดูแลระบบมากำหนดบทบาททีหลัง
--   ช่วงระหว่างนั้นบัญชีมีสิทธิ์ระดับ user และเข้าคอนโซลไม่ได้ก็จริง
--   แต่แปลว่า "ใครก็ตามที่รู้ที่อยู่หน้าเว็บ สร้างบัญชีค้างไว้ได้ไม่จำกัด"
--   ซึ่งไม่เหมาะกับระบบที่ปลายทางคือข้อมูลสุขภาพ
--
-- ที่เปลี่ยนเป็น
--   ผู้ดูแลระบบออก "รหัสเชิญ" ผูกกับบทบาทและชื่อผู้ใช้ไว้ล่วงหน้า
--   เจ้าหน้าที่จะสมัครได้ก็ต่อเมื่อกรอกรหัสที่ตรงกับที่ออกไว้เท่านั้น
--   รหัสหนึ่งใบใช้ได้ครั้งเดียว มีวันหมดอายุ และเพิกถอนได้ทุกเมื่อ
--
-- หลักที่ยึด
--   * อ้าง extensions.digest แบบเต็ม เพราะ pgcrypto ของ Supabase อยู่ใน schema
--     extensions ไม่ใช่ public และฟังก์ชันเราตั้ง search_path = public ไว้เพื่อ
--     กันการถูกสลับฟังก์ชันด้วย search_path ที่ผู้เรียกควบคุม
--   * รหัสเก็บเป็นแฮชเท่านั้น ตัวรหัสจริงแสดงให้ผู้ดูแลระบบเห็นครั้งเดียว
--     ตอนสร้าง แล้วไม่มีใครอ่านย้อนได้อีก รวมถึงผู้ดูแลระบบเอง
--     เพราะฐานข้อมูลที่หลุดไม่ควรกลายเป็นกุญแจเข้าระบบ
--   * การแลกรหัสทำในฟังก์ชันฝั่งเซิร์ฟเวอร์แบบ security definer
--     ผู้สมัครจึงไม่ต้องมีสิทธิ์อ่านตารางรหัสเลยแม้แต่แถวเดียว
--   * บทบาทมาจากรหัส ไม่ได้มาจากสิ่งที่ผู้สมัครกรอก จึงยกระดับตัวเองไม่ได้
-- ============================================================

create table if not exists public.staff_invite (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null,                  -- แฮชของรหัส ไม่เก็บตัวรหัสจริง
  code_hint    text not null,                  -- ตัวท้าย 4 หลัก ไว้ให้ผู้ดูแลระบบอ้างอิงเวลาคุยกัน
  username     text not null,                  -- ชื่อผู้ใช้ที่ตั้งไว้ให้ล่วงหน้า
  role         cs_role not null,
  display_name text,
  note         text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '30 days'),
  used_at      timestamptz,
  used_by      uuid references public.profiles(id),
  revoked_at   timestamptz
);
create unique index if not exists staff_invite_hash on public.staff_invite(code_hash);
create index if not exists staff_invite_open on public.staff_invite(role) where used_at is null and revoked_at is null;

-- ห้ามออกรหัสให้บทบาท user ธรรมดา เพราะช่องทางนี้มีไว้สำหรับเจ้าหน้าที่เท่านั้น
alter table public.staff_invite drop constraint if exists staff_invite_role_ck;
alter table public.staff_invite add constraint staff_invite_role_ck check (role <> 'user');

alter table public.staff_invite enable row level security;

-- เห็นและจัดการได้เฉพาะผู้ดูแลระบบ และถึงอย่างนั้นก็ยังอ่านตัวรหัสจริงไม่ได้
drop policy if exists invite_admin_all on public.staff_invite;
create policy invite_admin_all on public.staff_invite
  for all using (public.cs_role() = 'admin') with check (public.cs_role() = 'admin');

-- ============================================================
-- ออกรหัสใหม่ — คืนตัวรหัสจริงกลับไปครั้งเดียวเท่านั้น
-- ============================================================
create or replace function public.issue_staff_invite(
  p_username text, p_role cs_role, p_display_name text default null,
  p_note text default null, p_days int default 30)
returns table (invite_id uuid, code text)
language plpgsql security definer set search_path = public as $fn$
declare v_code text; v_id uuid;
begin
  if public.cs_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ออกรหัสได้';
  end if;
  if p_role = 'user' then
    raise exception 'ช่องทางนี้ออกรหัสให้บทบาทเจ้าหน้าที่เท่านั้น';
  end if;
  if coalesce(trim(p_username),'') = '' then
    raise exception 'ต้องระบุชื่อผู้ใช้';
  end if;

  -- รหัส 12 ตัวอักษรจากอักขระที่อ่านออกเสียงแล้วไม่กำกวม
  -- ตัด 0 O 1 I L ออก เพราะรหัสนี้ถูกอ่านให้ฟังทางโทรศัพท์บ่อย
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
           1 + floor(random()*31)::int, 1), '')
    into v_code from generate_series(1,12);
  v_code := substr(v_code,1,4)||'-'||substr(v_code,5,4)||'-'||substr(v_code,9,4);

  insert into public.staff_invite(code_hash, code_hint, username, role, display_name, note,
                                  created_by, expires_at)
  values (encode(extensions.digest(v_code,'sha256'),'hex'), right(v_code,4), lower(trim(p_username)),
          p_role, p_display_name, p_note, auth.uid(),
          now() + make_interval(days => greatest(1, least(365, coalesce(p_days,30)))))
  returning id into v_id;

  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), 'admin', 'ออกรหัสเชิญเจ้าหน้าที่',
          'บทบาท '||p_role||' ให้ชื่อผู้ใช้ '||lower(trim(p_username))||' ลงท้าย '||right(v_code,4));

  return query select v_id, v_code;
end $fn$;

-- ============================================================
-- แลกรหัส — ผู้สมัครเรียกหลังยืนยันตัวตนแล้ว เพื่อรับบทบาทตามที่ออกไว้
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
    values (v_uid, 'ใช้รหัสเชิญไม่สำเร็จ', 'ไม่พบรหัสที่ตรงกัน');
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

  update public.staff_invite set used_at = now(), used_by = v_uid where id = v.id;
  -- บทบาทมาจากรหัส ไม่ได้มาจากสิ่งที่ผู้สมัครกรอก จึงยกระดับตัวเองไม่ได้
  update public.profiles
     set role = v.role,
         display_name = coalesce(nullif(trim(v.display_name),''), display_name)
   where id = v_uid;

  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (v_uid, v.role, 'ใช้รหัสเชิญเข้าระบบ',
          'ได้รับบทบาท '||v.role||' จากรหัสลงท้าย '||v.code_hint);

  return query select true, v.role, 'ยืนยันรหัสเรียบร้อย';
end $fn$;

-- ============================================================
-- รายการรหัสสำหรับผู้ดูแลระบบ — ไม่มีตัวรหัสจริงในผลลัพธ์
-- ============================================================
create or replace function public.list_staff_invites()
returns table (id uuid, username text, role cs_role, display_name text, note text,
               code_hint text, created_at timestamptz, expires_at timestamptz,
               used_at timestamptz, revoked_at timestamptz, status text)
language sql security definer set search_path = public as $fn$
  select i.id, i.username, i.role, i.display_name, i.note, i.code_hint,
         i.created_at, i.expires_at, i.used_at, i.revoked_at,
         case when i.revoked_at is not null then 'revoked'
              when i.used_at is not null then 'used'
              when i.expires_at < now() then 'expired'
              else 'open' end
    from public.staff_invite i
   where public.cs_role() = 'admin'
   order by i.created_at desc
   limit 200;
$fn$;

create or replace function public.revoke_staff_invite(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
begin
  if public.cs_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;
  update public.staff_invite set revoked_at = now()
   where id = p_id and used_at is null and revoked_at is null;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), 'admin', 'ยกเลิกรหัสเชิญ', 'รหัส id '||p_id::text);
  return true;
end $fn$;

grant execute on function public.issue_staff_invite(text, cs_role, text, text, int) to authenticated;
grant execute on function public.redeem_staff_invite(text) to authenticated;
grant execute on function public.list_staff_invites() to authenticated;
grant execute on function public.revoke_staff_invite(uuid) to authenticated;
