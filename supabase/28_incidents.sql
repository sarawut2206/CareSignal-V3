-- ============================================================
-- 28_incidents.sql — การแจ้งเหตุ (Incident report / First Notice of Loss)
-- ------------------------------------------------------------
-- ต่อจาก 23 (เปิดเคสเมื่อแจ้งล้ม) ให้ครอบคลุมเหตุทุกชนิดที่แอปแจ้งได้ (cs-incident.js)
--   1. ทริกเกอร์เปิด/ยกระดับเคส: fall · near_fall · accident · hospital · adl_drop
--        hospital หรือ severity high = urgent ติดต่อภายใน 24 ชม.
--        severity medium = decline 48 ชม. · near_fall / low = watch 72 ชม.
--   2. insurer_incident_summary(days) — ภาพรวมการแจ้งเหตุแบบไม่ระบุตัวตน
--        นับเฉพาะสมาชิกที่ยินยอมให้ใช้ข้อมูลเชิงกลุ่ม (share_pool) เหมือน insurer_outcomes
--        คืนแค่จำนวนตามชนิด/ความรุนแรง/สถานที่ — ไม่มี user_id ไม่มีชื่อ ไม่มีวันที่รายบุคคล
--        ไม่ใช่ข้อมูลเคลม และไม่ใช้พิจารณาสินไหมหรือเบี้ยรายบุคคล
-- รันซ้ำได้
-- ============================================================

-- ---------- 1. แจ้งเหตุ → เปิดหรือยกระดับเคส ----------
create or replace function public.open_case_on_fall_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare lvl cs_risk_level; sla int; sig jsonb; nm text; sev text;
begin
  if new.kind not in ('fall','near_fall','accident','hospital','adl_drop') then return new; end if;
  sev := coalesce(new.severity,'medium');
  lvl := case when new.kind = 'hospital' or sev = 'high' then 'urgent'
              when new.kind = 'near_fall' or sev = 'low' then 'watch'
              else 'decline' end;
  sla := case lvl when 'urgent' then 24 when 'decline' then 48 else 72 end;
  nm  := case new.kind when 'fall' then 'หกล้มครั้งใหม่' when 'near_fall' then 'เกือบล้ม'
                       when 'accident' then 'อุบัติเหตุ' when 'hospital' then 'เข้าโรงพยาบาล/ห้องฉุกเฉิน'
                       else 'ช่วยเหลือตัวเองได้แย่ลงทันที' end;
  sig := jsonb_build_array(jsonb_build_object(
           'k', case when new.kind = 'adl_drop' then 'S6' else 'S1' end,
           'nm', nm || ' (ครอบครัวแจ้ง)',
           'sev', case lvl when 'urgent' then 3 when 'decline' then 2 else 1 end,
           'dest', case when new.kind = 'adl_drop' then 'nurse' else 'doctor' end,
           'act', 'ติดต่อครอบครัวภายในกำหนด ทบทวนสาเหตุ ประเมินผลกระทบต่อการช่วยเหลือตัวเอง และนัดประเมินซ้ำ',
           'why', jsonb_build_array(coalesce(new.detail->>'where','ไม่ระบุสถานที่'), coalesce(new.detail->>'injury',''),
                                    case when (new.detail->>'head')::boolean then 'ศีรษะกระแทก' else '' end)));

  update care_cases
     set level = case when array_position(array['stable','watch','decline','urgent']::text[], lvl::text)
                        > array_position(array['stable','watch','decline','urgent']::text[], level::text)
                      then lvl else level end,
         signals    = coalesce(signals,'[]'::jsonb) || sig,
         sla_hours  = least(sla_hours, sla),
         next_action = 'ครอบครัวแจ้งเหตุ: ' || nm || ' ' || to_char(new.created_at at time zone 'Asia/Bangkok','DD/MM HH24:MI') || ' — ติดต่อกลับ',
         updated_at = now()
   where user_id = new.user_id and status not in ('stable','closed');
  if found then return new; end if;

  insert into care_cases (user_id, level, signals, sla_hours, next_action, due_at)
  values (new.user_id, lvl, sig, sla,
          'ครอบครัวแจ้งเหตุ: ' || nm || ' — ติดต่อกลับและนัดประเมินซ้ำ',
          new.created_at + make_interval(hours => sla));
  return new;
end $$;

drop trigger if exists trg_open_case_on_fall_event on public.care_events;
create trigger trg_open_case_on_fall_event
  after insert on public.care_events
  for each row execute function public.open_case_on_fall_event();

-- ---------- 2. ภาพรวมการแจ้งเหตุสำหรับบริษัทประกัน (ไม่ระบุตัวตน) ----------
create or replace function public.insurer_incident_summary(p_days int default 365)
returns jsonb language sql stable security definer set search_path = public as $fn$
  with mem as (select id from public.profiles where role = 'user' and share_pool = true),
  e as (select ev.kind, coalesce(ev.severity,'medium') sev, coalesce(ev.detail,'{}'::jsonb) d
          from public.care_events ev join mem m on m.id = ev.user_id
         where ev.created_at > now() - make_interval(days => greatest(1, least(p_days, 730)))
           and ev.kind in ('fall','near_fall','accident','hospital','adl_drop'))
  select case when public.cs_role() in ('insurer','care_manager','admin') then jsonb_build_object(
    'days', greatest(1, least(p_days, 730)),
    'total', (select count(*) from e),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from e group by kind) t), '{}'::jsonb),
    'by_severity', coalesce((select jsonb_object_agg(sev, n) from (select sev, count(*) n from e group by sev) t), '{}'::jsonb),
    'by_place', coalesce((select jsonb_object_agg(pl, n) from (select d->>'place' pl, count(*) n from e
                           where kind in ('fall','near_fall') and d->>'place' is not null group by 1) t), '{}'::jsonb),
    'by_activity', coalesce((select jsonb_object_agg(ac, n) from (select d->>'activity' ac, count(*) n from e
                           where kind = 'fall' and d->>'activity' is not null group by 1) t), '{}'::jsonb),
    'serious', jsonb_build_object(
      'admit_or_fracture', (select count(*) from e where d->>'injury_code' in ('admit','fracture')),
      'head',              (select count(*) from e where (d->>'head')::boolean),
      'long_lie',          (select count(*) from e where d->>'lie' = 'gt60' or d->>'getup_code' = 'cannot'),
      'new_dependency',    (select count(*) from e where d->>'impact' in ('bedbound','need_help') or kind = 'adl_drop')))
  else null end;
$fn$;
revoke all on function public.insurer_incident_summary(int) from public, anon;
grant execute on function public.insurer_incident_summary(int) to authenticated;

comment on function public.insurer_incident_summary(int) is
  'ภาพรวมการแจ้งเหตุของสมาชิกที่ยินยอม (share_pool) นับตามชนิด ความรุนแรง สถานที่ — ไม่มีข้อมูลรายบุคคล · ไม่ใช่ข้อมูลเคลม';
comment on function public.open_case_on_fall_event is
  'แจ้งเหตุ (ล้ม เกือบล้ม อุบัติเหตุ เข้าโรงพยาบาล ช่วยเหลือตัวเองแย่ลง) → เปิดหรือยกระดับเคส ไม่รอรอบประเมิน';
