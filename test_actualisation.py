import copy,hashlib,json,pathlib,shutil,subprocess,tempfile,unittest,datetime
from actualiser_historique import verifier_snapshot,verifier_evaluation,preparer_bundle,activer_bundle
from collecter_historique import convertir,cache_reutilisable

class ActualisationTest(unittest.TestCase):
    def setUp(self):
        self.dir=pathlib.Path(tempfile.mkdtemp(prefix='dazypredict-refresh-test-')).resolve()
        def cleanup():
            assert self.dir.is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve()) and self.dir.name.startswith('dazypredict-refresh-test-')
            shutil.rmtree(self.dir)
        self.addCleanup(cleanup)
        self.rows=[dict(date='2025-01-01',fixtureId=str(i+1),domicileId=str(2*i+1),exterieurId=str(2*i+2),domicile='Alpha',exterieur='Beta',butsDomicile=2,butsExterieur=1,terrainNeutre=False,statut='STATUS_FULL_TIME',codeCompetition='eng.1',championnat='English Premier League') for i in range(1200)]
        self.data=dict(version=1,complet=True,erreurs=[],conflitsExclus=0,avant='2026-11-20',matches=self.rows,empreinteMatches=hashlib.sha256(json.dumps(self.rows,sort_keys=True).encode()).hexdigest())
        self.old={**self.data,'avant':'2026-11-14','matches':self.rows[:-1]}
        b=dict(n=1000,brier=.65,logLoss=1.1);c=dict(n=1000,brier=.62,logLoss=1.05)
        self.eval=dict(avant=self.data['avant'],empreinteDonnees=self.data['empreinteMatches'],historique={'n':1200},selection=dict(prior=20,demiVie=365),decision=dict(gainGlobal=True,competitionsEligibles=['eng.1']),testFinal=dict(baseline=b,candidat=c,intervallesDifferenceCandidatMoinsBaseline={k:dict(de=-.05,a=-.01,blocs=100) for k in ['brier','logLoss']},parCompetition=[dict(code='eng.1',baseline=b,candidat=c)]))
    def save(self,name,obj):
        f=self.dir/name;f.write_text(json.dumps(obj),encoding='utf-8');return f
    def test_complet_et_ajout_sans_perte(self):self.assertEqual(1,verifier_snapshot(self.data,self.old))
    def test_collecte_incomplete_conflit_futur_et_doublon_refuses(self):
        for modifier in (lambda d:d.update(complet=False),lambda d:d.update(conflitsExclus=1),lambda d:d['matches'][0].update(date='2026-11-20'),lambda d:d['matches'].append(d['matches'][0])):
            d=copy.deepcopy(self.data);modifier(d)
            with self.assertRaises(ValueError):verifier_snapshot(d,self.old)
    def test_correction_et_disparition_anciennes_donnees_exigent_revue(self):
        for modifier in (lambda d:d['matches'][0].update(butsDomicile=3),lambda d:d['matches'].pop(0)):
            d=copy.deepcopy(self.data);modifier(d)
            with self.assertRaises(ValueError):verifier_snapshot(d,self.old)
    def test_empreinte_et_scores_fractionnaires_refuses(self):
        d=copy.deepcopy(self.data);d['empreinteMatches']='bad'
        with self.assertRaises(ValueError):verifier_snapshot(d,self.old)
        d=copy.deepcopy(self.data);d['matches'][0]['butsDomicile']=2.5
        with self.assertRaises(ValueError):verifier_snapshot(d,self.old)
    def test_validation_gains_et_couverture_obligatoires(self):
        self.assertEqual(['eng.1'],verifier_evaluation(self.data,self.eval,['eng.1'])[1])
        with self.assertRaises(ValueError):verifier_evaluation(self.data,self.eval,['fra.1'])
        for modifier in (lambda e:e.update(empreinteDonnees='bad'),lambda e:e['testFinal']['candidat'].update(brier=.7),lambda e:e['testFinal']['intervallesDifferenceCandidatMoinsBaseline']['brier'].update(a=.01),lambda e:e['decision'].update(gainGlobal=False)):
            e=copy.deepcopy(self.eval);modifier(e)
            with self.assertRaises(ValueError):verifier_evaluation(self.data,e,['eng.1'])
    def test_aucun_basculement_avant_validation_et_codes_figes(self):
        self.save('historique_actif.json',{'ancien':True});before=(self.dir/'historique_actif.json').read_bytes()
        snapshot=self.save('candidat.json',self.data);e=self.save('evaluation.json',self.eval)
        for name in ['moteur_dazypredict.js','moteur_adversaires.cjs']:(self.dir/name).write_text('// math fixtures')
        shutil.copyfile(pathlib.Path(__file__).with_name('donnees_valides.cjs'),self.dir/'donnees_valides.cjs')
        pointeur,ajouts,bundle=preparer_bundle(self.dir,snapshot,e,self.old,['eng.1'])
        self.assertEqual(1,ajouts);self.assertEqual(before,(self.dir/'historique_actif.json').read_bytes())
        activer_bundle(self.dir,pointeur);self.assertEqual(pointeur,json.loads((self.dir/'historique_actif.json').read_text()))
        current=(self.dir/'historique_actif.json').read_bytes();(self.dir/'moteur_adversaires.cjs').write_text('// changed')
        with self.assertRaises(subprocess.CalledProcessError):activer_bundle(self.dir,pointeur)
        self.assertEqual(current,(self.dir/'historique_actif.json').read_bytes())
    def test_refuse_120_minutes_et_date_utc_correcte(self):
        event={'id':'123','date':'2025-03-02T23:30:00-02:00','competitions':[{'status':{'displayClock':"90'",'type':{'completed':True,'name':'STATUS_FULL_TIME'}},'competitors':[{'homeAway':'home','score':'0','team':{'id':'1','displayName':'A'}},{'homeAway':'away','score':'0','team':{'id':'2','displayName':'B'}}]}]}
        self.assertIsNone(convertir(event,'eng.1','2025-03-03'))
        self.assertEqual('2025-03-03',convertir(event,'eng.1','2025-03-04')['date'])
        event['competitions'][0]['status']['displayClock']="120'"
        self.assertIsNone(convertir(event,'eng.1','2025-03-04'))
    def test_cache_de_fin_annee_ne_cache_pas_la_derniere_journee(self):
        now=datetime.datetime(2027,1,1,tzinfo=datetime.timezone.utc)
        saved=dict(code='eng.1',annee=2026,cutoff='2026-12-31',recupereLe='2026-12-31T12:00:00+00:00',matches=[])
        self.assertFalse(cache_reutilisable(saved,'eng.1',2026,'2027-01-01',now))
        saved.update(cutoff='2027-01-01',recupereLe='2027-01-01T00:00:00+00:00')
        self.assertTrue(cache_reutilisable(saved,'eng.1',2026,'2027-01-02',now+datetime.timedelta(days=1)))
        self.assertFalse(cache_reutilisable(saved,'eng.2',2026,'2027-01-02',now))
        self.assertFalse(cache_reutilisable(saved,'eng.1',2026,'2027-02-20',now+datetime.timedelta(days=50)))
if __name__=='__main__':unittest.main()
