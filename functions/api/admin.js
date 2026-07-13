// POST /api/admin — 管理员写/读(cookie 或 body.secret 授权)
import { loadConfig, saveConfig, adminOK, adminCookieOK, clampWeights, isStatus, loadStats, getRedemption, saveRedemption, listLeads, normPhone, json,
  getCampaign, setCampaign, archiveCampaign, rollupCustomers, resetWorkingTables, getArchive, listArchives, customerFull } from './_lib.js';

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
