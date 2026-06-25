// POST /api/spin — 服务器端权威抽奖:校验状态/天数/次数 → 服务器加权抽(只抽未拥有)→ 扣库存 → CAS 扣次数+记奖
import { loadConfig, json } from './_shared.mjs';
import { parseSession, getMember, casMember, chancesOf, dayInfo, pickPrize, spendStock, loadStock, saveStock, idxOf, STOCK_DEFAULT } from './_member.mjs';

export const config = { path: '/api/spin' };

function spendChance(m, todayKey) {            // 先扣今天基础,再扣加成
  const d = m.days[todayKey] || (m.days[todayKey] = { granted: 0, used: 0 });
  if (d.granted - d.used > 0) { d.used++; return true; }
  if ((m.bonusTotal || 0) - (m.bonusUsed || 0) > 0) { m.bonusUsed = (m.bonusUsed || 0) + 1; return true; }
  return false;
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const id = parseSession(req);
    if (!id) return json({ ok: false, reason: 'nosession' }, 401);

    const cfg = await loadConfig();
    if (cfg.status !== 'running') return json({ ok: false, reason: 'notrunning', status: cfg.status });
    const { day, todayKey } = dayInfo(cfg);
    if (day < 1 || day > 7) return json({ ok: false, reason: 'window', day });

    const member = await getMember(id);
    if (!member) return json({ ok: false, reason: 'nosession' }, 401);
    if (chancesOf(member, todayKey) <= 0) return json({ ok: false, reason: 'nochance' });

    // 服务器抽一个未拥有的奖,并预扣库存(限量奖)
    const owned = new Set(member.won || []);
    let key = null;
    for (let t = 0; t < 4; t++) {
      const k = await pickPrize(cfg.weights, owned);
      if (!k) break;
      if (await spendStock(k)) { key = k; break; }
      owned.add(k);   // 这个没库存了 → 排除再抽
    }
    if (!key) return json({ ok: false, reason: 'soldout' });

    // CAS:再校验次数 + 没重复 → 扣次数 + 记奖
    let res = { ok: false, reason: 'retry' };
    await casMember(id, (cur) => {
      if (!cur) { res = { ok: false, reason: 'nosession' }; return null; }
      if ((cur.won || []).includes(key)) { res = { ok: false, reason: 'dup' }; return null; }
      if (!spendChance(cur, todayKey)) { res = { ok: false, reason: 'nochance' }; return null; }
      cur.won = cur.won || []; cur.won.push(key);
      cur.wonAt = cur.wonAt || {}; cur.wonAt[key] = Date.now();
      cur.lastSeen = Date.now();
      res = { ok: true, idx: idxOf(key), prize: key, chances: chancesOf(cur, todayKey), wonAt: cur.wonAt[key] };
      return cur;
    });

    // 没记成(并发等)→ 把预扣的库存还回去(gold 哨兵不回收,概率默认 0)
    if (!res.ok && STOCK_DEFAULT[key] !== undefined && key !== 'gold') {
      const s = await loadStock(); s[key] = (s[key] || 0) + 1; await saveStock(s);
    }
    return json(res);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
};
