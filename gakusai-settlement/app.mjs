import { TYPES, FUND, defaultData, calculate, validateImport } from './engine.mjs';

const STORE_KEY = 'gakusai-settlement-data-v1';
const NAV = [
  {id:'dashboard', label:'概要', icon:'▦'},
  {id:'activities', label:'貢献記録', icon:'◷'},
  {id:'expenses', label:'立替・経費', icon:'▤'},
  {id:'money', label:'資金・精算', icon:'↔'},
  {id:'settings', label:'参加者・設定', icon:'⚙'},
];
const $ = selector => document.querySelector(selector);
const yen = n => `${Math.abs(n).toLocaleString('ja-JP')}円`;
const signedYen = n => `${n < 0 ? '−' : ''}${yen(n)}`;
const points = n => Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString();
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const dateToday = () => {const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateLabel = d => d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.replaceAll('-','/') : '日付なし';
const sum = (rows, f=x=>x.amount) => rows.reduce((acc,row)=>acc+f(row),0);
const typeName = type => TYPES.find(t=>t.id===type)?.label ?? 'その他';
const short = text => text && text.length > 30 ? text.slice(0,30)+'…' : (text || '—');
const strOr = (value, fallback='') => (typeof value === 'string' ? value : fallback);
let state;
try { const raw=localStorage.getItem(STORE_KEY); state=raw ? validateImport(JSON.parse(raw)) : defaultData(); }
catch(err) { console.warn('Cannot load stored data:',err); state=defaultData(); alert('保存データを読み込めませんでした。上書きする前に、ブラウザ内のデータを確認してください。'); }
let currentTab='dashboard';
let editing = null;
let toastTimer;

function save() {
  try {localStorage.setItem(STORE_KEY, JSON.stringify(state));}
  catch(err){alert('ブラウザへの保存に失敗しました。容量不足やプライベートモードをご確認ください。バックアップを保存してください。'); throw err;}
}
function mutate(fn){fn(); save(); render();}
function notice(message){const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600);}
function named(id){return id===FUND ? '運営金庫' : state.people.find(p=>p.id===id)?.name ?? '(未登録)';}
function navRender(){
  const markup=NAV.map(n=>`<button type="button" class="nav-item ${currentTab===n.id?'active':''}" data-tab="${n.id}" aria-current="${currentTab===n.id?'page':'false'}"><span class="nav-icon">${n.icon}</span><span>${n.label}</span></button>`).join('');
  $('#desktop-nav').innerHTML=markup;
  $('#mobile-nav').innerHTML=markup;
}
function heading(title,desc,actions='') {return `<div class="page-heading"><div><h1>${title}</h1><p>${desc}</p></div><div class="heading-actions">${actions}</div></div>`;}
function button(label,action,variant='primary',extra=''){return `<button type="button" class="btn btn-${variant}" data-action="${action}" ${extra}>${label}</button>`;}
function empty(title,description,action='',label='') {return `<div class="empty"><div class="empty-mark">—</div><strong>${title}</strong><p>${description}</p>${action?button(label,action,'soft'):''}</div>`;}
function metric(label,value,foot='',tone=''){return `<div class="metric"><span class="metric-label">${label}</span><strong class="metric-value ${tone}">${value}</strong>${foot?`<small>${foot}</small>`:''}</div>`;}
function summaryPerson(p){return `<div class="person-summary-row"><div class="person-ident"><span class="avatar">${esc(p.name.slice(0,1))}</span><div><strong>${esc(p.name)}</strong><small>${points(p.points)} pt / 分配 ${yen(p.share)}</small></div></div><span class="amount ${p.balance<0?'negative':''}">${p.balance<0?'支払 '+yen(p.balance):'受取 '+yen(p.balance)}</span></div>`;}

function dashboardView(c) {
  const netNotice = c.net<0 ? `<div class="alert alert-danger"><strong>赤字 ${yen(c.net)}</strong>　利益配分は実行されません。追加負担のルールは参加者間で決めてください。</div>`
    : c.net>0 && !c.totalPoints ? `<div class="alert alert-warn">貢献ポイントが未登録のため、利益 ${yen(c.net)} はまだ配分していません。</div>` : '';
  const allocations = c.byPerson.length ? c.byPerson.map(summaryPerson).join('') : empty('参加者がいません','参加者を追加してから、貢献や立替を登録します。','add-person','参加者を追加');
  const latest = [
    ...state.activities.map(a=>({kind:'貢献',when:a.date,title:`${named(a.personId)} / ${typeName(a.type)}`,detail:`${points(a.quantity*a.rate)} pt`})),
    ...state.expenses.map(e=>({kind:e.paidBy===FUND?'経費':'立替',when:e.date,title:e.title,detail:`${yen(e.amount)} / ${named(e.paidBy)}`})),
    ...state.deposits.map(d=>({kind:'拠出',when:d.date,title:`${named(d.personId)} / 運営資金`,detail:yen(d.amount)})),
    ...state.transfers.map(t=>({kind:'送金',when:t.date,title:`${named(t.from)} → ${named(t.to)}`,detail:yen(t.amount)})),
  ].sort((a,b)=>b.when.localeCompare(a.when)).slice(0,5);
  return `
    ${heading(esc(state.eventName),'売上の分配と立替精算をまとめて確認します。',button('売上・留保金を設定','edit-budget'))}
    ${netNotice}
    <div class="metric-grid">${metric('売上総額',yen(c.sales),'手入力した総額')}${metric('経費合計',yen(c.expensesTotal),'立替分を含む')}${metric('分配対象利益',signedYen(c.net),'売上 − 経費 − 留保金',c.net<0?'negative':'positive')}${metric('貢献ポイント合計',`${points(c.totalPoints)} pt`,`${state.people.length} 人の参加者`)}</div>
    <div class="content-grid">
      <section class="panel"><div class="panel-heading"><h2>参加者別の受取予定額</h2><button class="text-link" data-tab="money">精算を確認 →</button></div><p class="panel-description">利益配分と立替・拠出の返金を含む、送金記録反映後の残額です。</p><div class="row-list">${allocations}</div></section>
      <section class="panel"><div class="panel-heading"><h2>精算状況</h2></div><div class="settlement-facts"><div><span>運営金庫の現在残高</span><strong>${signedYen(c.fundCash)}</strong></div><div><span>留保金</span><strong>${yen(c.reserve)}</strong></div><div><span>金庫の精算可能額</span><strong class="${c.fundAvailable<0?'negative':''}">${signedYen(c.fundAvailable)}</strong></div><div><span>残りの送金候補</span><strong>${c.blocked?'—':c.suggestions.length+' 件'}</strong></div></div>${c.blocked?`<p class="hint warn-text">${esc(c.blocked)}</p>`:button('送金案を見る','goto-money','soft','data-goto="money"')}</section>
      <section class="panel"><div class="panel-heading"><h2>最近の記録</h2></div>${latest.length?`<div class="row-list">${latest.map(x=>`<div class="history-row"><div><span class="tag">${x.kind}</span><strong>${esc(x.title)}</strong><small>${dateLabel(x.when)}</small></div><span>${esc(x.detail)}</span></div>`).join('')}</div>`:empty('まだ記録がありません','貢献や立替が発生したら追加してください。')}</section>
      <section class="panel"><div class="panel-heading"><h2>記録を追加</h2></div><div class="quick-actions">${button('貢献を記録','add-activity','light')}${button('立替・経費を記録','add-expense','light')}${button('運営資金の拠出','add-deposit','light')}${button('送金を記録','add-transfer','light')}</div><p class="hint">買い出し等のポイントと、購入費用の立替は別々に記録します。</p></section>
    </div>`;
}
function activitiesView(c){
  const people = [...c.byPerson].sort((a,b)=>b.points-a.points);
  const max = Math.max(1,...people.map(p=>p.points));
  const table = [...state.activities].sort((a,b)=>b.date.localeCompare(a.date)).map(a=>`
    <div class="entry-row"><div class="entry-main"><strong>${esc(named(a.personId))}</strong><span class="tag">${esc(typeName(a.type))}</span><small>${dateLabel(a.date)}${a.note?' ・ '+esc(short(a.note)):''}</small></div><div class="entry-right"><strong>${points(a.quantity*a.rate)} pt</strong><small>${points(a.quantity)} 回 × ${points(a.rate)} pt</small></div><div class="entry-buttons"><button data-action="edit-activity" data-id="${esc(a.id)}">編集</button><button data-action="delete-activity" data-id="${esc(a.id)}" class="delete">削除</button></div></div>`).join('');
  return `${heading('貢献記録','準備・買い出し・車出し・当日運営などをポイント化します。',button('貢献を追加','add-activity'))}
    <div class="content-grid"><section class="panel"><div class="panel-heading"><h2>参加者別ポイント</h2><span class="muted">合計 ${points(c.totalPoints)} pt</span></div>${people.length?people.map(p=>`<div class="point-row"><div class="point-row-head"><strong>${esc(p.name)}</strong><span>${points(p.points)} pt</span></div><div class="progress"><div style="width:${100*p.points/max}%"></div></div></div>`).join(''):empty('参加者を登録してください','設定画面で名前を追加します。','add-person','参加者を追加')}</section>
    <section class="panel"><div class="panel-heading"><h2>ポイント単価</h2><button class="text-link" data-tab="settings">設定を変更 →</button></div><div class="rate-list">${TYPES.map(t=>`<div><span>${t.label}</span><strong>${points(state.rates[t.id])} pt / 回</strong></div>`).join('')}</div><p class="hint">変更した単価は新しい記録から適用。過去の記録は変更されません。</p></section></div>
    <section class="panel panel-full"><div class="panel-heading"><h2>貢献の履歴</h2><span class="muted">${state.activities.length} 件</span></div>${table||empty('まだ貢献記録がありません','作業を行った人・内容・回数を登録します。','add-activity','最初の貢献を記録')}</section>`;
}
function expensesView(c){
  const rows=[...state.expenses].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`
  <div class="entry-row"><div class="entry-main"><strong>${esc(e.title)}</strong><span class="tag">${e.paidBy===FUND?'金庫払い':'立替'}</span><small>${dateLabel(e.date)}${e.note?' ・ '+esc(short(e.note)):''}</small></div><div class="entry-right"><strong>${yen(e.amount)}</strong><small>${esc(named(e.paidBy))}が支払</small></div><div class="entry-buttons"><button data-action="edit-expense" data-id="${esc(e.id)}">編集</button><button data-action="delete-expense" data-id="${esc(e.id)}" class="delete">削除</button></div></div>`).join('');
  return `${heading('立替・経費','出店に使った費用と、誰が支払ったかを記録します。',button('経費を追加','add-expense'))}
    <div class="metric-grid three">${metric('経費合計',yen(c.expensesTotal))}${metric('個人の立替合計',yen(c.personalExpenses),'利益配分とは別に返済')}${metric('運営金庫からの支出',yen(c.fundExpenses))}</div>
    <div class="alert alert-info">買い出しに行った人の<strong>貢献ポイント</strong>は「貢献記録」で、材料代などの<strong>購入費用</strong>はここで登録します。同じ支出を二重登録しないでください。</div>
    <section class="panel panel-full"><div class="panel-heading"><h2>支出一覧</h2><span class="muted">${state.expenses.length} 件</span></div>${rows||empty('経費の記録がありません','材料費・備品代・ガソリン代などを登録してください。','add-expense','経費を追加')}</section>`;
}
function moneyView(c){
  const transfers = [...state.transfers].sort((a,b)=>b.date.localeCompare(a.date)).map(t=>`<div class="entry-row"><div class="entry-main"><strong>${esc(named(t.from))} → ${esc(named(t.to))}</strong><small>${dateLabel(t.date)}${t.note?' ・ '+esc(short(t.note)):''}</small></div><div class="entry-right"><strong>${yen(t.amount)}</strong></div><div class="entry-buttons"><button data-action="edit-transfer" data-id="${esc(t.id)}">編集</button><button class="delete" data-action="delete-transfer" data-id="${esc(t.id)}">削除</button></div></div>`).join('');
  const deposits = [...state.deposits].sort((a,b)=>b.date.localeCompare(a.date)).map(d=>`<div class="entry-row"><div class="entry-main"><strong>${esc(named(d.personId))} → 運営金庫</strong><small>${dateLabel(d.date)}${d.note?' ・ '+esc(short(d.note)):''}</small></div><div class="entry-right"><strong>${yen(d.amount)}</strong></div><div class="entry-buttons"><button data-action="edit-deposit" data-id="${esc(d.id)}">編集</button><button class="delete" data-action="delete-deposit" data-id="${esc(d.id)}">削除</button></div></div>`).join('');
  const perPerson=c.byPerson.map(p=>`<tr><td><strong>${esc(p.name)}</strong><small>${points(p.points)} pt</small></td><td class="num">${yen(p.share)}</td><td class="num">${yen(p.paidExpenses)}</td><td class="num">${yen(p.contributed)}</td><td class="num">${signedYen(p.received-p.sent)}</td><td class="num bold ${p.balance<0?'negative':'positive'}">${signedYen(p.balance)}</td></tr>`).join('');
  const suggestions=c.suggestions.map((s,i)=>`<div class="settlement-row"><span class="step">${i+1}</span><div class="settlement-description"><strong>${esc(s.fromName)} <span class="arrow">→</span> ${esc(s.toName)}</strong><small>送金する金額</small></div><strong class="settlement-sum">${yen(s.amount)}</strong><button class="btn btn-soft btn-small" data-action="record-suggestion" data-from="${esc(s.from)}" data-to="${esc(s.to)}" data-amount="${s.amount}">支払いを記録</button></div>`).join('');
  return `${heading('資金・精算','運営金庫への拠出・参加者間の送金・最終的な支払先を管理します。',button('送金を記録','add-transfer'))}
  <div class="metric-grid three">${metric('運営金庫残高',signedYen(c.fundCash),'売上 ＋ 拠出 − 金庫支出 ± 送金')}${metric('留保金',yen(c.reserve))}${metric('精算可能な金庫残高',signedYen(c.fundAvailable),'金庫残高 − 留保金',c.fundAvailable<0?'negative':'')}</div>
  <section class="panel panel-full"><div class="panel-heading"><h2>自動精算案</h2><span class="muted">${c.blocked?'要確認':c.suggestions.length+' 件'}</span></div><p class="panel-description">現在のポイント配分・立替・拠出・送金履歴から、残額を解消するための送金先を算出します。</p>
  ${c.blocked?`<div class="alert alert-warn">${esc(c.blocked)}</div>`:c.suggestions.length?suggestions:empty('未精算の送金はありません','現在の記録では残額がありません。')}<p class="hint">送金はこのアプリから実行されません。現金・銀行振込等で実際に支払った後、「支払いを記録」を押してください。</p></section>
  <section class="panel panel-full"><div class="panel-heading"><h2>参加者別の精算内訳</h2></div><div class="table-scroll"><table><thead><tr><th>参加者</th><th>利益配分</th><th>経費立替</th><th>資金拠出</th><th>受取済−支払済</th><th>受取残額</th></tr></thead><tbody>${perPerson||'<tr><td colspan="6">参加者がいません</td></tr>'}</tbody></table></div><p class="hint">マイナスの受取残額は、返金または追加支払いが必要な金額を示します。</p></section>
  <div class="content-grid"><section class="panel"><div class="panel-heading"><h2>運営資金の拠出</h2>${button('追加','add-deposit','light')}</div><p class="panel-description">仕入れ前に金庫へ入れた自己資金など。費用ではなく返金対象です。</p><div class="row-list">${deposits||empty('拠出記録なし','立替で購入した場合は、こちらではなく経費に登録します。')}</div></section>
  <section class="panel"><div class="panel-heading"><h2>支払い・送金履歴</h2>${button('追加','add-transfer','light')}</div><p class="panel-description">送金や返金が完了したときだけ記録します。</p><div class="row-list">${transfers||empty('送金履歴なし','まだ精算の支払いは記録されていません。')}</div></section></div>`;
}
function settingsView(){
  const people=state.people.map(p=>`<div class="person-setting"><div class="person-ident"><span class="avatar">${esc(p.name.slice(0,1))}</span><strong>${esc(p.name)}</strong></div><div class="entry-buttons"><button data-action="edit-person" data-id="${esc(p.id)}">編集</button><button class="delete" data-action="delete-person" data-id="${esc(p.id)}">削除</button></div></div>`).join('');
  return `${heading('参加者・設定','メンバー、分配ルール、売上とバックアップを管理します。',button('参加者を追加','add-person'))}
  <div class="content-grid">
    <section class="panel"><div class="panel-heading"><h2>参加者</h2><span class="muted">${state.people.length} 人</span></div><div class="row-list">${people||empty('参加者を追加してください','精算対象のメンバーを登録します。','add-person','追加')}</div></section>
    <section class="panel"><div class="panel-heading"><h2>イベント・売上</h2></div><div class="rate-list"><div><span>イベント名</span><strong>${esc(state.eventName)}</strong></div><div><span>売上総額</span><strong>${yen(state.sales)}</strong></div><div><span>留保金</span><strong>${yen(state.reserve)}</strong></div></div>${button('イベント情報を編集','edit-budget','soft')}</section>
    <section class="panel"><div class="panel-heading"><h2>ポイント配点</h2></div><p class="panel-description">ポイントは、利益を参加者間で配分するための重みです。回数の基準と単価は運営メンバーで事前に決めてください。</p><div class="rate-list">${TYPES.map(t=>`<div><span>${t.label}</span><strong>${points(state.rates[t.id])} pt / 回</strong></div>`).join('')}</div>${button('ポイント単価を編集','edit-rates','soft')}<p class="hint">新しい貢献記録にのみ適用します。以前の記録は編集しない限り変更しません。</p></section>
    <section class="panel"><div class="panel-heading"><h2>データの保存・移行</h2></div><div class="setting-actions">${button('JSONをバックアップ','download-backup','light')}${button('バックアップを復元','import-backup','light')}${button('CSVを出力','export-csv','light')}</div><p class="hint">データはこのブラウザだけに保存されます。スマホとPCの自動同期はありません。端末変更・ブラウザデータ削除に備え、JSONファイルを定期的に保存してください。</p></section>
    <section class="panel"><div class="panel-heading"><h2>検証・初期化</h2></div><div class="setting-actions">${button('サンプルデータを読み込む','load-demo','light')}${button('すべて初期化','reset-data','danger')}</div><p class="hint">現在のデータを置き換えます。操作前にバックアップを保存してください。</p></section>
  </div>`;
}
function render(){
  navRender();
  $('#top-label').textContent=state.eventName;
  const c=calculate(state);
  const map={dashboard:()=>dashboardView(c),activities:()=>activitiesView(c),expenses:()=>expensesView(c),money:()=>moneyView(c),settings:()=>settingsView(c)};
  $('#view').innerHTML=map[currentTab]();
}
function selectTab(tab){if(NAV.some(n=>n.id===tab)){currentTab=tab;render();window.scrollTo({top:0,behavior:'instant'});}}

function optionsPeople(current, includeFund=false){return `${includeFund?`<option value="fund" ${current===FUND?'selected':''}>運営金庫</option>`:''}${state.people.map(p=>`<option value="${esc(p.id)}" ${current===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}`;}
function inputField(label,name,type='text',value='',other=''){return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${other} required></label>`;}
function selectField(label,name,options){return `<label class="field"><span>${label}</span><select name="${name}" required>${options}</select></label>`;}
function noteField(value=''){return `<label class="field"><span>メモ（任意）</span><textarea name="note" rows="2" maxlength="300" placeholder="内容・用途など">${esc(value)}</textarea></label>`;}
function moneyField(label,name,value=0){return inputField(label,name,'number',value,'min="0" max="999999999" step="1" inputmode="numeric"');}
function requiredMoneyField(label,name,value=1){return inputField(label,name,'number',value,'min="1" max="999999999" step="1" inputmode="numeric"');}
function dateField(value){return inputField('日付','date','date',value || dateToday());}
function openForm(kind,id=null,pre={}){
  const collection = {person:'people',activity:'activities',expense:'expenses',deposit:'deposits',transfer:'transfers'}[kind];
  const record=collection && id ? state[collection].find(x=>x.id===id) : null;
  editing={kind,id};
  let title='';let fields='';
  if(kind==='person') {
    title=id?'参加者を編集':'参加者を追加';
    fields=inputField('名前','name','text',record?.name || '','maxlength="40" placeholder="例：佐藤"');
  } else if(kind==='activity'){
    if(!state.people.length) return needPerson();
    const a=record||{}; const type=a.type||'prep';
    title=id?'貢献記録を編集':'貢献を記録';
    fields=selectField('参加者','personId',optionsPeople(a.personId||pre.personId||state.people[0]?.id))+
      selectField('作業の種類','type',TYPES.map(t=>`<option value="${t.id}" ${type===t.id?'selected':''}>${t.label}</option>`).join(''))+
      `<div class="field-two">${inputField('回数・量','quantity','number',a.quantity??1,'min="0.01" max="100000" step="any" inputmode="decimal"')}${inputField('1回あたりのポイント','rate','number',a.rate??state.rates[type],'min="0" max="100000" step="any" inputmode="decimal"')}</div>`+
      `<p class="field-helper">「1回」の基準をあらかじめ決めてください。例：買い出し1回、車出し1往復など。</p>`+dateField(a.date)+noteField(a.note);
  } else if(kind==='expense') {
    title=id?'経費を編集':'立替・経費を記録';const e=record||{};
    fields=inputField('支出の内容','title','text',e.title||'','maxlength="100" placeholder="例：材料・容器代"')+requiredMoneyField('金額（円）','amount',e.amount??1)+selectField('実際に支払った人','paidBy',optionsPeople(e.paidBy||pre.paidBy||FUND,true))+dateField(e.date)+noteField(e.note)+`<p class="field-helper">「運営金庫」払いは立替精算されません。参加者が私費で払った場合のみ、その人を選択します。</p>`;
  } else if(kind==='deposit'){
    if(!state.people.length)return needPerson();
    title=id?'拠出記録を編集':'運営資金を拠出';const d=record||{};
    fields=selectField('資金を出した参加者','personId',optionsPeople(d.personId||state.people[0]?.id))+requiredMoneyField('金庫へ入れた金額（円）','amount',d.amount??1)+dateField(d.date)+noteField(d.note)+`<p class="field-helper">運営金庫に実際に渡した資金だけを登録します。拠出金は精算時に返金対象になります。</p>`;
  } else if(kind==='transfer'){
    if(!state.people.length)return needPerson();
    const t=record||pre;
    title=id?'送金記録を編集':'実際の送金を記録';
    fields=selectField('支払った側','from',optionsPeople(t.from??FUND,true))+selectField('受け取った側','to',optionsPeople(t.to??state.people[0].id,true))+requiredMoneyField('実際に渡した金額（円）','amount',t.amount??1)+dateField(t.date)+noteField(t.note)+`<p class="field-helper">ここでの記録は、実際に支払い済みの場合だけ追加します。現金や振込を実行する機能はありません。</p>`;
  } else if(kind==='budget'){
    title='イベント・売上の設定';
    fields=inputField('イベント名','eventName','text',state.eventName,'maxlength="80"')+moneyField('売上総額（円）','sales',state.sales)+moneyField('留保金（円）','reserve',state.reserve)+`<p class="field-helper">売上は、会計担当が把握している総額を入力します。細かな商品別売上は記録しません。</p>`;
  } else if(kind==='rates'){
    title='ポイント単価を変更';
    fields=TYPES.map(t=>inputField(`${t.label}（pt / 回）`,t.id,'number',state.rates[t.id],'min="0" max="100000" step="any" inputmode="decimal"')).join('')+`<p class="field-helper">変更は新しい記録から適用されます。既存の貢献ポイントは再計算しません。</p>`;
  }
  $('#dialog-title').textContent=title;
  $('#dialog-fields').innerHTML=fields;
  $('#edit-dialog').showModal();
}
function needPerson(){notice('参加者を先に登録してください');openForm('person');}
function readNumber(fd,key,{positive=false,integer=false}={}){
  const n=Number(fd.get(key));
  if(!Number.isFinite(n)||n<0||(positive&&n===0)||(integer&&!Number.isSafeInteger(n))||n>999999999)throw Error(`${key} に正しい値を入力してください。`);
  return n;
}
function getValue(fd,key){return String(fd.get(key)||'').trim();}
function finishForm(e){
  e.preventDefault();
  const {kind,id}=editing||{};const fd=new FormData(e.currentTarget); let changed=false;
  try {
    if(kind==='budget'){
      const eventName=getValue(fd,'eventName');if(!eventName)throw Error('イベント名を入力してください。');
      const sales=readNumber(fd,'sales',{integer:true}); const reserve=readNumber(fd,'reserve',{integer:true});
      mutate(()=>{state.eventName=eventName;state.sales=sales;state.reserve=reserve;});changed=true;
    } else if(kind==='rates'){
      const rates={};for(const t of TYPES)rates[t.id]=readNumber(fd,t.id);
      mutate(()=>{state.rates=rates;});changed=true;
    } else {
      let record={id:id||uid()};
      if(kind==='person'){
        record.name=getValue(fd,'name');if(!record.name)throw Error('名前を入力してください。');
      } else if(kind==='activity'){
        record={...record,personId:getValue(fd,'personId'),type:getValue(fd,'type'),quantity:readNumber(fd,'quantity',{positive:true}),rate:readNumber(fd,'rate'),date:getValue(fd,'date'),note:getValue(fd,'note')};
      } else if(kind==='expense'){
        record={...record,title:getValue(fd,'title'),paidBy:getValue(fd,'paidBy'),amount:readNumber(fd,'amount',{integer:true,positive:true}),date:getValue(fd,'date'),note:getValue(fd,'note')};
        if(!record.title)throw Error('支出の内容を入力してください。');
      } else if(kind==='deposit'){
        record={...record,personId:getValue(fd,'personId'),amount:readNumber(fd,'amount',{integer:true,positive:true}),date:getValue(fd,'date'),note:getValue(fd,'note')};
      } else if(kind==='transfer'){
        record={...record,from:getValue(fd,'from'),to:getValue(fd,'to'),amount:readNumber(fd,'amount',{integer:true,positive:true}),date:getValue(fd,'date'),note:getValue(fd,'note')};
        if(record.from===record.to)throw Error('支払う人と受け取る人は別にしてください。');
      }
      const collection={person:'people',activity:'activities',expense:'expenses',deposit:'deposits',transfer:'transfers'}[kind];
      if(!collection)throw Error('不明な操作です。');
      mutate(()=>{if(id){const i=state[collection].findIndex(x=>x.id===id);if(i>=0)state[collection][i]=record;}else state[collection].push(record);});changed=true;
    }
  } catch(err) {alert(err.message);}
  if(changed){$('#edit-dialog').close();notice('保存しました');}
}
function remove(kind,id){
  const collection={person:'people',activity:'activities',expense:'expenses',deposit:'deposits',transfer:'transfers'}[kind];
  if(!collection)return;
  const x=state[collection].find(row=>row.id===id);if(!x)return;
  if(kind==='person'){
    const referenced = state.activities.some(a=>a.personId===id)||state.expenses.some(e=>e.paidBy===id)||state.deposits.some(d=>d.personId===id)||state.transfers.some(t=>t.from===id||t.to===id);
    if(referenced)return alert('この参加者には記録が紐付いています。関連する記録を削除・編集してから削除してください。');
  }
  if(!confirm('この記録を削除しますか？'))return;
  mutate(()=>state[collection]=state[collection].filter(row=>row.id!==id));notice('削除しました');
}
function download(name,text,contentType){
  const blob=new Blob([text],{type:contentType});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function backup(){download(`gakusai-backup-${dateToday()}.json`,JSON.stringify(state,null,2),'application/json;charset=utf-8');notice('バックアップを出力しました');}
function csvField(value){let s=String(value??''); if (/^\s*[=+@\-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function csv(rows){return '\ufeff'+rows.map(row=>row.map(csvField).join(',')).join('\r\n');}
function exportCsv(){
  const c=calculate(state);
  const rows=[['参加者','ポイント','利益配分（円）','立替（円）','拠出（円）','受取済（円）','支払済（円）','受取残額（円）'],...c.byPerson.map(p=>[p.name,p.points,p.share,p.paidExpenses,p.contributed,p.received,p.sent,p.balance])];
  const log=[['種別','日付','人物/支払者','相手/種別','内容','金額（円）/ポイント','備考'],
    ...state.activities.map(a=>['貢献',a.date,named(a.personId),typeName(a.type),'貢献',a.quantity*a.rate,a.note||'']),
    ...state.expenses.map(e=>['経費',e.date,named(e.paidBy),'出店経費',e.title,e.amount,e.note||'']),
    ...state.deposits.map(d=>['資金拠出',d.date,named(d.personId),'運営金庫','資金拠出',d.amount,d.note||'']),
    ...state.transfers.map(t=>['送金',t.date,named(t.from),named(t.to),'実際の送金',t.amount,t.note||''])];
  download(`gakusai-members-${dateToday()}.csv`,csv(rows),'text/csv;charset=utf-8');
  download(`gakusai-records-${dateToday()}.csv`,csv(log),'text/csv;charset=utf-8');
  notice('CSVを出力しました');
}
function loadDemo(){
  if(!confirm('現在の全データをサンプルに置き換えます。よろしいですか？'))return;
  const names=['佐藤','田中','鈴木','高橋'];const ids=names.map(()=>uid());const d=dateToday();
  mutate(()=>{state={...defaultData(),eventName:'学祭 模擬店（サンプル）',sales:45000,reserve:5000,people:names.map((name,i)=>({id:ids[i],name})),
    activities:[{id:uid(),personId:ids[0],type:'prep',quantity:3,rate:2,date:d,note:'看板・メニューの準備'},{id:uid(),personId:ids[1],type:'shopping',quantity:2,rate:3,date:d,note:'食材の買い出し'},{id:uid(),personId:ids[2],type:'car',quantity:2,rate:4,date:d,note:'荷物の運搬'},{id:uid(),personId:ids[3],type:'operation',quantity:4,rate:2,date:d,note:'当日の接客'}],
    expenses:[{id:uid(),title:'食材・材料',amount:7200,paidBy:ids[1],date:d,note:''},{id:uid(),title:'容器・装飾',amount:3300,paidBy:FUND,date:d,note:''}],
    deposits:[{id:uid(),personId:ids[0],amount:10000,date:d,note:'開店準備資金'}],transfers:[]};});
  currentTab='dashboard';render();notice('サンプルデータを読み込みました');
}
function resetData(){if(!confirm('参加者・支出・送金などの全データを消去します。続けますか？'))return;if(!confirm('本当に初期化しますか？元に戻せません。'))return;mutate(()=>{state=defaultData();});currentTab='dashboard';render();notice('初期化しました');}
function handleAction(e){
  const tabButton=e.target.closest('[data-tab]'); if(tabButton){selectTab(tabButton.dataset.tab);return;}
  const el=e.target.closest('[data-action]'); if(!el)return;
  const {action,id}=el.dataset;
  if(action==='close-dialog'){$('#edit-dialog').close();return;}
  if(action.startsWith('add-'))return openForm(action.slice(4));
  if(action.startsWith('edit-'))return openForm(action.slice(5),id);
  if(action.startsWith('delete-'))return remove(action.slice(7),id);
  switch(action){
    case 'edit-budget':return openForm('budget');
    case 'edit-rates':return openForm('rates');
    case 'download-backup':return backup();
    case 'import-backup':return $('#import-file').click();
    case 'export-csv':return exportCsv();
    case 'load-demo':return loadDemo();
    case 'reset-data':return resetData();
    case 'goto-money':return selectTab('money');
    case 'record-suggestion':{
      const amount=Number(el.dataset.amount);const from=el.dataset.from;const to=el.dataset.to;
      const current=calculate(state).suggestions.some(s=>s.amount===amount&&s.from===from&&s.to===to);
      if(!current)return notice('精算案が変更されました。画面を再読み込みしてください。');
      if(!confirm(`${named(from)} → ${named(to)}：${yen(amount)}\n実際に支払いが完了しましたか？`))return;
      mutate(()=>state.transfers.push({id:uid(),from,to,amount,date:dateToday(),note:'自動精算案から記録'}));notice('支払い済みとして記録しました');return;
    }
  }
}
$('#import-file').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{const incoming=validateImport(JSON.parse(await file.text()));if(!confirm('現在の記録をすべて上書きして復元します。よろしいですか？'))return;state=incoming;save();currentTab='dashboard';render();notice('バックアップを復元しました');}catch(err){alert(`復元に失敗しました：${err.message}`);}
});
$('#edit-form').addEventListener('submit',finishForm);
$('#dialog-fields').addEventListener('change',e=>{
  if(e.target.name!=='type'||editing?.kind!=='activity')return;
  const rate=$('#dialog-fields [name="rate"]');if(rate)rate.value=String(state.rates[e.target.value]??0);
});
document.addEventListener('click',handleAction);
render();
if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Offline cache unavailable',err));
