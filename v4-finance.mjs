/** Pure projections; integer JPY. Book sales remain immutable source, variance never overwrites POS records. */
export function v4Summary(event, report={}, sessions=[], finalization=null) {
 const num=x=>Number(x||0);
 const posNet=num(report.salesGross)-num(report.refundsTotal);
 const bookSales=num(event?.sales)+posNet;
 const cashVariance=num(report.cashVariance);
 const cashlessVariance=num(report.cashlessVariance);
 const variance=cashVariance+cashlessVariance;
 const loss=Math.max(0,-variance); // positive net overage is held, not automatically distributed
 const active=sessions.filter(s=>!s.closed_at);
 return {legacySales:num(event?.sales),posNet,bookSales,cashVariance,cashlessVariance,variance,loss,
  active,openSessions:num(report.openSessions),closedSessions:num(report.closedSessions),
  saleCount:num(report.saleCount),refundCount:num(report.refundCount),finalized:!!finalization,
  finalization,
  readyForPayout:!!finalization,
  warning:finalization?'利益分配確定済み':active.length?'営業中のレジがあります。閉店後に最終照合を行ってください。':
   num(report.closedSessions)?'レジ締めと承認記録を確認し、管理者が分配を確定してください。':'レジの営業記録がありません。'};
}
export function cashExpected(float, cashSales, refunds, movements){
 for(const value of [float,cashSales,refunds,movements])if(!Number.isSafeInteger(value))throw Error('金額の形式が不正です');
 return float+cashSales-refunds+movements;
}
export function countDifference(expected,actual){
 if(!Number.isSafeInteger(actual)||actual<0)throw Error('実査額が不正です');
 return actual-expected;
}
export function aggregateCart(cart, products){
 const rows=[];let total=0;
 for(const [id,qty] of Object.entries(cart)){
  if(!Number.isSafeInteger(qty)||qty<0||qty>9999)throw Error('数量が不正です');
  const p=products.find(x=>x.id===id);
  if(qty&&!p?.active)throw Error('販売できない商品が含まれています');
  if(qty){rows.push({product_id:id,quantity:qty});total+=Number(p.price)*qty;}
 }
 if(!Number.isSafeInteger(total)||total>999999999)throw Error('合計金額が不正です');
 return {items:rows,total};
}
export function canFinalize(summary, pending){return summary.closedSessions>0&&summary.openSessions===0&&!pending&&!summary.finalized;}
