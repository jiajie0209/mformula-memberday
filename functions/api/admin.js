// POST /api/admin — 管理员写/读(cookie 或 body.secret 授权)
import { loadConfig, saveConfig, adminOK, adminCookieOK, clampWeights, isStatus, loadStats, getRedemption, saveRedemption, listLeads, normPhone, json, kvSet, kvGet,
  getCampaign, setCampaign, archiveCampaign, rollupCustomers, resetWorkingTables, getArchive, listArchives, customerFull,
  ensureArchiveTables, ensureCampaigns, getCampaignReg, putCampaignReg, insertCampaignRegIfAbsent, listCampaignRegs,
  DEFAULT_CONFIG, DEFAULT_WEIGHTS, klDate } from './_lib.js';

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

    /* ===== 阶段2:活动登记 + 7月迁移(第0步:先看状态,再显式迁移) ===== */
    if (action === 'migrateStatus') {   // 只读:报告 7月当前数据状态,不动任何东西
      await ensureArchiveTables(env); await ensureCampaigns(env);
      const camp = await getCampaign(env);
      const cfg = await loadConfig(env);
      const st = await loadStats(env);
      const archived = !!(await getArchive(env, '2026-07'));
      const memRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first();
      const custRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first();
      const reg = await getCampaignReg(env, 'MMD070726');
      const regCount = (await listCampaignRegs(env)).length;
      return json({ ok: true, status: {
        currentCampaignId: camp.id, currentTitle: camp.title, cfgStatus: cfg.status,
        julyArchived: archived, liveMembers: (memRow && memRow.n) || 0, liveParticipants: st.participants || 0, liveOrders: st.orders || 0,
        customersCount: (custRow && custRow.n) || 0, alreadyRegistered: !!reg, registryCount: regCount,
      } });
    }
    if (action === 'migrateJuly') {   // 显式迁移:7月 → 登记为 MMD070726(已结束)。幂等,先存档(若还没)再登记
      await ensureArchiveTables(env); await ensureCampaigns(env);
      const JK = '2026-07';
      const camp = await getCampaign(env);
      const julyCamp = { id: JK, title: camp.title || '会员日 · 七月大转盘', theme: 'wheel', start: camp.start || '2026-07-01', end: camp.end || '2026-07-07' };
      let archived = !!(await getArchive(env, JK));
      const memRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first();
      const memCount = (memRow && memRow.n) || 0;
      const st = await loadStats(env);
      let rolled = 0, branch;
      if (!archived && memCount === 0 && (st.participants || 0) === 0) {
        branch = 'empty';                                                    // 真没数据 → 只登记
      } else {
        if (!archived) { await archiveCampaign(env, julyCamp); archived = true; }   // 存档(只做一次,不零覆盖)
        rolled = await rollupCustomers(env, julyCamp);                       // 幂等:补完任何没滚进档案的顾客(可安全重跑)
        await resetWorkingTables(env);                                       // 幂等:清空(已空则无操作)
        branch = 'migrated';
      }
      const cfg = await loadConfig(env);   // 7月的设置原样存进登记条目(完整快照,别只靠 archive)
      const rec = { id: 'MMD070726', title: julyCamp.title, theme: 'wheel', status: 'ended', start: julyCamp.start, end: julyCamp.end,
        config: cfg, archiveId: JK, historyKey: JK, createdAt: Date.now(), updatedAt: Date.now() };
      const inserted = await insertCampaignRegIfAbsent(env, rec);
      await kvSet(env, 'live_campaign', null);                                  // 迁移后没有正在进行的活动
      if (cfg.status !== 'closed') { cfg.status = 'closed'; await saveConfig(env, cfg); }
      return json({ ok: true, branch, rolled, registered: inserted, alreadyRegistered: !inserted, archiveExists: archived });
    }

    /* ===== 阶段A:活动列表 + 新建活动 + 存档详情 ===== */
    if (action === 'listCampaigns') {
      await ensureCampaigns(env); await ensureArchiveTables(env);
      const regs = await listCampaignRegs(env);
      const liveId = await kvGet(env, 'live_campaign');
      const out = [];
      for (const r of regs) {
        let stats = null;
        if (r.status === 'ended') { const a = await getArchive(env, r.archiveId || r.id); if (a) stats = { participants: a.participants || 0, orders: a.orders || 0, spins: a.spins || 0 }; }
        else if (liveId && r.id === liveId) { const s = await loadStats(env); stats = { participants: s.participants || 0, orders: s.orders || 0, spins: s.spins || 0 }; }
        out.push({ id: r.id, title: r.title, theme: r.theme, status: r.status, start: r.start, end: r.end, stats });
      }
      return json({ ok: true, liveId: liveId || null, campaigns: out });
    }
    if (action === 'createCampaign') {
      const id = String(body.id || '').trim().toUpperCase();
      if (!/^MMD\d{6}$/.test(id)) return json({ ok: false, error: 'bad_id', hint: '活动码格式:MMD + 6位日期,如 MMD080826' });
      if (await getCampaignReg(env, id)) return json({ ok: false, error: 'exists', hint: '这个活动码已经有了,换一个' });
      const start = String(body.start || '').trim();
      const startMs = Date.parse(start + 'T00:00:00+08:00');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || isNaN(startMs)) return json({ ok: false, error: 'bad_start', hint: '开始日期格式:2026-08-01' });
      const end = klDate(startMs + 6 * 86400000);   // 固定 7 天(开始+6)——和游戏天数逻辑一致
      const theme = String(body.theme || 'wheel').trim() || 'wheel';
      const title = String(body.title || '').trim() || id;
      const freshCfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));   // 全新独立设置(不从任何活动复制)
      freshCfg.weights = { ...DEFAULT_WEIGHTS }; freshCfg.codes = {}; freshCfg.activityStart = start;
      freshCfg.msgOrder = ''; freshCfg.msgRecover = ''; freshCfg.serverDraws = true; freshCfg.status = 'running';
      const rec = { id, title, theme, status: 'planning', start, end, config: freshCfg, archiveId: id, historyKey: id, createdAt: Date.now(), updatedAt: Date.now() };
      await putCampaignReg(env, rec);
      return json({ ok: true, campaign: { id, title, theme, status: 'planning', start, end } });
    }
    if (action === 'getCampaignArchive') {   // 已结束活动 → 只读存档详情
      const reg = await getCampaignReg(env, String(body.id || ''));
      if (!reg) return json({ ok: false, error: 'notfound' });
      const a = await getArchive(env, reg.archiveId || reg.id);
      return json({ ok: true, campaign: { id: reg.id, title: reg.title, theme: reg.theme, start: reg.start, end: reg.end, status: reg.status }, archive: a || null });
    }
    if (action === 'deleteCampaign') {   // 只能删草稿(未启动)—— 绝不碰已结束的存档/顾客
      const id = String(body.id || '').trim().toUpperCase();
      const reg = await getCampaignReg(env, id);
      if (!reg) return json({ ok: false, error: 'notfound' });
      if (reg.status === 'ended' || reg.status === 'running') return json({ ok: false, error: 'not_draft', hint: '只能删除还没启动的草稿活动。' });
      if ((await kvGet(env, 'live_campaign')) === id) return json({ ok: false, error: 'is_live' });
      await env.DB.prepare('DELETE FROM campaigns WHERE id=?').bind(id).run();
      return json({ ok: true, deleted: id });
    }

    /* ===== 阶段B:一个活动的完整后台(内容+数据) + 编辑 + 启动/结束 ===== */
    if (action === 'getCampaignFull') {   // 某活动的全部:登记信息 + 设置 + 数据
      const id = String(body.id || '').trim().toUpperCase();
      const reg = await getCampaignReg(env, id);
      if (!reg) return json({ ok: false, error: 'notfound' });
      const liveId = await kvGet(env, 'live_campaign');
      const isLive = reg.id === liveId || reg.status === 'running';
      let config, data = null, editable = false;
      if (reg.status === 'ended') { config = reg.config || {}; const a = await getArchive(env, reg.archiveId || reg.id); if (a) data = { participants: a.participants, spins: a.spins, orders: a.orders, prizeCounts: a.prizeCounts, winners: a.winners }; }
      else if (isLive) { config = await loadConfig(env); const s = await loadStats(env); data = { participants: s.participants, spins: s.spins, orders: s.orders, prizeCounts: s.prizeCounts, winners: s.winners }; editable = true; }
      else { config = reg.config || {}; editable = true; }   // 草稿
      return json({ ok: true, campaign: { id: reg.id, title: reg.title, theme: reg.theme, status: reg.status, start: reg.start, end: reg.end, isLive }, config: { weights: config.weights || {}, codes: config.codes || {}, msgOrder: config.msgOrder || '', msgRecover: config.msgRecover || '' }, data, editable });
    }
    if (action === 'setCampaignConfig') {   // 编辑草稿或正在进行的活动设置(正在进行 → 写实时镜像)
      const id = String(body.id || '').trim().toUpperCase();
      const reg = await getCampaignReg(env, id);
      if (!reg) return json({ ok: false, error: 'notfound' });
      if (reg.status === 'ended') return json({ ok: false, error: 'ended_readonly', hint: '已结束的活动不能改设置。' });
      const isLive = reg.id === (await kvGet(env, 'live_campaign'));
      const base = isLive ? await loadConfig(env) : Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), reg.config || {});
      const p = body.patch || {};
      if (p.weights && typeof p.weights === 'object') base.weights = clampWeights(p.weights, base.weights);
      if (p.codes && typeof p.codes === 'object') base.codes = p.codes;
      if (typeof p.msgOrder === 'string') base.msgOrder = p.msgOrder;
      if (typeof p.msgRecover === 'string') base.msgRecover = p.msgRecover;
      if (typeof body.title === 'string' && body.title.trim()) reg.title = body.title.trim();
      if (typeof body.theme === 'string' && body.theme) reg.theme = body.theme;
      if (isLive) await saveConfig(env, base);              // 顾客即时生效
      reg.config = base; reg.updatedAt = Date.now();
      await putCampaignReg(env, reg);
      return json({ ok: true });
    }
    if (action === 'launchCampaign') {   // 草稿 → 进行中:先结束当前进行中的(归档),再用这个活动的设置整体覆盖镜像
      const id = String(body.id || '').trim().toUpperCase();
      const reg = await getCampaignReg(env, id);
      if (!reg) return json({ ok: false, error: 'notfound' });
      if (reg.status === 'ended') return json({ ok: false, error: 'ended', hint: '已结束的活动不能再启动。' });
      if (reg.theme && reg.theme !== 'wheel') return json({ ok: false, error: 'theme_not_ready', hint: '这个游戏(' + reg.theme + ')还没做好 —— 做好游戏才能启动(刮刮乐是第3步)。' });
      const liveId = await kvGet(env, 'live_campaign');
      if (liveId === id) return json({ ok: false, error: 'already_live', hint: '这个活动已经在进行中了。' });
      if (liveId) {                                          // 先结束当前进行中的
        const cur = await getCampaignReg(env, liveId);
        const archKey = (cur && (cur.archiveId || cur.id)) || liveId;
        if (!(await getArchive(env, archKey))) {
          const st = await loadStats(env); const memRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first(); const memCount = (memRow && memRow.n) || 0;
          if (memCount > 0 || (st.participants || 0) > 0) { const cc = cur ? { id: archKey, title: cur.title, theme: cur.theme, start: cur.start, end: cur.end } : { id: archKey, title: liveId, theme: 'wheel' }; await archiveCampaign(env, cc); await rollupCustomers(env, cc); }
        }
        await resetWorkingTables(env);
        if (cur) { cur.status = 'ended'; cur.updatedAt = Date.now(); await putCampaignReg(env, cur); }
      }
      const cfg = Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), reg.config || {});   // 整体覆盖(不是补丁)
      cfg.status = 'running'; cfg.activityStart = reg.start; cfg.serverDraws = true;
      await saveConfig(env, cfg);
      await setCampaign(env, { id: reg.id, title: reg.title, theme: reg.theme, start: reg.start, end: reg.end });
      await kvSet(env, 'live_campaign', reg.id);
      reg.status = 'running'; reg.config = cfg; reg.updatedAt = Date.now(); await putCampaignReg(env, reg);
      return json({ ok: true, launched: reg.id });
    }
    if (action === 'endCampaign') {   // 结束并归档(进行中 → 已结束);空活动不报错
      const id = String(body.id || '').trim().toUpperCase();
      const reg = await getCampaignReg(env, id);
      if (!reg) return json({ ok: false, error: 'notfound' });
      const liveId = await kvGet(env, 'live_campaign');
      if (reg.id !== liveId && reg.status !== 'running') return json({ ok: false, error: 'not_running', hint: '这个活动不是进行中,不能结束。' });
      const archKey = reg.archiveId || reg.id;
      if (!(await getArchive(env, archKey))) {
        const st = await loadStats(env); const memRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first(); const memCount = (memRow && memRow.n) || 0;
        if (memCount > 0 || (st.participants || 0) > 0) { const cc = { id: archKey, title: reg.title, theme: reg.theme, start: reg.start, end: reg.end }; await archiveCampaign(env, cc); await rollupCustomers(env, cc); }
      }
      await resetWorkingTables(env);
      reg.status = 'ended'; reg.updatedAt = Date.now(); await putCampaignReg(env, reg);
      await kvSet(env, 'live_campaign', null);
      const cfg = await loadConfig(env); cfg.status = 'closed'; await saveConfig(env, cfg);
      return json({ ok: true, ended: id });
    }

    /* ===== 阶段1:主题期(campaign)+ 永久档案 + 存档 ===== */
    if (action === 'getCampaign') return json({ ok: true, campaign: await getCampaign(env) });
    if (action === 'listArchives') return json({ ok: true, archives: await listArchives(env) });
    if (action === 'getArchive') return json({ ok: true, archive: await getArchive(env, body.id) });
    if (action === 'customerFull') return json({ ok: true, ...(await customerFull(env, body.phone) || { phone: null, customer: null, current: null }) });
    if (action === 'setCampaign') {
      try { return json({ ok: true, campaign: await setCampaign(env, body.campaign || {}) }); }
      catch (e) { return json({ ok: false, error: 'bad_campaign' }); }
    }
    if (action === 'closeAndArchive') {   // 结束本期:先存档 + 滚进永久档案,成功后才清空,再开新一期
      const camp = await getCampaign(env);
      const nextId = (body.next && String(body.next.id || '').trim()) || '';
      const nextStart = (body.next && String(body.next.start || '').trim()) || '';
      if (nextId && nextId === camp.id) return json({ ok: false, error: 'same_id', hint: '新期号不能和刚结束的一样' });
      if (nextId && !/^\d{4}-\d{2}-\d{2}$/.test(nextStart))            // 开新一期必须有合法开始日,否则新一期发不出抽奖次数
        return json({ ok: false, error: 'bad_start', hint: '开新一期要填开始日期,格式 2026-08-01' });
      const existing = await getArchive(env, camp.id);
      const stats = await loadStats(env);
      const memRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first();
      const memCount = (memRow && memRow.n) || 0;
      if (!existing && memCount === 0 && (stats.participants || 0) === 0)
        return json({ ok: false, error: 'empty', hint: '本期(' + camp.id + ')还没有任何数据,不需要归档。' });
      const summary = existing || await archiveCampaign(env, camp);   // 1) 存档(已存过则保留,不用零覆盖)
      const rolled = await rollupCustomers(env, camp);                // 2) 滚进永久顾客档案(幂等)
      await resetWorkingTables(env);                                  // 3) 前两步成功才清空
      const cfg = await loadConfig(env);                             // 4) 设新一期 or 收档
      if (nextId) { await setCampaign(env, body.next); cfg.status = 'running'; cfg.activityStart = nextStart; }  // 天数从新一期开始日重算 → 新一期正常发次数
      else { cfg.status = 'closed'; }
      await saveConfig(env, cfg);
      return json({ ok: true, archived: camp.id, rolled, participants: summary.participants, orders: summary.orders, next: nextId || null });
    }

    const cfg = await loadConfig(env); let mutated = false;
    if (action === 'get') {
      return json({ ok: true, status: cfg.status, weights: cfg.weights, codes: cfg.codes, rev: cfg.rev, activityStart: cfg.activityStart, dayDraws: cfg.dayDraws, msgOrder: cfg.msgOrder, msgRecover: cfg.msgRecover });
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
    } else if (action === 'setMsg') {
      const t = String(body.text || '');
      if (body.which === 'recover') cfg.msgRecover = t; else if (body.which === 'order') cfg.msgOrder = t; else return json({ ok: false, error: 'bad which' });
      mutated = true;
    } else {
      return json({ ok: false, error: 'unknown action' });
    }
    if (mutated) await saveConfig(env, cfg);
    return json({ ok: true, status: cfg.status, weights: cfg.weights, codes: cfg.codes, rev: cfg.rev });
  } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
}
