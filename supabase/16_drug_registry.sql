-- ============================================================
-- 16_drug_registry.sql — เชื่อมทะเบียนตำรับยาของ อย. เข้ากับการจัดกลุ่ม FRID
-- ------------------------------------------------------------
-- ปัญหาที่แก้
--   ฐานยาในเครื่องมีตัวยาสำคัญ 170 รายการ ครอบคลุมยาที่เกี่ยวกับการหกล้ม
--   แต่ไม่ใช่ทะเบียนยาทั้งประเทศ ฉลากที่ผู้ใช้ถ่ายมามักเป็น "ชื่อการค้า"
--   ซึ่งในไทยมีหลายหมื่นชื่อ ระบบจึงตอบว่า "ไม่รู้จักยานี้" บ่อยเกินไป
--
-- สิ่งที่เพิ่ม
--   ชั้นค้นทะเบียนตำรับยาจากเว็บเซอร์วิสของสำนักงานคณะกรรมการอาหารและยา
--   (porta.fda.moph.go.th · GET_DATA_DRUG / GET_DRUG_INFORMATION)
--   ผ่าน edge function แล้วแคชผลไว้ในตารางนี้
--
-- ลำดับการจับคู่ (ล่างสุดคือทางออกที่ปลอดภัยเสมอ)
--   1. drug_alias         — ชื่อที่คนตรวจแล้ว (ฐาน 170 ตัวยา + ที่เภสัชกรยืนยัน)
--   2. drug_registry      — แคชจากทะเบียน อย.
--   3. เรียก อย. สด        — แล้วเก็บลงแคช
--   4. drug_unknown_queue — ส่งให้เภสัชกรจัดกลุ่ม พร้อมรูปฉลาก
--
-- หลักที่ยึด (เหมือนเดิม)
--   * ระบบปักธง ไม่ตัดสิน — ไม่มีคอลัมน์ไหนบอกว่า "ควรหยุดยา"
--   * จับคู่ผิดอันตรายกว่าไม่รู้จัก จึงจัดกลุ่มอัตโนมัติเฉพาะเมื่อได้รหัส
--     ATC ขององค์การอนามัยโลกเต็ม 7 หลัก และกฎไม่กำกวมเท่านั้น
--     รหัสกลุ่มแบบเก่าของ อย. (เช่น M01A1) ไม่พอให้ตัดสิน → ส่งเภสัชกร
--   * ชื่อยาที่ส่งไปค้นไม่ผูกกับตัวบุคคล — edge function ไม่ส่ง user_id
--     ออกไปนอกระบบ และไม่บันทึกว่าใครค้นอะไรลงตารางแคช
-- ============================================================

-- ---------- ชื่อที่ "คนตรวจแล้ว" ว่าหมายถึงตัวยาอะไร ----------
create table if not exists public.drug_alias (
  id           uuid primary key default gen_random_uuid(),
  alias        text not null,          -- ข้อความที่ normalize แล้ว (ตัวพิมพ์เล็ก ไม่มีช่องว่างซ้ำ)
  inn          text not null,          -- ตัวยาสำคัญ
  atc          text,
  frid_group   text not null default 'unknown',
  frid_level   smallint,
  source       text not null default 'curated',  -- curated | pharmacist | fda_registry
  approved_by  uuid references public.profiles(id),
  approved_at  timestamptz,
  note         text,
  created_at   timestamptz not null default now()
);
create unique index if not exists drug_alias_key on public.drug_alias(alias);
create index if not exists drug_alias_inn on public.drug_alias(inn);

-- ---------- แคชทะเบียนตำรับยาจาก อย. ----------
create table if not exists public.drug_registry (
  id            uuid primary key default gen_random_uuid(),
  query_key     text not null,          -- คำค้นที่ normalize แล้ว
  trade_name    text,                   -- ชื่อการค้าตามทะเบียน (produceng)
  reg_no        text,                   -- เลขทะเบียนตำรับยา (lcnno)
  fda_code      text,                   -- รหัสอ้างอิงของ อย. (Newcode)
  atc           text,                   -- รหัสที่ทะเบียนให้มา
  atc_kind      text,                   -- who = ATC เต็ม 7 หลัก · fda_group = รหัสกลุ่มเก่า
  inn           text,                   -- ตัวยาสำคัญ (ได้เมื่อ atc_kind = who)
  strength      text,
  drug_class    text,                   -- ยาอันตราย / ยาควบคุมพิเศษ / ยาสามัญประจำบ้าน
  licensee      text,
  status        text not null default 'active',   -- active | cancelled
  frid_group    text not null default 'unknown',
  frid_level    smallint,
  classified_by text not null default 'none',     -- alias | atc_rule | none
  source_url    text,
  fetched_at    timestamptz not null default now(),
  raw           jsonb
);
create index if not exists drug_registry_key on public.drug_registry(query_key, status);
create index if not exists drug_registry_trade on public.drug_registry(lower(trade_name));

-- ---------- ยาที่ยังจัดกลุ่มไม่ได้ รอเภสัชกร ----------
create table if not exists public.drug_unknown_queue (
  id             uuid primary key default gen_random_uuid(),
  medication_id  uuid references public.medications(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  label_text     text,                  -- ข้อความที่ OCR อ่านได้
  guess_name     text,                  -- ชื่อที่ผู้ใช้พิมพ์หรือระบบเดา
  photo_path     text,                  -- รูปฉลากใน bucket med-photos
  registry_hits  jsonb,                 -- สิ่งที่ทะเบียน อย. ตอบกลับมา (ถ้ามี)
  status         text not null default 'pending',  -- pending | resolved | not_a_drug
  resolved_inn   text,
  resolved_group text,
  resolved_by    uuid references public.profiles(id),
  resolved_at    timestamptz,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists drug_queue_status on public.drug_unknown_queue(status, created_at);

-- ============================================================
-- รหัส ATC → กลุ่มเสี่ยงหกล้ม (STOPPFall 2021 · AGS Beers 2023)
-- ------------------------------------------------------------
-- รับเฉพาะรหัสเต็มขององค์การอนามัยโลก 7 หลัก (ตัวอักษร+2เลข+2ตัวอักษร+2เลข)
-- รหัสกลุ่มแบบเก่าของ อย. เช่น M01A1 หรือ A02B2 คืน unknown เสมอ
-- เพราะบอกได้แค่หมวดกว้าง ไม่พอจะบอกว่าเป็นตัวยาที่เพิ่มความเสี่ยงหกล้มหรือไม่
--
-- ข้อยกเว้นที่ต้องระบุชัด: R06A รวมทั้งยาแก้แพ้ที่ทำให้ง่วงและไม่ง่วง
-- จึงไล่เฉพาะรุ่นที่ง่วง และกันรุ่นใหม่ออกเป็น none
-- ============================================================
-- รอบแรกเขียนกฎจากคำนำหน้า ATC ล้วน ๆ แล้วเอามาเทียบกับฐาน 170 ตัวยาที่จัดมือไว้
-- พบว่ากฎปักธง "ต่ำกว่า" ความจริง 9 ตัว คือ codeine · methadone · benztropine ·
-- dicyclomine · cinnarizine · flunarizine · dextromethorphan · nitroglycerin · isosorbide
-- ทิศทางที่ยอมได้คือปักธงเกิน เพราะปลายทางคือเภสัชกรทบทวน ส่วนปักธงขาดคือพลาดเงียบ
-- รุ่นนี้ตรงกับฐานที่จัดมือ 166 จาก 170 · อีก 4 ตัวเป็นรหัสระดับกลุ่ม กฎจึงคืน unknown
create or replace function public.cs_atc_to_frid(p_atc text)
returns table (frid_group text, frid_level smallint)
language plpgsql immutable as $fn$
declare a text;
begin
  a := upper(regexp_replace(coalesce(p_atc,''), '\s', '', 'g'));

  if a !~ '^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$' then
    return query select 'unknown'::text, null::smallint; return;
  end if;

  -- ---- ข้อยกเว้นที่ระบุรหัสตรงตัว ต้องดักก่อนกฎหมวด ----
  -- ยาแก้แพ้รุ่นใหม่ที่ไม่ทำให้ง่วง
  if a in ('R06AE07','R06AX13','R06AX26','R06AX27','R06AX28') then
    return query select 'none'::text, 0::smallint; return;
  -- betahistine ไม่กดประสาท ต่างจาก cinnarizine/flunarizine ในหมวดเดียวกัน
  elsif a = 'N07CA01' then
    return query select 'none'::text, 0::smallint; return;
  -- ยาแก้ไอที่เป็น opioid — หมวด R05DA ปนกันระหว่าง opioid กับยากดไอส่วนกลาง
  elsif a in ('R05DA01','R05DA04','R05DA08','R05DA20') then
    return query select 'opioid'::text, 2::smallint; return;
  -- clonazepam อยู่หมวดยากันชักแต่เป็น benzodiazepine
  elsif a like 'N03AE%' then
    return query select 'bzd'::text, 2::smallint; return;
  end if;

  -- ---- ระดับ 2 หลักฐานเข้มว่าสัมพันธ์กับการหกล้ม ----
  if a like 'N05BA%' or a like 'N05CD%' or a like 'N05CF%' then
    return query select 'bzd'::text, 2::smallint;
  elsif a like 'N06A%' then
    return query select 'antidep'::text, 2::smallint;
  elsif a like 'N05A%' and a not like 'N05AN%' then
    return query select 'antipsy'::text, 2::smallint;
  elsif a like 'N03A%' then
    return query select 'anticonv'::text, 2::smallint;
  -- N07BC = ยารักษาการติดสารเสพติด (methadone · buprenorphine) เป็น opioid
  elsif a like 'N02A%' or a like 'N07BC%' then
    return query select 'opioid'::text, 2::smallint;
  -- N04AB/N04AC = benztropine · biperiden · A03AA = ยาคลายเกร็งลำไส้ฤทธิ์ต้านโคลิเนอร์จิก
  elsif a like 'N04AA%' or a like 'N04AB%' or a like 'N04AC%'
        or a like 'A03BA%' or a like 'A03BB%' or a like 'A03AA%' then
    return query select 'anticho'::text, 2::smallint;

  -- ---- ระดับ 1 ปานกลาง ขึ้นกับบริบท ----
  elsif a like 'M03B%' then
    return query select 'relax'::text, 1::smallint;
  -- R05DA ที่เหลือ = ยากดไอส่วนกลาง (dextromethorphan) · N07CA = ยาแก้เวียนศีรษะที่กดประสาท
  elsif a like 'R06AA%' or a like 'R06AB%' or a like 'R06AD%'
        or a like 'R05DA%' or a like 'N07CA%'
        or a in ('R06AE03','R06AE05','R06AX02','N05BB01') then
    return query select 'antihist'::text, 1::smallint;
  -- สูตรผสมที่มียาขับปัสสาวะอยู่ด้วย นับเป็นยาขับปัสสาวะ
  elsif a like 'C03%' or a like 'C09BA%' or a like 'C09DA%' or a like 'C07B%' or a like 'C07C%' then
    return query select 'diuretic'::text, 1::smallint;
  elsif a like 'C02CA%' or a like 'G04CA%' then
    return query select 'alpha'::text, 1::smallint;
  elsif a like 'G04BD%' then
    return query select 'bladder'::text, 1::smallint;
  -- C01DA = ยากลุ่มไนเตรต ทำให้ความดันตกเวลาลุกยืน
  elsif a like 'C01DA%' or a like 'C02%' or a like 'C07%' or a like 'C08%' or a like 'C09%' then
    return query select 'antihtn'::text, 1::smallint;
  else
    return query select 'none'::text, 0::smallint;
  end if;
end $fn$;

comment on function public.cs_atc_to_frid is
  'ATC ขององค์การอนามัยโลก to กลุ่มเสี่ยงหกล้มตาม STOPPFall 2021 · รับเฉพาะรหัสเต็ม 7 หลัก รหัสกลุ่มเก่าของ อย. คืน unknown';

-- ============================================================
-- ค้นชื่อยาจากชั้นที่คนตรวจแล้วก่อน แล้วค่อยแคชทะเบียน
-- ------------------------------------------------------------
-- คืน source เสมอ เพื่อให้หน้าจอบอกผู้ใช้ได้ตรงว่าใครเป็นคนบอก
-- ============================================================
create or replace function public.cs_lookup_drug(p_name text)
returns table (inn text, atc text, frid_group text, frid_level smallint,
               trade_name text, reg_no text, source text)
language sql stable security definer set search_path = public as $fn$
  with k as (select lower(regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g')) as q)
  select a.inn, a.atc, a.frid_group, a.frid_level, null::text, null::text, a.source
    from drug_alias a, k where a.alias = k.q
  union all
  select r.inn, r.atc, r.frid_group, r.frid_level, r.trade_name, r.reg_no, 'fda_registry'::text
    from drug_registry r, k
   where r.query_key = k.q and r.status = 'active'
     and not exists (select 1 from drug_alias a2, k k2 where a2.alias = k2.q)
   limit 5;
$fn$;
grant execute on function public.cs_lookup_drug(text) to authenticated;
grant execute on function public.cs_atc_to_frid(text) to authenticated;

-- ============================================================
-- สิทธิ์
-- ------------------------------------------------------------
-- ตารางความรู้เรื่องยา (alias · registry) ไม่ใช่ข้อมูลส่วนบุคคล
-- ผู้ใช้ที่ล็อกอินแล้วอ่านได้ทุกคน แต่เขียนได้เฉพาะเภสัชกรและระบบ
-- ส่วนคิวยาที่ยังจัดกลุ่มไม่ได้ ผูกกับตัวบุคคล จึงคุมเข้มเท่ารายการยา
-- ============================================================
alter table public.drug_alias         enable row level security;
alter table public.drug_registry      enable row level security;
alter table public.drug_unknown_queue enable row level security;

drop policy if exists alias_read     on public.drug_alias;
drop policy if exists alias_pharm_rw on public.drug_alias;
create policy alias_read on public.drug_alias for select using (auth.uid() is not null);
create policy alias_pharm_rw on public.drug_alias for all
  using (public.cs_role() in ('pharmacist','admin'))
  with check (public.cs_role() in ('pharmacist','admin'));

drop policy if exists registry_read on public.drug_registry;
create policy registry_read on public.drug_registry for select using (auth.uid() is not null);
-- การเขียนแคชทำผ่าน edge function ด้วย service role เท่านั้น (ข้าม RLS)

drop policy if exists dq_own        on public.drug_unknown_queue;
drop policy if exists dq_own_insert on public.drug_unknown_queue;
drop policy if exists dq_pharm      on public.drug_unknown_queue;
drop policy if exists dq_coord      on public.drug_unknown_queue;
create policy dq_own on public.drug_unknown_queue for select using (user_id = auth.uid());
create policy dq_own_insert on public.drug_unknown_queue for insert with check (user_id = auth.uid());
create policy dq_pharm on public.drug_unknown_queue for all
  using (public.cs_role() in ('pharmacist','admin'))
  with check (public.cs_role() in ('pharmacist','admin'));
create policy dq_coord on public.drug_unknown_queue for select using (public.cs_role() = 'care_manager');

-- ============================================================
-- เภสัชกรจัดกลุ่มยาที่ระบบไม่รู้จัก แล้วระบบจำไว้ใช้ครั้งต่อไป
-- ------------------------------------------------------------
-- เขียน alias ให้ชื่อที่ผู้ใช้พิมพ์ เพื่อให้คนถัดไปที่ถ่ายยาตัวเดียวกัน
-- ได้คำตอบทันทีโดยไม่ต้องรอเภสัชกรอีกรอบ
-- ============================================================
create or replace function public.resolve_unknown_drug(
  p_queue_id uuid, p_inn text, p_group text, p_atc text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare q record; lv smallint;
begin
  if public.cs_role() not in ('pharmacist','admin') then
    raise exception 'เฉพาะเภสัชกรเท่านั้นที่จัดกลุ่มยาได้';
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
           confirmed_by='pharmacist', reviewed_at=now(), reviewed_by=auth.uid(),
           updated_at=now()
     where id = q.medication_id;
  end if;

  if coalesce(q.guess_name,'') <> '' then
    insert into drug_alias(alias, inn, atc, frid_group, frid_level, source, approved_by, approved_at, note)
    values (lower(regexp_replace(trim(q.guess_name), '\s+', ' ', 'g')), p_inn, p_atc,
            p_group, lv, 'pharmacist', auth.uid(), now(), p_note)
    on conflict (alias) do update
      set inn=excluded.inn, atc=excluded.atc, frid_group=excluded.frid_group,
          frid_level=excluded.frid_level, source='pharmacist',
          approved_by=excluded.approved_by, approved_at=now();
  end if;

  insert into audit_logs(actor_id, action, subject_id, detail, meta)
  values (auth.uid(), 'drug.resolve', q.user_id,
          'เภสัชกรจัดกลุ่มยาที่ระบบไม่รู้จัก เป็น ' || coalesce(p_inn,'ไม่ระบุ') || ' · กลุ่ม ' || coalesce(p_group,'unknown'),
          jsonb_build_object('queue_id', p_queue_id, 'atc', p_atc));
end $fn$;
grant execute on function public.resolve_unknown_drug(uuid, text, text, text, text) to authenticated;

-- ============================================================
-- รูปฉลากยา: ปิดช่องที่หลวมกว่าตัวรายการยาเอง
-- ------------------------------------------------------------
-- เดิม medphoto_staff_r ให้เจ้าหน้าที่ "ทุกคน" อ่านรูปในถังได้
-- ทั้งที่ตัวแถวในตาราง medications ถูกกั้นด้วยการส่งต่อ + ความยินยอมรายครั้ง
-- แปลว่ารูปฉลากยาหลวมกว่าข้อมูลที่มันสังกัดอยู่ — ปิดให้เท่ากัน
-- ผู้ประสานงานยังเห็นได้ เพราะเป็นทีมดูแลที่ผู้เอาประกันยินยอมไว้ตั้งแต่สมัคร
-- ============================================================
drop policy if exists medphoto_staff_r on storage.objects;
drop policy if exists medphoto_care_r  on storage.objects;
drop policy if exists medphoto_prof_r  on storage.objects;
create policy medphoto_care_r on storage.objects
  for select using (
    bucket_id = 'med-photos' and public.cs_role() in ('care_manager','admin')
  );
create policy medphoto_prof_r on storage.objects
  for select using (
    bucket_id = 'med-photos'
    and public.cs_is_clinician()
    and public.cs_referred_to_me(((storage.foldername(name))[1])::uuid)
    and public.cs_has_live_access(((storage.foldername(name))[1])::uuid)
  );

comment on table public.drug_registry is
  'แคชทะเบียนตำรับยาจากเว็บเซอร์วิสของ อย. — ไม่เก็บว่าใครค้นอะไร';
comment on table public.drug_unknown_queue is
  'ยาที่ทั้งฐานในเครื่องและทะเบียน อย. จัดกลุ่มไม่ได้ ส่งให้เภสัชกรพร้อมรูปฉลาก';
