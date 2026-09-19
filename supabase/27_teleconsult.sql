-- ============================================================
-- 27_teleconsult.sql — นัดตรวจทางวิดีโอคอล · แบบยืนยันผลครั้งสุดท้าย · คำขอบริการป้องกันถึงบริษัทประกัน
-- ------------------------------------------------------------
-- วงจร:
--   1. ผู้เชี่ยวชาญที่รับใบส่งต่อ เสนอเวลานัด 1–3 ช่วง          appt_propose()
--   2. ครอบครัวเลือกเวลาในแอป และเลือกว่ายินยอมส่งสรุปผล
--      แบบไม่ระบุชื่อให้บริษัทประกันหรือไม่                     appt_choose()
--   3. ถึงเวลา ทั้งสองฝ่ายเข้าห้องวิดีโอคอลในแอป                appt_join()
--      (WebRTC ต่อตรงระหว่างเครื่อง ระบบไม่บันทึกภาพหรือเสียง)
--   4. ผู้เชี่ยวชาญกรอกแบบยืนยันผลครั้งสุดท้าย ลงชื่อ เลขใบอนุญาต
--      และรับรองว่าตรวจเอง แก้ไขภายหลังไม่ได้                    final_submit()
--   5. ผู้ประสานงานตรวจ แล้วส่งคำขอบริการป้องกันแบบไม่ระบุชื่อ
--      ให้บริษัทประกัน — ได้เฉพาะเมื่อยืนยันว่าเสี่ยงจริง
--      และครอบครัวยินยอมแล้ว                                      cm_send_prevention()
--   6. บริษัทประกันอนุมัติบริการป้องกัน (ทั้งหมด/บางส่วน/ขอข้อมูล/ไม่คุ้มครอง)
--      ผลกลับถึงผู้ประสานงานและครอบครัว                          insurer_prevention_decide()
--
-- ขอบเขตการใช้ข้อมูลของบริษัทประกัน: อนุมัติบริการป้องกันเท่านั้น
-- ห้ามใช้ปรับเบี้ย พิจารณารับประกัน หรือพิจารณาสินไหม
-- บริษัทประกันไม่มีสิทธิ์อ่านตารางตรง เห็นผ่านฟังก์ชันที่ตัดชื่อ เบอร์ และรหัสออกแล้วเท่านั้น
-- รันซ้ำได้
-- ============================================================

-- ---------- 1. นัดหมาย ----------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  referral_id      uuid references public.referrals(id) on delete cascade,
  case_id          uuid references public.care_cases(id) on delete set null,
  destination      text not null check (destination in ('doctor','pharmacist','physio','nurse')),
  clinician_id     uuid references public.profiles(id),
  options          timestamptz[] not null,
  slot_at          timestamptz,
  minutes          smallint not null default 20 check (minutes between 10 and 60),
  status           text not null default 'proposed'
                   check (status in ('proposed','confirmed','in_call','done','cancelled','no_show')),
  room             uuid not null default gen_random_uuid(),
  note             text,
  share_insurer    boolean not null default false,
  share_insurer_at timestamptz,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  confirmed_at     timestamptz,
  started_at       timestamptz,
  ended_at         timestamptz,
  cancel_reason    text
);
create index if not exists appointments_user_idx on public.appointments(user_id, slot_at);
create index if not exists appointments_clin_idx on public.appointments(clinician_id, slot_at);
comment on column public.appointments.room is
  'รหัสห้องวิดีโอคอล — ใช้เป็นชื่อช่องสัญญาณ เห็นได้เฉพาะคู่สนทนาผ่าน appt_join()';
comment on column public.appointments.share_insurer is
  'ครอบครัวยินยอมให้ส่งสรุปผลยืนยันแบบไม่ระบุชื่อให้บริษัทประกัน เพื่ออนุมัติบริการป้องกันเท่านั้น';

alter table public.appointments enable row level security;
drop policy if exists appt_own on public.appointments;
drop policy if exists appt_family on public.appointments;
drop policy if exists appt_staff on public.appointments;
drop policy if exists appt_clin on public.appointments;
create policy appt_own on public.appointments for select using (user_id = auth.uid());
create policy appt_family on public.appointments for select using (
  exists (select 1 from public.caregiver_links l
           where l.member_id = appointments.user_id and l.carer_id = auth.uid()
             and l.status = 'approved' and coalesce(l.permissions->>'status','false') = 'true'));
create policy appt_staff on public.appointments for select using (public.cs_is_staff());
create policy appt_clin on public.appointments for select using (
  public.cs_is_clinician() and (clinician_id = auth.uid()
    or (destination = public.cs_my_destination() and public.cs_referred_to_me(user_id))));
-- ไม่มีนโยบายเขียนตรง ทุกการเปลี่ยนผ่านฟังก์ชันด้านล่าง
revoke insert, update, delete on public.appointments from anon, authenticated;
-- รหัสห้องไม่ให้อ่านจากตาราง ต้องขอผ่าน appt_join() ที่ตรวจว่าเป็นคู่สนทนาและอยู่ในช่วงเวลานัด
-- (ถอนสิทธิ์ระดับตารางแล้วให้ทีละคอลัมน์ — ถอนเฉพาะคอลัมน์ไม่มีผลเมื่อยังมีสิทธิ์ระดับตาราง)
revoke select on public.appointments from anon, authenticated;
grant select (id, user_id, referral_id, case_id, destination, clinician_id, options, slot_at, minutes, status, note,
              share_insurer, share_insurer_at, created_by, created_at, confirmed_at, started_at, ended_at, cancel_reason)
  on public.appointments to authenticated;

create or replace function public.cs_may_treat(r public.referrals)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.cs_is_staff()
      or (public.cs_is_clinician() and (r.destination::text = public.cs_my_destination() or r.assigned_to = auth.uid()))
$fn$;

-- ผู้เชี่ยวชาญ (หรือผู้ประสานงาน) เสนอเวลานัด 1–3 ช่วง
drop function if exists public.appt_propose(uuid, timestamptz[], int, text);
create or replace function public.appt_propose(p_referral uuid, p_options timestamptz[], p_minutes int default 20, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare r public.referrals; n int; t timestamptz; new_id uuid;
begin
  select * into r from public.referrals where id = p_referral;
  if not found then raise exception 'ไม่พบใบส่งต่อ'; end if;
  if not public.cs_may_treat(r) then raise exception 'ใบส่งต่อนี้ไม่ได้ส่งถึงท่าน'; end if;
  n := coalesce(array_length(p_options, 1), 0);
  if n < 1 or n > 3 then raise exception 'เสนอเวลาได้ 1 ถึง 3 ช่วง'; end if;
  foreach t in array p_options loop
    if t < now() + interval '30 minutes' or t > now() + interval '30 days' then
      raise exception 'เวลานัดต้องอยู่ระหว่าง 30 นาทีถึง 30 วันจากนี้';
    end if;
  end loop;
  update public.appointments set status = 'cancelled', cancel_reason = 'เสนอเวลาใหม่'
   where referral_id = p_referral and status = 'proposed';
  insert into public.appointments (user_id, referral_id, case_id, destination, clinician_id, options, minutes, note, created_by)
  values (r.user_id, r.id, r.case_id, r.destination::text,
          case when public.cs_is_clinician() then auth.uid() else r.assigned_to end,
          p_options, coalesce(p_minutes, 20), nullif(trim(p_note), ''), auth.uid())
  returning id into new_id;
  insert into public.audit_logs (actor_id, actor_role, action, subject_id, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'appt.propose', r.user_id,
          'เสนอเวลานัดวิดีโอคอล ' || n || ' ช่วง · ' || r.destination::text);
  return new_id;
end $fn$;

-- ครอบครัว (บัญชีผู้เอาประกัน) เลือกเวลา · ผู้ประสานงานเลือกแทนได้เมื่อครอบครัวแจ้งทางโทรศัพท์
drop function if exists public.appt_choose(uuid, timestamptz, boolean);
create or replace function public.appt_choose(p_id uuid, p_slot timestamptz, p_share boolean default false)
returns void language plpgsql security definer set search_path = public as $fn$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'ไม่พบนัด'; end if;
  if a.user_id <> auth.uid() and not public.cs_is_staff() then raise exception 'ไม่ใช่นัดของท่าน'; end if;
  if a.status <> 'proposed' then raise exception 'นัดนี้ยืนยันหรือยกเลิกไปแล้ว'; end if;
  if not (p_slot = any (a.options)) then raise exception 'เลือกได้เฉพาะเวลาที่ผู้เชี่ยวชาญเสนอ'; end if;
  update public.appointments set status = 'confirmed', slot_at = p_slot, confirmed_at = now(),
         share_insurer = coalesce(p_share, false), share_insurer_at = case when p_share then now() end
   where id = p_id returning * into a;
  update public.referrals set status = 'booked', booked_at = now()
   where id = a.referral_id and status in ('pending','approved','acknowledged');
  insert into public.audit_logs (actor_id, actor_role, action, subject_id, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'appt.confirm', a.user_id,
          'ยืนยันเวลานัดวิดีโอคอล' || case when p_share then ' · ยินยอมส่งสรุปผลแบบไม่ระบุชื่อให้บริษัทประกัน' else '' end);
  return;
end $fn$;

drop function if exists public.appt_cancel(uuid, text);
create or replace function public.appt_cancel(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'ไม่พบนัด'; end if;
  if not (a.user_id = auth.uid() or a.clinician_id = auth.uid() or public.cs_is_staff()) then raise exception 'ไม่มีสิทธิ์ยกเลิกนัดนี้'; end if;
  if a.status not in ('proposed','confirmed') then raise exception 'ยกเลิกไม่ได้ในสถานะนี้'; end if;
  update public.appointments set status = 'cancelled', cancel_reason = nullif(trim(p_reason), '') where id = p_id returning * into a;
  insert into public.audit_logs (actor_id, actor_role, action, subject_id, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'appt.cancel', a.user_id, coalesce(p_reason, 'ยกเลิกนัด'));
  return;
end $fn$;

-- เข้าห้องตรวจ: เฉพาะคู่สนทนา และตั้งแต่ 15 นาทีก่อนนัดถึง 60 นาทีหลังหมดเวลา
drop function if exists public.appt_join(uuid);
create or replace function public.appt_join(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare a public.appointments; who text; other text;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'ไม่พบนัด'; end if;
  if a.user_id = auth.uid() then who := 'member';
  elsif a.clinician_id = auth.uid() then who := 'clinician';
  else raise exception 'ท่านไม่ได้เป็นคู่สนทนาของนัดนี้'; end if;
  if a.status not in ('confirmed','in_call') then raise exception 'นัดนี้ยังไม่ยืนยันหรือสิ้นสุดแล้ว'; end if;
  if now() < a.slot_at - interval '15 minutes' then raise exception 'ยังไม่ถึงเวลา เข้าห้องได้ก่อนนัด 15 นาที'; end if;
  if now() > a.slot_at + make_interval(mins => a.minutes + 60) then raise exception 'เลยเวลานัดแล้ว กรุณานัดใหม่'; end if;
  if who = 'clinician' then
    update public.appointments set status = 'in_call', started_at = coalesce(started_at, now()) where id = p_id;
  end if;
  select coalesce(display_name, 'ผู้เชี่ยวชาญ') into other from public.profiles
   where id = case when who = 'member' then a.clinician_id else a.user_id end;
  insert into public.audit_logs (actor_id, actor_role, action, subject_id, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'appt.join', a.user_id, 'เข้าห้องวิดีโอคอล');
  return jsonb_build_object('room', a.room, 'as', who, 'slot_at', a.slot_at, 'minutes', a.minutes,
                            'destination', a.destination, 'other', other);
end $fn$;

-- ผู้เชี่ยวชาญจบการตรวจ (หรือบันทึกว่าไม่มาตามนัด)
drop function if exists public.appt_finish(uuid, boolean);
create or replace function public.appt_finish(p_id uuid, p_no_show boolean default false)
returns void language plpgsql security definer set search_path = public as $fn$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'ไม่พบนัด'; end if;
  if a.clinician_id <> auth.uid() and not public.cs_is_staff() then raise exception 'เฉพาะผู้เชี่ยวชาญของนัดนี้'; end if;
  if a.status not in ('confirmed','in_call') then return; end if;
  update public.appointments set status = case when p_no_show then 'no_show' else 'done' end, ended_at = now()
   where id = p_id returning * into a;
  return;
end $fn$;

-- ---------- 2. แบบยืนยันผลครั้งสุดท้าย ----------
create table if not exists public.final_reports (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid unique references public.appointments(id) on delete cascade,
  referral_id    uuid references public.referrals(id) on delete set null,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  destination    text not null,
  clinician_id   uuid not null references public.profiles(id),
  risk           text not null check (risk in ('confirmed','not_confirmed','uncertain')),
  level          text check (level in ('low','moderate','high')),
  domains        text[] not null default '{}',
  findings       text not null check (length(trim(findings)) >= 10),
  recommend      text not null check (length(trim(recommend)) >= 5),
  services       text[] not null default '{}',
  follow_days    int check (follow_days is null or follow_days between 1 and 365),
  in_person      boolean not null default false,
  signer_name    text not null,
  license_no     text not null,
  attested       boolean not null check (attested),
  signed_at      timestamptz not null default now(),
  cm_status      text not null default 'new' check (cm_status in ('new','sent','not_needed','no_consent')),
  cm_note        text,
  cm_by          uuid references public.profiles(id),
  cm_at          timestamptz
);
comment on table public.final_reports is
  'แบบยืนยันผลครั้งสุดท้ายหลังวิดีโอคอล — ลงชื่อและรับรองโดยผู้มีใบอนุญาต แก้ไขไม่ได้หลังส่ง';
alter table public.final_reports enable row level security;
drop policy if exists fr_own on public.final_reports;
drop policy if exists fr_staff on public.final_reports;
drop policy if exists fr_clin on public.final_reports;
create policy fr_own on public.final_reports for select using (user_id = auth.uid());
create policy fr_staff on public.final_reports for select using (public.cs_is_staff());
create policy fr_clin on public.final_reports for select using (clinician_id = auth.uid());
revoke insert, update, delete on public.final_reports from anon, authenticated;

drop function if exists public.final_submit(uuid, jsonb);
create or replace function public.final_submit(p_appt uuid, p jsonb)
returns public.final_reports language plpgsql security definer set search_path = public as $fn$
declare a public.appointments; fr public.final_reports; v_risk text;
begin
  select * into a from public.appointments where id = p_appt for update;
  if not found then raise exception 'ไม่พบนัด'; end if;
  if a.clinician_id <> auth.uid() then raise exception 'เฉพาะผู้เชี่ยวชาญที่ตรวจเป็นผู้ลงชื่อยืนยันผล'; end if;
  if a.status not in ('in_call','done') then raise exception 'ต้องเข้าห้องตรวจก่อนจึงยืนยันผลได้'; end if;
  if exists (select 1 from public.final_reports where appointment_id = p_appt) then raise exception 'ยืนยันผลนัดนี้ไปแล้ว แก้ไขไม่ได้'; end if;
  v_risk := p->>'risk';
  if v_risk is null or v_risk not in ('confirmed','not_confirmed','uncertain') then raise exception 'เลือกผลการยืนยันความเสี่ยง'; end if;
  if coalesce((p->>'attested')::boolean, false) is not true then raise exception 'ต้องรับรองว่าตรวจด้วยตนเอง'; end if;
  if coalesce(trim(p->>'license_no'), '') = '' or coalesce(trim(p->>'signer_name'), '') = '' then raise exception 'ต้องลงชื่อและเลขใบอนุญาต'; end if;
  -- กฎเดียวกับ return_review: ระบบไม่ส่งคำสั่งหยุดยา ต้องเป็นคำว่าทบทวนกับผู้สั่งใช้
  if (p->>'recommend') ~ '(ให้หยุดยา|หยุดยาทันที|เลิกยา)' then
    raise exception 'คำแนะนำเรื่องยาให้ใช้ถ้อยคำว่า ทบทวนกับผู้สั่งใช้ — การปรับยาเป็นของผู้สั่งใช้';
  end if;
  insert into public.final_reports (appointment_id, referral_id, user_id, destination, clinician_id, risk, level, domains,
         findings, recommend, services, follow_days, in_person, signer_name, license_no, attested, cm_status)
  values (a.id, a.referral_id, a.user_id, a.destination, auth.uid(), v_risk,
          case when v_risk = 'not_confirmed' then 'low' else p->>'level' end,
          coalesce(array(select jsonb_array_elements_text(p->'domains')), '{}'),
          p->>'findings', p->>'recommend',
          coalesce(array(select jsonb_array_elements_text(p->'services')), '{}'),
          nullif(p->>'follow_days', '')::int, coalesce((p->>'in_person')::boolean, false),
          trim(p->>'signer_name'), trim(p->>'license_no'), true,
          case when v_risk = 'not_confirmed' then 'not_needed' when not a.share_insurer then 'no_consent' else 'new' end)
  returning * into fr;
  update public.appointments set status = 'done', ended_at = coalesce(ended_at, now()) where id = a.id;
  insert into public.audit_logs (actor_id, actor_role, action, subject_id, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'final.submit', a.user_id,
          'ยืนยันผลครั้งสุดท้าย: ' || v_risk || coalesce(' · ' || fr.level, ''));
  return fr;
end $fn$;

-- ---------- 3. คำขอบริการป้องกันถึงบริษัทประกัน (ไม่ระบุชื่อ) ----------
create table if not exists public.prevention_requests (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid unique not null references public.final_reports(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  code          text not null unique,
  age_band      text,
  level         text,
  destination   text,
  domains       text[] not null default '{}',
  services      text[] not null default '{}',
  summary       text not null,
  consent_at    timestamptz not null,
  sent_by       uuid references public.profiles(id),
  sent_at       timestamptz not null default now(),
  decision      text not null default 'pending' check (decision in ('pending','approved','partial','need_info','declined')),
  approved      text[] not null default '{}',
  decision_note text,
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz
);
comment on table public.prevention_requests is
  'คำขออนุมัติบริการป้องกัน — บริษัทประกันเห็นผ่าน insurer_prevention_list() เท่านั้น (ไม่มี user_id ชื่อ เบอร์ หรือรหัสสมาชิก) · ห้ามใช้ปรับเบี้ยหรือพิจารณาสินไหม';
alter table public.prevention_requests enable row level security;
drop policy if exists pr_own on public.prevention_requests;
drop policy if exists pr_staff on public.prevention_requests;
create policy pr_own on public.prevention_requests for select using (user_id = auth.uid());
create policy pr_staff on public.prevention_requests for select using (public.cs_is_staff());
revoke insert, update, delete on public.prevention_requests from anon, authenticated;

drop function if exists public.cm_send_prevention(uuid, text, text[]);
create or replace function public.cm_send_prevention(p_report uuid, p_summary text, p_services text[])
returns public.prevention_requests language plpgsql security definer set search_path = public as $fn$
declare fr public.final_reports; a public.appointments; pf public.profiles; pr public.prevention_requests; age int;
begin
  if not public.cs_is_staff() then raise exception 'เฉพาะผู้ประสานงาน'; end if;
  select * into fr from public.final_reports where id = p_report for update;
  if not found then raise exception 'ไม่พบแบบยืนยันผล'; end if;
  if fr.risk <> 'confirmed' then raise exception 'ส่งได้เฉพาะเคสที่ผู้เชี่ยวชาญยืนยันว่าเสี่ยงจริง'; end if;
  if fr.cm_status = 'sent' then raise exception 'ส่งไปแล้ว'; end if;
  select * into a from public.appointments where id = fr.appointment_id;
  if not coalesce(a.share_insurer, false) then raise exception 'ครอบครัวยังไม่ยินยอมให้ส่งสรุปผลให้บริษัทประกัน'; end if;
  select * into pf from public.profiles where id = fr.user_id;
  if coalesce(trim(p_summary), '') = '' then raise exception 'ต้องมีสรุป'; end if;
  -- กันข้อมูลระบุตัวตนหลุดไปในสรุป
  if (pf.display_name is not null and length(pf.display_name) > 1 and position(pf.display_name in p_summary) > 0)
     or (pf.pseudonym is not null and position(pf.pseudonym in p_summary) > 0)
     or p_summary ~ '0[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{3,4}' then
    raise exception 'สรุปมีชื่อ รหัสสมาชิก หรือเบอร์โทร — ตัดออกก่อนส่ง';
  end if;
  age := extract(year from now())::int + 543 - pf.birth_year_be;
  insert into public.prevention_requests (report_id, user_id, code, age_band, level, destination, domains, services, summary, consent_at, sent_by)
  values (fr.id, fr.user_id, 'PR-' || upper(substr(md5(gen_random_uuid()::text), 1, 6)),
          case when age is null then null when age < 70 then '60–69 ปี' when age < 80 then '70–79 ปี' else '80 ปีขึ้นไป' end,
          fr.level, fr.destination, fr.domains,
          coalesce((select array_agg(s) from unnest(p_services) s
                     where s in ('physio_program','exercise_group','med_review','doctor_followup','home_mod',
                                 'assistive','vision','caregiver_training','alarm')), '{}'),
          trim(p_summary), a.share_insurer_at, auth.uid())
  returning * into pr;
  update public.final_reports set cm_status = 'sent', cm_by = auth.uid(), cm_at = now() where id = fr.id;
  insert into public.audit_logs (actor_id, actor_role, action, subject_id, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'prevention.send', fr.user_id,
          'ส่งคำขอบริการป้องกัน ' || pr.code || ' ให้บริษัทประกัน (ไม่ระบุชื่อ)');
  return pr;
end $fn$;

drop function if exists public.cm_close_report(uuid, text, text);
create or replace function public.cm_close_report(p_report uuid, p_status text, p_note text default null)
returns public.final_reports language plpgsql security definer set search_path = public as $fn$
declare fr public.final_reports;
begin
  if not public.cs_is_staff() then raise exception 'เฉพาะผู้ประสานงาน'; end if;
  if p_status not in ('not_needed','no_consent') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  update public.final_reports set cm_status = p_status, cm_note = nullif(trim(p_note), ''), cm_by = auth.uid(), cm_at = now()
   where id = p_report and cm_status <> 'sent' returning * into fr;
  if not found then raise exception 'ไม่พบ หรือส่งไปแล้ว'; end if;
  return fr;
end $fn$;

-- บริษัทประกันเห็นเฉพาะคอลัมน์ที่ไม่ระบุตัวตน
drop function if exists public.insurer_prevention_list();
create or replace function public.insurer_prevention_list()
returns table (id uuid, code text, age_band text, level text, destination text, domains text[], services text[], summary text,
               sent_at timestamptz, decision text, approved text[], decision_note text, decided_at timestamptz)
language plpgsql security definer set search_path = public as $fn$
begin
  if public.cs_role() not in ('insurer','admin') then raise exception 'เฉพาะบริษัทประกัน'; end if;
  insert into public.audit_logs (actor_id, actor_role, action, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'prevention.list', 'เปิดดูคำขอบริการป้องกัน (ไม่ระบุชื่อ)');
  return query select r.id, r.code, r.age_band, r.level, r.destination, r.domains, r.services, r.summary,
                      r.sent_at, r.decision, r.approved, r.decision_note, r.decided_at
                 from public.prevention_requests r order by (r.decision = 'pending') desc, r.sent_at desc limit 500;
end $fn$;

drop function if exists public.insurer_prevention_decide(uuid, text, text[], text);
create or replace function public.insurer_prevention_decide(p_id uuid, p_decision text, p_approved text[], p_note text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare pr public.prevention_requests;
begin
  if public.cs_role() not in ('insurer','admin') then raise exception 'เฉพาะบริษัทประกัน'; end if;
  if p_decision not in ('approved','partial','need_info','declined') then raise exception 'ผลพิจารณาไม่ถูกต้อง'; end if;
  select * into pr from public.prevention_requests where id = p_id for update;
  if not found then raise exception 'ไม่พบคำขอ'; end if;
  if p_decision in ('approved','partial') and coalesce(array_length(p_approved, 1), 0) = 0 then raise exception 'เลือกบริการที่อนุมัติอย่างน้อย 1 รายการ'; end if;
  if p_decision in ('need_info','declined') and coalesce(trim(p_note), '') = '' then raise exception 'ระบุเหตุผลให้ผู้ประสานงาน'; end if;
  update public.prevention_requests set decision = p_decision,
         approved = case when p_decision = 'approved' then services
                         when p_decision = 'partial' then array(select s from unnest(p_approved) s where s = any (services))
                         else '{}' end,
         decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  insert into public.audit_logs (actor_id, actor_role, action, detail)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), 'prevention.decide', pr.code || ': ' || p_decision);
end $fn$;

revoke all on function public.appt_propose(uuid, timestamptz[], int, text) from public, anon;
revoke all on function public.appt_choose(uuid, timestamptz, boolean) from public, anon;
revoke all on function public.appt_cancel(uuid, text) from public, anon;
revoke all on function public.appt_join(uuid) from public, anon;
revoke all on function public.appt_finish(uuid, boolean) from public, anon;
revoke all on function public.final_submit(uuid, jsonb) from public, anon;
revoke all on function public.cm_send_prevention(uuid, text, text[]) from public, anon;
revoke all on function public.cm_close_report(uuid, text, text) from public, anon;
revoke all on function public.insurer_prevention_list() from public, anon;
revoke all on function public.insurer_prevention_decide(uuid, text, text[], text) from public, anon;
grant execute on function public.appt_propose(uuid, timestamptz[], int, text) to authenticated;
grant execute on function public.appt_choose(uuid, timestamptz, boolean) to authenticated;
grant execute on function public.appt_cancel(uuid, text) to authenticated;
grant execute on function public.appt_join(uuid) to authenticated;
grant execute on function public.appt_finish(uuid, boolean) to authenticated;
grant execute on function public.final_submit(uuid, jsonb) to authenticated;
grant execute on function public.cm_send_prevention(uuid, text, text[]) to authenticated;
grant execute on function public.cm_close_report(uuid, text, text) to authenticated;
grant execute on function public.insurer_prevention_list() to authenticated;
grant execute on function public.insurer_prevention_decide(uuid, text, text[], text) to authenticated;
