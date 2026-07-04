// POST /api/spin — 服务器权威抽奖:状态/天数/次数校验 → 服务器加权抽 → 扣库存 → CAS 扣次数+记奖
import { parseSession, getMember, casMember, chancesOf, dayInfo, pickPrize, spendStock, releaseStock, idxOf, loadConfig, bumpStats, bumpPrize, setWinner, maskName, redeemExpired, json } from './_lib.js';

function spendChance(m, todayKey) {
  const d = m.days[todayKey] || (m.days[todayKey] = { granted: 0, used: 0 });
  if (d.granted - d.used > 0) { d.used++; return true; }
  if ((m.bonusTotal || 0) - (m.bonusUsed || 0) > 0) { m.bonusUsed = (m.bonusUsed || 0) + 1; return true; }
  return false;
}

export async function onRequestPost({ request, env }) {
  try {
    const id = await parseSession(env, request);
    if (!id) return json({ ok: false, reason: 'nosession' }, 401);
    const cfg = await loadConfig(env);
    if (cfg.status !== 'running') return json({ ok: false, reason: 'notrunning', status: cfg.status });
    const { day, todayKey } = dayInfo(cfg);
    if (day < 1 || day > 7) return json({ ok: false, reason: 'window', day });

    const member = await getMember(env, id);
    if (!member) return json({ ok: false, reason: 'nosession' }, 401);
    if (chancesOf(member.data, todayKey) <= 0) return json({ ok: false, reason: 'nochance' });

    const rms = cfg.redeemMs;
    // 过期(超过兑换时限)的礼物 = 可以再中回来;还没过期的才算「已有」不重复
    const owned = new Set((member.data.won || []).filter(k => !redeemExpired(member.data, k, rms)));
    let key = null;
    for (let t = 0; t < 4; t++) {
      const k = await pickPrize(env, cfg.weights, owned);
      if (!k) break;
      if (await spendStock(env, k)) { key = k; break; }
      owned.add(k);
    }
    if (!key) return json({ ok: false, reason: 'soldout' });

    let res = { ok: false, reason: 'retry' }, winName = '', winCount = 0, wasNew = false;
    try {
      await casMember(env, id, (cur) => {
        wasNew = false;
        if (!cur) { res = { ok: false, reason: 'nosession' }; return null; }
        const has = (cur.won || []).includes(key);
        if (has && !redeemExpired(cur, key, rms)) { res = { ok: false, reason: 'dup' }; return null; }   // 还没过期才算重复;过期的可再中回来
        if (!spendChance(cur, todayKey)) { res = { ok: false, reason: 'nochance' }; return null; }
        cur.won = cur.won || [];
        if (!has) { cur.won.push(key); wasNew = true; }   // 新礼物才加进列表;过期重中 → 只刷新 24h 倒计时(叠加恢复)
        cur.wonAt = cur.wonAt || {}; cur.wonAt[key] = Date.now(); cur.lastSeen = Date.now();
        winName = cur.name; winCount = cur.won.length;
        res = { ok: true, idx: idxOf(key), prize: key, chances: chancesOf(cur, todayKey), wonAt: cur.wonAt[key] };
        return cur;
      });
    } catch (e) {
      await releaseStock(env, key);          // 异常(CAS 重试耗尽等)→ 归还预扣库存/大奖哨兵
      return json({ ok: false, reason: 'busy', error: String(e && e.message || e) }, 503);
    }
    if (res.ok) {
      try { await bumpStats(env, { spins: 1 }); if (wasNew) await bumpPrize(env, key); await setWinner(env, id, maskName(winName), winCount); } catch (e) {}  // 统计尽力,不影响抽奖结果(过期重中不重复计数)
    } else {
      await releaseStock(env, key);          // 没记成(nochance/dup)→ 归还预扣(含 gold 哨兵)
    }
    return json(res);
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
