// POST /api/d11 — 双11 拆红包:客人 play / choose 公开;其余要管理员 cookie(同一套后台登入)
// 每个人拆 6 个红包,截图给客服,在 WhatsApp 选配套和礼物:2盒 1 样、4盒 3 样、6盒 6 样
// 独立资料表 d11_draws,不碰大转盘的 members / config
import { adminCookieOK, json, kvGet, kvSet } from './_lib.js';

const ZONES = ['a', 'b'];   // a = 第 2–3 个红包,b = 第 4–6 个红包
// 目标成本率(含抽奖、已扣 RM50):2盒 35.7% 以内,4盒 39–39.9%,6盒 41–42.8%
const DEFAULT_ODDS = {
  sachet5:     { a: 55,  b: 5 },
  sachet10:    { a: 4,   b: 35 },
  wow2:        { a: 38,  b: 0 },
  wow5:        { a: 2,   b: 30 },
  wow10:       { a: 0.4, b: 12 },
  care_oolong: { a: 0.3, b: 9 },
  care_aloe:   { a: 0.3, b: 9 },
  kegel:       { a: 0,   b: 0 },
  box1:        { a: 0,   b: 0 },
  box2:        { a: 0,   b: 0 },
};
const ODDS_VERSION = 5;   // 改了奖品表就加一,旧的保存值不再用
const IDS = Object.keys(DEFAULT_ODDS);
const FIRST = 'rm50';     // 每个人第 1 个红包固定
const END_AT = Date.UTC(2026, 10, 11, 15, 59, 0);   // 11/11 23:59 马来西亚时间

async function ensure(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS d11_draws (phone TEXT PRIMARY KEY, name TEXT NOT NULL, pkg INTEGER NOT NULL DEFAULT 0, seq TEXT NOT NULL, at INTEGER NOT NULL)'),
  ]);
}

async function loadCfg(env) {
  const c = await kvGet(env, 'd11_config');
  const saved = c && c.v === ODDS_VERSION ? c.odds : null;
  return { open: !!(c && c.open), odds: saved ? { ...DEFAULT_ODDS, ...saved } : { ...DEFAULT_ODDS } };
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

function pick(odds, z) {
  const live = IDS.filter(id => odds[id][z] > 0);
  let x = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * live.reduce((a, id) => a + odds[id][z], 0);
  for (const id of live) { x -= odds[id][z]; if (x < 0) return id; }
  return live[live.length - 1];
}
const drawAll = odds => [FIRST, pick(odds, 'a'), pick(odds, 'a'), pick(odds, 'b'), pick(odds, 'b'), pick(odds, 'b')];
const ALWAYS = ['box1', 'box2'];   // 就算 0% 也放在奖品列表:大配套由客服直接升级送
const shown = odds => [FIRST, ...IDS.filter(id => ALWAYS.includes(id) || odds[id].a > 0 || odds[id].b > 0)];

// 一个号码一份奖品;再进来拿回同一份。PRIMARY KEY 保证并发也只有一行
async function play(env, b) {
  const name = cleanName(b.name), phone = cleanPhone(b.phone);
  if (!name || !phone) return json({ ok: false, error: 'bad' });
  const cfg = await loadCfg(env);
  const find = () => env.DB.prepare('SELECT seq FROM d11_draws WHERE phone=?').bind(phone).first();
  let row = await find();
  if (!row) {
    if (Date.now() >= END_AT) return json({ ok: false, error: 'ended' });
    if (!cfg.open) return json({ ok: false, error: 'closed' });
    await env.DB.prepare('INSERT INTO d11_draws (phone,name,seq,at) VALUES (?,?,?,?) ON CONFLICT(phone) DO NOTHING')
      .bind(phone, name, JSON.stringify(drawAll(cfg.odds)), Date.now()).run();
    row = await find();
  }
  return json({ ok: true, seq: JSON.parse(row.seq), show: shown(cfg.odds) });
}

function validOdds(odds) {
  if (!odds || typeof odds !== 'object') return null;
  const out = {};
  for (const id of IDS) {
    const w = odds[id];
    if (!w) return null;
    out[id] = {};
    for (const z of ZONES) {
      const v = Number(w[z]);
      if (!Number.isFinite(v) || v < 0) return null;
      out[id][z] = v;
    }
  }
  for (const z of ZONES) {
    if (Math.abs(IDS.reduce((a, id) => a + out[id][z], 0) - 100) > 0.001) return null;
  }
  return out;
}

async function admin(env, b) {
  const cfg = await loadCfg(env);
  if (b.a === 'get') {
    const r = await env.DB.prepare('SELECT phone,name,seq,at FROM d11_draws ORDER BY at DESC').all();
    return json({ ok: true, open: cfg.open, odds: cfg.odds, rows: (r.results || []).map(x => ({ ...x, seq: JSON.parse(x.seq) })) });
  }
  if (b.a === 'preview') return json({ ok: true, seq: drawAll(cfg.odds), show: shown(cfg.odds) });
  if (b.a === 'summary') {
    const r = await env.DB.prepare('SELECT COUNT(*) AS players FROM d11_draws').first();
    return json({ ok: true, open: cfg.open, players: r.players });
  }
  if (b.a === 'setOdds') {
    const odds = validOdds(b.odds);
    if (!odds) return json({ ok: false, error: 'sum' });
    await kvSet(env, 'd11_config', { v: ODDS_VERSION, open: cfg.open, odds });
    return json({ ok: true });
  }
  if (b.a === 'setOpen') {
    await kvSet(env, 'd11_config', { v: ODDS_VERSION, open: !!b.open, odds: cfg.odds });
    return json({ ok: true, open: !!b.open });
  }
  if (b.a === 'reset') {
    const phone = cleanPhone(b.phone);
    if (!phone) return json({ ok: false, error: 'bad' });
    await env.DB.prepare('DELETE FROM d11_draws WHERE phone=?').bind(phone).run();
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
