import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const sample={version:1,eventName:'テスト模擬店',sales:45000,reserve:5000,rates:{prep:2,shopping:3,car:4,operation:2,other:1},
people:[{id:'a',name:'佐藤'},{id:'b',name:'田中'}],
activities:[{id:'aa',personId:'a',type:'prep',quantity:1,rate:2,date:'2026-10-20',note:''},{id:'ab',personId:'b',type:'car',quantity:1,rate:4,date:'2026-10-20',note:''}],
expenses:[{id:'ea',paidBy:'a',amount:3000,title:'食材',date:'2026-10-20',note:''}],deposits:[],transfers:[]};
const elements=new Map();
const mockElement=()=>({textContent:'',innerHTML:'',value:'',classList:{add(){},remove(){}},addEventListener(){},showModal(){},close(){},click(){}});
globalThis.localStorage={getItem:()=>JSON.stringify(sample),setItem(){}};
globalThis.document={querySelector(sel){if(!elements.has(sel))elements.set(sel,mockElement());return elements.get(sel);},addEventListener() {}};
globalThis.location={protocol:'file:'};globalThis.window={scrollTo(){}};
const code=readFileSync(new URL('../app.mjs',import.meta.url),'utf8')+'\nexport { selectTab, openForm, calculate, state };';
const tempUrl=new URL('../.test-app-temp.mjs',import.meta.url);
writeFileSync(tempUrl,code);
const mod=await import(tempUrl.href+'?time=1');
assert.match(elements.get('#view').innerHTML,/45,000円/);
for (const [tab, expected] of [['activities','参加者別ポイント'],['expenses','個人の立替合計'],['money','自動精算案'],['settings','ポイント配点'],['dashboard','受取予定額']]) {
 mod.selectTab(tab);
 assert.ok(elements.get('#view').innerHTML.includes(expected),tab+' rendering issue');
}
mod.openForm('activity');assert.match(elements.get('#dialog-fields').innerHTML,/作業の種類/);
mod.openForm('expense');assert.match(elements.get('#dialog-fields').innerHTML,/実際に支払った人/);
mod.openForm('transfer');assert.match(elements.get('#dialog-fields').innerHTML,/受け取った側/);
console.log('UI smoke PASS: 5 screens and 3 forms');
