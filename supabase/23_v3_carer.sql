-- ============================================================
-- 23_v3_carer.sql — รองรับ CareSignal V3 (ลูกหลานเป็นผู้วัด ไม่ใช้กล้อง)
-- ------------------------------------------------------------
-- V3 ใช้ตารางเดียวกับ V2 ทั้งหมด เพื่อให้คอนโซลเจ้าหน้าที่ คิวเคส และใบส่งต่อ
-- เห็นผลจาก V3 โดยไม่ต้องแก้หน้าจอฝั่งเจ้าหน้าที่แม้แต่บรรทัดเดียว
--   · บัญชี 1 บัญชี = ผู้สูงอายุ 1 คน ที่ลูกหลานเป็นผู้ดูแลบัญชีให้ (profiles.carer_name/carer_phone)
--   · assessments.method = 'manual' และ detail.measured_by = 'carer'
--   · risk_signals → open_case_on_signal (09) เปิดเคสให้เหมือนเดิม
-- ไฟล์นี้เพิ่ม 3 อย่าง รันซ้ำได้:
--   1. คอลัมน์ที่โปรไฟล์และหน้าจอเจ้าหน้าที่ใช้อยู่แล้วแต่ไม่มีในไฟล์ migration ก่อนหน้า
--   2. ทริกเกอร์: ครอบครัว "บันทึกว่าล้ม" (care_events.kind = fall) → เปิดหรือยกระดับเคสทันที
--      เพราะการล้มจริงต้องมีคนรับผิดชอบเร็วกว่ารอรอบประเมินถัดไป
--   3. view สรุปให้แอปครอบครัวอ่านสถานะเคสและการส่งต่อของตัวเองในคำสั่งเดียว
-- ============================================================

-- ---------- 1. คอลัมน์ที่ต้องมี ----------
alter table public.profiles
  add column if not exists carer_name   text,
  add column if not exists carer_phone  text,
  add column if not exists mobility_aid text,
  add column if not exists province     text;

alter table public.assessments
  add column if not exists detail jsonb;          -- (22) ถ้ายังไม่รัน

alter table public.risk_signals
  add column if not exists signals jsonb not null default '[]'::jsonb;

comment on column public.profiles.carer_name is
  'V3: ชื่อลูกหลานที่ดูแลบัญชีและเป็นผู้จับเวลาให้ · เจ้าหน้าที่ติดต่อคนนี้ก่อน';

-- ---------- 2. ล้มแล้วรายงาน → เปิดเคส ----------
-- severity high (บาดเจ็บต้องพบแพทย์ / ลุกเองไม่ได้) = urgent 24 ชม. · อื่น ๆ = decline 48 ชม.
-- near_fall = watch 72 ชม. · ถ้ามีเคสเปิดอยู่แล้ว ยกระดับและเพิ่มสัญญาณ ไม่เปิดซ้ำ
create or replace function public.open_case_on_fall_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare lvl cs_risk_level; sla int; sig jsonb;
begin
  if new.kind not in ('fall','near_fall') then return new; end if;
  lvl := case when new.kind = 'near_fall' then 'watch'
              when coalesce(new.severity,'medium') = 'high' then 'urgent'
              else 'decline' end;
  sla := case lvl when 'urgent' then 24 when 'decline' then 48 else 72 end;
  sig := jsonb_build_array(jsonb_build_object(
           'k', 'S1', 'nm', case when new.kind='near_fall' then 'เกือบล้ม (ครอบครัวรายงาน)' else 'หกล้มครั้งใหม่ (ครอบครัวรายงาน)' end,
           'sev', case lvl when 'urgent' then 3 when 'decline' then 2 else 1 end,
           'dest', 'doctor',
           'act', 'ติดต่อครอบครัวภายในกำหนด ทบทวนสาเหตุการล้ม และนัดประเมินซ้ำ',
           'why', jsonb_build_array(coalesce(new.detail->>'where','ไม่ระบุสถานที่'), coalesce(new.detail->>'injury',''))));

  update care_cases
     set level = case when array_position(array['stable','watch','decline','urgent']::text[], lvl::text)
                        > array_position(array['stable','watch','decline','urgent']::text[], level::text)
                      then lvl else level end,
         signals    = coalesce(signals,'[]'::jsonb) || sig,
         sla_hours  = least(sla_hours, sla),
         next_action = 'ครอบครัวรายงานว่าล้ม ' || to_char(new.created_at at time zone 'Asia/Bangkok','DD/MM HH24:MI') || ' — ติดต่อกลับ',
         updated_at = now()
   where user_id = new.user_id and status not in ('stable','closed');
  if found then return new; end if;

  insert into care_cases (user_id, level, signals, sla_hours, next_action, due_at)
  values (new.user_id, lvl, sig, sla,
          'ครอบครัวรายงานว่าล้ม — ติดต่อกลับและนัดประเมินซ้ำ',
          new.created_at + make_interval(hours => sla));
  return new;
end $$;

drop trigger if exists trg_open_case_on_fall_event on public.care_events;
create trigger trg_open_case_on_fall_event
  after insert on public.care_events
  for each row execute function public.open_case_on_fall_event();

-- ---------- 3. สถานะการดูแลของฉัน (แอปครอบครัวอ่าน) ----------
-- RLS ของตารางต้นทางยังคุมอยู่ (security_invoker) จึงเห็นเฉพาะของตัวเอง
create or replace view public.my_care_status
with (security_invoker = true) as
select c.id as case_id, c.user_id, c.level, c.status, c.opened_at, c.due_at, c.next_action,
       c.contacted_at, c.closed_at,
       (select count(*) from public.referrals r where r.case_id = c.id) as referral_count,
       (select string_agg(coalesce(r.destination,'-') || ':' || r.status::text, ', ' order by r.created_at)
          from public.referrals r where r.case_id = c.id) as referrals
  from public.care_cases c
 where c.user_id = auth.uid();
grant select on public.my_care_status to authenticated;

comment on function public.open_case_on_fall_event is
  'V3: ครอบครัวกด "บันทึกว่าล้ม" แล้วต้องมีเจ้าหน้าที่รับผิดชอบทันที ไม่รอรอบประเมิน';
