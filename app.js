/* ============================================================
   MFormula · Member Day — 大转盘抽奖 (原型 demo)
   抽大转盘赢免费好礼 → 选配套 → 一键 WhatsApp 找客服下单。
   纯前端 + localStorage 模拟。真实上线需 Backend(防作弊/记账/兑换核销),见 README。
   ============================================================ */

const CONFIG = {
  WHATSAPP: '60173628890',   // 客服 WhatsApp(国际格式 60+号码,去掉开头0)= 0173628890
  ADMIN: { name:'Liew', phone:'0173628890' },   // ← 这个名字+电话登入 = 超级权限(改成只有你知道的)
  DAY_DRAWS: [5,1,1,1,1,1,3],// 每天的抽奖次数:第1天5次 · 第2–6天各1次 · 第7天3次
  SHARE_BONUS: 2,           // 分享 → +抽奖次数
  ORDER_BONUS: 3,           // 下单 → +抽奖次数
  SPIN_MS: 4000,            // 转盘旋转时长
  REDEEM_MS: 24*60*60*1000, // 抽中好礼的兑换有效期:24 小时,过期失效
};
const drawsForDay = d => CONFIG.DAY_DRAWS[Math.min(Math.max(d|0,1),7)-1] || 1;

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

/* ---------------- 兑换码(送额外抽奖次数) ---------------- */
const DEFAULT_PROMO = { 'MEMBERDAY':5, 'MFORMULA':3, 'LIEW888':10 };
function loadPromo(){ try{ const p=JSON.parse(localStorage.getItem('mf_promo')); if(p&&typeof p==='object') return {...DEFAULT_PROMO, ...p}; }catch(e){} return {...DEFAULT_PROMO}; }
function savePromo(){ localStorage.setItem('mf_promo', JSON.stringify(promoCodes)); }
let promoCodes = loadPromo();
const ADMIN_LB = [
  {name:'Ah Kao***',n:9},{name:'Mei***',n:8},{name:'Kumar***',n:8},{name:'Siti***',n:7},
  {name:'Wei***',n:6},{name:'Jun***',n:6},{name:'Lim***',n:5},{name:'Raj***',n:4},
];

/* ---------------- 状态 ---------------- */
let S = load();
function load(){
  const def = { name:'', phone:'', loggedIn:false, admin:false, day:1, chances:drawsForDay(1),
                won:[], wonAt:{}, bundle:[], pickPkg:'2box', codes:{}, sharedToday:false, usedCodes:[] };
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
  $('phone').classList.toggle('bare', name==='login');
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('screen-'+name).classList.add('active');
  $('main').scrollTop=0;
  if(name==='home') renderHome();
  if(name==='help') renderHelp();
  if(name==='admin') renderAdmin();
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
  $('endCountdown').textContent = 8 - S.day;
  const sp=$('spCount'); if(sp) sp.textContent = spCount;
}

/* ---------------- 大厅 ---------------- */
function renderHome(){
  renderTop();
  $('shareBar').textContent = S.sharedToday ? '✓ 已分享' : `📲 分享 +${CONFIG.SHARE_BONUS}次`;
  $('shareBar').disabled = S.sharedToday;
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
}
function applyActivityState(){
  const st = ACT_STATES[actStatus] || ACT_STATES.running;
  const banner = $('actBanner'), btn = $('spinBtn');
  if(banner){
    if(isRunning()){ banner.style.display='none'; }
    else{ banner.style.display='flex'; banner.className=`act-banner ${st.tone}`;
      banner.innerHTML = `<span class="ab-emoji">${st.emoji}</span><span class="ab-txt"><b>${st.label}</b><small>${st.msg||''}</small></span>`; }
  }
  if(btn){
    btn.disabled = !isRunning();
    btn.innerHTML = isRunning()
      ? `🎡 抽奖!（还有 <b id="drawsLeft">${S.chances}</b> 次）`
      : `${st.emoji} ${st.label}`;
  }
}
function statusModal(){ const st=ACT_STATES[actStatus]||ACT_STATES.running; modal(st.emoji, st.label, st.msg||'请稍后再来 🙏', [{label:'知道了'}]); }

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
function spin(){
  if(spinning) return;
  if(!isRunning()){ statusModal(); return; }
  if(S.chances<=0){ noChanceModal(); return; }
  spinning=true; S.chances--; save(); renderTop(); setDrawsLeft();
  const idx = weightedPick();
  const landing = (360 - (idx*SEG + SEG/2));           // 让该格中心转到顶部指针
  const cur = ((wheelRot % 360) + 360) % 360;
  wheelRot += 360*5 + ((landing - cur + 360) % 360);   // 至少 5 圈再停
  const wheel=$('wheel');
  wheel.style.transition=`transform ${CONFIG.SPIN_MS}ms cubic-bezier(.16,.84,.28,1)`;
  wheel.style.transform=`rotate(${wheelRot}deg)`;
  setTimeout(()=>{ spinning=false; award(idx); }, CONFIG.SPIN_MS+80);
}
$('spinBtn') && $('spinBtn').addEventListener('click', spin);

function award(idx){
  const p=WHEEL[idx];
  if(S.won.includes(p.key)){          // 已有 → 送一次重抽,不空手
    S.chances++; save(); renderTop(); setDrawsLeft();
    modal('🎁',`又抽中 ${pv(p).label}`,`你已经有这个啦,送你 <b>再抽一次</b> 🔄`,[{label:'再抽'}]); return;
  }
  S.won.push(p.key);
  S.wonAt[p.key] = Date.now();   // 开始 24 小时兑换倒计时
  if(stock[p.key]>0) stock[p.key]--;
  autoPick(p.key); save(); renderHome();
  const im=wonImg(p.key);
  const img = im ? `<img src="assets/${im}" alt="" onerror="this.replaceWith(document.createTextNode('${p.emoji}'))">` : p.emoji;
  const scales = JSON.stringify(p.a)!==JSON.stringify(p.b);
  modalRaw(
    `<div class="m-glow"></div>
     <div class="m-kicker" style="color:#4A9C8E">🎉 恭喜抽中</div>
     <div class="m-emoji">${img}</div>
     <div class="m-name">${pv(p).label}</div>
     <div class="m-pill ${p.type==='ultra'?'d-legend':'d-easy'}">${p.type==='ultra'?'🏆 传说大奖 · 太幸运了!':(scales?'已放进我的好礼 · 选 4 盒翻倍 ⬆️':'已放进我的好礼')}</div>
     <div class="m-redeem">⏳ 请在 <b>24 小时内</b>联系客服兑换,过期失效</div>`,
    [{label: S.chances>0?'再抽一次 →':'去搭配下单', action:()=>{}},
     {label:'看我的好礼', sub:true, action:()=>{ const el=$('wonHead'); if(el) el.scrollIntoView({behavior:'smooth'}); }}]);
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
  $('wonHead').innerHTML = `🎁 我赢到的好礼 <span class="lh-pill">下单可带 ${S.bundle.length}/${lim} 件</span>`;
  if(!S.won.length){ $('wonGrid').innerHTML = `<div class="won-empty">还没抽到 —— 转一下大转盘试试手气 🎡</div>`; return; }
  $('wonGrid').innerHTML = S.won.map(k=>{
    const p=byKey(k); const exp=isExpired(k); const picked=S.bundle.includes(k); const im=wonImg(k);
    const img = im ? `<img src="assets/${im}" alt="" onerror="this.replaceWith(document.createTextNode('${p.emoji}'))">` : p.emoji;
    const cd = exp ? `<div class="rwc-cd expired">⌛ 已失效</div>`
                   : `<div class="rwc-cd" data-cd="${k}">⏳ ${fmtDur(redeemLeft(k))} 内兑换</div>`;
    const stateTxt = exp ? '已过 24 小时' : (picked?'✓ 已带上':'＋ 点一下带上');
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
function autoPick(key){    // 抽中后静默带上(满了/独占冲突就不带)
  if(S.bundle.includes(key)) return;
  if(isUltra(key)){ S.bundle=[key]; return; }
  if(S.bundle.find(isUltra)) return;
  if(S.bundle.length < prizeLimit()) S.bundle.push(key);
}
function trimBundle(){     // 换配套后收紧
  const u=S.bundle.find(isUltra);
  if(u){ S.bundle=[u]; return; }
  if(S.bundle.length>prizeLimit()) S.bundle=S.bundle.slice(0,prizeLimit());
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

/* ---------------- 续命:分享/下单/兑换码 ---------------- */
function noChanceModal(){
  const btns=[];
  if(!S.sharedToday) btns.push({label:`📲 分享 +${CONFIG.SHARE_BONUS}次`, action:doShare});
  btns.push({label:`🎁 输入兑换码`, action:codeModal});
  btns.push({label:`🛒 去下单（+${CONFIG.ORDER_BONUS}次）`, action:()=>go('home')});
  btns.push({label:'关闭', sub:true});
  modal('⚡','抽奖次数用完?别等明天!', `分享 <b>+${CONFIG.SHARE_BONUS}</b> 次、输入兑换码、或下单 <b>+${CONFIG.ORDER_BONUS}</b> 次 —— 马上继续抽。`, btns);
}
function doShare(){
  if(S.sharedToday){ toastModal('今天已经分享过啦,明天再 +次 🙂'); return; }
  S.sharedToday=true; S.chances+=CONFIG.SHARE_BONUS; save(); renderTop();
  modal('🎉',`分享成功 · +${CONFIG.SHARE_BONUS}次!`,`抽奖次数到账,继续转大转盘!<br><span style="font-size:11px;color:#7d8893">(真实版分享到 WhatsApp,后台核实后到账)</span>`,
    [{label:'去抽奖', action:()=>go('home')}]);
}
function grantOrderBonus(){ S.chances+=CONFIG.ORDER_BONUS; save(); renderTop(); }

/* ---------------- 兑换码 ---------------- */
function codeModal(){
  modalRaw(`<div class="m-emoji">🎁</div><div class="m-name">输入兑换码</div>
    <div class="m-text">有活动兑换码?输入立刻 +抽奖次数</div>
    <input id="codeInput" class="m-input" placeholder="例如 MEMBERDAY" autocapitalize="characters" autocomplete="off">`,
    [{label:'兑换', action:()=>redeemCode($('codeInput')&&$('codeInput').value)},{label:'关闭', sub:true}]);
}
function redeemCode(raw){
  const code=(raw||'').trim().toUpperCase();
  if(!code){ toastModal('请输入兑换码'); return; }
  if(!(code in promoCodes)){ toastModal('兑换码无效 🙈'); return; }
  if(S.usedCodes.includes(code)){ toastModal('这个码你已经用过啦 🙂'); return; }
  S.usedCodes.push(code); S.chances += promoCodes[code]; save(); renderTop();
  modal('🎁', `+${promoCodes[code]} 次抽奖!`, `兑换码 <b>${code}</b> 已生效,继续转大转盘!`, [{label:'去抽奖', action:()=>go('home')}]);
}

/* ---------------- 下单 / WhatsApp ---------------- */
$('waBtn') && $('waBtn').addEventListener('click', ()=>{
  const hadN=S.bundle.length; pruneExpired();           // 下单前再核一次:踢掉刚过期的好礼
  if(S.bundle.length!==hadN){ renderHome(); toastModal('部分好礼已过 24 小时失效,已帮你移除,确认后再下单 🙂'); return; }
  const pkg=curPkg(); const pr=price();
  const sig = pkg.key+'|'+S.bundle.slice().sort().join(',');
  const code = genCode(sig, pkg.key);
  const rewardsTxt = S.bundle.length
    ? S.bundle.map(k=>`   • ${wonLabel(k)}`).join('\n')
    : '   • (不带好礼,直接下单)';
  const payTxt = pr.free ? 'RM0 — 免单 🎉' : `RM${pr.final}${pr.disc?`（已减 RM${pr.disc}）`:''}`;
  const msg =
`你好 MFormula 客服 👋 我要参加 Member Day 下单！
━━━━━━━━━━
👤 会员：${S.name}（${S.phone}）
📦 配套：${pkg.name} — 原价 RM${pkg.price}
🎁 抽中带上（${S.bundle.length}）：
${rewardsTxt}
💰 应付：${payTxt}
🧾 兑换码：${code}
━━━━━━━━━━
请帮我确认订单,谢谢！(兑换码一次性有效 · 活动 1/7–7/7)`;
  const url = `https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(msg)}`;
  modalRaw(
    `<div class="m-name" style="font-size:18px">确认下单</div>
     <div class="m-text" style="margin-top:5px">复制兑换码,发送给客服即可完成</div>
     <div class="m-code-box"><div class="cap">一次性兑换码</div><div class="m-code">${code}</div></div>
     <div class="m-text" style="text-align:left;margin-top:16px;font-weight:700;color:#5b6b73">消息预览</div>
     <div class="wa-bubble">${msg.replace(/</g,'&lt;')}</div>`,
    [{label:'📲 前往 WhatsApp 发送', action:()=>{ window.open(url,'_blank'); grantOrderBonus();
        setTimeout(()=>modal('🎉','订单已发给客服!', `额外 <b>+${CONFIG.ORDER_BONUS}</b> 次抽奖到账 🎉`, [{label:'继续抽', action:()=>go('home')}]), 400); }},
     {label:'返回继续搭配', sub:true}]);
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
function renderAdmin(){
  renderTop();
  const unlocked=spCount, contacted=Math.round(spCount*0.42), active=spCount+27;
  const stats=`<div class="adm-stats">
    <div class="adm-stat"><div class="n">${unlocked}</div><div class="l">抽奖参与人数</div></div>
    <div class="adm-stat"><div class="n">${contacted}</div><div class="l">联系客服下单</div></div>
    <div class="adm-stat"><div class="n">${active}</div><div class="l">今日活跃</div></div></div>`;
  const lb=`<div class="adm-card"><div class="adm-h">🏆 谁最强(中奖最多)</div>${ADMIN_LB.map((p,i)=>`<div class="adm-lb"><span class="r ${i<3?'top':''}">${i+1}</span><span class="nm">${p.name}</span><span class="v">中奖 ${p.n} 件</span></div>`).join('')}</div>`;
  const list=Object.entries(promoCodes).map(([c,n])=>`<div class="code-row"><span class="cc">${c}</span><span class="cn">+${n} 次</span><button class="code-del" data-delcode="${c}">✕</button></div>`).join('');
  const codes=`<div class="adm-card"><div class="adm-h">🎁 兑换码(送抽奖次数)</div>
    ${list||'<div class="adm-empty">还没有码</div>'}
    <div class="code-add"><input id="newCode" placeholder="新码 如 BONUS10" autocapitalize="characters"><input id="newCodeN" type="number" inputmode="numeric" placeholder="次数" min="1" max="99"><button id="addCodeBtn">+ 添加</button></div>
    <div class="adm-note">内置码所有 user 都能用;你这里加的码是 demo(只存本机)。真实共享码需 Backend。</div></div>`;
  const totalW = WHEEL.reduce((s,p)=>s+(weights[p.key]||0),0);
  const wlist = WHEEL.map(p=>{ const w=weights[p.key]||0; const pct=totalW>0?(w/totalW*100):0; const nm=p.sa===p.sb?p.sa:`${p.sa}/${p.sb}`;
    return `<div class="w-row"><span class="wn">${p.emoji} ${nm}</span><input class="w-in" type="number" min="0" step="0.5" value="${w}" data-wkey="${p.key}"><span class="wp">${pct.toFixed(1)}%</span></div>`; }).join('');
  const weightsCard = `<div class="adm-card"><div class="adm-h">🎲 转盘中奖概率(改数字 → 实时生效)</div>${wlist}<div class="adm-note">数字 = 中奖权重,越大越容易中。<b>0 = 永不中</b>(如 999 金)。右边 % 是相对概率。</div></div>`;
  const cur = ACT_STATES[actStatus] || ACT_STATES.running;
  const stOpts = [['running','▶️ 进行中'],['paused','⏸ 暂停活动'],['updating','🔧 更新中'],['ended','🏁 结束活动'],['closed','🔒 关闭活动']];
  const actCard = `<div class="adm-card act-card"><div class="adm-h">🎛 活动控制</div>
    <div class="act-cur ${cur.tone}">当前状态:<b>${cur.emoji} ${cur.label}</b></div>
    <div class="act-btns">${stOpts.map(([k,lbl])=>`<button class="act-set ${actStatus===k?'on':''}" data-act="${k}">${lbl}</button>`).join('')}</div>
    <div class="adm-note">非「进行中」时,用户会看到对应提示且不能抽奖(已抽中的好礼仍可在 24 小时内兑换)。<b>demo 只存本机</b>;要对所有 user 同时生效需 Backend。</div></div>`;
  $('adminBody').innerHTML=`<div class="adm-note top">⚠️ 下面人数/排行是 <b>demo 模拟数据</b>。真实跨用户统计需接 Backend(我可帮你做)。</div>${actCard}${stats}${lb}${weightsCard}${codes}<button class="ghost" id="admLogout">退出登录</button>`;
  const add=$('addCodeBtn'); if(add) add.onclick=()=>{
    const c=($('newCode').value||'').trim().toUpperCase(), n=parseInt($('newCodeN').value,10);
    if(!c||!(n>0)){ toastModal('填写码和次数 🙂'); return; }
    promoCodes[c]=n; savePromo(); renderAdmin();
  };
  $('adminBody').querySelectorAll('[data-delcode]').forEach(b=>b.onclick=()=>{ delete promoCodes[b.dataset.delcode]; savePromo(); renderAdmin(); });
  $('adminBody').querySelectorAll('[data-wkey]').forEach(inp=>{ inp.onchange=()=>{ const v=parseFloat(inp.value); weights[inp.dataset.wkey]=(isFinite(v)&&v>=0)?v:0; saveWeights(); renderAdmin(); }; });
  $('adminBody').querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{ actStatus=b.dataset.act; saveStatus(); renderAdmin(); });
  const lo=$('admLogout'); if(lo) lo.onclick=logout;
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
    <div class="help-h">抽奖次数(每天不同)</div>
    <div class="help-p"><b>第 1 天 5 次</b> · 第 2–6 天每天 1 次 · <b>第 7 天 3 次</b>。用完别等 —— <b>分享 +${CONFIG.SHARE_BONUS}</b>、<b>输入兑换码</b>、<b>下单 +${CONFIG.ORDER_BONUS}</b> 立刻继续。</div>
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
  S.day++; S.chances=drawsForDay(S.day); S.sharedToday=false; save();
  go('home');
  modal('☀️',`进入 Day ${S.day}`,`今天的抽奖次数:<b>${drawsForDay(S.day)}</b> 次。<br>继续转大转盘赢好礼!`,[{label:'去抽奖'}]);
};

/* ---------------- 登入 / 登出 ---------------- */
$('loginBtn').onclick=()=>{
  const name=$('loginName').value.trim(), phone=$('loginPhone').value.trim();
  if(!name){ toastModal('请填写你的名字 🙂'); return; }
  if(!/^[0-9+\-\s]{7,}$/.test(phone)){ toastModal('电话号码好像不太对,检查一下 🙂'); return; }
  S.name=name; S.phone=phone; S.loggedIn=true;
  S.admin = (name.toLowerCase()===CONFIG.ADMIN.name.toLowerCase() && phone.replace(/\D/g,'')===CONFIG.ADMIN.phone.replace(/\D/g,''));
  save();
  go(S.admin?'admin':'home');
};
$('shareBar').onclick=doShare;
function logout(){
  modal('🔓','退出登录?','回到登入页,可换名字/电话重新登入(本机进度会清空,方便换人测试)。',
    [{label:'退出登录', action:()=>{ localStorage.removeItem('mfmemberday'); S=load(); if($('loginName'))$('loginName').value=''; if($('loginPhone'))$('loginPhone').value=''; go('login'); }},
     {label:'取消', sub:true}]);
}
$('logoutBtn').onclick=logout;

/* ---------------- 实时感:社会证明 + 库存被抢 ---------------- */
function tickLive(){
  spCount += 1 + (Math.random()<0.3 ? 1 : 0);
  const sp=$('spCount'); if(sp) sp.textContent=spCount;
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
    if(left<=0) expiredNow=true; else el.textContent=`⏳ ${fmtDur(left)} 内兑换`;
  });
  const b=S.bundle.length; S.bundle=S.bundle.filter(k=>!isExpired(k));
  if(expiredNow || S.bundle.length!==b){ save(); if(home){ renderWon(); renderBundle(); } }
}
setInterval(tickRedeem, 1000);

/* ---------------- 启动 ---------------- */
if(S.loggedIn) go(S.admin?'admin':'home'); else go('login');
