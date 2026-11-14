const test = require('node:test');
const assert = require('node:assert/strict');
const {calculerProbabilites: predict} = require('./moteur_dazypredict');
const opt = {dateReference:'2025-06-01',dateObservation:'2025-04-01',competition:'English Premier League'};
function data() { return Array.from({length:60},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),domicile:'Alpha FC',exterieur:'Beta FC',butsDomicile:i%3,butsExterieur:i%2,championnat:'English Premier League 2024/25'})); }
const result = (xs=data(),o=opt) => predict(xs,'Alpha','Beta',o);
test('probabilities and exact score summaries are coherent',()=>{
 const r=result();assert.equal(r.success,true);
 const ps=Object.values(r.probabilitesPrecises);assert.ok(Math.abs(ps.reduce((a,b)=>a+b)-1)<1e-12);
 assert.equal(Object.values(r.probabilites).reduce((a,b)=>a+b),100);
 assert.equal(r.analyseDetaillee.scoresPrincipaux.length,3);
 assert.ok(r.analyseDetaillee.scoresPrincipaux.every((s,i,a)=>s.probabilite>0 && (i===0||a[i-1].probabilite>=s.probabilite)));
 assert.ok(Math.abs(r.analyseDetaillee.doubleChance.domicileOuNul/100-(ps[0]+ps[1]))<1e-12);
 assert.equal(r.analyseDetaillee.formeDomicile.matchs,5);
 assert.equal(r.analyseDetaillee.formeDomicile.pointsPossibles,15);
});
test('future results cannot change a forecast at the observation cutoff',()=>{
 const future={...data()[0],date:'2025-05-01',butsDomicile:20,butsExterieur:0};
 assert.deepEqual(result([...data(),future]).probabilitesPrecises,result().probabilitesPrecises);
 assert.equal(result([...data(),future]).historique.matchsUtilises,60);
});
test('duplicate rows do not increase sample size or alter prediction',()=>{
 const r=result([...data(),...data()]);assert.equal(r.historique.matchsUtilises,60);
 assert.equal(r.analyseDetaillee.qualiteHistorique.doublons,60);
 assert.deepEqual(r.probabilitesPrecises,result().probabilitesPrecises);
});
test('conflicting score duplicates are excluded regardless of order',()=>{
 const rows=data();const bad={...rows[0],butsDomicile:20};
 const a=result([...rows,bad]),b=result([bad,...rows]);
 assert.equal(a.historique.matchsUtilises,59);assert.equal(a.analyseDetaillee.qualiteHistorique.conflits,1);
 assert.deepEqual(a.probabilitesPrecises,b.probabilitesPrecises);
});
test('invalid dates and scores are excluded',()=>{
 const base=data()[0];const invalid=[{...base,date:'2025-02-30'},{...base,date:'2025-03-01',butsDomicile:''},{...base,date:'2025-03-02',butsDomicile:null},{...base,date:'2025-03-03',butsDomicile:1.5}];
 const r=result([...data(),...invalid]);assert.equal(r.historique.matchsUtilises,60);assert.equal(r.analyseDetaillee.qualiteHistorique.invalides,4);
});
test('unknown or unrelated competitions do not contaminate target league',()=>{
 const others=data().map(m=>({...m,championnat:''}));
 const r=result([...data(),...others]);assert.equal(r.historique.matchsUtilises,60);assert.equal(r.analyseDetaillee.qualiteHistorique.autreCompetition,60);
});
test('zero scoring league remains finite',()=>{
 const r=result(data().map(m=>({...m,butsDomicile:0,butsExterieur:0})));
 assert.ok(r.success);assert.ok(Object.values(r.probabilitesPrecises).every(Number.isFinite));
});
test('absence of team evidence is explicit',()=>{
 assert.equal(predict(data(),'Unknown','Beta',opt).success,false);
});
test('the date of the fixture remains separate from observation date',()=>{
 const a=result(),b=result(data(),{...opt,dateReference:'2025-07-01'});
 assert.deepEqual(a.probabilitesPrecises,b.probabilitesPrecises);
 assert.equal(a.dateReference,'2025-06-01');assert.equal(a.dateObservation,'2025-04-01');
});
test('invalid reference dates and self fixtures are rejected',()=>{
 assert.equal(result(data(),{...opt,dateReference:'2025-02-30'}).success,false);
 assert.equal(predict(data(),'Alpha','Alpha',opt).success,false);
});
test('team freshness cannot be hidden by other teams recent games',()=>{
 const recent=Array.from({length:10},(_,i)=>({...data()[0],date:'2025-03-'+String(i+20).padStart(2,'0'),domicile:'Other',exterieur:'Others'}));
 const r=result([...data(),...recent]);assert.equal(r.historique.couvertureDonnees,'limitée');
 assert.ok(r.historique.ageDonneesEquipes>30);
});
