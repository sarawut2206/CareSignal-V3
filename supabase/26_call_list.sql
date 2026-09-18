-- ============================================================
-- 26_call_list.sql — รายชื่อโทรติดตามรายคน (คอนโซลผู้ประสานงาน)
-- ------------------------------------------------------------
-- เดิมเจ้าหน้าที่อ่าน follow_ups ได้อย่างเดียว (follow_staff = select)
-- ทำให้บันทึกว่าโทรแล้วไม่ได้ ไฟล์นี้เพิ่ม
--   1. attempts / last_try_at — นับครั้งที่โทร
--   2. staff_call_list(p_days)  — นัดที่ถึงกำหนดวันนี้ (+p_days วัน) พร้อมชื่อและเบอร์
--   3. staff_followup_result()  — บันทึกผลการโทร เลื่อนนัดเมื่อไม่รับสาย
--      ไม่รับสายครบ 3 ครั้ง = missed · บันทึกลง contact_log ของเคสที่เปิดอยู่ด้วย
-- สิทธิ์: care_manager และ admin เท่านั้น — วิชาชีพ (รวมพยาบาล) เห็นเฉพาะงานที่ส่งถึงตน ไม่เห็นรายชื่อทั้งพอร์ต
-- รันซ้ำได้
-- ============================================================

alter table public.follow_ups
  add column if not exists attempts    smallint not null default 0,
  add column if not exists last_try_at timestamptz;

create or replace function public.cs_is_caller()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.cs_role() in ('care_manager','admin')
$fn$;

drop function if exists public.staff_call_list(int);
create or replace function public.staff_call_list(p_days int default 0)
returns table (
  fu_id uuid, user_id uuid, kind text, due_at timestamptz, attempts smallint, last_try_at timestamptz, fu_note text,
  pseudonym text, display_name text, phone text, carer_name text, carer_phone text, age int, province text,
  case_id uuid, case_level text, case_status text
) language sql stable security definer set search_path = public as $fn$
  select f.id, f.user_id, f.kind, f.due_at, f.attempts, f.last_try_at, f.note,
         p.pseudonym::text, p.display_name::text, p.phone::text, p.carer_name::text, p.carer_phone::text,
         (extract(year from now())::int + 543 - p.birth_year_be)::int, p.province::text,
         c.id, c.level::text, c.status::text
    from public.follow_ups f
    join public.profiles p on p.id = f.user_id
    left join lateral (
      select cc.id, cc.level, cc.status from public.care_cases cc
       where cc.user_id = f.user_id order by cc.opened_at desc limit 1
    ) c on true
   where public.cs_is_caller()
     and f.status = 'pending'
     and f.due_at < ((date_trunc('day', now() at time zone 'Asia/Bangkok')
                      + make_interval(days => 1 + greatest(coalesce(p_days, 0), 0))) at time zone 'Asia/Bangkok')
   order by f.due_at
   limit 300
$fn$;
revoke all on function public.staff_call_list(int) from public, anon;
grant execute on function public.staff_call_list(int) to authenticated;

-- p_result: reached (คุยได้) · no_answer (ไม่รับสาย เลื่อน 1 วัน) · callback (ขอให้โทรใหม่ เลื่อน 2 วัน) · refused (ไม่ประสงค์รับการติดตาม)
drop function if exists public.staff_followup_result(uuid, text, text);
create or replace function public.staff_followup_result(p_id uuid, p_result text, p_note text default null)
returns public.follow_ups language plpgsql security definer set search_path = public as $fn$
declare f public.follow_ups; cid uuid; done boolean;
begin
  if not public.cs_is_caller() then raise exception 'ไม่มีสิทธิ์บันทึกการโทรติดตาม'; end if;
  if p_result not in ('reached','no_answer','callback','refused') then raise exception 'ผลการโทรไม่ถูกต้อง'; end if;
  select * into f from public.follow_ups where id = p_id for update;
  if not found then raise exception 'ไม่พบนัดติดตาม'; end if;
  if f.status <> 'pending' then return f; end if;
  done := p_result in ('reached','refused') or (p_result = 'no_answer' and f.attempts + 1 >= 3);

  update public.follow_ups set
    attempts    = f.attempts + 1,
    last_try_at = now(),
    status      = case when p_result in ('reached','refused') then 'done'
                       when p_result = 'no_answer' and f.attempts + 1 >= 3 then 'missed' else 'pending' end,
    done_at     = case when done then now() end,
    due_at      = case when p_result = 'no_answer' and not done then now() + interval '1 day'
                       when p_result = 'callback' then now() + interval '2 days' else f.due_at end,
    note        = nullif(concat_ws(' · ', f.note, nullif(trim(p_note), '')), '')
  where id = p_id returning * into f;

  select id into cid from public.care_cases
   where user_id = f.user_id and status not in ('stable','closed') order by opened_at desc limit 1;
  if cid is not null then
    insert into public.contact_log (case_id, user_id, by_staff, channel, result, note)
    values (cid, f.user_id, auth.uid(), 'phone',
            case p_result when 'callback' then 'reached' else p_result end,
            'นัดติดตาม: ' || case f.kind when 'checkin_7d' then 'โทรติดตาม 7 วัน' when 'review_30d' then 'ทบทวนแผน 30 วัน'
                                          when 'reassess' then 'ชวนวัดซ้ำ' when 'referral_check' then 'ตามผลการส่งต่อ' else f.kind end || case p_result when 'callback' then ' · ขอให้โทรใหม่' else '' end
              || coalesce(' · ' || nullif(trim(p_note), ''), ''));
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, subject_id, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'followup.call', f.user_id, f.kind || ': ' || p_result);
  return f;
end $fn$;
revoke all on function public.staff_followup_result(uuid, text, text) from public, anon;
grant execute on function public.staff_followup_result(uuid, text, text) to authenticated;
