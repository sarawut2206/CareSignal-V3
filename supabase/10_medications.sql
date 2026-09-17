-- ============================================================
-- 10_medications.sql — Medication Classification Pipeline
-- ------------------------------------------------------------
--   รูปซองยา → OCR (ในเครื่อง) → ผู้ใช้ยืนยันชื่อ → จับคู่ตัวยาสำคัญ
--   → ATC → กลุ่ม FRID → เภสัชกรยืนยันเมื่อพบความเสี่ยง
--
-- หลักที่ยึด
--   * เก็บ "รายการยาต่อคน" เป็นตาราง ไม่ใช่ jsonb ในการประเมิน
--     เพราะยาอยู่ข้ามรอบประเมิน และเภสัชกรต้องแก้ทีละรายการได้
--   * ทุกรายการมี "ที่มา" (photo_ocr / manual / purpose_only) และ
--     "ผู้ยืนยัน" — ระบบไม่เดาแล้วบันทึกเป็นความจริง
--   * รูปซองยาเป็นข้อมูลสุขภาพ: bucket private · path ขึ้นต้นด้วย
--     user_id · อ่านได้เฉพาะเจ้าของและเจ้าหน้าที่ · ลบตามสิทธิ PDPA
--   * ระบบปักธง ไม่ตัดสิน — ไม่มีคอลัมน์ไหนบอกว่า "ควรหยุดยา"
-- ============================================================

-- ---------- รายการยาของสมาชิก ----------
create table if not exists public.medications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  -- สิ่งที่ผู้ใช้/เภสัชกรยืนยันว่า "ใช่ยานี้"
  inn           text,               -- ตัวยาสำคัญ (ชื่อสามัญ) เช่น diazepam · null = ยังไม่ระบุ
  brand_text    text,               -- ข้อความชื่อยาตามที่เห็นบนฉลาก (ก่อนจับคู่)
  dose_text     text,               -- เช่น "5 mg"
  freq_text     text,               -- เช่น "ก่อนนอน" / "1x2 pc"
  atc           text,               -- รหัส ATC ที่จับคู่ได้
  frid_group    text,               -- bzd | antidep | ... | none | unknown
  frid_level    smallint,           -- 2 = หลักฐานเข้ม · 1 = ปานกลาง · 0 = ไม่เสี่ยง · null = ไม่ทราบ
  purpose       text,               -- วัตถุประสงค์ที่ผู้ใช้เลือก (ทางถอยเมื่อไม่มีชื่อ)
  -- ที่มาและความมั่นใจ — เพื่อให้เภสัชกรรู้ว่าต้องเชื่อแค่ไหน
  source        text not null default 'manual',  -- photo_ocr | manual | purpose_only
  ocr_text      text,               -- ข้อความดิบที่ OCR อ่านได้ (เก็บไว้ตรวจย้อน)
  match_conf    numeric(3,2),       -- ความมั่นใจของการจับคู่ 0–1
  photo_path    text,               -- path ใน storage bucket med-photos
  confirmed_by  text not null default 'user',    -- user | carer | pharmacist
  -- การทบทวนโดยเภสัชกร
  reviewed_at   timestamptz,
  reviewed_by   uuid references public.profiles(id),
  review_note   text,
  active        boolean not null default true,   -- false = เลิกใช้แล้ว (ไม่ลบ เพื่อดูประวัติ)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists medications_user_idx on public.medications(user_id, active, created_at desc);
create index if not exists medications_review_idx on public.medications(reviewed_at) where reviewed_at is null and frid_level > 0;

-- ---------- การทบทวนยาโดยเภสัชกร (หนึ่งรอบต่อการส่งต่อ) ----------
create table if not exists public.med_reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  case_id      uuid references public.care_cases(id) on delete set null,
  referral_id  uuid references public.referrals(id) on delete set null,
  requested_at timestamptz not null default now(),
  reason       text,                 -- เช่น "FRID ระดับสูง 1 กลุ่ม" / "ยาไม่รู้จัก 2 รายการ"
  summary      jsonb,                -- {high, mod, unknown, groups[]} ณ ตอนขอทบทวน
  status       text not null default 'pending',   -- pending | done | declined
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles(id),
  outcome      text,                 -- ข้อสรุปของเภสัชกร (ข้อความอิสระ)
  recommend    text                  -- consult_doctor | monitor | no_action | adjusted_by_doctor
);
create index if not exists med_reviews_status_idx on public.med_reviews(status, requested_at);

-- ---------- สิทธิ์ ----------
alter table public.medications enable row level security;
alter table public.med_reviews enable row level security;

drop policy if exists meds_own    on public.medications;
drop policy if exists meds_staff  on public.medications;
drop policy if exists meds_family on public.medications;
create policy meds_own on public.medications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy meds_staff on public.medications
  for all using (cs_is_staff()) with check (cs_is_staff());
-- ครอบครัวเห็นเฉพาะเมื่อได้รับสิทธิ์ "meds" แยกต่างหาก (ตามชั้นสิทธิ์รายข้อ)
create policy meds_family on public.medications
  for select using (
    exists (select 1 from public.caregiver_links l
            where l.member_id = medications.user_id and l.carer_id = auth.uid()
              and l.status='approved' and coalesce(l.permissions->>'meds','false')='true')
  );

drop policy if exists mrev_own   on public.med_reviews;
drop policy if exists mrev_staff on public.med_reviews;
create policy mrev_own on public.med_reviews
  for select using (user_id = auth.uid());
create policy mrev_staff on public.med_reviews
  for all using (cs_is_staff()) with check (cs_is_staff());
-- ผู้ใช้ขอทบทวนได้เอง (insert) แต่แก้ผลไม่ได้
drop policy if exists mrev_own_insert on public.med_reviews;
create policy mrev_own_insert on public.med_reviews
  for insert with check (user_id = auth.uid());

-- ---------- Storage: รูปซองยา (private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('med-photos', 'med-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- path ต้องขึ้นต้นด้วย user_id ของตัวเอง: <uid>/<filename>
drop policy if exists medphoto_own_rw on storage.objects;
drop policy if exists medphoto_staff_r on storage.objects;
create policy medphoto_own_rw on storage.objects
  for all using (bucket_id = 'med-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'med-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy medphoto_staff_r on storage.objects
  for select using (bucket_id = 'med-photos' and cs_is_staff());

-- ---------- ขอทบทวนอัตโนมัติเมื่อบันทึกยาที่เข้าเกณฑ์ ----------
-- เกณฑ์: FRID ระดับ 2 อย่างน้อย 1 · หรือ ระดับ 1 ตั้งแต่ 2 · หรือ ยาไม่รู้จัก
-- เปิดคำขอได้ทีละหนึ่งต่อคน (pending ซ้ำไม่ได้)
create or replace function public.request_med_review_if_needed()
returns trigger language plpgsql security definer set search_path=public as $$
declare hi int; md int; un int; tot int; why text;
begin
  select
    count(*) filter (where frid_level = 2),
    count(*) filter (where frid_level = 1),
    count(*) filter (where frid_level is null or frid_group = 'unknown'),
    count(*)
  into hi, md, un, tot
  from medications where user_id = new.user_id and active;

  if hi >= 1 or md >= 2 or un >= 1 or tot >= 5 then
    why := concat_ws(' · ',
      case when hi > 0 then 'ยากลุ่มเสี่ยงสูง '||hi||' รายการ' end,
      case when md > 0 then 'ยากลุ่มเสี่ยงปานกลาง '||md||' รายการ' end,
      case when un > 0 then 'ยาที่ระบบไม่รู้จัก '||un||' รายการ' end,
      case when tot >= 5 then 'ใช้ยารวม '||tot||' รายการ' end);
    if not exists (select 1 from med_reviews where user_id = new.user_id and status = 'pending') then
      insert into med_reviews (user_id, reason, summary)
      values (new.user_id, why, jsonb_build_object('high',hi,'mod',md,'unknown',un,'total',tot));
    else
      update med_reviews set reason = why,
        summary = jsonb_build_object('high',hi,'mod',md,'unknown',un,'total',tot)
      where user_id = new.user_id and status = 'pending';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_med_review on public.medications;
create trigger trg_med_review
  after insert or update of frid_level, active on public.medications
  for each row execute function public.request_med_review_if_needed();

comment on table public.medications is
  'รายการยาต่อคนจาก Medication Classification Pipeline — ทุกรายการมีที่มา ความมั่นใจ และผู้ยืนยัน · ระบบปักธง FRID เพื่อส่งเภสัชกรทบทวน ไม่ตัดสินและไม่สั่งปรับยา';
comment on table public.med_reviews is
  'คำขอทบทวนยาโดยเภสัชกร — เปิดอัตโนมัติเมื่อพบยากลุ่มเสี่ยงหกล้ม ยาไม่รู้จัก หรือใช้ยาหลายรายการ';
