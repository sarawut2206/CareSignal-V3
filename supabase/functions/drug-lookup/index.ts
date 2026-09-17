// ============================================================
// drug-lookup — ค้นชื่อยาจากทะเบียนตำรับยาของ อย.
// ------------------------------------------------------------
// ทำไมต้องมีตัวกลาง ไม่ให้เบราว์เซอร์เรียกเอง
//   เว็บเซอร์วิสของ อย. (porta.fda.moph.go.th) ไม่ได้ตั้งค่า CORS
//   เบราว์เซอร์จึงเรียกตรงไม่ได้ · และการมีตัวกลางทำให้แคชผลได้
//   ไม่ต้องยิงซ้ำทุกครั้งที่มีคนถ่ายยาตัวเดิม
//
// สิ่งที่ "ไม่" ส่งออกไปนอกระบบ
//   ส่งออกไปแค่ "ชื่อยาที่อ่านได้จากฉลาก" เท่านั้น
//   ไม่ส่ง user id · ไม่ส่งโทเคน · ไม่ส่งรูป · และไม่บันทึกลงแคชว่าใครค้นอะไร
//
// ลำดับการตอบ
//   1. drug_alias      — ชื่อที่คนตรวจแล้ว (ฐาน 170 ตัวยา + ที่เภสัชกรยืนยัน)
//   2. drug_registry   — แคชทะเบียน อย. ที่ยังไม่เกิน 90 วัน
//   3. เรียก อย. สด     — แล้วเก็บลงแคช
//   4. ตอบว่าไม่พบ      — ฝั่งแอปจะส่งเข้าคิวให้เภสัชกรจัดกลุ่ม
//
// การจัดกลุ่มความเสี่ยง
//   ใช้ cs_atc_to_frid ในฐานข้อมูล ซึ่งรับเฉพาะรหัส ATC เต็ม 7 หลัก
//   ขององค์การอนามัยโลก · ทะเบียนเก่าบางรายการให้มาแค่รหัสหมวดของ อย.
//   (เช่น M01A1) กรณีนั้นตอบ unknown แล้วส่งเภสัชกร ไม่เดา
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const FDA_WSDL = "https://porta.fda.moph.go.th/FDA_SEARCH_ALL/WS_LICENSE_SEARCH.asmx";
const CACHE_DAYS = 90;
const FDA_TIMEOUT_MS = 12000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const norm = (s: string) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
const xmlEsc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** เรียกเมท็อดหนึ่งของเว็บเซอร์วิส อย. แล้วคืน XML ดิบ */
async function soap(op: string, data: string): Promise<string> {
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    `<${op} xmlns="http://tempuri.org/"><DATAS>${xmlEsc(data)}</DATAS></${op}>` +
    "</soap:Body></soap:Envelope>";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FDA_TIMEOUT_MS);
  try {
    const r = await fetch(FDA_WSDL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://tempuri.org/" + op },
      body,
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error("fda http " + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/** ดึงค่าแท็กแรกที่เจอ — ทะเบียนตอบมาเป็น DataSet ของ .NET ไม่ใช่ JSON */
const tag = (xml: string, k: string): string => {
  const m = new RegExp("<" + k + ">([^<]*)</" + k + ">").exec(xml);
  return m ? m[1].trim() : "";
};
const tagAll = (xml: string, k: string): string[] =>
  [...xml.matchAll(new RegExp("<" + k + ">([^<]*)</" + k + ">", "g"))].map((m) => m[1].trim());

/**
 * ทะเบียน อย. ค้นแบบ "มีข้อความนี้อยู่ที่ไหนก็ได้ในชื่อ" ซึ่งอันตรายกับเรา
 * ตัวอย่างจริงที่เจอตอนทดสอบ: ค้น "ZOLAM" แล้วได้ "DORZOLAMIDE" ซึ่งเป็นยาหยอดตา
 * ถ้าปล่อยผ่าน ยานอนหลับที่ผู้ใช้ถ่ายมาจะถูกจัดเป็นยาหยอดตา แล้วสัญญาณเสี่ยงหายไปเงียบ ๆ
 * กฎ: คำค้นต้องเป็นคำเต็มหรือต้นคำในชื่อการค้า ไม่ใช่เศษกลางคำ
 */
function nameMatches(query: string, tradeName: string): boolean {
  const q = norm(query);
  // สั้นกว่า 4 ตัวอักษรไม่ให้เทียบเลย — "ol" เป็นต้นคำของ OLANZAPINE ก็จริง
  // แต่เป็นต้นคำของยาอีกหลายร้อยตัวเช่นกัน เศษ OCR สั้น ๆ จึงไม่ควรพอให้ตัดสิน
  // ยาชื่อสั้นจริง ๆ (เช่น NAC) อยู่ในฐานที่คนตรวจแล้ว ไม่ต้องพึ่งทะเบียน
  if (q.length < 4 || !tradeName) return false;
  const words = norm(tradeName).split(/[^a-z0-9฀-๿]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q) || q.startsWith(w) && w.length >= 4)) return true;
  // คำค้นหลายคำ เช่น "fafen forte" — ให้ผ่านถ้าคำแรกตรงต้นคำใดคำหนึ่ง
  const first = q.split(" ")[0];
  return first.length >= 4 && words.some((w) => w.startsWith(first));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  let name = "";
  try {
    name = norm(((await req.json()) as { name?: string }).name || "");
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  if (name.length < 2 || name.length > 80) return json({ ok: false, reason: "bad_name" }, 400);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ---------- 1. ชื่อที่คนตรวจแล้ว ----------
  const alias = await db.from("drug_alias")
    .select("inn, atc, frid_group, frid_level, source").eq("alias", name).maybeSingle();
  if (alias.data) {
    return json({ ok: true, found: true, source: alias.data.source, ...alias.data });
  }

  // ---------- 2. แคชทะเบียน ----------
  const since = new Date(Date.now() - CACHE_DAYS * 864e5).toISOString();
  const cached = await db.from("drug_registry")
    .select("inn, atc, atc_kind, frid_group, frid_level, trade_name, reg_no, drug_class, strength, source_url, classified_by")
    .eq("query_key", name).eq("status", "active").gte("fetched_at", since)
    .order("frid_level", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (cached.data) return json({ ok: true, found: true, source: "fda_registry_cache", ...cached.data });

  // ---------- 3. เรียกทะเบียน อย. สด ----------
  let list = "";
  try {
    list = await soap("GET_DATA_DRUG", name);
  } catch (_e) {
    // ทะเบียนล่มหรือช้า — ไม่ใช่เหตุให้แอปพัง ตอบว่ายังไม่รู้แล้วให้ไปต่อ
    return json({ ok: true, found: false, reason: "registry_unavailable" });
  }

  const all = [...list.matchAll(/<Table1[^>]*>[\s\S]*?<\/Table1>/g)].map((m) => m[0]);
  // ตัดรายการที่ชื่อไม่ได้ตรงกับที่ค้นจริง ๆ ออกก่อนอย่างอื่น
  const rows = all.filter((r) => nameMatches(name, tag(r, "produceng") || tag(r, "productha")));
  // ทะเบียนที่ถูกยกเลิกแล้วไม่ควรใช้จัดกลุ่ม แต่ยังบอกผู้ใช้ได้ว่าเคยมี
  const active = rows.filter((r) => !/<cncnm>\s*ยกเลิก/.test(r));
  const use = (active.length ? active : rows).slice(0, 3);
  if (!use.length) {
    return json({
      ok: true, found: false,
      reason: all.length ? "name_too_different" : "not_in_registry",
      near: all.slice(0, 3).map((r) => tag(r, "produceng")).filter(Boolean),
    });
  }

  const out: Record<string, unknown>[] = [];
  for (const r of use) {
    const code = tag(r, "Newcode");
    let atc = "", inn = "", strength = "", cls = tag(r, "thakindnm");
    if (code) {
      try {
        const info = await soap("GET_DRUG_INFORMATION", code);
        // ทะเบียนใส่ "-" เมื่อไม่มีข้อมูล ต้องนับเป็นว่าง ไม่ใช่ค่ารหัส
        atc = tag(info, "atccd").replace(/^-+$/, "");
        inn = tag(info, "atcnm").replace(/^-+$/, "");
        strength = (tagAll(info, "qtytxt_all")[0] || "");
        cls = tag(info, "thakindnm") || cls;
      } catch (_e) { /* รายการนี้ดึงรายละเอียดไม่ได้ ใช้เท่าที่มี */ }
    }
    // ATC เต็ม 7 หลักเท่านั้นจึงจัดกลุ่มอัตโนมัติได้
    const whoAtc = /^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$/.test(atc.replace(/\s/g, "").toUpperCase());
    let group = "unknown", level: number | null = null, by = "none";

    if (whoAtc) {
      // ชื่อสามัญที่ทะเบียนให้มา อาจตรงกับที่คนตรวจแล้ว — ให้ชั้นนั้นชนะ
      const byInn = inn ? await db.from("drug_alias")
        .select("frid_group, frid_level").eq("alias", norm(inn)).maybeSingle() : { data: null };
      if (byInn.data) {
        group = byInn.data.frid_group; level = byInn.data.frid_level; by = "alias";
      } else {
        const rule = await db.rpc("cs_atc_to_frid", { p_atc: atc });
        const g = Array.isArray(rule.data) ? rule.data[0] : rule.data;
        if (g) { group = g.frid_group; level = g.frid_level; by = "atc_rule"; }
      }
    }

    // ทะเบียนไทยจำนวนมากตั้งชื่อผลิตภัณฑ์ด้วยชื่อสามัญตรง ๆ เช่น
    // "MIRTAZAPINE HEMIHYDRATE" หรือ "LERCANIDIPINE HCL" และหลายรายการ
    // ไม่มีรหัส ATC บันทึกไว้ ถ้าดูแค่ ATC จะทิ้งของที่รู้จักอยู่แล้วไปเปล่า ๆ
    // จึงลองเทียบทีละคำในชื่อทะเบียนกับชั้นที่คนตรวจแล้ว และเลือกกลุ่มที่เสี่ยงสูงสุด
    if (group === "unknown") {
      const tn = tag(r, "produceng") || tag(r, "productha");
      const words = norm(tn).split(/[^a-z0-9]+/).filter((w) => w.length >= 5);
      if (words.length) {
        const hit = await db.from("drug_alias")
          .select("inn, atc, frid_group, frid_level").in("alias", words)
          .order("frid_level", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        if (hit.data) {
          group = hit.data.frid_group; level = hit.data.frid_level; by = "trade_word";
          if (!inn) inn = hit.data.inn;
          if (!atc) atc = hit.data.atc || "";
        }
      }
    }

    const row = {
      query_key: name,
      trade_name: tag(r, "produceng") || tag(r, "productha"),
      reg_no: tag(r, "lcnno"),
      fda_code: code,
      atc: atc || null,
      // คิดชนิดรหัสจากค่าสุดท้าย เพราะชั้น trade_word อาจเติม ATC เต็มเข้ามาทีหลัง
      atc_kind: atc ? (/^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$/.test(atc.replace(/\s/g, "").toUpperCase()) ? "who" : "fda_group") : null,
      inn: (whoAtc || by === "trade_word") && inn ? norm(inn) : null,
      strength: strength || null,
      drug_class: cls || null,
      licensee: tag(r, "licen") || tag(r, "thanm"),
      status: /<cncnm>\s*ยกเลิก/.test(r) ? "cancelled" : "active",
      frid_group: group,
      frid_level: level,
      classified_by: by,
      source_url: tag(r, "URLs_NEW") || null,
      fetched_at: new Date().toISOString(),
    };
    out.push(row);
  }

  // เก็บลงแคช — ล้างของเดิมของคำค้นนี้ก่อน เพื่อไม่ให้ทะเบียนเก่าค้าง
  await db.from("drug_registry").delete().eq("query_key", name);
  await db.from("drug_registry").insert(out);

  const best = out.filter((x) => x.status === "active")
    .sort((a, b) => (Number(b.frid_level ?? -1) - Number(a.frid_level ?? -1)))[0] || out[0];
  return json({
    ok: true,
    found: true,
    source: "fda_registry",
    inn: best.inn,
    atc: best.atc,
    atc_kind: best.atc_kind,
    frid_group: best.frid_group,
    frid_level: best.frid_level,
    trade_name: best.trade_name,
    reg_no: best.reg_no,
    drug_class: best.drug_class,
    strength: best.strength,
    source_url: best.source_url,
    classified_by: best.classified_by,
    matches: out.length,
  });
});
