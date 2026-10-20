import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {v4Summary,cashExpected,countDifference,aggregateCart,canFinalize} from '../v4-finance.mjs';
import {createV4} from '../v4.mjs';

const products=[{id:'a',name:'焼きそば',price:500,active:true},{id:'b',name:'お茶',price:150,active:true},{id:'c',name:'休止',price:100,active:false}];
const report={salesGross:120000,refundsTotal:5000,cashSales:90000,cashlessSales:25000,cashVariance:-200,cashlessVariance:-100,openSessions:0,closedSessions:2,saleCount:200,refundCount:5};
test('POS net book sales add to legacy, with refunds subtracted only once',()=>{
 const f=v4Summary({sales:10000},report,[]);assert.equal(f.posNet,115000);assert.equal(f.bookSales,125000);assert.equal(f.loss,300);assert.equal(f.variance,-300);
});
test('overage is not silently allocated as revenue',()=>{
 const f=v4Summary({sales:0},{...report,cashVariance:500,cashlessVariance:-100},[]);assert.equal(f.bookSales,115000);assert.equal(f.variance,400);assert.equal(f.loss,0);
});
test('midday snapshots calculate cash float and cash movements separately',()=>{
 assert.equal(cashExpected(10000,50000,1000,-2000),57000);
 assert.equal(countDifference(57000,56800),-200);
 assert.throws(()=>countDifference(1000,-1));
});
test('cart sum uses persisted product prices, rejects disabled product and invalid quantities',()=>{
 assert.deepEqual(aggregateCart({a:2,b:1},products),{items:[{product_id:'a',quantity:2},{product_id:'b',quantity:1}],total:1150});
 assert.throws(()=>aggregateCart({c:1},products));assert.throws(()=>aggregateCart({a:-1},products));
});
test('final payout requires fully closed sessions, no pending records, no previous finalization',()=>{
 const ready=v4Summary({sales:0},report,[]);assert.equal(canFinalize(ready,0),true);
 assert.equal(canFinalize(ready,1),false);
 assert.equal(canFinalize(v4Summary({sales:0},{...report,openSessions:1},[]),0),false);
 assert.equal(canFinalize(v4Summary({sales:0},report,[],{event_id:'x'}),0),false);
});
test('SQL contract includes controlled transactions, mid-check pause and close, immutable checkout log',()=>{
 const sql=readFileSync(new URL('../supabase/upgrade_v3_to_v4.sql',import.meta.url),'utf8');
 for(const x of ['pos_checkout','pos_refund','pos_pause_for_count','pos_complete_count','pos_close_session','pos_finalize','pos_register_purchase','settlement_finalizations','pos_purchase_entries','pos_sale_consumption','register_only_one_open','for update','enable row level security','stock_audit','pos_session_status','guard_member_finalized'])assert.ok(sql.includes(x),x);
 assert.match(sql,/create function public\.pos_checkout[\s\S]*?insert into public\.pos_sale_consumption/);
 assert.match(sql,/if s\.paused then raise exception/);
 assert.match(sql,/revoke all on public\.%I from public,anon,authenticated/);
});

test('v4 views render five operational screens from the same event and respect cash pause',async()=>{
 const rows={pos_registers:[{id:'r',event_id:'e',name:'1号レジ',created_at:'2026-10-20'}],pos_products:[{id:'p',event_id:'e',name:'焼きそば',price:500,category:'食品',active:true,track_stock:true,stock_qty:10,created_at:'2026-10-20'}],inventory_items:[{id:'i',event_id:'e',name:'麺',unit:'玉',qty:100,low_threshold:10,created_at:'2026-10-20'}],product_recipes:[{event_id:'e',product_id:'p',item_id:'i',quantity:1}],stock_audit:[],pos_purchase_entries:[],register_sessions:[{id:'s',event_id:'e',register_id:'r',opened_at:'2026-10-20',closed_at:null,opening_float:10000,paused:true}],pos_sales:[],pos_sale_lines:[],pos_refunds:[],pos_cash_moves:[],pos_cash_checks:[],settlement_finalizations:[]};
 const mock={from:(table)=>({select:()=>({eq:()=>({order:()=>({limit:async()=>({data:rows[table]||[],error:null})})})})}),rpc:async(name)=>({data:name==='pos_report'?{...report,openSessions:1,closedSessions:0}: {expectedCash:10000,expectedCashless:0,paused:true,closed:false},error:null})};
 const m=createV4({client:()=>mock,event:()=> 'e',current:()=>({sales:0}),admin:()=>true,people:()=>[],pending:()=>0,render:()=>{},reload:async()=>{},notice:()=>{},openV4:()=>{}});
 await m.load();
 for(const [tab,phrase] of [['pos','レジ・POS'],['catalog','商品・メニュー'],['inventory','在庫・仕入れ'],['cash','現金点検'],['reconcile','売上照合']])assert.ok(m.view(tab).includes(phrase),tab);
 assert.match(m.view('pos'),/焼きそば/);
 assert.match(m.view('pos'),/disabled/);
 assert.match(m.view('cash'),/点検を完了する/);
 assert.match(m.view('inventory'),/仕入れと経費を同時登録/);
 assert.match(m.view('reconcile'),/帳簿売上合計/);
});
test('accounting remains attached to v3 stable IDs and the old tests still pass',()=>{
 const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 assert.match(app,/normalizeCloud\(currentEvent/);
 assert.match(app,/state\.sales=fin\.bookSales/);
 assert.match(app,/state\.reserve\+=fin\.loss/);
 assert.match(app,/V4_TABS\.includes\(tab\)/);
});
