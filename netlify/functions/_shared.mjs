// 共用后端逻辑:Netlify Blobs 存取 + 默认值 + 管理员校验
import { getStore } from '@netlify/blobs';

// 内置兑换码(永远有效,和默认权重一样作为兜底)
export const BUILTIN_CODES = { MEMBERDAY: 5, MFORMULA: 3, LIEW888: 10 };

export const DEFAULT_WEIGHTS = {
  v5: 22, v10: 14, v30: 5, v50: 1,
  g5: 18, g10: 12, g15: 5,
  tumbler: 10, duffle: 6, free: 0.5, gold: 0,
};
const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS);
const STATUSES = ['running', 'paused', 'updating', 'ended', 'closed'];

export const DEFAULT_CONFIG = {
  rev: 1, status: 'running', weights: { ...DEFAULT_WEIGHTS }, codes: {}, updatedAt: 0,
};

function cfgStore() {
  return getStore({ name: 'mfconfig', consistency: 'strong' });
}

// 读取共用配置(状态/权重/管理员加的码),自动补全形状
export async function loadConfig() {
  let c = null;
  try { c = await cfgStore().get('current', { type: 'json' }); } catch (e) { c = null; }
  const cfg = (c && typeof c === 'object') ? c : { ...DEFAULT_CONFIG };
  cfg.status = STATUSES.includes(cfg.status) ? cfg.status : 'running';
  cfg.weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights && typeof cfg.weights === 'object' ? cfg.weights : {}) };
  cfg.codes = (cfg.codes && typeof cfg.codes === 'object') ? cfg.codes : {};
  cfg.rev = Number.isFinite(cfg.rev) ? cfg.rev : 1;
  return cfg;
}

// 写回配置(rev 自增,作为客户端轮询的变更标记)
export async function saveConfig(cfg) {
  cfg.rev = (Number.isFinite(cfg.rev) ? cfg.rev : 1) + 1;
  cfg.updatedAt = Date.now();
  await cfgStore().setJSON('current', cfg);
  return cfg;
}

// 内置码 + 管理员加的码合并(管理员的优先)
export function effectiveCodes(cfg) {
  return { ...BUILTIN_CODES, ...((cfg && cfg.codes) || {}) };
}

// 管理员口令校验(常数时间比较;明文只存 Netlify 环境变量,不进代码)
export function adminOK(secret) {
  const want = process.env.ADMIN_SECRET || '';
  if (!want || typeof secret !== 'string' || secret.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= secret.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export function clampWeights(input, base) {
  const nw = { ...base };
  for (const k of WEIGHT_KEYS) {
    const v = Number(input && input[k]);
    if (Number.isFinite(v) && v >= 0) nw[k] = v;
  }
  return nw;
}

export const isStatus = s => STATUSES.includes(s);

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}
