/** Supabase -> accounting model. Accounting IDs are independent of anonymous auth IDs. */
import { FUND } from './engine.mjs';
export function normalizeCloud(evt, memberRows, activities=[], expenses=[], deposits=[], transfers=[]){
  const people=memberRows.map(x=>({id:x.member_id??x.user_id,userId:x.user_id??null,name:x.display_name,role:x.role}));
  const records={
    activities:activities.map(x=>({...x,unit:x.unit||'count',personId:x.person_id,date:x.record_date,quantity:Number(x.quantity),rate:Number(x.rate)})),
    expenses:expenses.map(x=>({...x,paidBy:x.paid_by??FUND,date:x.record_date,amount:Number(x.amount)})),
    deposits:deposits.map(x=>({...x,personId:x.person_id,date:x.record_date,amount:Number(x.amount)})),
    transfers:transfers.map(x=>({...x,from:x.from_user??FUND,to:x.to_user??FUND,date:x.record_date,amount:Number(x.amount)}))
  };
  const state={version:1,eventName:evt.event_name,sales:Number(evt.sales),reserve:Number(evt.reserve),rates:evt.rates,
    people:people.map(({id,name,userId})=>({id,name,userId})),activities:records.activities.filter(x=>x.status==='approved'),
    expenses:records.expenses.filter(x=>x.status==='approved'),deposits:records.deposits.filter(x=>x.status==='approved'),transfers:records.transfers};
  return {people,records,state};
}
