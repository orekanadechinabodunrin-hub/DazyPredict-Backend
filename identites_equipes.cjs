'use strict';
const registre=require('./alias_equipes_verifies.json');
const {normaliserNomEquipe}=require('./moteur_dazypredict');
const cle=s=>typeof s==='string'?s.trim().toLocaleLowerCase('fr').replace(/\s+/g,' '):'';
const nomsDeclares=new Set(registre.flatMap(r=>r.aliases.map(cle)));
const aliasDeclare=nom=>nomsDeclares.has(cle(nom));
function resoudreAliasVerifie(rows,code,nom,aliases=registre){
 if(!cle(nom)||!code)return null;
 const ligue=rows.filter(r=>r.codeCompetition===code);
 const ids=(name)=>new Set(ligue.flatMap(r=>['domicile','exterieur'].filter(role=>normaliserNomEquipe(r[role])===normaliserNomEquipe(name)).map(role=>r[role+'Id'])));
 // Une identité déjà connue ou ambiguë n'est jamais remplacée par une autre.
 if(ids(nom).size)return null;
 const matches=aliases.filter(r=>r.code===code&&r.aliases.some(a=>cle(a)===cle(nom)));
 if(matches.length!==1)return null;
 const r=matches[0],targets=ids(r.canonique);
 if(targets.size!==1||!targets.has(r.id))return null;
 return {id:r.id,nom:r.canonique,alias:nom,verifieLe:r.verifieLe};
}
module.exports={resoudreAliasVerifie,aliasDeclare};
