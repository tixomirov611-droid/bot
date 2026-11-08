// Authenticated LIVE storage test. Requires a dedicated non-production test driver.
 // Environment: NIKCAR_SUPABASE_URL, NIKCAR_PUBLISHABLE_KEY, NIKCAR_TEST_EMAIL, NIKCAR_TEST_PASSWORD.
 // Run: node nikcar-pilot/tests/live-storage-smoke.mjs
 // Uses only native Node 20+ fetch, no service-role credentials.
const required=['NIKCAR_SUPABASE_URL','NIKCAR_PUBLISHABLE_KEY','NIKCAR_TEST_EMAIL','NIKCAR_TEST_PASSWORD'];
for(const k of required)if(!process.env[k])throw Error('Missing '+k);
const url=process.env.NIKCAR_SUPABASE_URL.replace(/\\/$/,'');
const key=process.env.NIKCAR_PUBLISHABLE_KEY;
const login=await fetch(url+'/auth/v1/token?grant_type=password',{
 method:'POST',headers:{apikey:key,'Content-Type':'application/json'},
 body:JSON.stringify({email:process.env.NIKCAR_TEST_EMAIL,password:process.env.NIKCAR_TEST_PASSWORD})
});
const auth=await login.json();
if(!login.ok||!auth.access_token||!auth.user?.id)throw Error('Test driver login failed: '+login.status);
if(auth.user.is_anonymous)throw Error('Anonymous account not allowed');
const headers={apikey:key,Authorization:'Bearer '+auth.access_token};
const profileResponse=await fetch(url+'/rest/v1/profiles?select=id,role,access&user_id=eq.'+encodeURIComponent(auth.user.id),{headers});
const profiles=await profileResponse.json();
if(!profileResponse.ok||!Array.isArray(profiles)||profiles.length!==1||profiles[0].role!=='driver'||!['candidate','active'].includes(profiles[0].access))throw Error('Account must be a dedicated test driver');
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SAAAAABJRU5ErkJggg==','base64');
const path=auth.user.id+'/passport_1/nikcar-fictional-smoke-'+crypto.randomUUID()+'.png';
const endpoint=url+'/storage/v1/object/nikcar-driver-docs/'+path;
let uploaded=false;
try{
 const upload=await fetch(endpoint,{method:'POST',headers:{...headers,'Content-Type':'image/png','x-upsert':'false'},body:bytes});
 if(!upload.ok)throw Error('Upload failed: '+upload.status+' '+(await upload.text()).slice(0,200));
 uploaded=true;
 const sign=await fetch(url+'/storage/v1/object/sign/nikcar-driver-docs/'+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
 if(!sign.ok)throw Error('Signed URL failed: '+sign.status+' '+(await sign.text()).slice(0,200));
 const signed=await sign.json();
 if(!signed.signedURL&&!signed.signedUrl)throw Error('No signed URL returned');
 console.log('PASS: authenticated upload + signed URL for fictional 1x1 PNG');
}finally{
 if(uploaded){
  const remove=await fetch(url+'/storage/v1/object/nikcar-driver-docs',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});
  if(!remove.ok)throw Error('TEST FILE CLEANUP FAILED: '+path+' '+remove.status);
  console.log('PASS: temporary test photo removed');
 }
}
