// ============================================================
// staff-activate — เปิดใช้งานบัญชีเจ้าหน้าที่ด้วยรหัสจากผู้ดูแลระบบ
// ------------------------------------------------------------
// ทำไมต้องเป็นฟังก์ชันฝั่งเซิร์ฟเวอร์ ไม่ใช่ให้เบราว์เซอร์ทำเอง
//   การสร้างบัญชีต้องใช้สิทธิ์ service role ซึ่งห้ามอยู่ในหน้าเว็บเด็ดขาด
//   และถ้าปล่อยให้เบราว์เซอร์สมัครบัญชีเองก่อนแล้วค่อยแลกรหัสทีหลัง
//   จะมีช่วงที่บัญชีค้างอยู่ในระบบโดยไม่มีใครเป็นเจ้าของ — ใครก็สร้างทิ้งไว้ได้
//   ที่นี่จึง "ตรวจรหัสก่อน แล้วค่อยสร้างบัญชี" ไม่มีบัญชีไหนเกิดโดยไม่มีรหัส
//
// สิ่งที่ฟังก์ชันนี้ไม่ทำ
//   ไม่ตั้งรหัสผ่านถาวรให้ผู้ใช้ — ตั้งไว้เท่ากับรหัสเปิดใช้งานเพื่อให้เข้าได้
//   ครั้งเดียว แล้วติดธง must_set_password ให้ระบบบังคับตั้งรหัสของตัวเอง
//   ทันทีที่เข้ามา เจ้าหน้าที่จึงเป็นคนเดียวที่รู้รหัสผ่านจริงของตน
//
// ข้อความตอบกลับเวลาไม่ผ่าน จงใจไม่บอกว่าผิดตรงไหน
//   เพื่อไม่ให้ใช้ฟังก์ชันนี้ไล่เดาว่าชื่อผู้ใช้ใดมีอยู่จริง
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const STAFF_DOMAIN = "staff.caresignal.local";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

/** แฮชแบบเดียวกับที่ฐานข้อมูลใช้: sha256 ของรหัสที่ตัดช่องว่างและทำเป็นตัวพิมพ์ใหญ่ */
async function hashCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code.trim().toUpperCase()),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, msg: "ต้องเรียกด้วย POST" }, 405);

  let username = "", code = "";
  try {
    const body = await req.json();
    username = String(body?.username ?? "").trim().toLowerCase();
    code = String(body?.code ?? "").trim().toUpperCase();
  } catch {
    return json({ ok: false, msg: "รูปแบบคำขอไม่ถูกต้อง" }, 400);
  }

  // ชื่อผู้ใช้กลายเป็นส่วนหนึ่งของอีเมลภายใน จึงต้องกรองก่อนนำไปต่อสตริง
  if (!/^[a-z0-9][a-z0-9._-]{2,30}$/.test(username) || code.length < 8) {
    return json({ ok: false, msg: "ชื่อผู้ใช้หรือรหัสไม่ถูกต้อง" }, 400);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: inv, error: invErr } = await db
    .from("staff_invite")
    .select("id, username, role, display_name, code_hint, used_at, revoked_at, expires_at")
    .eq("code_hash", await hashCode(code))
    .maybeSingle();

  const reject = async (why: string) => {
    await db.from("audit_logs").insert({
      action: "เปิดใช้งานบัญชีไม่สำเร็จ",
      detail: "ชื่อผู้ใช้ " + username + " · " + why,
    });
    return json({ ok: false, msg: "ชื่อผู้ใช้หรือรหัสไม่ถูกต้อง" }, 400);
  };

  if (invErr) return json({ ok: false, msg: "ระบบขัดข้อง ลองใหม่อีกครั้ง" }, 500);
  if (!inv) return await reject("ไม่พบรหัสที่ตรงกัน");
  if (inv.username !== username) return await reject("รหัสไม่ตรงกับชื่อผู้ใช้");
  if (inv.revoked_at) return await reject("รหัสถูกยกเลิกแล้ว");
  if (inv.used_at) return await reject("รหัสถูกใช้ไปแล้ว");
  if (new Date(inv.expires_at) < new Date()) return await reject("รหัสหมดอายุแล้ว");

  const email = username + "@" + STAFF_DOMAIN;

  // ยืนยันอีเมลให้ทันที เพราะไม่มีจดหมายส่งไปที่โดเมนนี้ และไม่ควรมี
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email,
    password: code,
    email_confirm: true,
    user_metadata: { kind: "staff", username },
  });
  if (cErr || !created?.user) {
    return json({
      ok: false,
      msg: cErr?.message?.includes("already")
        ? "ชื่อผู้ใช้นี้เปิดใช้งานไปแล้ว — ถ้าลืมรหัสผ่าน ให้ขอรหัสใหม่จากผู้ดูแลระบบ"
        : "สร้างบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง",
    }, 400);
  }
  const uid = created.user.id;

  // ปิดรหัสก่อนตั้งบทบาท เพราะทริกเกอร์กันการเลื่อนบทบาทยอมให้ผ่าน
  // เฉพาะเมื่อมีรหัสที่เพิ่งถูกใช้โดยบัญชีนี้ ลำดับจึงสลับไม่ได้
  await db.from("staff_invite").update({ used_at: new Date().toISOString(), used_by: uid })
    .eq("id", inv.id);

  const { error: pErr } = await db.from("profiles").update({
    role: inv.role,
    username,
    must_set_password: true,
    ...(inv.display_name ? { display_name: inv.display_name } : {}),
  }).eq("id", uid);

  if (pErr) {
    // บัญชีเกิดแล้วแต่ไม่มีบทบาท จะเข้าระบบไม่ได้และรหัสถูกใช้ไปเปล่า ๆ
    // เก็บกวาดให้เรียบร้อยเพื่อให้ผู้ดูแลระบบออกรหัสใหม่ได้ทันที
    await db.auth.admin.deleteUser(uid);
    await db.from("staff_invite").update({ used_at: null, used_by: null }).eq("id", inv.id);
    return json({ ok: false, msg: "ตั้งบทบาทไม่สำเร็จ แจ้งผู้ดูแลระบบ" }, 500);
  }

  await db.from("audit_logs").insert({
    actor_id: uid,
    actor_role: inv.role,
    action: "เปิดใช้งานบัญชีด้วยรหัสจากผู้ดูแลระบบ",
    detail: "ชื่อผู้ใช้ " + username + " · บทบาท " + inv.role + " · รหัสลงท้าย " + inv.code_hint,
  });

  return json({ ok: true, email, role: inv.role });
});
