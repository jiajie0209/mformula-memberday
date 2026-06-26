// POST /api/admin — 管理员写/读(cookie 或 body.secret 授权)
import { loadConfig, saveConfig, adminOK, adminCookieOK, clampWeights, isStatus, loadStats, getRedemption, saveRedemption, listLeads, json } from './_lib.js';

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
