const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(require.resolve('./server.js'),'utf8');
const start=text.indexOf('app.get("/api/autonome/predict"');
const end=text.indexOf('// SERVEUR',start);
const route=text.slice(start,text.lastIndexOf('// ========================================',end));
async function appeler({local,calendrier,legacyError=false,query={domicile:'Alpha',exterieur:'Beta',date:'2026-11-21',competition:'English Premier League'}}){
 let handler,network=0,calls=0,body,status=200;
 vm.runInNewContext(route,{app:{get:(_,fn)=>handler=fn},Date,console:{warn(){},error(){}},process:{env:{}},
  adversairesAutorises:()=>false,
  chargerMatchsHistoriques(){if(legacyError)throw Error('source initiale illisible');return [];},
  calculerPredictionRenforcee(){calls++;return local;},
  async obtenirCalendrierActualise(){network++;if(calendrier instanceof Error)throw calendrier;return calendrier;}});
 await handler({query},{status(n){status=n;return this;},json(r){body=r;return this;}});
 return {body,status,network,calls};
}
test('fresh local snapshot serves an analysis without a calendar network dependency',async()=>{
 const r=await appeler({local:{success:true,historiqueRenforce:{charge:true,ageSnapshotJours:0}},calendrier:new Error('réseau hors ligne')});
 assert.equal(r.body.success,true);assert.equal(r.network,0);assert.equal(r.body.modeCalendrier,'historique-verifie');
});
test('calendar outage preserves an admissible local prediction',async()=>{
 const r=await appeler({local:{success:true,historiqueRenforce:{charge:false}},calendrier:new Error('réseau hors ligne')});
 assert.equal(r.body.success,true);assert.equal(r.network,1);assert.equal(r.body.modeCalendrier,'historique-local-secours');
});
test('corrupt legacy input does not hide a fresh verified snapshot',async()=>{
 const r=await appeler({legacyError:true,local:{success:true,historiqueRenforce:{charge:true,ageSnapshotJours:0}},calendrier:new Error('hors ligne')});
 assert.equal(r.body.success,true);assert.equal(r.network,0);
});

test('invalid dates never silently become today and do not load a calendar',async()=>{
 for(const date of ['demain','2026-02-30','2026-11-31','', ['2026-11-21','2026-11-22']]){
  const r=await appeler({local:{success:true},query:{domicile:'Alpha',exterieur:'Beta',date}});
  assert.equal(r.status,400);assert.equal(r.body.success,false);assert.equal(r.network,0);assert.equal(r.calls,0);
 }
});
test('malformed teams or competition fail explicitly before prediction',async()=>{
 for(const query of [{domicile:' ',exterieur:'Beta'},{domicile:['A','B'],exterieur:'Beta'},{domicile:'A'.repeat(161),exterieur:'Beta'},{domicile:'Alpha',exterieur:'Beta',competition:['x','y']}]){
  const r=await appeler({local:{success:true},query});assert.equal(r.status,400);assert.equal(r.network,0);assert.equal(r.calls,0);
 }
});
test('omitted date remains compatible and leap day is accepted',async()=>{
 for(const date of [undefined,'2024-02-29']){
  const r=await appeler({local:{success:true,historiqueRenforce:{charge:true,ageSnapshotJours:0}},query:{domicile:'Alpha',exterieur:'Beta',date}});
  assert.equal(r.status,200);assert.equal(r.calls,1);
 }
});
