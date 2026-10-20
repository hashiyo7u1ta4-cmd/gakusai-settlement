import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createV4} from '../v4.mjs';
import {accountKind, oauthReturnUrl, googleLinkProblemMessage} from '../auth-helpers.mjs';
const read=rel=>readFileSync(new URL('../'+rel,import.meta.url),'utf8');
const app=read('app.mjs'),html=read('index.html'),css=read('v4.1.css'),migration=read('supabase/upgrade_v4_to_v4_1.sql');
function mockView({registers=[],sessions=[],materialQty=-100}={}){
 const data={pos_registers:registers,pos_products:[{id:'p',name:'サイダー',price:500,active:true,category:'飲料',track_stock:false,stock_qty:0}],inventory_items:[{id:'i',name:'炭酸水',unit:'mL',qty:materialQty,low_threshold:100}],product_recipes:[{product_id:'p',item_id:'i',quantity:200}],register_sessions:sessions};
 const calls=[],refresh=[];const client={from:(table)=>({select:()=>({eq:()=>({order:()=>({limit:async()=>({data:data[table]||[],error:null})})})})}),rpc:async (fn,args)=>{calls.push([fn,args]);return {data:fn==='pos_report'?{salesGross:0,refundsTotal:0,openSessions:sessions.length,closedSessions:0,saleCount:0,cashVariance:0,cashlessVariance:0}:fn==='pos_session_status'?{expectedCash:10000,expectedCashless:0}:fn==='pos_create_and_open_register'?'session-new':null,error:null};}};
 const v4=createV4({client:()=>client,event:()=> 'e',current:()=>({sales:0}),admin:()=>true,people:()=>[],pending:()=>0,render:()=>refresh.push('render'),reload:async()=>refresh.push('reload'),notice:()=>{},openV4:()=>{}});
 return {v4,calls,refresh};
}
test('phone navigation has exactly four priority links plus menu drawer with accessible controls',()=>{
 assert.match(app,/MOBILE_PRIMARY=\[\{id:'dashboard'/);
 for(const id of ['pos','cash','inventory'])assert.match(app,new RegExp("id:'"+id+"'"));
 assert.match(app,/#mobile-nav'\)\.innerHTML=eventId\?primary\+`/);
 assert.match(html,/id="mobile-drawer"[^>]+aria-modal="true"/);
 assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(app,/if\(e\.key==='Escape'&&mobileDrawerOpen\)|if\(e\.key==='Escape'\)/);
});
test('Google identity is shown from provider claims, with no fake success for an anonymous account',()=>{
 const google={identities:[{provider:'google',identity_data:{email:'test@gmail.com'}}],is_anonymous:true};
 assert.equal(accountKind(google),'google');
 assert.equal(accountKind({is_anonymous:true,identities:[]}), 'anonymous');
 assert.match(app,/Google連携済み（複数端末OK）/);
 assert.match(app,/Google未連携/);
 assert.match(app,/auth\.getUser\(\)/);
 assert.match(app,/client\.auth\.linkIdentity/);
 assert.match(googleLinkProblemMessage({message:'Manual linking disabled'}),/Allow manual linking/);
 assert.equal(oauthReturnUrl(new URL('https://foo.github.io/app/index.html')),'https://foo.github.io/app/index.html');
});
test('POS first register creation combines naming and cash float with a single RPC',async()=>{
 const {v4,calls,refresh}=mockView();await v4.load();
 assert.match(v4.view('pos'),/レジを登録して営業開始/);
 const f=v4.form('register');assert.match(f.fields,/name="float"/);
 await v4.submit('register',newFormData([['name','レジ2'],['float','10000']]));
 assert.deepEqual(calls.at(-1),['pos_create_and_open_register',{p_event:'e',p_name:'レジ2',p_float:10000}]);
 assert.ok(refresh.includes('render'));
});
function newFormData(entries){const fd=new FormData();for(const [k,v] of entries)fd.append(k,v);return fd;}
test('when register exists without active session, POS offers to open it instead of register duplication',async()=>{
 const {v4}=mockView({registers:[{id:'reg1',name:'レジ1'}]});await v4.load();
 assert.match(v4.view('pos'),/営業を開始する/);assert.doesNotMatch(v4.view('pos'),/レジを登録して営業開始/);
 assert.match(v4.form('open-session').fields,/釣銭準備金/);
});
test('raw materials may be negative and POS product remains usable',async()=>{
 const {v4}=mockView({registers:[{id:'reg1',name:'レジ1'}],sessions:[{id:'s1',register_id:'reg1',opened_at:'2026-10-20',closed_at:null,paused:false}],materialQty:-40});await v4.load();
 const page=v4.view('pos');assert.match(page,/材料不足（会計可能）/);assert.match(page,/class="v4-product"\s*>/);
 assert.doesNotMatch(v4.view('inventory'),/販売商品在庫/);
 assert.doesNotMatch(v4.form('product').fields,/name="tracked"/);
});
test('migration changes constraints and functions without dropping transaction tables or auth',()=>{
 for(const name of ['pos_checkout','pos_adjust_stock','pos_save_product','pos_cancel_count','pos_create_and_open_register'])assert.match(migration,new RegExp('(?:CREATE OR REPLACE FUNCTION public\\.)'+name));
 assert.match(migration,/DROP CONSTRAINT IF EXISTS inventory_items_qty_check/);
 assert.match(migration,/set qty=qty-v_inv.qty where id=v_inv.item_id and event_id=s.event_id/);
 assert.doesNotMatch(migration,/qty>=v_inv.qty|完成品在庫が足りません|drop table|delete from auth|truncate/i);
 assert.match(migration,/INSERT INTO public\.register_sessions\(event_id,register_id,opening_float\)/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.pos_create_and_open_register.*authenticated/);
 assert.match(migration,/if not s\.paused then raise exception '点検開始していません'/);
 const cancel=migration.slice(migration.indexOf('FUNCTION public.pos_cancel_count'),migration.indexOf('FUNCTION public.pos_create_and_open_register'));
 assert.doesNotMatch(cancel,/p_require_admin/);
});
test('service worker version changes and caches additional mobile CSS',()=>{
 const sw=read('sw.js');assert.match(sw,/gakusai-settlement-v4-1-complete/);
 assert.match(sw,/\.\/v4\.1\.css/);assert.match(html,/v4\.1\.css/);
});
