-- ============================================================
-- 17_age_bands.sql — รวมนิยามช่วงอายุให้เหลือชุดเดียว
-- ------------------------------------------------------------
-- ปัญหาที่แก้
--   ระบบมีนิยามช่วงอายุอยู่สามชุดที่ไม่ตรงกัน
--     * insurer_portfolio  50-54 / 55-59 / 60-65 / 66-70 (ข้อสุดท้ายเป็น catch-all)
--     * insurer_strata     50-59 / 60-69 / 70+
--     * CFG.ageBand ในแอป  ชุดเดียวกับ insurer_portfolio
--
--   ผลของ catch-all: คนอายุ 72 หรือ 85 ถูกรายงานว่าอยู่ช่วง "66-70"
--   แดชบอร์ดบริษัทประกันจึงไม่มีใครอายุเกิน 70 เลยสักคน ทั้งที่เป็น
--   ผลิตภัณฑ์ที่จับกลุ่มผู้สูงอายุโดยตรง
--
--   อีกจุดที่เพี้ยน: ป้ายช่วงอายุถูกใช้กำกับเกณฑ์เวลาลุกนั่งด้วย
--   แต่เกณฑ์นั้นแบ่งที่ 60 กับ 70 ไม่ใช่ 55/60/66 คนอายุ 72 จึงเห็นข้อความว่า
--   "สูงกว่าเกณฑ์ของช่วงอายุ 66–70 ปี (12.1 วินาที)" ซึ่ง 12.1 เป็นเกณฑ์ของ 70+
--
-- สิ่งที่ทำ
--   ฝั่งฐานข้อมูล — cs_age_band() ตัวเดียว ใช้ทั้ง insurer_portfolio และ insurer_strata
--   ฝั่งแอป      — แยกเป็นสองฟังก์ชันตามงานจริง
--                  ftsstBand() สำหรับป้ายเกณฑ์คลินิก แบ่งตรงกับ ftsstCut
--                  ageBand()   สำหรับรายงานประชากร ครอบคลุมทุกอายุ
-- ============================================================

create or replace function public.cs_age_band(p_birth_year_be int)
returns text language sql immutable as $fn$
  select case
    when (extract(year from now())::int + 543) - p_birth_year_be < 60 then '50–59'
    when (extract(year from now())::int + 543) - p_birth_year_be < 70 then '60–69'
    when (extract(year from now())::int + 543) - p_birth_year_be < 80 then '70–79'
    else '80+'
  end;
$fn$;
grant execute on function public.cs_age_band(int) to authenticated;

comment on function public.cs_age_band is
  'ช่วงอายุชุดเดียวของทั้งระบบ — แบ่งที่ 60 และ 70 ให้ตรงกับเกณฑ์เวลาลุกนั่ง แล้วแยก 80+ ออกมาเพื่อให้รายงานผู้สูงอายุมีความละเอียดพอ';

-- insurer_portfolio และ insurer_strata ถูกสร้างใหม่ให้เรียก cs_age_band
-- (นิยามเต็มอยู่ใน 11_dashboards.sql ที่ปรับแล้ว)
