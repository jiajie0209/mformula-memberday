// POST /api/redeem-code — 会员版兑换码:一码一用(服务器端记在会员账本),发加成次数
import { loadConfig, effectiveCodes, json } from './_shared.mjs';
import { parseSession, casMember, chancesOf, dayInfo } from './_member.mjs';

export const config = { path: '/api/redeem-code' };

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const id = parseSession(req);
    if (!id) return json({ ok: false, reason: 'nosession' }, 401);
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return json({ ok: false, reason: 'empty' });

    const cfg = await loadConfig();
    const codes = effectiveCodes(cfg);
    if (!(code in codes)) return json({ ok: false, reason: 'invalid' });
    const draws = codes[code];
    const { todayKey } = dayInfo(cfg);

    let res = { ok: false, reason: 'retry' };
    await casMember(id, (cur) => {
      if (!cur) { res = { ok: false, reason: 'nosession' }; return null; }
      if ((cur.codesUsed || []).includes(code)) { res = { ok: false, reason: 'used' }; return null; }
      cur.codesUsed = cur.codesUsed || []; cur.codesUsed.push(code);
      cur.bonusTotal = (cur.bonusTotal || 0) + draws;
      cur.lastSeen = Date.now();
      res = { ok: true, code, draws, chances: chancesOf(cur, todayKey) };
      return cur;
    });
    return json(res);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
};
