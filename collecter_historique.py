"""Snapshot local ESPN, résultats à 90 minutes uniquement. Aucun compte payant."""
import concurrent.futures, datetime, hashlib, json, pathlib, sys, urllib.request

COMPETITIONS = {
    'eng.1':'English Premier League', 'eng.2':'English Championship',
    'fra.1':'French Ligue 1', 'esp.1':'Spain Primera División',
    'ger.1':'Deutsche Bundesliga', 'ita.1':'Italian Serie A',
    'ned.1':'Netherlands Eredivisie', 'por.1':'Portuguese Primeira Liga',
    'uefa.champions':'UEFA Champions League',
    'caf.nations_qual':'Africa Cup of Nations Qualifying',
    'fifa.worldq.caf':'FIFA World Cup Qualifying - CAF'
}

def convertir(event, code, cutoff):
    try:
        day = event['date'][:10]
        if datetime.date.fromisoformat(day).isoformat() != day or day >= cutoff: return None
        c = event['competitions'][0]
        status = c.get('status', event.get('status', {})).get('type', {})
        # Les scores après prolongation/tirs au but ne sont pas des scores 1N2 à 90 min.
        if status.get('completed') is not True or status.get('name') != 'STATUS_FULL_TIME': return None
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
    datetime.date.fromisoformat(cutoff)
    cache=pathlib.Path(sys.argv[3]);cache.mkdir(parents=True,exist_ok=True)
    def fetch(job):
        code,year=job; url=f'https://site.api.espn.com/apis/site/v2/sports/soccer/{code}/scoreboard?dates={year}&limit=1000'
        file=cache/f'{code}-{year}.json'
        if file.exists():
            saved=json.loads(file.read_text(encoding='utf-8'))
            age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(saved['recupereLe'])).total_seconds()
            if year<int(cutoff[:4]) or (saved.get('cutoff')==cutoff and age<86400): return saved
        request=urllib.request.Request(url,headers={'User-Agent':'DazyPredict-local-research/1.0'})
        with urllib.request.urlopen(request,timeout=40) as response: raw=json.load(response)
        events=raw.get('events')
        if not isinstance(events,list) or len(events)>=1000: raise ValueError(f'{code}/{year}: réponse absente ou potentiellement tronquée')
        rows=[r for e in events if (r:=convertir(e,code,cutoff)) is not None]
        report=dict(code=code,annee=year,url=url,recus=len(events),retenus=len(rows),matches=rows,
                    recupereLe=datetime.datetime.now(datetime.timezone.utc).isoformat(),cutoff=cutoff)
        file.write_text(json.dumps(report,ensure_ascii=False),encoding='utf-8')
        return report
    jobs=[(code,year) for code in COMPETITIONS for year in (2024,2025,2026)]
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
