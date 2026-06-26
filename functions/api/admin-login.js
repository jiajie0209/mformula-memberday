// POST /api/admin-login — 口令(环境变量 ADMIN_SECRET)换管理员 cookie
import { adminOK, adminCookie, json } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  if (!adminOK(env, body.pass)) return json({ ok: false }, 401);
  return json({ ok: true }, 200, { 'set-cookie': await adminCookie(env) });
}
