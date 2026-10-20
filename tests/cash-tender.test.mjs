import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DENOMINATIONS,MAX_TENDER,parseTender,addDenomination,tenderBalance } from '../cash-tender.mjs';
import { createV4 } from '../v4.mjs';
const read=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('cash amount buttons increment cumulatively, clear restores zero',()=>{
 assert.deepEqual([...DENOMINATIONS],[50,100,500,1000,5000,10000]);
 let total='0';for(const step of [1000,500,50,1000])total=String(addDenomination(total,step));
 assert.equal(total,'2550');assert.equal(parseTender(''),0);
 total='0';assert.equal(parseTender(total),0);
});
test('amount and change are always integer-yen, shortage and overpay show correctly',()=>{
 assert.deepEqual(tenderBalance('1500',1200),{received:1500,change:300,shortage:0,enough:true});
 assert.deepEqual(tenderBalance('1000',1200),{received:1000,change:0,shortage:200,enough:false});
 for(const amount of ['-5','1.5','abc',String(MAX_TENDER+1)])assert.throws(()=>parseTender(amount));
 assert.throws(()=>addDenomination(MAX_TENDER,1000),/上限/);
 assert.throws(()=>addDenomination('10',20),/対応/);
});
function setup(){
 const rows={pos_registers:[{id:'register',name:'レジ'}],pos_products:[{id:'apple',name:'りんご',price:600,active:true,category:'商品',track_stock:false}],register_sessions:[{id:'session',register_id:'register',opened_at:'2026-10-20T10:00:00Z',closed_at:null,paused:false}],pos_sale_lines:[],pos_sales:[]};
 const nodes=new Map();let payment='cash';
 nodes.set('#v4-tender',{id:'v4-tender',value:'0'});
 nodes.set('#v4-change',{textContent:'',classList:{set:new Set(),add(x){this.set.add(x);},remove(x){this.set.delete(x);},toggle(x,v){if(v)this.add(x);else this.remove(x)}}});
 nodes.set('#v4-cash-tender',{hidden:false});
 nodes.set('#v4-payment',{get value(){return payment;},set value(x){payment=x;}});
 const originalDoc=globalThis.document;
 globalThis.document={querySelector:s=>nodes.get(s)};
 const ctx={event:()=> 'evt',current:()=>({sales:0}),admin:()=>true,people:()=>[],pending:()=>0,render:()=>{
   // Browser render replaces form controls; simulate current state by extracting HTML.
   const view=v4.view('pos');
   const tender=view.match(/id="v4-tender"[^>]*value="([^"]*)"/)?.[1];
   if(tender!==undefined)nodes.get('#v4-tender').value=tender;
 },reload:async()=>{},notice:()=>{},openV4:()=>{},client:()=>({from:table=>({select:()=>({eq:()=>({order:()=>({limit:async()=>({data:rows[table]||[],error:null})})})})}),rpc:async fn=>({data:fn==='pos_report'?{}:fn==='pos_session_status'?{}:null,error:null})})};
 const v4=createV4(ctx);
 return {v4,nodes,restore:()=>{globalThis.document=originalDoc;}};
}
test('POS renders tap buttons, live shortage, preserved amount after adding cart items',async()=>{
 const {v4,nodes,restore}=setup();
 try{
  await v4.load();let view=v4.view('pos');
  for(const amount of DENOMINATIONS)assert.match(view,new RegExp('data-action="v4-tender-add" data-amount="'+amount+'"'));
  assert.match(view,/data-action="v4-tender-clear"/);
  assert.match(view,/お釣り：0円/);
  await v4.action({dataset:{action:'v4-cart-add',id:'apple'}});
  await v4.action({dataset:{action:'v4-tender-add',amount:'500'}});
  await v4.action({dataset:{action:'v4-tender-add',amount:'100'}});
  assert.equal(nodes.get('#v4-tender').value,'600');
  assert.equal(nodes.get('#v4-change').textContent,'お釣り：0円');
  await v4.action({dataset:{action:'v4-cart-add',id:'apple'}});
  view=v4.view('pos');assert.match(view,/value="600"[^>]*id="v4-tender"/);
  assert.match(view,/不足：600円/);
  await v4.action({dataset:{action:'v4-tender-add',amount:'1000'}});
  assert.equal(nodes.get('#v4-change').textContent,'お釣り：400円');
  nodes.get('#v4-payment').value='cashless';v4.change({id:'v4-payment'});
  assert.equal(nodes.get('#v4-cash-tender').hidden,true);
  assert.match(v4.view('pos'),/value="cashless" selected/);
  nodes.get('#v4-payment').value='cash';v4.change({id:'v4-payment'});
  assert.equal(nodes.get('#v4-cash-tender').hidden,false);
  await v4.action({dataset:{action:'v4-tender-clear'}});
  assert.equal(nodes.get('#v4-tender').value,'0');
  assert.equal(nodes.get('#v4-change').textContent,'不足：1,200円');
 }finally{restore();}
});
test('v4.2 CSS and service worker include cash controls',()=>{
 assert.match(read('index.html'),/v4\.2\.css/);
 assert.match(read('sw.js'),/cash-tender\.mjs/);
 assert.match(read('sw.js'),/v4\.2\.css/);
 assert.match(read('v4.2.css'),/min-height:48px/);
});
