// POST /api/admin — 管理员写/读(cookie 或 body.secret 授权)
import { loadConfig, saveConfig, adminOK, adminCookieOK, clampWeights, isStatus, loadStats, getRedemption, saveRedemption, listLeads, normPhone, json } from './_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!((await adminCookieOK(env, request)) || adminOK(env, body.secret))) return json({ ok: false, error: 'auth' }, 401);
    const action = String(body.action || '');

    if (action === 'stats') return json({ ok: true, stats: await loadStats(env) });
    if (action === 'leads') return json({ ok: true, leads: await listLeads(env) });
    if (action === 'csVerify') { const c = String(body.code || '').trim().toUpperCase(); return json({ ok: true, rec: (await getRedemption(env, c)) || null }); }
    if (action === 'csRedeem') {
      const c = String(body.code || '').trim().toUpperCase();
      const rec = await getRedemption(env, c); if (!rec) return json({ ok: false, error: 'notfound' });
      rec.status = 'redeemed'; rec.redeemedAt = Date.now(); await saveRedemption(env, rec);
      return json({ ok: true, rec });
    }
    if (action === 'resetData') {   // 清空运营/测试数据(保留 config:概率/状态/兑换码/开始日)
      for (const t of ['members', 'stats', 'prize_counts', 'winners', 'stock', 'sentinels', 'redemptions']) {
        await env.DB.prepare('DELETE FROM ' + t).run();
      }
      return json({ ok: true, reset: true });
    }
    if (action === 'findPhone') {   // 客服查:电话 → 抽了什么奖 / 有没有下单(只读,不改任何东西)
      const np = normPhone(body.phone || '');
      if (!np) return json({ ok: true, found: [] });
      const rows = (await env.DB.prepare('SELECT data FROM members WHERE data LIKE ?').bind('%"phone":"' + np + '"%').all()).results || [];
      const found = [];
      for (const row of rows) {
        let m; try { m = JSON.parse(row.data); } catch (e) { continue; }
        if (m.phone !== np) continue;
        found.push({ name: m.name, phone: m.phone, won: m.won || [], wonAt: m.wonAt || {}, pkg: m.pkg, orderCount: m.orderCount || 0 });
      }
      return json({ ok: true, found });
    }
    if (action === 'delMember') {   // 删顾客(电话):清测试/重复/刷号 —— 连带参加人数 -1
      const np = normPhone(body.phone || '');
      if (!np) return json({ ok: false, error: 'bad phone' });
      const rows = (await env.DB.prepare('SELECT id,data FROM members WHERE data LIKE ?').bind('%"phone":"' + np + '"%').all()).results || [];
      let n = 0;
      for (const row of rows) {
        let m; try { m = JSON.parse(row.data); } catch (e) { continue; }
        if (m.phone !== np) continue;
        const r = await env.DB.prepare('DELETE FROM members WHERE id=?').bind(row.id).run();
        n += (r.meta && r.meta.changes) || 0;
      }
      if (n > 0) await env.DB.prepare('UPDATE stats SET participants = max(0, participants - ?) WHERE id=1').bind(n).run();
      return json({ ok: true, deleted: n });
    }

    const cfg = await loadConfig(env); let mutated = false;
    if (action === 'get') {
      return json({ ok: true, status: cfg.status, weights: cfg.weights, codes: cfg.codes, rev: cfg.rev, activityStart: cfg.activityStart, dayDraws: cfg.dayDraws });
    } else if (action === 'setStatus') {
      const s = String(body.status || ''); if (!isStatus(s)) return json({ ok: false, error: 'bad status' }); cfg.status = s; mutated = true;
    } else if (action === 'setWeights') {
      cfg.weights = clampWeights(body.weights || {}, cfg.weights); mutated = true;
    } else if (action === 'addCode') {
      const c = String(body.code || '').trim().toUpperCase(); const n = Math.floor(Number(body.draws));
      if (!c || !(n > 0)) return json({ ok: false, error: 'bad code' }); cfg.codes = { ...cfg.codes, [c]: n }; mutated = true;
    } else if (action === 'delCode') {
      const c = String(body.code || '').trim().toUpperCase(); const nc = { ...cfg.codes }; delete nc[c]; cfg.codes = nc; mutated = true;
    } else if (action === 'clearCodes') {
      cfg.codes = {}; mutated = true;
    } else if (action === 'setActivityStart') {
      const d = String(body.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ ok: false, error: 'bad date' }); cfg.activityStart = d; mutated = true;
    } else if (action === 'setServerDraws') {
      cfg.serverDraws = !!body.on; mutated = true;
    } else {
      return json({ ok: false, error: 'unknown action' });
    }
    if (mutated) await saveConfig(env, cfg);
    return json({ ok: true, status: cfg.status, weights: cfg.weights, codes: cfg.codes, rev: cfg.rev });
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
