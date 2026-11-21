const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {choixDonnees}=require('./donnees_valides.cjs');
function scenario(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dazypredict-bundle-'));const day='2026-01-01';
 const raw=JSON.stringify({version:1,complet:true,avant:day,matches:[]}),sha=crypto.createHash('sha256').update(raw).digest('hex');
 const sub=path.join(dir,'.historiques-valides',sha);fs.mkdirSync(sub,{recursive:true});
 fs.writeFileSync(path.join(sub,'historique_espn_verifie.json'),raw);
 const hashes={};for(const n of ['moteur_dazypredict.js','moteur_adversaires.cjs']){fs.writeFileSync(path.join(dir,n),'// math test\n');hashes[n]=crypto.createHash('sha256').update('// math test\n').digest('hex');}
 fs.writeFileSync(path.join(sub,'validation_adversaires.json'),JSON.stringify({version:1,gainGlobal:true,empreinteFichier:sha,empreintesCodeFormat:'utf8-lf-v1',empreintesCode:hashes,configuration:{prior:20,demiVie:365},competitionsEligibles:['eng.1']}));
 const pointer=path.join(dir,'historique_actif.json');fs.writeFileSync(pointer,JSON.stringify({version:1,avant:day,empreinte:sha}));
 // Les nettoyages restent dans le seul répertoire temporaire créé par ce test.
 t.after(()=>{const resolved=fs.realpathSync(dir);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('dazypredict-bundle-'));fs.rmSync(resolved,{recursive:true});});
 return {dir,sub,sha,pointer};
}
test('a complete matching bundle is chosen; original remains fallback without pointer',t=>{
 const s=scenario(t);assert.equal(choixDonnees(s.dir).dossier,fs.realpathSync(s.sub));fs.unlinkSync(s.pointer);assert.equal(choixDonnees(s.dir).dossier,fs.realpathSync(s.dir));
});
test('malformed, future and path traversal pointers never replace original',t=>{
 const s=scenario(t);
 for(const x of ['{',JSON.stringify({version:1,avant:'2099-01-01',empreinte:s.sha}),JSON.stringify({version:1,avant:'2026-01-01',empreinte:'../../other'})]){
  fs.writeFileSync(s.pointer,x);assert.equal(choixDonnees(s.dir).origine,'snapshot-initial');
 }
});
test('modified content, missing validation and mismatched validation are rejected',t=>{
 const s=scenario(t);assert.equal(choixDonnees(s.dir).origine,'bundle-verifie');
 const manifest=path.join(s.sub,'validation_adversaires.json');const original=fs.readFileSync(manifest,'utf8');
 fs.writeFileSync(manifest,original.replace(s.sha,'b'.repeat(64)));assert.equal(choixDonnees(s.dir).origine,'snapshot-initial');
 fs.writeFileSync(manifest,original);fs.appendFileSync(path.join(s.sub,'historique_espn_verifie.json'),' ');assert.equal(choixDonnees(s.dir).origine,'snapshot-initial');
 fs.unlinkSync(manifest);assert.equal(choixDonnees(s.dir).origine,'snapshot-initial');
});
test('changing the calculation code requires re-evaluation even with unchanged data',t=>{
 const s=scenario(t);assert.equal(choixDonnees(s.dir).origine,'bundle-verifie');
 fs.writeFileSync(path.join(s.dir,'moteur_dazypredict.js'),'// different math');assert.equal(choixDonnees(s.dir).origine,'snapshot-initial');
});
test('Windows/Linux line endings preserve calculation fingerprint',t=>{
 const s=scenario(t);assert.equal(choixDonnees(s.dir).origine,'bundle-verifie');
 fs.writeFileSync(path.join(s.dir,'moteur_dazypredict.js'),'// math test\r\n');assert.equal(choixDonnees(s.dir).origine,'bundle-verifie');
 const p=JSON.parse(fs.readFileSync(s.pointer));p.avant='2025-12-31';fs.writeFileSync(s.pointer,JSON.stringify(p));assert.equal(choixDonnees(s.dir).origine,'snapshot-initial');
});
