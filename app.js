/* ============================================================
   MFormula · Member Day — 大转盘抽奖 (原型 demo)
   抽大转盘赢免费好礼 → 选配套 → 一键 WhatsApp 找客服下单。
   纯前端 + localStorage 模拟。真实上线需 Backend(防作弊/记账/兑换核销),见 README。
   ============================================================ */

const CONFIG = {
  WHATSAPP: '60178101749',   // 客服 WhatsApp(国际格式 60+号码,去掉开头0)= 0178101749
  DAY_DRAWS: [5,1,1,1,1,1,3],// 每天的抽奖次数:第1天5次 · 第2–6天各1次 · 第7天3次
  ORDER_BONUS: 3,           // 下单 → +抽奖次数
  SPIN_MS: 4000,            // 转盘旋转时长
  REDEEM_MS: 24*60*60*1000, // 抽中好礼的兑换有效期:24 小时,过期失效
};
const ADMIN_NAME = 'mformulammd';   // 管理员用户名(非密钥);口令由服务器校验,不进前端代码

/* ---------------- 活动倒数(以大马时间 UTC+8 为准,和服务器算天数一致) ---------------- */
const EVENT_DAYS = 7;                                          // 活动天数(1/7–7/7 = 7 天)
const klMidnight = ds => Date.parse(ds + 'T00:00:00+08:00');  // 某日期「大马时间 00:00」的绝对时刻
let ACT_START = klMidnight('2026-07-01');                      // 第 1 天 00:00(默认;登入后服务器 activityStart 会覆盖)
let ACT_END   = ACT_START + EVENT_DAYS*86400000;              // 第 7 天结束 = 第 8 天 00:00 大马时间(服务器此刻关抽奖)
const drawsForDay = d => CONFIG.DAY_DRAWS[Math.min(Math.max(d|0,1),7)-1] || 1;
// 大马手机号校验(对齐服务器 normPhone:去 60/0 前缀后须 1xxxxxxxx)
function myPhone(p){ let d=String(p||'').replace(/\D/g,''); if(d.startsWith('60')) d=d.slice(2); if(d.startsWith('0')) d=d.slice(1); return /^1[0-9]{8,9}$/.test(d) ? d : null; }

// 配套(固定价) slots = 这单能带几件好礼
const PACKAGES = [
  { key:'2box', name:'2 Boxes 配套', price:358, boxes:2, slots:2 },
  { key:'4box', name:'4 Boxes 配套', price:716, boxes:4, slots:3 },
];

// 大转盘奖品。a=2 Boxes(配套A,基础); b=4 Boxes(配套B,自动翻倍)
const WHEEL = [
  { key:'v5',  type:'disc', sa:'RM5',  sb:'RM10', emoji:'🎟️', img:'gift-voucher.png', color:'#147d6e', a:{label:'RM5 折扣券',value:5},   b:{label:'RM10 折扣券',value:10} },
  { key:'v10', type:'disc', sa:'RM10', sb:'RM20', emoji:'🎟️', img:'gift-voucher.png', color:'#0E3947', a:{label:'RM10 折扣券',value:10}, b:{label:'RM20 折扣券',value:20} },
  { key:'v30', type:'disc', sa:'RM30', sb:'RM60', emoji:'🎟️', img:'gift-voucher.png', color:'#147d6e', a:{label:'RM30 折扣券',value:30}, b:{label:'RM60 折扣券',value:60} },
  { key:'v50', type:'disc', sa:'RM50', sb:'RM100',emoji:'🎟️', img:'gift-voucher.png', color:'#0E3947', a:{label:'RM50 折扣券',value:50}, b:{label:'RM100 折扣券',value:100} },
  { key:'g5',  type:'gift', sa:'5包',  sb:'10包', emoji:'🧪', img:'gift-sachet.png',  color:'#147d6e', a:{label:'5 包试饮装',img:'gift-sachet.png'},  b:{label:'10 包试饮装',img:'gift-sachet.png'} },
  { key:'g10', type:'gift', sa:'10包', sb:'20包', emoji:'🧪', img:'gift-sachet.png',  color:'#0E3947', a:{label:'10 包试饮装',img:'gift-sachet.png'}, b:{label:'20 包试饮装',img:'gift-sachet.png'} },
  { key:'g15', type:'gift', sa:'15包', sb:'1盒',  emoji:'🧪', img:'gift-sachet.png',  color:'#147d6e', a:{label:'15 包试饮装',img:'gift-sachet.png'}, b:{label:'1 盒 MFormula',img:'gift-box.png'} },
  { key:'tumbler', type:'gift', sa:'水杯', sb:'水杯', emoji:'🥤', img:'gift-tumbler.png', color:'#0E3947', a:{label:'FIFA Tumbler',img:'gift-tumbler.png'}, b:{label:'FIFA Tumbler',img:'gift-tumbler.png'} },
  { key:'duffle',  type:'gift', sa:'背包', sb:'背包', emoji:'👜', img:'gift-duffle.png',  color:'#147d6e', a:{label:'FIFA Duffle Bag',img:'gift-duffle.png'}, b:{label:'FIFA Duffle Bag',img:'gift-duffle.png'} },
  { key:'free', type:'ultra', sa:'免单', sb:'免单',  emoji:'🎫', img:'gift-free.png', color:'#6b3fa0', a:{label:'免单 整单免费'}, b:{label:'免单 整单免费'} },
  { key:'gold', type:'ultra', sa:'999金',sb:'999金', emoji:'🪙', img:'gift-gold.png', color:'#b8860b', a:{label:'999 黄金大奖'}, b:{label:'999 黄金大奖'} },
];
const SEG = 360 / WHEEL.length;
const byKey = k => WHEEL.find(p=>p.key===k);
const isUltra = k => { const p=byKey(k); return p && p.type==='ultra'; };
const isDisc  = k => { const p=byKey(k); return p && p.type==='disc'; };
const prizeLimit = () => curPkg().slots;
const pv = p => (S.pickPkg==='4box' ? p.b : p.a);          // 按配套取 A/B
const wonLabel = k => { const p=byKey(k); return p ? pv(p).label : ''; };
const wonImg = k => { const p=byKey(k); if(!p) return ''; return pv(p).img || p.img; };
const wonVal = k => { const p=byKey(k); return (p && pv(p).value) || 0; };
const wheelShort = p => (S.pickPkg==='4box' ? p.sb : p.sa);

// 中奖权重(管理员后台可改);真实概率 = 权重 / 总和。0 = 永不中
const DEFAULT_WEIGHTS = { v5:22, v10:14, v30:5, v50:1, g5:18, g10:12, g15:5, tumbler:10, duffle:6, free:0.5, gold:0 };
function loadWeights(){ try{ const w=JSON.parse(localStorage.getItem('mf_weights')); if(w&&typeof w==='object'){ const m={...DEFAULT_WEIGHTS}; WHEEL.forEach(p=>{ if(typeof w[p.key]==='number'&&w[p.key]>=0) m[p.key]=w[p.key]; }); return m; } }catch(e){} return {...DEFAULT_WEIGHTS}; }
function saveWeights(){ localStorage.setItem('mf_weights', JSON.stringify(weights)); }
let weights = loadWeights();

// 限量库存(demo:内存,刷新重置;真实由后端维护)
let stock = { tumbler:30, duffle:12, free:3, gold:1 };
const DRIFT = ['tumbler','duffle','free'];
let spCount = 86;

/* ---------------- 活动状态(超级权限控制) ---------------- */
const ACT_STATES = {
  running:  { label:'活动正在进行', emoji:'🟢', tone:'ok' },
  paused:   { label:'活动暂停中',   emoji:'⏸️', tone:'warn', msg:'活动暂停中,请稍后再回来 🙏' },
  updating: { label:'活动更新中',   emoji:'🔧', tone:'warn', msg:'活动更新中,马上回来 🛠️' },
  ended:    { label:'活动已结束',   emoji:'🏁', tone:'end',  msg:'本次 Member Day 已结束,感谢参与 🎉' },
  closed:   { label:'活动未开放',   emoji:'🔒', tone:'off',  msg:'活动尚未开放,敬请期待 ⏰' },
};
function loadStatus(){ const s=localStorage.getItem('mf_status'); return ACT_STATES[s]?s:'running'; }
function saveStatus(){ localStorage.setItem('mf_status', actStatus); }
let actStatus = loadStatus();
const isRunning = () => actStatus==='running';

/* ---------------- 后端 API(连不上自动退回本机 localStorage) ---------------- */
const URL_API = new URLSearchParams(location.search).get('api')==='1';   // 灰度开关:网址加 ?api=1
const MF = { api:false, p2:URL_API, rev:0 };   // ?api=1 一打开就进服务器模式(避免登入早于 bootstrap 的竞速)
async function apiGET(path){ const r=await fetch(path,{cache:'no-store'}); if(!r.ok) throw new Error('http '+r.status); return r.json(); }
async function apiPOST(path,body){ try{ const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return await r.json(); }catch(e){ return {ok:false,error:'net'}; } }
async function adminWrite(payload){    // 管理员写 → 服务器(httpOnly cookie 携带授权)
  if(!MF.api) return null;
  const r=await apiPOST('/api/admin', payload);
  if(r&&r.ok){ MF.rev=r.rev||MF.rev; return r; }
  return null;
}
// 服务器版登入:用 name+phone 换会员状态(次数/已中奖/天数)
async function serverSession(){
  const r = await apiPOST('/api/session', {name:S.name, phone:S.phone, pkg:S.pickPkg});
  if(r && r.ok){
    S.chances = r.chances; S.won = Array.isArray(r.won)?r.won:[]; S.wonAt = r.wonAt||{}; S.day = r.day||S.day;
    if(r.status) actStatus = r.status; if(r.weights) weights = {...weights, ...r.weights};
    S.bundle = S.bundle.filter(k=>S.won.includes(k));
    save();
  }
  return r;
}
async function bootstrapServer(){      // 启动时拉取服务器共用配置;失败则用本机
  try{
    const c=await apiGET('/api/config');
    if(c&&c.ok){
      MF.api=true; MF.rev=c.rev||0;
      if(c.weights) weights={...weights,...c.weights};
      if(c.status) actStatus=c.status;
      if(typeof c.participants==='number') spCount = c.participants;   // 真实参与人数(社会证明)
      if(c.activityStart){ const st=klMidnight(c.activityStart); if(!isNaN(st)){ ACT_START=st; ACT_END=st+EVENT_DAYS*86400000; updateCountdown(); } }   // 以服务器开始日为准
      if(S.admin && S.phone) await apiPOST('/api/admin-login', {pass:S.phone.replace(/\D/g,'')});  // 刷新后续期管理员 cookie
      MF.p2 = !!(URL_API || c.serverDraws);            // 灰度:?api=1(测试)或服务器全开
      if(MF.p2){
        const nd=$('nextDayBtn'); if(nd) nd.style.display='none';   // 服务器算天数,隐藏 demo「下一天」
        if(S.loggedIn && !S.admin) await serverSession();           // 刷新后重新水合状态
      }
      const home=$('screen-home'), adm=$('screen-admin'), cmp=$('screen-campaigns'), cd=$('screen-campdetail');
      if(home&&home.classList.contains('active')) renderHome();
      if(adm&&adm.classList.contains('active')) renderAdmin();
      if(cmp&&cmp.classList.contains('active')) renderCampaigns();   // 刷新后 bootstrap 完成再拉活动列表(否则 MF.api 未就绪→连不上)
      if(cd&&cd.classList.contains('active')) renderCampDetail();
    }
  }catch(e){ MF.api=false; }
}

/* ---------------- 兑换码(送额外抽奖次数) ---------------- */
const DEFAULT_PROMO = {};   // 不再内置永久码;后台自行增删(服务器为准)
function loadPromo(){ try{ const p=JSON.parse(localStorage.getItem('mf_promo')); if(p&&typeof p==='object') return {...DEFAULT_PROMO, ...p}; }catch(e){} return {...DEFAULT_PROMO}; }
function savePromo(){ localStorage.setItem('mf_promo', JSON.stringify(promoCodes)); }
let promoCodes = loadPromo();
let serverCodes = null, codesLoaded = false;   // 兑换码以服务器为准(后台显示真实列表)
const ADMIN_LB = [
  {name:'Ah Kao***',n:9},{name:'Mei***',n:8},{name:'Kumar***',n:8},{name:'Siti***',n:7},
  {name:'Wei***',n:6},{name:'Jun***',n:6},{name:'Lim***',n:5},{name:'Raj***',n:4},
];

/* ---------------- 状态 ---------------- */
let S = load();
function load(){
  const def = { name:'', phone:'', loggedIn:false, admin:false, day:1, chances:drawsForDay(1),
                won:[], wonAt:{}, bundle:[], pickPkg:'2box', codes:{}, usedCodes:[] };
  let s={};
  try{ s = JSON.parse(localStorage.getItem('mfmemberday')) || {}; }catch(e){}
  const m = { ...def, ...s };
  if(!Array.isArray(m.won)) m.won=[];
  if(!Array.isArray(m.bundle)) m.bundle=[];
  if(!Array.isArray(m.usedCodes)) m.usedCodes=[];
  m.won = m.won.filter(byKey);
  if(typeof m.wonAt!=='object'||!m.wonAt) m.wonAt={};
  const _now=Date.now();
  m.won.forEach(k=>{ if(typeof m.wonAt[k]!=='number') m.wonAt[k]=_now; });   // 旧存档补上中奖时间戳
  Object.keys(m.wonAt).forEach(k=>{ if(!m.won.includes(k)) delete m.wonAt[k]; });
  m.bundle = m.bundle.filter(k=>m.won.includes(k));
  if(typeof m.codes!=='object'||!m.codes) m.codes={};
  m.chances = Number.isFinite(m.chances) ? Math.max(0, Math.floor(m.chances)) : drawsForDay(m.day);
  m.day = Number.isInteger(m.day) ? Math.min(7, Math.max(1, m.day)) : 1;
  if(!PACKAGES.some(p=>p.key===m.pickPkg)) m.pickPkg='2box';
  return m;
}
function save(){ localStorage.setItem('mfmemberday', JSON.stringify(S)); }

const $ = id => document.getElementById(id);
const curPkg = () => PACKAGES.find(p=>p.key===S.pickPkg) || PACKAGES[0];

/* ---------------- 路由 ---------------- */
function go(name){
  $('phone').classList.toggle('bare', name==='login'||name==='campaigns'||name==='admin'||name==='campdetail');   // 管理员画面不显示顾客顶栏
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('screen-'+name).classList.add('active');
  $('main').scrollTop=0;
  if(name==='home') renderHome();
  if(name==='help') renderHelp();
  if(name==='admin') renderAdmin();
  if(name==='campaigns') renderCampaigns();
  if(name==='campdetail') renderCampDetail();
}
document.addEventListener('click', e=>{
  const g=e.target.closest('[data-go]'); if(g){ go(g.dataset.go); return; }
  const w=e.target.closest('[data-won]'); if(w){ toggleBundle(w.dataset.won); return; }
  const pk=e.target.closest('[data-pkg]'); if(pk){ S.pickPkg=pk.dataset.pkg; trimBundle(); save(); renderHome(); return; }
});

// #drawsLeft 在暂停/结束时不存在(按钮变成状态文字),所有更新都走这里防空指针
function setDrawsLeft(){ const el=$('drawsLeft'); if(el) el.textContent=S.chances; }

/* ---------------- 顶部 ---------------- */
function renderTop(){
  $('chancesVal').textContent = S.chances;
  updateCountdown();                                          // 顶部活动倒数(天+时:分:秒,每秒自走)
  const sp=$('spCount'); if(sp) sp.textContent = spCount;
}

/* ---------------- 活动倒数:登入画面 + 顶部条,每秒滴答 ---------------- */
function fmtCountdown(ms){
  if(ms<0) ms=0;
  const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60), x=s%60;
  const hms=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`;
  return d>0 ? `${d} 天 ${hms}` : hms;
}
function updateCountdown(){
  const now=Date.now(), started=now>=ACT_START, ended=now>=ACT_END;
  const txt = started ? fmtCountdown(ACT_END-now) : fmtCountdown(ACT_START-now);
  const urgent = started && !ended && (ACT_END-now)<=86400000;   // 最后 24 小时:红色高亮催单
  const lbl=$('cdLbl'), num=$('endCountdown');                   // 顶部条(登入后)
  if(lbl) lbl.textContent = ended ? '' : (started ? '⏳ 距结束' : '⏰ 距开始');
  if(num) num.textContent = ended ? '🏁 活动已结束' : txt;
  const lgL=$('loginCdLabel'), lgT=$('loginCdTime');            // 登入画面
  if(lgL) lgL.textContent = ended ? '本次会员日已结束 · 感谢参与 🎉' : (started ? '⏳ 会员日倒数 · 距活动结束' : '⏰ 会员日即将开始');
  if(lgT) lgT.textContent = ended ? '活动已结束' : txt;
  const bar=$('countdownBar'); if(bar) bar.classList.toggle('cd-urgent', urgent);
  const lc=$('loginCountdown'); if(lc){ lc.classList.toggle('lcd-urgent', urgent); lc.classList.toggle('lcd-ended', ended); }
}

/* ---------------- 大厅 ---------------- */
function renderHome(){
  renderTop();
  $('adminEntry').style.display = S.admin ? 'flex' : 'none';
  buildWheel();   // 注:#drawsLeft 由 applyActivityState() 统一更新(暂停时按钮无此元素)
  renderWon();
  // 配套
  $('pkgPick').innerHTML = PACKAGES.map(p=>{
    const sel=S.pickPkg===p.key;
    return `<div class="pkg ${sel?'sel':''}" data-pkg="${p.key}">
      ${p.boxes>2?'<div class="pkg-badge">超值</div>':''}
      <div class="pkg-box"><img src="assets/gift-box.png" alt="" onerror="this.replaceWith(document.createTextNode('📦'))"><span class="pkg-qty">×${p.boxes}</span></div>
      <div class="pkg-name">${p.name}</div>
      <div class="pkg-price">RM${p.price}</div>
      <div class="pkg-slots">可带 ${p.slots} 件好礼</div>
      <div class="pkg-tick">${sel?'✓ 已选配套':'选择此配套'}</div>
    </div>`;}).join('');
  renderBundle();
  applyActivityState();
  renderReturnHint();
}
// 返回「不能抽奖」的原因(未开始/已结束/暂停…),可抽则 null
function homeBlock(){
  if(MF.p2 && S.day < 1) return {tone:'off', emoji:'🗓️', label:'活动还没开始', msg:'Member Day 7 月 1 日开始,敬请期待!到时来转大转盘 🎡'};
  if(MF.p2 && S.day > 7) return {tone:'end', emoji:'🏁', label:'活动已结束', msg:'本次 Member Day 已结束,感谢参与 🎉'};
  if(!isRunning()){ const st=ACT_STATES[actStatus]||ACT_STATES.running; return {tone:st.tone, emoji:st.emoji, label:st.label, msg:st.msg||''}; }
  return null;
}
function applyActivityState(){
  const hb = homeBlock();
  const banner = $('actBanner'), btn = $('spinBtn');
  if(banner){
    if(!hb){ banner.style.display='none'; }
    else{ banner.style.display='flex'; banner.className=`act-banner ${hb.tone}`;
      banner.innerHTML = `<span class="ab-emoji">${hb.emoji}</span><span class="ab-txt"><b>${hb.label}</b><small>${hb.msg||''}</small></span>`; }
  }
  if(btn){
    btn.disabled = !!hb;
    btn.innerHTML = hb ? `${hb.emoji} ${hb.label}` : `🎡 抽奖!（还有 <b id="drawsLeft">${S.chances}</b> 次）`;
  }
}
function statusModal(){ const hb=homeBlock(); if(hb) modal(hb.emoji, hb.label, hb.msg||'请稍后再来 🙏', [{label:'知道了'}]); }
function setSpinUI(on){ const b=$('spinBtn'); if(!b) return; if(on){ b.disabled=true; b.innerHTML='🎡 抽奖中…'; } else applyActivityState(); }
function renderReturnHint(){          // 大厅常驻:今天抽完别走,明天还有免费次数(兑现 7 天回访)
  const el=$('returnHint'); if(!el) return;
  const show = !S.admin && !homeBlock() && S.day>=1 && S.day<7;
  if(!show){ el.style.display='none'; return; }
  el.style.display='block';
  el.innerHTML = (S.day===6)
    ? `🎉 明天就是最后一天!<span class="rh-big">第 7 天大放送,有 <b>3</b> 次免费抽 — 记得回来!</span>`
    : `📅 今天抽完别走宝!<span class="rh-big">明天登入还有 <b>${drawsForDay(S.day+1)}</b> 次免费抽 🎡</span>`;
}

/* ---------------- 转盘 ---------------- */
let wheelRot = 0, spinning = false;
function segChip(p){   // 转盘每格的内容:折扣券=金币券; 其它=真实产品图
  if(p.type==='disc') return { chip:`<i class="wchip wcoupon">${wheelShort(p)}</i>`, label:'折扣券' };
  const im = (S.pickPkg==='4box' ? (p.b.img||p.img) : (p.a.img||p.img));
  return { chip:`<i class="wchip"><img src="assets/${im}" alt="" onerror="this.parentNode.textContent='${p.emoji}'"></i>`, label:wheelShort(p) };
}
function buildWheel(){
  const stops = WHEEL.map((p,i)=>`${p.color} ${i*SEG}deg ${(i+1)*SEG}deg`).join(',');
  const wheel = $('wheel');
  wheel.style.background = `conic-gradient(${stops})`;
  wheel.innerHTML = WHEEL.map((p,i)=>{ const sc=segChip(p);
    return `<div class="wseg ${p.type==='ultra'?'wseg-ultra':''}" style="transform:rotate(${i*SEG + SEG/2}deg)"><span>${sc.chip}<b>${sc.label}</b></span></div>`;
  }).join('');
}
function weightedPick(){
  const pool = WHEEL.filter(p => (stock[p.key]===undefined || stock[p.key]>0) && (weights[p.key]||0)>0);
  if(!pool.length) return WHEEL.findIndex(p=>p.key==='v5');
  const total = pool.reduce((s,p)=>s+(weights[p.key]||0),0);
  let r = Math.random()*total;
  for(const p of pool){ r-=(weights[p.key]||0); if(r<=0) return WHEEL.indexOf(p); }
  return WHEEL.indexOf(pool[pool.length-1]);
}
function animateTo(idx, done){      // 把第 idx 格转到顶部指针,转完回调
  const landing = (360 - (idx*SEG + SEG/2));
  const cur = ((wheelRot % 360) + 360) % 360;
  wheelRot += 360*5 + ((landing - cur + 360) % 360);   // 至少 5 圈再停
  const wheel=$('wheel');
  wheel.style.transition=`transform ${CONFIG.SPIN_MS}ms cubic-bezier(.16,.84,.28,1)`;
  wheel.style.transform=`rotate(${wheelRot}deg)`;
  setTimeout(done, CONFIG.SPIN_MS+80);
}
function spin(){
  if(spinning) return;
  if(homeBlock()){ statusModal(); return; }
  if(MF.p2){ spinServer(); return; }                   // 灰度:服务器版抽奖(防作弊)
  if(S.chances<=0){ noChanceModal(); return; }
  spinning=true; setSpinUI(true); S.chances--; save(); renderTop();
  const idx = weightedPick();
  animateTo(idx, ()=>{ spinning=false; award(idx); });
}
$('spinBtn') && $('spinBtn').addEventListener('click', spin);

// 服务器版:结果 + 次数都由服务器决定(清缓存刷不回、结果改不了)
async function spinServer(retried){
  if(S.chances<=0){ noChanceModal(); return; }
  spinning=true; setSpinUI(true); renderTop();
  let r; try{ r = await apiPOST('/api/spin', {}); }catch(e){ r=null; }
  if(!r || !r.ok){
    const why = r && r.reason;
    if(why==='nosession' && !retried && !S.admin){          // 会话掉了 → 自动重连再试一次
      const sr = await serverSession();
      if(sr && sr.ok){ spinning=false; return spinServer(true); }
    }
    spinning=false; setSpinUI(false);
    if(why==='nochance'){ S.chances=0; save(); renderTop(); setDrawsLeft(); noChanceModal(); }
    else if(why==='notrunning'){ if(r.status) actStatus=r.status; applyActivityState(); statusModal(); }
    else if(why==='window'){ toastModal('活动还没开始哦,7 月 1 日见 🗓️'); }
    else if(why==='soldout'){ toastModal('这些好礼刚好被抽完了,过阵子再来 🙂'); }
    else if(why==='nosession'){ toastModal(S.admin?'管理员账号不能玩抽奖哦,请用顾客身份(名字+大马手机号)登入 🙂':'登入掉了,请退出重新登入一下 🙂'); }
    else toastModal('网络有点慢,再试一次 🙂');
    return;
  }
  S.chances = r.chances;
  animateTo(r.idx, ()=>{
    spinning=false;
    if(!S.won.includes(r.prize)) S.won.push(r.prize);
    S.wonAt[r.prize] = r.wonAt || Date.now();
    autoPick(r.prize); save(); renderHome();
    showWinModal(r.prize);
  });
}

function award(idx){               // Phase 1 本机版
  const p=WHEEL[idx];
  if(S.won.includes(p.key)){          // 已有 → 送一次重抽,不空手
    S.chances++; save(); renderTop(); setDrawsLeft();
    modal('🎁',`又抽中 ${pv(p).label}`,`你已经有这个啦,送你 <b>再抽一次</b> 🔄`,[{label:'再抽'}]); return;
  }
  S.won.push(p.key);
  S.wonAt[p.key] = Date.now();   // 开始 24 小时兑换倒计时
  if(stock[p.key]>0) stock[p.key]--;
  autoPick(p.key); save(); renderHome();
  showWinModal(p.key);
}
function showWinModal(key){
  const p=byKey(key); const im=wonImg(key);
  const img = im ? `<img src="assets/${im}" alt="" onerror="this.replaceWith(document.createTextNode('${p.emoji}'))">` : p.emoji;
  const scales = JSON.stringify(p.a)!==JSON.stringify(p.b);
  const canUpsell = scales && p.type!=='ultra' && S.pickPkg!=='4box';   // 还没选4盒 → 当场一键升级(峰值情绪转化)
  let extra, btns;
  if(canUpsell){
    const saveLine = p.type==='disc' ? `<div class="m-upsave">等于再省 RM${(p.b.value||0)-(p.a.value||0)}!</div>` : '';
    extra = `<div class="m-compare">
        <div class="mc-col"><span class="mc-h">2 盒配套</span><span class="mc-v">${p.a.label}</span></div>
        <div class="mc-arrow">→</div>
        <div class="mc-col mc-up"><span class="mc-h">4 盒配套 ⬆️</span><span class="mc-v">${p.b.label}</span></div>
      </div>${saveLine}`;
    btns = [
      {label:`✅ 我要 4 盒,这件升级`, action:()=>{ S.pickPkg='4box'; trimBundle(); save(); renderHome(); }},
      {label:'先 2 盒就好', sub:true, action:()=>{}}];
  } else {
    extra = p.type==='ultra' ? '<div class="m-pill d-legend">🏆 传说大奖 · 太幸运了!</div>' : '';
    btns = [
      {label: S.chances>0?'再抽一次 →':'去找客服领取', action:()=>{}},
      {label:'看我的好礼', sub:true, action:()=>{ const el=$('wonHead'); if(el) el.scrollIntoView({behavior:'smooth'}); }}];
  }
  modalRaw(
    `<div class="m-glow"></div>
     <div class="m-kicker" style="color:#4A9C8E">🎉 恭喜!你抽中</div>
     <div class="m-emoji">${img}</div>
     <div class="m-name">${pv(p).label}</div>
     ${extra}
     <div class="m-redeem">✅ 已帮你放进「我的好礼」· 请 <b>24 小时内</b>找客服领取</div>`,
    btns);
}

/* ---------------- 兑换倒计时(24小时) ---------------- */
const redeemLeft = k => (S.wonAt[k]||0) + CONFIG.REDEEM_MS - Date.now();
const isExpired  = k => !!S.wonAt[k] && redeemLeft(k) <= 0;
function fmtDur(ms){ if(ms<0) ms=0; const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return `${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`; }
function pruneExpired(){ const b=S.bundle.length; S.bundle=S.bundle.filter(k=>!isExpired(k)); if(S.bundle.length!==b) save(); }

/* ---------------- 我赢到的好礼 ---------------- */
function renderWon(){
  pruneExpired();
  const lim=prizeLimit();
  if(!S.won.length){
    $('wonHead').innerHTML = `<div class="won-title">🎁 我赢到的好礼</div>`;
    $('wonGrid').innerHTML = `<div class="won-empty">还没抽到 —— 转一下大转盘试试手气 🎡</div>`;
    return;
  }
  // 顶部:大白话引导 + 醒目的「最早失效」大倒数
  const active = S.won.filter(k=>!isExpired(k));
  const cdBar = active.length
    ? `<div class="won-cd"><span class="wc-l">⏳ 好礼还有</span><b class="wc-t" data-cdall="1">${fmtDur(Math.min.apply(null, active.map(k=>redeemLeft(k))))}</b><span class="wc-l">就失效,快找客服领取!</span></div>`
    : '';
  $('wonHead').innerHTML =
    `<div class="won-title">🎁 恭喜!你抽中了这些好礼 <span class="lh-pill">已带 ${S.bundle.length}/${lim} 件</span></div>
     <div class="won-guide">✅ 已帮你自动带上最值钱的,<b>直接选配套找客服就行</b>(想换才点别的)。</div>
     ${cdBar}`;
  $('wonGrid').innerHTML = S.won.map(k=>{
    const p=byKey(k); const exp=isExpired(k); const picked=S.bundle.includes(k); const im=wonImg(k);
    const img = im ? `<img src="assets/${im}" alt="" onerror="this.replaceWith(document.createTextNode('${p.emoji}'))">` : p.emoji;
    const cd = exp ? `<div class="rwc-cd expired">⌛ 已失效</div>`
                   : `<div class="rwc-cd" data-cd="${k}">⏳ ${fmtDur(redeemLeft(k))}</div>`;
    const stateTxt = exp ? '已过 24 小时' : (picked?'✓ 帮你带上了':'想换?点这件');
    return `<button class="rwc ${exp?'expired':(picked?'picked':'unlocked')} ${p.type==='ultra'?'wultra':''}" data-won="${k}" ${exp?'disabled':''}>
      ${p.type==='ultra'?'<div class="rwc-legend">★ 传说</div>':''}
      <div class="rwc-img">${img}</div>
      <div class="rwc-name">${pv(p).label}</div>
      ${cd}
      <div class="rwc-state">${stateTxt}</div>
    </button>`;
  }).join('');
}

/* ---------------- 搭配规则 ---------------- */
function toggleBundle(key){
  if(!S.won.includes(key)) return;
  if(isExpired(key)){ toastModal('这个好礼已过 24 小时兑换期,已失效 ⌛'); return; }
  if(isUltra(key)){ S.bundle = S.bundle.includes(key) ? [] : [key]; save(); renderHome(); return; }
  if(S.bundle.find(isUltra)) S.bundle = S.bundle.filter(k=>!isUltra(k));
  if(S.bundle.includes(key)){ S.bundle = S.bundle.filter(k=>k!==key); save(); renderHome(); return; }
  if(S.bundle.length >= prizeLimit()){ toastModal(`这个配套只能带 ${prizeLimit()} 件,先取消一件 🙂`); return; }
  S.bundle.push(key); save(); renderHome();
}
// 好礼价值排名(越大越值钱)→ 自动帮顾客带「最好的」
const PRIZE_RANK = { gold:1000, free:900, duffle:60, v50:50, tumbler:45, v30:30, g15:22, g10:14, v10:10, g5:8, v5:5 };
const bestSort = arr => arr.slice().sort((a,b)=>(PRIZE_RANK[b]||0)-(PRIZE_RANK[a]||0));
function fillBest(){       // 用未带上、未过期的最值钱好礼补满空位
  if(S.bundle.find(isUltra)) return;
  const cands = bestSort(S.won.filter(k=>!isExpired(k) && !isUltra(k) && !S.bundle.includes(k)));
  while(S.bundle.length < prizeLimit() && cands.length) S.bundle.push(cands.shift());
}
function autoPick(key){    // 抽中后自动带上「最值钱的几件」,顾客不用选
  if(isUltra(key)){ S.bundle=[key]; return; }     // 传说独占
  if(S.bundle.find(isUltra)) return;              // 已有传说,不动
  if(!S.bundle.includes(key)) S.bundle.push(key);
  S.bundle = bestSort(S.bundle).slice(0, prizeLimit());   // 只留最值钱的 N 件
}
function trimBundle(){     // 换配套后:留最值钱的,空位用最好的补满
  const u=S.bundle.find(isUltra);
  if(u){ S.bundle=[u]; return; }
  S.bundle = bestSort(S.bundle).slice(0, prizeLimit());
  fillBest();
}
function price(){
  const pkg=curPkg();
  if(S.bundle.includes('free')) return {free:true, disc:pkg.price, final:0};
  const disc = S.bundle.reduce((s,k)=> s + (isDisc(k)?wonVal(k):0), 0);   // 折扣按配套 A/B 取值
  return {free:false, disc, final:Math.max(0,pkg.price-disc)};
}

/* ---------------- 我的搭配(票券) ---------------- */
function renderBundle(){
  const pkg=curPkg(); const pr=price();
  const ultra=S.bundle.find(isUltra);
  const gifts=S.bundle.filter(k=>{const p=byKey(k);return p&&p.type==='gift';});
  const discs=S.bundle.filter(isDisc);
  let h=`<div class="bk-line"><span class="lbl">配套</span><span class="val">${pkg.name} · RM${pkg.price}</span></div>`;
  if(discs.length) h+=`<div class="bk-sec"><div class="cap">用的折扣</div>${discs.map(k=>{const p=byKey(k);return `<div class="bk-item disc">${p.emoji} ${pv(p).label}</div>`;}).join('')}</div>`;
  if(gifts.length) h+=`<div class="bk-sec"><div class="cap">带的好礼</div>${gifts.map(k=>{const p=byKey(k);return `<div class="bk-item gift">${p.emoji} ${pv(p).label}</div>`;}).join('')}</div>`;
  if(ultra){ const p=byKey(ultra); h+=`<div class="bk-grand"><span class="tag">传说</span><span class="nm">${p.emoji} ${pv(p).label}</span></div>`; }
  if(!discs.length && !gifts.length && !ultra) h+=`<div class="bk-sec"><div class="bk-empty">先抽大转盘赢好礼,再点一下带上 ↑(也可直接下单)</div></div>`;
  const saved = pr.free ? pkg.price : pr.disc;
  h+=`<div class="bk-pay"><div><div class="cap">应付价</div><div class="saved">${saved>0?'已省 RM'+saved:''}</div></div><div class="amt">${pr.free?'RM0':'RM'+pr.final}</div></div>`;
  $('bundleBody').innerHTML=h;
}

/* ---------------- 续命:下单/兑换码 ---------------- */
function noChanceModal(){
  const tomorrow = (S.day>=1 && S.day<7) ? drawsForDay(S.day+1) : 0;
  const btns=[];
  btns.push({label:`🎁 输入兑换码`, action:codeModal});
  btns.push({label:`🛒 去下单（+${CONFIG.ORDER_BONUS}次）`, action:()=>go('home')});
  btns.push({label: tomorrow>0?'好,明天再来':'关闭', sub:true});
  const lead = tomorrow>0 ? `明天登入还有 <b>${tomorrow}</b> 次免费抽,记得回来!<br>` : '';
  modal('🎡','今天的次数抽完啦', `${lead}想现在继续?输入兑换码、或下单 <b>+${CONFIG.ORDER_BONUS}</b> 次马上接着抽 🙂`, btns);
}
function grantOrderBonus(){ S.chances+=CONFIG.ORDER_BONUS; save(); renderTop(); }

/* ---------------- 兑换码 ---------------- */
function codeModal(){
  modalRaw(`<div class="m-emoji">🎁</div><div class="m-name">输入兑换码</div>
    <div class="m-text">有活动兑换码?输入立刻 +抽奖次数</div>
    <input id="codeInput" class="m-input" placeholder="例如 MEMBERDAY" autocapitalize="characters" autocomplete="off">`,
    [{label:'兑换', action:()=>redeemCode($('codeInput')&&$('codeInput').value)},{label:'关闭', sub:true}]);
}
async function redeemCode(raw){
  const code=(raw||'').trim().toUpperCase();
  if(!code){ toastModal('请输入兑换码'); return; }
  if(MF.p2){                                   // 服务器版:一码一用 + 服务器记次数
    const r = await apiPOST('/api/redeem-code', {code});
    if(r && r.ok){ S.chances=r.chances; save(); renderTop(); setDrawsLeft();
      modal('🎁', `+${r.draws} 次抽奖!`, `兑换码 <b>${code}</b> 已生效,继续转大转盘!`, [{label:'去抽奖', action:()=>go('home')}]); return; }
    if(r && r.reason==='used'){ toastModal('这个码你已经用过啦 🙂'); return; }
    if(r && r.reason==='invalid'){ toastModal('兑换码无效 🙈'); return; }
    if(r && r.reason==='nosession'){ toastModal('请退出重新登入一下 🙂'); return; }
    toastModal('网络有点慢,再试一次 🙂'); return;
  }
  if(S.usedCodes.includes(code)){ toastModal('这个码你已经用过啦 🙂'); return; }
  let draws=0;
  if(MF.api){                                  // 服务器校验(含管理员加的码)
    const r=await apiPOST('/api/redeem',{code});
    if(r&&r.ok){ draws=r.draws; }
    else if(code in promoCodes){ draws=promoCodes[code]; }   // 服务器没回应 → 退回本机内置码
    else { toastModal('兑换码无效 🙈'); return; }
  } else {
    if(!(code in promoCodes)){ toastModal('兑换码无效 🙈'); return; }
    draws=promoCodes[code];
  }
  if(!(draws>0)){ toastModal('兑换码无效 🙈'); return; }
  S.usedCodes.push(code); S.chances += draws; save(); renderTop();
  modal('🎁', `+${draws} 次抽奖!`, `兑换码 <b>${code}</b> 已生效,继续转大转盘!`, [{label:'去抽奖', action:()=>go('home')}]);
}

/* ---------------- 下单 / WhatsApp ---------------- */
let ordering=false;
$('waBtn') && $('waBtn').addEventListener('click', async ()=>{
  if(ordering) return; ordering=true; { const _wb=$('waBtn'); if(_wb) _wb.disabled=true; }   // 防长辈连点重复下单
  try{
  const hadN=S.bundle.length; pruneExpired();           // 下单前再核一次:踢掉刚过期的好礼
  if(S.bundle.length!==hadN){ renderHome(); toastModal('部分好礼已过 24 小时失效,已帮你移除,确认后再下单 🙂'); return; }
  const pkg=curPkg();
  let code, bundleKeys=S.bundle.slice(), discVal=0, isFree=false, bonusGranted=0;
  if(MF.p2){                                             // 服务器版:服务器发码 + 重算价格 + 算次数
    const r = await apiPOST('/api/order', {pkg:pkg.key, bundle:S.bundle});
    if(!r || !r.ok){ toastModal('下单失败,网络再试一次 🙂'); return; }
    code=r.code; bundleKeys=r.bundle||[]; discVal=r.disc||0; isFree=!!r.free; bonusGranted=r.orderBonus||0;
    S.bundle = S.bundle.filter(k=>bundleKeys.includes(k));            // 同步服务器过滤后的好礼
    if(r.chances!=null){ S.chances=r.chances; save(); renderTop(); setDrawsLeft(); }  // 下单加成即时到账
  } else {                                               // Phase 1 本机版
    const pr=price();
    code = genCode(pkg.key+'|'+S.bundle.slice().sort().join(','), pkg.key);
    discVal=pr.disc; isFree=pr.free; bonusGranted=CONFIG.ORDER_BONUS;
  }
  const finalPrice = isFree ? 0 : Math.max(0, pkg.price - discVal);
  const savedAmt = isFree ? pkg.price : discVal;
  const rewardsTxt = bundleKeys.length ? bundleKeys.map(k=>`   • ${wonLabel(k)}`).join('\n') : '   • 暂不带好礼(可跟客服现场加抽中的)';
  const upsellLine = (pkg.key==='2box' && bundleKeys.some(k=>{const q=byKey(k);return q && q.type!=='ultra' && JSON.stringify(q.a)!==JSON.stringify(q.b);})) ? '\n💡 升级 4 盒 → 好礼全部翻倍(可问客服)' : '';
  const payTxt = isFree ? 'RM0 — 免单 🎉' : `RM${finalPrice}${discVal?`（已减 RM${discVal}）`:''}`;
  const msg =
`你好 MFormula 客服 👋 我要参加 Member Day 下单！
━━━━━━━━━━
👤 会员：${S.name}（${S.phone}）
📦 配套：${pkg.name} — 原价 RM${pkg.price}
🎁 抽中带上（${bundleKeys.length}）：
${rewardsTxt}
💰 应付：${payTxt}${savedAmt>0?`\n🎉 这单帮我省了 RM${savedAmt}`:''}${upsellLine}
🧾 兑换码：${code}
━━━━━━━━━━
我知道客服会先核对配套和兑换码,确认后才发货 🙏
(兑换码一次性有效 · 活动 1/7–7/7)`;
  const url = `https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(msg)}`;
  modalRaw(
    `<div class="m-name" style="font-size:18px">确认下单</div>
     <div class="m-text" style="margin-top:5px">点下面 → 会自动打开 WhatsApp,里面已经帮你写好了,<b>直接按发送</b> ✅</div>
     <div class="m-code-box"><div class="cap">一次性兑换码</div><div class="m-code">${code}</div></div>
     <div class="m-text" style="text-align:left;margin-top:16px;font-weight:700;color:#5b6b73">消息预览(已写好)</div>
     <div class="wa-bubble">${msg.replace(/</g,'&lt;')}</div>
     <div class="m-text" style="margin-top:8px;font-size:12px">打不开?截图这段发给客服也行 🙂</div>`,
    [{label:'📲 打开 WhatsApp 发给客服', action:()=>{ window.open(url,'_blank');
        if(!MF.p2) grantOrderBonus();
        setTimeout(()=>modal('🎉','订单已发给客服!', bonusGranted>0?`额外 <b>+${bonusGranted}</b> 次抽奖到账 🎉`:'订单已送出 ✓', [{label:'继续抽', action:()=>go('home')}]), 400); }},
     {label:'返回继续搭配', sub:true}]);
  } finally { ordering=false; const _wb=$('waBtn'); if(_wb) _wb.disabled=false; }
});
function genCode(sig, pkgKey){
  if(S.codes[sig]) return S.codes[sig];
  const p = pkgKey==='4box'?'4B':'2B';
  const n = Math.floor(100000+Math.random()*900000);
  const code = `MD-${p}-${n}`;
  S.codes[sig]=code; save();
  return code;
}

/* ---------------- 兑换码:用户入口 ---------------- */
$('codeBar') && ($('codeBar').onclick=codeModal);

/* ---------------- 超级权限后台 ---------------- */
/* ---------------- 活动列表(超级权限落地页) ---------------- */
const THEME_LABEL={wheel:'🎡 大转盘',scratch:'🎫 刮刮乐',match3:'🧩 三消',penalty:'⚽ 点球'};
const CAMP_BADGE={planning:['⚪ 未开发','cb-plan'],preparing:['🔵 准备中','cb-prep'],running:['🟢 进行中','cb-run'],ended:['🏁 已结束','cb-end']};
const CAMP_ORDER={running:0,preparing:1,planning:2,ended:3};
function renderCampaigns(){
  const ab=$('addCampBtn'); if(ab) ab.onclick=addCampaignModal;
  const cl=$('campLogout'); if(cl) cl.onclick=logout;
  const ct=$('campTools'); if(ct) ct.onclick=()=>go('admin');
  const box=$('campBody'); if(box) box.innerHTML='<div class="adm-empty">加载中…</div>';
  loadCampaignList();
}
async function loadCampaignList(){
  const r=await adminWrite({action:'listCampaigns'});
  const box=$('campBody'); if(!box) return;
  if(!r||!r.ok){ box.innerHTML='<div class="cs-bad">连不上服务器,刷新重试</div>'; return; }
  const camps=(r.campaigns||[]).slice().sort((a,b)=>(CAMP_ORDER[a.status]??9)-(CAMP_ORDER[b.status]??9));
  if(!camps.length){ box.innerHTML='<div class="adm-empty">还没有活动 —— 点右上「+ 增加活动」建一个 👆</div>'; return; }
  box.innerHTML=camps.map(c=>{
    const bd=CAMP_BADGE[c.status]||['·','']; const act=c.status==='ended'?'查看存档':(c.status==='running'?'管理':'编辑草稿');
    const st=c.stats?`<div class="cl-mini">👥 ${c.stats.participants} · 🛒 ${c.stats.orders} · 🎡 ${c.stats.spins}</div>`:'';
    return `<button class="cl-card ${bd[1]}" data-camp="${c.id}" data-status="${c.status}">
      <div class="cl-row"><span class="cl-title">${c.title||c.id}</span><span class="cl-badge ${bd[1]}">${bd[0]}</span></div>
      <div class="cl-meta">${c.id} · ${THEME_LABEL[c.theme]||c.theme} · ${c.start||'?'}${c.end?(' ~ '+c.end):''}</div>
      ${st}<div class="cl-go">${act} →</div></button>`;
  }).join('');
  box.querySelectorAll('[data-camp]').forEach(b=>b.onclick=()=>openCampaign(b.dataset.camp,b.dataset.status));
}
let curDetailId=null;
function openCampaign(id,status){
  if(status==='running'){ go('admin'); }                       // 管理正在进行的(现有后台)
  else if(status==='ended'){ curDetailId=id; go('campdetail'); } // 进入活动详情(整页,不是弹窗)
  else {                                                        // 草稿:准备中 —— 编辑/启动是第2步;现在可删
    modal('🛠', id, '这个活动还在<b>准备中</b> 🛠<br>编辑设置 + 启动功能是<b>下一步(第2步)</b>开放。',
      [{label:'🗑 删除这个草稿', action:async ()=>{ const r=await apiPOST('/api/admin',{action:'deleteCampaign',id}); if(r&&r.ok){ toastModal('已删除'); renderCampaigns(); } else toastModal(r&&r.hint?r.hint:'删除失败'); }},
       {label:'关闭', sub:true}]);
  }
}
function prizeName(k){ const q=byKey(k); if(!q) return k; if(q.type==='disc') return 'RM'+((q.a&&q.a.value)||'')+'券'; return q.sa||k; }
async function renderCampDetail(id){                            // 活动详情整页(点某个已结束活动进来)
  id = id || curDetailId;
  const box=$('campDetailBody'); if(!box) return;
  box.innerHTML='<div class="adm-empty">加载中…</div>';
  const r=await adminWrite({action:'getCampaignArchive', id});
  if(!r||!r.ok){ box.innerHTML='<div class="cs-bad">连不上服务器,刷新重试</div>'; return; }
  const a=r.archive, c=r.campaign||{};
  if($('cdTitle')) $('cdTitle').textContent = c.title||id;
  if(!a){ box.innerHTML='<div class="adm-empty">这个活动还没有存档数据。</div>'; return; }
  const pc=a.prizeCounts||{};
  const prizeRows=Object.keys(pc).length?Object.entries(pc).sort((x,y)=>y[1]-x[1]).map(([k,n])=>`<div class="pz-row"><span>${prizeName(k)}</span><b>${n} 人</b></div>`).join(''):'<div class="adm-empty">无</div>';
  const lb=(a.winners||[]).map((w,i)=>`<div class="adm-lb"><span class="r ${i<3?'top':''}">${i+1}</span><span class="nm">${w.name}</span><span class="v">${w.n} 件</span></div>`).join('')||'<div class="adm-empty">无</div>';
  box.innerHTML=`
    <div class="cd-hero"><span class="cd-badge">🏁 已结束</span><span class="cd-meta">${id} · ${THEME_LABEL[c.theme]||c.theme} · ${c.start||''} ~ ${c.end||''}</span></div>
    <div class="adm-stats">
      <div class="adm-stat"><div class="n">${a.participants||0}</div><div class="l">参与人数</div></div>
      <div class="adm-stat"><div class="n">${a.spins||0}</div><div class="l">总抽奖</div></div>
      <div class="adm-stat"><div class="n">${a.orders||0}</div><div class="l">下单数</div></div></div>
    <div class="adm-card"><div class="adm-h">🎁 各奖中出(多少人抽到)</div>${prizeRows}</div>
    <div class="adm-card"><div class="adm-h">🏆 中奖最多</div>${lb}</div>`;
}
function addCampaignModal(){
  modal('➕','增加活动',
    `<div class="ncf">
      <div class="msg-lbl">活动码(MMD+日月年,如 MMD080826)</div><input id="ncCode" class="m-input camp-in" placeholder="MMD080826">
      <div class="msg-lbl">标题</div><input id="ncTitle" class="m-input camp-in" placeholder="会员日 · 八月大转盘">
      <div class="msg-lbl">游戏主题</div><select id="ncTheme" class="m-input camp-in"><option value="wheel">🎡 大转盘</option><option value="scratch">🎫 刮刮乐</option><option value="match3">🧩 三消</option><option value="penalty">⚽ 点球</option></select>
      <div class="msg-lbl">开始日期(结束日自动 = 开始+6天,共7天)</div><input id="ncStart" class="m-input camp-in" placeholder="2026-08-01">
    </div>`,
    [{label:'创建活动',action:async ()=>{
      const id=($('ncCode').value||'').trim().toUpperCase(), title=($('ncTitle').value||'').trim(), theme=$('ncTheme').value, start=($('ncStart').value||'').trim();
      const r=await apiPOST('/api/admin',{action:'createCampaign',id,title,theme,start});
      if(r&&r.ok){ toastModal('✅ 活动已创建(草稿)'); renderCampaigns(); }
      else { toastModal(r&&r.hint?r.hint:'创建失败,检查活动码/日期格式 🙂'); }
    }},{label:'取消',sub:true}]);
}

function renderAdmin(){
  renderTop();
  const live = MF.api;
  const dP=spCount, dO=Math.round(spCount*0.42), dS=spCount+27;   // demo 兜底(没连服务器时)
  const stats=`<div class="adm-stats">
    <div class="adm-stat"><div class="n" id="stP">${live?'…':dP}</div><div class="l">参与人数</div></div>
    <div class="adm-stat"><div class="n" id="stS">${live?'…':dS}</div><div class="l">总抽奖次数</div></div>
    <div class="adm-stat"><div class="n" id="stO">${live?'…':dO}</div><div class="l">下单数</div></div></div>`;
  const prizeCard=`<div class="adm-card"><div class="adm-h">🎁 各奖品中奖统计(多少人抽到)</div>
    <div id="prizeStats">${live?'<div class="adm-empty">加载中…</div>':'<div class="adm-empty">连服务器后显示</div>'}</div>
    <div class="adm-note">每人每个奖最多中一次,所以「X 人」= 有多少人抽到这个奖。</div></div>`;
  const lbDemo = ADMIN_LB.map((p,i)=>`<div class="adm-lb"><span class="r ${i<3?'top':''}">${i+1}</span><span class="nm">${p.name}</span><span class="v">中奖 ${p.n} 件</span></div>`).join('');
  const lb=`<div class="adm-card"><div class="adm-h">🏆 谁最强(中奖最多)</div><div id="admLb">${live?'<div class="adm-empty">加载中…</div>':lbDemo}</div></div>`;
  const csCard = live ? `<div class="adm-card"><div class="adm-h">🔎 客服核对兑换码</div>
    <div class="code-add"><input id="csCode" placeholder="顾客的码 如 MD-2B-123456" autocapitalize="characters"><button id="csBtn">核对</button></div>
    <div id="csResult"></div>
    <div class="adm-note">输入顾客发来的下单码 → 核对配套/好礼/价格(以服务器记录为准,防改 WhatsApp 文字)。</div></div>` : '';
  const findCard = live ? `<div class="adm-card"><div class="adm-h">🔍 查顾客(忘了抽中什么?输电话查)</div>
    <div class="code-add"><input id="findPhone" placeholder="顾客电话 如 0123456789" inputmode="tel"><button id="findBtn">查</button></div>
    <div id="findResult"></div>
    <div class="adm-note">输入顾客电话 → 看他抽中了什么、有没有下单(只读,不影响活动)。</div></div>` : '';
  const msgCard = live ? `<div class="adm-card"><div class="adm-h">✏️ 查顾客·消息模板(可自己改)</div>
    <div class="adm-note" style="margin:0 0 4px">标签:<b>{name}</b>姓名 · <b>{phone}</b>电话 · <b>{list2}</b>/<b>{list3}</b>奖品清单 · <b>{pick2}</b>/<b>{pick3}</b>可选几样。改完按保存,对所有客服生效。</div>
    <div class="msg-lbl">🆘 补救消息(好礼已过期时)</div>
    <textarea id="msgRecover" class="msg-ta" rows="12"></textarea>
    <div class="msg-lbl">🎁 正常消息(未过期时)</div>
    <textarea id="msgOrder" class="msg-ta" rows="8"></textarea>
    <button id="msgSaveBtn" class="lead-btn" style="margin-top:10px">💾 保存消息模板</button>
    <button id="msgResetBtn" class="ghost" style="margin-top:8px;width:100%;text-align:center">恢复默认模板</button></div>` : '';
  const leadsCard = live ? `<div class="adm-card"><div class="adm-h">📋 待跟进名单(玩过没下单)</div>
    <button id="leadsBtn" class="lead-btn">⬇️ 导出 CSV(姓名 + 电话 + 抽中好礼)</button>
    <div class="adm-note">导出「玩过但还没下单」的顾客 → WhatsApp 群发提醒(配合 24 小时好礼快过期,转化更高)。</div></div>` : '';
  const codesObj = MF.api ? (serverCodes || {}) : promoCodes;
  const list = (MF.api && !codesLoaded)
    ? '<div class="adm-empty">加载中…</div>'
    : (Object.keys(codesObj).length
        ? Object.entries(codesObj).map(([c,n])=>`<div class="code-row"><span class="cc">${c}</span><span class="cn">+${n} 次</span><button class="code-del" data-delcode="${c}">✕</button></div>`).join('')
        : '<div class="adm-empty">还没有码 —— 在下面加一个 👇</div>');
  const codes=`<div class="adm-card"><div class="adm-h">🎁 兑换码(送抽奖次数)</div>
    ${list}
    <div class="code-add"><input id="newCode" placeholder="新码 如 BONUS10" autocapitalize="characters"><input id="newCodeN" type="number" inputmode="numeric" placeholder="次数" min="1" max="99"><button id="addCodeBtn">+ 添加</button></div>
    <div class="adm-note">${MF.api?'✅ <b>已连服务器</b>:加的码对<b>所有顾客即时生效</b>,删了就真的没了(列表以服务器为准)。':'⚠️ 未连服务器,加的码只存本机。'}</div></div>`;
  const totalW = WHEEL.reduce((s,p)=>s+(weights[p.key]||0),0);
  const wlist = WHEEL.map(p=>{ const w=weights[p.key]||0; const pct=totalW>0?(w/totalW*100):0; const nm=p.sa===p.sb?p.sa:`${p.sa}/${p.sb}`;
    return `<div class="w-row"><span class="wn">${p.emoji} ${nm}</span><input class="w-in" type="number" min="0" step="0.5" value="${w}" data-wkey="${p.key}"><span class="wp">${pct.toFixed(1)}%</span></div>`; }).join('');
  const weightsCard = `<div class="adm-card"><div class="adm-h">🎲 转盘中奖概率(改数字 → 实时生效)</div>${wlist}<div class="adm-note">数字 = 中奖权重,越大越容易中。<b>0 = 永不中</b>(如 999 金)。右边 % 是相对概率。</div></div>`;
  const cur = ACT_STATES[actStatus] || ACT_STATES.running;
  const stOpts = [['running','▶️ 进行中'],['paused','⏸ 暂停活动'],['updating','🔧 更新中'],['ended','🏁 结束活动'],['closed','🔒 关闭活动']];
  const actCard = `<div class="adm-card act-card"><div class="adm-h">🎛 活动控制</div>
    <div class="act-cur ${cur.tone}">当前状态:<b>${cur.emoji} ${cur.label}</b></div>
    <div class="act-btns">${stOpts.map(([k,lbl])=>`<button class="act-set ${actStatus===k?'on':''}" data-act="${k}">${lbl}</button>`).join('')}</div>
    <div class="adm-note">非「进行中」时,用户会看到对应提示且不能抽奖(已抽中的好礼仍可在 24 小时内兑换)。${MF.api?'✅ <b>已连服务器:改了对所有顾客即时生效</b>。':'⚠️ 未连服务器,只存本机。'}</div></div>`;
  const campCard = live ? `<div class="adm-card camp-card"><div class="adm-h">📅 本期主题 · 结束归档</div>
    <div id="campNow" class="camp-now"><div class="adm-empty">加载中…</div></div>
    <div class="camp-next">
      <div class="msg-lbl" style="margin-top:2px">▶️ 结束后开新一期(留空 = 只收档,不开新)</div>
      <input id="nextId" class="m-input camp-in" placeholder="新期号 如 2026-08">
      <input id="nextTitle" class="m-input camp-in" placeholder="标题 如 会员日·八月三消">
      <input id="nextTheme" class="m-input camp-in" placeholder="主题 wheel / match3 / penalty">
      <div class="camp-dates"><input id="nextStart" class="m-input camp-in" placeholder="开始 2026-08-01"><input id="nextEnd" class="m-input camp-in" placeholder="结束 2026-08-07"></div>
    </div>
    <button id="closeCampBtn" class="danger-btn">🔚 结束本期并归档</button>
    <div class="adm-note">按下会:①存档本期整体成绩 ②把每位顾客成绩写进永久档案 ③清空本期数据换新主题。<b>数据不会丢,往期永久保存。</b></div></div>` : '';
  const archCard = live ? `<div class="adm-card"><div class="adm-h">📚 往期存档(历史主题成绩)</div>
    <div id="archList"><div class="adm-empty">加载中…</div></div>
    <div class="adm-note">每期归档后,整体成绩永久留在这里,随时回看。</div></div>` : '';
  const topNote = live ? '✅ 下面是<b>真实数据</b>(服务器实时统计)。' : '⚠️ 下面人数/排行是 <b>demo 模拟数据</b>(未连服务器)。';
  $('adminBody').innerHTML=`<div class="adm-note top">${topNote}</div>${actCard}${campCard}${archCard}${stats}${prizeCard}${lb}${csCard}${findCard}${msgCard}${leadsCard}${weightsCard}${codes}<button class="ghost" id="admLogout">退出登录</button>`;
  const add=$('addCodeBtn'); if(add) add.onclick=async ()=>{
    const c=($('newCode').value||'').trim().toUpperCase(), n=parseInt($('newCodeN').value,10);
    if(!c||!(n>0)){ toastModal('填写码和次数 🙂'); return; }
    promoCodes[c]=n; savePromo();
    if(MF.api && !(await adminWrite({action:'addCode',code:c,draws:n}))) toastModal('已存本机,但没同步到服务器,稍后重试 ⚠️');
    codesLoaded=false; renderAdmin();
  };
  $('adminBody').querySelectorAll('[data-delcode]').forEach(b=>b.onclick=async ()=>{ const c=b.dataset.delcode; delete promoCodes[c]; savePromo(); if(MF.api) await adminWrite({action:'delCode',code:c}); codesLoaded=false; renderAdmin(); });
  $('adminBody').querySelectorAll('[data-wkey]').forEach(inp=>{ inp.onchange=async ()=>{ const v=parseFloat(inp.value); weights[inp.dataset.wkey]=(isFinite(v)&&v>=0)?v:0; saveWeights(); if(MF.api) await adminWrite({action:'setWeights',weights}); renderAdmin(); }; });
  $('adminBody').querySelectorAll('[data-act]').forEach(b=>b.onclick=async ()=>{ actStatus=b.dataset.act; saveStatus(); if(MF.api) await adminWrite({action:'setStatus',status:actStatus}); renderAdmin(); });
  const csBtn=$('csBtn'); if(csBtn) csBtn.onclick=csVerify;
  const fb=$('findBtn'); if(fb) fb.onclick=findMember;
  if($('msgRecover')) $('msgRecover').value = MSG_RECOVER;
  if($('msgOrder')) $('msgOrder').value = MSG_ORDER;
  const msb=$('msgSaveBtn'); if(msb) msb.onclick=saveMsgTpls;
  const mrb=$('msgResetBtn'); if(mrb) mrb.onclick=()=>{ MSG_RECOVER=DEF_MSG_RECOVER; MSG_ORDER=DEF_MSG_ORDER; if($('msgRecover'))$('msgRecover').value=MSG_RECOVER; if($('msgOrder'))$('msgOrder').value=MSG_ORDER; toastModal('已恢复默认(记得按保存 💾)'); };
  const lb2=$('leadsBtn'); if(lb2) lb2.onclick=exportLeads;
  const ccb=$('closeCampBtn'); if(ccb) ccb.onclick=closeCampaign;
  const lo=$('admLogout'); if(lo) lo.onclick=logout;
  if(live){ loadAdminStats(); loadCampaignInfo(); if(!codesLoaded) loadAdminCodes(); }
}
async function loadCampaignInfo(){          // 本期主题 + 往期存档列表
  const c = await adminWrite({action:'getCampaign'});
  if(c && c.ok && c.campaign && $('campNow')){ const cp=c.campaign;
    $('campNow').innerHTML = `<div class="camp-badge">${cp.title||cp.id}</div><div class="camp-meta">期号 <b>${cp.id}</b> · 主题 <b>${cp.theme||'—'}</b> · ${cp.start||'?'} ~ ${cp.end||'?'}</div>`; }
  const a = await adminWrite({action:'listArchives'});
  if(a && a.ok && $('archList')){ const arr=a.archives||[];
    $('archList').innerHTML = arr.length
      ? arr.map(x=>`<div class="arch-row"><div class="arch-t">${x.title||x.id}${x.theme?` <span class="arch-th">${x.theme}</span>`:''}</div><div class="arch-n">👥 ${x.participants} 人 · 🛒 ${x.orders} 单 · 🎡 ${x.spins} 抽</div></div>`).join('')
      : '<div class="adm-empty">还没有往期存档 —— 结束第一期后会出现在这里。</div>'; }
}
async function closeCampaign(){             // 结束本期并归档(强确认)
  const id=($('nextId').value||'').trim();
  const nextInfo = id ? { id, title:($('nextTitle').value||'').trim(), theme:(($('nextTheme').value||'wheel').trim()||'wheel'), start:($('nextStart').value||'').trim(), end:($('nextEnd').value||'').trim() } : null;
  const msg = nextInfo
    ? `确定<b>结束本期并归档</b>,然后开新一期 <b>${id}</b>?<br><br>本期成绩会永久存档 + 写进每位顾客档案,再清空当前数据换新主题。<b>数据不会丢。</b>`
    : `确定<b>结束本期并归档</b>?<br><br>本期成绩会永久存档 + 写进每位顾客档案,再清空当前数据(活动进入「关闭」)。<b>数据不会丢。</b>`;
  modal('🔚','结束本期并归档', msg, [
    {label:'确定结束并归档', action:async ()=>{
      const r=await apiPOST('/api/admin', {action:'closeAndArchive', next:nextInfo});   // 直连:非 ok 也能拿到 hint(empty/same_id/bad_start)
      if(r && r.ok){ actStatus = r.next?'running':'closed'; saveStatus();
        modal('✅','已归档', `本期 <b>${r.archived}</b> 已存档,<b>${r.rolled}</b> 位顾客写进永久档案。${r.next?('新一期 <b>'+r.next+'</b> 已开始 🎬'):'活动已关闭 🔒'}`, [{label:'好的', action:renderAdmin}]); }
      else { toastModal(r&&r.hint ? r.hint : (r&&r.error ? ('归档失败:'+r.error) : '归档失败,请重试 ⚠️')); }
    }},
    {label:'取消', sub:true}
  ]);
}
async function loadAdminCodes(){          // 从服务器拉真实兑换码列表(后台显示服务器为准)
  const r = await adminWrite({action:'get'});
  if(r && r.ok){ serverCodes = r.codes || {}; if(r.msgRecover) MSG_RECOVER=r.msgRecover; if(r.msgOrder) MSG_ORDER=r.msgOrder; codesLoaded = true; renderAdmin(); }
}
async function exportLeads(){              // 导出「玩过没下单」名单 CSV
  const btn=$('leadsBtn'); if(btn){ btn.disabled=true; btn.textContent='导出中…'; }
  const r = await adminWrite({action:'leads'});
  if(btn){ btn.disabled=false; btn.textContent='⬇️ 导出 CSV(姓名 + 电话 + 抽中好礼)'; }
  if(!r || !r.ok){ toastModal('导出失败,再试一次 🙂'); return; }
  const leads = r.leads||[];
  if(!leads.length){ toastModal('目前没有「玩过但没下单」的顾客 🙂'); return; }
  const rows = [['姓名','电话','抽中好礼','抽奖次数','最早好礼到期']];
  leads.forEach(L=>{
    const prizes = (L.prizes||[]).map(k=>{const p=byKey(k);return p?p.sa:k;}).join(' / ');
    let exp=''; const times=Object.values(L.wonAt||{});
    if(times.length){ const d=new Date(Math.min.apply(null,times)+CONFIG.REDEEM_MS); exp=`${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
    rows.push([L.name||'', '0'+(L.phone||''), prizes, L.drawsUsed||0, exp]);
  });
  const csv = '﻿'+rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a'); a.href=url; a.download=`待跟进名单_${leads.length}人.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  toastModal(`已导出 ${leads.length} 位待跟进顾客 ✓`);
}
async function loadAdminStats(){           // 拉真实统计 + 排行榜
  const r = await adminWrite({action:'stats'});
  if(!r || !r.ok || !r.stats) return;
  const st=r.stats;
  if($('stP')) $('stP').textContent = st.participants||0;
  if($('stS')) $('stS').textContent = st.spins||0;
  if($('stO')) $('stO').textContent = st.orders||0;
  const winners = Object.values(st.winners||{}).sort((a,b)=>(b.n||0)-(a.n||0)).slice(0,8);
  const el=$('admLb');
  if(el) el.innerHTML = winners.length
    ? winners.map((w,i)=>`<div class="adm-lb"><span class="r ${i<3?'top':''}">${i+1}</span><span class="nm">${w.name}</span><span class="v">中奖 ${w.n} 件</span></div>`).join('')
    : '<div class="adm-empty">还没有人中奖</div>';
  const pc = st.prizeCounts || {};
  const ps = $('prizeStats');
  if(ps) ps.innerHTML = WHEEL.map(p=>{ const n=pc[p.key]||0; const nm=(p.sa===p.sb)?p.sa:`${p.sa}/${p.sb}`; return `<div class="pz-row"><span class="pz-nm">${p.emoji} ${nm}</span><span class="pz-n">${n} 人</span></div>`; }).join('');
}
async function csVerify(){                  // 客服核对下单兑换码
  const code=($('csCode').value||'').trim().toUpperCase();
  const box=$('csResult'); if(!box) return;
  if(!code){ box.innerHTML='<div class="cs-bad">请输入兑换码</div>'; return; }
  box.innerHTML='<div class="adm-empty">核对中…</div>';
  const r = await adminWrite({action:'csVerify', code});
  if(!r || !r.ok){ box.innerHTML='<div class="cs-bad">服务器没回应,再试一次</div>'; return; }
  if(!r.rec){ box.innerHTML='<div class="cs-bad">❌ 找不到这个码(可能是假的或打错了)</div>'; return; }
  const rec=r.rec;
  const items=(rec.bundle||[]).length ? rec.bundle.map(k=>{const p=byKey(k); return p?(rec.pkg==='4box'?p.sb:p.sa):k;}).join('、') : '(无好礼)';
  const statusTxt = rec.status==='redeemed' ? '<span class="cs-used">⚠️ 已发货过</span>' : '<span class="cs-ok">✓ 有效 · 未发货</span>';
  box.innerHTML=`<div class="cs-card">
    <div class="cs-row">${statusTxt}</div>
    <div class="cs-row">会员:<b>${rec.name||''}</b>(${rec.phone||''})</div>
    <div class="cs-row">配套:${rec.pkg==='4box'?'4 Boxes RM716':'2 Boxes RM358'}</div>
    <div class="cs-row">好礼:${items}</div>
    <div class="cs-row">应付:<b>${rec.free?'RM0(免单)':'RM'+rec.final}</b></div>
    ${rec.status!=='redeemed'?'<button id="csRedeemBtn" class="act-set" style="margin-top:8px">标记已发货</button>':''}</div>`;
  const rb=$('csRedeemBtn'); if(rb) rb.onclick=async ()=>{ const rr=await adminWrite({action:'csRedeem',code}); if(rr&&rr.ok) csVerify(); };
}
/* ---------- 查顾客·消息模板(可后台自改;{name}{phone}{list2}{list3}{pick2}{pick3}) ---------- */
const DEF_MSG_RECOVER = `你好👋 {name}\n\n📱 ({phone}) · 会员日抽中奖励记录\n\n⚠️ 你的奖励已经超过 24 小时，原本已经失效了。\n\n不过今天我们可以破例帮你恢复一次，只要今天完成兑换，还来得及🙏\n\n〈2盒 RM358〉可任选 {pick2}样\n\n{list2}\n\n〈4盒 RM716〉可任选 {pick3}样\n\n{list3}\n\n⏰ 今天是最后一天可以补救恢复奖励，过了今天就真的不能再恢复了。\n\n👉 如果要保留你的礼物，今天回复我「2盒」或「4盒」，我马上帮你安排兑换。 💪`;
const DEF_MSG_ORDER = `你好👋 {name}\n\n📱 ({phone}) · 会员日抽中好礼\n\n〈2盒 RM358〉可任选 {pick2}样\n\n{list2}\n\n〈4盒 RM716〉可任选 {pick3}样\n\n{list3}\n\n👉 想要哪个配套?今天回复我「2盒」或「4盒」，我马上帮你安排兑换 🙂`;
let MSG_RECOVER = DEF_MSG_RECOVER, MSG_ORDER = DEF_MSG_ORDER;
async function findMember(){                // 客服查顾客:电话 → 抽中什么(2盒/4盒清单,一键复制给顾客)
  const p=($('findPhone').value||'').trim(); const box=$('findResult'); if(!box) return;
  if(!p){ box.innerHTML='<div class="cs-bad">请输入电话</div>'; return; }
  box.innerHTML='<div class="adm-empty">查询中…</div>';
  const [r, cf]=await Promise.all([ adminWrite({action:'findPhone', phone:p}), adminWrite({action:'customerFull', phone:p}) ]);
  if(!r || !r.ok){ box.innerHTML='<div class="cs-bad">服务器没回应,再试一次</div>'; return; }
  const cust=(cf&&cf.ok)?cf.customer:null;                     // 跨月永久档案(归档后才有)
  const passportHTML = cust ? (()=>{ const tierName={gold:'金卡',silver:'银卡',member:'会员'}[cust.tier]||'会员';
    return `<div class="mp-card"><div class="mp-h">🪪 会员档案 · 跨月累积</div><div class="mp-grid"><div><b>${cust.campaignsJoined||0}</b><span>参加期数</span></div><div><b>${cust.totalPrizes||0}</b><span>累计好礼</span></div><div><b>${cust.totalOrders||0}</b><span>累计下单</span></div><div><b>RM${cust.totalSavedRM||0}</b><span>累计省下</span></div></div><div class="mp-tier">🏅 ${tierName} · ${cust.points||0} 分</div></div>`; })() : '';
  if(!r.found || !r.found.length){ box.innerHTML = passportHTML + (passportHTML?'<div class="cs-row" style="padding:8px 16px">本期还没玩过(上面是他过往累积的档案)。</div>':'<div class="cs-bad">找不到这个电话(可能还没玩过,或号码不对)</div>'); return; }
  const ORDER=['g5','g10','g15','tumbler','duffle','free','gold','v5','v10','v30','v50'];
  const line=(k,is4)=>{ const q=byKey(k); if(!q) return '🎁 '+k;
    if(q.type==='disc') return '🎁 RM'+((is4?q.b.value:q.a.value)||0)+' Voucher';
    if(k==='tumbler') return '🎁 World Cup Tumbler';
    if(k==='duffle') return '🎁 World Cup Duffle Bag';
    if(k==='free') return '🎁 整单免单';
    if(k==='gold') return '🎁 999 足金';
    if(k==='g15'&&is4) return '🎁 30包 MFormula（1盒）';
    return '🎁 '+(is4?q.sb:q.sa)+' MFormula'; };
  box.innerHTML = r.found.map((m)=>{
    const wonAt=m.wonAt||{}, REDEEM=CONFIG.REDEEM_MS;
    const isExp=k=>{ const t=wonAt[k]; return !!t && (t+REDEEM<=Date.now()); };
    const won=ORDER.filter(k=>(m.won||[]).includes(k));   // 全部抽中的(含过期)—— 都要显示
    const ordered=(m.orderCount||0)>0;
    const head=`<div class="cs-row">👤 <b>${m.name||''}</b>(0${m.phone}) · ${ordered?'<span class="cs-used">已下单</span>':'<span class="cs-ok">还没下单</span>'}</div>`;
    if(!won.length) return `<div class="cs-card">${head}<div class="cs-row">🎁 还没抽中任何好礼</div></div>`;
    const anyExpired = won.some(isExp);
    const n=won.length, pick2=Math.min(n,2), pick3=Math.min(n,3);
    const list2=won.map(k=>line(k,false)).join('\n'), list3=won.map(k=>line(k,true)).join('\n');   // 消息清单(全部,不标过期)
    const tag=k=>isExp(k)?' <span class="fm-exp">⌛已过期</span>':'';                                // 显示清单标过期
    const disp2=won.map(k=>line(k,false)+tag(k)).join('<br>'), disp3=won.map(k=>line(k,true)+tag(k)).join('<br>');
    const tpl=anyExpired?MSG_RECOVER:MSG_ORDER;
    const msg=tpl.replace(/{name}/g,m.name||'').replace(/{phone}/g,'0'+m.phone).replace(/{list2}/g,list2).replace(/{list3}/g,list3).replace(/{pick2}/g,pick2).replace(/{pick3}/g,pick3);
    const banner = anyExpired
      ? `<div class="fm-banner">⌛ 有好礼已过 24 小时 —— 复制的是「破例恢复」消息(下面标 ⌛已过期 的就是过期那几个,可一起帮他恢复)。</div>`
      : '';
    return `<div class="cs-card">${head}
      ${banner}
      <div class="fm-pkg"><div class="fm-h">2盒 RM358 <span>(可选${pick2}样)</span></div><div class="fm-list">${disp2}</div></div>
      <div class="fm-pkg"><div class="fm-h">4盒 RM716 <span>(可选${pick3}样)</span></div><div class="fm-list">${disp3}</div></div>
      <button class="fm-copy" data-copy="${encodeURIComponent(msg)}">📋 ${anyExpired?'复制「恢复」消息':'复制给顾客'}</button></div>`;
  }).join('');
  box.innerHTML = passportHTML + box.innerHTML;                // 跨月档案置顶
  box.querySelectorAll('[data-copy]').forEach(btn=>btn.onclick=()=>{
    const t=decodeURIComponent(btn.dataset.copy), done=()=>toastModal('已复制 ✅ 去 WhatsApp 贴给顾客就行');
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(()=>fmFallbackCopy(t,done));
    else fmFallbackCopy(t,done);
  });
}
function fmFallbackCopy(t,done){ const ta=document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select(); try{document.execCommand('copy'); done();}catch(e){toastModal('复制失败,长按选取 🙏');} ta.remove(); }
async function saveMsgTpls(){
  const rec=(($('msgRecover')&&$('msgRecover').value)||'').trim(), ord=(($('msgOrder')&&$('msgOrder').value)||'').trim();
  MSG_RECOVER=rec||DEF_MSG_RECOVER; MSG_ORDER=ord||DEF_MSG_ORDER;
  const a=await adminWrite({action:'setMsg', which:'recover', text:MSG_RECOVER});
  const b=await adminWrite({action:'setMsg', which:'order', text:MSG_ORDER});
  toastModal((a&&b)?'消息模板已保存 ✅ 对所有客服生效':'保存失败,再试一次 ⚠️');
}

/* ---------------- 帮助 ---------------- */
function renderHelp(){
  $('helpBody').innerHTML = `
    <div class="help-h">怎么玩(超简单)</div>
    <div class="help-p">点 <b>「抽奖!」</b> 转大转盘 → 停在哪格就<b>免费赢</b>哪个好礼(折扣券/试饮装/水杯/背包…)。抽中的好礼自动放进「我的好礼」。</div>
    <div class="help-h">怎么拿到手</div>
    <div class="help-p">想把好礼带回家 → 选个配套(2 Boxes RM358 / 4 Boxes RM716)→ 点「联系客服」把订单 + 兑换码发 WhatsApp 给客服。<b>不买也能玩、能抽。</b></div>
    <div class="help-h">大奖</div>
    <div class="help-p">转盘上有 <b>免单</b> 和 <b>999 足金</b> —— 概率超低,看得到、超难中,抽到就是天选之子 🍀。</div>
    <div class="help-h">公平说明</div>
    <div class="help-p">转盘中奖完全由系统<b>随机</b>抽出,<b>每个人机会都一样</b>,不会因为你是谁而改变。免单和 999 足金是<b>真奖品</b>,只是数量极少、纯凭运气 🍀。</div>
    <div class="help-h">抽奖次数(每天不同)</div>
    <div class="help-p"><b>第 1 天 5 次</b> · 第 2–6 天每天 1 次 · <b>第 7 天 3 次</b>。今天用完了 —— <b>输入兑换码</b>或<b>下单 +${CONFIG.ORDER_BONUS}</b> 立刻继续,明天回来还有免费次数。</div>
    <div class="help-h">好礼 24 小时内兑换</div>
    <div class="help-p">抽中的好礼会<b>倒数 24 小时</b>,请在失效前联系客服兑换,过期作废。活动 1/7–7/7。</div>`;
}

/* ---------------- 弹窗 ---------------- */
function modal(emoji,title,text,buttons){
  modalRaw(`<div class="m-emoji">${emoji}</div><div class="m-name">${title}</div><div class="m-text">${text}</div>`, buttons);
}
function modalRaw(html,buttons,shake){
  $('modalBody').innerHTML=html;
  $('modalCard').classList.toggle('shake', !!shake);
  renderBtns(buttons); $('modal').classList.remove('hidden');
}
function toastModal(text){ modal('💡','提示',text,[{label:'知道了'}]); }
function renderBtns(buttons){
  buttons = buttons && buttons.length ? buttons : [{label:'好的'}];
  $('modalBtns').innerHTML='';
  buttons.forEach(b=>{
    const el=document.createElement('button');
    el.className = b.sub?'m-sub':'m-gold';
    el.textContent=b.label;
    el.onclick=()=>{ $('modal').classList.add('hidden'); if(b.action) b.action(); };
    $('modalBtns').appendChild(el);
  });
}

/* ---------------- 下一天 ---------------- */
$('nextDayBtn').onclick=()=>{
  if(S.day>=7){
    modal('🏆','Member Day 结束!',`活动结束啦。你抽中了 <b>${S.won.length}</b> 件好礼。<br>点下面重置 demo。`,[{label:'重玩 demo',action:()=>{ localStorage.removeItem('mfmemberday'); location.reload(); }}]);
    return;
  }
  S.day++; S.chances=drawsForDay(S.day); save();
  go('home');
  modal('☀️',`进入 Day ${S.day}`,`今天的抽奖次数:<b>${drawsForDay(S.day)}</b> 次。<br>继续转大转盘赢好礼!`,[{label:'去抽奖'}]);
};

/* ---------------- 登入 / 登出 ---------------- */
$('loginBtn').onclick=async ()=>{
  const name=$('loginName').value.trim(), phone=$('loginPhone').value.trim();
  if(!name){ toastModal('请填写你的名字 🙂'); return; }
  const isAdmin = name.toLowerCase()===ADMIN_NAME && MF.api;
  if(!isAdmin && !myPhone(phone)){ toastModal('请填 01 开头的大马手机号,例如 012-345 6789(座机不行哦)🙂'); return; }
  S.name=name; S.phone=phone; S.loggedIn=true; S.admin=false;
  if(isAdmin){          // 管理员:口令交服务器校验(拿 cookie)
    const a = await apiPOST('/api/admin-login', {pass: phone.replace(/\D/g,'')});
    if(a && a.ok) S.admin=true;
  }
  if(!S.admin && MF.p2){                                  // 普通会员:服务器版换取状态(次数/已中奖)
    const r = await serverSession();
    if(r && r.ok===false && r.reason==='badphone'){ S.loggedIn=false; toastModal('服务器版请用大马手机号登入(例:0123456789)'); return; }
  }
  save();
  go(S.admin?'campaigns':'home');
};
function logout(){
  modal('🔓','退出登录?','回到登入页,可换名字/电话重新登入(本机进度会清空,方便换人测试)。',
    [{label:'退出登录', action:()=>{ localStorage.removeItem('mfmemberday'); S=load(); if($('loginName'))$('loginName').value=''; if($('loginPhone'))$('loginPhone').value=''; go('login'); }},
     {label:'取消', sub:true}]);
}
$('logoutBtn').onclick=logout;

/* ---------------- 实时感:社会证明 + 库存被抢 ---------------- */
function tickLive(){
  if(!MF.api){                                  // 仅 demo(没连服务器)时假增长;服务器版用真实数字
    spCount += 1 + (Math.random()<0.3 ? 1 : 0);
    const sp=$('spCount'); if(sp) sp.textContent=spCount;
  }
  if(Math.random()<0.5){
    const cands=DRIFT.filter(k=>stock[k]>1);
    if(cands.length){ const k=cands[(Math.random()*cands.length)|0]; stock[k]--; }
  }
}
setInterval(tickLive, 9000);

/* ---------------- 兑换倒计时滴答(每秒) ---------------- */
function tickRedeem(){
  if(!S.won.length) return;
  const home = $('screen-home') && $('screen-home').classList.contains('active');
  let expiredNow=false;
  document.querySelectorAll('[data-cd]').forEach(el=>{
    const k=el.dataset.cd, left=redeemLeft(k);
    if(left<=0) expiredNow=true; else el.textContent=`⏳ ${fmtDur(left)}`;
  });
  const big=document.querySelector('[data-cdall]');   // 顶部大倒数
  if(big){ const act=S.won.filter(k=>!isExpired(k)); if(act.length) big.textContent=fmtDur(Math.min.apply(null, act.map(k=>redeemLeft(k)))); }
  const b=S.bundle.length; S.bundle=S.bundle.filter(k=>!isExpired(k));
  if(expiredNow || S.bundle.length!==b){ save(); if(home){ renderWon(); renderBundle(); } }
}
setInterval(tickRedeem, 1000);

/* ---------------- 启动 ---------------- */
if(S.loggedIn) go(S.admin?'campaigns':'home'); else go('login');
updateCountdown();              // 立刻显示活动倒数(登入画面就看到)
setInterval(updateCountdown, 1000);   // 每秒滴答(登入画面 + 顶部条,和是否登入无关)
bootstrapServer();   // 拉取服务器共用配置(状态/权重/兑换码);连不上自动退回本机
