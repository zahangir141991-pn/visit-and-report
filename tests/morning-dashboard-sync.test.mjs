import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),targets=fs.readFileSync(new URL('../performance/targets.js',import.meta.url),'utf8');
const block=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function setup({rejectHistory=false,changeSession=false}={}){
 const elements=new Map(),writes=[],statuses=[],cache=[],state={active:'view-dashboard',done:0,failed:0,targetReads:0,rawReads:0,applied:0};
 function node(id){if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',disabled:false,hidden:false,children:[],classList:{contains:x=>x==='active'&&state.active===id},replaceChildren(){this.children=[];},append(...x){this.children.push(...x);},setAttribute(){}});return elements.get(id);}
 const store={morning_report_current:{uploadedAt:1,fileName:'old.xlsx'},dms_target_tracking:{'2026-11':{targets:{801:1000,802:2000},history:{'2026-11-13':{801:100,802:200}}}}};
 const put=(path,value)=>{const keys=path.split('/');let o=store;for(const key of keys.slice(0,-1))o=o[key]??={};o[keys.at(-1)]=value;};
 const resolve=value=>value&&typeof value==='object'?value['.sv']==='timestamp'?123456:Array.isArray(value)?value.map(resolve):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)])):value;
 const firebase={auth:()=>({currentUser:{uid:'dms_admin',getIdToken:async()=> 'test-token'}}),database:{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}};
 const c=vm.createContext({document:{getElementById:node,querySelector:()=>({id:state.active}),createElement:()=>node('option-'+Math.random()),createElementNS:()=>({setAttribute(){},append(){}})},console,window:{firebase},firebase,db:{},currentUser:'admin',appSessionGeneration:1,getRoleInfo:()=>({role:'Admin'}),dssDsoAssignmentIndex:new Map(),getDhakaToday:()=> '2026-11-15',morningColumnMap:()=>({dso:0,mtdTxn:1,mtdCashIn:2,mtdCashOut:3}),pendingMorningExcel:{headers:['DSO','MTD_TXN','MTD_CASH_IN','MTD_CASH_OUT'],rows:[['801',400,250,150],['802',600,400,200]],fileName:'fresh.xlsx',sheetName:'Morning'},uploadProgressTimer:null,clearInterval(){},setInterval(){},setTimeout:fn=>fn(),alert:message=>{throw Error(message);},beginUploadProgress(){},paintUploadProgress(){},completeUploadProgress(){state.done++;},failUploadProgress(){state.failed++;},setMorningStatus:(id,text,type)=>statuses.push({id,text,type}),privateDataStorage:{setItem:(...args)=>cache.push(args)},applyMorningReportData(){state.applied++;},applyLightReportSnapshot(){},updateDashboard(){},renderReports(){},applyCommonDssDsoAssignments(){},ensureReportModeData(){},visitReportMode:'my',firebaseValueOnce:async()=>({row:{date:'2026-11-15'}}),authServerRequest:async(path,input)=>{assert.equal(path,'/targets');state.targetReads++;const data=store.dms_target_tracking[input.month]||{};return structuredClone({...data,metric:input.metric});},authenticatedDatabaseUrl:async()=> 'https://test',fetch:async()=>{state.rawReads++;return {status:200};},firebaseRestWrite:async(path,body,method)=>{const value=resolve(JSON.parse(body));writes.push({path,value,method});if(path===''&&rejectHistory)throw Error('History permission denied');if(path===''){for(const [p,v]of Object.entries(value))put(p,v);if(changeSession){c.currentUser='01332517801';c.appSessionGeneration++;}}else put(path,value);return JSON.stringify(value);}});
 vm.runInContext(targets,c);c.window.DmsTargets=c.DmsTargets;
 node('target-month').value='2026-11';node('target-metric').value='cico';node('morning-target-date').value='2026-11-15';
 for(const [a,b]of [['        function normalizeScopeWallet(', '\n        function dssHasAssignedDso('],['async function saveReportInParallelChunks(','\nasync function firebaseRestWrite('],['async function saveMorningExcel(){','\nfunction canSeeMorningRow('],['        async function refreshVisiblePageDataFast()','\n        let loginServerSyncPromise']])vm.runInContext(block(a,b),c);
 return {c,node,store,state,writes,statuses,cache};
}
test('Admin read permission no longer suppresses achievement history; upload and Dashboard refresh update every metric',async()=>{
 const w=setup();assert.equal(await w.c.DmsTargets.privateStore(),true);assert.equal(w.state.rawReads,0,'Do not infer private storage from HTTP read denial');
 await w.c.DmsTargets.load();assert.equal(w.node('target-actual').textContent,'300');
 await w.c.saveMorningExcel();assert.equal(w.state.done,1);assert.equal(w.store.morning_report_current.reportDate,'2026-11-15');assert.equal(w.store.morning_report_current.asOf,'2026-11-14');
 const atomic=w.writes.find(x=>x.path==='');assert.equal(atomic.method,'PATCH');assert.deepEqual(atomic.value['dms_target_tracking/2026-11/history/2026-11-14'],{'801':400,'802':600});assert.deepEqual(atomic.value['dms_target_tracking/2026-11/metrics/ci/history/2026-11-14'],{'801':250,'802':400});assert(atomic.value.morning_report_current.chunked);
 const meta=atomic.value.morning_report_current;assert.equal(meta.dsoShards,true);
 assert.deepEqual(w.writes.find(x=>x.path===meta.chunkRoot+'/by_dso/801').value,[['801',400,250,150]]);
 assert.deepEqual(w.writes.find(x=>x.path===meta.chunkRoot+'/by_dso/802').value,[['802',600,400,200]]);
 await w.c.refreshVisiblePageDataFast();assert.equal(w.node('target-actual').textContent,'1,000');assert.equal(w.node('target-pct').textContent,'33.33%');assert.match(w.node('target-status').textContent,/2026-11-14/);
 w.node('target-metric').value='ci';w.c.authServerRequest=async(path,input)=>({...w.store.dms_target_tracking[input.month].metrics[input.metric],targets:{801:1000,802:2000},metric:input.metric});await w.c.DmsTargets.load();assert.equal(w.node('target-actual').textContent,'650');
});
test('denied achievement write never publishes a new source report or reports upload success',async()=>{
 const w=setup({rejectHistory:true});await w.c.saveMorningExcel();assert.equal(w.state.done,0);assert.equal(w.state.failed,1);assert.equal(w.state.applied,0);assert.equal(w.cache.length,0);assert.equal(w.store.morning_report_current.fileName,'old.xlsx');assert.equal(w.store.dms_target_tracking['2026-11'].history['2026-11-14'],undefined);assert(w.statuses.some(s=>s.type==='error'&&/History permission denied/.test(s.text)));
});
test('Morning source publication requires an achievement snapshot before uploading any chunks',async()=>{
 const w=setup();await assert.rejects(()=>w.c.saveReportInParallelChunks('morning',{rows:[[801,1]]}),/snapshot missing/);assert.equal(w.writes.length,0);
});
test('upload completion cannot place Admin report data in another signed-in session',async()=>{
 const w=setup({changeSession:true});await w.c.saveMorningExcel();assert.equal(w.state.done,0);assert.equal(w.state.applied,0);assert.equal(w.cache.length,0);
});
test('daily visit refresh does not reload Dashboard targets; Dashboard refresh does',async()=>{
 const w=setup();w.state.active='view-daily';await w.c.refreshVisiblePageDataFast();assert.equal(w.state.targetReads,0);w.state.active='view-dashboard';await w.c.refreshVisiblePageDataFast();assert.equal(w.state.targetReads,1);
});
test('target upload readiness rejects non-Admin and mismatched identity without probing the database',async()=>{
 const w=setup();w.c.currentUser='01332517801';assert.equal(await w.c.DmsTargets.privateStore(),false);w.c.currentUser='admin';w.c.firebase.auth=()=>({currentUser:{uid:'dms_01332517801'}});assert.equal(await w.c.DmsTargets.privateStore(),false);assert.equal(w.state.rawReads,0);
});
