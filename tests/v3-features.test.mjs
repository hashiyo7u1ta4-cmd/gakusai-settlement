import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCloud} from '../cloud-model.mjs';
import {calculate,allocateYen} from '../engine.mjs';
import {ACTIVITY_UNITS, EXTRA_RATES, activityRateKey} from '../activity-units.mjs';
import {accountKind,oauthReturnUrl} from '../auth-helpers.mjs';

const base = new URL('../',import.meta.url);
const app = readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
const migration = readFileSync(new URL('../supabase/upgrade_v2_to_v3.sql',import.meta.url),'utf8');
const fresh = readFileSync(new URL('../supabase/setup.sql',import.meta.url),'utf8');
const id='11111111-1111-4111-8111-111111111111';
const auth='99999999-9999-4999-8999-999999999999';
const rates={prep:2,shopping:3,car:4,operation:2,other:1,...EXTRA_RATES};
const evt={event_name:'学祭',sales:30000,reserve:0,rates};

test('same person ID and balance survive unlinked -> Google-linked authentication',()=>{
 const baseMember={member_id:id,display_name:'テスト参加者',role:'member'};
 const activity={id:'record-1',event_id:'event-x',person_id:id,type:'shopping',unit:'hours',quantity:'3',rate:'3',status:'approved',record_date:'2026-10-20',created_at:'2026-10-20'};
 const before=normalizeCloud(evt,[{...baseMember,user_id:null}],[activity]);
 const after=normalizeCloud(evt,[{...baseMember,user_id:auth}],[activity]);
 assert.equal(before.people[0].id,after.people[0].id);
 assert.equal(before.people[0].userId,null);
 assert.equal(after.people[0].userId,auth);
 assert.equal(calculate(before.state).byPerson[0].share,30000);
 assert.equal(calculate(after.state).byPerson[0].share,30000);
});
test('renaming display name does not change the accounting identity or allocation',()=>{
 const member={member_id:id,user_id:auth,role:'member'};
 const act={person_id:id,type:'car',unit:'km',quantity:'7.5',rate:'0.2',status:'approved',record_date:'2026-10-20'};
 const before=normalizeCloud(evt,[{...member,display_name:'A'}],[act]);
 const after=normalizeCloud(evt,[{...member,display_name:'変更後'}],[act]);
 const c1=calculate(before.state),c2=calculate(after.state);
 assert.equal(before.people[0].id,after.people[0].id);
 assert.equal(c1.byPerson[0].points,1.5);
 assert.equal(c2.byPerson[0].points,1.5);
 assert.equal(c1.byPerson[0].share,c2.byPerson[0].share);
 assert.equal(c2.byPerson[0].name,'変更後');
});
test('activity unit/rate mapping includes all supported types and rejects illegal units',()=>{
 assert.deepEqual(ACTIVITY_UNITS.car,['count','km']);
 assert.equal(activityRateKey('car','km'),'car_km');
 assert.equal(activityRateKey('shopping','hours'),'shopping_hour');
 assert.equal(activityRateKey('prep','count'),'prep');
 assert.throws(()=>activityRateKey('car','hours'),/無効/);
 assert.throws(()=>activityRateKey('operation','km'),/無効/);
});
test('Google OAuth account classification and safe local callback URLs',()=>{
 assert.equal(accountKind(null),'signed-out');
 assert.equal(accountKind({is_anonymous:true}),'anonymous');
 assert.equal(accountKind({is_anonymous:false,app_metadata:{providers:['google']}}),'google');
 assert.equal(accountKind({is_anonymous:false,identities:[{provider:'google'}]}),'google');
 assert.equal(oauthReturnUrl({protocol:'http:',origin:'http://localhost:8000',pathname:'/'}),'http://localhost:8000/');
 assert.equal(oauthReturnUrl({protocol:'https:',origin:'https://demo.github.io',pathname:'/gakusai/'}),'https://demo.github.io/gakusai/');
 assert.throws(()=>oauthReturnUrl({protocol:'file:',origin:'null',pathname:'/x'}),/localhost/);
});
test('client uses linkIdentity for legacy members, signInWithOAuth for signed-out members, PKCE redirect detected',()=>{
 assert.match(app,/client\.auth\.linkIdentity\(\{provider:'google'/);
 assert.match(app,/client\.auth\.signInWithOAuth\(\{provider:'google'/);
 assert.match(app,/detectSessionInUrl:true,flowType:'pkce'/);
 assert.match(app,/signOut\(\{scope:'local'\}\)/);
 assert.match(app,/if\(!user\)throw Error\('まずGoogleでログイン/);
 assert.match(app,/function landingView\(\).*?if\(!user\)/s);
 assert.match(app,/else if\(kind==='rename'\).*?rename_me/s);
});
test('SQL migration maintains author history while detaching login from member',()=>{
 assert.match(migration,/foreign key\(created_by\) references auth\.users\(id\)/);
 assert.doesNotMatch(migration,/foreign key\(event_id,created_by\) references public\.event_members/);
 assert.match(migration,/member_id uuid/);
 assert.match(migration,/claim_hash text/);
 assert.match(migration,/create function public\.claim_participant/);
 assert.match(migration,/update public\.event_members set user_id=auth\.uid\(\),claim_hash=null/);
 assert.match(migration,/where event_id=v_event_id and user_id=auth\.uid\(\)/);
 assert.match(migration,/create or replace function public\.recover_admin/);
 assert.match(fresh,/create table if not exists public\.events/);
 assert.match(fresh,/create function public\.claim_participant/);
 assert.equal((fresh.match(/^begin;$/gm)||[]).length,1);
 assert.equal((fresh.match(/^commit;$/gm)||[]).length,1);
});
test('allocation retains every yen after fractional kilometer points',()=>{
 const alloc=allocateYen(1003,[{id:'a',points:1.5},{id:'b',points:2.25},{id:'c',points:0.4}]);
 assert.equal(Object.values(alloc).reduce((a,b)=>a+b),1003);
});
