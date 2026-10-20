// POS cash tender amount utilities (all amounts are integer yen).
export const DENOMINATIONS=Object.freeze([50,100,500,1000,5000,10000]);
export const MAX_TENDER=999999999;
export function parseTender(raw){
 const value=String(raw??'').trim();
 if(value==='')return 0;
 if(!/^\d+$/.test(value))throw Error('お預かり金額は0以上の整数で入力してください');
 const result=Number(value);
 if(!Number.isSafeInteger(result)||result>MAX_TENDER)throw Error('お預かり金額が上限を超えています');
 return result;
}
export function addDenomination(current,increment){
 if(!DENOMINATIONS.includes(increment))throw Error('対応していない金種です');
 const currentAmount=parseTender(current);
 if(currentAmount>MAX_TENDER-increment)throw Error('お預かり金額が上限を超えています');
 return currentAmount+increment;
}
export function tenderBalance(current,total){
 const received=parseTender(current);
 if(!Number.isSafeInteger(total)||total<0)throw Error('会計金額が不正です');
 return {received,change:Math.max(0,received-total),shortage:Math.max(0,total-received),enough:received>=total};
}
