'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cache=new Map();
function verifierBundle(dossier,p){
  const initial=fs.realpathSync(dossier);
  if(p.version!==1||!/^\d{4}-\d{2}-\d{2}$/.test(p.avant)||p.avant>new Date().toISOString().slice(0,10)||! /^[a-f0-9]{64}$/.test(p.empreinte))throw Error('Pointeur non admissible');
  if(new Date(p.avant+'T00:00:00Z').toISOString().slice(0,10)!==p.avant)throw Error('Date non admissible');
  const parent=path.join(initial,'.historiques-valides'),dir=path.join(parent,p.empreinte);
  if(fs.lstatSync(parent).isSymbolicLink()||fs.lstatSync(dir).isSymbolicLink()||fs.realpathSync(dir)!==dir)throw Error('Chemin de données refusé');
  const file=path.join(dir,'historique_espn_verifie.json'),manifest=path.join(dir,'validation_adversaires.json');
  if(fs.lstatSync(file).isSymbolicLink()||fs.lstatSync(manifest).isSymbolicLink())throw Error('Fichier de données refusé');
  const s=fs.statSync(file,{bigint:true}),v=fs.statSync(manifest,{bigint:true});
  if(s.size>12n*1024n*1024n||v.size>65536n)throw Error('Données trop volumineuses');
  const maths=['moteur_dazypredict.js','moteur_adversaires.cjs'];
  const codeStats=maths.map(n=>{const f=path.join(initial,n);if(fs.lstatSync(f).isSymbolicLink())throw Error('Code non admissible');const t=fs.statSync(f,{bigint:true});return [t.mtimeNs,t.ctimeNs,t.size].join(':');});
  const key=[dir,p.avant,s.mtimeNs,s.ctimeNs,s.size,v.mtimeNs,v.ctimeNs,v.size,...codeStats].join('|');
  if(!cache.has(key)){
   const raw=fs.readFileSync(file),data=JSON.parse(raw),validation=JSON.parse(fs.readFileSync(manifest,'utf8'));
   const sha=crypto.createHash('sha256').update(raw).digest('hex');
   if(sha!==p.empreinte||data.version!==1||data.complet!==true||data.avant!==p.avant||!Array.isArray(data.matches)||validation.version!==1||validation.empreinteFichier!==sha||validation.gainGlobal!==true||
      !Array.isArray(validation.competitionsEligibles)||!validation.competitionsEligibles.length||![5,10,20].includes(validation.configuration?.prior)||![180,365].includes(validation.configuration?.demiVie))throw Error('Bundle non validé');
   if(validation.empreintesCodeFormat!=='utf8-lf-v1')throw Error('Empreinte de code non documentée');
   for(const name of maths){const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(initial,name),'utf8').replace(/\r\n/g,'\n'),'utf8').digest('hex');if(validation.empreintesCode?.[name]!==hash)throw Error('Mathématiques non réévaluées');}
   if(cache.size>=20)cache.delete(cache.keys().next().value);cache.set(key,true);
  }
  return {dossier:dir,origine:'bundle-verifie'};
}
function choixDonnees(dossier){
 const initial=fs.realpathSync(dossier),fallback=motif=>({dossier:initial,origine:'snapshot-initial',...(motif?{motif}: {})});
 const pointer=path.join(initial,'historique_actif.json');
 if(!fs.existsSync(pointer))return fallback();
 try{
  if(fs.lstatSync(pointer).isSymbolicLink()||fs.statSync(pointer).size>8192)throw Error('Pointeur invalide');
  return verifierBundle(initial,JSON.parse(fs.readFileSync(pointer,'utf8')));
 }catch{return fallback('Actualisation non valide : snapshot initial conservé');}
}
module.exports={choixDonnees,verifierBundle};
