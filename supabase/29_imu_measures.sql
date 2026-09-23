-- ============================================================
-- 29_imu_measures.sql — ค่าวัดจากเซ็นเซอร์คาดเอวในชุดข้อมูลส่งต่อ
-- ------------------------------------------------------------
-- แอป V3 บันทึกผลจากเซ็นเซอร์คาดเอว (Arduino Nano 33 BLE Sense Rev2 · cs-imu.js ·
-- firmware/CareSignal-Waist) ไว้ที่ assessments.detail->'imu'
--   { device, fw, ftsst{ totalMs, reactionMs, ftsst{reps, repMs[], stsMeanMs, stsCv, peakOmega, peakAv, tiltMax} },
--     tug{ totalMs, tug{stsMs, walkOutMs, turnMs, walkBackMs, turn2Ms, sitMs, turnDeg, turnPeak, steps, cadence, stepCv, speed} },
--     balance[ { balance{heldSec, rms, major, minor, area, jerk, freq, path, stepped} } ] }
-- ชุดข้อมูลส่งต่อ (build_referral_package) ต้องส่งคีย์นี้ต่อให้ใบส่งต่ออ่าน
-- (cs-referral-forms.js → imuRows) — ฟังก์ชันด้านล่างเหมือน 22 ทุกบรรทัด
-- เพิ่มเฉพาะ 'imu' และคำอธิบายค่า method = 'imu'
--
-- ไม่มีข้อมูลระบุตัวบุคคลเพิ่ม · ค่าจากเซ็นเซอร์เป็นตัวเลขการเคลื่อนไหวเท่านั้น
-- (ไม่มีภาพ ไม่มีเสียง) · เข้าถึงได้ตามสิทธิ์เดิมของตาราง assessments/referrals
-- บริษัทประกันไม่เห็นค่ารายบุคคลเหล่านี้ (ไม่อยู่ใน view/ฟังก์ชันฝั่ง insurer)
-- ============================================================
comment on column public.assessments.method is
  'camera-pose | manual | imu (เซ็นเซอร์คาดเอว — อย่างน้อยหนึ่งท่า · รายท่าดูที่ detail.methods)';

create or replace function public.build_referral_package(target uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pkg jsonb; first_a record; last_a record; sig record; medsj jsonb; fu_n int; ref_n int;
        det jsonb; sg jsonb; md jsonb; hd jsonb; fd jsonb; n_high int; n_mod int; pharm jsonb;
begin
  if not public.cs_is_staff() then
    raise exception 'เฉพาะผู้ประสานงานที่สร้างชุดส่งต่อได้';
  end if;

  select * into first_a from public.assessments where user_id = target order by assessed_at asc  limit 1;
  select * into last_a  from public.assessments where user_id = target order by assessed_at desc limit 1;
  select * into sig from public.risk_signals where user_id = target order by created_at desc limit 1;

  det := coalesce(last_a.detail, '{}'::jsonb);
  sg  := coalesce(last_a.safety_gate, '{}'::jsonb);
  md  := coalesce(last_a.meds_detail, '{}'::jsonb);
  hd  := coalesce(last_a.home_detail, '{}'::jsonb);
  fd  := coalesce(last_a.falls_detail, '{}'::jsonb);

  /* ยา: เฉพาะที่ยังใช้อยู่ พร้อมกลุ่มเสี่ยงและใครยืนยัน */
  select coalesce(jsonb_agg(jsonb_build_object(
           'inn', inn, 'brand_text', brand_text, 'dose_text', dose_text, 'freq_text', freq_text,
           'frid_group', frid_group, 'frid_level', frid_level, 'confirmed_by', confirmed_by, 'source', source)), '[]'::jsonb),
         count(*) filter (where frid_level = 2), count(*) filter (where frid_level = 1)
    into medsj, n_high, n_mod
    from public.medications where user_id = target and active;

  /* ข้อเสนอจากเภสัชกรครั้งล่าสุด — แพทย์ต้องตอบรับตามแบบ STEADI-Rx */
  select coalesce(r.review->'form'->'problems', '[]'::jsonb) into pharm
    from public.referrals r
   where r.user_id = target and r.destination = 'pharmacist' and r.review is not null
   order by r.reviewed_at desc nulls last limit 1;

  select count(*) into fu_n from public.follow_ups where user_id = target and status = 'pending';
  select count(*) into ref_n from public.referrals where user_id = target
     and status not in ('outcome_recorded','declined');

  pkg := jsonb_build_object(
    'v', 2,
    'built_at', now(),
    'consent', (select jsonb_build_object('assessment', coalesce(bool_or(granted and revoked_at is null), false))
                  from public.consents where user_id = target and purpose = 'assessment'),
    'screen', coalesce(det->'steadi', '{}'::jsonb),
    'falls', fd,
    'symptoms', coalesce(sg->'answers', sg),
    'meds', jsonb_build_object(
       'n', coalesce((md->>'n')::int, jsonb_array_length(medsj)),
       'high', n_high, 'mod', n_mod,
       'items', medsj,
       'symptoms', coalesce(md->'symptoms', '[]'::jsonb),
       'changed',  coalesce(md->'changed',  '[]'::jsonb)),
    'medications', medsj,
    'mobility', jsonb_build_object(
       'ftsst_first', first_a.ftsst_seconds, 'ftsst_last', last_a.ftsst_seconds,
       'tug_first',   first_a.tug_seconds,   'tug_last',   last_a.tug_seconds,
       'first_at', first_a.assessed_at, 'last_at', last_a.assessed_at,
       'n_assessments', (select count(*) from public.assessments where user_id = target),
       'reps', last_a.reps, 'cadence_cv', last_a.cadence_cv,
       'tug', coalesce(det->'tug', '{}'::jsonb)),
    'balance', coalesce(det->'balance', '{}'::jsonb),
    /* ใหม่: ค่าวัดจากเซ็นเซอร์คาดเอวของการประเมินครั้งล่าสุด (null เมื่อไม่ได้ใช้) */
    'imu', det->'imu',
    'adl', jsonb_build_object(
       'first', first_a.parts->'adl', 'last', last_a.parts->'adl',
       'barthel_total', det->'barthel'->'total', 'barthel_sf', det->'barthel'->'sf', 'barthel_band', det->'barthel'->'band'),
    'home', hd,
    'quality', jsonb_build_object(
       'method', last_a.method, 'identity_verified', last_a.identity_verified,
       'not_tested', coalesce(last_a.not_tested, false),
       'safety_verdict', sg->'verdict', 'test_quality', last_a.test_quality,
       'methods', det->'methods'),
    'risk', jsonb_build_object(
       'tier', last_a.tier, 'score', last_a.score, 'max', last_a.score_max,
       'level', sig.level, 'flags', coalesce(sig.flags, '[]'::jsonb), 'next_days', sig.next_days),
    'pharm_recs', coalesce(pharm, '[]'::jsonb),
    'open_followups', fu_n,
    'open_referrals', ref_n
  );
  return pkg;
end $$;

grant execute on function public.build_referral_package(uuid) to authenticated;
