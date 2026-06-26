// MFormula Member Day — Cloudflare Pages Functions 共用逻辑(D1 数据库)
// 与 Netlify 版逻辑一致;存储换成 D1(SQL 原子操作,扛 1000+ 并发)

const enc = new TextEncoder();

/* ---------- Web Crypto(Workers 原生) ---------- */
export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
}

/* ---------- 常量 ---------- */
export const DEFAULT_WEIGHTS = { v5: 22, v10: 14, v30: 5, v50: 1, g5: 18, g10: 12, g15: 5, tumbler: 10, duffle: 6, free: 0.5, gold: 0 };
const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS);
export const STATUSES = ['running', 'paused', 'updating', 'ended', 'closed'];
export const isStatus = s => STATUSES.includes(s);
export const BUILTIN_CODES = { MEMBERDAY: 5, MFORMULA: 3, LIEW888: 10 };
export const WHEEL_KEYS = ['v5', 'v10', 'v30', 'v50', 'g5', 'g10', 'g15', 'tumbler', 'duffle', 'free', 'gold'];
export const ULTRA = new Set(['free', 'gold']);
export const STOCK_DEFAULT = { tumbler: 30, duffle: 12, free: 3, gold: 1 };
export const PKG_PRICE = { '2box': 358, '4box': 716 };
export const SLOTS = { '2box': 2, '4box': 3 };
export const DISC = { v5: [5, 10], v10: [10, 20], v30: [30, 60], v50: [50, 100] };
export const idxOf = k => WHEEL_KEYS.indexOf(k);

export const DEFAULT_CONFIG = {
  rev: 1, status: 'running', weights: { ...DEFAULT_WEIGHTS }, codes: {}, updatedAt: 0,
  dayDraws: [5, 1, 1, 1, 1, 1, 3], shareBonus: 2, orderBonus: 3, redeemMs: 86400000,
  activityStart: '2026-07-01', serverDraws: false,
};

/* ---------- D1 通用键值(config 等存 JSON) ---------- */
export async function kvGet(env, k) {
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind(k).first();
  try { return r ? JSON.parse(r.v) : null; } catch (e) { return null; }
}
export async function kvSet(env, k, v) {
  await env.DB.prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, JSON.stringify(v)).run();
}

export async function loadConfig(env) {
  let c = await kvGet(env, 'config');
  const cfg = (c && typeof c === 'object') ? c : { ...DEFAULT_CONFIG };
  cfg.status = STATUSES.includes(cfg.status) ? cfg.status : 'running';
  cfg.weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights && typeof cfg.weights === 'object' ? cfg.weights : {}) };
  cfg.codes = (cfg.codes && typeof cfg.codes === 'object') ? cfg.codes : {};
  cfg.rev = Number.isFinite(cfg.rev) ? cfg.rev : 1;
  cfg.dayDraws = (Array.isArray(cfg.dayDraws) && cfg.dayDraws.length === 7) ? cfg.dayDraws : [5, 1, 1, 1, 1, 1, 3];
  cfg.shareBonus = Number.isFinite(cfg.shareBonus) ? cfg.shareBonus : 2;
  cfg.orderBonus = Number.isFinite(cfg.orderBonus) ? cfg.orderBonus : 3;
  cfg.redeemMs = Number.isFinite(cfg.redeemMs) ? cfg.redeemMs : 86400000;
  cfg.activityStart = (typeof cfg.activityStart === 'string') ? cfg.activityStart : '2026-07-01';
  cfg.serverDraws = !!cfg.serverDraws;
  return cfg;
}
export async function saveConfig(env, cfg) {
  cfg.rev = (Number.isFinite(cfg.rev) ? cfg.rev : 1) + 1;
  cfg.updatedAt = Date.now();
  await kvSet(env, 'config', cfg);
  return cfg;
}
export function effectiveCodes(cfg) { return { ...BUILTIN_CODES, ...((cfg && cfg.codes) || {}) }; }
export function clampWeights(input, base) {
  const nw = { ...base };
  for (const k of WEIGHT_KEYS) { const v = Number(input && input[k]); if (Number.isFinite(v) && v >= 0) nw[k] = v; }
  return nw;
}

/* ---------- 身份 / 会话 / 管理员 ---------- */
export function normName(n) { return String(n || '').trim().toLowerCase(); }
export function normPhone(p) { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('60')) d = d.slice(2); if (d.startsWith('0')) d = d.slice(1); return /^1[0-9]{8,9}$/.test(d) ? d : null; }
export async function memberId(name, phone) { const np = normPhone(phone); if (!np) return null; return (await sha256Hex(normName(name) + '|' + np)).slice(0, 32); }

const SESSION_TTL = 2592000000;   // 30 天
const ADMIN_TTL = 43200000;       // 12 小时
// 不再回退 'dev':没配密钥就失败关闭(防止未配置时签出可伪造的 cookie)
function sessSecret(env) { const s = env.SESSION_SECRET; if (!s) throw new Error('SESSION_SECRET_unset'); return s; }
function adminSecret(env) { const s = env.ADMIN_SECRET; if (!s) throw new Error('ADMIN_SECRET_unset'); return s; }

export async function signSession(env, id) {
  const exp = Date.now() + SESSION_TTL, payload = id + '.' + exp;
  return payload + '.' + (await hmacHex(sessSecret(env), payload)).slice(0, 24);
}
export async function sessionCookie(env, id) { return `mfsess=${encodeURIComponent(await signSession(env, id))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`; }
export async function parseSession(env, request) {
  const m = (request.headers.get('cookie') || '').match(/mfsess=([^;]+)/); if (!m) return null;
  const parts = decodeURIComponent(m[1]).split('.'); if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!id || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;        // 服务器端校验过期
  const want = (await hmacHex(sessSecret(env), id + '.' + exp)).slice(0, 24);
  return sig === want ? id : null;
}
// 管理员 cookie:用 ADMIN_SECRET 签名 + 内嵌过期(轮换 ADMIN_SECRET 即吊销;与顾客会话密钥分离)
async function adminTok(env, exp) { return 'a1.' + exp + '.' + (await hmacHex(adminSecret(env), 'mfadmin-v1.' + exp)).slice(0, 24); }
export async function adminCookie(env) { const exp = Date.now() + ADMIN_TTL; return `mfadmin=${encodeURIComponent(await adminTok(env, exp))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`; }
export async function adminCookieOK(env, request) {
  const m = (request.headers.get('cookie') || '').match(/mfadmin=([^;]+)/); if (!m) return false;
  const val = decodeURIComponent(m[1]), parts = val.split('.');
  if (parts.length !== 3 || parts[0] !== 'a1' || !/^\d+$/.test(parts[1]) || Number(parts[1]) < Date.now()) return false;
  return val === await adminTok(env, Number(parts[1]));
}
export function adminOK(env, secret) {
  const want = env.ADMIN_SECRET || '';
  if (!want || typeof secret !== 'string' || secret.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= secret.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

/* ---------- 天数(KL 时区) ---------- */
export function klDate(now) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(now || Date.now())); }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
export function dayInfo(cfg, now) { const todayKey = klDate(now); return { day: daysBetween(cfg.activityStart, todayKey) + 1, todayKey }; }

/* ---------- 会员账本(乐观锁 CAS) ---------- */
export function freshMember(id, name, phone) {
  return { memberId: id, name: String(name || ''), phone: normPhone(phone), createdAt: Date.now(), lastSeen: Date.now(),
    days: {}, bonusTotal: 0, bonusUsed: 0, codesUsed: [], orderCount: 0, orderBonusDays: [], won: [], wonAt: {}, pkg: '2box' };
}
export function chancesOf(member, todayKey) {
  const d = member.days[todayKey] || { granted: 0, used: 0 };
  return Math.max(0, d.granted - d.used) + Math.max(0, (member.bonusTotal || 0) - (member.bonusUsed || 0));
}
export async function getMember(env, id) {
  const r = await env.DB.prepare('SELECT data,version FROM members WHERE id=?').bind(id).first();
  if (!r) return null;
  try { return { data: JSON.parse(r.data), version: r.version }; } catch (e) { return null; }
}
export async function casMember(env, id, mutate, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const cur = await getMember(env, id);
    const next = mutate(cur ? JSON.parse(JSON.stringify(cur.data)) : null);
    if (next === null) return cur ? cur.data : null;
    const ordered = (next.orderCount > 0) ? 1 : 0;
    const played = ((next.won && next.won.length > 0) || (next.bonusUsed || 0) > 0 || Object.values(next.days || {}).some(d => (d.used || 0) > 0)) ? 1 : 0;
    let r;
    if (!cur) {
      r = await env.DB.prepare('INSERT INTO members (id,data,version,ordered,played) VALUES (?,?,1,?,?) ON CONFLICT(id) DO NOTHING')
        .bind(id, JSON.stringify(next), ordered, played).run();
    } else {
      r = await env.DB.prepare('UPDATE members SET data=?, version=version+1, ordered=?, played=? WHERE id=? AND version=?')
        .bind(JSON.stringify(next), ordered, played, id, cur.version).run();
    }
    if (r.meta.changes > 0) return next;
    if (i < tries - 1) await new Promise(res => setTimeout(res, 2 + Math.floor(Math.random() * 8) * (i + 1)));   // 退避+抖动,降低高并发冲突
  }
  throw new Error('cas_failed');
}

/* ---------- 库存 + 999金哨兵(原子) ---------- */
async function stockMap(env) {
  const rows = (await env.DB.prepare('SELECT k,qty FROM stock').all()).results || [];
  const m = {}; for (const r of rows) m[r.k] = r.qty; return m;
}
export async function spendStock(env, key) {
  if (STOCK_DEFAULT[key] === undefined) return true;          // 无限量
  if (key === 'gold') { const r = await env.DB.prepare("INSERT INTO sentinels (k) VALUES ('gold') ON CONFLICT(k) DO NOTHING").run(); return r.meta.changes > 0; }
  await env.DB.prepare('INSERT INTO stock (k,qty) VALUES (?,?) ON CONFLICT(k) DO NOTHING').bind(key, STOCK_DEFAULT[key]).run();
  const r = await env.DB.prepare('UPDATE stock SET qty=qty-1 WHERE k=? AND qty>0').bind(key).run();
  return r.meta.changes > 0;
}
export async function refundStock(env, key) {
  if (STOCK_DEFAULT[key] === undefined || key === 'gold') return;
  await env.DB.prepare('UPDATE stock SET qty=qty+1 WHERE k=?').bind(key).run();
}
// 归还预扣的库存(含 gold 哨兵)——抽奖没记成时调用,避免库存/大奖永久漏掉
export async function releaseStock(env, key) {
  if (key === 'gold') { await env.DB.prepare("DELETE FROM sentinels WHERE k='gold'").run(); return; }
  await refundStock(env, key);
}
export async function pickPrize(env, weights, ownedSet) {
  const stock = await stockMap(env);
  const pool = WHEEL_KEYS.filter(k => !ownedSet.has(k) && (weights[k] || 0) > 0 &&
    (STOCK_DEFAULT[k] === undefined || (stock[k] === undefined ? STOCK_DEFAULT[k] : stock[k]) > 0));
  if (!pool.length) return null;
  const total = pool.reduce((a, k) => a + (weights[k] || 0), 0);
  let r = Math.random() * total;
  for (const k of pool) { r -= (weights[k] || 0); if (r <= 0) return k; }
  return pool[pool.length - 1];
}

/* ---------- 统计(原子自增,扛并发) ---------- */
export async function bumpStats(env, fields) {
  await env.DB.prepare('INSERT INTO stats (id,participants,spins,orders) VALUES (1,0,0,0) ON CONFLICT(id) DO NOTHING').run();
  const sets = [], binds = [];
  for (const k of ['participants', 'spins', 'orders']) if (fields[k]) { sets.push(`${k}=${k}+?`); binds.push(fields[k]); }
  if (sets.length) await env.DB.prepare(`UPDATE stats SET ${sets.join(',')} WHERE id=1`).bind(...binds).run();
}
export async function bumpPrize(env, key) {
  await env.DB.prepare('INSERT INTO prize_counts (k,n) VALUES (?,1) ON CONFLICT(k) DO UPDATE SET n=n+1').bind(key).run();
}
export async function setWinner(env, id, name, n) {
  await env.DB.prepare('INSERT INTO winners (id,name,n) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, n=excluded.n').bind(id, name, n).run();
}
export async function loadStats(env) {
  const s = (await env.DB.prepare('SELECT participants,spins,orders FROM stats WHERE id=1').first()) || { participants: 0, spins: 0, orders: 0 };
  const pc = (await env.DB.prepare('SELECT k,n FROM prize_counts').all()).results || [];
  const w = (await env.DB.prepare('SELECT name,n FROM winners ORDER BY n DESC LIMIT 8').all()).results || [];
  const prizeCounts = {}; for (const r of pc) prizeCounts[r.k] = r.n;
  return { participants: s.participants || 0, spins: s.spins || 0, orders: s.orders || 0, prizeCounts, winners: w };
}
export function maskName(n) { n = String(n || '').trim(); return n.length <= 1 ? (n + '***') : (n.slice(0, Math.min(3, n.length)) + '***'); }

/* ---------- 下单记录 + 价格 + 名单 ---------- */
export async function saveRedemption(env, rec) {
  await env.DB.prepare('INSERT INTO redemptions (code,data,status) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data, status=excluded.status')
    .bind(rec.code, JSON.stringify(rec), rec.status || 'issued').run();
}
export async function getRedemption(env, code) {
  const r = await env.DB.prepare('SELECT data FROM redemptions WHERE code=?').bind(code).first();
  try { return r ? JSON.parse(r.data) : null; } catch (e) { return null; }
}
export function redeemExpired(member, key, redeemMs) { const t = member.wonAt && member.wonAt[key]; return !!t && (t + redeemMs <= Date.now()); }
export function computeOrder(pkg, bundle) {
  const price = PKG_PRICE[pkg] || PKG_PRICE['2box'];
  if (bundle.includes('free')) return { final: 0, disc: price, free: true };
  const idx = pkg === '4box' ? 1 : 0;
  let disc = 0; for (const k of bundle) if (DISC[k]) disc += DISC[k][idx];
  return { final: Math.max(0, price - disc), disc, free: false };
}
export async function listLeads(env) {
  const rows = (await env.DB.prepare('SELECT data FROM members WHERE played=1 AND ordered=0').all()).results || [];
  const out = [];
  for (const row of rows) {
    let m; try { m = JSON.parse(row.data); } catch (e) { continue; }
    const drawsUsed = Object.values(m.days || {}).reduce((s, d) => s + (d.used || 0), 0) + (m.bonusUsed || 0);
    out.push({ name: m.name, phone: m.phone, prizes: m.won || [], wonAt: m.wonAt || {}, drawsUsed, lastSeen: m.lastSeen || 0 });
  }
  return out;
}
