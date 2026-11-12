import test from 'node:test';
import assert from 'node:assert/strict';
import {secureData,securityScope} from '../server/security-data.mjs';
import {loginClaims} from '../server/dms-login-worker.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
const fixtures={uddokta_master:{a:{dsoWallet:'801',uddoktaNumber:'01700000001'},b:{dsoWallet:'802',uddoktaNumber:'01700000002'}},dss_dso_assignments_common:{a:{dso:'801',dss:'RUBEL'},b:{dso:'802',dss:'MD. ALAMIN'}},new_uddokta_kyc:{a:{dsoWallet:'801',submittedBy:'01332517801'},b:{dsoWallet:'802',submittedBy:'01332517802'}},new_uddokta_kyc_photos:{a:'photo-a',b:'photo-b'},morning_report_current:{headers:['DSO','AGENT'],chunked:true,chunkRoot:'morning_report_chunks/upload1',chunkCount:1},morning_report_chunks:{upload1:{chunk_0:[['801','private-a'],['802','private-b']]}}};
const reads=[];const read=async path=>{reads.push(path);return path.split('/').reduce((v,p)=>v?.[p],fixtures)??null;};
test('DSO receives only own master, KYC and chunked report rows',async()=>{
 assert.deepEqual(Object.keys(await secureData({path:'uddokta_master'},'01332517801',read)),['a']);
 assert.deepEqual(Object.keys(await secureData({path:'new_uddokta_kyc'},'01332517802',read)),['b']);
 const r=await secureData({path:'morning_report_current'},'01332517801',read);assert.deepEqual(r.rows,[['801','private-a']]);assert.equal(r.chunked,false);assert.equal(r.chunkRoot,undefined);
});
test('DSS gets assigned KYC but no agent master or transaction report',async()=>{
 reads.length=0;assert.deepEqual(await secureData({path:'uddokta_master'},'rubel',read),{});assert(!reads.includes('uddokta_master'));
 assert.deepEqual((await secureData({path:'morning_report_current'},'rubel',read)).rows,[]);
 assert.deepEqual(Object.keys(await secureData({path:'new_uddokta_kyc'},'rubel',read)),['a']);
});
test('foreign nested records/photos denied and caller scope cannot be overridden',async()=>{
 assert.equal(await secureData({path:'new_uddokta_kyc/b',role:'Admin',userId:'admin'},'01332517801',read),null);
 reads.length=0;await assert.rejects(()=>secureData({path:'new_uddokta_kyc_photos/b'},'01332517801',read),/permission/);assert(!reads.includes('new_uddokta_kyc_photos/b'));
 assert.equal(await secureData({path:'new_uddokta_kyc_photos/a'},'01332517801',read),'photo-a');
});
test('credentials, arbitrary server paths, chunk roots and traversal are denied',async()=>{
 for(const path of ['user_auth','attendance_server','morning_report_chunks/upload1','../user_auth','new_uddokta_kyc/a/../../user_auth'])await assert.rejects(()=>secureData({path},'admin',read),/permission/);
});
test('ambiguous/substring DSS assignments grant nothing',()=>{
 assert.equal(securityScope('rubel',{a:{dso:'801',dss:'RUBEL'},b:{dso:'801',dss:'MD. ALAMIN'}}).wallets.size,0);
 assert.equal(securityScope('rubel',{a:{dso:'801',dss:'RUBEL EXTRA'}}).wallets.size,0);
});
test('claims carry server-owned scopes, never browser-provided role',()=>{
 const c=loginClaims('01332517846',{});assert.equal(c.dmsRole,'DSO');assert.deepEqual(c.dmsWallets,{'846':true});assert.equal(c.attendanceAdmin,false);
 assert.deepEqual(loginClaims('rubel',{dmsAssignments:fixtures.dss_dso_assignments_common}).dmsWallets,{'801':true});
});
test('read adapter query filters and unsubscribe suppress late responses',async()=>{
 const c=vm.createContext({setTimeout,clearTimeout});vm.runInContext(fs.readFileSync(new URL('../assets/secure-data.js',import.meta.url),'utf8'),c);
 const api=c.DmsSecureData;assert.deepEqual(Object.keys(api.select({a:{date:'x'},b:{date:'y'}},{order:'date',equal:'x'})),['a']);
 let resolve,calls=0;const native={ref:()=>({toString:()=>'',set(){},update(){},push(){},transaction(){},onDisconnect(){}})};
 const db=api.database(native,()=>new Promise(r=>resolve=r));const ref=db.ref('new_uddokta_kyc');ref.on('value',()=>calls++);db.stopScopedReads();resolve({a:{}});await new Promise(r=>setTimeout(r,0));assert.equal(calls,0);
});
