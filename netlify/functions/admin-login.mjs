// POST /api/admin-login — 口令(服务器环境变量 ADMIN_SECRET)换管理员 cookie
import { adminOK, json } from './_shared.mjs';
import { adminCookie } from './_member.mjs';

export const config = { path: '/api/admin-login' };

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const body = await req.json().catch(() => ({}));
  if (!adminOK(body.pass)) return json({ ok: false }, 401);   // 不泄露细节
  return json({ ok: true }, 200, { 'set-cookie': adminCookie() });
};
