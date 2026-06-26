// POST /api/session — 登入/恢复:发当天基础次数(只发一次)+ 签发会话 cookie
import { memberId, freshMember, casMember, chancesOf, dayInfo, sessionCookie, loadConfig, bumpStats, json } from './_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = await memberId(body.name, body.phone);
    if (!id) return json({ ok: false, reason: 'badphone' });
    const cfg = await loadConfig(env);
    const { day, todayKey } = dayInfo(cfg);
    const baseToday = (day >= 1 && day <= 7) ? cfg.dayDraws[day - 1] : 0;
    let isNew = false;
    const member = await casMember(env, id, (cur) => {
      isNew = !cur;
      const m = cur || freshMember(id, body.name, body.phone);
      m.lastSeen = Date.now();
      if (!m.days[todayKey]) m.days[todayKey] = { granted: baseToday, used: 0 };
      if (body.pkg === '2box' || body.pkg === '4box') m.pkg = body.pkg;
      return m;
    });
    if (isNew) { try { await bumpStats(env, { participants: 1 }); } catch (e) {} }   // 统计尽力
    return json({
      ok: true, day, status: cfg.status, weights: cfg.weights, redeemMs: cfg.redeemMs,
      chances: chancesOf(member, todayKey), won: member.won, wonAt: member.wonAt, pkg: member.pkg,
    }, 200, { 'set-cookie': await sessionCookie(env, id) });
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
