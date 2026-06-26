// POST /api/order — 服务器下单:校验拥有+未过期 → 重算价格 → 发一次性码 → 每日首单加成
import { parseSession, loadConfig, casMember, chancesOf, dayInfo, computeOrder, redeemExpired, ULTRA, SLOTS, bumpStats, saveRedemption, sha256Hex, json } from './_lib.js';

async function orderCode(env, pkg, mid, sig) {
  const p = pkg === '4box' ? '4B' : '2B';
  const h = await sha256Hex((env.SESSION_SECRET || 'dev') + '|' + mid + '|' + sig);
  const n = parseInt(h.slice(0, 8), 16) % 1000000;
  return `MD-${p}-${String(n).padStart(6, '0')}`;
}

export async function onRequestPost({ request, env }) {
  try {
    const id = await parseSession(env, request);
    if (!id) return json({ ok: false, reason: 'nosession' }, 401);
    const body = await request.json().catch(() => ({}));
    const pkg = (body.pkg === '4box') ? '4box' : '2box';
    const wanted = Array.isArray(body.bundle) ? body.bundle.map(String) : [];
    const cfg = await loadConfig(env); const { todayKey } = dayInfo(cfg);

    let res = { ok: false, reason: 'retry' }, codeSig = '';
    await casMember(env, id, (cur) => {
      if (!cur) { res = { ok: false, reason: 'nosession' }; return null; }
      const owned = new Set(cur.won || []);
      let valid = wanted.filter(k => owned.has(k) && !redeemExpired(cur, k, cfg.redeemMs));
      const ultra = valid.find(k => ULTRA.has(k));
      if (ultra) valid = [ultra]; else valid = valid.slice(0, SLOTS[pkg]);
      const calc = computeOrder(pkg, valid);
      cur.pkg = pkg; cur.orderCount = (cur.orderCount || 0) + 1; cur.orderBonusDays = cur.orderBonusDays || [];
      let granted = 0;
      if (!cur.orderBonusDays.includes(todayKey)) { cur.orderBonusDays.push(todayKey); cur.bonusTotal = (cur.bonusTotal || 0) + cfg.orderBonus; granted = cfg.orderBonus; }
      cur.lastSeen = Date.now();
      codeSig = pkg + '|' + valid.slice().sort().join(',') + '|' + cur.orderCount;
      res = { ok: true, pkg, bundle: valid, final: calc.final, disc: calc.disc, free: calc.free, orderBonus: granted, chances: chancesOf(cur, todayKey), _name: cur.name, _phone: cur.phone };
      return cur;
    });
    if (res.ok) {
      res.code = await orderCode(env, pkg, id, codeSig);
      try { await saveRedemption(env, { code: res.code, memberId: id, name: res._name, phone: res._phone, pkg: res.pkg, bundle: res.bundle, final: res.final, free: res.free, status: 'issued', at: Date.now() }); } catch (e) {}
      try { await bumpStats(env, { orders: 1 }); } catch (e) {}
      delete res._name; delete res._phone;
    }
    return json(res);
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
