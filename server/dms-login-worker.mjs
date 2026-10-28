// Cloudflare module Worker. Secrets belong in Cloudflare Settings, never in this file.
const encoder=new TextEncoder();let credentialCache=null,oauthCache=null;
const b64=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const part=v=>b64(encoder.encode(JSON.stringify(v)));
function serviceAccount(env){
 if(credentialCache?.raw===env.FIREBASE_SERVICE_ACCOUNT)return credentialCache;
 let value=String(env.FIREBASE_SERVICE_ACCOUNT||'').replace(/^\uFEFF/,'').trim();
 try{value=JSON.parse(value);if(typeof value==='string')value=JSON.parse(value)}catch{throw new Error('SERVICE_ACCOUNT_INVALID_JSON')}
 const expected='visit-report-ea224';
 if(!value||value.type!=='service_account'||value.project_id!==expected||typeof value.client_email!=='string'||!value.client_email.endsWith('.iam.gserviceaccount.com')||typeof value.private_key!=='string')throw new Error('SERVICE_ACCOUNT_WRONG_PROJECT_OR_FIELDS');
 const pem=value.private_key.replace(/\\n/g,'\n');if(!pem.includes('-----BEGIN PRIVATE KEY-----')||!pem.includes('-----END PRIVATE KEY-----'))throw new Error('SERVICE_ACCOUNT_PRIVATE_KEY_INVALID');
 const der=Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0));
 const key=crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 credentialCache={raw:env.FIREBASE_SERVICE_ACCOUNT,account:value,key};oauthCache=null;return credentialCache;
}
function databaseUrl(env){const raw=String(env.FIREBASE_DATABASE_URL||'https://visit-report-ea224-default-rtdb.firebaseio.com').replace(/\/$/,'');let u;try{u=new URL(raw)}catch{throw Error('DATABASE_URL_REQUIRED')}
 if(u.origin!=='https://visit-report-ea224-default-rtdb.firebaseio.com'||u.pathname!=='/'||u.search||u.hash)throw Error('DATABASE_URL_INVALID');return u.origin;
}
function origins(env){return [...new Set(['https://zahangir141991-pn.github.io',...String(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim().replace(/\/$/,'')).filter(Boolean)])]}
async function signedJwt(env,payload){const c=serviceAccount(env);const body=part({alg:'RS256',typ:'JWT'})+'.'+part(payload);const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',await c.key,encoder.encode(body));return body+'.'+b64(signature)}
async function request(url,opts={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{return await fetch(url,{...opts,signal:controller.signal})}finally{clearTimeout(timer)}}
async function accessToken(env){const c=serviceAccount(env);if(oauthCache?.expires>Date.now()+60000)return oauthCache.token;const now=Math.floor(Date.now()/1000);const assertion=await signedJwt(env,{iss:c.account.client_email,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});const r=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});if(!r.ok)throw Error('GOOGLE_SERVICE_ACCOUNT_AUTH_FAILED');const data=await r.json();if(!data.access_token)throw Error('GOOGLE_SERVICE_ACCOUNT_AUTH_FAILED');oauthCache={token:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000};return data.access_token}
async function firebase(env,path,opts={}){const token=await accessToken(env);return request(databaseUrl(env)+'/'+path+'.json',{...opts,headers:{Authorization:'Bearer '+token,...opts.headers}})}
async function readAccount(env,user){const r=await firebase(env,'user_auth/'+user);if(!r.ok)throw Error('FIREBASE_ACCESS_DENIED');return r.json()}
async function rateLimit(env,ip,user,max=10){const hash=b64(await crypto.subtle.digest('SHA-256',encoder.encode(ip+'|'+user)));const path='attendance_server/limits/'+hash;for(let attempt=0;attempt<3;attempt++){const r=await firebase(env,path,{headers:{'X-Firebase-ETag':'true'}});if(!r.ok)throw Error('FIREBASE_ACCESS_DENIED');const old=await r.json();const now=Date.now();const next=!old||now-Number(old.at)>60000?{at:now,count:1}:{at:old.at,count:Number(old.count||0)+1};if(next.count>max)return false;const etag=r.headers.get('etag');if(!etag)throw Error('RATE_LIMIT_UNAVAILABLE');const put=await firebase(env,path,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(next)});if(put.ok)return true;if(put.status!==412)throw Error('RATE_LIMIT_UNAVAILABLE')}return false}
async function digest(v){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(v)))}
function equalHash(bytes,hex){if(typeof hex!=='string'||hex.length!==bytes.length*2||!/^[a-f0-9]+$/.test(hex))return false;let difference=0;for(let i=0;i<bytes.length;i++)difference|=bytes[i]^parseInt(hex.slice(i*2,i*2+2),16);return difference===0}
function json(v,status=200,origin=''){return Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})}})}
const errors={SERVICE_ACCOUNT_INVALID_JSON:'Cloudflare Secret-এ সম্পূর্ণ service-account JSON বসান।',SERVICE_ACCOUNT_WRONG_PROJECT_OR_FIELDS:'Service-account-এর project বা fields সঠিক নয়।',SERVICE_ACCOUNT_PRIVATE_KEY_INVALID:'Service-account private key সঠিক নয়।',DATABASE_URL_REQUIRED:'FIREBASE_DATABASE_URL বসানো হয়নি।',DATABASE_URL_INVALID:'Firebase Realtime Database URL সঠিক নয়।',GOOGLE_SERVICE_ACCOUNT_AUTH_FAILED:'Google service-account যাচাই হয়নি। Key ও permission পরীক্ষা করুন।',FIREBASE_ACCESS_DENIED:'Service-account দিয়ে Firebase-এ প্রবেশ করা যাচ্ছে না।',RATE_LIMIT_UNAVAILABLE:'লগইন যাচাই আপাতত পাওয়া যাচ্ছে না।'};

// v116: staged rollout. Existing Attendance /token behavior is retained.
// Deploy this Worker BEFORE enabling Firebase-authenticated DMS clients/rules.
export function normalizeUser(value){
 const id=String(value||'').trim().toLowerCase();
 const numeric=Number(id);
 if(/^\d{3}$/.test(id)&&numeric>=801&&numeric<=845)return '01332517'+id;
 return id;
}
export function approvedUser(id){return ['admin','zahangir','alamin','sohag','imran','rubel','shofiq'].includes(id)||/^013325178(?:0[1-9]|[1-3]\d|4[0-5])$/.test(id)}
export async function passwordMatches(account,id,password){
 if(!account||account.enabled===false||account.disabled===true)return false;
 if(account.passwordAlgorithm==='pbkdf2-sha256'){
  const iterations=Number(account.passwordIterations),salt=String(account.passwordSalt||'');
  if(iterations!==100000||!/^[a-f0-9]{32}$/.test(salt))return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bytes=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations,salt:encoder.encode('dms-v2|'+id+'|'+salt)},key,256));
  return equalHash(bytes,String(account.passwordHash||''));
 }
 // Unknown algorithms never fall back to a weaker verifier.
 if(account.passwordAlgorithm&&account.passwordAlgorithm!=='sha256')return false;
 return equalHash(await digest('dms-v1|'+id+'|'+password),String(account.passwordHash||''));
}
export async function newPasswordRecord(id,password){
 const salt=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bytes=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:encoder.encode('dms-v2|'+id+'|'+salt)},key,256));
 return {passwordHash:Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join(''),passwordAlgorithm:'pbkdf2-sha256',passwordIterations:100000,passwordSalt:salt,forceChange:false,updatedAt:Date.now(),updatedBy:id};
}
export function loginClaims(id,account,attendanceOnly=false){
 const mustChange=account.forceChange===true;
 return {dmsUserId:id,attendanceAdmin:['admin','zahangir'].includes(id)&&!mustChange,
  ...(attendanceOnly?{}:{dmsAuthenticated:true,dmsPasswordChangeRequired:mustChange})};
}
async function readInput(req){
 if(Number(req.headers.get('Content-Length')||0)>4096)throw Object.assign(Error('Request too large'),{status:413});
 const reader=req.body?.getReader();if(!reader)throw Object.assign(Error('Request required'),{status:400});
 const chunks=[];let length=0;
 while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();throw Object.assign(Error('Request too large'),{status:413})}chunks.push(value)}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 let input;try{input=JSON.parse(new TextDecoder().decode(bytes))}catch{throw Object.assign(Error('Invalid JSON'),{status:400})}
 if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(Error('Invalid JSON'),{status:400});return input;
}
async function issueToken(env,id,account,attendanceOnly){
 const now=Math.floor(Date.now()/1000),c=serviceAccount(env);
 return signedJwt(env,{iss:c.account.client_email,sub:c.account.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid:'dms_'+id,claims:loginClaims(id,account,attendanceOnly)});
}
// Read-only monthly access: verify Firebase session before selecting server-owned scope.
const performanceDssUsers={sohag:'MOHOSIN HOSSAIN SOHAG',alamin:'MD. ALAMIN',imran:'MD. IMRAN HOSSAIN',rubel:'RUBEL',shofiq:'MD. SHOFIQ'};
export function performanceWallet(value){const n=String(value||'').replace(/\D/g,'');if(/^8(?:0[1-9]|[1-3]\d|4[0-5])$/.test(n))return n;if(/^0?13325178(?:0[1-9]|[1-3]\d|4[0-5])$/.test(n))return String(800+Number(n.slice(-2)));return '';}
function performanceDss(value){const n=String(value||'').trim().toUpperCase().replace(/\s+/g,' ');return ({SOHAG:performanceDssUsers.sohag,ALAMIN:performanceDssUsers.alamin,IMRAN:performanceDssUsers.imran,RUBEL:performanceDssUsers.rubel,SHOFIQ:performanceDssUsers.shofiq})[n]||n;}
export function scopedPerformance(id,reports,master){
 const all=['admin','zahangir'].includes(id),own=/^013325178(?:0[1-9]|[1-3]\d|4[0-5])$/.test(id)?performanceWallet(id):'',dss=performanceDssUsers[id];
 if(!all&&!own&&!dss)throw Object.assign(Error('Report permission required'),{status:403});
 const sets=new Map();for(const row of Object.values(master||{})){const wallet=performanceWallet(row?.dsoWallet),name=performanceDss(row?.dssName);if(!wallet||!name)continue;if(!sets.has(wallet))sets.set(wallet,new Set());sets.get(wallet).add(name);}
 const names=Object.fromEntries([...sets].map(([wallet,names])=>[wallet,names.size===1?[...names][0]:'Multiple DSS — check Uddokta Information']));
 const allowed=all?new Set(Object.keys(names)):own?new Set([own]):new Set([...sets].filter(([,names])=>names.size===1&&names.has(dss)).map(([wallet])=>wallet));
 const months={},visible=new Set();for(const [month,report]of Object.entries(reports||{})){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!report)continue;const groups={};for(const row of Object.values(report.groups||{})){const wallet=performanceWallet(row?.dso);if(wallet&&(all||allowed.has(wallet))){groups[wallet]={...row,dso:wallet};visible.add(wallet);}}months[month]={groups,asOf:report.asOf||'',uploadedAt:report.uploadedAt||0};}
 return {months,dssNames:Object.fromEntries([...visible].map(wallet=>[wallet,names[wallet]||'Unassigned'])),allowedDsos:[...allowed]};
}
async function performanceSession(env,input){
 const token=input.idToken;if(typeof token!=='string'||token.length>3500)throw Object.assign(Error('Sign in again'),{status:401});
 const response=await request('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyDxJ1ntoGQa6QYddVJ14p4T7MkAWHo2hVE',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});
 if(!response.ok)throw Object.assign(Error('Sign in again'),{status:401});const user=(await response.json()).users?.[0];
 let claims;try{const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');claims=JSON.parse(atob(part.padEnd(Math.ceil(part.length/4)*4,'=')))}catch{throw Object.assign(Error('Invalid session'),{status:401})}
 const id=claims.dmsUserId;
 if(!user||user.disabled===true||!approvedUser(id)||claims.aud!=='visit-report-ea224'||claims.iss!=='https://securetoken.google.com/visit-report-ea224'||claims.sub!=='dms_'+id||user.localId!==claims.sub||claims.dmsAuthenticated!==true||claims.dmsPasswordChangeRequired!==false||claims.exp<=Date.now()/1000)throw Object.assign(Error('Report permission required'),{status:403});
 const account=await readAccount(env,id);if(!account||account.enabled===false||account.disabled===true||account.forceChange===true)throw Object.assign(Error('Sign in again'),{status:403});return id;
}
async function performanceReport(env,input){const id=await performanceSession(env,input);if(!['admin','zahangir',...Object.keys(performanceDssUsers)].includes(id)&&!/^013325178(?:0[1-9]|[1-3]\d|4[0-5])$/.test(id))throw Object.assign(Error('Report permission required'),{status:403});const [r,m]=await Promise.all([firebase(env,'monthly_performance'),firebase(env,'uddokta_master')]);if(!r.ok||!m.ok)throw Error('FIREBASE_ACCESS_DENIED');return scopedPerformance(id,await r.json(),await m.json());}
export default {async fetch(req,env){
 const u=new URL(req.url),origin=req.headers.get('Origin')||'';
 if(req.method==='GET'&&['/','/health'].includes(u.pathname)){
  try{serviceAccount(env);databaseUrl(env);await credentialCache.key;
   return json({ok:true,service:'DMS Secure Login',version:'135',configured:true,capabilities:['attendance-token','dms-login','password-change'],note:'Configuration validated only; authenticated login and database rules must be tested separately.'});
  }catch(e){return json({ok:false,configured:false,error:errors[e.message]||'Login server configuration error'},503)}
 }
 if(!['/','/token','/login','/password','/admin/password','/performance'].includes(u.pathname))return json({error:'Not found'},404);
 if(!origin||!origins(env).includes(origin))return json({error:'Website is not permitted'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type',Vary:'Origin','Access-Control-Max-Age':'600'}});
 if(req.method!=='POST')return json({error:'POST required'},405,origin);
 if(!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return json({error:'JSON required'},415,origin);
 try{
  const input=await readInput(req);
  if(u.pathname==='/performance')return json(await performanceReport(env,input),200,origin);
  const id=normalizeUser(input.userId),password=input.password;
  const attendanceOnly=['/','/token'].includes(u.pathname);
  if(!approvedUser(id)||typeof password!=='string'||!password||password.length>256||(attendanceOnly&&(!['admin','zahangir'].includes(id)||password==='1234')))
   return json({error:'Invalid User ID or Password'},401,origin);
  // Cross-account attempts from the same IP share a separate budget.
  const ip=req.headers.get('CF-Connecting-IP')||'unknown';
  if(!await rateLimit(env,ip,'all-login',100)||!await rateLimit(env,ip,id))return json({error:'Too many attempts. Please wait one minute.'},429,origin);
  const account=await readAccount(env,id);
  if(!await passwordMatches(account,id,password)||(attendanceOnly&&account.forceChange===true))return json({error:'Invalid User ID or Password'},401,origin);
  if(u.pathname==='/admin/password'){
   if(id!=='admin'||account.forceChange===true||password==='1234')return json({error:'Admin permission required'},403,origin);
   const target=normalizeUser(input.targetUser),next=input.newPassword,reset=input.forceChange===true;
   if(!approvedUser(target)||typeof next!=='string'||next.length>256||(!reset&&next.length<8)||(reset&&next!=='1234'))return json({error:'Select a valid user and use at least 8 characters, or reset to 1234'},400,origin);
   const response=await firebase(env,'user_auth/'+target,{headers:{'X-Firebase-ETag':'true'}});
   if(!response.ok)throw Error('FIREBASE_ACCESS_DENIED');
   const latest=await response.json(),etag=response.headers.get('etag');
   if(!etag)return json({error:'Password update unavailable. Try again.'},503,origin);
   const updated={...(latest||{}),...await newPasswordRecord(target,next),forceChange:reset,updatedBy:'admin'};
   const saved=await firebase(env,'user_auth/'+target,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(updated)});
   if(saved.status===412)return json({error:'Account changed. Try again.'},409,origin);
   if(!saved.ok)throw Error('FIREBASE_ACCESS_DENIED');
   return json({ok:true,userId:target},200,origin);
  }
  if(u.pathname==='/password'){
   const next=input.newPassword;
   if(typeof next!=='string'||next.length<8||next.length>256||next===password)return json({error:'Use a different password with at least 8 characters'},400,origin);
   // ETag guards the credential read and update against concurrent password changes.
   const response=await firebase(env,'user_auth/'+id,{headers:{'X-Firebase-ETag':'true'}});
   if(!response.ok)throw Error('FIREBASE_ACCESS_DENIED');const latest=await response.json(),etag=response.headers.get('etag');
   if(!etag||!await passwordMatches(latest,id,password))return json({error:'Password changed. Sign in again.'},409,origin);
   const updated={...latest,...await newPasswordRecord(id,next)};
   const saved=await firebase(env,'user_auth/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(updated)});
   if(saved.status===412)return json({error:'Password changed. Sign in again.'},409,origin);
   if(!saved.ok)throw Error('FIREBASE_ACCESS_DENIED');
   return json({ok:true,requireLogin:true},200,origin);
  }
  const token=await issueToken(env,id,{...account,forceChange:account.forceChange===true||password==='1234'},attendanceOnly);
  return json({token,...(attendanceOnly?{}:{userId:id,forceChange:account.forceChange===true||password==='1234'})},200,origin);
 }catch(e){return json({error:e.status?e.message:errors[e.message]||'Login server temporarily unavailable'},e.status||503,origin)}
}};
