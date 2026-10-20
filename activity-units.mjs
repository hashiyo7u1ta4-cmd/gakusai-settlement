/** Contribution unit/rate mapping (historical type rates remain per count). */
export const ACTIVITY_UNITS = Object.freeze({
  prep:['count','hours'],shopping:['count','hours'],car:['count','km'],operation:['count','hours'],other:['count','hours']
});
export const EXTRA_RATES = Object.freeze({prep_hour:2,shopping_hour:3,car_km:0.2,operation_hour:2,other_hour:1});
export const activityUnitLabel = unit => ({count:'回',hours:'時間',km:'km'})[unit]||'回';
export function activityRateKey(type,unit){
  if(!Object.hasOwn(ACTIVITY_UNITS,type)||!ACTIVITY_UNITS[type].includes(unit))throw new Error('無効な活動単位');
  return unit==='count'?type:type+(unit==='hours'?'_hour':'_km');
}
