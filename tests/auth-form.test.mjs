import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The submit event bubbles to document: currentTarget is document, while target is the HTML form.
// Test the actual authSubmit function with a FormData stand-in that rejects non-form elements.
test('delegated auth form submission uses the form element and reaches event creation RPC', async () => {
  const src=readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
  const start=src.indexOf('async function authSubmit(e){');
  const end=src.indexOf('async function refreshMemberships()',start);
  assert.ok(start>0 && end>start, 'authSubmit function exists');
  const form={tagName:'FORM',values:new Map([['displayName','テスト管理者'],['eventName','学祭2026']])};
  const document={tagName:'DOCUMENT'};
  const seen=[];
  const context={
    busy:false,authMode:'create',eventId:null,localKey:'test-selected-event',
    FormData: class { constructor(node){assert.equal(node,form,'must pass submit target form');}get(key){return form.values.get(key)??null;} },
    render(){},ensureUser:async()=>({id:'test-id'}),code:()=> 'a'.repeat(32),
    client:{rpc:async(name,args)=>{seen.push({name,args});return {data:'event-id',error:null};}},
    check:r=>r.data,cacheCode(){},alert(message){seen.push({alert:message});},
    localStorage:{setItem(){}},refreshAll:async()=>{},notice(){},showError(e){throw e;}
  };
  const fn=vm.runInNewContext(src.slice(start,end)+'\nauthSubmit',context);
  let prevented=false;
  await fn({target:form,currentTarget:document,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  const rpc=seen.find(x=>x.name==='create_event');
  assert.ok(rpc,'creates event after form submission');
  assert.equal(rpc.args.p_event_name,'学祭2026');
  assert.equal(rpc.args.p_display_name,'テスト管理者');
  assert.ok(seen.some(x=>x.alert?.includes('管理者復旧キー')));
  assert.equal(context.eventId,'event-id');
});
