// POST /api/order — 服务器端下单:校验拥有+未过期 → 重算价格 → 发一次性兑换码 → 每日首单 +次数
import { loadConfig, json } from './_shared.mjs';
import { parseSession, casMember, chancesOf, dayInfo, computeOrder, redeemExpired, ULTRA, SLOTS, bumpStats, saveRedemption } from './_member.mjs';
import crypto from 'node:crypto';

export const config = { path: '/api/order' };

function orderCode(pkg, memberId, sig) {
  const p = pkg === '4box' ? '4B' : '2B';
  const h = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev').update(memberId + '|' + sig).digest('hex');
  const n = parseInt(h.slice(0, 8), 16) % 1000000;
  return `MD-${p}-${String(n).padStart(6, '0')}`;
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const id = parseSession(req);
    if (!id) return json({ ok: false, reason: 'nosession' }, 401);
    const body = await req.json().catch(() => ({}));
    const pkg = (body.pkg === '4box') ? '4box' : '2box';
    const wanted = Array.isArray(body.bundle) ? body.bundle.map(String) : [];

    const cfg = await loadConfig();
    const { todayKey } = dayInfo(cfg);

    let res = { ok: false, reason: 'retry' };
    await casMember(id, (cur) => {
      if (!cur) { res = { ok: false, reason: 'nosession' }; return null; }
      // 服务器校验:只保留拥有且未过期的好礼;ultra 独占;不超过配套上限
      const owned = new Set(cur.won || []);
      let valid = wanted.filter(k => owned.has(k) && !redeemExpired(cur, k, cfg.redeemMs));
      const ultra = valid.find(k => ULTRA.has(k));
      if (ultra) valid = [ultra]; else valid = valid.slice(0, SLOTS[pkg]);

      const calc = computeOrder(pkg, valid);          // 价格服务器端重算
      cur.pkg = pkg;
      cur.orderCount = (cur.orderCount || 0) + 1;
      cur.orderBonusDays = cur.orderBonusDays || [];
      let granted = 0;
      if (!cur.orderBonusDays.includes(todayKey)) {   // 下单 +次数:每天只送一次,防刷
        cur.orderBonusDays.push(todayKey);
        cur.bonusTotal = (cur.bonusTotal || 0) + cfg.orderBonus;
        granted = cfg.orderBonus;
      }
      cur.lastSeen = Date.now();
      const code = orderCode(pkg, id, pkg + '|' + valid.slice().sort().join(',') + '|' + cur.orderCount);
      res = { ok: true, code, pkg, bundle: valid, final: calc.final, disc: calc.disc, free: calc.free, orderBonus: granted, chances: chancesOf(cur, todayKey), _name: cur.name, _phone: cur.phone };
      return cur;
    });
    if (res.ok) {
      await bumpStats(s => { s.orders = (s.orders || 0) + 1; });
      await saveRedemption({ code: res.code, memberId: id, name: res._name, phone: res._phone, pkg: res.pkg, bundle: res.bundle, final: res.final, free: res.free, status: 'issued', at: Date.now() });
      delete res._name; delete res._phone;
    }
    return json(res);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
};
