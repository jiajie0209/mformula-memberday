// POST /api/d11 — 双11 拆红包:客人 play 公开;其余要管理员 cookie(同一套后台登入)
// 独立资料表 d11_plays,不碰大转盘的 members / config
import { adminCookieOK, json, kvGet, kvSet } from './_lib.js';

const KEYS = { x7k2: 2, q4m9: 4, z8p3: 6 };   // 3 个链接的暗码 → 可拆几次
const LINKS = [2, 4, 6];
const DEFAULT_ODDS = {
  sachet5:  { 2: 55.5, 4: 37,  6: 29 },
  sachet10: { 2: 10,   4: 20,  6: 25 },
  wow2:     { 2: 25,   4: 20,  6: 15 },
  wow5:     { 2: 4,    4: 10,  6: 12 },
  wow10:    { 2: 0.5,  4: 2,   6: 4 },
  care_oolong: { 2: 2, 4: 3, 6: 4 },
  care_aloe:   { 2: 2, 4: 3, 6: 4 },
  kegel:    { 2: 0.5,  4: 2,   6: 3 },
  box1:     { 2: 0.5,  4: 2.5, 6: 3.5 },
  box2:     { 2: 0,    4: 0.5, 6: 0.5 },
};
const IDS = Object.keys(DEFAULT_ODDS);

async function ensure(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS d11_plays (phone TEXT PRIMARY KEY, name TEXT NOT NULL, link INTEGER NOT NULL, seq TEXT NOT NULL, at INTEGER NOT NULL)'),
  ]);
}

async function loadCfg(env) {
  const c = await kvGet(env, 'd11_config');
  return { open: !!(c && c.open), odds: { ...DEFAULT_ODDS, ...((c && c.odds) || {}) } };
}

// 马来西亚 01x / 60 / +60,新加坡 8 位 / 65 / +65
function cleanPhone(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '').replace(/^00/, '');
  if (/^[3689]\d{7}$/.test(d)) return '65' + d;
  if (/^65[3689]\d{7}$/.test(d)) return d;
  if (d.startsWith('60')) d = '0' + d.slice(2).replace(/^0+/, '');
  else if (d.startsWith('1')) d = '0' + d;
  return /^01\d{8,9}$/.test(d) ? d : '';
}
function cleanName(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().replace(/^[=+\-@'"\s]+/, '').slice(0, 40);
}

function pick(odds, n) {
  const live = IDS.filter(id => odds[id][n] > 0);
  let x = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * live.reduce((a, id) => a + odds[id][n], 0);
  for (const id of live) { x -= odds[id][n]; if (x < 0) return id; }
  return live[live.length - 1];
}
const FIRST = 'rm50';   // 每个人第 1 个红包固定,其余才按机率
const shown = (odds, n) => [FIRST, ...IDS.filter(id => odds[id][n] > 0)];
const drawAll = (odds, n) => [FIRST, ...Array.from({ length: n - 1 }, () => pick(odds, n))];

// 这个配套抽不到、但大配套抽得到的奖品:一样显示出来,吸引升级(客服语音说明)
function locks(odds, n) {
  const out = {};
  for (const id of IDS) {
    if (odds[id][n] > 0) continue;
    const up = LINKS.find(l => l > n && odds[id][l] > 0);
    if (up) out[id] = up;
  }
  return out;
}

// 一个号码一份奖品;再进来拿回同一份。PRIMARY KEY 保证并发也只有一行
async function play(env, b) {
  const name = cleanName(b.name), phone = cleanPhone(b.phone), n = KEYS[b.k];
  if (!name || !phone || !n) return json({ ok: false, error: 'bad' });
  const cfg = await loadCfg(env);
  const find = () => env.DB.prepare('SELECT link, seq FROM d11_plays WHERE phone=?').bind(phone).first();
  let row = await find();
  if (!row) {
    if (!cfg.open) return json({ ok: false, error: 'closed' });
    const seq = drawAll(cfg.odds, n);
    await env.DB.prepare('INSERT INTO d11_plays (phone,name,link,seq,at) VALUES (?,?,?,?,?) ON CONFLICT(phone) DO NOTHING')
      .bind(phone, name, n, JSON.stringify(seq), Date.now()).run();
    row = await find();
  }
  return json({ ok: true, n: row.link, seq: JSON.parse(row.seq), show: shown(cfg.odds, row.link), lock: locks(cfg.odds, row.link) });
}

function validOdds(odds) {
  if (!odds || typeof odds !== 'object') return null;
  const out = {};
  for (const id of IDS) {
    const w = odds[id];
    if (!w) return null;
    out[id] = {};
    for (const n of LINKS) {
      const v = Number(w[n]);
      if (!Number.isFinite(v) || v < 0) return null;
      out[id][n] = v;
    }
  }
  for (const n of LINKS) {
    if (Math.abs(IDS.reduce((a, id) => a + out[id][n], 0) - 100) > 0.001) return null;
  }
  return out;
}

async function admin(env, b) {
  const cfg = await loadCfg(env);
  if (b.a === 'get') {
    const r = await env.DB.prepare('SELECT phone,name,link,seq,at FROM d11_plays ORDER BY at DESC').all();
    return json({ ok: true, open: cfg.open, odds: cfg.odds, rows: (r.results || []).map(x => ({ ...x, seq: JSON.parse(x.seq) })) });
  }
  if (b.a === 'preview') {
    const n = KEYS[b.k];
    if (!n) return json({ ok: false, error: 'bad' });
    const seq = drawAll(cfg.odds, n);
    return json({ ok: true, n, seq, show: shown(cfg.odds, n), lock: locks(cfg.odds, n) });
  }
  if (b.a === 'summary') {
    const r = await env.DB.prepare('SELECT COUNT(*) AS players, COALESCE(SUM(link),0) AS opens FROM d11_plays').first();
    return json({ ok: true, open: cfg.open, players: r.players, opens: r.opens });
  }
  if (b.a === 'setOdds') {
    const odds = validOdds(b.odds);
    if (!odds) return json({ ok: false, error: 'sum' });
    await kvSet(env, 'd11_config', { open: cfg.open, odds });
    return json({ ok: true });
  }
  if (b.a === 'setOpen') {
    await kvSet(env, 'd11_config', { open: !!b.open, odds: cfg.odds });
    return json({ ok: true, open: !!b.open });
  }
  if (b.a === 'reset') {
    const phone = cleanPhone(b.phone);
    if (!phone) return json({ ok: false, error: 'bad' });
    await env.DB.prepare('DELETE FROM d11_plays WHERE phone=?').bind(phone).run();
    return json({ ok: true });
  }
  return json({ ok: false, error: 'bad' });
}

export async function onRequestPost({ request, env }) {
  try {
    const b = await request.json().catch(() => ({}));
    await ensure(env);
    if (b.a === 'play') return await play(env, b);
    if (b.a === 'logout') return json({ ok: true }, 200, { 'set-cookie': 'mfadmin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
    if (!(await adminCookieOK(env, request))) return json({ ok: false, error: 'login' });
    return await admin(env, b);
  } catch (e) {
    return json({ ok: false, error: 'server' }, 500);
  }
}
