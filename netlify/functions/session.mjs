// POST /api/session — 登入/恢复:name+phone → memberId,发放当天基础次数(只发一次),返回服务器端状态
import { loadConfig, json } from './_shared.mjs';
import { memberId, freshMember, casMember, chancesOf, dayInfo, sessionCookie, bumpStats } from './_member.mjs';

export const config = { path: '/api/session' };

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const body = await req.json().catch(() => ({}));
    const id = memberId(body.name, body.phone);
    if (!id) return json({ ok: false, reason: 'badphone' });   // 非大马手机号

    const cfg = await loadConfig();
    const { day, todayKey } = dayInfo(cfg);
    const baseToday = (day >= 1 && day <= 7) ? cfg.dayDraws[day - 1] : 0;

    let isNew = false;
    const member = await casMember(id, (cur) => {
      isNew = !cur;
      const m = cur || freshMember(id, body.name, body.phone);
      m.lastSeen = Date.now();
      if (!m.days[todayKey]) m.days[todayKey] = { granted: baseToday, used: 0 };  // 今天的基础次数只发一次
      if (body.pkg === '2box' || body.pkg === '4box') m.pkg = body.pkg;
      return m;
    });
    if (isNew) await bumpStats(s => { s.participants = (s.participants || 0) + 1; });

    return json({
      ok: true, day, status: cfg.status, weights: cfg.weights, redeemMs: cfg.redeemMs,
      chances: chancesOf(member, todayKey),
      won: member.won, wonAt: member.wonAt, pkg: member.pkg,
    }, 200, { 'set-cookie': sessionCookie(id) });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
};
