const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {calculerPredictionRenforcee:predire}=require('./prediction_renforcee.cjs');
function scenario(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dazypredict-verification-'));
 const rows=Array.from({length:80},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),fixtureId:String(i+1),domicileId:i%2?'2':'1',exterieurId:i%2?'1':'2',domicile:i%2?'Beta':'Alpha',exterieur:i%2?'Alpha':'Beta',codeCompetition:'eng.1',championnat:'English Premier League',butsDomicile:i%2?0:3,butsExterieur:1,statut:'STATUS_FULL_TIME'}));
 const snapshot={version:1,complet:true,avant:'2025-04-01',matches:rows};
 fs.writeFileSync(path.join(dir,'historique_espn_verifie.json'),JSON.stringify(snapshot));
 const validation={configuration:{prior:20,demiVie:365},gainGlobal:true,competitionsEligibles:['eng.1'],empreinteFichier:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'historique_espn_verifie.json'))).digest('hex')};
 fs.writeFileSync(path.join(dir,'validation_adversaires.json'),JSON.stringify(validation));
 t.after(()=>{for(const f of ['historique_espn_verifie.json','validation_adversaires.json','historique_actif.json'])if(fs.existsSync(path.join(dir,f)))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);});
 return {dir,rows,validation,opt:{dateReference:'2025-04-02',competition:'English Premier League'},run(extra={}){return predire([],'Alpha','Beta',this.opt,{dossier:dir,aujourdhui:'2025-04-01',...extra});}};
}
test('history enrichment works without activating the candidate',t=>{
 const s=scenario(t),r=s.run();assert.equal(r.success,true);assert.equal(r.historiqueRenforce.charge,true);assert.equal(r.historiqueRenforce.adversairesActifs,false);assert.equal(r.versionMoteur,'poisson-audite-2');
});
test('candidate requires opt-in, validated data, compatible fixture and keeps Android response fields',t=>{
 const s=scenario(t),r=s.run({utiliserAdversaires:true});
 assert.equal(r.success,true);assert.equal(r.historiqueRenforce.adversairesActifs,true);assert.equal(r.versionMoteur,'poisson-adversaires-candidat-1');
 assert.equal(Object.values(r.probabilites).reduce((a,b)=>a+b),100);
 assert.ok(Math.abs(Object.values(r.probabilitesPrecises).reduce((a,b)=>a+b)-1)<1e-12);
 assert.ok(r.butsAttendus.domicile>0&&r.scoreLePlusProbable.probabilite>0&&r.probabilitesButs.plusDe25>=0);
 assert.ok(r.historique.dernierResultat<r.dateObservation);
});
test('modified manifest fingerprint prevents promotion',t=>{
 const s=scenario(t);s.validation.empreinteFichier='incorrect';fs.writeFileSync(path.join(s.dir,'validation_adversaires.json'),JSON.stringify(s.validation));
 const r=s.run({utiliserAdversaires:true});assert.equal(r.historiqueRenforce.adversairesActifs,false);assert.equal(r.versionMoteur,'poisson-audite-2');
});
test('unknown competition, missing snapshot and stale snapshot fall back safely',t=>{
 const s=scenario(t);s.opt.competition='Other league';assert.equal(s.run({utiliserAdversaires:true}).historiqueRenforce.charge,false);
 s.opt.competition='English Premier League';assert.equal(s.run({utiliserAdversaires:true,aujourdhui:'2025-04-12'}).historiqueRenforce.adversairesActifs,false);
 fs.unlinkSync(path.join(s.dir,'historique_espn_verifie.json'));assert.equal(s.run().historiqueRenforce.charge,false);
});
test('contradictory legacy results stay visible to deduplication rather than overwrite the snapshot',t=>{
 const s=scenario(t),legacy=[{...s.rows[0],butsDomicile:20}];
 const r=predire(legacy,'Alpha','Beta',s.opt,{dossier:s.dir,aujourdhui:'2025-04-01'});
 assert.equal(r.analyseDetaillee.qualiteHistorique.conflits,1);assert.equal(r.historique.matchsUtilises,79);
});
test('an invalid update pointer keeps the original predictions and approved dataset',t=>{
 const s=scenario(t),before=s.run({utiliserAdversaires:true});
 fs.writeFileSync(path.join(s.dir,'historique_actif.json'),JSON.stringify({version:1,avant:'2025-04-01',empreinte:'a'.repeat(64)}));
 const after=s.run({utiliserAdversaires:true});
 assert.equal(after.success,true);assert.deepEqual(after.probabilitesPrecises,before.probabilitesPrecises);
 assert.equal(after.historiqueRenforce.empreinte,before.historiqueRenforce.empreinte);assert.equal(after.historiqueRenforce.origineDonnees,'snapshot-initial');
 assert.ok(after.historiqueRenforce.motifActualisation);assert.equal(after.historiqueRenforce.adversairesActifs,true);
});
