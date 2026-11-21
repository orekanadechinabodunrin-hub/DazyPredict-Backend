'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=require('./moteur_dazypredict'), moteur=require('./moteur_adversaires.cjs');
const {choixDonnees}=require('./donnees_valides.cjs');
const CODES=new Set(['eng.1','eng.2','esp.1','fra.1','ita.1','ger.1','ned.1','por.1','uefa.champions','caf.nations_qual','fifa.worldq.caf']);
let cache=null;
function lireSnapshot(dossier=__dirname){
 const choix=choixDonnees(dossier);
 const file=path.join(choix.dossier,'historique_espn_verifie.json'),stat=fs.statSync(file);
 if(stat.size>12*1024*1024)throw Error('Snapshot trop volumineux');
 if(cache?.file===file&&cache.mtime===stat.mtimeMs&&cache.size===stat.size)return {...cache,dossier:choix.dossier,origine:choix.origine,motifChoix:choix.motif};
 const raw=fs.readFileSync(file),data=JSON.parse(raw);
 if(data.version!==1||data.complet!==true||!moteur.dateValide(data.avant)||!Array.isArray(data.matches))throw Error('Snapshot non validé');
 if(data.matches.some(r=>!CODES.has(r.codeCompetition)))throw Error('Compétition non autorisée');
 cache={file,mtime:stat.mtimeMs,size:stat.size,data,dossier:choix.dossier,origine:choix.origine,motifChoix:choix.motif,sha256:crypto.createHash('sha256').update(raw).digest('hex')};return cache;
}
function arrondir(p){const x=p.map(v=>Math.floor(v*100)),order=p.map((v,i)=>({i,reste:v*100-x[i]})).sort((a,b)=>b.reste-a.reste);for(let i=0,n=100-x.reduce((a,b)=>a+b);i<n;i++)x[order[i%3].i]++;return x;}
function calculerPredictionRenforcee(legacy,domicile,exterieur,options={},runtime={}){
 const dossier=runtime.dossier||__dirname,aujourdhui=runtime.aujourdhui||new Date().toISOString().slice(0,10);
 if(!moteur.dateValide(options.dateReference)||!moteur.dateValide(aujourdhui))return base.calculerProbabilites(legacy,domicile,exterieur,options);
 const avant=options.dateReference<aujourdhui?options.dateReference:aujourdhui;
 let snapshot,rows,code;
 try{
  snapshot=lireSnapshot(dossier);
  if(snapshot.data.avant>aujourdhui)throw Error('Date du snapshot future');
  rows=moteur.preparerHistorique(snapshot.data.matches,avant).matches;
  const codes=new Set(rows.filter(r=>base.normaliserCompetition(r.championnat)===base.normaliserCompetition(options.competition)).map(r=>r.codeCompetition));
  if(codes.size!==1)throw Error('Compétition absente ou ambiguë dans le complément');
  code=[...codes][0];rows=rows.filter(r=>r.codeCompetition===code);
  // Aucun alias approximatif ou transfert implicite entre compétitions.
  if(!moteur.resoudreEquipe(rows,code,domicile)||!moteur.resoudreEquipe(rows,code,exterieur))throw Error('Identité équipe absente ou ambiguë dans le complément');
  const aliases=new Map();for(const r of rows)for(const role of ['domicile','exterieur']){const k=base.normaliserNomEquipe(r[role]);if(!aliases.has(k))aliases.set(k,new Set());aliases.get(k).add(r[role+'Id']);}
  rows=rows.filter(r=>aliases.get(base.normaliserNomEquipe(r.domicile)).size===1&&aliases.get(base.normaliserNomEquipe(r.exterieur)).size===1);
 }catch(e){return {...base.calculerProbabilites(legacy,domicile,exterieur,options),historiqueRenforce:{charge:false,motif:e.code==='ENOENT'?'Snapshot absent':e.message}};}
 // Conserver les contradictions pour que le moteur les rejette, au lieu d'écraser avec Map.set.
 const reference=base.calculerProbabilites([...legacy,...rows],domicile,exterieur,{...options,dateObservation:avant});
 const age=Math.max(0,(Date.parse(aujourdhui)-Date.parse(snapshot.data.avant))/86400000);
 const meta={charge:true,source:'ESPN',resultatsAjoutes:rows.length,avant:snapshot.data.avant,recupereLe:snapshot.data.recupereLe,ageSnapshotJours:age,empreinte:snapshot.sha256,adversairesActifs:false,origineDonnees:snapshot.origine,...(snapshot.motifChoix?{motifActualisation:snapshot.motifChoix}:{})};
 if(!reference.success||runtime.utiliserAdversaires!==true||age>7)return {...reference,historiqueRenforce:meta};
 let validation;
 try{validation=JSON.parse(fs.readFileSync(path.join(snapshot.dossier,'validation_adversaires.json'),'utf8'));}catch{return {...reference,historiqueRenforce:{...meta,motif:'Validation du candidat absente'}};}
 if(validation.empreinteFichier!==snapshot.sha256||validation.gainGlobal!==true||!validation.competitionsEligibles?.includes(code)||
  ![5,10,20].includes(validation.configuration?.prior)||![180,365].includes(validation.configuration?.demiVie))
  return {...reference,historiqueRenforce:{...meta,motif:'Compétition, paramètres ou données non validés pour le candidat'}};
 const fit=moteur.entrainer(rows,code,avant,validation.configuration);
 const hid=moteur.resoudreEquipe(rows,code,domicile),aid=moteur.resoudreEquipe(rows,code,exterieur);
 // Un terrain neutre ne doit pas être inventé à partir du simple ordre domicile/extérieur.
 // La route actuelle ne fournit pas de terrain vérifié : candidat réservé aux ligues nationales éligibles.
 const result=moteur.predire(fit,hid,aid,false);
 if(!result)return {...reference,historiqueRenforce:{...meta,motif:'Historique équipe insuffisant pour le candidat'}};
 const [h,n,a]=arrondir(result.p),hs=fit.ts.get(hid),as=fit.ts.get(aid);
 const jours=d=>Math.max(0,Math.floor((Date.parse(avant)-Date.parse(d))/86400000));
 const ageEquipes=Math.max(jours(hs.last),jours(as.last));
 return {...reference,versionMoteur:result.version,source:'Historique ESPN vérifié de la compétition',
  methode:'Poisson attaque/défense ajusté aux adversaires, domicile/extérieur ; lissage et récence. Données équipe tous terrains.',
  matchsDomicileAnalyses:hs.n,matchsExterieurAnalyses:as.n,
  historique:{matchsUtilises:fit.matchs,dernierResultat:fit.dernierResultat,joursDepuisDernierResultat:jours(fit.dernierResultat),dernierMatchDomicile:hs.last,dernierMatchExterieur:as.last,ageDonneesEquipes:ageEquipes,couvertureDonnees:ageEquipes>30||Math.min(hs.n,as.n)<10?'limitée':'moyenne',demiVieJours:fit.config.demiVie},
  moyennes:{butsMarquesDomicile:hs.gf/hs.poids,butsEncaissesDomicile:hs.ga/hs.poids,butsMarquesExterieur:as.gf/as.poids,butsEncaissesExterieur:as.ga/as.poids},
  probabilites:{victoireDomicile:h,matchNul:n,victoireExterieure:a},probabilitesPrecises:{victoireDomicile:result.p[0],matchNul:result.p[1],victoireExterieure:result.p[2]},
  butsAttendus:result.butsAttendus,scoreLePlusProbable:{...result.scores[0],probabilite:100*result.scores[0].probabilite},
  probabilitesButs:{plusDe15:Math.round(100*result.plus15),plusDe25:Math.round(100*result.plus25),plusDe35:Math.round(100*result.plus35),deuxEquipesMarquent:Math.round(100*result.deuxMarquent)},
  analyseDetaillee:{...reference.analyseDetaillee,scoresPrincipaux:result.scores.map(s=>({...s,probabilite:100*s.probabilite})),forceAdversaires:result.force,
   doubleChance:{domicileOuNul:100*(result.p[0]+result.p[1]),domicileOuExterieur:100*(result.p[0]+result.p[2]),nulOuExterieur:100*(result.p[1]+result.p[2])},
   incertitudeNormalisee:-result.p.reduce((s,p)=>s+p*Math.log(p),0)/Math.log(3),note:'La forme récente est descriptive. L’ajustement aux adversaires est déjà inclus dans les probabilités.'},
  historiqueRenforce:{...meta,adversairesActifs:true},avertissement:'Candidat évalué rétrospectivement ; compositions, blessures et xG non intégrés. Aucune garantie sur une rencontre.'};
}
module.exports={lireSnapshot,calculerPredictionRenforcee};
