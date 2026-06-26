// POST /api/redeem-code — 会员版兑换码:一码一用(服务器记账)+ 发加成次数
import { parseSession, loadConfig, effectiveCodes, casMember, chancesOf, dayInfo, json } from './_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const id = await parseSession(env, request);
    if (!id) return json({ ok: false, reason: 'nosession' }, 401);
    const body = await request.json().catch(() => ({}));
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return json({ ok: false, reason: 'empty' });
    const cfg = await loadConfig(env); const codes = effectiveCodes(cfg);
    if (!(code in codes)) return json({ ok: false, reason: 'invalid' });
    const draws = codes[code]; const { todayKey } = dayInfo(cfg);
    let res = { ok: false, reason: 'retry' };
    await casMember(env, id, (cur) => {
      if (!cur) { res = { ok: false, reason: 'nosession' }; return null; }
      if ((cur.codesUsed || []).includes(code)) { res = { ok: false, reason: 'used' }; return null; }
      cur.codesUsed = cur.codesUsed || []; cur.codesUsed.push(code);
      cur.bonusTotal = (cur.bonusTotal || 0) + draws; cur.lastSeen = Date.now();
      res = { ok: true, code, draws, chances: chancesOf(cur, todayKey) };
      return cur;
    });
    return json(res);
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
