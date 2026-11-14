'use strict';
// Candidat local : Poisson attaque/défense ajusté aux adversaires. Aucune activation automatique.
const {normaliserNomEquipe}=require('./moteur_dazypredict');
function dateValide(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function preparerHistorique(rows,avant){
 if(!dateValide(avant))throw Error('Date invalide');
 const groups=new Map(), identities=new Map();let invalides=0,horsPeriode=0;
 for(const r of Array.isArray(rows)?rows:[]){
  if(!r||!dateValide(r.date)||!r.codeCompetition||!/^[1-9]\d*$/.test(r.fixtureId)||!/^[1-9]\d*$/.test(r.domicileId)||!/^[1-9]\d*$/.test(r.exterieurId)||
   r.domicileId===r.exterieurId||!r.domicile?.trim()||!r.exterieur?.trim()||r.statut!=='STATUS_FULL_TIME'||
   ![r.butsDomicile,r.butsExterieur].every(x=>Number.isInteger(x)&&x>=0&&x<=20)){invalides++;continue;}
  if(r.date>=avant){horsPeriode++;continue;}
  const id=r.codeCompetition+'|'+r.fixtureId, ident=[r.codeCompetition,r.date,r.domicileId,r.exterieurId].join('|');
  if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);
  if(!identities.has(ident))identities.set(ident,[]);identities.get(ident).push(r);
 }
 const bad=new Set(), signature=r=>[r.date,r.domicileId,r.exterieurId,r.butsDomicile,r.butsExterieur,!!r.terrainNeutre].join('|');
 for(const g of [...groups.values(),...identities.values()])if(new Set(g.map(signature)).size>1)for(const r of g)bad.add(r);
 const seen=new Set(), matches=[];
 for(const g of groups.values())for(const r of g){const k=[r.codeCompetition,r.date,r.domicileId,r.exterieurId].join('|');if(!bad.has(r)&&!seen.has(k)){seen.add(k);matches.push(r);}}
 return {matches:matches.sort((a,b)=>a.date.localeCompare(b.date)||a.fixtureId.localeCompare(b.fixtureId)),invalides,horsPeriode,conflits:bad.size};
}
function distribution(home,away){
 if(![home,away].every(x=>Number.isFinite(x)&&x>0&&x<=6))return null;
 function poisson(l){const a=[Math.exp(-l)];for(let i=1;i<=20;i++)a.push(a[i-1]*l/i);return a;}
 const h=poisson(home),a=poisson(away),p=[0,0,0],scores=[];let over15=0,over25=0,over35=0,btts=0,total=0;
 for(let i=0;i<=20;i++)for(let j=0;j<=20;j++){const v=h[i]*a[j];total+=v;p[i>j?0:i===j?1:2]+=v;if(i+j>=2)over15+=v;if(i+j>=3)over25+=v;if(i+j>=4)over35+=v;if(i&&j)btts+=v;scores.push({domicile:i,exterieur:j,probabilite:v});}
 return {p:p.map(x=>x/total),scores:scores.sort((x,y)=>y.probabilite-x.probabilite).slice(0,3).map(s=>({...s,probabilite:s.probabilite/total})),plus15:over15/total,plus25:over25/total,plus35:over35/total,deuxMarquent:btts/total};
}
function entrainer(rows,code,avant,config={prior:10,demiVie:180}){
 if(!dateValide(avant)||!Number.isFinite(config.prior)||config.prior<=0||!Number.isFinite(config.demiVie)||config.demiVie<=0)throw Error('Configuration invalide');
 const time=Date.parse(avant),ts=new Map();let wh=0,gh=0,ga=0;
 const matchs=rows.filter(r=>r.codeCompetition===code&&r.date<avant&&(time-Date.parse(r.date))/86400000<=730).map(r=>{
  const w=Math.exp(-Math.log(2)*(time-Date.parse(r.date))/86400000/config.demiVie);wh+=w;gh+=w*r.butsDomicile;ga+=w*r.butsExterieur;
  for(const [id,gf,gc,role] of [[r.domicileId,r.butsDomicile,r.butsExterieur,0],[r.exterieurId,r.butsExterieur,r.butsDomicile,1]]){
   if(!ts.has(id))ts.set(id,{a:0,d:0,gf:0,ga:0,n:0,roles:[0,0],last:'',poids:0});const t=ts.get(id);t.gf+=w*gf;t.ga+=w*gc;t.n++;t.roles[role]++;t.poids+=w;t.last=r.date>t.last?r.date:t.last;
  }return {...r,w};
 });
 if(matchs.length<40)return null;
 const baseH=Math.max(.1,gh/wh),baseA=Math.max(.1,ga/wh),prior=config.prior*(baseH+baseA)/2;
 for(let iteration=0;iteration<35;iteration++){
  const exp=new Map([...ts.keys()].map(id=>[id,{gf:0,ga:0}]));
  for(const r of matchs){const h=ts.get(r.domicileId),a=ts.get(r.exterieurId),neutral=(baseH+baseA)/2;
   const lh=(r.terrainNeutre?neutral:baseH)*Math.exp(h.a+a.d),la=(r.terrainNeutre?neutral:baseA)*Math.exp(a.a+h.d);
   exp.get(r.domicileId).gf+=r.w*lh;exp.get(r.domicileId).ga+=r.w*la;exp.get(r.exterieurId).gf+=r.w*la;exp.get(r.exterieurId).ga+=r.w*lh;
  }
  for(const [id,t]of ts){const e=exp.get(id);t.a=clamp(t.a+.4*Math.log((t.gf+prior)/(e.gf+prior)),-1.5,1.5);t.d=clamp(t.d+.4*Math.log((t.ga+prior)/(e.ga+prior)),-1.5,1.5);}
 }
 return {ts,baseH,baseA,avant,code,config,dernierResultat:matchs.reduce((s,r)=>r.date>s?r.date:s,''),matchs:matchs.length};
}
function predire(modele,homeId,awayId,terrainNeutre=false){
 if(!modele||homeId===awayId)return null;
 const h=modele.ts.get(homeId),a=modele.ts.get(awayId);
 if(!h||!a||Math.min(h.n,a.n)<5||h.poids<2||a.poids<2)return null;
 // Une équipe inactive depuis plus de 180 jours n'est pas présentée comme bien documentée.
 if([h,a].some(t=>(Date.parse(modele.avant)-Date.parse(t.last))/86400000>180))return null;
 const neutral=(modele.baseH+modele.baseA)/2;
 const lh=clamp((terrainNeutre?neutral:modele.baseH)*Math.exp(h.a+a.d),.15,4.5);
 const la=clamp((terrainNeutre?neutral:modele.baseA)*Math.exp(a.a+h.d),.15,4.5);
 return {version:'poisson-adversaires-candidat-1',...distribution(lh,la),butsAttendus:{domicile:lh,exterieur:la},
  force:{domicile:{attaque:Math.exp(h.a),fragiliteDefensive:Math.exp(h.d),matchs:h.n},exterieur:{attaque:Math.exp(a.a),fragiliteDefensive:Math.exp(a.d),matchs:a.n}},
  dernierResultat:modele.dernierResultat,dateObservation:modele.avant};
}
function resoudreEquipe(rows,code,nom){
 const n=normaliserNomEquipe(nom),ids=new Set();if(!n)return null;
 for(const r of rows.filter(r=>r.codeCompetition===code)){if(normaliserNomEquipe(r.domicile)===n)ids.add(r.domicileId);if(normaliserNomEquipe(r.exterieur)===n)ids.add(r.exterieurId);}
 return ids.size===1?[...ids][0]:null;
}
module.exports={dateValide,preparerHistorique,distribution,entrainer,predire,resoudreEquipe};
