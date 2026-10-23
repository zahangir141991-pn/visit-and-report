import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const between=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
test('login exchanges server token for matching Firebase identity with memory-only persistence',async()=>{
 const calls=[];const auth={setPersistence:async v=>calls.push(v),signInWithCustomToken:async token=>{calls.push(token);return {user:{uid:'dms_admin'}}},signOut:async()=>calls.push('signOut')};
 const firebase={auth:Object.assign(()=>auth,{Auth:{Persistence:{NONE:'NONE'}}})};
 const context=vm.createContext({firebase,dmsSignOutPromise:Promise.resolve(),authServerRequest:async(path,input)=>{calls.push([path,input]);return {userId:'admin',token:'signed-token'}},ensureFirebaseSdk:async()=>{}});
 vm.runInContext(between('async function signInDmsServer(', 'async function authenticatedDatabaseUrl('),context);
 const result=await context.signInDmsServer('admin','test-password');assert.equal(result.userId,'admin');assert.equal(calls[1],'NONE');assert.equal(calls[2],'signed-token');
 auth.signInWithCustomToken=async()=>({user:{uid:'dms_other'}});await assert.rejects(context.signInDmsServer('admin','test-password'),/identity/);assert.ok(calls.includes('signOut'));
});
test('database URLs require matching authenticated user and reject logout during token refresh',async()=>{
 let resolveToken;const auth={currentUser:{uid:'dms_admin',getIdToken:async()=>'id-token'}};
 const context=vm.createContext({URL,Error,currentUser:'admin',appSessionGeneration:1,firebaseConfig:{databaseURL:'https://visit-report-ea224-default-rtdb.firebaseio.com'},firebase:{auth:()=>auth}});context.window=context;
 vm.runInContext(between('async function authenticatedDatabaseUrl(', 'async function hashPassword('),context);
 const url='https://visit-report-ea224-default-rtdb.firebaseio.com/visit_reports.json?orderBy=%22date%22';
 const result=new URL(await context.authenticatedDatabaseUrl(url,'visit_reports'));assert.equal(result.searchParams.get('auth'),'id-token');assert.equal(result.searchParams.get('orderBy'),'"date"');
 auth.currentUser.uid='dms_other';await assert.rejects(context.authenticatedDatabaseUrl(url,'visit_reports'),/sign in/);auth.currentUser.uid='dms_admin';
 await assert.rejects(context.authenticatedDatabaseUrl('https://evil.example/data.json','visit_reports'),/Unexpected/);
 auth.currentUser.getIdToken=()=>new Promise(resolve=>{resolveToken=resolve});const pending=context.authenticatedDatabaseUrl(url,'visit_reports');context.currentUser=null;context.appSessionGeneration++;resolveToken('old-token');await assert.rejects(pending,/session changed/);
 const release=await context.authenticatedDatabaseUrl('https://visit-report-ea224-default-rtdb.firebaseio.com/dms_app_release.json','dms_app_release');assert.ok(!new URL(release).searchParams.has('auth'));
 await assert.rejects(context.authenticatedDatabaseUrl(url,'visit_reports'),/sign in/);
});
test('private subscriptions from previous login cannot repopulate next session',()=>{
 function Query(){}const attached=[];Query.prototype.on=function(event,callback){attached.push(callback);return callback};
 const context=vm.createContext({firebase:{database:{Query}},currentUser:'admin',appSessionGeneration:1,activeFirebaseSubscriptions:new Set()});
 vm.runInContext(between('function installFirebaseSubscriptionTracking(){','function stopPrivateFirebaseSubscriptions(){'),context);context.installFirebaseSubscriptionTracking();
 let hits=0;new Query().on('value',()=>hits++);attached[0]();assert.equal(hits,1);context.appSessionGeneration++;context.currentUser='01332517801';attached[0]();assert.equal(hits,1);
});
test('every REST transport obtains an auth URL and credential records are never fetched by the client',()=>{
 for(const [a,b] of [['async function fetchFirebaseRestFresh(', 'async function firebaseValueOnce('],['async function visitRestRequest(', 'const visitAttemptsInMemory'],['async function firebaseRestWrite(', 'const resolvedChunkReports']])assert.match(between(a,b),/await authenticatedDatabaseUrl/);
 assert.ok(!source.includes('readCloudAuth('));assert.match(source,/authServerRequest\('\/password'/);assert.match(source,/stopPrivateFirebaseSubscriptions\(\);clearPrivateSessionData/);
});
