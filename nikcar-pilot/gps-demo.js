/* NikCar GPS showcase: explicitly fictional local UI. Never writes to Supabase. */
(()=>{
 const samples=[
  {id:'demo-01',title:'Тестове авто №1',plate:'DEMO-001',status:'Рух',speed:42,battery:13.9,last:'10:42',km:126400,trip:18.6,lat:46.9750,lon:31.9946},
  {id:'demo-02',title:'Тестове авто №2',plate:'DEMO-002',status:'Стоянка',speed:0,battery:12.6,last:'10:39',km:87350,trip:7.4,lat:46.9665,lon:32.0102},
  {id:'demo-03',title:'Тестове авто №3',plate:'DEMO-003',status:'Немає зв’язку',speed:null,battery:null,last:'Учора',km:102800,trip:0,lat:null,lon:null}
 ];
 const routes=[
  {id:'r1',car:'demo-01',date:'2026-11-08',start:'09:15',end:'10:02',distance:18.6,max:67,avg:31,stops:2},
  {id:'r2',car:'demo-01',date:'2026-11-07',start:'14:20',end:'15:05',distance:12.3,max:58,avg:27,stops:1},
  {id:'r3',car:'demo-02',date:'2026-11-08',start:'08:05',end:'08:32',distance:7.4,max:48,avg:22,stops:1}
 ];
 let section='overview',selected='demo-01',date='2026-11-08',search='';let map=null;
 const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;':'&quot;',"'":'&#39;'}[c]));
 const card=x=>'<button type="button" class="gps-demo-car '+(selected===x.id?'chosen':'')+'" data-gps-select="'+x.id+'"><span class="gps-demo-car-icon">🚘</span><span><strong>'+e(x.title)+'</strong><small>'+e(x.plate)+' · '+e(x.last)+'</small></span><span class="gps-demo-status '+(x.status==='Рух'?'moving':x.status==='Стоянка'?'parked':'offline')+'">'+e(x.status)+'</span></button>';
 const vehicle=()=>samples.find(x=>x.id===selected)||samples[0];
 const paths={
 'demo-01':[[31.9810,46.9800],[31.9850,46.9778],[31.9902,46.9760],[31.9946,46.9750],[32.0005,46.9718]],
 'demo-02':[[32.0020,46.9700],[32.0065,46.9680],[32.0102,46.9665]]
 };
 function drawMap(){
  const node=document.getElementById('gps-demo-real-map');if(!node||!window.maplibregl)return;
  if(map&&map.getContainer()!==node){map.remove();map=null;}
  if(!map){
   map=new maplibregl.Map({container:node,style:'https://tiles.openfreemap.org/styles/liberty',center:[31.995,46.974],zoom:12,attributionControl:true});
   map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
   map.on('load',()=>updateMap());
  }else updateMap();
  setTimeout(()=>map?.resize(),100);
 }
 function updateMap(){
  if(!map||!map.isStyleLoaded())return;
  Object.entries(paths).forEach(([id,coords])=>{
   const source='gps-demo-path-'+id,layer='gps-demo-line-'+id;
   if(!map.getSource(source))map.addSource(source,{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{}}});
   if(!map.getLayer(layer))map.addLayer({id:layer,type:'line',source,paint:{'line-color':id===selected?'#00a989':'#778b9c','line-width':id===selected?5:3,'line-opacity':id===selected?1:.55}});
   else map.setPaintProperty(layer,'line-color',id===selected?'#00a989':'#778b9c');
  });
  for(const x of samples.filter(x=>x.lon!==null)){
   const id='gps-demo-point-'+x.id;
   if(!map.getSource(id))map.addSource(id,{type:'geojson',data:{type:'Feature',geometry:{type:'Point',coordinates:[x.lon,x.lat]},properties:{title:x.title,plate:x.plate}}});
   if(!map.getLayer(id))map.addLayer({id,type:'circle',source:id,paint:{'circle-radius':x.id===selected?10:7,'circle-color':x.id===selected?'#008c77':'#50667c','circle-stroke-width':3,'circle-stroke-color':'#fff'}});
   else map.setPaintProperty(id,'circle-radius',x.id===selected?10:7);
  }
  const x=vehicle();if(x.lon!==null)map.easeTo({center:[x.lon,x.lat],zoom:13,duration:450});
 }
 const stats=()=>'<div class="gps-demo-stats"><div><small>Пристроїв</small><strong>3</strong></div><div><small>У русі</small><strong>1</strong></div><div><small>На стоянці</small><strong>1</strong></div><div><small>Без зв’язку</small><strong>1</strong></div></div>';
 const detail=()=>{const x=vehicle();return '<div class="gps-demo-detail"><div class="gps-demo-detail-head"><div><h4>'+e(x.title)+'</h4><span class="small">'+e(x.plate)+' · демонстраційні дані</span></div><span class="gps-demo-status '+(x.status==='Рух'?'moving':x.status==='Стоянка'?'parked':'offline')+'">'+e(x.status)+'</span></div><div class="gps-demo-metrics"><div><small>Швидкість</small><strong>'+(x.speed===null?'—':x.speed+' км/год')+'</strong></div><div><small>Напруга</small><strong>'+(x.battery===null?'—':x.battery+' В')+'</strong></div><div><small>Пробіг</small><strong>'+x.km.toLocaleString('uk-UA')+' км</strong></div><div><small>Останній сигнал</small><strong>'+e(x.last)+'</strong></div></div></div>'};
 const routeRows=()=>{const filtered=routes.filter(x=>x.car===selected&&(!date||x.date===date));return filtered.length?filtered.map(x=>'<div class="gps-demo-trip"><div><b>'+e(x.date)+' · '+e(x.start)+'–'+e(x.end)+'</b><small>'+x.stops+' зупинки · архів GPS у майбутньому</small></div><div><strong>'+x.distance+' км</strong><small>макс. '+x.max+' · серед. '+x.avg+' км/год</small></div></div>').join(''):'<div class="gps-demo-empty">Для цього авто й дати немає тестових поїздок. Оберіть 07 або 08.11.2026.</div>'};
 function render(){if(section==='overview')setTimeout(drawMap,0);return '<section class="card gps-demo-shell" id="gps-demo-shell"><div class="gps-demo-heading"><div><span class="gps-demo-kicker">NIKCAR GPS · ПРОТОТИП</span><h2>Моніторинг автопарку</h2><p class="small">Інтерактивний тестовий інтерфейс. Усі авто, швидкості та поїздки вигадані. Жодного зв’язку з реальними трекерами.</p></div><span class="gps-demo-label">ДЕМО · НЕ LIVE</span></div>'+stats()+'<div class="gps-demo-tabs" role="group" aria-label="Розділи GPS"><button type="button" data-gps-tab="overview" class="'+(section==='overview'?'active':'')+'">Огляд</button><button type="button" data-gps-tab="trips" class="'+(section==='trips'?'active':'')+'">Історія поїздок</button><button type="button" data-gps-tab="alerts" class="'+(section==='alerts'?'active':'')+'">Події</button><button type="button" data-gps-tab="settings" class="'+(section==='settings'?'active':'')+'">Налаштування</button></div><div class="gps-demo-layout"><aside class="gps-demo-list"><label class="field">Знайти авто<input id="gps-demo-search" type="search" placeholder="Назва або номер" value="'+e(search)+'"></label><div id="gps-demo-vehicles">'+samples.filter(x=>(x.title+' '+x.plate).toLowerCase().includes(search.toLowerCase())).map(card).join('')+'</div></aside><div class="gps-demo-main">'+(section==='overview'?'<div class="gps-demo-map gps-demo-maplibre" id="gps-demo-real-map" aria-label="Інтерактивна OpenFreeMap карта з вигаданими маршрутами"><span class="gps-demo-map-caption">ТЕСТОВІ МАРШРУТИ · НЕ GPS</span></div>'+detail():section==='trips'?'<div class="gps-demo-detail"><div class="gps-demo-detail-head"><h4>Історія поїздок</h4><label>Дата <input type="date" id="gps-demo-date" value="'+e(date)+'"></label></div>'+routeRows()+'<div class="gps-demo-hint">Після підключення Teltonika: маршрут на карті, швидкість у точці, зупинки, вибір часу та архів 365 днів.</div></div>':section==='alerts'?'<div class="gps-demo-detail"><h4>Журнал подій · приклад</h4><div class="gps-demo-trip"><div><b>10:42 · Початок руху</b><small>Тестове авто №1</small></div><span class="gps-demo-status moving">Демо</span></div><div class="gps-demo-trip"><div><b>10:39 · Стоянка</b><small>Тестове авто №2</small></div><span class="gps-demo-status parked">Демо</span></div><div class="gps-demo-trip"><div><b>Учора · Втрата сигналу</b><small>Тестове авто №3</small></div><span class="gps-demo-status offline">Демо</span></div><div class="gps-demo-hint">Майбутні сповіщення: перевищення швидкості, відсутність зв’язку, вихід із геозони, наближення ТО.</div></div>':'<div class="gps-demo-detail"><h4>Налаштування моніторингу</h4><div class="gps-demo-trip"><div><b>Архів координат</b><small>План зберігання</small></div><strong>365 днів</strong></div><div class="gps-demo-trip"><div><b>Трекери</b><small>Teltonika FMB920 · приймач ще не підключений</small></div><span class="gps-demo-status offline">Очікується</span></div><div class="gps-demo-trip"><div><b>Режим тестування</b><small>Ізольований від реальних автомобілів</small></div><span class="gps-demo-status parked">Увімкнено</span></div><div class="gps-demo-hint">Реальні IMEI та SIM реєструються в розділі «Моя техніка» нижче.</div></div>')+'</div></div></section>'}
 function mount(){if(map){map.remove();map=null;}const shell=document.getElementById('gps-demo-shell');if(shell){const active=document.activeElement;const focusSearch=active?.id==='gps-demo-search';const pos=focusSearch?active.selectionStart:0;shell.outerHTML=render();if(focusSearch){const field=document.getElementById('gps-demo-search');field?.focus();field?.setSelectionRange(pos,pos)}}}
 document.addEventListener('click',ev=>{const tab=ev.target.closest('[data-gps-tab]');const car=ev.target.closest('[data-gps-select]');if(tab){section=tab.dataset.gpsTab;mount()}else if(car){selected=car.dataset.gpsSelect;mount()}});
 document.addEventListener('input',ev=>{if(ev.target.id==='gps-demo-search'){search=ev.target.value;const el=document.getElementById('gps-demo-vehicles');if(el)el.innerHTML=samples.filter(x=>(x.title+' '+x.plate).toLowerCase().includes(search.toLowerCase())).map(card).join('')||'<p class="small">Нічого не знайдено.</p>'}});
 document.addEventListener('change',ev=>{if(ev.target.id==='gps-demo-date'){date=ev.target.value;mount()}});
 window.NikCarGpsDemo={render};
})();