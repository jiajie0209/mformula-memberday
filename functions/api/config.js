// GET /api/config — 公开:状态 + 权重 + 真实参与人数
import { loadConfig, loadStats, json } from './_lib.js';

export async function onRequestGet({ env }) {
  try {
    const cfg = await loadConfig(env);
    const st = await loadStats(env);
    return json({ ok: true, rev: cfg.rev, status: cfg.status, weights: cfg.weights, off: cfg.off, days: cfg.dayDraws.length, dayDraws: cfg.dayDraws, serverDraws: cfg.serverDraws, activityStart: cfg.activityStart, participants: st.participants || 0 });
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
