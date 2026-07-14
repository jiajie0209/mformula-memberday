// POST /api/session — 登入/恢复:发当天基础次数(只发一次)+ 签发会话 cookie
import { memberId, freshMember, casMember, chancesOf, dayInfo, sessionCookie, loadConfig, bumpStats, getCustomer, normPhone, json } from './_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = await memberId(body.name, body.phone);
    if (!id) return json({ ok: false, reason: 'badphone' });
    const cfg = await loadConfig(env);
    if (cfg.status !== 'running') {   // 没有进行中的活动 → 不建 member、不发次数,只回顾客永久档案(客户端显示「已结束·等待下一场」)
      const np = normPhone(body.phone);
      const profile = np ? await getCustomer(env, np) : null;
      return json({ ok: true, status: cfg.status, active: false, name: body.name || '', profile }, 200, { 'set-cookie': await sessionCookie(env, id) });
    }
    const { day, todayKey } = dayInfo(cfg);
    let isNew = false;
    const member = await casMember(env, id, (cur) => {
      isNew = !cur;
      const m = cur || freshMember(id, body.name, body.phone);
      m.lastSeen = Date.now();
      if (!m.days[todayKey]) {
        let grant = 0;
        if (day >= 1 && day <= 7) {
          const firstEver = Object.keys(m.days).length === 0;   // 从没记录过任何一天 = 新顾客第一次登入
          grant = firstEver ? cfg.dayDraws[0] : (day === 7 ? cfg.dayDraws[6] : 1);   // 新客第一天=5,活动第7天=3,平常回访=1
        }
        m.days[todayKey] = { granted: grant, used: 0 };
      }
      if (body.pkg === '2box' || body.pkg === '4box') m.pkg = body.pkg;
      return m;
    });
    if (isNew) { try { await bumpStats(env, { participants: 1 }); } catch (e) {} }   // 统计尽力
    return json({
      ok: true, active: true, day, status: cfg.status, weights: cfg.weights, redeemMs: cfg.redeemMs,
      chances: chancesOf(member, todayKey), won: member.won, wonAt: member.wonAt, pkg: member.pkg,
    }, 200, { 'set-cookie': await sessionCookie(env, id) });
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
