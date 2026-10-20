import { TYPES, FUND, defaultData, calculate } from './engine.mjs';
import { ACTIVITY_UNITS, EXTRA_RATES, activityUnitLabel, activityRateKey } from './activity-units.mjs';
import { normalizeCloud } from './cloud-model.mjs';
import { accountKind, oauthReturnUrl, googleLinkProblemMessage } from './auth-helpers.mjs';
import { createV4 } from './v4.mjs';

const cfg = window.GAKUSAI_CONFIG || {};
const $ = (s) => document.querySelector(s);
const NAV = [
  {id:'dashboard',label:'概要',icon:'▦'},
  {id:'pos',label:'レジ・POS',icon:'▣'},
  {id:'catalog',label:'商品管理',icon:'▧'},
  {id:'inventory',label:'在庫・仕入れ',icon:'▥'},
  {id:'cash',label:'現金点検',icon:'▤'},
  {id:'reconcile',label:'売上照合',icon:'≋'},
  {id:'activities',label:'貢献記録',icon:'◷'},
  {id:'expenses',label:'立替・経費',icon:'▤'},
  {id:'money',label:'資金・精算',icon:'↔'},
  {id:'reviews',label:'承認待ち',icon:'✓'},
  {id:'settings',label:'参加者・設定',icon:'⚙'},
];
const localKey='gakusai-cloud-selected-event-v2'; // 旧版の選択状態を維持
const yen=n=>`${Math.abs(n).toLocaleString('ja-JP')}円`;
const signedYen=n=>`${n<0?'−':''}${yen(n)}`;
const points=n=>Number(n).toLocaleString('ja-JP',{maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateLabel=d=>d?String(d).slice(0,10).replaceAll('-','/'):'—';
const typeLabel=t=>TYPES.find(x=>x.id===t)?.label||'その他';
const code=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const statusText=s=>({pending:'承認待ち',approved:'承認済み',rejected:'却下'}[s]||s);
const statusHtml=s=>`<span class="status-tag ${s}">${statusText(s)}</span>`;
const field=(label,name,type='text',value='',attrs='')=>`<label class="field"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(value)}" ${attrs} required></label>`;
const select=(label,name,options)=>`<label class="field"><span>${esc(label)}</span><select name="${name}" required>${options}</select></label>`;
const notes=()=>`<label class="field"><span>メモ（任意）</span><textarea name="note" maxlength="300" rows="2" placeholder="内容・用途など"></textarea></label>`;
const money=(label,name,value='1',zero=false)=>field(label,name,'number',value,`min="${zero?0:1}" max="999999999" step="1" inputmode="numeric"`);
const button=(title,action,sty='soft',extra='')=>`<button type="button" class="btn btn-${sty}" data-action="${action}" ${extra}>${esc(title)}</button>`;
const metric=(label,value,desc='')=>`<div class="metric"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><small>${desc}</small></div>`;
const panel=(name,inner,right='')=>`<section class="panel"><div class="panel-heading"><h2>${name}</h2>${right}</div>${inner}</section>`;
const heading=(title,sub,action='')=>`<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div><div class="heading-actions">${action}</div></div>`;
let client=null, user=null, memberships=[], eventId=null, currentEvent=null, people=[], records={activities:[],expenses:[],deposits:[],transfers:[]};
let state=defaultData(), tab='dashboard', authMode='join', pending=false, toastTimer, channel=null, lastLoadedAt=0, busy=false;
const V4_TABS=['pos','catalog','inventory','cash','reconcile'];
const v4=createV4({client:()=>client,event:()=>eventId,current:()=>currentEvent,admin:()=>isAdmin(),pending:()=>reviewCount(),people:()=>people,notice,render:()=>render(),reload:()=>refreshData(),openV4:(kind,pre)=>openForm('v4-'+kind,pre)});
const isAdmin=()=>memberships.some(m=>m.event_id===eventId&&m.role==='admin');
const me=()=>people.find(p=>p.userId===user?.id);
const myId=()=>me()?.id||null;
const myAuthKind=()=>accountKind(user);
const googleConnected=()=>myAuthKind()==='google';
const shortId=id=>String(id||'').slice(0,8);
const submittedBy=id=>people.find(x=>x.userId===id)?.name||'（元の登録端末）';
const unitLabel=unit=>activityUnitLabel(unit||'count');
const unitSelect=(type,selected='count')=>ACTIVITY_UNITS[type].map(unit=>`<option value="${unit}" ${unit===selected?'selected':''}>${unitLabel(unit)}</option>`).join('');
const named=id=>id===FUND?'運営金庫':people.find(x=>x.id===id)?.name||'（退会済み）';
const byDate=list=>[...list].sort((a,b)=>b.date.localeCompare(a.date)||String(b.created_at||'').localeCompare(String(a.created_at||'')));
const reviewCount=()=>[...records.activities,...records.expenses,...records.deposits].filter(x=>x.status==='pending').length;
function notice(message){const e=$('#toast');e.textContent=message;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),4000);}
function errMsg(e){const googleHint=googleLinkProblemMessage(e);if(googleHint)return googleHint;let m=String(e?.message||e);if(/row-level security|permission denied|42501/i.test(m))return 'この操作の権限がありません。自分の記録、または管理者の権限を確認してください。';if(/duplicate key|23505/.test(m))return '同じデータがすでに登録されています。';if(/Failed to fetch|network|fetch failed/i.test(m))return 'ネットワークに接続できません。通信状況を確認してください。';return m;}
function showError(e){console.error(e);alert(errMsg(e));}
function check(result){if(result.error)throw result.error;return result.data;}
function writeCSV(rows){return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const promptCode=key=>{try{return localStorage.getItem(`gakusai-v2-${key}-${eventId}`)||'';}catch{return '';}};
function cacheCode(key,value){try{localStorage.setItem(`gakusai-v2-${key}-${eventId}`,value);}catch{notice('この端末でコードを記憶できません。安全な場所に控えてください。');}}
const setSync=(txt,err=false)=>{const e=$('#sync-label');e.textContent=txt;e.classList.toggle('sync-error',err);};
function navRender(){const markup=NAV.filter(n=>n.id!=='reviews'||isAdmin()).map(n=>`<button class="nav-item ${tab===n.id?'active':''}" type="button" data-tab="${n.id}"><span class="nav-icon">${n.icon}</span><span>${n.label}${n.id==='reviews'&&reviewCount()?`（${reviewCount()}）`:''}</span></button>`).join('');$('#desktop-nav').innerHTML=eventId?markup:'';$('#mobile-nav').innerHTML=eventId?markup:'';}
function render(){navRender();$('#top-label').textContent=currentEvent?.event_name||'学祭精算';if(!client){return setupView();}if(!eventId){return landingView();}
  const c=calculate(state);
  const f=v4.summary();if(!f.finalized&&(f.saleCount>0||f.closedSessions>0||f.openSessions>0)){c.blocked='POS運用中です。最終レジ締め・売上照合・管理者による利益分配確定まで送金案は表示しません。';c.suggestions=[];}
  $('#view').innerHTML=V4_TABS.includes(tab)?v4.view(tab):({dashboard:dashboardView,activities:activitiesView,expenses:expensesView,money:moneyView,reviews:reviewsView,settings:settingsView}[tab]||dashboardView)(c);
  $('#view').querySelectorAll('[data-percent]').forEach(el=>{el.style.width=Math.max(0,Math.min(100,Number(el.dataset.percent)))+'%';});
}
function setupView(){setSync('初期設定が必要',true);$('#view').innerHTML=`<div class="auth-wrap">${heading('Supabase接続設定が必要です','公開済みのGitHub Pagesに共有データベースを接続します。')}${panel('初期設定','<p>Supabaseで新規プロジェクトを作成し、付属の <code>supabase/setup.sql</code> を実行してください。その後、<code>config.js</code> に Project URL と publishable（または anon）キーを設定してGitHubへ再アップロードします。</p><p class="warning-box">service_role キー、secret key、データベースのパスワードは絶対に入力・公開しないでください。</p>')}</div>`;}
function landingView(){setSync(user?(googleConnected()?'Googleログイン済み':'ログイン済み'):'ログイン待ち');if(!user){$('#view').innerHTML=`<div class="auth-wrap">${heading('Googleアカウントでログイン','同じGoogleアカウントならスマホ・PCで同じ参加者として利用できます。')}${panel('ログイン',`<p>Google認証後、出店への新規参加・事前登録済みIDへの連携・出店作成ができます。</p>${button('Googleでログイン','google-auth','primary')}<p class="hint">初回ログインだけでは出店に参加しません。招待コードまたは本人専用連携コードを使用してください。</p>`)}</div>`;return;}const members=memberships.length?panel('参加済みのイベント',`<div class="profile-list">${memberships.map(m=>`<div class="person-summary-row"><div><strong>${esc(m.events?.event_name||'イベント')}</strong><small>${esc(m.display_name)} / ${m.role==='admin'?'管理者':'参加者'}</small></div>${button('開く','choose-event','soft',`data-id="${esc(m.event_id)}"`)}</div>`).join('')}</div>`):'';
 const modeTitle={join:'招待コードで参加',claim:'事前登録済みの参加者として参加',create:'新しい出店を作成',recover:'管理者権限を復旧'};
 const acct=googleConnected()?`<div class="account-banner"><span><strong>Googleログイン済み</strong><small>${esc(user.email||'Googleアカウント')}</small></span>${button('ログアウト','signout','light')}</div>`:`<div class="warning-box account-banner"><span><strong>旧版の匿名アカウントを利用中です</strong><small>先にGoogleと連携すると、既存の参加者ID・貢献・立替が引き継がれます。Supabase側で「Allow manual linking」を有効化してください。</small></span>${button('Googleアカウントを連携','google-auth','primary')}</div>`;
 const codes=authMode==='claim'?field('招待コード（32文字）','inviteCode','text','','maxlength="32" minlength="32" autocapitalize="none" spellcheck="false"')+field('個別連携コード（32文字）','claimCode','text','','maxlength="32" minlength="32" autocapitalize="none" spellcheck="false"'):authMode==='create'?field('出店名','eventName','text','学祭の出店','maxlength="80"')+field('自分の表示名','displayName','text','','maxlength="40" placeholder="例：佐藤"'):authMode==='recover'?field('自分の表示名','displayName','text','','maxlength="40"')+field('管理者復旧キー（32文字）','adminCode','text','','maxlength="32" minlength="32" autocapitalize="none" spellcheck="false"'):field('自分の表示名','displayName','text','','maxlength="40"')+field('招待コード（32文字）','inviteCode','text','','maxlength="32" minlength="32" autocapitalize="none" spellcheck="false"');
 $('#view').innerHTML=`<div class="auth-wrap">${heading('学祭精算に参加','この出店の参加者は共通データを閲覧し、各自の貢献・立替を記録できます。')}${acct}${members}<div class="auth-grid"><section class="panel auth-panel"><h2>${modeTitle[authMode]}</h2><p>${authMode==='join'?'まだ事前登録されていない方は招待コードで参加できます。':authMode==='claim'?'管理者が先に名簿登録した方はこちら。招待コードと本人専用の連携コードが必要です。':authMode==='create'?'最初にイベントを作成した人が管理者になります。':'ブラウザを変更した管理者向け。管理者復旧キーが必要です。'}</p><form id="auth-form" class="compact-form">${codes}<button class="btn btn-primary" type="submit" ${busy?'disabled':''}>${authMode==='join'?'参加する':authMode==='claim'?'既存IDに連携する':authMode==='create'?'作成する':'復旧する'}</button></form><div class="auth-alt"><button type="button" data-auth="join">通常参加</button><button type="button" data-auth="claim">事前登録済み</button><button type="button" data-auth="create">新規作成</button><button type="button" data-auth="recover">管理者復旧</button></div></section><section class="panel auth-panel"><h2>共有と承認について</h2><p>一般参加者の入力は「承認待ち」になります。管理者が承認した記録だけを精算に反映します。</p><div class="notice-box">・同じGoogleアカウントで複数端末から利用可能<br>・参加者IDと会計記録は表示名変更の影響を受けない<br>・事前登録済みの参加者は個別連携コードが必要<br>・管理者承認後に精算額を更新</div><p class="hint">Googleアカウントを変えると別の利用者になります。旧匿名アカウントから移行するときは、ログアウトせず「Googleアカウントを連携」を使用してください。</p></section></div></div>`;
}
async function ensureUser(){if(!user)throw Error('まずGoogleでログインしてください。');return user;}
async function googleAuth(){if(!client||busy)return;const redirectTo=oauthReturnUrl(window.location);const operation=myAuthKind()==='anonymous'?'link':'login';try{busy=true;const r=operation==='link'?await client.auth.linkIdentity({provider:'google',options:{redirectTo}}):await client.auth.signInWithOAuth({provider:'google',options:{redirectTo}});check(r);notice(operation==='link'?'Google連携画面に移動します':'Googleログイン画面に移動します');}catch(err){showError(err);}finally{busy=false;}}
async function recheckGoogleLink(){if(!client||!user)return;const result=await client.auth.getUser();check(result);user=result.data.user;render();if(googleConnected())notice('Google連携を確認できました');else alert('Google連携はまだ確認できません。Supabaseで「Allow manual linking」を有効化し、ログアウトせずにGoogle連携を再試行してください。');}
async function signout(){if(!user)return;const text=googleConnected()?'ログアウトしますか？ 別端末では同じGoogleアカウントで再ログインできます。':'匿名アカウントをログアウトすると、本人IDに戻れない場合があります。Googleに連携してからログアウトすることを推奨します。続けますか？';if(!confirm(text))return;try{check(await client.auth.signOut({scope:'local'}));user=null;memberships=[];eventId=null;currentEvent=null;people=[];records={activities:[],expenses:[],deposits:[],transfers:[]};detachChannel();render();notice('ログアウトしました');}catch(err){showError(err);}}
async function authSubmit(e){e.preventDefault();if(busy)return;const fd=new FormData(e.target);busy=true;render();try{
  const displayName=String(fd.get('displayName')||'').trim();if(authMode!=='claim'&&(!displayName||displayName.length>40))throw Error('表示名を入力してください。');
  await ensureUser();let id;
  if(authMode==='create'){
    const name=String(fd.get('eventName')||'').trim();if(!name||name.length>80)throw Error('出店名を入力してください。');
    const invite=code(),admin=code();id=check(await client.rpc('create_event',{p_event_name:name,p_display_name:displayName,p_invite_code:invite,p_admin_code:admin}));
    eventId=id;cacheCode('invite',invite);cacheCode('admin',admin);
    alert(`新規イベントを作成しました。\n\n招待コード：${invite}\n\n管理者復旧キー：${admin}\n\n管理者復旧キーはこの画面を閉じる前に安全な場所へ保管してください。参加者に渡すのは招待コードだけです。`);
  }else if(authMode==='join'){
    const invite=String(fd.get('inviteCode')||'').trim().toLowerCase();id=check(await client.rpc('join_event',{p_invite_code:invite,p_display_name:displayName}));
  }else if(authMode==='claim'){
    const invite=String(fd.get('inviteCode')||'').trim().toLowerCase(),claimCode=String(fd.get('claimCode')||'').trim().toLowerCase();
    id=check(await client.rpc('claim_participant',{p_invite_code:invite,p_claim_code:claimCode}));
  }else{
    const admin=String(fd.get('adminCode')||'').trim().toLowerCase();id=check(await client.rpc('recover_admin',{p_admin_code:admin,p_display_name:displayName}));
  }
  eventId=id;localStorage.setItem(localKey,id);await refreshAll(true);notice('参加しました');
 }catch(err){showError(err);}
 finally{busy=false;render();}}
async function refreshMemberships(){const rows=check(await client.from('event_members').select('event_id,user_id,display_name,role,events(event_name)').eq('user_id',user.id).order('joined_at',{ascending:true}));memberships=rows||[];}
function detachChannel(){if(channel&&client){client.removeChannel(channel);channel=null;}}
function subscribe(){detachChannel();if(!eventId)return;channel=client.channel('settlement-'+eventId);for(const table of ['events','event_members','activities','expenses','deposits','transfers','pos_sales','pos_refunds','pos_cash_moves','pos_cash_checks','register_sessions','pos_products','inventory_items','stock_audit','settlement_finalizations']){
    const filter=table==='events'?`id=eq.${eventId}`:`event_id=eq.${eventId}`;
    channel.on('postgres_changes',{event:'*',schema:'public',table,filter},()=>{if(!$('#edit-dialog').open&&!busy)refreshData().catch(e=>console.warn(e));});
  }
  channel.subscribe((status)=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')setSync('同期再接続中',true);});
}
async function refreshAll(sub=false){if(!client||!user)return;await refreshMemberships();if(eventId&&!memberships.some(m=>m.event_id===eventId))eventId=null;
  if(!eventId){const saved=localStorage.getItem(localKey);if(saved&&memberships.some(m=>m.event_id===saved))eventId=saved;else if(memberships.length===1)eventId=memberships[0].event_id;}
  if(eventId){localStorage.setItem(localKey,eventId);await refreshData();if(sub)subscribe();}else{currentEvent=null;people=[];detachChannel();render();}
}
async function refreshData(){if(!eventId)return;const eId=eventId;const qs=[client.from('events').select('id,event_name,sales,reserve,rates,created_at').eq('id',eId).single(),client.from('event_members').select('member_id,user_id,display_name,role,joined_at').eq('event_id',eId).order('joined_at',{ascending:true}),client.from('activities').select('*').eq('event_id',eId).order('created_at',{ascending:false}).limit(1000),client.from('expenses').select('*').eq('event_id',eId).order('created_at',{ascending:false}).limit(1000),client.from('deposits').select('*').eq('event_id',eId).order('created_at',{ascending:false}).limit(1000),client.from('transfers').select('*').eq('event_id',eId).order('created_at',{ascending:false}).limit(1000)];
  const [evt,member,acts,exps,deps,trans]=await Promise.all(qs.map(q=>q));for(const r of [evt,member,acts,exps,deps,trans])check(r);if(eId!==eventId)return;
  currentEvent=evt.data;
  ({people,records,state}=normalizeCloud(currentEvent,member.data||[],acts.data||[],exps.data||[],deps.data||[],trans.data||[]));
  await v4.load();
  const fin=v4.summary();state.sales=fin.bookSales;state.reserve+=fin.loss;
  lastLoadedAt=Date.now();setSync('共有データと同期中');render();
}
function personList(selected,{includeFund=false,onlyMine=false}={}){const persons=onlyMine?people.filter(p=>p.id===myId()):people;return `${includeFund?`<option value="fund" ${selected===FUND?'selected':''}>運営金庫</option>`:''}${persons.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}（#${shortId(p.id)}${p.userId?'':'・未連携'}）</option>`).join('')}`;}
function row(title,sub,right,status=null){return `<div class="entry-row"><div class="entry-main"><strong>${esc(title)}</strong>${status?statusHtml(status):''}<small>${esc(sub)}</small></div><div class="entry-right"><strong>${right}</strong></div></div>`;}
function profileList(c){return c.byPerson.map(p=>`<div class="person-summary-row"><div class="person-ident"><span class="avatar">${esc(p.name.slice(0,1))}</span><div><strong>${esc(p.name)} ${p.id===myId()?'<span class="badge-small">（自分）</span>':''}</strong><small>${points(p.points)} pt / 利益配分 ${yen(p.share)}</small></div></div><span class="amount ${p.balance<0?'negative':''}">${p.balance<0?'支払 '+yen(p.balance):'受取 '+yen(p.balance)}</span></div>`).join('');}
function dashboardView(c){const f=v4.summary();return `${heading(esc(state.eventName),'POS売上・実査・経費・貢献記録を一元管理します。',isAdmin()&&!v4.locked()&&!f.saleCount?button('従来売上を編集','edit-budget','primary'):'')}
 ${reviewCount()?`<div class="alert alert-warn">承認待ちの申請が ${reviewCount()} 件あります。未承認の金額・ポイントは精算に含みません。${isAdmin()?button('承認する','goto-reviews','soft'):''}</div>`:''}
 ${c.blocked?`<div class="alert alert-warn">${esc(c.blocked)}</div>`:''}
 <div class="metric-grid">${metric('帳簿売上',yen(c.sales),'従来売上＋POS売上−返金')}${metric('承認済み経費',yen(c.expensesTotal),'立替を含む')}${metric('分配対象利益（試算）',signedYen(c.net),'売上 − 経費 − 留保金 − 過不足控除')}${metric('貢献ポイント',points(c.totalPoints)+' pt',people.length+'人の参加者')}</div>
 <div class="content-grid">
 ${panel('参加者別の受取・支払残額',profileList(c)||'<p>参加者はいません。</p>')}
 ${panel('精算状況',`<div class="settlement-facts"><div><span>運営金庫の残高</span><strong>${signedYen(c.fundCash)}</strong></div><div><span>留保金</span><strong>${yen(c.reserve)}</strong></div><div><span>金庫の精算可能額</span><strong>${signedYen(c.fundAvailable)}</strong></div><div><span>送金候補</span><strong>${c.blocked?'—':c.suggestions.length+'件'}</strong></div></div>${button('精算の内訳を見る','goto-money','soft')}`)}
 ${panel('POS・運営状況',`<div class="settlement-facts"><div><span>POS純売上</span><strong>${yen(f.posNet)}</strong></div><div><span>営業中のレジ</span><strong>${f.openSessions}台</strong></div><div><span>帳簿と実額の差額</span><strong>${signedYen(f.variance)}</strong></div><div><span>最終確定</span><strong>${f.finalized?'済':'未完了'}</strong></div></div><div class="button-stack">${button('レジ画面へ','goto-pos','primary')}${button('売上照合へ','goto-reconcile','light')}</div>`)}
 ${panel('記録を追加',`<div class="quick-actions">${button('貢献を記録','add-activity','light')}${button('立替を申請','add-expense','light')}${button('資金拠出を記録','add-deposit','light')}${isAdmin()?button('送金を記録','add-transfer','light'):''}</div><p class="hint">買い出しの作業ポイントと、材料費の立替金は別々に登録します。</p>`)}
 ${panel('最近の申請',`<div class="row-list">${[...records.activities.map(x=>({...x,kind:'貢献',title:named(x.personId)+' / '+typeLabel(x.type),display:points(x.quantity*x.rate)+'pt'})),...records.expenses.map(x=>({...x,kind:'経費',display:yen(x.amount)})),...records.deposits.map(x=>({...x,kind:'拠出',title:named(x.personId),display:yen(x.amount)}))].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,6).map(x=>row(x.title||x.kind,`${dateLabel(x.date)} / ${x.kind}`,esc(x.display),x.status)).join('')||'<p>申請はまだありません。</p>'}</div>`)}
 </div>`;}
function activitiesView(c){const max=Math.max(1,...c.byPerson.map(p=>p.points));const activityRows=byDate(records.activities).map(a=>row(named(a.personId)+' / '+typeLabel(a.type),`${dateLabel(a.date)}${a.note?' ・ '+a.note:''} / ${points(a.quantity)}${unitLabel(a.unit)} × ${points(a.rate)}pt/${unitLabel(a.unit)}`,points(a.quantity*a.rate)+'pt',a.status)).join('');return `${heading('貢献記録','参加者が作業を申請し、管理者が承認するとポイントに反映されます。',button('貢献を追加','add-activity','primary'))}<div class="content-grid">
 ${panel('承認済みポイント（ランキング）',[...c.byPerson].sort((a,b)=>b.points-a.points).map((p,i)=>`<div class="point-row"><div class="point-row-head"><strong>${i+1}位 ${esc(p.name)}${p.userId?'':' <span class="badge-small">（未連携）</span>'}</strong><span>${points(p.points)}pt</span></div><div class="progress"><div data-percent="${p.points/max*100}"></div></div></div>`).join('')||'参加者がいません。')}
 ${panel('作業ごとのポイント',`<div class="rate-list">${TYPES.map(t=>`<div><span>${t.label}</span><strong>${ACTIVITY_UNITS[t.id].map(u=>`${points(state.rates[activityRateKey(t.id,u)]??0)}pt/${unitLabel(u)}`).join(' ・ ')}</strong></div>`).join('')}</div><p class="hint">登録時に適用された単価は、その後の設定変更では変わりません。</p>`)}
 </div>${panel('作業種別の貢献内訳',`<div class="rate-list">${TYPES.map(t=>{const entries=records.activities.filter(a=>a.status==='approved'&&a.type===t.id);const p=entries.reduce((n,a)=>n+Math.round(a.quantity*a.rate*100)/100,0);return `<div><span>${t.label} / ${entries.length}件</span><strong>${points(p)}pt</strong></div>`;}).join('')}</div>`)}<section class="panel panel-full"><div class="panel-heading"><h2>記録履歴</h2><span class="muted">${records.activities.length}件</span></div>${activityRows||'<p>記録はまだありません。</p>'}</section>`;}
function expensesView(c){return `${heading('立替・経費','実際に支払った人と金額を申請します。自分の支出は承認後に返金対象になります。',button('立替を申請','add-expense','primary'))}<div class="metric-grid three">${metric('承認済み経費',yen(c.expensesTotal))}${metric('参加者の立替',yen(c.personalExpenses))}${metric('金庫払い',yen(c.fundExpenses))}</div><section class="panel panel-full"><div class="panel-heading"><h2>支出一覧</h2><span class="muted">${records.expenses.length}件</span></div>${byDate(records.expenses).map(x=>row(x.title,`${dateLabel(x.date)} / ${named(x.paidBy)}が支払${x.note?' / '+x.note:''}`,yen(x.amount),x.status)).join('')||'<p>経費の記録はありません。</p>'}</section>`;}
function moneyView(c){const f=v4.summary();const suggestionRows=c.suggestions.map(s=>`<div class="settlement-row"><div class="settlement-description"><strong>${esc(s.fromName)} → ${esc(s.toName)}</strong><small>未精算額（試算）</small></div><strong class="settlement-sum">${yen(s.amount)}</strong>${isAdmin()?button('支払済みを記録','pay-suggestion','soft',`data-from="${esc(s.from)}" data-to="${esc(s.to)}" data-amount="${s.amount}"`):''}</div>`).join('');return `${heading('資金・精算','運営資金の拠出、送金履歴、参加者への分配額を確認します。',isAdmin()&&(!f.closedSessions&&!f.openSessions||f.finalized)?button('送金を記録','add-transfer','primary'):'')}
 <div class="metric-grid three">${metric('帳簿ベース運営資金残高',signedYen(c.fundCash))}${metric('留保金',yen(c.reserve))}${metric('金庫の精算可能額',signedYen(c.fundAvailable))}</div>
 ${panel('自動精算案',`<p class="section-help">承認済みの記録だけを使った試算です。実際の振込・現金移動は行いません。</p>${c.blocked?`<div class="alert alert-warn">${esc(c.blocked)}</div>`:suggestionRows||'<p>送金候補はありません。</p>'}<p class="hint">複数人が入力中の場合、支払前に最新情報を確認してください。二重支払いを防ぐため、送金登録は管理者のみです。</p>`)}
 <section class="panel panel-full"><div class="panel-heading"><h2>参加者別の精算内訳</h2></div><div class="table-scroll"><table><thead><tr><th>参加者</th><th>利益配分</th><th>立替</th><th>資金拠出</th><th>受取済−支払済</th><th>残額</th></tr></thead><tbody>${c.byPerson.map(p=>`<tr><td>${esc(p.name)}<small>${points(p.points)}pt</small></td><td class="num">${yen(p.share)}</td><td class="num">${yen(p.paidExpenses)}</td><td class="num">${yen(p.contributed)}</td><td class="num">${signedYen(p.received-p.sent)}</td><td class="num bold">${signedYen(p.balance)}</td></tr>`).join('')||'<tr><td colspan="6">参加者なし</td></tr>'}</tbody></table></div></section>
 <div class="content-grid">${panel('運営資金の拠出',`<p class="section-help">出店前に金庫へ渡した資金。立替とは別で返金対象です。</p>${button('拠出を追加','add-deposit','light')}<div class="row-list">${byDate(records.deposits).map(x=>row(named(x.personId),`${dateLabel(x.date)}${x.note?' / '+x.note:''}`,yen(x.amount),x.status)).join('')||'<p>拠出記録なし</p>'}</div>`)}
 ${panel('実際の支払い・送金履歴',`<p class="section-help">管理者が登録した支払済み履歴。修正は反対方向の送金記録で相殺します。</p>${byDate(records.transfers).map(x=>row(named(x.from)+' → '+named(x.to),`${dateLabel(x.date)}${x.note?' / '+x.note:''}`,yen(x.amount))).join('')||'<p>まだ送金されていません。</p>'}`)}</div>`;}
function reviewsView(){if(!isAdmin())return heading('承認待ち','管理者だけが閲覧できます。');const pendingRows=[];for(const t of ['activities','expenses','deposits'])for(const x of records[t].filter(x=>x.status==='pending')){
 const description=t==='activities'?`${named(x.personId)} / ${typeLabel(x.type)} / ${points(x.quantity*x.rate)}pt`:t==='expenses'?`${x.title} / ${named(x.paidBy)} / ${yen(x.amount)}`:`${named(x.personId)} / ${yen(x.amount)}`;
 pendingRows.push({t,x,description});
 }pendingRows.sort((a,b)=>b.x.created_at.localeCompare(a.x.created_at));return `${heading('承認待ち','内容を確認し、承認した記録だけを精算に反映します。')}${panel('申請一覧',pendingRows.length?`<div class="review-stack">${pendingRows.map(({t,x,description})=>`<div class="review-item"><div><strong>${esc(description)}</strong><small>${dateLabel(x.date)} / 申請者：${esc(submittedBy(x.created_by))}${x.note?' / '+esc(x.note):''}</small></div><div class="review-buttons">${button('承認','review','primary',`data-table="${t}" data-id="${esc(x.id)}" data-status="approved"`)}${button('却下','review','danger',`data-table="${t}" data-id="${esc(x.id)}" data-status="rejected"`)}</div></div>`).join('')}</div>`:'<p>承認待ちの申請はありません。</p>')}
 ${panel('承認済み・却下済みの変更',`<p class="section-help">訂正が必要なときは、管理者が承認状態を変更できます。作業内容や金額自体は書き換えず、再申請します。</p><div class="review-stack">${['activities','expenses','deposits'].flatMap(t=>records[t].filter(x=>x.status!=='pending').map(x=>({t,x}))).sort((a,b)=>b.x.created_at.localeCompare(a.x.created_at)).slice(0,60).map(({t,x})=>`<div class="review-item"><div><strong>${t==='activities'?esc(named(x.personId)+' / '+typeLabel(x.type)+' '+points(x.quantity*x.rate)+'pt'):t==='expenses'?esc(x.title+' / '+yen(x.amount)):esc(named(x.personId)+' / '+yen(x.amount))} ${statusHtml(x.status)}</strong><small>${dateLabel(x.date)}</small></div><div class="review-buttons">${button(x.status==='approved'?'承認を取り消す':'承認する','review','light',`data-table="${t}" data-id="${esc(x.id)}" data-status="${x.status==='approved'?'rejected':'approved'}"`)}</div></div>`).join('')||'履歴はありません。'}</div>`)}`;}
function settingsView(){let inv=promptCode('invite'),adm=promptCode('admin');return `${heading('参加者・設定','管理者の精算ルールと、共有用の招待コードを管理します。')}
 <div class="content-grid"> ${panel('参加者名簿',`<p class="section-help">${people.length}人登録 / うち未連携 ${people.filter(p=>!p.userId).length}人。未連携の人も貢献・立替を記録できます。</p>${isAdmin()?`<div class="button-stack member-toolbar">${button('参加者を事前登録','add-member','primary')}</div>`:''}<div class="shared-people">${people.map(p=>`<div class="person-summary-row member-roster"><div class="person-ident"><span class="avatar">${esc(p.name.slice(0,1))}</span><div><strong>${esc(p.name)}</strong><small>ID: ${shortId(p.id)} / ${p.userId?'連携済み':'未連携'}</small></div></div><div class="member-actions"><span class="member-pill">${p.role==='admin'?'管理者':'参加者'}${p.id===myId()?' / 自分':''}</span>${isAdmin()?`${button('名前編集','rename-member','light',`data-id="${esc(p.id)}"`)}${p.role==='member'?button(p.userId?'ログインを解除・再発行':'連携コードを再発行','reset-member','soft',`data-id="${esc(p.id)}"`):''}`:''}</div></div>`).join('')}</div><div class="button-stack">${button('自分の表示名を変更','rename-me','light')}</div><p class="hint">自分で変更できるプロフィール項目は表示名だけです。IDは精算上の固定識別子です。後から本人がスマホを使い始めても変わりません。連携コードは対象者本人にだけ渡してください。</p>`)}
 ${panel('出店情報',`<div class="rate-list"><div><span>出店名</span><strong>${esc(state.eventName)}</strong></div><div><span>帳簿売上総額（POS合算）</span><strong>${yen(state.sales)}</strong></div><div><span>留保金</span><strong>${yen(state.reserve)}</strong></div></div>${isAdmin()?button('編集','edit-budget','soft'):'<p class="hint">管理者のみ編集できます。</p>'}`)}
 ${panel('ポイント配点',`<div class="rate-list">${TYPES.map(t=>`<div><span>${t.label}</span><strong>${ACTIVITY_UNITS[t.id].map(u=>`${points(state.rates[activityRateKey(t.id,u)]??0)}pt/${unitLabel(u)}`).join(' ・ ')}</strong></div>`).join('')}</div>${isAdmin()?button('配点を変更','edit-rates','soft'):''}<p class="hint">配点変更後の申請にのみ適用され、過去分は変更されません。</p>`)}
 ${panel('招待と管理者復旧',`<p class="section-help">参加者には招待コードだけを渡してください。管理者復旧キーは絶対に参加者へ渡さないでください。</p>${isAdmin()?`<small>参加者用招待コード（現在の端末に保存されている場合だけ表示）</small>${inv?`<div class="inline-secrets"><code class="invite-code">${esc(inv)}</code>${button('コピー','copy-invite','light')}</div>`:'<p>この端末に元のコードはありません。再生成すると以前のコードは無効になります。</p>'}<div class="button-stack">${button('招待コードを再生成','rotate-invite','light')}</div><hr class="secret-divider"><small>管理者復旧キー（別端末で管理者に戻るために使用）</small>${adm?`<div class="inline-secrets"><code class="invite-code">${esc(adm)}</code>${button('コピー','copy-admin','light')}</div>`:'<p>復旧キーは端末に保存されていません。再生成できます。</p>'}<div class="button-stack">${button('管理者復旧キーを再生成','rotate-admin','light')}</div>`:'<p>管理者に招待コードを問い合わせてください。</p>'}`)}
 ${panel('データ出力・更新',`<div class="button-stack">${button('JSONバックアップ','export-json','light')}${button('CSV（精算）','export-csv','light')}${button('最新版を取得','reload','light')}</div><p class="hint">データはSupabaseに保存されます。JSONバックアップにはPOS・在庫・会計履歴も含まれます。閲覧・保管用で、v4では自動復元には未対応です。GitHubに個人データをアップロードしないでください。</p>`)}
 ${panel('参加している出店',`<div class="event-switch"><label class="field"><span>切替先</span><select id="event-choice">${memberships.map(m=>`<option value="${esc(m.event_id)}" ${m.event_id===eventId?'selected':''}>${esc(m.events?.event_name||'イベント')}（${m.role==='admin'?'管理者':'参加者'}）</option>`).join('')}</select></label></div>${button('別の出店に参加・作成','back-landing','light')}<p class="hint">同じGoogleアカウントであれば別端末でも同じ参加者IDです。端末を紛失した場合はGoogleのアカウント管理でログイン中の端末を確認してください。</p><div class="account-banner account-bottom"><span><strong>${googleConnected()?'Googleでログイン中':'旧匿名アカウント'}</strong><small>${esc(user?.email||'Googleへの連携を推奨します')}</small></span>${googleConnected()?button('ログアウト','signout','light'):button('Googleに連携','google-auth','primary')}</div>${!googleConnected()?`<p class="hint">Google連携にはSupabaseの「Allow manual linking」をONにする必要があります。連携が完了するまではログアウトしないでください。</p>${button('連携状態を再確認','google-auth-status','light')}`:''}`)}</div>`;}
function openForm(kind,pre={}){if(!eventId)return;
 if(kind.startsWith('v4-')){const f=v4.form(kind.slice(3),pre);$('#edit-dialog').dataset.kind=kind;$('#edit-dialog').dataset.v4Pre=JSON.stringify(pre);$('#dialog-title').textContent=f.title;$('#dialog-fields').innerHTML=f.fields;$('#edit-dialog').showModal();return;}
 if(v4.locked()&&kind!=='transfer'&&kind!=='rename'&&kind!=='member-rename')return notice('最終分配が確定済みです。会計データは変更できません。');
 if(kind==='transfer'&&!v4.summary().finalized&&(v4.summary().openSessions||v4.summary().closedSessions))return notice('最終分配の確定後に送金を記録できます');
 if(['budget','rates','transfer'].includes(kind)&&!isAdmin())return notice('管理者だけが操作できます');let title='',fields='';const admin=isAdmin();const personalId=myId();
 if(kind==='activity'){title='貢献を追加';fields=select('作業した人','personId',personList(personalId,{onlyMine:!admin}))+select('作業の種類','type',TYPES.map(t=>`<option value="${t.id}">${t.label}</option>`).join(''))+select('単位','unit',unitSelect('prep'))+field('時間・回数・距離','quantity','number',1,'min="0.01" max="100000" step="0.01" inputmode="decimal"')+field('日付','date','date',day())+notes()+'<p class="hint">ポイント単価はサーバーで自動設定されます。一般参加者は管理者の承認後に反映されます。</p>';
 }else if(kind==='expense'){title=admin?'立替・経費を記録':'自分の立替を申請';fields=field('支出の内容','title','text','','maxlength="100" placeholder="例：食材・材料"')+money('金額（円）','amount')+select('実際に支払った人','paidBy',personList(admin?FUND:personalId,{includeFund:admin,onlyMine:!admin}))+field('日付','date','date',day())+notes();
 }else if(kind==='deposit'){title='運営資金の拠出を記録';fields=select('資金を出した人','personId',personList(personalId,{onlyMine:!admin}))+money('渡した金額（円）','amount')+field('日付','date','date',day())+notes()+'<p class="hint">実際に金庫へ渡した資金だけ記録してください。</p>';
 }else if(kind==='transfer'){title='実際の送金を記録';fields=select('支払った側','from',personList(pre.from||FUND,{includeFund:true}))+select('受け取った側','to',personList(pre.to||people[0]?.id,{includeFund:true}))+money('支払い済み金額（円）','amount',pre.amount||'1')+field('日付','date','date',day())+notes()+'<p class="hint">ここでは現金や振込の実行はしません。支払いが完了した場合だけ記録してください。記録は削除できません。</p>';
 }else if(kind==='budget'){title='イベント情報';fields=field('出店名','eventName','text',state.eventName,'maxlength="80"')+money('POS以前の手入力売上（円）','sales',currentEvent.sales,true)+money('留保金（円）','reserve',state.reserve,true);
 }else if(kind==='rates'){title='貢献ポイントの配点';fields=TYPES.flatMap(t=>ACTIVITY_UNITS[t.id].map(u=>field(t.label+'（pt / '+unitLabel(u)+'）',activityRateKey(t.id,u),'number',state.rates[activityRateKey(t.id,u)]??0,'min="0" max="100000" step="0.01" inputmode="decimal"'))).join('');
 }else if(kind==='rename'){title='自分の表示名を変更';fields=field('表示名','name','text',me()?.name||'','maxlength="40"');}
 else if(kind==='member'){if(!admin)return;title='参加者を事前登録';fields=field('参加者名','name','text','','maxlength="40" placeholder="例：田中"')+'<p class="hint">作成後、本人専用の連携コードを表示します。本人がアプリを開いていなくてもポイントや立替を登録できます。</p>';}
 else if(kind==='member-rename'){if(!admin)return;const person=people.find(p=>p.id===pre.personId);if(!person)return;$('#edit-dialog').dataset.personId=person.id;title='参加者名を変更';fields=field('参加者名','name','text',person.name,'maxlength="40"');}
 else return;
 $('#edit-dialog').dataset.kind=kind;$('#dialog-title').textContent=title;$('#dialog-fields').innerHTML=fields;$('#edit-dialog').showModal();}
function number(fd,key,{integer=false,positive=false}={}){const raw=String(fd.get(key)??'').trim();if(!raw)throw Error(`${key}を入力してください。`);const n=Number(raw);if(!Number.isFinite(n)||n<0||n>999999999||(positive&&n<=0)||(integer&&!Number.isSafeInteger(n)))throw Error(`${key} の数値が正しくありません。`);return n;}
function textVal(fd,key){return String(fd.get(key)||'').trim();}
async function formSubmit(e){e.preventDefault();if(busy)return;const kind=$('#edit-dialog').dataset.kind;const fd=new FormData(e.currentTarget);const admin=isAdmin();busy=true;$('#submit-button').disabled=true;
 try{let table,payload;
  if(kind.startsWith('v4-')){await v4.submit(kind.slice(3),fd,JSON.parse($('#edit-dialog').dataset.v4Pre||'{}'));$('#edit-dialog').close();return;}
  if(kind==='budget'){const name=textVal(fd,'eventName');if(!name)throw Error('出店名を入力してください');check(await client.from('events').update({event_name:name,sales:number(fd,'sales',{integer:true}),reserve:number(fd,'reserve',{integer:true})}).eq('id',eventId));}
  else if(kind==='rates'){const rates={...state.rates};for(const t of TYPES)for(const u of ACTIVITY_UNITS[t.id]){const key=activityRateKey(t.id,u);rates[key]=number(fd,key);if(Math.abs(rates[key]*100-Math.round(rates[key]*100))>1e-7)throw Error('ポイントは小数第2位まで');}check(await client.from('events').update({rates}).eq('id',eventId));}
  else if(kind==='rename'){check(await client.rpc('rename_me',{p_event_id:eventId,p_display_name:textVal(fd,'name')}));}
  else if(kind==='member-rename'){check(await client.rpc('rename_participant',{p_event_id:eventId,p_member_id:$('#edit-dialog').dataset.personId,p_display_name:textVal(fd,'name')}));}
  else if(kind==='member'){const name=textVal(fd,'name');const secret=code();const mid=check(await client.rpc('create_participant',{p_event_id:eventId,p_display_name:name,p_claim_code:secret}));$('#edit-dialog').close();await refreshAll();alert(`「${name}」を未連携の参加者として登録しました。\n参加者ID：${mid}\n\n本人専用の連携コード：\n${secret}\n\n参加者には招待コードと本人専用連携コードを別々に伝えてください。連携コードは後から再表示できません。`);notice('参加者を事前登録しました');return;}
  else{
   const common={event_id:eventId,record_date:textVal(fd,'date'),note:textVal(fd,'note')};
   if(kind==='activity'){table='activities';payload={...common,person_id:admin?textVal(fd,'personId'):myId(),type:textVal(fd,'type'),unit:textVal(fd,'unit'),quantity:number(fd,'quantity',{positive:true}),status:admin?'approved':'pending'};if(Math.abs(payload.quantity*100-Math.round(payload.quantity*100))>1e-7)throw Error('活動量は小数第2位までで入力してください。');activityRateKey(payload.type,payload.unit);}
   if(kind==='expense'){table='expenses';const paidBy=admin?textVal(fd,'paidBy'):myId();payload={...common,title:textVal(fd,'title'),paid_by:paidBy===FUND?null:paidBy,amount:number(fd,'amount',{integer:true,positive:true}),status:admin?'approved':'pending'};if(!payload.title)throw Error('支出の内容を入力してください。');}
   if(kind==='deposit'){table='deposits';payload={...common,person_id:admin?textVal(fd,'personId'):myId(),amount:number(fd,'amount',{integer:true,positive:true}),status:admin?'approved':'pending'};}
   if(kind==='transfer'){table='transfers';const from=textVal(fd,'from'),to=textVal(fd,'to');if(from===to)throw Error('支払う側と受け取る側が同じです。');payload={...common,from_user:from===FUND?null:from,to_user:to===FUND?null:to,amount:number(fd,'amount',{integer:true,positive:true})};if(!confirm(`${named(from)} → ${named(to)} に ${yen(payload.amount)}\n実際に送金・手渡しが完了していますか？`))return;}
   if(!table)throw Error('不明な記録です。');check(await client.from(table).insert(payload));
  }
  $('#edit-dialog').close();await refreshAll();notice(admin?'保存しました':'申請を保存しました（承認待ち）');
 }catch(err){showError(err);}finally{busy=false;$('#submit-button').disabled=false;}}
async function review(table,id,status){if(!isAdmin()||!['activities','expenses','deposits'].includes(table)||!['approved','rejected'].includes(status))return;
 if(!confirm(status==='approved'?'この記録を承認して精算に反映しますか？':'この記録の承認を取り消し、精算から除外しますか？'))return;
 try{const result=check(await client.from(table).update({status}).eq('event_id',eventId).eq('id',id).select('id'));if(!result?.length)throw Error('記録が更新できませんでした。別の端末ですでに処理されている可能性があります。');await refreshAll();notice(status==='approved'?'承認しました':'承認を取り消しました');}catch(err){showError(err);}}
async function saveSuggestion(el){if(!isAdmin())return;if(!v4.summary().finalized&&(v4.summary().openSessions||v4.summary().closedSessions))throw Error('POS営業後は最終精算確定まで送金できません');const from=el.dataset.from,to=el.dataset.to,amount=Number(el.dataset.amount);try{await refreshAll();const c=calculate(state);if(!c.suggestions.some(x=>x.from===from&&x.to===to&&x.amount===amount))throw Error('金額が変更されました。精算案をもう一度確認してください。');if(!confirm(`${named(from)} → ${named(to)}：${yen(amount)}\n支払いが実際に完了した場合だけ「OK」を押してください。`))return;check(await client.from('transfers').insert({event_id:eventId,from_user:from===FUND?null:from,to_user:to===FUND?null:to,amount,record_date:day(),note:'自動精算案から記録'}));await refreshAll();notice('送金記録を追加しました');}catch(err){showError(err);}}
async function resetParticipant(id){if(!isAdmin())return;const person=people.find(p=>p.id===id);if(!person||person.role==='admin')return;const txt=person.userId?'現在の端末からのアクセス権が解除されます。':'以前の個別連携コードが無効になります。';if(!confirm(`${person.name}の連携コードを再発行しますか？\n${txt}\n現在連携しているGoogleアカウントもこの出店へのアクセスを失います。通常の機種変更には再発行不要です。\n既存の貢献・立替・精算データは維持します。`))return;const secret=code();check(await client.rpc('reset_participant_access',{p_event_id:eventId,p_member_id:id,p_claim_code:secret}));await refreshAll();alert(`${person.name}の個別連携コード：\n${secret}\n\n招待コードと併せて本人にだけ渡してください。このコードは後から再表示できません。`);notice('連携コードを更新しました');}
async function rotateKey(kind){if(!isAdmin())return;const isAdminKey=kind==='admin';if(!confirm(`${isAdminKey?'管理者復旧キー':'参加者用招待コード'}を変更しますか？以前のコードは使えなくなります。`))return;try{const secret=code();const fn=isAdminKey?'rotate_admin_code':'rotate_invite_code',param=isAdminKey?'p_admin_code':'p_invite_code';check(await client.rpc(fn,{p_event_id:eventId,[param]:secret}));cacheCode(isAdminKey?'admin':'invite',secret);render();alert(`${isAdminKey?'管理者復旧キー':'招待コード'}：\n${secret}\n\n安全な場所に保存してください。`);}catch(err){showError(err);}}
async function refreshClick(){try{if(user){await refreshAll(true);notice('最新のデータを取得しました');}else render();}catch(err){showError(err);}}
async function handleClick(e){const auth=e.target.closest('[data-auth]');if(auth){authMode=auth.dataset.auth;render();return;}
 const nav=e.target.closest('[data-tab]');if(nav){tab=nav.dataset.tab;render();window.scrollTo(0,0);return;}
 const target=e.target.closest('[data-action]');if(!target)return;const action=target.dataset.action;
 if(action==='close-dialog'){ $('#edit-dialog').close();return; }
 if(action==='google-auth'){await googleAuth();return;}
 if(action==='google-auth-status'){await recheckGoogleLink();return;}
 if(action==='signout'){await signout();return;}
 if(action==='reload'){await refreshClick();return;}
 if(action==='choose-event'){eventId=target.dataset.id;localStorage.setItem(localKey,eventId);await refreshAll(true);tab='dashboard';render();return;}
 if(action==='back-landing'){eventId=null;currentEvent=null;detachChannel();render();return;}
 if(action==='goto-money'){tab='money';render();return;}
 if(action==='goto-pos'){tab='pos';render();return;}
 if(action==='goto-reconcile'){tab='reconcile';render();return;}
 if(action.startsWith('v4-')){await v4.action(target);return;}
 if(action==='goto-reviews'){tab='reviews';render();return;}
 if(action.startsWith('add-')){openForm(action.slice(4));return;}
 if(action==='edit-budget'){openForm('budget');return;}
 if(action==='edit-rates'){openForm('rates');return;}
 if(action==='rename-me'){openForm('rename');return;}
 if(action==='rename-member'){openForm('member-rename',{personId:target.dataset.id});return;}
 if(action==='reset-member'){await resetParticipant(target.dataset.id);return;}
 if(action==='review'){await review(target.dataset.table,target.dataset.id,target.dataset.status);return;}
 if(action==='pay-suggestion'){await saveSuggestion(target);return;}
 if(action==='rotate-invite'){await rotateKey('invite');return;}
 if(action==='rotate-admin'){await rotateKey('admin');return;}
 if(action==='copy-invite'||action==='copy-admin'){const value=promptCode(action==='copy-invite'?'invite':'admin');try{await navigator.clipboard.writeText(value);notice('コピーしました');}catch{prompt('このコードをコピーしてください',value);}return;}
 if(action==='export-json'){const full=await v4.backup();const backup={format:'gakusai-v4-view-only',exportedAt:new Date().toISOString(),event:currentEvent,people,activities:records.activities,expenses:records.expenses,deposits:records.deposits,transfers:records.transfers,...full};download(`gakusai-v4-backup-${day()}.json`,JSON.stringify(backup,null,2),'application/json');notice('会計・在庫を含めてバックアップしました');return;}
 if(action==='export-csv'){const c=calculate(state);const rows=[['参加者','ポイント','利益配分','経費立替','出資返金','受取済','支払済','受取残額'],...c.byPerson.map(p=>[p.name,p.points,p.share,p.paidExpenses,p.contributed,p.received,p.sent,p.balance])];download(`gakusai-v3-settlement-${day()}.csv`,writeCSV(rows),'text/csv');notice('CSVを出力しました');return;}
}
async function init(){try{if(!/^https:\/\/[-\w]+\.supabase\.co\/?$/.test(cfg.url||'')||!(cfg.key?.startsWith('sb_publishable_')||cfg.key?.startsWith('eyJ'))){render();return;}
 setSync('クラウドへ接続中');const mod=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');client=mod.createClient(cfg.url,cfg.key,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true,flowType:'pkce'}});
 const {data,error}=await client.auth.getSession();if(error)throw error;user=data.session?.user||null;
   // getSession can contain the pre-OAuth anonymous user; ask Auth for the latest identities.
   if(user){const fresh=await client.auth.getUser();if(!fresh.error&&fresh.data?.user)user=fresh.data.user;}
 if(user)await refreshAll(true);else landingView();
 client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='USER_UPDATED'){queueMicrotask(async()=>{if(busy)return;try{const next=session?.user||null;if(user?.id!==next?.id){eventId=null;memberships=[];people=[];detachChannel();}user=next;if(user){const fresh=await client.auth.getUser();if(!fresh.error&&fresh.data?.user&&fresh.data.user.id===user.id)user=fresh.data.user;await refreshAll(true);}else render();}catch(e){showError(e);}});}});
 // Realtimeが使えない場合も別端末の更新を取得する。
 setInterval(()=>{if(!busy&&!$('#edit-dialog').open&&user&&eventId&&Date.now()-lastLoadedAt>22000)refreshData().catch(e=>setSync(errMsg(e),true));},25000);
 }catch(err){console.error(err);setSync('接続エラー',true);$('#view').innerHTML=`<div class="auth-wrap">${panel('クラウドに接続できませんでした',`<p>${esc(errMsg(err))}</p><p>config.js・SQL初期化・Supabaseプロジェクトの状態・通信状況を確認してください。</p>${button('再読み込み','reload','light')}`)}</div>`;}}
document.addEventListener('click',e=>{handleClick(e).catch(showError);});
document.addEventListener('submit',e=>{if(e.target.id==='auth-form')authSubmit(e).catch(showError);});
$('#edit-form').addEventListener('submit',formSubmit);
document.addEventListener('input',e=>{if(e.target.id==='v4-tender')v4.change(e.target);});
document.addEventListener('change',e=>{if(v4.change(e.target))return;if(e.target.name==='type'&&$('#edit-dialog').dataset.kind==='activity'){const selectUnit=$('#edit-form').elements.namedItem('unit');if(selectUnit)selectUnit.innerHTML=unitSelect(e.target.value);return;}if(e.target.id==='event-choice'){eventId=e.target.value;localStorage.setItem(localKey,eventId);tab='dashboard';refreshAll(true).catch(showError);}});
window.addEventListener('online',()=>{if(user&&eventId)refreshAll(true).catch(()=>{});});
render();init();
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(console.warn);
