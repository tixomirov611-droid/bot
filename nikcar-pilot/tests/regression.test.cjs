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
function harness(initialStorage={}) {
  const events = new Map();
  const root = {innerHTML: 'INITIAL'};
  const toast = {textContent: '', classList: {add(){}, remove(){}}};
  const netStatus={hidden:true,textContent:''};
  const storageData = {...initialStorage};
  const themeButtons=[];
  const storage = {
    getItem: k => storageData[k] ?? null,
    setItem: (k,v) => {storageData[k] = String(v);},
    removeItem: k => {delete storageData[k];}
  };
  let dirty = false, online = true;
  const navigatorMock={get onLine(){return online;}};
  const doc = {
    documentElement: {lang: 'uk',dataset:{}}, visibilityState: 'visible',
    getElementById: k => k === 'root' ? root : k === 'network-status' ? netStatus : toast,
    addEventListener(k, fn) {
      const handlers = events.get(k) || [];
      handlers.push(fn);
      events.set(k, handlers);
    },
    querySelector: selector => selector.startsWith('form[') && dirty ? {dataset: {dirty:'1'}} : null,
    querySelectorAll: selector => selector==='[data-action="toggle-theme"]' ? themeButtons : []
  };
  const win = {
    NIKCAR_SUPABASE: {url: 'https://mock.supabase.co', publishableKey: 'mock', redirectUrl: 'https://nikcar-cloud-pilot.onrender.com/'},
    addEventListener(k,fn){const handlers=events.get('win:'+k)||[];handlers.push(fn);events.set('win:'+k,handlers);}, confirm: () => true, scrollTo(){}
  };
  function FormDataMock(form) {this.get = k => form.values?.[k] ?? null;}
  const factory = new Function('document','window','location','localStorage','sessionStorage','navigator','FormData','setTimeout','clearTimeout','crypto',
    logic + '\nreturn {setUser:x=>user=x,setMe:x=>me=x,setClient:x=>sb=x,setRecords:x=>records=x,' +
    'get:()=>({user,me,records,page,loadVersion,carEditor}),load,mutation,click:clickAction,docs:documentsPage,requestsPage,' +
    'authErrorMessage,clear:clearAccountState,setRecovery:x=>setRecoveryMode(x),getRecovery:()=>({active:recoveryMode,notice:authNotice,isError:authNoticeIsError}),getTheme:()=>theme,themeControl,themeLogin:authPage,themeHeader:()=>layout("", "Test")};');
  const app = factory(doc, win, {hash:'',search:''},storage,storage,navigatorMock,FormDataMock,()=>0,()=>{},{randomUUID:()=> 'mock-file'});
  async function fire(k, event) {
    for(const fn of events.get(k) || []) await fn(event);
  }
  return {app,root,doc,events,fire,setDirty:x=>{dirty=x;},setOnline:x=>{online=x;},addThemeButton:b=>themeButtons.push(b),getSavedTheme:()=>storageData['nikcar-theme'],netStatus,toast};
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
 assert.equal(h.root.innerHTML,'INITIAL'); // No re-render: the existing form and its input values stay intact.
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

test('successful recovery updates password and confirms sign-out before showing success', async () => {
 const h=harness();
 h.app.setUser({id:'recovery-user'});
 h.app.setMe(owner);
 h.app.setRecords(records({profiles:[driver],cars:[{id:'c1'}]}));
 h.app.setRecovery(true);
 let updates=0,logouts=0;
 h.app.setClient({auth:{
  updateUser:async({password})=>{updates++;assert.equal(password,'secure-new-password');return {error:null};},
  signOut:async()=>{logouts++;return {error:null};}
 }});
 const form={id:'new-password-form',dataset:{},values:{password:'secure-new-password',confirm_password:'secure-new-password'},
  isConnected:true,querySelector:()=>({disabled:false})};
 await h.fire('submit',{target:form,preventDefault(){}});
 assert.equal(updates,1);assert.equal(logouts,1);
 assert.equal(h.app.get().user,null);
 assert.equal(h.app.getRecovery().active,false);
 assert.equal(h.app.get().records.profiles.length,0);
 assert.equal(h.app.getRecovery().isError,false);
});

test('recovery must not report completed logout when signOut returns an error', async () => {
 const h=harness();
 h.app.setUser({id:'recovery-user'});h.app.setMe(owner);h.app.setRecovery(true);
 let updates=0,logouts=0;
 h.app.setClient({auth:{
  updateUser:async()=>{updates++;return {error:null};},
  signOut:async()=>{logouts++;return {error:new Error('Simulated sign-out failure')};}
 }});
 const form={id:'new-password-form',dataset:{},values:{password:'secure-new-password',confirm_password:'secure-new-password'},
  isConnected:true,querySelector:()=>({disabled:false})};
 await h.fire('submit',{target:form,preventDefault(){}});
 assert.equal(updates,1);assert.equal(logouts,1);
 assert.equal(h.app.get().user.id,'recovery-user');
 assert.equal(h.app.getRecovery().active,true);
 assert.equal(h.app.getRecovery().isError,true);
 assert.match(h.app.getRecovery().notice,/Пароль змінено, але завершити сеанс не вдалося/);
 assert.match(h.root.innerHTML,/data-action="signout"/);
});

test('recovery sign-out network exception leaves the session visible with a warning', async () => {
 const h=harness();
 h.app.setUser({id:'recovery-user'});h.app.setMe(owner);h.app.setRecovery(true);
 h.app.setClient({auth:{
  updateUser:async()=>({error:null}),
  signOut:async()=>{throw new Error('network dropped');}
 }});
 const form={id:'new-password-form',dataset:{},values:{password:'secure-new-password',confirm_password:'secure-new-password'},
  isConnected:true,querySelector:()=>({disabled:false})};
 await h.fire('submit',{target:form,preventDefault(){}});
 assert.equal(h.app.getRecovery().active,true);
 assert.equal(h.app.getRecovery().isError,true);
 assert.equal(h.app.get().user.id,'recovery-user');
});

test('password update error does not attempt logout or pretend password was changed', async () => {
 const h=harness();
 h.app.setUser({id:'recovery-user'});h.app.setMe(owner);h.app.setRecovery(true);
 let logouts=0;
 h.app.setClient({auth:{
  updateUser:async()=>({error:{code:'weak_password',message:'weak password'}}),
  signOut:async()=>{logouts++;return {error:null};}
 }});
 const form={id:'new-password-form',dataset:{},values:{password:'secure-new-password',confirm_password:'secure-new-password'},
  isConnected:true,querySelector:()=>({disabled:false})};
 await h.fire('submit',{target:form,preventDefault(){}});
 assert.equal(logouts,0);
 assert.equal(h.app.getRecovery().active,true);
 assert.equal(h.app.getRecovery().isError,true);
 assert.doesNotMatch(h.app.getRecovery().notice,/Пароль змінено/);
});

test('light theme is the default with moon icon on the login screen', () => {
 const h=harness();
 assert.equal(h.app.getTheme(),'light');
 assert.equal(h.doc.documentElement.dataset.theme,'light');
 assert.match(h.app.themeControl(),/aria-pressed="false"/);
 assert.match(h.app.themeControl(),/aria-label="Темна тема"/);
 assert.match(h.app.themeControl(),/M20\.8 14\.1/);
 assert.match(h.app.themeLogin(),/data-action="toggle-theme"/);
});

test('sun and moon switcher updates theme without rerendering or losing typed forms', async () => {
 const h=harness();h.setDirty(true);
 const button={innerHTML:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
 h.addThemeButton(button);
 const previous=h.root.innerHTML;
 await h.app.click({dataset:{action:'toggle-theme'}});
 assert.equal(h.app.getTheme(),'dark');
 assert.equal(h.getSavedTheme(),'dark');
 assert.equal(h.doc.documentElement.dataset.theme,'dark');
 assert.equal(button.attrs['aria-pressed'],'true');
 assert.equal(button.attrs['aria-label'],'Світла тема');
 assert.match(button.innerHTML,/circle cx="12"/);
 assert.equal(h.root.innerHTML,previous);
 await h.app.click({dataset:{action:'toggle-theme'}});
 assert.equal(h.app.getTheme(),'light');
 assert.equal(h.getSavedTheme(),'light');
 assert.equal(button.attrs['aria-pressed'],'false');
 assert.match(button.innerHTML,/M20\.8 14\.1/);
 assert.equal(h.root.innerHTML,previous);
});

test('saved dark theme persists on app reload and is accessible in English', () => {
 const h=harness({'nikcar-theme':'dark','nikcar-lang':'en'});
 assert.equal(h.app.getTheme(),'dark');
 assert.equal(h.doc.documentElement.dataset.theme,'dark');
 assert.match(h.app.themeLogin(),/aria-label="Light theme"/);
 assert.match(h.app.themeLogin(),/aria-pressed="true"/);
 h.app.setUser({id:'theme-user',email:'test@example.com'});h.app.setMe(owner);
 assert.match(h.app.themeHeader(),/data-action="toggle-theme"/);
});

test('invalid saved theme does not break interface and falls back to light', () => {
 const h=harness({'nikcar-theme':'malformed'});
 assert.equal(h.app.getTheme(),'light');
 assert.match(h.app.themeLogin(),/aria-pressed="false"/);
});

test('dark palette covers navigation, account forms, banners and mobile layout', () => {
 const css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 for(const selector of ['.sidebar','.mobilebar','.v09-auth .auth-box','.field input','.card','.tag','.banner.warning','.more-sheet']) {
  assert.ok(css.includes(selector),selector+' missing');
 }
 assert.match(css,/:root\[data-theme="dark"\]/);
 assert.match(css,/color-scheme:dark/);
 assert.match(html,/localStorage\.getItem\('nikcar-theme'\)/);
 assert.ok(html.indexOf("localStorage.getItem('nikcar-theme')") < html.indexOf('rel="stylesheet"'),'saved theme must load before CSS');
});

test('recovery email keeps the valid link and includes NikCar signature and raster logo', () => {
 const recovery=fs.readFileSync(path.join(__dirname,'..','email-templates','recovery.html'),'utf8');
 assert.equal((recovery.match(/\{\{ \.ConfirmationURL \}\}/g)||[]).length,1);
 assert.match(recovery,/С уважением, команда NikCar/);
 assert.match(recovery,/nikcar-cloud-pilot\.onrender\.com\/email-logo\.png/);
 assert.match(recovery,/Nik<span style="color:#098b7e;">Car<\/span>/);
 assert.match(recovery,/Нікому не передавайте це посилання/);
 const logo=fs.readFileSync(path.join(__dirname,'..','email-logo.png'));
 assert.equal(logo.toString('hex',0,8),'89504e470d0a1a0a','Email icon must be a PNG, not unsupported SVG');
 assert.equal(logo.readUInt32BE(16),96);
 assert.equal(logo.readUInt32BE(20),96);
});

test('NikCar Service acid-lime identity is consistent across both themes and app icon', () => {
 const css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
 const icon=fs.readFileSync(path.join(__dirname,'..','icon.svg'),'utf8');
 const brand=fs.readFileSync(path.join(__dirname,'..','brand-logo.svg'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.webmanifest'),'utf8'));
 assert.match(css,/--brand-lime:#dfff00/);
 assert.match(css,/:root\[data-theme="dark"\]/);
 assert.match(css,/--bg:#101116/);
 assert.match(css,/--surface:#fff/);
 assert.match(icon,/#DFFF00/);
 assert.match(brand,/NikCar Service/i);
 assert.match(brand,/>SERVICE</);
 assert.match(html,/style\.css\?v=0\.15\.0/);
 assert.equal(manifest.theme_color,'#DFFF00');
 assert.match(source,/SERVICE · FLEET/);
});

test('light mode lime labels remain readable while dark mode retains neon accent', () => {
 const css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
 assert.match(css,/:root:not\(\[data-theme="dark"\]\) \.mobilebar button\.active\{color:#405000\}/);
 assert.match(css,/:root:not\(\[data-theme="dark"\]\) \.auth-intro \.eyebrow\{color:#4c6000\}/);
 assert.match(css,/:root\[data-theme="dark"\] \.mobilebar button\.active\{color:#dfff00\}/);
});

test('readability pass protects readable text, mobile form sizing and keyboard focus', () => {
 const css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 assert.match(css,/--muted:#4b565b/);
 assert.match(css,/--muted:#c3c9c7/);
 assert.match(css,/body\{font-size:15px;line-height:1\.55/);
 assert.match(css,/\.field input,\.field select,\.field textarea\{font-size:16px\}/);
 assert.match(css,/button:focus-visible,a:focus-visible/);
 assert.match(css,/\.mobilebar button\.active\{color:#344500\}/);
 assert.match(html,/style\.css\?v=0\.15\.0/);
});

test('owner sees rental handover and return controls, drivers cannot perform them', () => {
 const h=harness();
 h.app.setUser({id:'owner-user',email:'owner@example.com'});h.app.setMe(owner);
 const r={id:'rental-1',car_id:'car-1',driver_id:'driver-1',status:'approved',created_at:'2026-11-08T12:00:00Z',handed_over_at:null,returned_at:null};
 h.app.setRecords({...records(),rental_requests:[r]});
 assert.match(h.app.requestsPage(),/data-action="handover-rental"/);
 h.app.setRecords({...records(),rental_requests:[{...r,handed_over_at:'2026-11-08T13:00:00Z',odometer_out_km:10000,fuel_full_out:true}]});
 assert.match(h.app.requestsPage(),/data-action="return-rental"/);
 h.app.setMe({...owner,role:'driver',id:'driver-1'});
 assert.doesNotMatch(h.app.requestsPage(),/data-action="handover-rental"|data-action="return-rental"/);
});
test('rental lifecycle SQL guards owner role, full tank, mileage and atomic car transitions', () => {
 const sql=fs.readFileSync(path.join(__dirname,'..','sql','20261108_rental_lifecycle_v1.sql'),'utf8');
 assert.match(sql,/private\.is_owner\(\)/);
 assert.match(sql,/p_full_tank is distinct from true/);
 assert.match(sql,/p_odometer<r\.odometer_out_km/);
 assert.match(sql,/status='rented' where id=r\.car_id and status='reserved'/);
 assert.match(sql,/status='free' where id=r\.car_id and status='rented'/);
 assert.match(sql,/revoke all on function public\.nikcar_return_rental/);
});
