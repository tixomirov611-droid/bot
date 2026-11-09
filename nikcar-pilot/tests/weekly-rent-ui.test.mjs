import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {weeklyRent} from '../v085-business.mjs';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function calculateWeeklyRent('),source.indexOf('function paymentsPage(){')).replace("await import('./v085-business.mjs?v=0.85.0')",'await Promise.resolve({weeklyRent:billingFn})');
function setup(error=null){
 const output={isConnected:true,textContent:'',innerHTML:''},button={disabled:false},calls=[];
 const client={from(table){const q={select(){return q},eq(k,v){calls.push([table,k,v]);return q},lte(k,v){calls.push([table,k,v]);return q},gte(k,v){calls.push([table,k,v]);return q},single(){return Promise.resolve({data:{daily_rate:800},error})},then(resolve,reject){return Promise.resolve({data:[{vehicle_id:'car1',date_from:'2026-11-10',date_to:'2026-11-11',status:'approved'}],error}).then(resolve,reject)}};return q}};
 const calculate=new Function('document','user','sb','FormData','billingFn','isOffline','toast','offlineMessage','money','e',fn+';return calculateWeeklyRent;')({getElementById:()=>output},{id:'u'},client,function(){this.get=k=>k==='car'?'car1':'2026-11-09'},weeklyRent,()=>false,()=>{},()=>'',n=>String(n),s=>String(s));
 return {output,button,calls,run:()=>calculate({querySelector:()=>button})};
}
test('payment UI uses fresh car rate and selected week days from database',async()=>{const h=setup();await h.run();assert.match(h.output.innerHTML,/4000/);assert.ok(h.calls.some(c=>c[1]==='date_from'&&c[2]==='2026-11-15'));assert.ok(h.calls.some(c=>c[1]==='date_to'&&c[2]==='2026-11-09'));assert.equal(h.button.disabled,false)});
test('database failure never renders a zero or fabricated weekly bill',async()=>{const h=setup({message:'Access denied'});await h.run();assert.equal(h.output.innerHTML,'');assert.match(h.output.textContent,/Access denied/);assert.equal(h.button.disabled,false)});
