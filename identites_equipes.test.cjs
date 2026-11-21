const test=require('node:test'),assert=require('node:assert/strict');
const {resoudreAliasVerifie}=require('./identites_equipes.cjs');
const aliases=[{code:'ned.1',id:'147',canonique:'NEC Nijmegen',aliases:['NEC'],verifieLe:'2026-11-21'}];
const rows=[{codeCompetition:'ned.1',domicile:'NEC Nijmegen',exterieur:'PSV Eindhoven',domicileId:'147',exterieurId:'148'}];
test('alias exact requires the verified team ID in the same competition',()=>{
 assert.equal(resoudreAliasVerifie(rows,'ned.1',' NEC ',aliases).id,'147');
 for(const [rs,c,n] of [[rows,'eng.1','NEC'],[rows,'ned.1','NEC U19'],[rows,'ned.1','Nijmegen'],[[],'ned.1','NEC'],[rows,'ned.1','NEC Nijmegen']])assert.equal(resoudreAliasVerifie(rs,c,n,aliases),null);
 assert.equal(resoudreAliasVerifie(rows.map(r=>({...r,domicileId:'999'})),'ned.1','NEC',aliases),null);
});
test('conflicting aliases and collisions with an existing identity are refused',()=>{
 assert.equal(resoudreAliasVerifie(rows,'ned.1','NEC',[...aliases,...aliases]),null);
 assert.equal(resoudreAliasVerifie([...rows,{...rows[0],domicile:'NEC',domicileId:'999'}],'ned.1','NEC',aliases),null);
 assert.equal(resoudreAliasVerifie([...rows,{...rows[0],domicileId:'999'}],'ned.1','NEC',aliases),null);
});
test('every shipped alias is unique within its league and has explicit provenance',()=>{
 const registry=require('./alias_equipes_verifies.json'),seen=new Set();
 for(const r of registry){assert.match(r.id,/^[1-9]\d*$/);assert.equal(r.verifieLe,'2026-11-21');assert.ok(r.sources.length>=2);for(const a of r.aliases){const k=r.code+'|'+a.trim().toLowerCase();assert.ok(!seen.has(k));seen.add(k);}}
});
test('alias changes identification only, preserves caller names and every market probability',t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dazypredict-alias-'));
 t.after(()=>{for(const f of ['historique_espn_verifie.json','validation_adversaires.json'])fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);});
 const matches=Array.from({length:80},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),fixtureId:String(i+1),domicileId:i%2?'148':'147',exterieurId:i%2?'147':'148',domicile:i%2?'PSV Eindhoven':'NEC Nijmegen',exterieur:i%2?'NEC Nijmegen':'PSV Eindhoven',codeCompetition:'ned.1',championnat:'Netherlands Eredivisie',butsDomicile:2,butsExterieur:1,statut:'STATUS_FULL_TIME'}));
 const raw=JSON.stringify({version:1,complet:true,avant:'2025-04-01',matches});
 fs.writeFileSync(path.join(dir,'historique_espn_verifie.json'),raw);
 fs.writeFileSync(path.join(dir,'validation_adversaires.json'),JSON.stringify({configuration:{prior:20,demiVie:365},gainGlobal:true,competitionsEligibles:['ned.1'],empreinteFichier:crypto.createHash('sha256').update(raw).digest('hex')}));
 const predict=require('./prediction_renforcee.cjs').calculerPredictionRenforcee;
 const options={dateReference:'2025-04-02',competition:'Netherlands Eredivisie'},runtime={dossier:dir,aujourdhui:'2025-04-01',utiliserAdversaires:true};
 const a=predict([],'NEC Nijmegen','PSV Eindhoven',options,runtime),b=predict([],'NEC','PSV',options,runtime);
 assert.equal(a.success,true);assert.equal(b.success,true);assert.equal(b.equipeDomicile,'NEC');assert.equal(b.equipeExterieure,'PSV');
 assert.equal(b.identitesEquipes.domicile.id,'147');assert.equal(b.identitesEquipes.exterieur.id,'148');
 for(const key of ['probabilitesPrecises','probabilitesButs','butsAttendus','scoreLePlusProbable'])assert.deepEqual(b[key],a[key]);
 assert.equal(predict([],'NEC U19','PSV',options,runtime).success,false);
});
