/** Pure accounting and settlement functions. All monetary values are integer JPY. */
export const TYPES = [
  { id: 'prep', label: '事前準備', example: '装飾・メニューづくりなど' },
  { id: 'shopping', label: '買い出し', example: '材料や備品の購入' },
  { id: 'car', label: '車出し・運搬', example: '移動・荷物運び' },
  { id: 'operation', label: '当日運営', example: '調理・接客・片付け' },
  { id: 'other', label: 'その他', example: '自由な協力作業' },
];
export const FUND = 'fund';
export const defaultData = () => ({
  version: 1,
  eventName: '学祭の精算',
  sales: 0,
  reserve: 0,
  rates: { prep: 2, shopping: 3, car: 4, operation: 2, other: 1 },
  people: [],
  activities: [],
  expenses: [],
  deposits: [],
  transfers: [],
});

/** Largest remainder apportionment: total integer JPY, no lost rounding yen. */
export function allocateYen(total, memberPoints) {
  const positive = memberPoints.filter(x => x.points > 0);
  const points = positive.reduce((s, p) => s + p.points, 0);
  if (!positive.length || !Number.isSafeInteger(total) || total < 0 || points <= 0) return Object.fromEntries(memberPoints.map(x => [x.id, 0]));
  const shares = positive.map(x => {
    const exact = total * x.points / points;
    const floor = Math.floor(exact);
    return { id: x.id, floor, frac: exact - floor };
  });
  let remainder = total - shares.reduce((s, r) => s + r.floor, 0);
  shares.sort((a,b) => b.frac - a.frac || String(a.id).localeCompare(String(b.id)));
  for (let i = 0; i < remainder; i++) shares[i % shares.length].floor += 1;
  return Object.fromEntries(memberPoints.map(x => [x.id, shares.find(r => r.id === x.id)?.floor ?? 0]));
}

/** A positive balance means the party should receive money. Negative means it should pay. */
export function calculate(data) {
  const people = data.people || [];
  const activities = data.activities || [];
  const expenses = data.expenses || [];
  const deposits = data.deposits || [];
  const transfers = data.transfers || [];
  const sales = Number(data.sales) || 0;
  const reserve = Number(data.reserve) || 0;
  const expensesTotal = expenses.reduce((sum, x) => sum + x.amount, 0);
  const personalExpenses = expenses.reduce((sum, x) => sum + (x.paidBy === FUND ? 0 : x.amount), 0);
  const fundExpenses = expensesTotal - personalExpenses;
  const deposited = deposits.reduce((sum, x) => sum + x.amount, 0);
  const net = sales - expensesTotal - reserve;
  const pointsById = Object.fromEntries(people.map(p => [p.id, 0]));
  for (const a of activities) if (a.personId in pointsById) pointsById[a.personId] += Math.round(a.quantity * a.rate * 100) / 100;
  const totalPoints = Object.values(pointsById).reduce((s, n) => s + n, 0);
  const allocated = net > 0 && totalPoints > 0 ? allocateYen(net, people.map(p => ({id:p.id, points: pointsById[p.id]}))) : Object.fromEntries(people.map(p => [p.id, 0]));
  const byPerson = people.map(p => {
    const paidExpenses = expenses.filter(x => x.paidBy === p.id).reduce((s,x)=>s+x.amount,0);
    const contributed = deposits.filter(x => x.personId === p.id).reduce((s,x)=>s+x.amount,0);
    const sent = transfers.filter(x => x.from === p.id).reduce((s,x)=>s+x.amount,0);
    const received = transfers.filter(x => x.to === p.id).reduce((s,x)=>s+x.amount,0);
    const share = allocated[p.id] || 0;
    return { ...p, points: pointsById[p.id] || 0, share, paidExpenses, contributed, sent, received, balance: share + paidExpenses + contributed + sent - received };
  });
  const fundSent = transfers.filter(x => x.from === FUND).reduce((s,x)=>s+x.amount,0);
  const fundReceived = transfers.filter(x => x.to === FUND).reduce((s,x)=>s+x.amount,0);
  const fundCash = sales + deposited - fundExpenses - fundSent + fundReceived;
  const fundAvailable = fundCash - reserve;
  const distributable = Math.max(0, net);
  const blocked = net < 0 ? '赤字のため自動精算は停止しています。赤字の負担方法を決めてから精算してください。'
    : net > 0 && !totalPoints ? '利益の配分先が未確定です。貢献記録を登録してから精算してください。'
    : !people.length ? '参加者を登録してください。' : '';
  const balances = [...byPerson.map(p => ({ id:p.id, name:p.name, balance:p.balance })), { id:FUND, name:'運営金庫', balance:-fundAvailable }];
  const imbalance = balances.reduce((s,p)=>s+p.balance,0);
  const suggestions = blocked || Math.abs(imbalance) > 0.01 ? [] : suggestTransfers(balances);
  return {sales, reserve, expensesTotal, personalExpenses, fundExpenses, deposited, net, distributable, totalPoints, byPerson, fundCash, fundAvailable, fundSent, fundReceived, blocked, imbalance, suggestions};
}

/** Greedy debt matching: eliminates balances with every proposed transfer. */
export function suggestTransfers(balances) {
  const payers = balances.filter(x=>x.balance < 0).map(x=>({...x, amount:-x.balance})).sort((a,b)=>b.amount-a.amount);
  const receivers = balances.filter(x=>x.balance > 0).map(x=>({...x, amount:x.balance})).sort((a,b)=>b.amount-a.amount);
  const result = [];
  let i=0, j=0;
  while (i < payers.length && j < receivers.length) {
    const amount = Math.min(payers[i].amount, receivers[j].amount);
    if (amount > 0) result.push({from:payers[i].id, to:receivers[j].id, fromName:payers[i].name, toName:receivers[j].name, amount});
    payers[i].amount -= amount; receivers[j].amount -= amount;
    if (!payers[i].amount) i++;
    if (!receivers[j].amount) j++;
  }
  return result;
}

/** Minimal structural validation for a user-imported backup. */
export function validateImport(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.people) || !Array.isArray(data.activities) || !Array.isArray(data.expenses) || !Array.isArray(data.deposits) || !Array.isArray(data.transfers)) throw Error('バックアップ形式が正しくありません。');
  const money = n => Number.isSafeInteger(n) && n >= 0;
  if (!money(data.sales) || !money(data.reserve)) throw Error('売上・留保金の値が不正です。');
  const validId = x => typeof x === 'string' && x.length > 0 && x.length < 128;
  const unique = arr => new Set(arr.map(x=>x.id)).size === arr.length;
  if (![data.people,data.activities,data.expenses,data.deposits,data.transfers].every(unique)) throw Error('同じIDの記録が含まれています。');
  if (!data.people.every(x=>validId(x.id)&&typeof x.name==='string' && x.name.trim())) throw Error('参加者情報が不正です。');
  const ids = new Set(data.people.map(x=>x.id));
  const paidByValid = id => id === FUND || ids.has(id);
  if (!data.activities.every(x=>validId(x.id)&&ids.has(x.personId)&&TYPES.some(t=>t.id===x.type)&&Number.isFinite(x.quantity)&&x.quantity>0&&Number.isFinite(x.rate)&&x.rate>=0)) throw Error('貢献記録が不正です。');
  if (!data.expenses.every(x=>validId(x.id)&&paidByValid(x.paidBy)&&money(x.amount)&&x.amount>0)) throw Error('経費記録が不正です。');
  if (!data.deposits.every(x=>validId(x.id)&&ids.has(x.personId)&&money(x.amount)&&x.amount>0)) throw Error('拠出記録が不正です。');
  if (!data.transfers.every(x=>validId(x.id)&&paidByValid(x.from)&&paidByValid(x.to)&&x.from!==x.to&&money(x.amount)&&x.amount>0)) throw Error('送金記録が不正です。');
  for(const rate of TYPES) if(!Number.isFinite(data.rates?.[rate.id])||data.rates[rate.id]<0) throw Error('ポイント設定が不正です。');
  return data;
}
