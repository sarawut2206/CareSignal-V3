-- ============================================================
-- 20_admin_data.sql — เครื่องมือจัดการข้อมูลของผู้ดูแลระบบ
-- ------------------------------------------------------------
-- ทำไมต้องมี
--   ระบบเก็บข้อมูลสุขภาพของคนจริง จึงต้องมีทางลบที่ชัดเจนและตรวจสอบได้
--   ไม่ใช่ต้องเข้าไปพิมพ์ SQL ที่หลังบ้าน ซึ่งไม่มีใครรู้ว่าใครลบอะไรไป
--
-- หลักสามข้อที่ยึด
--   1. บันทึกตรวจสอบ (audit_logs) ไม่ถูกลบไม่ว่ากรณีใด
--      ระบบประกาศกับผู้ใช้ไว้ว่า "แก้ย้อนหลังไม่ได้" ถ้าผู้ดูแลระบบลบได้
--      คำประกาศนั้นก็ไม่จริง · การลบบัญชีทำให้ actor_id กลายเป็น null
--      ตามข้อกำหนดของตาราง แต่ตัวบันทึกยังอยู่ครบ
--   2. บัญชีเจ้าหน้าที่ที่เคยลงมือทำอะไรไว้ "ถอนสิทธิ์" ได้ แต่ลบไม่ได้
--      เพราะเคสและรายการส่งต่ออ้างถึงว่าใครเป็นคนทำ ถ้าลบทิ้งจะเหลือ
--      ประวัติที่ไม่มีผู้รับผิดชอบ ซึ่งแย่กว่าการเก็บบัญชีที่ใช้ไม่ได้ไว้
--   3. ทุกการลบถามยืนยันที่หน้าจอ และบันทึกจำนวนที่ลบไปในบันทึกตรวจสอบ
-- ============================================================

-- ============================================================
-- สรุปว่ามีข้อมูลอะไรอยู่เท่าไร
-- ============================================================
create or replace function public.admin_data_summary()
returns table (k text, nm text, n bigint, deletable boolean)
language sql security definer set search_path = public as $fn$
  select * from (values
    ('members',    'บัญชีผู้เอาประกัน',   (select count(*) from public.profiles where role='user'),      true),
    ('staff',      'บัญชีเจ้าหน้าที่',     (select count(*) from public.profiles where role<>'user'),     true),
    ('assessments','แบบประเมิน',          (select count(*) from public.assessments),                     true),
    ('signals',    'สัญญาณเสี่ยง',        (select count(*) from public.risk_signals),                    true),
    ('cases',      'เคสดูแล',             (select count(*) from public.care_cases),                      true),
    ('referrals',  'รายการส่งต่อ',        (select count(*) from public.referrals),                       true),
    ('meds',       'รายการยา',            (select count(*) from public.medications),                     true),
    ('consents',   'คำยินยอม',            (select count(*) from public.consents),                        true),
    ('invites',    'รหัสเปิดใช้งาน',      (select count(*) from public.staff_invite),                    true),
    ('audit',      'บันทึกตรวจสอบ',       (select count(*) from public.audit_logs),                      false),
    ('drugs',      'ทะเบียนยา อย. (อ้างอิง)', (select count(*) from public.drug_registry),               false)
  ) as t(k, nm, n, deletable)
  where public.cs_role() = 'admin';
$fn$;

-- ============================================================
-- รายชื่อบัญชีพร้อมปริมาณข้อมูลของแต่ละคน
-- ------------------------------------------------------------
-- has_history บอกว่าบัญชีนี้เคยลงมือทำอะไรในระบบไว้หรือยัง
-- ถ้าเคย ปุ่มลบจะถูกปิดไว้ที่หน้าจอ และฟังก์ชันลบก็จะปฏิเสธด้วย
-- ============================================================
create or replace function public.admin_list_accounts()
returns table (id uuid, username text, display_name text, role cs_role,
               created_at timestamptz, n_assess bigint, n_cases bigint,
               n_meds bigint, has_history boolean, is_self boolean)
language sql security definer set search_path = public as $fn$
  select p.id, p.username, p.display_name, p.role, p.created_at,
         (select count(*) from public.assessments a where a.user_id = p.id),
         (select count(*) from public.care_cases  c where c.user_id = p.id),
         (select count(*) from public.medications m where m.user_id = p.id),
         exists (select 1 from public.referrals   r where r.sent_by     = p.id)
      or exists (select 1 from public.referrals   r where r.reviewed_by = p.id)
      or exists (select 1 from public.care_cases  c where c.assigned_to = p.id)
      or exists (select 1 from public.contact_log l where l.by_staff    = p.id)
      or exists (select 1 from public.staff_invite i where i.created_by = p.id),
         p.id = auth.uid()
    from public.profiles p
   where public.cs_role() = 'admin'
   order by (p.role = 'user'), p.created_at desc
   limit 500;
$fn$;

-- ============================================================
-- ลบข้อมูลสุขภาพของบัญชีหนึ่ง แต่เก็บบัญชีไว้
-- ------------------------------------------------------------
-- ใช้เมื่อข้อมูลชุดนั้นเกิดจากการลองใช้ ไม่ใช่ของจริง แต่เจ้าของบัญชี
-- ยังต้องใช้งานระบบต่อ · ลบตามลำดับ แม่ก่อนลูกไม่ได้ จึงเริ่มจากที่อ้างถึงคนอื่น
-- ============================================================
create or replace function public.admin_purge_member_data(p_uid uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare c jsonb := '{}'::jsonb; k int;
begin
  if public.cs_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;

  delete from public.follow_ups          where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('follow_ups', k);
  delete from public.care_plans          where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('care_plans', k);
  delete from public.care_events         where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('care_events', k);
  delete from public.contact_log         where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('contact_log', k);
  delete from public.access_requests     where member_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('access_requests', k);
  delete from public.med_reviews         where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('med_reviews', k);
  delete from public.mrv_requests        where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('mrv_requests', k);
  delete from public.referrals           where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('referrals', k);
  delete from public.care_cases          where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('care_cases', k);
  delete from public.risk_signals        where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('risk_signals', k);
  delete from public.drug_unknown_queue  where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('drug_unknown_queue', k);
  delete from public.medications         where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('medications', k);
  delete from public.assessments         where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('assessments', k);
  delete from public.family_checkins     where member_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('family_checkins', k);
  delete from public.family_notifications where member_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('family_notifications', k);
  delete from public.caregiver_links     where member_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('caregiver_links', k);
  delete from public.caregiver_invites   where member_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('caregiver_invites', k);

  -- คำยินยอมถูกลบท้ายสุด เพราะรายการอื่นอ้างถึง และมันคือหลักฐานว่า
  -- ข้อมูลที่เพิ่งลบไปเคยถูกเก็บโดยได้รับอนุญาต
  delete from public.consents            where user_id = p_uid; get diagnostics k = row_count; c := c || jsonb_build_object('consents', k);

  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), 'admin', 'ลบข้อมูลสุขภาพของบัญชี',
          'บัญชี '||p_uid::text||' · จำนวนที่ลบ '||c::text);
  return c;
end $fn$;

-- ============================================================
-- ลบบัญชีทั้งบัญชี — ข้อมูลตามไปทั้งหมดด้วย foreign key
-- ------------------------------------------------------------
-- ปฏิเสธถ้าเป็นบัญชีของตัวเอง เป็นผู้ดูแลระบบคนสุดท้าย
-- หรือเป็นบัญชีที่เคยลงมือทำอะไรในระบบไว้
-- ============================================================
create or replace function public.admin_delete_account(p_uid uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v record; v_hist boolean; c jsonb;
begin
  if public.cs_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;
  if p_uid = auth.uid() then
    raise exception 'ลบบัญชีของตัวเองไม่ได้';
  end if;
  select * into v from public.profiles where id = p_uid;
  if not found then raise exception 'ไม่พบบัญชีนี้'; end if;
  if v.role = 'admin' and (select count(*) from public.profiles where role='admin') <= 1 then
    raise exception 'ต้องเหลือผู้ดูแลระบบอย่างน้อยหนึ่งบัญชี';
  end if;

  select exists (select 1 from public.referrals    r where r.sent_by     = p_uid)
      or exists (select 1 from public.referrals    r where r.reviewed_by = p_uid)
      or exists (select 1 from public.care_cases   x where x.assigned_to = p_uid)
      or exists (select 1 from public.contact_log  l where l.by_staff    = p_uid)
      or exists (select 1 from public.staff_invite i where i.created_by  = p_uid)
    into v_hist;
  if v_hist then
    raise exception 'บัญชีนี้เคยลงมือทำงานในระบบ ลบไม่ได้ — ใช้การถอนสิทธิ์แทน เพื่อให้ประวัติยังมีผู้รับผิดชอบ';
  end if;

  c := public.admin_purge_member_data(p_uid);

  -- บันทึกก่อนลบ เพราะหลังลบแล้วชื่อผู้ใช้จะไม่มีให้บันทึกอีก
  -- actor_id ของบันทึกเก่าที่เป็นบัญชีนี้จะกลายเป็น null ตามข้อกำหนดตาราง
  -- แต่ตัวบันทึกยังอยู่ครบ ไม่มีการลบบันทึกตรวจสอบ
  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), 'admin', 'ลบบัญชีออกจากระบบ',
          'ชื่อผู้ใช้ '||coalesce(v.username, v.pseudonym, p_uid::text)||
          ' · บทบาท '||v.role||' · ข้อมูลที่ลบ '||c::text);

  delete from auth.users where id = p_uid;
  return c || jsonb_build_object('account', 1);
end $fn$;

-- ============================================================
-- ถอนสิทธิ์บัญชีเจ้าหน้าที่ — เข้าคอนโซลไม่ได้อีก แต่ประวัติยังอ้างถึงได้
-- ============================================================
create or replace function public.admin_revoke_staff(p_uid uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v record;
begin
  if public.cs_role() <> 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;
  if p_uid = auth.uid() then
    raise exception 'ถอนสิทธิ์ตัวเองไม่ได้';
  end if;
  select * into v from public.profiles where id = p_uid;
  if not found then return false; end if;
  if v.role = 'admin' and (select count(*) from public.profiles where role='admin') <= 1 then
    raise exception 'ต้องเหลือผู้ดูแลระบบอย่างน้อยหนึ่งบัญชี';
  end if;

  update public.profiles set role = 'user', must_set_password = true where id = p_uid;
  insert into public.audit_logs(actor_id, actor_role, action, detail)
  values (auth.uid(), 'admin', 'ถอนสิทธิ์เจ้าหน้าที่',
          'ชื่อผู้ใช้ '||coalesce(v.username, p_uid::text)||' · บทบาทเดิม '||v.role);
  return true;
end $fn$;

grant execute on function public.admin_data_summary()            to authenticated;
grant execute on function public.admin_list_accounts()           to authenticated;
grant execute on function public.admin_purge_member_data(uuid)   to authenticated;
grant execute on function public.admin_delete_account(uuid)      to authenticated;
grant execute on function public.admin_revoke_staff(uuid)        to authenticated;
