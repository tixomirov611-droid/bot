'use strict';
// NikCar Fleet Control frontend regression tests. All Supabase calls are mocks.
// Run: node --test nikcar-pilot/tests/regression.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const startup = source.lastIndexOf('(async()=>');
assert.ok(startup > 0, 'Cannot find startup IIFE boundary');
const logic = source.slice(0, startup);
// The real startup imports a hosted SDK and accesses production services.
// Never execute that startup in these offline tests.
function harness() {
  const events = new Map();
  const root = {innerHTML: 'INITIAL'};
  const toast = {textContent: '', classList: {add(){}, remove(){}}};
  const storageData = {};
  const storage = {
    getItem: k => storageData[k] ?? null,
    setItem: (k,v) => {storageData[k] = String(v);},
    removeItem: k => {delete storageData[k];}
  };
  let dirty = false;
  const doc = {
    documentElement: {lang: 'uk'}, visibilityState: 'visible',
    getElementById: k => k === 'root' ? root : toast,
    addEventListener(k, fn) {
      const handlers = events.get(k) || [];
      handlers.push(fn);
      events.set(k, handlers);
    },
    querySelector: selector => selector.startsWith('form[') && dirty ? {dataset: {dirty:'1'}} : null,
    querySelectorAll: () => []
  };
  const win = {
    NIKCAR_SUPABASE: {url: 'https://mock.supabase.co', publishableKey: 'mock', redirectUrl: 'https://nikcar-cloud-pilot.onrender.com/'},
    addEventListener(){}, confirm: () => true, scrollTo(){}
  };
  function FormDataMock(form) {this.get = k => form.values?.[k] ?? null;}
  const factory = new Function('document','window','location','localStorage','sessionStorage','navigator','FormData','setTimeout','clearTimeout',
    logic + '\nreturn {setUser:x=>user=x,setMe:x=>me=x,setClient:x=>sb=x,setRecords:x=>records=x,' +
    'get:()=>({user,me,records,page,loadVersion,carEditor}),load,mutation,click:clickAction,docs:documentsPage,' +
    'authErrorMessage,clear:clearAccountState};');
  const app = factory(doc, win, {hash:'',search:''},storage,storage,{onLine:true},FormDataMock,()=>0,()=>{});
  async function fire(k, event) {
    for(const fn of events.get(k) || []) await fn(event);
  }
  return {app,root,doc,events,fire,setDirty:x=>{dirty=x;},toast};
}
const owner = {id:'o1',role:'owner',access:'active',full_name:'Owner'};
const driver = {id:'d1',role:'driver',access:'candidate',full_name:'Driver'};
function records(extra={}) {
  return {cars:[],rental_requests:[],chat_messages:[],sos_requests:[],profiles:[],
    driver_documents:[],announcements:[],payment_claims:[],repair_jobs:[],repair_parts:[],
    expense_entries:[],...extra};
}
function mockDb(profile, tables={}) {
  return {from: table => ({
    select(){return this;},order(){return this;},limit(){return this;},eq(){return this;},
    maybeSingle:async()=>({data:profile,error:null}),
    then(resolve,reject){return Promise.resolve({data:tables[table] || [],error:null}).then(resolve,reject);}
  })};
}
const microtasks = async () => {for(let n=0;n<160;n++)await Promise.resolve();};

test('auth errors distinguish email SMTP failure from ordinary sign-in throttling', () => {
  const {app} = harness();
  assert.match(app.authErrorMessage({status:429}), /Забагато запитів/);
  assert.match(app.authErrorMessage({status:500,code:'unexpected_failure'}, 'reset'), /Листа відновлення не надіслано/);
  assert.doesNotMatch(app.authErrorMessage({status:500}, ''), /SMTP/);
});

test('background refresh updates records without resetting unsaved form', async () => {
  const h = harness();
  h.app.setUser({id:'u1'});
  h.app.setMe(owner);
  h.app.setClient(mockDb(owner, {cars:[{id:'car1',model:'Logan',plate:'ABC123',status:'free',daily_rate:800}]}));
  h.setDirty(true);
  await h.app.load({preserveDraft:true});
  assert.equal(h.root.innerHTML,'INITIAL');
  assert.equal(h.app.get().records.cars.length,1);
  await h.app.load();
  assert.notEqual(h.root.innerHTML,'INITIAL');
});

test('typing marks forms dirty so background updates preserve them', async () => {
  const h = harness();
  const form = {dataset:{}};
  await h.fire('input',{target:{id:'phone',closest:()=>form}});
  assert.equal(form.dataset.dirty,'1');
  const selectForm = {dataset:{}};
  await h.fire('change',{target:{id:'status',closest:()=>selectForm,matches:()=>false}});
  assert.equal(selectForm.dataset.dirty,'1');
});

test('double-click confirming a payment sends only one RPC and unlocks afterward', async () => {
  const h = harness();
  let release, count=0;
  const pending = new Promise(resolve=>{release=resolve;});
  const client=mockDb(owner);
  client.rpc=async()=>{count++;await pending;return {data:null,error:null};};
  h.app.setClient(client);
  h.app.setUser({id:'u1'});
  h.app.setMe(owner);
  h.app.setRecords(records({payment_claims:[{id:'p1',status:'declared',amount:900,driver_id:'d1'}]}));
  const button={dataset:{action:'confirm-payment',id:'p1'},disabled:false,isConnected:true};
  const evt={target:{closest:()=>button}};
  await h.fire('click',evt);
  await h.fire('click',evt);
  // Opposite decision on the same payment must share the same in-flight lock.
  const rejecting={dataset:{action:'reject-payment',id:'p1'},disabled:false,isConnected:true};
  await h.fire('click',{target:{closest:()=>rejecting}});
  assert.equal(count,1);
  assert.equal(button.disabled,true);
  release();
  await microtasks();
  assert.equal(button.disabled,false);
});

test('driver document buttons show exactly the selected driver', async () => {
  const h = harness();
  h.app.setMe(owner);
  h.app.setUser({id:'u1'});
  h.app.setClient(mockDb(owner));
  h.app.setRecords(records({profiles:[driver,{id:'d2',role:'driver',access:'candidate',full_name:'Another Driver'}]}));
  await h.app.click({dataset:{action:'driver-docs',id:'d2'}});
  const text=h.app.docs();
  assert.match(text,/Another Driver/);
  assert.doesNotMatch(text,/>Driver</);
  assert.match(text,/all-driver-docs/);
  await h.app.click({dataset:{action:'all-driver-docs'}});
  assert.match(h.app.docs(),/>Driver</);
});

test('signed-out account data is discarded', () => {
  const h = harness();
  h.app.setUser({id:'u1'});
  h.app.setMe(owner);
  h.app.setRecords(records({profiles:[driver],cars:[{id:'c1'}]}));
  h.app.clear();
  assert.equal(h.app.get().me,null);
  assert.equal(h.app.get().records.profiles.length,0);
  assert.equal(h.app.get().records.cars.length,0);
});

test('missing database records keep role-based empty-state pages renderable', async () => {
  const h=harness();
  h.app.setMe(owner);
  h.app.setUser({id:'u1'});
  h.app.setClient(mockDb(owner));
  await h.app.load();
  assert.match(h.root.innerHTML,/shell/);
  assert.equal(h.app.get().records.cars.length,0);
});
