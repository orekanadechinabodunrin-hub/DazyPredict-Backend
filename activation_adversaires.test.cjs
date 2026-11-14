const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {adversairesAutorises:a}=require('./activation_adversaires.cjs');
test('explicit release activation can be overridden by server environment',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dazypredict-activation-')),file=path.join(dir,'activation_adversaires.json');
 t.after(()=>{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);});
 assert.equal(a({},dir),false);
 fs.writeFileSync(file,JSON.stringify({activer:true,version:'poisson-adversaires-candidat-1'}));
 assert.equal(a({},dir),true);assert.equal(a({DAZYPREDICT_MODELE_ADVERSAIRES:'0'},dir),false);
 assert.equal(a({DAZYPREDICT_MODELE_ADVERSAIRES:'1'},dir),true);
 fs.writeFileSync(file,'corrupt');assert.equal(a({},dir),false);
});
