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
  const netStatus={hidden:true,textContent:''};
  const storageData = {};
  const storage = {
    getItem: k => storageData[k] ?? null,
    setItem: (k,v) => {storageData[k] = String(v);},
    removeItem: k => {delete storageData[k];}
  };
  let dirty = false, online = true;
  const navigatorMock={get onLine(){return online;}};
  const doc = {
    documentElement: {lang: 'uk'}, visibilityState: 'visible',
    getElementById: k => k === 'root' ? root : k === 'network-status' ? netStatus : toast,
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
    addEventListener(k,fn){const handlers=events.get('win:'+k)||[];handlers.push(fn);events.set('win:'+k,handlers);}, confirm: () => true, scrollTo(){}
  };
  function FormDataMock(form) {this.get = k => form.values?.[k] ?? null;}
  const factory = new Function('document','window','location','localStorage','sessionStorage','navigator','FormData','setTimeout','clearTimeout','crypto',
    logic + '\nreturn {setUser:x=>user=x,setMe:x=>me=x,setClient:x=>sb=x,setRecords:x=>records=x,' +
    'get:()=>({user,me,records,page,loadVersion,carEditor}),load,mutation,click:clickAction,docs:documentsPage,' +
    'authErrorMessage,clear:clearAccountState};');
  const app = factory(doc, win, {hash:'',search:''},storage,storage,navigatorMock,FormDataMock,()=>0,()=>{},{randomUUID:()=> 'mock-file'});
  async function fire(k, event) {
    for(const fn of events.get(k) || []) await fn(event);
  }
  return {app,root,doc,events,fire,setDirty:x=>{dirty=x;},setOnline:x=>{online=x;},netStatus,toast};
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

test('successful mutation still redraws when a background load supersedes its refresh', async () => {
  const h=harness();
  const resolvers=[];
  const client={from:()=>({
    select(){return this;},order(){return this;},limit(){return this;},eq(){return this;},
    maybeSingle(){return new Promise(resolve=>resolvers.push(resolve));},
    then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}
  })};
  h.app.setClient(client);
  h.app.setUser({id:'u1'});
  h.app.setMe(owner);
  h.app.setRecords(records());
  h.setDirty(true);
  const mutation=h.app.mutation(Promise.resolve({error:null,data:null}),'saved');
  await microtasks();
  assert.equal(resolvers.length,1);
  const background=h.app.load({preserveDraft:true});
  assert.equal(resolvers.length,2);
  resolvers[0]({data:owner,error:null});
  await mutation;
  assert.equal(h.root.innerHTML,'INITIAL');
  resolvers[1]({data:owner,error:null});
  await background;
  assert.notEqual(h.root.innerHTML,'INITIAL');
});

test('role or access demotion redraws immediately even if an old form is dirty', async () => {
  const h=harness();
  h.app.setUser({id:'u1'});
  h.app.setMe(owner);
  const blocked={id:'o1',role:'driver',access:'blocked',full_name:'Owner'};
  h.app.setClient(mockDb(blocked));
  h.setDirty(true);
  await h.app.load({preserveDraft:true});
  assert.notEqual(h.root.innerHTML,'INITIAL');
  assert.equal(h.app.get().me.access,'blocked');
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

test('offline banner appears without replacing the login form and disappears on reconnect', async () => {
 const h=harness();
 h.setOnline(false);
 await h.fire('win:offline',{});
 assert.equal(h.netStatus.hidden,false);
 assert.match(h.netStatus.textContent,/Немає інтернету/);
 assert.equal(h.root.innerHTML,'INITIAL');
 h.setOnline(true);
 await h.fire('win:online',{});
 assert.equal(h.netStatus.hidden,true);
 assert.equal(h.root.innerHTML,'INITIAL');
});

test('offline form submit neither sends a request nor discards user input', async () => {
 const h=harness();
 h.setOnline(false);
 let loginCalls=0;
 h.app.setClient({auth:{signInWithPassword:async()=>{loginCalls++;return {error:null}}}});
 const form={id:'auth-form',dataset:{},values:{email:'driver@example.com',password:'not-a-real-password'},isConnected:true,
  querySelector:()=>({disabled:false})};
 await h.fire('submit',{target:form,preventDefault(){}});
 assert.equal(loginCalls,0);
 assert.equal(form.dataset.submitting,'0');
 assert.match(h.root.innerHTML,/Немає підключення до інтернету/);
 assert.match(h.toast.textContent,/інтернету|дію/i);
});

test('offline protected owner action is refused before invoking the server', async () => {
 const h=harness();
 h.app.setUser({id:'u1'});h.app.setMe(owner);
 h.app.setRecords(records({payment_claims:[{id:'p1',status:'declared',amount:500}]}));
 let calls=0;
 h.app.setClient({rpc:async()=>{calls++;return {error:null}}});
 h.setOnline(false);
 const button={dataset:{action:'confirm-payment',id:'p1'},disabled:false,isConnected:true};
 await h.fire('click',{target:{closest:()=>button}});
 assert.equal(calls,0);assert.equal(button.disabled,false);
 assert.match(h.toast.textContent,/Немає інтернету/);
});

test('failed database document save removes exactly the newly uploaded orphan', async () => {
 const h=harness(); h.app.setUser({id:'u1'});h.app.setMe(driver);
 let uploaded=[],removed=[],saved=[];
 h.app.setClient({
  storage:{from:bucket=>({
   upload:async (path,blob)=>{uploaded.push({bucket,path});return {error:null};},
   remove:async paths=>{removed.push(paths);return {error:null};}
  })},
  from:table=>({insert:async row=>{saved.push({table,row});return {error:new Error('DB rejected row')};}})
 });
 const input={id:'document-input',dataset:{docKind:'passport_1',car:''},files:[{size:100,type:'image/jpeg'}],
  matches:selector=>selector.includes('input[type="file"]'),disabled:false,closest:()=>null};
 await h.fire('change',{target:input});
 assert.equal(uploaded.length,1);
 assert.equal(saved.length,1);
 assert.equal(removed.length,1);
 assert.deepEqual(removed[0],[uploaded[0].path]);
 assert.equal(uploaded[0].bucket,'nikcar-driver-docs');
 assert.equal(saved[0].row.driver_id,driver.id);
 assert.match(h.toast.textContent,/DB rejected row/);
 assert.equal(input.disabled,false);
});

test('document upload failure never deletes another file', async () => {
 const h=harness(); h.app.setUser({id:'u1'});h.app.setMe(driver);
 let removed=0;
 h.app.setClient({storage:{from:()=>({
  upload:async()=>({error:new Error('Upload rejected')}),
  remove:async()=>{removed++;return {error:null};}
 })}});
 const input={id:'document-input',dataset:{docKind:'passport_1',car:''},files:[{size:50,type:'image/jpeg'}],
  matches:selector=>selector.includes('input[type="file"]'),disabled:false,closest:()=>null};
 await h.fire('change',{target:input});
 assert.equal(removed,0);
 assert.match(h.toast.textContent,/Upload rejected/);
});

test('offline document upload never reaches private storage', async () => {
 const h=harness();h.app.setUser({id:'u1'});h.app.setMe(driver);h.setOnline(false);
 let uploads=0;
 h.app.setClient({storage:{from:()=>({upload:async()=>{uploads++;return {error:null}}})}});
 const input={id:'document-input',dataset:{docKind:'passport_1',car:''},files:[{size:100,type:'image/jpeg'}],
  matches:selector=>selector.includes('input[type="file"]'),disabled:false,closest:()=>null};
 await h.fire('change',{target:input});
 assert.equal(uploads,0);
 assert.match(h.toast.textContent,/Немає інтернету/);
});
