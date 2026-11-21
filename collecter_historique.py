"""Snapshot local ESPN, résultats à 90 minutes uniquement. Aucun compte payant."""
import concurrent.futures, datetime, hashlib, json, pathlib, sys, urllib.request, re

COMPETITIONS = {
    'eng.1':'English Premier League', 'eng.2':'English Championship',
    'fra.1':'French Ligue 1', 'esp.1':'Spain Primera División',
    'ger.1':'Deutsche Bundesliga', 'ita.1':'Italian Serie A',
    'ned.1':'Netherlands Eredivisie', 'por.1':'Portuguese Primeira Liga',
    'uefa.champions':'UEFA Champions League',
    'caf.nations_qual':'Africa Cup of Nations Qualifying',
    'fifa.worldq.caf':'FIFA World Cup Qualifying - CAF'
}

def cache_reutilisable(saved,code,year,cutoff,maintenant=None):
    try:
        maintenant=maintenant or datetime.datetime.now(datetime.timezone.utc)
        age=(maintenant-datetime.datetime.fromisoformat(saved['recupereLe'])).total_seconds()
        if saved.get('code')!=code or saved.get('annee')!=year or not 0<=age<30*86400 or saved.get('cutoff','')>cutoff or not isinstance(saved.get('matches'),list):return False
        # Au changement d'année, relire la dernière journée encore exclue la veille.
        annee_complete=year<int(cutoff[:4]) and saved.get('cutoff','')>f'{year}-12-31'
        return annee_complete or (saved.get('cutoff')==cutoff and age<86400)
    except (KeyError,TypeError,ValueError):return False

def convertir(event, code, cutoff):
    try:
        instant=datetime.datetime.fromisoformat(event['date'].replace('Z','+00:00'))
        if instant.tzinfo is None: return None
        day=instant.astimezone(datetime.timezone.utc).date().isoformat()
        if datetime.date.fromisoformat(day).isoformat() != day or day >= cutoff: return None
        c = event['competitions'][0]
        status = c.get('status', event.get('status', {})).get('type', {})
        # Les scores après prolongation/tirs au but ne sont pas des scores 1N2 à 90 min.
        if status.get('completed') is not True or status.get('name') != 'STATUS_FULL_TIME': return None
        clock=c.get('status',event.get('status',{})).get('displayClock','')
        minute=re.match(r'^(\d+)',str(clock))
        if minute and int(minute.group(1))>90: return None
        h, = [t for t in c['competitors'] if t.get('homeAway') == 'home']
        a, = [t for t in c['competitors'] if t.get('homeAway') == 'away']
        hid, aid, eid = str(h['team']['id']), str(a['team']['id']), str(event['id'])
        if not all(x.isdigit() and int(x)>0 for x in (hid,aid,eid)) or hid == aid: return None
        sh, sa = str(h['score']), str(a['score'])
        if not all(x.isdigit() and 0 <= int(x) <= 20 for x in (sh,sa)): return None
        hn, an = h['team']['displayName'].strip(), a['team']['displayName'].strip()
        if not hn or not an: return None
        return dict(date=day, domicile=hn, exterieur=an, butsDomicile=int(sh), butsExterieur=int(sa),
                    domicileId=hid, exterieurId=aid, fixtureId=eid, codeCompetition=code,
                    championnat=COMPETITIONS[code], source='ESPN', statut='STATUS_FULL_TIME',
                    terrainNeutre=c.get('neutralSite') is True)
    except (KeyError, IndexError, TypeError, ValueError): return None

def dedoublonner(rows):
    # Une contradiction sur l'ID OU sur l'identité ordonnée exclut toutes ses copies.
    ids, identities = {}, {}
    for r in rows:
        ids.setdefault((r['codeCompetition'],r['fixtureId']), []).append(r)
        identities.setdefault((r['codeCompetition'],r['date'],r['domicileId'],r['exterieurId']), []).append(r)
    def signature(r): return (r['date'],r['domicileId'],r['exterieurId'],r['butsDomicile'],r['butsExterieur'],r['terrainNeutre'])
    bad = {id(r) for groups in (ids,identities) for group in groups.values()
           if len({signature(r) for r in group})>1 for r in group}
    seen, result = set(), []
    for r in rows:
        key = (r['codeCompetition'],r['date'],r['domicileId'],r['exterieurId'])
        if id(r) not in bad and key not in seen: result.append(r); seen.add(key)
    return sorted(result,key=lambda r:(r['date'],r['codeCompetition'],r['fixtureId'])),len(bad)

def main():
    destination=pathlib.Path(sys.argv[1]); cutoff=sys.argv[2]
    if datetime.date.fromisoformat(cutoff).isoformat()!=cutoff: raise ValueError('Date non canonique')
    if cutoff>datetime.datetime.now(datetime.timezone.utc).date().isoformat(): raise ValueError('Collecte future interdite')
    cache=pathlib.Path(sys.argv[3]);cache.mkdir(parents=True,exist_ok=True)
    def fetch(job):
        code,year=job; url=f'https://site.api.espn.com/apis/site/v2/sports/soccer/{code}/scoreboard?dates={year}&limit=1000'
        file=cache/f'{code}-{year}.json'
        if file.exists():
            saved=json.loads(file.read_text(encoding='utf-8'))
            if cache_reutilisable(saved,code,year,cutoff): return saved
        request=urllib.request.Request(url,headers={'User-Agent':'DazyPredict-local-research/1.0'})
        with urllib.request.urlopen(request,timeout=40) as response:
            content=response.read(8*1024*1024+1)
            if len(content)>8*1024*1024: raise ValueError('Réponse trop volumineuse')
            raw=json.loads(content)
        if [x.get('slug') for x in raw.get('leagues',[])]!=[code]: raise ValueError(f'{code}: identité de compétition non confirmée')
        events=raw.get('events')
        if not isinstance(events,list) or len(events)>=1000: raise ValueError(f'{code}/{year}: réponse absente ou potentiellement tronquée')
        rows=[r for e in events if (r:=convertir(e,code,cutoff)) is not None]
        report=dict(code=code,annee=year,url=url,recus=len(events),retenus=len(rows),matches=rows,
                    recupereLe=datetime.datetime.now(datetime.timezone.utc).isoformat(),cutoff=cutoff)
        file.write_text(json.dumps(report,ensure_ascii=False),encoding='utf-8')
        return report
    jobs=[(code,year) for code in COMPETITIONS for year in range(2024,int(cutoff[:4])+1)]
    reports=[]; errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(fetch,job):job for job in jobs}
        for future in concurrent.futures.as_completed(futures):
            try:
                r=future.result();reports.append(r);print(f"{r['code']}/{r['annee']}: {r['retenus']}/{r['recus']}",flush=True)
            except Exception as e: errors.append(dict(job=futures[future],erreur=str(e)));print('ERREUR',futures[future],str(e),flush=True)
    rows,conflicts=dedoublonner([m for r in reports for m in r['matches']])
    payload=dict(version=1,source='ESPN',avant=cutoff,recupereLe=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 complet=not errors,erreurs=errors,conflitsExclus=conflicts,
                 collecte=[{k:v for k,v in r.items() if k!='matches'} for r in sorted(reports,key=lambda x:(x['code'],x['annee']))],matches=rows)
    payload['empreinteMatches']=hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
    destination.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
    print('TOTAL',len(rows),'ERREURS',len(errors),'CONFLITS',conflicts,flush=True)
    if errors: sys.exit(2)

if __name__=='__main__': main()
