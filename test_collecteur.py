import copy, unittest
from collecter_historique import convertir, dedoublonner
class CollecteurTest(unittest.TestCase):
    def event(self):
        return {'id':'123','date':'2025-03-02T18:00Z','competitions':[{'status':{'type':{'completed':True,'name':'STATUS_FULL_TIME'}},'competitors':[
            {'homeAway':'away','score':'1','team':{'id':'2','displayName':'Beta'}},
            {'homeAway':'home','score':'2','team':{'id':'1','displayName':'Alpha'}}]}]}
    def test_score_order_and_no_future(self):
        e=self.event();r=convertir(e,'eng.1','2025-03-03')
        self.assertEqual((r['domicile'],r['butsDomicile'],r['exterieur'],r['butsExterieur']),('Alpha',2,'Beta',1))
        self.assertIsNone(convertir(e,'eng.1','2025-03-02'))
    def test_non_regulation_and_missing_scores_excluded(self):
        for status in ('STATUS_SCHEDULED','STATUS_FINAL_PEN','STATUS_FINAL_AET'):
            e=self.event();e['competitions'][0]['status']['type']['name']=status
            self.assertIsNone(convertir(e,'eng.1','2026-01-01'))
        e=self.event();del e['competitions'][0]['competitors'][0]['score']
        self.assertIsNone(convertir(e,'eng.1','2026-01-01'))
    def test_conflicting_identical_fixture_ids_and_semantic_identity(self):
        r=convertir(self.event(),'eng.1','2026-01-01')
        self.assertEqual(len(dedoublonner([r,copy.deepcopy(r)])[0]),1)
        other=dict(r,fixtureId='999',butsDomicile=3)
        self.assertEqual(len(dedoublonner([r,other])[0]),0)
if __name__=='__main__':unittest.main()
