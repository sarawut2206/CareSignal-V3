-- ============================================================
-- 03_seed_staff.sql — ตั้งต้นระบบ: ผู้ดูแลระบบคนแรกเพียงคนเดียว
-- ------------------------------------------------------------
-- ไฟล์นี้เคยเป็น "สมัครบัญชีเองก่อน แล้วค่อยเลื่อนบทบาทด้วย SQL"
-- ซึ่งขัดกับกติกาปัจจุบัน: ไม่มีใครสมัครบัญชีเจ้าหน้าที่เองได้
-- ทุกบทบาทนอกจากผู้ดูแลระบบต้องเกิดจาก "รหัสเปิดใช้งาน" ที่ผู้ดูแลระบบออกให้
-- (18_staff_invite.sql, 19_staff_login.sql, functions/staff-activate)
--
-- แล้วผู้ดูแลระบบคนแรกมาจากไหน ในเมื่อยังไม่มีใครออกรหัสให้ได้
--   ไฟล์นี้แหละ — ใส่รหัสเปิดใช้งานหนึ่งใบสำหรับชื่อผู้ใช้ admin ลงตาราง
--   staff_invite โดยตรง แล้วคนที่ถือรหัสไปเข้าหน้า login ของคอนโซล
--   ด้วย "admin + รหัสนี้" ระบบจะสร้างบัญชีให้และบังคับตั้งรหัสผ่านของตัวเอง
--   ไม่มีใครรวมทั้งคนรันสคริปต์นี้ที่รู้รหัสผ่านของผู้ดูแลระบบ
--
-- เงื่อนไขก่อนรัน
--   * ต้องยังไม่มีบัญชี admin และไม่มีรหัส admin ที่ยังเปิดอยู่ (สคริปต์ตรวจให้)
--   * ตัวรหัสจะแสดงในผลลัพธ์ "ครั้งเดียว" ฐานข้อมูลเก็บแค่แฮช
--     ปิดหน้าต่างแล้วหาย ต้องรันใหม่ (ใบเดิมจะถูกยกเลิกให้อัตโนมัติ)
--   * รหัสมีอายุ 14 วัน ให้ใช้ก่อนหมดอายุ
-- ============================================================

do $$
begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'มีผู้ดูแลระบบอยู่แล้ว — ให้คนนั้นออกรหัสจากเมนู "จัดการผู้ใช้" แทนการรันไฟล์นี้';
  end if;
end $$;

-- ยกเลิกรหัส admin ใบเก่าที่ยังไม่ถูกใช้ (กรณีรันซ้ำเพราะทำรหัสหาย)
update public.staff_invite set revoked_at = now()
 where username = 'admin' and used_at is null and revoked_at is null;

with f as (
  select substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4) as code
  from (select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1+floor(random()*31)::int, 1), '') as raw
        from generate_series(1,12)) r
), ins as (
  insert into public.staff_invite(code_hash, code_hint, username, role, display_name, note, expires_at)
  select encode(extensions.digest(code,'sha256'),'hex'), right(code,4), 'admin', 'admin',
         'ผู้ดูแลระบบ', 'รหัสตั้งต้นจาก 03_seed_staff.sql', now() + interval '14 days'
  from f returning username, role, expires_at
)
-- ผลลัพธ์บรรทัดเดียวนี้คือรหัสที่ต้องส่งให้ผู้ดูแลระบบ — แสดงครั้งเดียว
select ins.username, ins.role, f.code, ins.expires_at from ins, f;
