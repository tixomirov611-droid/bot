import test from 'node:test';
import assert from 'node:assert/strict';
import {inclusiveDays,freeDaysWithin,rentAdjustment,overlapping,mayApproveDaysOff} from './v085-business.mjs';
test('inclusive dates across month',()=>assert.equal(inclusiveDays('2026-11-30','2026-12-02'),3));
test('invalid dates rejected',()=>assert.throws(()=>inclusiveDays('2026-02-30','2026-03-01')));
test('overlap is inclusive',()=>assert.equal(overlapping({date_from:'2026-11-01',date_to:'2026-11-03'},{date_from:'2026-11-03',date_to:'2026-11-05'}),true));
test('cancelled and duplicated days not double-counted',()=>assert.equal(freeDaysWithin('2026-11-01','2026-11-05',[{date_from:'2026-11-01',date_to:'2026-11-03',status:'approved'},{date_from:'2026-11-02',date_to:'2026-11-04',status:'approved'},{date_from:'2026-11-05',date_to:'2026-11-05',status:'cancelled'}]),4));
test('rent reduction',()=>assert.equal(rentAdjustment({from:'2026-11-01',to:'2026-11-05',dailyRate:100,approved:[{date_from:'2026-11-02',date_to:'2026-11-03',status:'approved'}]}),200));
test('approval restricted',()=>{assert.equal(mayApproveDaysOff('admin'),true);assert.equal(mayApproveDaysOff('accountant'),false)});

import {weeklyRent} from './v085-business.mjs';
const dayOff=(from,to,status='approved',vehicle_id='car1')=>({vehicle_id,date_from:from,date_to:to,status});
const weekly=(approved,weekStart='2026-11-09')=>weeklyRent({vehicleId:'car1',weekStart,dailyRate:800,approved});
test('two arbitrary days reduce weekly rent from 5600 to 4000',()=>{
 const r=weekly([dayOff('2026-11-10','2026-11-10'),dayOff('2026-11-13','2026-11-13')]);
 assert.equal(r.due,4000);assert.equal(r.discount,1600);assert.equal(r.billableDays,5);
});
test('cross-week interval is allocated to each week',()=>{
 const days=[dayOff('2026-11-14','2026-11-17')];
 assert.equal(weekly(days).freeDays,2);assert.equal(weekly(days,'2026-11-16').freeDays,2);
});
test('repeat calculation, duplicates and other vehicles do not reduce bill again',()=>{
 const days=[dayOff('2026-11-10','2026-11-10'),dayOff('2026-11-10','2026-11-10'),dayOff('2026-11-09','2026-11-15','approved','car2')];
 assert.equal(weekly(days).due,4800);assert.deepEqual(weekly(days),weekly(days));
});
test('cancellation restores daily rent; fully free week never creates a credit',()=>{
 assert.equal(weekly([dayOff('2026-11-09','2026-11-15','cancelled')]).due,5600);
 assert.equal(weekly([dayOff('2026-11-01','2026-11-30')]).due,0);
});
test('weekly calculation does not change existing debt data',()=>{
 const data={vehicleId:'car1',weekStart:'2026-11-09',dailyRate:800,approved:[dayOff('2026-11-10','2026-11-11')],oldDebt:2000};
 const before=JSON.stringify(data);assert.equal(weeklyRent(data).due,4000);assert.equal(JSON.stringify(data),before);
});
