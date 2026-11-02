// 双11 拆红包:游戏页和后台共用
const KEYS = {x7k2:2, q4m9:4, z8p3:6};

// cost = 成本 RM;机率存在服务器,后台可改
const PRIZES = [
  {id:"rm50",     name:"RM50 现金回扣", short:"RM50 回扣", cost:0, fixed:true},
  {id:"wow1",     name:"WoW Care x1",   short:"WoW x1",  cost:2},
  {id:"sachet3",  name:"3包 MFormula",  short:"3包",     cost:2.7},
  {id:"sachet5",  name:"5包 MFormula",  short:"5包",     cost:4.5},
  {id:"sachet10", name:"10包 MFormula", short:"10包",    cost:9},
  {id:"wow2",     name:"WoW Care x2",   short:"WoW x2",  cost:4},
  {id:"wow5",     name:"WoW Care x5",   short:"WoW x5",  cost:10},
  {id:"wow10",    name:"WoW Care x10",  short:"WoW x10", cost:20},
  {id:"care_oolong", name:"CARE 茶香润滑油", short:"茶香润滑油", cost:16},
  {id:"care_aloe",   name:"CARE 芦荟润滑油", short:"芦荟润滑油", cost:16},
  {id:"kegel",    name:"凯戈尔训练器",    short:"训练器",  cost:30},
  {id:"box1",     name:"1盒 MFormula",  short:"1盒",     cost:38},
  {id:"box2",     name:"2盒 MFormula",  short:"2盒",     cost:76}
];

const ODDS_PRIZES = PRIZES.filter(p => !p.fixed);   // fixed = every customer's first packet, not part of the odds

function cleanPhone(v) {
  let d = String(v == null ? "" : v).replace(/\D/g, "").replace(/^00/, "");
  if (/^[3689]\d{7}$/.test(d)) return "65" + d;
  if (/^65[3689]\d{7}$/.test(d)) return d;
  if (d.startsWith("60")) d = "0" + d.slice(2).replace(/^0+/, "");
  else if (d.startsWith("1")) d = "0" + d;
  return /^01\d{8,9}$/.test(d) ? d : "";
}

function cleanName(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().replace(/^[=+\-@'"\s]+/, "").slice(0, 40);
}

async function post(url, body) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 25000);
  try {
    const r = await fetch(url, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), signal:stop.signal});
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const api = body => post("/api/d11", body);
const adminLogin = pass => post("/api/admin-login", {pass:String(pass).replace(/\D/g, "")});
