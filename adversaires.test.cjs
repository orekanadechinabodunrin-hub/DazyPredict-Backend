const test=require('node:test'),assert=require('node:assert/strict');
const m=require('./moteur_adversaires.cjs');
function row(i,h='1',a='2',sh=2,sa=1){return {date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),fixtureId:String(i+1),domicileId:h,exterieurId:a,domicile:'Equipe '+h,exterieur:'Equipe '+a,codeCompetition:'eng.1',championnat:'English Premier League',butsDomicile:sh,butsExterieur:sa,statut:'STATUS_FULL_TIME',terrainNeutre:false};}
const data=()=>Array.from({length:80},(_,i)=>row(i,i%2?'2':'1',i%2?'1':'2',i%2?0:3,1));
test('strict dates, completed regulation scores and unique identities',()=>{
 const r=row(0),other={...r,fixtureId:'999',butsDomicile:4};
 assert.equal(m.preparerHistorique([r,r],'2025-05-01').matches.length,1);
 assert.equal(m.preparerHistorique([r,other],'2025-05-01').matches.length,0);
 assert.equal(m.preparerHistorique([r,{...r,exterieurId:'3'}],'2025-05-01').matches.length,0);
 assert.equal(m.preparerHistorique([{...r,date:'2025-02-30'},{...r,butsDomicile:null},{...r,statut:'STATUS_FINAL_PEN'}],'2025-05-01').matches.length,0);
 assert.throws(()=>m.preparerHistorique([],'2025-02-30'));
});
test('future and same-day outcomes cannot affect fitting',()=>{
 const xs=data(),avant='2025-04-01',f={...row(99),date:avant,butsDomicile:20};
 const a=m.predire(m.entrainer(xs,'eng.1',avant),'1','2');
 const b=m.predire(m.entrainer([...xs,f,{...f,date:'2026-01-01'}],'eng.1',avant),'1','2');
 assert.deepEqual(a,b);assert.ok(a.dernierResultat<avant);
});
test('stronger team remains favoured when venue changes, with no arbitrary name matching',()=>{
 const fit=m.entrainer(data(),'eng.1','2025-04-01');
 const h=m.predire(fit,'1','2'),a=m.predire(fit,'2','1');
 assert.ok(h.p[0]>h.p[2]);assert.ok(a.p[2]>a.p[0]);
 assert.equal(m.predire(fit,'1','99'),null);assert.equal(m.predire(fit,'1','1'),null);
 assert.equal(m.resoudreEquipe([...data(),{...row(79,'9','3'),domicile:'Equipe 1'}],'eng.1','Equipe 1'),null);
});
test('one goal distribution supplies coherent outcomes and goal markets',()=>{
 const d=m.distribution(1.7,.8);
 assert.ok(Math.abs(d.p.reduce((a,b)=>a+b)-1)<1e-12);
 assert.ok(d.plus15>d.plus25&&d.plus25>d.plus35);
 assert.ok(d.deuxMarquent>=0&&d.deuxMarquent<=1);
 assert.ok(d.scores.reduce((s,r)=>s+r.probabilite,0)<1);
 assert.equal(m.distribution(NaN,1),null);assert.equal(m.distribution(1,-1),null);
 const n=m.predire(m.entrainer(data(),'eng.1','2025-04-01'),'1','2',true);
 const r=m.predire(m.entrainer(data(),'eng.1','2025-04-01'),'2','1',true);
 assert.ok(Math.abs(n.p[0]-r.p[2])<1e-12);
});
test('sparse, stale and unrelated competitions abstain',()=>{
 assert.equal(m.entrainer(data(),'caf.nations_qual','2025-04-01'),null);
 assert.equal(m.entrainer(data().slice(0,5),'eng.1','2025-04-01'),null);
 assert.equal(m.predire(m.entrainer(data(),'eng.1','2026-02-01'),'1','2'),null);
});
