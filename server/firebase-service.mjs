// Cloudflare module Worker. Secrets belong in Cloudflare Settings, never in this file.
const encoder=new TextEncoder();let credentialCache=null,oauthCache=null;
const b64=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const part=v=>b64(encoder.encode(JSON.stringify(v)));
function serviceAccount(env){
 if(credentialCache?.raw===env.FIREBASE_SERVICE_ACCOUNT)return credentialCache;
 let value=String(env.FIREBASE_SERVICE_ACCOUNT||'').replace(/^\uFEFF/,'').trim();
 try{value=JSON.parse(value);if(typeof value==='string')value=JSON.parse(value)}catch{throw new Error('SERVICE_ACCOUNT_INVALID_JSON')}
 const expected=env.FIREBASE_PROJECT_ID||'visit-report-ea224';
 if(!value||value.type!=='service_account'||value.project_id!==expected||typeof value.client_email!=='string'||!value.client_email.endsWith('.iam.gserviceaccount.com')||typeof value.private_key!=='string')throw new Error('SERVICE_ACCOUNT_WRONG_PROJECT_OR_FIELDS');
 const pem=value.private_key.replace(/\\n/g,'\n');if(!pem.includes('-----BEGIN PRIVATE KEY-----')||!pem.includes('-----END PRIVATE KEY-----'))throw new Error('SERVICE_ACCOUNT_PRIVATE_KEY_INVALID');
 const der=Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0));
 const key=crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 credentialCache={raw:env.FIREBASE_SERVICE_ACCOUNT,account:value,key};oauthCache=null;return credentialCache;
}
function databaseUrl(env){const raw=String(env.FIREBASE_DATABASE_URL||'https://visit-report-ea224-default-rtdb.firebaseio.com').replace(/\/$/,'');let u;try{u=new URL(raw)}catch{throw Error('DATABASE_URL_REQUIRED')}
 if(u.protocol!=='https:'||!/(\.firebaseio\.com|\.firebasedatabase\.app)$/.test(u.hostname)||u.pathname!=='/'||u.search||u.hash)throw Error('DATABASE_URL_INVALID');return u.origin;
}
function origins(env){return [...new Set(['https://zahangir141991-pn.github.io',...String(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim().replace(/\/$/,'')).filter(Boolean)])]}
async function signedJwt(env,payload){const c=serviceAccount(env);const body=part({alg:'RS256',typ:'JWT'})+'.'+part(payload);const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',await c.key,encoder.encode(body));return body+'.'+b64(signature)}
async function request(url,opts={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{return await fetch(url,{...opts,signal:controller.signal})}finally{clearTimeout(timer)}}
async function accessToken(env){const c=serviceAccount(env);if(oauthCache?.expires>Date.now()+60000)return oauthCache.token;const now=Math.floor(Date.now()/1000);const assertion=await signedJwt(env,{iss:c.account.client_email,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});const r=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});if(!r.ok)throw Error('GOOGLE_SERVICE_ACCOUNT_AUTH_FAILED');const data=await r.json();if(!data.access_token)throw Error('GOOGLE_SERVICE_ACCOUNT_AUTH_FAILED');oauthCache={token:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000};return data.access_token}
async function firebase(env,path,opts={}){const token=await accessToken(env);return request(databaseUrl(env)+'/'+path+'.json',{...opts,headers:{Authorization:'Bearer '+token,...opts.headers}})}

export { firebase, accessToken, databaseUrl, serviceAccount, request };
