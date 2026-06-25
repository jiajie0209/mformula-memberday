// GET /api/config — 公开:返回活动状态 + 中奖权重 + 变更标记 rev
// 注意:不暴露兑换码金额(兑换走 /api/redeem 服务器校验)
import { loadConfig, json } from './_shared.mjs';

export const config = { path: '/api/config' };

export default async () => {
  try {
    const cfg = await loadConfig();
    return json({ ok: true, rev: cfg.rev, status: cfg.status, weights: cfg.weights, serverDraws: cfg.serverDraws });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
};
