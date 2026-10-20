import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultData,calculate,allocateYen,FUND,validateImport,suggestTransfers} from '../engine.mjs';
function fixture(){const d=defaultData();d.people=[{id:'a',name:'A'},{id:'b',name:'B'}];d.sales=10000;d.reserve=1000;d.activities=[{id:'a1',personId:'a',type:'prep',quantity:2,rate:2,date:'2026-10-20'},{id:'a2',personId:'b',type:'car',quantity:1,rate:4,date:'2026-10-20'}];d.expenses=[{id:'e1',paidBy:'a',amount:2000,title:'食材',date:'2026-10-20'},{id:'e2',paidBy:FUND,amount:1000,title:'備品',date:'2026-10-20'}];d.deposits=[{id:'d1',personId:'b',amount:3000,date:'2026-10-20'}];return d;}
test('profit, expenses and contributions are accounted separately',()=>{
 const c=calculate(fixture());assert.equal(c.net,6000);assert.equal(c.byPerson[0].share,3000);assert.equal(c.byPerson[1].share,3000);assert.equal(c.byPerson[0].balance,5000);assert.equal(c.byPerson[1].balance,6000);assert.equal(c.fundCash,12000);assert.equal(c.fundAvailable,11000);assert.equal(c.suggestions.reduce((s,x)=>s+x.amount,0),11000);
});
test('settlement update after a fund payout and person-to-person payment',()=>{
 const d=fixture();d.transfers=[{id:'t1',from:'fund',to:'a',amount:1000,date:'2026-10-20'},{id:'t2',from:'b',to:'a',amount:500,date:'2026-10-20'}];const c=calculate(d);assert.equal(c.byPerson[0].balance,3500);assert.equal(c.byPerson[1].balance,6500);assert.equal(c.fundAvailable,10000);assert.equal(c.suggestions.reduce((s,x)=>s+x.amount,0),10000);
});
test('rounding allocates all yen',()=>{
 const shares=allocateYen(101,[{id:'a',points:1},{id:'b',points:1},{id:'c',points:1}]);assert.equal(Object.values(shares).reduce((a,b)=>a+b,0),101);assert.deepEqual(shares,{a:34,b:34,c:33});
});
test('negative profits block automatic settlement and loss allocation',()=>{
 const d=fixture();d.sales=0;const c=calculate(d);assert.ok(c.net<0);assert.equal(c.byPerson[0].share,0);assert.equal(c.suggestions.length,0);assert.match(c.blocked,/赤字/);
});
test('no recorded points blocks allocation',()=>{
 const d=fixture();d.activities=[];const c=calculate(d);assert.equal(c.totalPoints,0);assert.equal(c.suggestions.length,0);assert.match(c.blocked,/貢献/);
});
test('past payment overrun produces a reverse settlement',()=>{
 const d=fixture();d.transfers=[{id:'t1',from:FUND,to:'a',amount:5500,date:'2026-10-20'}];const c=calculate(d);assert.equal(c.byPerson[0].balance,-500);assert.ok(c.suggestions.some(x=>x.from==='a'&&x.amount===500));
});
test('invalid backup is rejected',()=>{
 const d=fixture();d.expenses[0].paidBy='nobody';assert.throws(()=>validateImport(d));
});
test('suggestion algorithm eliminates all balances',()=>{
 const matches=suggestTransfers([{id:'a',balance:-15},{id:'b',balance:-25},{id:'c',balance:30},{id:'d',balance:10}]);assert.equal(matches.reduce((a,x)=>a+x.amount,0),40);
});
