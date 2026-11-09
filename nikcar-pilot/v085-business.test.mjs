import test from 'node:test';
import assert from 'node:assert/strict';
import {inclusiveDays,freeDaysWithin,rentAdjustment,overlapping,mayApproveDaysOff} from './v085-business.mjs';
test('inclusive dates across month',()=>assert.equal(inclusiveDays('2026-11-30','2026-12-02'),3));
test('invalid dates rejected',()=>assert.throws(()=>inclusiveDays('2026-02-30','2026-03-01')));
test('overlap is inclusive',()=>assert.equal(overlapping({date_from:'2026-11-01',date_to:'2026-11-03'},{date_from:'2026-11-03',date_to:'2026-11-05'}),true));
test('cancelled and duplicated days not double-counted',()=>assert.equal(freeDaysWithin('2026-11-01','2026-11-05',[{date_from:'2026-11-01',date_to:'2026-11-03',status:'approved'},{date_from:'2026-11-02',date_to:'2026-11-04',status:'approved'},{date_from:'2026-11-05',date_to:'2026-11-05',status:'cancelled'}]),4));
test('rent reduction',()=>assert.equal(rentAdjustment({from:'2026-11-01',to:'2026-11-05',dailyRate:100,approved:[{date_from:'2026-11-02',date_to:'2026-11-03',status:'approved'}]}),200));
test('approval restricted',()=>{assert.equal(mayApproveDaysOff('admin'),true);assert.equal(mayApproveDaysOff('accountant'),false)});
