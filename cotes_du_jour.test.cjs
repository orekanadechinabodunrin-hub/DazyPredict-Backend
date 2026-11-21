const test=require('node:test'),assert=require('node:assert/strict');
const {fenetreValide,filtrerCotes,creerControleur}=require('./cotes_du_jour.cjs');
const now=Date.parse('2026-11-15T10:00Z');
const query={jour:'2026-11-15',fuseau:'Africa/Porto-Novo',debut:'2026-11-14T23:00:00.000Z',fin:'2026-11-15T23:00:00.000Z'};
const window=()=>fenetreValide(query,now);
const row=()=>({id:'soccer:alpha-beta:2026-11-15',sport_key:'soccer',commence_time:'2026-11-15T12:00:00.000Z',is_live:false,status:'scheduled',home_team:'Alpha',away_team:'Beta',league:{key:'brazil_campeonato'},bookmakers:[{key:'1xbet',last_update:'2026-11-15T09:59:00.000Z',markets:[{key:'h2h',outcomes:[{name:'Alpha',price:2.1},{name:'Draw',price:3.2},{name:'Beta',price:3.5}]}]}]});
async function call(fn,q=query){let status=200,body;await fn({query:q},{status(n){status=n;return this;},json(b){body=b;return this;}});return {status,body};}
test('local day window includes a UTC-date difference and DST days',()=>{
 assert.equal(window().a,Date.parse(query.debut));
 const q={jour:'2026-03-29',fuseau:'Europe/Paris',debut:'2026-03-28T23:00:00.000Z',fin:'2026-03-29T22:00:00.000Z'};
 assert.equal(fenetreValide(q,Date.parse('2026-03-29T12:00Z')).b-Date.parse(q.debut),23*3600000);
});
test('future day, invalid timezone and non-midnight windows are rejected',()=>{
 for(const q of [{...query,jour:'2026-11-16'},{...query,fuseau:'bad/zone'},{...query,debut:'2026-11-15T01:00:00Z'},{...query,fin:'2026-11-17T23:00:00Z'}])assert.throws(()=>fenetreValide(q,now));
});
test('real decimal 1xBet three-way prices survive without changing them',()=>{
 const x=row(),r=filtrerCotes([x],window(),now);assert.equal(r.donnees.length,1);assert.equal(r.donnees[0].bookmakers[0].markets[0].outcomes[0].price,2.1);
});
test('started, next-day, absent, stale and malformed odds cannot be selected',()=>{
 const a=row();a.commence_time='2026-11-15T09:00:00Z';
 const b=row();b.commence_time='2026-11-15T23:00:00Z';
 const c=row();c.bookmakers=[];
 const d=row();d.bookmakers[0].last_update='2026-11-15T09:00:00Z';
 const e=row();e.bookmakers[0].markets[0].outcomes[0].price='2.1';
 assert.equal(filtrerCotes([a,b,c,d,e],window(),now).donnees.length,0);
});
test('duplicate identities with contradictory prices are excluded',()=>{
 const a=row(),b=row();b.bookmakers[0].markets[0].outcomes[0].price=2.4;
 assert.equal(filtrerCotes([a,b],window(),now).donnees.length,0);
 assert.equal(filtrerCotes([a,a],window(),now).donnees.length,1);
});
test('upstream request is football-wide, decimal, full-game, date bounded and cached',async()=>{
 let n=0;const fn=creerControleur({key:()=> 'test-placeholder',now:()=>now,get:async(url,o)=>{
  n++;assert.equal(o.params.league,undefined);assert.equal(o.params.markets,'h2h,totals');assert.equal(o.params.bookmakers,'1xbet');assert.equal(o.params.oddsFormat,'decimal');assert.equal(o.params.periods,'full');assert.equal(o.params.commenceTimeFrom,query.debut);return {data:[row()]};
 }});
 const results=await Promise.all([call(fn),call(fn)]);assert.equal(n,1);assert.equal(results[0].body.nombreMatchs,1);await call(fn);assert.equal(n,1);
});
test('a cached fixture that has since started is removed',async()=>{
 let t=now;const x=row();x.commence_time='2026-11-15T10:00:30.000Z';
 const fn=creerControleur({key:()=> 'test-placeholder',now:()=>t,get:async()=>({data:[x]})});
 assert.equal((await call(fn)).body.nombreMatchs,1);t+=40000;assert.equal((await call(fn)).body.nombreMatchs,0);
});
test('provider errors and missing configuration do not expose credentials or fabricate odds',async()=>{
 const fn=creerControleur({key:()=> 'test-placeholder',now:()=>now,get:async()=>{throw {response:{status:429},message:'private-request-detail'};}});
 const r=await call(fn);assert.equal(r.status,429);assert.equal(r.body.success,false);assert.ok(!JSON.stringify(r).includes('private-request-detail'));assert.ok(!JSON.stringify(r).includes('test-placeholder'));
 assert.equal((await call(creerControleur({key:()=>'',now:()=>now,get:async()=>{throw Error();}}))).status,503);
});

test('totals extend the fixture without changing its original h2h; stale totals leave h2h intact',()=>{
 const x=row(),book=x.bookmakers[0];book.markets.push({key:'totals',last_update:'2026-11-15T09:59:00Z',outcomes:[{name:'Over',point:1.5,price:1.4},{name:'Under',point:1.5,price:3}]});
 let r=filtrerCotes([x],window(),now);assert.equal(r.donnees[0].bookmakers[0].markets.length,2);assert.deepEqual(r.donnees[0].bookmakers[0].markets[0],x.bookmakers[0].markets[0]);
 book.markets[1].last_update=null;r=filtrerCotes([x],window(),now);assert.equal(r.donnees[0].bookmakers[0].markets.length,1);
});
test('an explicitly unknown h2h timestamp cannot inherit freshness from another market',()=>{const x=row();x.bookmakers[0].markets[0].last_update=null;assert.equal(filtrerCotes([x],window(),now).donnees.length,0);});
