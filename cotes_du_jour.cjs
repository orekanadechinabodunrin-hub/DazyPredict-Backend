'use strict';
const MINUTE=60000;
function jourLocal(ms,zone){
 const p=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
 const val=t=>p.find(x=>x.type===t).value;return `${val('year')}-${val('month')}-${val('day')}`;
}
function fenetreValide(q,now){
 if(!q||typeof q.jour!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(q.jour)||typeof q.fuseau!=='string'||q.fuseau.length>80)throw Error('Jour ou fuseau invalide');
 const parse=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)?Date.parse(s):NaN;
 const a=parse(q.debut),b=parse(q.fin);
 if(!Number.isFinite(a)||!Number.isFinite(b)||b-a<22*3600000||b-a>26*3600000)throw Error('Fenêtre quotidienne invalide');
 if(jourLocal(now,q.fuseau)!==q.jour||jourLocal(a,q.fuseau)!==q.jour||jourLocal(a-1,q.fuseau)===q.jour||jourLocal(b-1,q.fuseau)!==q.jour||jourLocal(b,q.fuseau)===q.jour)throw Error('Le flux est limité au jour local courant');
 return {jour:q.jour,fuseau:q.fuseau,debut:new Date(a).toISOString(),fin:new Date(b).toISOString(),a,b};
}
function filtrerCotes(rows,w,now){
 if(!Array.isArray(rows)||rows.length>5000)throw Error('Réponse fournisseur non exploitable');
 const diag={recus:rows.length,horsJour:0,commences:0,sansCote:0,ambigus:0};const valides=[];
 for(const r of rows){
  const t=Date.parse(r?.commence_time);
  if(!Number.isFinite(t)||t<w.a||t>=w.b){diag.horsJour++;continue;}
  if(t<=now||r.is_live!==false||!['scheduled','not_started','upcoming'].includes(r.status)){diag.commences++;continue;}
  if(r.sport_key!=='soccer'||typeof r.id!=='string'||!r.id||r.id.length>512||typeof r.home_team!=='string'||typeof r.away_team!=='string'||!r.home_team.trim()||r.home_team===r.away_team||!/^[-a-z0-9_]+$/.test(r.league?.key||'')){diag.sansCote++;continue;}
  const books=(Array.isArray(r.bookmakers)?r.bookmakers:[]).filter(b=>b.key==='1xbet');
  const markets=books.length===1?(books[0].markets||[]).filter(m=>m.key==='h2h'&&(!m.period||m.period==='full')):[];
  if(markets.length!==1){diag.sansCote++;continue;}
  const m=markets[0],stamp=Date.parse(m.last_update||books[0].last_update),names=[r.home_team,'Draw',r.away_team],os=m.outcomes;
  if(!Number.isFinite(stamp)||stamp>now+MINUTE||now-stamp>15*MINUTE||!Array.isArray(os)||os.length!==3||names.some(n=>os.filter(o=>o.name===n&&typeof o.price==='number'&&Number.isFinite(o.price)&&o.price>1&&o.price<=1000).length!==1)){diag.sansCote++;continue;}
  valides.push({...r,bookmakers:[{...books[0],markets:[m]}]});
 }
 const bad=new Set();
 for(const key of [r=>r.id,r=>[r.league.key,r.commence_time,r.home_team,r.away_team].join('|')]){
  const g=new Map();for(const r of valides){const k=key(r);if(!g.has(k))g.set(k,[]);g.get(k).push(r);}
  for(const groupe of g.values())if(new Set(groupe.map(r=>JSON.stringify(r))).size>1)for(const r of groupe)bad.add(r);
 }
 diag.ambigus=bad.size;const seen=new Set();const donnees=valides.filter(r=>!bad.has(r)&&!seen.has(r.id)&&seen.add(r.id));
 return {donnees,diagnostic:diag};
}
function creerControleur({get,key,now=Date.now}){
 const cache=new Map(),pending=new Map();const ttl=2*MINUTE;
 return async function(req,res){
  let w;try{w=fenetreValide(req.query,now());}catch{return res.status(400).json({success:false,message:'Préciser les bornes exactes du jour local courant et un fuseau valide.'});}
  const secret=key();if(!secret)return res.status(503).json({success:false,message:'Source des cotes non configurée.'});
  const k=w.debut+'|'+w.fin,stamp=now();
  let item=cache.get(k);
  if(!item||item.expire<=stamp){
   if(!pending.has(k))pending.set(k,(async()=>{
    try {
     const r=await get('https://oddslink.app/v1/sports/soccer/odds',{params:{markets:'h2h',periods:'full',bookmakers:'1xbet',oddsFormat:'decimal',dateFormat:'iso',commenceTimeFrom:w.debut,commenceTimeTo:w.fin},headers:{'X-API-Key':secret,Accept:'application/json'},timeout:30000,maxContentLength:12*1024*1024});
     if(!Array.isArray(r.data))throw Error('Format fournisseur invalide');
     return {status:200,rows:r.data,verifieLe:new Date(now()).toISOString(),expire:now()+ttl};
    }catch(e){return {status:e.response?.status===429?429:502,message:e.response?.status===429?'Quota de la source atteint ; réessayer plus tard.':'Source des cotes temporairement indisponible.',expire:now()+ttl};}
   })());
   try{item=await pending.get(k);cache.set(k,item);if(cache.size>8)cache.delete(cache.keys().next().value);}finally{pending.delete(k);}
  }
  if(item.status!==200)return res.status(item.status).json({success:false,message:item.message});
  try{
   const r=filtrerCotes(item.rows,w,now());
   return res.json({success:true,source:'OddsLink',perimetre:'football-jour-v1',oddsFormat:'decimal',jour:w.jour,fuseau:w.fuseau,debut:w.debut,fin:w.fin,verifieLe:item.verifieLe,nombreMatchs:r.donnees.length,...r});
  }catch{return res.status(502).json({success:false,message:'Réponse fournisseur non exploitable ; aucun prix estimé.'});}
 };
}
function installerCotesDuJour(app,axios,key){app.get('/api/oddslink/odds-day',creerControleur({get:axios.get.bind(axios),key}));}
module.exports={jourLocal,fenetreValide,filtrerCotes,creerControleur,installerCotesDuJour};
