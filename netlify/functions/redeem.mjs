// POST /api/redeem — 校验兑换码(含管理员加的码),返回送多少次抽奖
// Phase 1:只校验+返回次数;一码一用的限制 Phase 2 接会员后做
import { loadConfig, effectiveCodes, json } from './_shared.mjs';

export const config = { path: '/api/redeem' };

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return json({ ok: false, reason: 'empty' });
    const cfg = await loadConfig();
    const codes = effectiveCodes(cfg);
    if (!(code in codes)) return json({ ok: false, reason: 'invalid' });
    return json({ ok: true, code, draws: codes[code] });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
};
