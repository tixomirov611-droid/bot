import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const ledger=source.slice(source.indexOf('async function nikcarRentRefresh(){'),source.indexOf('function paymentsPage(){'));
function setup(owner=false){
 let resolve;const pending=new Promise(r=>resolve=r);const el={innerHTML:'',textContent:''};let reads=0,rpcs=0;
 const sb={rpc:async()=>{rpcs++;return {error:null}},from(){reads++;return {select(){return this},order(){return this},limit(){return pending}}}};
 const app=new Function('document','sb','isOwner','e','name','carName','money',`let user={id:'u1'},me={id:'p1'};${ledger};return {run:nikcarRentRefresh,switchUser:()=>{user={id:'u2'};me={id:'p2'}}}`)({getElementById:()=>el},sb,()=>owner,String,String,String,String);
 return {app,el,resolve,counts:()=>({reads,rpcs})};
}
test('driver reads own RLS-protected ledger without owner accrual RPC',async()=>{const h=setup();const p=h.app.run();h.resolve({data:[{amount_due:5600,paid_amount:1600,car_id:'car',driver_id:'driver',week_start:'2026-11-09',status:'pending'}]});await p;assert.match(h.el.innerHTML,/4000/);assert.deepEqual(h.counts(),{reads:1,rpcs:0})});
test('ledger response is discarded after account switch',async()=>{const h=setup();const p=h.app.run();h.app.switchUser();h.resolve({data:[{amount_due:500,car_id:'private-car'}]});await p;assert.equal(h.el.innerHTML,'')});
test('ledger errors are discarded after account switch',async()=>{const h=setup();const p=h.app.run();h.app.switchUser();h.resolve({error:new Error('old session error')});await p;assert.equal(h.el.textContent,'')});
const push=source.slice(source.indexOf('async function nikcarEnablePush(){'),source.indexOf('function accountPage(){'));
test('push permission delayed across signout never registers new account',async()=>{
 let resolve,writes=0;const permission=new Promise(r=>resolve=r);
 const app=new Function('navigator','window','Notification','sb','toast',`let user={id:'u1'},me={id:'p1',access:'active'};${push};return {run:nikcarEnablePush,logout:()=>{user=null;me=null}}`)({serviceWorker:{}},{PushManager:{},Notification:{}},{requestPermission:()=>permission},{from(){writes++;throw Error('Unexpected write')}},()=>{});
 const pending=app.run();app.logout();resolve('granted');await assert.rejects(pending,/Акаунт/);assert.equal(writes,0);
});
