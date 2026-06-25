// POST /api/admin — 管理员写操作(需口令)。改动写进共用配置 → 全顾客下次读到
// action: get | setStatus | setWeights | addCode | delCode
import { loadConfig, saveConfig, adminOK, clampWeights, isStatus, json } from './_shared.mjs';
import { adminCookieOK } from './_member.mjs';

export const config = { path: '/api/admin' };

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const body = await req.json().catch(() => ({}));
    if (!(adminCookieOK(req) || adminOK(body.secret))) return json({ ok: false, error: 'auth' }, 401);

    const action = String(body.action || '');
    const cfg = await loadConfig();
    let mutated = false;

    if (action === 'get') {
      return json({ ok: true, status: cfg.status, weights: cfg.weights, codes: cfg.codes, rev: cfg.rev, activityStart: cfg.activityStart, dayDraws: cfg.dayDraws });
    } else if (action === 'setStatus') {
      const s = String(body.status || '');
      if (!isStatus(s)) return json({ ok: false, error: 'bad status' });
      cfg.status = s; mutated = true;
    } else if (action === 'setWeights') {
      cfg.weights = clampWeights(body.weights || {}, cfg.weights); mutated = true;
    } else if (action === 'addCode') {
      const c = String(body.code || '').trim().toUpperCase();
      const n = Math.floor(Number(body.draws));
      if (!c || !(n > 0)) return json({ ok: false, error: 'bad code' });
      cfg.codes = { ...cfg.codes, [c]: n }; mutated = true;
    } else if (action === 'delCode') {
      const c = String(body.code || '').trim().toUpperCase();
      const nc = { ...cfg.codes }; delete nc[c]; cfg.codes = nc; mutated = true;
    } else if (action === 'setActivityStart') {
      const d = String(body.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ ok: false, error: 'bad date' });
      cfg.activityStart = d; mutated = true;
    } else if (action === 'setServerDraws') {
      cfg.serverDraws = !!body.on; mutated = true;   // 全开/关闭服务器版抽奖
    } else {
      return json({ ok: false, error: 'unknown action' });
    }

    if (mutated) await saveConfig(cfg);
    return json({ ok: true, status: cfg.status, weights: cfg.weights, codes: cfg.codes, rev: cfg.rev });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
};
