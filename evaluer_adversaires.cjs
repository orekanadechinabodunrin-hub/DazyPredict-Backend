'use strict';
const fs=require('node:fs'),path=require('node:path');
const base=require('./moteur_dazypredict'), next=require('./moteur_adversaires.cjs');
const source=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!source.complet)throw Error('Collecte incomplète');
const audit=next.preparerHistorique(source.matches,source.avant), rows=audit.matches;
const configurations=[5,10,20].flatMap(prior=>[180,365].map(demiVie=>({prior,demiVie})));
function metrics(rs,key){
 if(!rs.length)return {n:0};let brier=0,logLoss=0,correct=0;
 for(const r of rs){const p=r[key],mx=Math.max(...p);brier+=p.reduce((s,x,i)=>s+(x-Number(i===r.y))**2,0);logLoss-=Math.log(Math.max(1e-15,p[r.y]));correct+=Number(p.filter(x=>Math.abs(x-mx)<1e-12).length===1&&p.indexOf(mx)===r.y);}
 return {n:rs.length,brier:brier/rs.length,logLoss:logLoss/rs.length,accuracy:correct/rs.length};
}
function evaluer(debut,fin,configs){
 const out=[],all=[],groups=new Map();
 for(const r of rows.filter(r=>r.date>=debut&&r.date<fin)){const key=r.date+'|'+r.codeCompetition;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 let n=0;
 for(const group of groups.values()){
  const date=group[0].date,code=group[0].codeCompetition;
  const passe=rows.filter(r=>r.codeCompetition===code&&r.date<date);
  const models=configs.map(c=>next.entrainer(passe,code,date,c));
  for(const r of group){
   const old=base.calculerProbabilites(passe,r.domicile,r.exterieur,{dateReference:date,dateObservation:date,competition:r.championnat});
   if(!old.success)continue;
   if(old.historique.dernierResultat>=date)throw Error('Fuite temporelle baseline');
   const y=r.butsDomicile>r.butsExterieur?0:r.butsDomicile===r.butsExterieur?1:2;
   const item={date,code,y,baseline:Object.values(old.probabilitesPrecises)};
   all.push(item);
   const candidates=models.map(m=>next.predire(m,r.domicileId,r.exterieurId,r.terrainNeutre));
   if(candidates.some(r=>!r))continue;
   for(let i=0;i<candidates.length;i++){
    if(candidates[i].dernierResultat>=date)throw Error('Fuite temporelle candidat');
    item['c'+i]=candidates[i].p;
   }
   out.push(item);
  }
  if(++n%150===0)process.stderr.write(`${debut}: ${n}/${groups.size} journées-compétitions\n`);
 }
 return {paired:out,all};
}
function interval(rs,metric){
 // Bootstrap apparié par journée : les matchs du même jour restent dans le même bloc.
 const groups=new Map();for(const r of rs){
  const score=p=>metric==='brier'?p.reduce((s,x,i)=>s+(x-Number(i===r.y))**2,0):-Math.log(Math.max(1e-15,p[r.y]));
  if(!groups.has(r.date))groups.set(r.date,{sum:0,n:0});const g=groups.get(r.date);g.sum+=score(r.c0)-score(r.baseline);g.n++;
 }
 const gs=[...groups.values()];if(gs.length<10)return null;
 let seed=123456789;function rnd(){seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;}
 const diffs=[];for(let b=0;b<2000;b++){let total=0,n=0;for(let i=0;i<gs.length;i++){const g=gs[Math.floor(rnd()*gs.length)];total+=g.sum;n+=g.n;}diffs.push(total/n);}
 diffs.sort((a,b)=>a-b);return {de:diffs[50],a:diffs[1949],blocs:gs.length,iterations:2000};
}
const dev=evaluer('2025-01-01','2026-01-01',configurations);
const ranking=configurations.map((configuration,i)=>({configuration,...metrics(dev.paired,'c'+i)})).filter(r=>r.n>0).sort((a,b)=>a.logLoss-b.logLoss||a.brier-b.brier);
if(!ranking.length)throw Error('Aucune validation admissible');
const selection=ranking[0].configuration;
// Sélection figée avant toute lecture des métriques du holdout 2026.
const holdout=evaluer('2026-01-01',source.avant,[selection]);
const old=metrics(holdout.paired,'baseline'), candidate=metrics(holdout.paired,'c0');
const ci={brier:interval(holdout.paired,'brier'),logLoss:interval(holdout.paired,'logLoss')};
const parCompetition=[...new Set(rows.map(r=>r.codeCompetition))].map(code=>{
 const rs=holdout.paired.filter(r=>r.code===code);return {code,baseline:metrics(rs,'baseline'),candidat:metrics(rs,'c0'),baselineDisponible:holdout.all.filter(r=>r.code===code).length};
});
const gainGlobal=old.n>=1000&&candidate.brier<old.brier&&candidate.logLoss<old.logLoss&&ci.brier?.a<0&&ci.logLoss?.a<0;
const competitionsEligibles=parCompetition.filter(c=>gainGlobal&&c.candidat.n>=200&&c.candidat.brier<c.baseline.brier&&c.candidat.logLoss<c.baseline.logLoss).map(c=>c.code);
const report={version:1,avant:source.avant,empreinteDonnees:source.empreinteMatches,
 protocole:'Résultats à 90 min 2024 pour amorçage ; choix de 6 configurations sur 2025 (intersection commune), configuration figée puis test final 2026. Résultats du jour et futurs exclus. Pas de réglage sur le test final. Données rétrospectives récupérées aujourd’hui, pas archives horodatées avant match.',
 selection,validation:{comparaisons:ranking,baseline:metrics(dev.paired,'baseline'),baselineTous:metrics(dev.all,'baseline')},
 testFinal:{periode:{de:'2026-01-01',a:source.avant},baseline:old,candidat:candidate,baselineTous:metrics(holdout.all,'baseline'),intervallesDifferenceCandidatMoinsBaseline:ci,parCompetition},
 historique:{n:rows.length,invalides:audit.invalides,conflits:audit.conflits,du:rows[0]?.date,au:rows.at(-1)?.date},
 decision:{gainGlobal,competitionsEligibles,activationAutomatique:false,limites:'Validation rétrospective uniquement ; composition, blessures et xG absents ; pas de mesure de rentabilité. Les compétitions à moins de 200 prévisions appariées ne sont pas éligibles.'}};
fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));
fs.writeFileSync(path.join(path.dirname(process.argv[3]),'predictions-test.json'),JSON.stringify(holdout.paired));
console.log(JSON.stringify({selection,baseline:old,candidat:candidate,ci,decision:report.decision},null,2));
