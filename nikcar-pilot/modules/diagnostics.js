/* NikCar diagnostics 6.3: local, bounded, privacy-conscious telemetry.
   Never transmit errors or form contents to third parties. */
(function(){
 'use strict';
 const MAX=80,events=[],stats=new Map(),started=new Map();
 function clean(value){return String(value??'').replace(/https?:\/\/\S+/gi,'[url]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]').replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi,'[identifier]').replace(/\b\d{8,}\b/g,'[number]').slice(0,160);}
 function record(kind,category,detail){const entry={at:new Date().toISOString(),kind,category:clean(category),detail:clean(detail)};events.push(entry);if(events.length>MAX)events.shift();if(kind==='error')console.warn('[NikCar diagnostics]',entry.category);return entry;}
 function measure(label,ms){if(!Number.isFinite(ms))return;const key=clean(label),x=stats.get(key)||{count:0,total:0,max:0,slow:0};x.count++;x.total+=ms;x.max=Math.max(x.max,ms);if(ms>1000){x.slow++;record('slow',key,Math.round(ms)+'ms');}stats.set(key,x);}
 window.NikCarDiagnostics=Object.freeze({
  recordError:(category,err)=>record('error',category,err?.name||'runtime'),
  start:(label)=>{const id=clean(label)+':'+Math.random().toString(36).slice(2);started.set(id,performance.now());return id;},
  end:(id,label)=>{if(!started.has(id))return;const ms=performance.now()-started.get(id);started.delete(id);measure(label||id.split(':')[0],ms);},
  measure,
  snapshot:()=>({events:events.map(x=>({...x})),performance:[...stats].map(([name,x])=>({name,count:x.count,avgMs:Math.round(x.total/x.count),maxMs:Math.round(x.max),slow:x.slow}))}),
  clear:()=>{events.length=0;stats.clear();started.clear();}
 });
 window.addEventListener('error',ev=>{const filename=String(ev.filename||'');if(filename&&/^(https?:)/.test(filename)&&!filename.includes(location.host))return;record('error','window',ev.error?.name||'ScriptError');});
 window.addEventListener('unhandledrejection',ev=>record('error','promise',ev.reason?.name||'RejectedPromise'));
 if('PerformanceObserver' in window){try{const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.duration>50)measure('long-task',e.duration);});observer.observe({entryTypes:['longtask']});}catch(_){}}
})();
