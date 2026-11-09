/* NikCar notifications worker v0.78 */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=event.notification.data?.url||self.registration.scope;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(client.url.startsWith(self.registration.scope)){await client.focus();return;}}
  await self.clients.openWindow(target);
 })());
});
self.addEventListener('push',event=>{
 let payload={title:'NikCar',body:'Нове сповіщення'};
 try{payload={...payload,...event.data.json()};}catch{if(event.data)payload.body=event.data.text();}
 event.waitUntil(self.registration.showNotification(String(payload.title).slice(0,120),{
  body:String(payload.body).slice(0,400),tag:String(payload.tag||'nikcar-alert'),
  icon:'./icon.svg',badge:'./icon.svg',data:{url:self.registration.scope}
 }));
});
