const test=require('node:test'),assert=require('node:assert/strict');
const {totauxValides}=require('./cotes_buts.cjs');
const now=Date.parse('2026-11-21T10:00Z');
const market=()=>({key:'totals',last_update:'2026-11-21T09:59Z',outcomes:[{name:'Over',point:1.5,price:1.4},{name:'Under',point:1.5,price:3.0},{name:'Over',point:2.5,price:2.0},{name:'Under',point:2.5,price:1.8}]});
test('full-time half-goal prices survive exactly; Asian whole and quarter lines do not',()=>{
 const m=market();m.outcomes.push({name:'Over',point:2.75,price:1.8},{name:'Under',point:2.75,price:2.0},{name:'Over',point:3,price:2.2},{name:'Under',point:3,price:1.6});
 const r=totauxValides({markets:[m]},now);assert.equal(r.length,1);assert.equal(r[0].outcomes.length,4);assert.deepEqual(r[0].outcomes,m.outcomes.slice(0,4));
});
test('incomplete or conflicting lines are excluded without corrupting other lines',()=>{
 const m=market();m.outcomes.push({name:'Over',point:1.5,price:1.5});const r=totauxValides({markets:[m]},now);assert.deepEqual(r[0].outcomes.map(o=>o.point),[2.5,2.5]);
 m.outcomes=m.outcomes.filter(o=>o.name!=='Under');assert.deepEqual(totauxValides({markets:[m]},now),[]);
});
test('periods, stale or unknown timestamps and malformed prices are refused',()=>{
 for(const extra of [{period:'1h'},{period:null},{period:0},{last_update:null},{last_update:'2026-11-21T09:44:59Z'},{last_update:'2026-11-21T10:01:01Z'}])assert.deepEqual(totauxValides({markets:[{...market(),...extra}]},now),[]);
 const m=market();m.outcomes.forEach(o=>o.price='1.9');assert.deepEqual(totauxValides({markets:[m]},now),[]);
});
test('ambiguous duplicate markets or malformed containers never become a quote',()=>{
 assert.deepEqual(totauxValides({markets:[market(),market()]},now),[]);assert.deepEqual(totauxValides({markets:{}},now),[]);assert.deepEqual(totauxValides(null,now),[]);
});
