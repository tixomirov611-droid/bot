/* NikCar v0.85 shared, side-effect-free business logic.
   This module is not wired into the live app until the server/RLS integration is ready. */
export const OWNER_SECTIONS = Object.freeze(['dashboard','cars','drivers','finance','rentals','analytics','settings']);
export const SETTINGS_SECTIONS = Object.freeze(['api','integrations','financial','access','daysOff','notifications']);
export const DRIVER_SECTIONS = Object.freeze(['cars','rentals','payments','daysOff','notifications']);
export function isoDay(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid ISO date');
 const d=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value) throw new Error('Invalid calendar date');
 return Math.floor(d.getTime()/86400000);
}
export function inclusiveDays(from,to) {
 const days=isoDay(to)-isoDay(from)+1;
 if(days<1) throw new Error('End date precedes start date');
 return days;
}
export function overlapping(a,b) {
 return isoDay(a.date_from)<=isoDay(b.date_to)&&isoDay(b.date_from)<=isoDay(a.date_to);
}
export function freeDaysWithin(from,to,approved) {
 const start=isoDay(from),end=isoDay(to);
 if(end<start) throw new Error('Invalid period');
 const days=new Set();
 for(const item of approved) {
  if(item.status!=='approved') continue;
  const first=Math.max(start,isoDay(item.date_from)),last=Math.min(end,isoDay(item.date_to));
  for(let day=first;day<=last;day++) days.add(day);
 }
 return days.size;
}
export function rentAdjustment({from,to,dailyRate,approved=[]}) {
 if(!Number.isFinite(dailyRate)||dailyRate<0) throw new Error('Invalid daily rate');
 return Math.round(freeDaysWithin(from,to,approved)*dailyRate*100)/100;
}
export function mayApproveDaysOff(role){return role==='owner'||role==='admin';}

// Recalculate a seven-day bill from source dates, never subtract from a
// previously discounted bill. Existing debt is deliberately outside this API.
export function weeklyRent({vehicleId,weekStart,dailyRate,approved=[]}) {
 if(!vehicleId) throw new Error('Vehicle is required');
 if(!Number.isFinite(dailyRate)||dailyRate<0) throw new Error('Invalid daily rate');
 const start=isoDay(weekStart);
 const weekEnd=new Date((start+6)*86400000).toISOString().slice(0,10);
 const freeDays=freeDaysWithin(weekStart,weekEnd,approved.filter(x=>x.vehicle_id===vehicleId));
 const dailyCents=Math.round(dailyRate*100);
 if(!Number.isSafeInteger(dailyCents*7)) throw new Error('Daily rate is too large');
 return {weekStart,weekEnd,freeDays,billableDays:7-freeDays,
  gross:dailyCents*7/100,discount:dailyCents*freeDays/100,
  due:dailyCents*(7-freeDays)/100};
}
