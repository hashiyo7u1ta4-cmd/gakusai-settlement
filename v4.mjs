import { v4Summary,aggregateCart,canFinalize } from './v4-finance.mjs';
import { DENOMINATIONS,addDenomination,tenderBalance } from './cash-tender.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>`${Number(n||0).toLocaleString('ja-JP')}円`;
const signed=n=>`${n>0?'+':''}${money(n)}`;
const fmt=t=>t?new Date(t).toLocaleString('ja-JP'):'—';
const btn=(text,action,klass='soft',attrs='')=>`<button type="button" class="btn btn-${klass}" data-action="v4-${action}" ${attrs}>${esc(text)}</button>`;
const opt=(rows,selected)=>rows.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name)}</option>`).join('');
const field=(name,key,type='text',value='',more='')=>`<label class="field"><span>${esc(name)}</span><input name="${key}" type="${type}" value="${esc(value)}" ${more} required></label>`;
const text=(name,key,value='')=>`<label class="field"><span>${esc(name)}</span><textarea name="${key}" maxlength="300" rows="2">${esc(value)}</textarea></label>`;
const sel=(name,key,options)=>`<label class="field"><span>${esc(name)}</span><select name="${key}">${options}</select></label>`;
const heading=(title,subtitle,actions='')=>`<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
const panel=(title,body,actions='')=>`<section class="panel"><div class="panel-heading"><h2>${title}</h2>${actions}</div>${body}</section>`;
const stat=(label,value,desc='')=>`<div class="metric"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><small>${desc}</small></div>`;
const empty='<p class="hint">まだ記録がありません。</p>';
const uid=()=>crypto.randomUUID();
const formatQty=n=>Number(n).toLocaleString('ja-JP',{maximumFractionDigits:3});
const sortDate=(a,b)=>String(b.created_at||b.opened_at||'').localeCompare(String(a.created_at||a.opened_at||''));

export function createV4(ctx){
 let d={pos_registers:[],pos_products:[],inventory_items:[],product_recipes:[],stock_audit:[],pos_purchase_entries:[],register_sessions:[],pos_sales:[],pos_sale_lines:[],pos_refunds:[],pos_cash_moves:[],pos_cash_checks:[],settlement_finalizations:[]};
 let report={},cart={},selectedSession='',viewOnly=false,busy=false,status={},activeEvent=null;
 let cashTender='0',paymentMethod='cash';
 const admin=()=>ctx.admin();const event=()=>ctx.event();const locked=()=>!!d.settlement_finalizations[0];
 const summary=()=>v4Summary(ctx.current(),report,d.register_sessions,d.settlement_finalizations[0]||null);
 const activeSessions=()=>d.register_sessions.filter(x=>!x.closed_at);
 const chosen=()=>activeSessions().find(x=>x.id===selectedSession)||activeSessions()[0]||null;
 const registerName=id=>d.pos_registers.find(x=>x.id===id)?.name||'レジ';
 const saleName=s=>d.pos_sale_lines.filter(l=>l.sale_id===s.id).map(l=>`${l.product_name}×${l.quantity}`).join('、')||'商品明細';
 const muted=(msg)=>`<div class="alert alert-warn">${esc(msg)}</div>`;
 const isRefunded=id=>d.pos_refunds.some(r=>r.sale_id===id);
 function currentStatus(){return status[chosen()?.id]||null;}
 async function load(){
  const eid=event(),cl=ctx.client();if(!eid||!cl)return;
  if(activeEvent!==eid){cart={};selectedSession='';checkout.pendingTx=null;cashTender='0';paymentMethod='cash';}
  const names=Object.keys(d);
  const results=await Promise.all([cl.rpc('pos_report',{p_event:eid}),...names.map(name=>cl.from(name).select('*').eq('event_id',eid).order(({register_sessions:'opened_at',product_recipes:'product_id',pos_sale_lines:'id',settlement_finalizations:'finalized_at'})[name]||'created_at',{ascending:false}).limit(name==='pos_sale_lines'?600:name==='pos_sales'?200:350))]);
  results.forEach(r=>{if(r.error)throw r.error;});
  if(event()!==eid)return;
  report=results[0].data||{};
  names.forEach((name,i)=>d[name]=results[i+1].data||[]);
  activeEvent=eid;
  if(!activeSessions().some(s=>s.id===selectedSession))selectedSession=activeSessions()[0]?.id||'';
  status={};
  const check=await Promise.all(activeSessions().map(s=>cl.rpc('pos_session_status',{p_session:s.id})));
  for(let i=0;i<check.length;i++){if(check[i].error)throw check[i].error;status[activeSessions()[i].id]=check[i].data;}
 }
 const integer=(fd,key,{allowZero=true}={})=>{
  const raw=String(fd.get(key)??'').trim();if(!/^\d+$/.test(raw))throw Error(`${key} は0以上の整数で入力してください`);
  const n=Number(raw);if(!Number.isSafeInteger(n)||n>999999999||(!allowZero&&!n))throw Error(`${key} の金額が不正です`);return n;
 };
 const decimal=(fd,key,negative=false)=>{
  const n=Number(fd.get(key));if(!Number.isFinite(n)||Math.abs(n)>999999||!Number.isInteger(n*1000)||(negative? n===0:n<0))throw Error(`${key} の数量が不正です。小数第3位まで入力してください`);return n;
 };
 const value=(fd,key)=>String(fd.get(key)||'').trim();
 const patch=async(fn,args)=>{if(busy)throw Error('前の操作が処理中です');busy=true;try{const r=await ctx.client().rpc(fn,args);if(r.error)throw r.error;await ctx.reload();ctx.notice('保存しました');return r.data;}finally{busy=false;}};
 const choiceHtml=()=>sel('対象レジ','register',opt(d.pos_registers,chosen()?.register_id));
 const sessionOption=()=>`<label class="field"><span>操作対象レジ</span><select id="v4-session-choice">${activeSessions().map(s=>`<option value="${esc(s.id)}" ${chosen()?.id===s.id?'selected':''}>${esc(registerName(s.register_id))} / ${fmt(s.opened_at)}${s.paused?'（点検中）':''}</option>`).join('')}</select></label>`;
 function posView(){const s=chosen(),cs=currentStatus(),a=admin();const total=aggregateCart(cart,d.pos_products).total;
  return `${heading('レジ・POS','商品を選んで会計を確定すると、原材料在庫が自動減算されます。材料不足でも販売できます。',a&&!locked()?(activeSessions().length?btn('別のレジを開始','open-session','soft'):d.pos_registers.length?btn('営業を開始する','open-session','primary'):btn('レジを登録して営業開始','open-register','primary')):'')}
  ${locked()?muted('利益分配確定済みのため新規会計はできません。'):''}
  ${!d.pos_registers.length?muted('販売開始前にレジ名・釣銭準備金を登録してください。'):''}
  <div class="v4-pos-layout">
    <section class="panel"><div class="panel-heading"><h2>商品を選択</h2><span class="muted">${d.pos_products.filter(p=>p.active).length}商品</span></div>
    <div class="v4-product-grid">${d.pos_products.filter(x=>x.active).map(p=>`<button type="button" data-action="v4-cart-add" data-id="${p.id}" class="v4-product" ${!s||s.paused||locked()?'disabled':''}><strong>${esc(p.name)}</strong><small>${esc(p.category)}</small><span>${money(p.price)}</span>${(() => {const rs=d.product_recipes.filter(r=>r.product_id===p.id);if(!rs.length)return '<small>材料未設定</small>';const lacks=rs.filter(r=>{const m=d.inventory_items.find(x=>x.id===r.item_id);return !m||Number(m.qty)<Number(r.quantity);});return lacks.length?'<small class="v4-shortage">材料不足（会計可能）</small>':'<small>原材料から自動減算</small>';})()}</button>`).join('')||'<p>商品管理でメニューを追加してください。</p>'}</div>
    ${s?`<p class="hint">${esc(registerName(s.register_id))} / ${s.paused?'現金点検中・会計停止':'営業中'} / ${fmt(s.opened_at)} 開始</p>`:''}
    </section>
    <section class="panel v4-checkout"><div class="panel-heading"><h2>お会計</h2>${btn('カートを空にする','cart-clear','light')}</div>
    ${activeSessions().length?sessionOption():muted(d.pos_registers.length?'営業中のレジがありません。「営業を開始する」から釣銭準備金を登録してください。':'営業中のレジがありません。レジを登録して営業開始してください。')}
    <div class="v4-cart-lines">${Object.entries(cart).filter(([,q])=>q>0).map(([id,q])=>{const p=d.pos_products.find(x=>x.id===id);return p?`<div class="v4-cart-row"><div><strong>${esc(p.name)}</strong><small>${money(Number(p.price)*q)}</small></div><div class="v4-stepper"><button type="button" data-action="v4-cart-remove" data-id="${id}">−</button><strong>${q}</strong><button type="button" data-action="v4-cart-add" data-id="${id}">＋</button></div></div>`:''}).join('')||'<p class="hint">左の商品を押して追加してください。</p>'}</div>
    <div class="v4-total"><span>合計</span><strong>${money(total)}</strong></div>
    <label class="field"><span>支払方法</span><select id="v4-payment"><option value="cash" ${paymentMethod==='cash'?'selected':''}>現金</option><option value="cashless" ${paymentMethod==='cashless'?'selected':''}>キャッシュレス</option></select></label>
    <div id="v4-cash-tender" class="v4-cash-tender" ${paymentMethod==='cashless'?'hidden':''}>
      ${field('お預かり金額','tender','number',cashTender,'min="0" max="999999999" step="1" inputmode="numeric" id="v4-tender" autocomplete="off"')}
      <div class="v4-denominations" role="group" aria-label="預かり金額を加算する">${DENOMINATIONS.map(n=>`<button type="button" class="v4-denomination" data-action="v4-tender-add" data-amount="${n}" aria-label="${money(n)}を加算">＋${money(n)}</button>`).join('')}<button type="button" class="v4-denomination v4-denomination-clear" data-action="v4-tender-clear" aria-label="お預かり金額を0円に戻す">クリア</button></div>
      <p class="v4-tender-hint">タップするたびに加算されます。金額欄から直接入力もできます。</p>
    </div>
    <div id="v4-change" class="v4-change ${paymentMethod==='cash'&&Number(cashTender)<total?'v4-change-shortage':''}" role="status" aria-live="polite">${paymentMethod==='cashless'?'キャッシュレス決済を確認してください':(()=>{try{const r=tenderBalance(cashTender,total);return r.shortage?`不足：${money(r.shortage)}`:`お釣り：${money(r.change)}`;}catch{return '預かり金額を確認してください';}})()}</div>
    ${btn('会計を確定する','checkout','primary',`style="width:100%" ${!s||s.paused||locked()||!aggregateCart(cart,d.pos_products).items.length?'disabled':''}`)}
    <p class="hint">会計ボタンの二重押し防止・同時販売時の在庫更新はサーバー側で実施します。</p></section>
  </div>
  ${panel('直近の販売記録',historySales(30))}`;
 }
 function historySales(limit=100){return `<div class="v4-history">${[...d.pos_sales].sort(sortDate).slice(0,limit).map(s=>`<div class="v4-listline"><div><strong>${esc(saleName(s))}</strong><small>${fmt(s.created_at)} / ${s.method==='cash'?'現金':'キャッシュレス'} / ${esc(registerName(d.register_sessions.find(x=>x.id===s.session_id)?.register_id))}${isRefunded(s.id)?' / 全額返金済み':''}</small></div><strong>${money(s.total)}</strong>${admin()&&!locked()&&!isRefunded(s.id)&&activeSessions().length?btn('返金','refund','light',`data-id="${s.id}"`):''}</div>`).join('')||empty}</div>`;}
 function catalogView(){return `${heading('商品・メニュー','商品名・価格と材料レシピを管理します。完成品在庫の登録は不要です。',admin()&&!locked()?btn('商品を追加','product','primary'):'')}
 ${panel('商品一覧',`<div class="v4-list">${d.pos_products.map(p=>`<div class="v4-listline"><div><strong>${esc(p.name)}</strong><small>${esc(p.category)} / ${p.active?'販売中':'販売停止'} </small></div><strong>${money(p.price)}</strong>${admin()&&!locked()?btn('編集','product','light',`data-id="${p.id}"`):''}</div>`).join('')||empty}</div>`)}
 ${panel('材料レシピ',`<p class="section-help">商品1個あたりの材料使用量を設定すると、会計時に自動減算されます。在庫不足は警告だけで販売を止めません。</p>${admin()&&!locked()?btn('レシピを設定','recipe','soft'):''}<div class="v4-list">${d.pos_products.map(p=>{const rs=d.product_recipes.filter(r=>r.product_id===p.id);return `<div class="v4-listline"><strong>${esc(p.name)}</strong><small>${rs.map(r=>`${esc(d.inventory_items.find(i=>i.id===r.item_id)?.name||'材料')} ${formatQty(r.quantity)}`).join('、')||'材料設定なし'}</small></div>`;}).join('')}</div>`)}`;
 }
 function inventoryView(){const low=d.inventory_items.filter(x=>Number(x.qty)<=Number(x.low_threshold));return `${heading('在庫・仕入れ','原材料のみを管理し、POSの販売と連動して自動減算します。マイナス在庫も記録できます。',admin()&&!locked()?btn('材料を登録','material','primary'):'')}
 ${low.length?muted(`在庫確認が必要な材料が ${low.length} 件あります。`):''}
 ${admin()&&!locked()?`<div class="v4-actions">${btn('仕入れと経費を同時登録','purchase','primary')}</div>`:''}
 <div class="content-grid">
 ${panel('原材料在庫',`<div class="v4-list">${d.inventory_items.map(i=>`<div class="v4-listline"><div><strong>${esc(i.name)}</strong><small>最低在庫目安 ${formatQty(i.low_threshold)} ${esc(i.unit)}</small></div><strong class="${Number(i.qty)<=Number(i.low_threshold)?'v4-negative':''}">${formatQty(i.qty)} ${esc(i.unit)}</strong>${admin()&&!locked()?btn('数量調整','stock','light',`data-item="${i.id}"`)+btn('編集','material','light',`data-id="${i.id}"`):''}</div>`).join('')||empty}</div>${admin()&&!locked()?btn('材料を追加','material','light'):''}`)}
 ${panel('原材料管理について',`<p class="section-help">完成品の在庫は管理しません。商品のレシピを設定すると、販売数に合わせて原材料が減ります。マイナス在庫は数量調整や次の仕入れで修正できます。</p>`)}
 </div>${panel('仕入れと立替の連動履歴',`<div class="v4-history">${d.pos_purchase_entries.map(x=>`<div class="v4-listline"><div><strong>${esc(d.inventory_items.find(i=>i.id===x.item_id)?.name)} / ${formatQty(x.quantity)}</strong><small>${fmt(x.created_at)} / 支払：${esc(ctx.people().find(p=>p.id===x.paid_by)?.name||'運営金庫')}${x.note?' / '+esc(x.note):''}</small></div><strong>${money(x.amount)}</strong></div>`).join('')||empty}</div><p class="hint">この仕入れ記録では、承認済み経費も同時に作成済みです。同じ領収書を別途経費申請しないでください。</p>`)}
 ${panel('入出庫・棚卸調整の履歴',`<div class="v4-history">${d.stock_audit.slice(0,80).map(x=>`<div class="v4-listline"><div><strong>${esc(x.product_id?d.pos_products.find(p=>p.id===x.product_id)?.name:d.inventory_items.find(i=>i.id===x.item_id)?.name)}</strong><small>${fmt(x.created_at)} / ${esc(x.reason)}</small></div><strong class="${Number(x.delta)<0?'v4-negative':''}">${Number(x.delta)>0?'+':''}${formatQty(x.delta)}</strong></div>`).join('')||empty}</div><p class="hint">仕入れに伴う支出は「立替・経費」にも登録してください。在庫入庫だけでは経費には計上されません。</p>`)}`;
 }
 function cashView(){const ss=activeSessions(),s=chosen(),cs=currentStatus();return `${heading('現金点検・レジ締め','営業時間中いつでも実査できます。点検中は対象レジの会計のみ停止します。',admin()&&!locked()?(d.pos_registers.length?btn('レジ営業を開始','open-session','primary'):btn('レジを登録して営業開始','open-register','primary')):'')}
 ${!d.pos_registers.length?muted('レジがまだありません。上のボタンから登録・営業開始してください。'):''}
 <div class="metric-grid three">${stat('営業中レジ',summary().openSessions+'台')}${stat('締め済みレジ',summary().closedSessions+'回')}${stat('過不足（現金）',signed(summary().cashVariance),'締め済み合計')}</div>
 <div class="content-grid">
 ${panel('営業中レジ',`<div class="v4-list">${ss.map(x=>`<div class="v4-listline"><div><strong>${esc(registerName(x.register_id))}</strong><small>開始 ${fmt(x.opened_at)} / 釣銭準備金 ${money(x.opening_float)}</small></div><strong>${x.paused?'点検中':'営業中'}</strong></div>`).join('')||empty}</div>${s?`${sessionOption()}<div class="v4-value">帳簿上の現金残高 <strong>${money(cs?.expectedCash)}</strong></div><div class="v4-value">帳簿上のキャッシュレス <strong>${money(cs?.expectedCashless)}</strong></div><div class="v4-actions">${s.paused?`${btn('点検を完了する','count-complete','primary')}${btn('点検を中止','count-cancel','light')}`:`${btn('中間現金点検を開始','count-start','primary')}${admin()&&!locked()?btn('現金入出金','cash-move','soft'):''}`}${admin()&&!locked()&&!s.paused?btn('営業終了・レジ締め','close-session','soft'):''}</div>`:''}`)}
 ${panel('随時点検の履歴',`<div class="v4-list">${d.pos_cash_checks.slice(0,70).map(x=>`<div class="v4-listline"><div><strong>${esc(registerName(d.register_sessions.find(s=>s.id===x.session_id)?.register_id))}</strong><small>${fmt(x.created_at)} / 帳簿 ${money(x.expected_cash)} / 実査 ${money(x.counted_cash)}${x.note?' / '+esc(x.note):''}</small></div><strong class="${Number(x.difference)<0?'v4-negative':''}">${signed(x.difference)}</strong></div>`).join('')||empty}</div>`)}</div>
 ${panel('レジ締めの履歴',`<div class="v4-history">${d.register_sessions.filter(s=>s.closed_at).map(s=>`<div class="v4-listline"><div><strong>${esc(registerName(s.register_id))} / ${fmt(s.closed_at)}</strong><small>現金 帳簿 ${money(s.expected_cash)} ⇄ 実査 ${money(s.counted_cash)} / キャッシュレス 帳簿 ${money(s.expected_cashless)} ⇄ 確認 ${money(s.verified_cashless)}${s.closing_note?' / '+esc(s.closing_note):''}</small></div><strong class="${Number(s.cash_difference)+Number(s.cashless_difference)<0?'v4-negative':''}">${signed(Number(s.cash_difference)+Number(s.cashless_difference))}</strong></div>`).join('')||empty}</div>`)}
 ${panel('レジからの現金入出金',`<div class="v4-list">${d.pos_cash_moves.slice(0,80).map(m=>`<div class="v4-listline"><div><strong>${m.direction==='in'?'現金入金':'現金出金'}：${esc(m.reason)}</strong><small>${fmt(m.created_at)} / ${esc(registerName(d.register_sessions.find(s=>s.id===m.session_id)?.register_id))}</small></div><strong>${m.direction==='in'?'+':'−'}${money(m.amount)}</strong></div>`).join('')||empty}</div><p class="hint">ここでの現金出金は現金台帳だけの記録です。材料費・立替は別途経費として記録し、二重に費用計上しないでください。</p>`)}`;
 }
 function reconcileView(){const f=summary();return `${heading('売上照合・分配確定','帳簿売上を基準に、実際の現金・キャッシュレスを照合してから確定します。',admin()&&!locked()?btn('最終分配を確定する','finalize','primary',!canFinalize(f,ctx.pending())?'disabled':''):'')}
 ${f.finalized?`<div class="alert">最終分配を ${fmt(f.finalization.finalized_at)} に確定しました。過去の帳簿・経費・ポイントはロックされています。支払い済み送金は引き続き記録できます。</div>`:muted(f.warning)}
 <div class="metric-grid">${stat('従来の売上入力',money(f.legacySales),'POS以前の売上')}${stat('POS純売上',money(f.posNet),'販売－返金')}${stat('帳簿売上合計',money(f.bookSales),'分配の売上基準')}${stat('差額による不足控除',money(f.loss),'不足額のみ控除。余剰は留保')}</div>
 <div class="content-grid">
 ${panel('閉店時の照合結果',`<div class="rate-list"><div><span>現金過不足</span><strong>${signed(f.cashVariance)}</strong></div><div><span>キャッシュレス確認差</span><strong>${signed(f.cashlessVariance)}</strong></div><div><span>合計過不足</span><strong>${signed(f.variance)}</strong></div><div><span>未締めレジ</span><strong>${f.openSessions}台</strong></div><div><span>承認待ち申請</span><strong>${ctx.pending()}件</strong></div></div><p class="hint">帳簿の売上は書き換えません。現金不足は会計差損として分配対象額から控除します。過剰分は自動配分しません。</p>`)}
 ${panel('確定条件',`<div class="v4-checklist"><div>${f.closedSessions>0?'✓':'×'} レジ締めが1回以上</div><div>${f.openSessions===0?'✓':'×'} 未締めのレジがない</div><div>${ctx.pending()===0?'✓':'×'} 承認待ちがない</div><div>${f.finalized?'✓':'○'} 管理者による最終確定</div></div><p class="hint">確定処理はDB側で再検査します。差額があるレジは、締め時に理由入力が必須です。</p>`)}
 </div>${panel('売上明細・返金履歴',historySales(100))}
 ${panel('会計データのCSV保存',`${btn('全販売・返金のCSVを出力','export-sales','soft')}${btn('商品・在庫CSVを出力','export-inventory','light')}<p class="hint">個人情報の含まれる会計データは公開リポジトリに置かないでください。</p>`)}`;
 }
 function view(tab){return ({pos:posView,catalog:catalogView,inventory:inventoryView,cash:cashView,reconcile:reconcileView}[tab]||posView)();}
 function form(kind,pre={}){if(locked())throw Error('精算確定済みです');let title='',fields='';const s=chosen();
  if(kind==='product') {const p=d.pos_products.find(x=>x.id===pre.id);title=p?'商品を編集':'商品を追加';fields=field('商品名','name','text',p?.name||'','maxlength="100"')+field('価格（円）','price','number',p?.price??'500','min="0" step="1"')+field('カテゴリ','category','text',p?.category||'商品','maxlength="40"')+sel('販売状態','active',`<option value="true" ${!p||p.active?'selected':''}>販売中</option><option value="false" ${p&&!p.active?'selected':''}>販売停止</option>`);}
  else if(kind==='material'){const m=d.inventory_items.find(x=>x.id===pre.id);title=m?'材料を編集':'材料を追加';fields=field('材料名','name','text',m?.name||'','maxlength="100"')+field('単位','unit','text',m?.unit||'個','maxlength="20"')+field('最低在庫目安','low','number',m?.low_threshold||0,'min="0" step="0.001"');}
  else if(kind==='purchase'){title='仕入れ・経費を同時登録';if(!d.inventory_items.length)throw Error('先に材料を登録してください');fields=sel('仕入れ材料','item',opt(d.inventory_items))+field('入庫数量','qty','number','1','min="0.001" step="0.001"')+field('購入代金（円）','amount','number','1000','min="1" step="1"')+sel('実際に支払った人','payer',`<option value="fund">運営金庫</option>${ctx.people().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`)+field('品目・仕入れ内容','title','text','','maxlength="100"')+text('備考（任意）','note')+sel('レジ現金からの出金','fromRegister',`<option value="">なし（レジ外の資金・個人立替）</option>${activeSessions().filter(x=>!x.paused).map(x=>`<option value="${x.id}">${esc(registerName(x.register_id))}から同時出金</option>`).join('')}`)+'<p class="hint">仕入れ記録・在庫入庫・承認済み経費を同時登録します。運営金庫払いでレジから実際に出した場合だけ出金レジを選んでください。</p>'; }
  else if(kind==='recipe'){title='レシピを設定';if(!d.pos_products.length||!d.inventory_items.length)throw Error('先に商品と材料を登録してください');fields=sel('商品','product',opt(d.pos_products))+sel('材料','item',opt(d.inventory_items))+field('商品1個あたりの消費数（0で解除）','qty','number','1','min="0" step="0.001"')+'<p class="hint">例えば麺1玉なら1、タレ0.05Lなら0.05。</p>';}
  else if(kind==='stock'){title='原材料在庫を調整';const entity=d.inventory_items.find(x=>x.id===pre.item);if(!entity)throw Error('材料が見つかりません');fields=`<p>対象：<strong>${esc(entity.name)}</strong> / 現在 ${formatQty(entity.qty)} ${esc(entity.unit)}</p>`+field('増減量（例：仕入れ+20、廃棄-2）','delta','number','1','step="0.001"')+field('理由（仕入れ、廃棄、棚卸修正など）','reason','text','','maxlength="300"');}
  else if(kind==='register'){title='レジを登録して営業開始';fields=field('レジ名','name','text',`レジ${d.pos_registers.length+1}`,'maxlength="60"')+field('釣銭準備金（円）','float','number','10000','min="0" step="1"')+'<p class="hint">保存後、そのまま会計可能になります。</p>';}
  else if(kind==='open-session'){title='レジの営業を開始';if(!d.pos_registers.length)throw Error('先にレジを登録してください');fields=choiceHtml()+field('釣銭準備金（円）','float','number','10000','min="0" step="1"')+'<p class="hint">釣銭準備金は売上ではありません。実際にレジに入れた現金を入力してください。</p>';}
  else if(kind==='cash-move'){title='現金の入出金';if(!s||s.paused)throw Error('営業中のレジを選択してください');fields=sel('区分','direction','<option value="out">出金</option><option value="in">入金</option>')+field('現金額（円）','amount','number','1000','min="1" step="1"')+field('理由','reason','text','','maxlength="300"')+'<p class="hint">レジから仕入れ代金を出した場合は、別途「経費」の登録も必要です。</p>';}
  else if(kind==='count-complete'){title='中間現金点検';if(!s?.paused)throw Error('点検開始が必要です');fields=`<p>対象：${esc(registerName(s.register_id))} / 理論残高 <strong>${money(currentStatus()?.expectedCash)}</strong></p>`+field('実際に数えた現金（円）','cash','number','','min="0" step="1"')+text('差額の原因・状況（差額がある場合必須）','note');}
  else if(kind==='close-session'){title='営業終了・レジ締め';if(!s||s.paused)throw Error('点検中またはレジがありません');fields=`<p>帳簿現金：<strong>${money(currentStatus()?.expectedCash)}</strong> / キャッシュレス：<strong>${money(currentStatus()?.expectedCashless)}</strong></p>`+field('実際に数えた現金（円）','cash','number',currentStatus()?.expectedCash??0,'min="0" step="1"')+field('決済端末などで確認したキャッシュレス純額（円）','cashless','number',currentStatus()?.expectedCashless??0,'step="1"')+text('差額の理由・状況（差額がある場合必須）','note')+'<p class="hint">閉店確定後は、この回の会計を追加できません。翌営業日は新しいセッションを開始します。</p>';}
  else if(kind==='refund'){title='販売を全額返金';const sale=d.pos_sales.find(s=>s.id===pre.id);if(!sale)throw Error('対象売上がありません');if(!s||s.paused)throw Error('返金を記録する営業中レジが必要です');fields=`<p>${esc(saleName(sale))} / ${money(sale.total)} / ${sale.method==='cash'?'現金':'キャッシュレス'}</p>`+sel('商品・材料を在庫に戻す','restock','<option value="true">戻す（商品が再販売可能）</option><option value="false">戻さない（廃棄・提供済みなど）</option>')+field('返金の理由','reason','text','','maxlength="300"')+'<p class="hint">全額返金のみ対応。実際に同じ決済方法で返金した後に記録してください。</p>';}
  else if(kind==='finalize'){title='最終利益分配を確定';fields=`<p>帳簿売上：<strong>${money(summary().bookSales)}</strong> / 過不足：<strong>${signed(summary().variance)}</strong></p><p class="alert alert-warn">確定後は売上・経費・貢献ポイント・在庫を変更できません。送金記録のみ追加できます。</p>`+text('確定時の備考','note');}
  else throw Error('不明な入力です');
  return {title,fields,pre};
 }
 async function submit(kind,fd,pre={}){
  const eid=event(),s=chosen();const v=value;
  if(kind==='product')await patch('pos_save_product',{p_event:eid,p_id:pre.id||null,p_name:v(fd,'name'),p_price:integer(fd,'price'),p_category:v(fd,'category'),p_track:false,p_active:v(fd,'active')==='true'});
  else if(kind==='material')await patch('pos_save_material',{p_event:eid,p_id:pre.id||null,p_name:v(fd,'name'),p_unit:v(fd,'unit'),p_low:decimal(fd,'low')});
  else if(kind==='purchase')await patch('pos_register_purchase',{p_event:eid,p_item:v(fd,'item'),p_qty:decimal(fd,'qty'),p_amount:integer(fd,'amount',{allowZero:false}),p_paid_by:v(fd,'payer')==='fund'?null:v(fd,'payer'),p_title:v(fd,'title'),p_note:v(fd,'note'),p_session:v(fd,'fromRegister')||null});
  else if(kind==='recipe')await patch('pos_set_recipe',{p_event:eid,p_product:v(fd,'product'),p_item:v(fd,'item'),p_qty:decimal(fd,'qty')});
  else if(kind==='stock')await patch('pos_adjust_stock',{p_event:eid,p_product:pre.product||null,p_item:pre.item||null,p_delta:decimal(fd,'delta',true),p_reason:v(fd,'reason')});
  else if(kind==='register'){const id=await patch('pos_create_and_open_register',{p_event:eid,p_name:v(fd,'name'),p_float:integer(fd,'float')});selectedSession=id;ctx.render();}
  else if(kind==='open-session'){const id=await patch('pos_open_session',{p_event:eid,p_register:v(fd,'register'),p_float:integer(fd,'float')});selectedSession=id;ctx.render();}
  else if(kind==='cash-move')await patch('pos_cash_move',{p_session:s.id,p_direction:v(fd,'direction'),p_amount:integer(fd,'amount',{allowZero:false}),p_reason:v(fd,'reason')});
  else if(kind==='count-complete')await patch('pos_complete_count',{p_session:s.id,p_counted:integer(fd,'cash'),p_note:v(fd,'note')});
  else if(kind==='close-session'){const cf=Number(v(fd,'cashless'));if(!Number.isSafeInteger(cf)||Math.abs(cf)>999999999)throw Error('キャッシュレスの確認額は整数で入力してください');await patch('pos_close_session',{p_session:s.id,p_cash:integer(fd,'cash'),p_cashless:cf,p_note:v(fd,'note')});}
  else if(kind==='refund')await patch('pos_refund',{p_session:s.id,p_sale:pre.id,p_restock:v(fd,'restock')==='true',p_reason:v(fd,'reason')});
  else if(kind==='finalize')await patch('pos_finalize',{p_event:eid,p_note:v(fd,'note')});
 }
 async function checkout(){const s=chosen();if(!s||s.paused||locked())throw Error('営業中のレジが必要です');const {items,total}=aggregateCart(cart,d.pos_products);if(!items.length)throw Error('商品を選んでください');const method=document.querySelector('#v4-payment')?.value||'cash';const received=method==='cash'?tenderBalance(document.querySelector('#v4-tender')?.value,total).received:null;if(method==='cash'&&received<total)throw Error('お預かり額が不足しています');
  // 同一会計を通信不安定時に再試行しても二重登録させない。失敗時は同じトークンを保持。
  if(!checkout.pendingTx)checkout.pendingTx=uid();
  if(!confirm(`${money(total)} / ${method==='cash'?'現金':'キャッシュレス'}で会計を確定しますか？`))return;
  const id=await patch('pos_checkout',{p_session:s.id,p_items:items,p_method:method,p_received:received,p_tx:checkout.pendingTx});
  checkout.pendingTx=null;cart={};cashTender='0';paymentMethod='cash';ctx.render();ctx.notice(`会計を記録しました（${String(id).slice(0,8)}）`);
 }
 async function action(el){const name=el.dataset.action.replace(/^v4-/,'');const n=id=>Number(cart[id]||0);
  if(name==='cart-add'||name==='cart-remove'){const id=el.dataset.id;if(!d.pos_products.some(p=>p.id===id&&p.active))return;const next=n(id)+(name==='cart-add'?1:-1);cart[id]=Math.min(9999,Math.max(0,next));ctx.render();return true;}
  if(name==='cart-clear'){cart={};cashTender='0';ctx.render();return true;}
  if(name==='tender-add'){const amount=Number(el.dataset.amount);cashTender=String(addDenomination(document.querySelector('#v4-tender')?.value??cashTender,amount));const t=document.querySelector('#v4-tender');if(t)t.value=cashTender;change(t||{id:'v4-tender'});return true;}
  if(name==='tender-clear'){cashTender='0';const t=document.querySelector('#v4-tender');if(t)t.value='0';change(t||{id:'v4-tender'});return true;}
  if(name==='checkout'){await checkout();return true;}
  if(name==='open-register'){ctx.openV4('register');return true;}
  if(name==='open-session'){ctx.openV4('open-session');return true;}
  if(name==='count-start'){const s=chosen();if(!s)throw Error('対象レジを選んでください');if(!confirm('現金を数える間、このレジの会計を一時停止します。開始しますか？'))return true;await patch('pos_pause_for_count',{p_session:s.id});return true;}
  if(name==='count-cancel'){const s=chosen();if(!s)throw Error('対象がありません');if(!confirm('点検を破棄し、会計を再開しますか？'))return true;await patch('pos_cancel_count',{p_session:s.id});return true;}
  if(name==='export-sales'){await exportCsv();return true;}
  if(name==='export-inventory'){const rows=[['区分','名称','数量','単位','価格（円）','最低在庫'],...d.pos_products.map(x=>['商品',x.name,x.stock_qty,'個',x.price,'']),...d.inventory_items.map(x=>['材料',x.name,x.qty,x.unit,'',x.low_threshold])];saveCsv('gakusai-v4-inventory.csv',rows);return true;}
  if(['product','material','purchase','recipe','stock','cash-move','count-complete','close-session','refund','finalize'].includes(name)){
   ctx.openV4(name,{id:el.dataset.id||null,product:el.dataset.product||null,item:el.dataset.item||null});return true;
  }
  return false;
 }
 function change(el){if(el.id==='v4-session-choice'){selectedSession=el.value;ctx.render();return true;}if(el.id==='v4-tender'||el.id==='v4-payment'){
   const p=document.querySelector('#v4-payment')?.value||paymentMethod,t=document.querySelector('#v4-tender'),res=document.querySelector('#v4-change'),cashBlock=document.querySelector('#v4-cash-tender');
   paymentMethod=p;if(t)cashTender=t.value;
   if(cashBlock)cashBlock.hidden=(p==='cashless');
   if(!res)return true;
   if(p==='cashless'){res.textContent='キャッシュレス決済を確認してください';res.classList.remove('v4-change-shortage');}
   else{const total=aggregateCart(cart,d.pos_products).total;try{const b=tenderBalance(cashTender,total);res.textContent=b.shortage?`不足：${money(b.shortage)}`:`お釣り：${money(b.change)}`;res.classList.toggle('v4-change-shortage',b.shortage>0);}catch{res.textContent='預かり金額を確認してください';res.classList.add('v4-change-shortage');}}
   return true;
  }return false;}
 function saveCsv(name,rows){const safe=x=>{let s=String(x??'');if(/^\s*[=+@-]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};const csv='\ufeff'+rows.map(x=>x.map(safe).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
 async function getAll(table){const eid=event(),cl=ctx.client();let rows=[];const order=({register_sessions:'opened_at',product_recipes:'product_id',pos_sale_lines:'id',pos_sale_consumption:'id',settlement_finalizations:'finalized_at'})[table]||'created_at';for(let start=0;;start+=500){const r=await cl.from(table).select('*').eq('event_id',eid).order(order,{ascending:true}).range(start,start+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)break;if(start>50000)throw Error('出力件数が多すぎます。管理者に連絡してください');}return rows;}
 async function exportCsv(){const [sales,refunds,lines]=await Promise.all([getAll('pos_sales'),getAll('pos_refunds'),getAll('pos_sale_lines')]);saveCsv('gakusai-v4-sales.csv',[['種別','日時','取引ID','商品','数量','税込単価','支払方法','金額','返金理由'],...sales.flatMap(x=>lines.filter(l=>l.sale_id===x.id).map(l=>['販売',x.created_at,x.id,l.product_name,l.quantity,l.unit_price,x.method,l.unit_price*l.quantity,''])),...refunds.map(x=>['全額返金',x.created_at,x.sale_id,'','','',x.method,-x.amount,x.reason])]);}
 async function backup(){const output={};for(const tab of Object.keys(d).concat(['pos_sale_consumption']))output[tab]=await getAll(tab);return {bookReport:report,entities:output};}
 return {load,view,summary,form,submit,action,change,locked,backup,report:()=>report};
}
