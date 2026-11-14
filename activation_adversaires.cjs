'use strict';
const fs=require('node:fs'),path=require('node:path');
function adversairesAutorises(env=process.env,dossier=__dirname){
 // La variable serveur est prioritaire, y compris "0" pour couper immédiatement.
 if(env.DAZYPREDICT_MODELE_ADVERSAIRES!==undefined)return env.DAZYPREDICT_MODELE_ADVERSAIRES==='1';
 try{const r=JSON.parse(fs.readFileSync(path.join(dossier,'activation_adversaires.json'),'utf8'));return r.activer===true&&r.version==='poisson-adversaires-candidat-1';}catch{return false;}
}
module.exports={adversairesAutorises};
