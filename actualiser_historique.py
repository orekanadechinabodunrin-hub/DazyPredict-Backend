"""Prépare un bundle évalué. --activer remplace seulement son pointeur atomique."""
import argparse,datetime,hashlib,json,pathlib,re,subprocess,sys
from collecter_historique import COMPETITIONS

MATHS=('moteur_dazypredict.js','moteur_adversaires.cjs')
def sha(file):return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
def sha_code(file):return hashlib.sha256(pathlib.Path(file).read_bytes().replace(b'\r\n',b'\n')).hexdigest()
def lire(file):return json.loads(pathlib.Path(file).read_text(encoding='utf-8'))
def jour(d):
    return isinstance(d,str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}',d)) and datetime.date.fromisoformat(d).isoformat()==d
def verifier_snapshot(data,ancien):
    if data.get('version')!=1 or data.get('complet') is not True or data.get('erreurs') or data.get('conflitsExclus',0)!=0:raise ValueError('Collecte incomplète ou contradictoire')
    if not jour(data.get('avant')) or data['avant']>datetime.datetime.now(datetime.timezone.utc).date().isoformat():raise ValueError('Date de collecte invalide')
    if data['avant']<ancien['avant']:raise ValueError('Régression de date')
    rows=data.get('matches');ids={};identites=set()
    if not isinstance(rows,list) or not rows:raise ValueError('Historique vide')
    for r in rows:
        if r.get('codeCompetition') not in COMPETITIONS or not jour(r.get('date')) or r['date']>=data['avant'] or r.get('statut')!='STATUS_FULL_TIME':raise ValueError('Résultat hors périmètre')
        if any(not isinstance(r.get(k),str) or not re.fullmatch('[1-9][0-9]*',r[k]) for k in ('fixtureId','domicileId','exterieurId')) or r['domicileId']==r['exterieurId']:raise ValueError('Identité invalide')
        if any(type(r.get(k)) is not int or not 0<=r[k]<=20 for k in ('butsDomicile','butsExterieur')):raise ValueError('Score invalide')
        key=(r['codeCompetition'],r['fixtureId']);identite=(r['codeCompetition'],r['date'],r['domicileId'],r['exterieurId'])
        if key in ids or identite in identites:raise ValueError('Doublon de fixture')
        ids[key]=r;identites.add(identite)
    def signature(r):return tuple(r[k] for k in ('date','domicileId','exterieurId','butsDomicile','butsExterieur'))+(bool(r.get('terrainNeutre')),)
    for r in ancien['matches']:
        current=ids.get((r['codeCompetition'],r['fixtureId']))
        if current is None or signature(current)!=signature(r):raise ValueError('Ancien résultat absent ou corrigé : revue nécessaire')
    digest=hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
    if data.get('empreinteMatches')!=digest:raise ValueError('Empreinte des résultats incorrecte')
    return len(rows)-len(ancien['matches'])

def verifier_evaluation(data,rapport,obligatoires):
    if rapport.get('avant')!=data['avant'] or rapport.get('empreinteDonnees')!=data['empreinteMatches'] or rapport.get('historique',{}).get('n')!=len(data['matches']):raise ValueError('Évaluation non liée aux données')
    final=rapport['testFinal'];base=final['baseline'];candidat=final['candidat'];decision=rapport['decision']
    if not 1000<=candidat['n']<=len(data['matches']) or candidat['n']!=base['n'] or not (0<=candidat['brier']<base['brier']<=2) or not (0<=candidat['logLoss']<base['logLoss']):raise ValueError('Gain global non confirmé')
    for m in ('brier','logLoss'):
        ci=final['intervallesDifferenceCandidatMoinsBaseline'][m]
        if ci is None or not ci['de']<=ci['a']<0 or ci['blocs']<10:raise ValueError('Incertitude du gain trop forte')
    codes=decision['competitionsEligibles']
    if decision.get('gainGlobal') is not True or not set(obligatoires).issubset(codes) or not set(codes).issubset(COMPETITIONS):raise ValueError('Perte de couverture validée')
    for code in codes:
        r=next(x for x in final['parCompetition'] if x['code']==code)
        if r['candidat']['n']<200 or r['candidat']['brier']>=r['baseline']['brier'] or r['candidat']['logLoss']>=r['baseline']['logLoss']:raise ValueError('Compétition non validée')
    c=rapport['selection']
    if c.get('prior') not in (5,10,20) or c.get('demiVie') not in (180,365):raise ValueError('Configuration non admissible')
    return c,codes

def preparer_bundle(racine,snapshot,evaluation,ancien,obligatoires):
    racine=pathlib.Path(racine).resolve();snapshot=pathlib.Path(snapshot).resolve();data=lire(snapshot);rapport=lire(evaluation)
    ajout=verifier_snapshot(data,ancien);config,codes=verifier_evaluation(data,rapport,obligatoires)
    empreinte=sha(snapshot);parent=racine/'.historiques-valides'
    if parent.is_symlink():raise ValueError('Répertoire de bundles non admissible')
    parent.mkdir(exist_ok=True);bundle=parent/empreinte
    if bundle.is_symlink() or bundle.resolve().parent!=parent.resolve():raise ValueError('Chemin de bundle non admissible')
    bundle.mkdir(exist_ok=True)
    manifest={'version':1,'configuration':config,'empreinteFichier':empreinte,'empreintesCodeFormat':'utf8-lf-v1','empreintesCode':{k:sha_code(racine/k) for k in MATHS},'gainGlobal':True,'competitionsEligibles':codes,'dateEvaluation':data['avant'],'activationAutomatique':False}
    contenu={'historique_espn_verifie.json':snapshot.read_bytes(),'validation_adversaires.json':(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode(),'evaluation.json':pathlib.Path(evaluation).read_bytes()}
    for name,raw in contenu.items():
        f=bundle/name
        if f.is_symlink():raise ValueError('Fichier de bundle non admissible')
        if f.exists() and f.read_bytes()!=raw:raise ValueError('Bundle existant différent : immutabilité conservée')
        if not f.exists():f.write_bytes(raw)
    return {'version':1,'avant':data['avant'],'empreinte':empreinte},ajout,bundle

def activer_bundle(racine,pointeur):
    racine=pathlib.Path(racine).resolve();parent=racine/'.historiques-valides'
    if not re.fullmatch('[a-f0-9]{64}',pointeur['empreinte']):raise ValueError('Empreinte invalide')
    bundle=parent/pointeur['empreinte'];data=lire(bundle/'historique_espn_verifie.json');v=lire(bundle/'validation_adversaires.json')
    if sha(bundle/'historique_espn_verifie.json')!=pointeur['empreinte'] or data['avant']!=pointeur['avant'] or v['empreinteFichier']!=pointeur['empreinte']:raise ValueError('Bundle non concordant')
    # Même sélecteur que la production, avant tout remplacement du pointeur actif.
    subprocess.run(['node','-e',"require(process.argv[1]).verifierBundle(process.argv[2],JSON.parse(process.argv[3]))",str(racine/'donnees_valides.cjs'),str(racine),json.dumps(pointeur)],check=True)
    probe=racine/'historique_actif.candidat.json'
    if probe.is_symlink():raise ValueError('Pointeur temporaire non admissible')
    probe.write_text(json.dumps(pointeur),encoding='utf-8')
    cible=racine/'historique_actif.json'
    if cible.is_symlink():raise ValueError('Pointeur actif non admissible')
    probe.replace(cible)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--racine',default=str(pathlib.Path(__file__).parent));parser.add_argument('--cache',required=True);parser.add_argument('--sortie',required=True);parser.add_argument('--date',default=datetime.datetime.now(datetime.timezone.utc).date().isoformat());parser.add_argument('--activer',action='store_true');args=parser.parse_args()
    root=pathlib.Path(args.racine).resolve();out=pathlib.Path(args.sortie).resolve();out.mkdir(parents=True,exist_ok=True)
    choix=json.loads(subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require(process.argv[1]).choixDonnees(process.argv[2])))",str(root/'donnees_valides.cjs'),str(root)],text=True))
    if (root/'historique_actif.json').exists() and choix['origine']!='bundle-verifie':raise ValueError('Pointeur courant invalide : revue nécessaire')
    origine=pathlib.Path(choix['dossier']);ancien=lire(origine/'historique_espn_verifie.json');obligatoires=lire(origine/'validation_adversaires.json')['competitionsEligibles']
    snapshot=out/'historique_espn_verifie.json';evaluation=out/'evaluation.json'
    subprocess.run([sys.executable,str(root/'collecter_historique.py'),str(snapshot),args.date,args.cache],check=True)
    verifier_snapshot(lire(snapshot),ancien)
    subprocess.run(['node',str(root/'evaluer_adversaires.cjs'),str(snapshot),str(evaluation)],check=True)
    pointeur,ajout,bundle=preparer_bundle(root,snapshot,evaluation,ancien,obligatoires)
    if args.activer:activer_bundle(root,pointeur)
    bilan={'pointeur':pointeur,'nouveauxResultats':ajout,'bundle':str(bundle),'active':args.activer}
    (out/'bilan.json').write_text(json.dumps(bilan,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(bilan,ensure_ascii=False))
if __name__=='__main__':main()
