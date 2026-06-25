// Phase 2 后端核心:会员账本(防刷)、库存、天数、会话签名、服务器端抽奖
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

// 转盘 11 格的顺序(必须和前端 WHEEL 一致),用于返回 landing idx
export const WHEEL_KEYS = ['v5', 'v10', 'v30', 'v50', 'g5', 'g10', 'g15', 'tumbler', 'duffle', 'free', 'gold'];
export const ULTRA = new Set(['free', 'gold']);
export const STOCK_DEFAULT = { tumbler: 30, duffle: 12, free: 3, gold: 1 };

const memStore = () => getStore({ name: 'mfmembers', consistency: 'strong' });
const stockStore = () => getStore({ name: 'mfstock', consistency: 'strong' });
const sentinelStore = () => getStore({ name: 'mfsentinel', consistency: 'strong' });

/* ---------- 身份规范化 + memberId ---------- */
export function normName(n) { return String(n || '').trim().toLowerCase(); }
// 0173628890 / +60 17-362 8890 / 60173628890 → 173628890;非大马手机返回 null
export function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('60')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return /^1[0-9]{8,9}$/.test(d) ? d : null;
}
export function memberId(name, phone) {
  const np = normPhone(phone);
  if (!np) return null;
  return crypto.createHash('sha256').update(normName(name) + '|' + np).digest('hex').slice(0, 32);
}

/* ---------- 会话签名(HMAC,httpOnly cookie) ---------- */
function hmac(s) { return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev').update(s).digest('hex').slice(0, 24); }
export function signSession(id) { return id + '.' + hmac(id); }
export function parseSession(req) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/mfsess=([^;]+)/);
  if (!m) return null;
  const val = decodeURIComponent(m[1]);
  const dot = val.lastIndexOf('.');
  if (dot < 0) return null;
  const id = val.slice(0, dot), sig = val.slice(dot + 1);
  return (id && sig === hmac(id)) ? id : null;
}
export function sessionCookie(id) {
  return `mfsess=${encodeURIComponent(signSession(id))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

/* ---------- KL 日期 + 活动第几天 ---------- */
export function klDate(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(now)); // YYYY-MM-DD
}
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
// 返回 { day:0..8, todayKey }。day=0 表示活动未开始;day>7 表示已结束
export function dayInfo(cfg, now = Date.now()) {
  const todayKey = klDate(now);
  const diff = daysBetween(cfg.activityStart, todayKey); // 0 = 第一天
  return { day: diff + 1, todayKey };
}

/* ---------- 会员账本 ---------- */
export function freshMember(id, name, phone) {
  return {
    memberId: id, name: String(name || ''), phone: normPhone(phone), createdAt: Date.now(), lastSeen: Date.now(),
    days: {}, bonusTotal: 0, bonusUsed: 0,
    codesUsed: [], shareDays: [], orderCount: 0,
    won: [], wonAt: {}, pkg: '2box',
  };
}
// 当前可用次数 = 今天基础(granted-used) + 加成(bonusTotal-bonusUsed)
export function chancesOf(member, todayKey) {
  const d = member.days[todayKey] || { granted: 0, used: 0 };
  return Math.max(0, d.granted - d.used) + Math.max(0, member.bonusTotal - member.bonusUsed);
}

// 读—改—写(CAS 重试),mutate(cur|null) 返回新对象;返回最终对象
export async function casMember(id, mutate, tries = 6) {
  const store = memStore();
  for (let i = 0; i < tries; i++) {
    let cur = null, etag;
    try { const r = await store.getWithMetadata(id, { type: 'json' }); if (r) { cur = r.data; etag = r.etag; } } catch (e) { cur = null; }
    const next = mutate(cur ? JSON.parse(JSON.stringify(cur)) : null);
    if (next === null) return cur; // mutate 决定不写
    try {
      const opts = cur ? { onlyIfMatch: etag } : { onlyIfNew: true };
      const res = await store.setJSON(id, next, opts);
      if (res && res.modified === false) continue; // 冲突 → 重试
      return next;
    } catch (e) { /* 冲突 → 重试 */ }
  }
  throw new Error('cas_failed');
}
export async function getMember(id) {
  try { return await memStore().get(id, { type: 'json' }); } catch (e) { return null; }
}

/* ---------- 库存 + 999金独苗哨兵 ---------- */
export async function loadStock() {
  let s = null;
  try { s = await stockStore().get('current', { type: 'json' }); } catch (e) { s = null; }
  return (s && typeof s === 'object') ? s : { ...STOCK_DEFAULT };
}
export async function saveStock(s) { try { await stockStore().setJSON('current', s); } catch (e) {} }
// 尽力扣库存(限量奖才有库存键);成功返回 true
export async function spendStock(key) {
  if (STOCK_DEFAULT[key] === undefined) return true; // 无限量
  if (key === 'gold') { // 1 选 1:谁先建哨兵谁中
    try { const r = await sentinelStore().setJSON('gold:winner', { at: Date.now() }, { onlyIfNew: true }); return !(r && r.modified === false); }
    catch (e) { return false; }
  }
  const s = await loadStock();
  if (!(s[key] > 0)) return false;
  s[key] = s[key] - 1; await saveStock(s);
  return true;
}

/* ---------- 服务器端加权抽奖(只抽未拥有 + 有库存 + 权重>0) ---------- */
export async function pickPrize(weights, ownedSet) {
  const stock = await loadStock();
  const pool = WHEEL_KEYS.filter(k => !ownedSet.has(k) && (weights[k] || 0) > 0 && (STOCK_DEFAULT[k] === undefined || (stock[k] || 0) > 0));
  if (!pool.length) return null;
  const total = pool.reduce((a, k) => a + (weights[k] || 0), 0);
  let r = Math.random() * total;
  for (const k of pool) { r -= (weights[k] || 0); if (r <= 0) return k; }
  return pool[pool.length - 1];
}

export const idxOf = key => WHEEL_KEYS.indexOf(key);
