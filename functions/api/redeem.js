// POST /api/redeem — Phase 1 兼容:仅校验兑换码(无会话)
import { loadConfig, effectiveCodes, json } from './_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return json({ ok: false, reason: 'empty' });
    const cfg = await loadConfig(env); const codes = effectiveCodes(cfg);
    if (!(code in codes)) return json({ ok: false, reason: 'invalid' });
    return json({ ok: true, code, draws: codes[code] });
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
