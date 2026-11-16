const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('index.html');
test('all local script and stylesheet references exist',()=>{
 const refs=[...html.matchAll(/(?:src|href)="(\.\/[^"]+\.(?:js|css))(?:\?[^"]*)?"/g)].map(x=>x[1].slice(2));
 assert.ok(refs.includes('modules/upload-retry.js'));
 assert.ok(refs.includes('modules/diagnostics.js'));
 for(const file of refs)assert.ok(fs.existsSync(path.join(root,file)),file);
});
test('modules load before app.js',()=>{
 assert.ok(html.indexOf('modules/diagnostics.js')<html.indexOf('app.js'));
 assert.ok(html.indexOf('modules/upload-retry.js')<html.indexOf('app.js'));
});
test('all local JavaScript parses',()=>{
 for(const file of ['config.js','gps-demo.js','guide.js','app.js','modules/upload-retry.js','modules/diagnostics.js'])new vm.Script(read(file),{filename:file});
});
test('upload retry distinguishes transient and permanent errors',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(read('modules/upload-retry.js'),ctx);
 assert.equal(ctx.nikcarRetryableUploadError({message:'Network request failed'}),true);
 assert.equal(ctx.nikcarRetryableUploadError({status:503,message:'Service unavailable'}),true);
 assert.equal(ctx.nikcarRetryableUploadError({status:403,message:'Forbidden'}),false);
 assert.equal(ctx.nikcarRetryableUploadError({status:400,message:'Invalid MIME'}),false);
});
test('upload retries transient errors and stops on permanent errors',async()=>{
 let attempts=0;const ctx={navigator:{onLine:true},window:{addEventListener(){},removeEventListener(){}},setTimeout:(fn)=>{fn();return 1},clearTimeout(){},user:{id:'test'},sb:{storage:{from:()=>({upload:async()=>{attempts++;return {error:attempts<3?{status:503,message:'Service unavailable'}:null}}})}}};
 vm.createContext(ctx);vm.runInContext(read('modules/upload-retry.js'),ctx);
 assert.equal(await ctx.nikcarUploadWithRetry('test','path',{},{upsert:true}), 'path');
 assert.equal(attempts,3);
 attempts=0;ctx.sb.storage.from=()=>({upload:async()=>{attempts++;return {error:{status:403,message:'Forbidden'}}}});
 await assert.rejects(ctx.nikcarUploadWithRetry('test','path',{},{upsert:true}));
 assert.equal(attempts,1);
});
test('diagnostics does not persist or transmit events',()=>{
 const source=read('modules/diagnostics.js');
 assert.doesNotMatch(source,/\bfetch\s*\(|sendBeacon\s*\(|localStorage\.setItem\s*\(/);
 const listeners={};const ctx={window:{addEventListener:(name,fn)=>listeners[name]=fn},performance:{now:()=>0},console:{warn(){}},location:{host:'example.test'},PerformanceObserver:undefined};
 ctx.window.window=ctx.window;vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.window.NikCarDiagnostics.recordError('test',new Error('secret'));
 const snapshot=ctx.window.NikCarDiagnostics.snapshot();
 assert.equal(snapshot.events.length,1);
 assert.equal(snapshot.events[0].detail,'Error');
});
test('finance safeguards remain present',()=>{
 const app=read('app.js');
 assert.match(app,/nikcar_approve_days_off_v085/);
 assert.match(app,/nikcar_debt_calls_overview_v1/);
});
