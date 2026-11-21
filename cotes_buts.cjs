'use strict';
// Marchés binaires à demi-but uniquement : aucune ligne asiatique à remboursement.
function totauxValides(book,now){
 const markets=Array.isArray(book?.markets)?book.markets:[];
 const ms=markets.filter(m=>m?.key==='totals'&&(!Object.hasOwn(m,'period')||m.period==='full'));
 if(ms.length!==1)return [];
 const m=ms[0],stamp=typeof m.last_update==='string'?Date.parse(m.last_update):NaN;
 if(!Number.isFinite(stamp)||stamp>now+60000||now-stamp>900000||!Array.isArray(m.outcomes)||m.outcomes.length>1000)return [];
 const outcomes=[];
 for(const point of [1.5,2.5,3.5]){
  const xs=m.outcomes.filter(o=>o?.point===point);
  if(xs.length!==2)continue;
  if(!['Over','Under'].every(name=>xs.filter(o=>o.name===name&&typeof o.price==='number'&&Number.isFinite(o.price)&&o.price>1&&o.price<=1000).length===1))continue;
  outcomes.push(...xs);
 }
 return outcomes.length?[{...m,outcomes}]:[];
}
module.exports={totauxValides};
