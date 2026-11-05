(function(g){
'use strict';
const el=id=>document.getElementById(id);
const money=n=>Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
let revision=0, timer, busy=false;
function wallet(v){const s=String(v??'').trim();return /^(?:0?1332517)?8(?:0[1-9]|[1-3]\d|4[0-6])$/.test(s)?s.slice(-3):'';}
function amount(v){const s=String(v??'').trim().replace(/[,৳\s]/g,'');return /^\d+(?:\.\d+)?$/.test(s)?Number(s):NaN;}
const header=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[^a-z\u0980-\u09ff]/g,'');
const dsoHeaders=new Set(['dso','dsowallet','dsoid','dsonumber','dsono','dsowalletnumber','dsowalletno','ডিএসও','ডিএসওনম্বর']);
const targetHeaders=new Set(['target','monthlytarget','txntarget','monthlytxntarget','targetamount','monthlytargetamount','transactiontarget','monthlytransactiontarget','targetbdt','monthlytargetbdt','টার্গেট','মাসিকটার্গেট','লক্ষ্যমাত্রা','মাসিকলক্ষ্যমাত্রা']);
const phaseHeader=v=>{const raw=String(v??'').normalize('NFKC');if(/%|percent/i.test(raw))return '';const h=raw.toLowerCase().replace(/[^a-z0-9]/g,'');return /^(?:monthly)?(?:txn|transaction)?(?:target(?:amount)?(?:for)?)?(?:phase|part)0*([1-9][0-9]*)(?:target(?:amount)?|amount|bdt)?$/.exec(h)?.[1]||'';};
const totalHeaders=new Set(['monthlytarget','monthlytargetamount','monthlytargetbdt','monthlytxntarget','monthlytransactiontarget','totalmonthlytarget','totaltarget','totaltargetamount','dsowisecicotarget','মাসিকটার্গেট','মাসিকলক্ষ্যমাত্রা']);
function columns(rows){return rows.slice(0,50).flatMap((row,index)=>{const h=row.map(header),d=h.flatMap((v,i)=>dsoHeaders.has(v)?[i]:[]),totals=h.flatMap((v,i)=>totalHeaders.has(v)?[i]:[]),t=totals.length?totals:h.flatMap((v,i)=>targetHeaders.has(v)?[i]:[]),phases=row.flatMap((v,i)=>phaseHeader(v)?[{i,key:phaseHeader(v)}]:[]),phase=row.flatMap((v,i)=>/^(?:phase|part|target[ _-]*phase)$/i.test(String(v??'').trim())?[i]:[]);return d.length&&(t.length||phases.length)?[{index,d,t,phases,phase:totals.length?[]:phase}]:[];})[0];}
function parse(rows){
 const c=columns(rows);if(!c)throw Error('DSO এবং Target Amount বা Phase Target কলাম পাওয়া যায়নি।');
 if(c.d.length!==1||c.t.length>1||c.phase.length>1||(!c.t.length&&new Set(c.phases.map(p=>p.key)).size!==c.phases.length))throw Error('একটি DSO কলাম এবং আলাদা Phase বা একটি মাসিক Target কলাম রাখুন।');
 const out={},seen=new Set();rows.slice(c.index+1).forEach((row,i)=>{
  const d=row[c.d[0]],values=c.t.length?[row[c.t[0]]]:c.phases.map(p=>row[p.i]);
  if(!String(d??'').trim()&&values.every(v=>!String(v??'').trim()))return;
  if(/^(?:grand\s+)?total$|^মোট$/i.test(String(d??'').trim()))return;
  const key=wallet(d),phase=c.phase.length&&c.t.length?String(row[c.phase[0]]??'').trim().toLowerCase().replace(/^(?:phase|part)\s*/,''):'';
  const n=values.map(v=>amount(v)).reduce((sum,v)=>sum+v,0),unique=key+'|'+phase;
  if(!key||!Number.isFinite(n)||n<0||(!phase&&n===0)||(c.phase.length&&c.t.length&&!phase)||seen.has(unique))throw Error('Invalid or duplicate DSO / Target in row '+(c.index+i+2));
  seen.add(unique);out[key]=(out[key]||0)+n;
 });if(!Object.keys(out).length||Object.values(out).some(v=>!Number.isFinite(v)||v<=0))throw Error('প্রতি DSO-এর মোট Target শূন্যের বেশি হতে হবে।');return out;
}
function parseSheets(sheets){const candidates=sheets.filter(sheet=>columns(sheet.rows));if(!candidates.length)return parse([]);if(candidates.length>1)throw Error('একাধিক শিটে DSO ও Target আছে। আপলোডের জন্য শুধু একটি Target শিট রাখুন।');return parse(candidates[0].rows);}
const workbookMetrics={ci:'dsowisecitarget',co:'dsowisecotarget',cico:'dsowisecicotarget',islamic:'nagadislamiccicotarget',five:'lactarget'};
function importWorkbook(sheets){
 const targets=parseSheets(sheets);
 const sheet=sheets.find(sheet=>columns(sheet.rows)),c=columns(sheet.rows),headers=sheet.rows[c.index].map(header),metrics={};
 if(!headers.includes(workbookMetrics.cico))return {targets,metrics};
 for(const [metric,name] of Object.entries(workbookMetrics)){
  if(metric==='cico')continue;
  const indices=headers.flatMap((h,i)=>h===name?[i]:[]);if(!indices.length)continue;if(indices.length!==1)throw Error('Duplicate '+name+' column.');
  const values={};
  for(const [i,row] of sheet.rows.slice(c.index+1).entries()){
   const d=wallet(row[c.d[0]]);if(!d||!Object.hasOwn(targets,d))continue;
   const value=amount(row[indices[0]]);
   if(!Number.isFinite(value)||(metric==='five'&&!Number.isInteger(value)))throw Error('Invalid '+name+' in row '+(c.index+i+2));
   values[d]=value;
  }
  metrics[metric]=values;
 }
 return {targets,metrics};
}
function achievementMetrics(report,map){
 const result={};
 for(const [metric,column] of Object.entries({ci:map.mtdCashIn,co:map.mtdCashOut,islamic:map.islamicCico,five:map.mtdTxn})){
  if(!Number.isInteger(column)||column<0)continue;
  result[metric]={};
  for(const row of report.rows){
   const d=wallet(row[map.dso]);if(!d)continue;
   const raw=String(row[column]??'').trim(),v=raw?amount(raw):0;
   if(!Number.isFinite(v))throw Error('Invalid Morning Report value for DSO '+d);
   result[metric][d]=(result[metric][d]||0)+(metric==='five'?Number(v>=500000):v);
  }
 }
 return result;
}
function snapshot(report,map){const out={};for(const row of report.rows){const key=wallet(row[map.dso]);if(!key)continue;const raw=String(row[map.mtdTxn]??'').trim();const n=raw?amount(raw):0;if(!Number.isFinite(n))throw Error('Invalid MTD TXN for DSO '+key);out[key]=(out[key]||0)+n;}return out;}
function summarize(data,month,today){const targets=data.targets||{}, keys=Object.keys(targets);const total=keys.reduce((s,k)=>s+targets[k],0);const days=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).getUTCDate();const points=Object.entries(data.history||{}).sort().filter(([date])=>date.startsWith(month+'-')&&date<=today).flatMap(([date,groups])=>keys.length&&keys.every(k=>Number.isFinite(groups[k]))?[{date,day:+date.slice(-2),amount:keys.reduce((s,k)=>s+groups[k],0)}]:[]);const latest=points.at(-1);const left=month===today.slice(0,7)?Math.max(0,days-Number(today.slice(-2))+(latest?.date===today?0:1)):month>today.slice(0,7)?days:0;const trend=latest&&latest.day>0&&latest.day<=days?latest.amount/latest.day*days:null;return {total,days,points,latest,left,trend,trendPct:trend!==null&&total?100*trend/total:null,pct:latest&&total?100*latest.amount/total:null,daily:latest&&left?Math.max(0,total-latest.amount)/left:null};}
function draw(s){const box=el('target-chart');box.replaceChildren();if(!s.latest)return;const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 640 200');svg.setAttribute('role','img');svg.setAttribute('aria-label','Monthly cumulative target pace and achievement');const max=Math.max(s.total,...s.points.map(p=>p.amount),1),x=n=>36+n/s.days*574,y=n=>169-n/max*138;function add(tag,attrs,label){const node=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);if(label)node.textContent=label;svg.append(node);return node;}for(let i=0;i<=4;i++){const n=max*i/4;add('line',{x1:36,x2:610,y1:y(n),y2:y(n),stroke:'#e2e8f0'});}add('path',{d:'M '+x(0)+' '+y(0)+' L '+x(s.days)+' '+y(s.total),stroke:'#64748b','stroke-width':2,'stroke-dasharray':'6 5',fill:'none'});add('polyline',{points:s.points.map(p=>x(p.day)+','+y(p.amount)).join(' '),stroke:'#087f70','stroke-width':3,fill:'none'});for(const p of s.points){const dot=add('circle',{cx:x(p.day),cy:y(p.amount),r:4,fill:'#087f70'});const title=document.createElementNS(ns,'title');title.textContent=p.date+': '+money(p.amount);dot.append(title);}for(const day of [1,Math.ceil(s.days/2),s.days])add('text',{x:x(day),y:190,'text-anchor':'middle',fill:'#475569','font-size':13},String(day));box.append(svg);}
async function load(){const month=el('target-month').value;if(!currentUser||!month)return;const token=++revision,user=currentUser;el('target-status').textContent='Loading target summary…';el('target-chart').replaceChildren();for(const id of ['goal','actual','pct','daily','trend','trend-pct'])el('target-'+id).textContent='—';try{const idToken=await firebase.auth().currentUser.getIdToken();const metric=el('target-metric').value;const data=await authServerRequest('/targets',{idToken,month,metric});if(metric!=='cico'&&data.metric!==metric)throw Error('Deploy Login Worker v147 to enable this metric.');if(token!==revision||user!==currentUser)return;const s=summarize(data,month,getDhakaToday());el('target-goal').textContent=s.total?money(s.total):'—';el('target-actual').textContent=s.latest?money(s.latest.amount):'—';el('target-pct').textContent=s.pct===null?'—':s.pct.toFixed(2)+'%';el('target-daily').textContent=s.daily===null?'—':money(s.daily);el('target-trend').textContent=s.trend===null?'—':money(metric==='five'?Math.round(s.trend):s.trend);el('target-trend-pct').textContent=s.trendPct===null?'—':s.trendPct.toFixed(2)+'%';el('target-status').textContent=!s.total?'No target assigned for this month.':!s.latest?'Waiting for a Morning Report covering all targeted DSOs in your scope.':('Morning Report: '+s.latest.date+' · '+s.left+' calendar days remaining');draw(s);}catch(e){if(token===revision)el('target-status').textContent='Target summary unavailable: '+e.message;}}
async function privateStore(){try{const url=await authenticatedDatabaseUrl(String(firebaseConfig.databaseURL).replace(/\/$/,'')+'/dms_target_tracking.json?shallow=true');const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(6000)});return response.status===401||response.status===403;}catch{return false;}}
async function upload(){if(busy||getRoleInfo().role!=='Admin')return;const month=el('target-upload-month').value,file=el('target-file').files[0],user=currentUser; const status=el('target-upload-status');status.textContent='';if(!file||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return void(status.textContent='মাস ও Excel ফাইল নির্বাচন করুন।');busy=true;el('target-save').disabled=true;try{await ensureXlsxSdk();const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});const {targets,metrics}=importWorkbook(wb.SheetNames.map(name=>({rows:XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',blankrows:true,raw:false})})));if(currentUser!==user||getRoleInfo().role!=='Admin')return;if(!confirm('Save '+Object.keys(targets).length+' DSO targets for '+month+'? This replaces targets for this month only.'))return;if(!await privateStore())throw Error('Publish the updated Database Rules before uploading targets.');if(currentUser!==user)return;const updates={targets};for(const metric of ['ci','co','islamic','five'])updates['metrics/'+metric+'/targets']=metrics[metric]||null;await firebaseRestWrite('dms_target_tracking/'+month,JSON.stringify(updates),'PATCH');el('target-file').value='';el('target-month').value=month;status.textContent='Monthly targets saved for '+month+'.';}catch(e){status.textContent=e.message;}finally{busy=false;el('target-save').disabled=false;}}
function open(){if(!currentUser)return;if(!el('target-month').value)el('target-month').value=getDhakaToday().slice(0,7);clearInterval(timer);timer=setInterval(()=>{if(el('view-dashboard').classList.contains('active'))load();},60000);load();}
function close(){revision++;clearInterval(timer);if(el('target-chart')){el('target-chart').replaceChildren();for(const id of ['goal','actual','pct','daily','trend','trend-pct'])el('target-'+id).textContent='—';el('target-status').textContent='';el('target-upload-month').value='';el('target-file').value='';el('target-month').value='';}}
g.DmsTargets={parse,parseSheets,importWorkbook,achievementMetrics,snapshot,summarize,open,close,load,upload,privateStore};
})(globalThis);
