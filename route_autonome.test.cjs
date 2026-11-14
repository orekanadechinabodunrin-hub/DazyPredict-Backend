const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(require.resolve('./server.js'),'utf8');
const start=text.indexOf('app.get("/api/autonome/predict"');
const end=text.indexOf('// SERVEUR',start);
const route=text.slice(start,text.lastIndexOf('// ========================================',end));
async function appeler({local,calendrier,legacyError=false}){
 let handler,network=0,calls=0,body,status=200;
 vm.runInNewContext(route,{app:{get:(_,fn)=>handler=fn},Date,console:{warn(){},error(){}},process:{env:{}},
  adversairesAutorises:()=>false,
  chargerMatchsHistoriques(){if(legacyError)throw Error('source initiale illisible');return [];},
  calculerPredictionRenforcee(){calls++;return local;},
  async obtenirCalendrierActualise(){network++;if(calendrier instanceof Error)throw calendrier;return calendrier;}});
 await handler({query:{domicile:'Alpha',exterieur:'Beta',date:'2026-11-21',competition:'English Premier League'}},{status(n){status=n;return this;},json(r){body=r;return this;}});
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
