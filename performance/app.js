(function(){
'use strict';
const A=window.PerformanceAnalytics,el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fields=[['txn','MTD_TXN'],['ci','MTD_CASH_IN'],['co','MTD_CASH_OUT'],['islamic','MTD ISLAMIC CICO'],['atleast5','5 Lac & Above']];let months={},listener=null,pending=null,token=0,previewToken=0,saving=false,dssMap=new Map(),previewSheets=[],scopedDsos=null,serverNames=null,refreshTimer=null,agentPage=1,agentSignature='';
const fmt=(n,k)=>n==null?'—':['under5','atleast5','active','agents'].includes(k)?Number(n||0).toLocaleString('en-IN'):(Number(n||0)/10000000).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})+' Cr';
const name=dso=>dssMap.get(A.wallet(dso))||'Unassigned';
function scope(dso){const role=getRoleInfo();if(['Admin','DM'].includes(role.role))return true;if(role.role==='DSS')return !!scopedDsos&&scopedDsos.has(A.wallet(dso));if(role.role==='DSO')return normalizeScopeWallet(role.dsoWallet)===A.wallet(dso);return false;}
const entries=(month)=>Object.values(months[month]?.groups||{}).filter(r=>r&&scope(String(r.dso)));
function filtered(month){
 const rows=entries(month);
 if(el('perf-group').value==='dh')return rows;
 const dss=el('perf-dss').value,dso=el('perf-dso').value;
 return rows.filter(r=>(!dss||name(r.dso)===dss)&&(!dso||String(r.dso)===dso));
}
const monthFormat=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
const monthName=month=>month?monthFormat.format(new Date(month+'-01T00:00:00Z')):'';
function periodLabel(month,period){
 const [year,number]=month.split('-');
 if(period==='yearly')return year;
 if(period==='halfyearly')return year+' · H'+Math.ceil(Number(number)/6);
 if(period==='quarterly')return year+' · Q'+Math.ceil(Number(number)/3);
 return monthName(month);
}
function controls(){
 const role=getRoleInfo().role,group=el('perf-group'),period=el('perf-period'),ms=el('perf-month');
 const allowDh=['Admin','DM'].includes(role);
 el('perf-group-dh').hidden=!allowDh;
 if(!allowDh&&group.value==='dh')group.value='dso';
 if(group.value==='agent')period.value='monthly';
 period.disabled=group.value==='agent';
 const mode=period.value||'monthly',old=ms.value;
 const keys=[...new Set(Object.keys(months).sort().reverse().map(month=>A.periodMonths(month,mode)[0]).filter(Boolean))];
 ms.innerHTML=keys.map(month=>'<option value="'+esc(month)+'">'+esc(periodLabel(month,mode))+'</option>').join('');
 const previousSelection=A.periodMonths(old,mode)[0];
 if(keys.includes(previousSelection))ms.value=previousSelection;
 const days=A.periodMonths(ms.value,mode);
 const ds=el('perf-dss'),dw=el('perf-dso'),selectedDss=ds.value,selectedDso=dw.value;
 ds.disabled=dw.disabled=group.value==='dh';
 const rows=days.flatMap(entries),names=[...new Set(rows.map(r=>name(r.dso)))].sort();
 ds.innerHTML='<option value="">All DSS</option>'+names.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
 if(names.includes(selectedDss))ds.value=selectedDss;
 const dsos=[...new Set(rows.filter(r=>!ds.value||name(r.dso)===ds.value).map(r=>String(r.dso)))].sort((a,b)=>Number(a)-Number(b));
 dw.innerHTML='<option value="">All DSO</option>'+dsos.map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join('');
 if(dsos.includes(selectedDso))dw.value=selectedDso;
 return {days,mode};
}
const percent=value=>value==null?'—':(value>=0?'+':'')+value.toFixed(2)+'%';
function render(){
 if(!currentUser)return;
 dssMap=serverNames||A.masterDssMap(uddoktaDB);
 const {days,mode}=controls();
 const month=days[0],priorDays=A.periodMonths(A.previousMonth(month),mode);
 const uploaded=days.filter(day=>!!months[day]);
 const rows=days.flatMap(filtered),priorRows=priorDays.flatMap(filtered);
 const comparable=!!days.length&&uploaded.length===days.length&&priorDays.every(day=>!!months[day]);
 const totals=A.sum(rows),priorTotals=A.sum(priorRows);
 el('perf-meta').textContent=month
  ?mode==='monthly'
   ?'Selected: '+monthName(month)+' · Report date: '+(months[month]?.asOf||'not specified')+(comparable?' · Previous report: '+(months[priorDays[0]]?.asOf||priorDays[0]):' · Previous month not uploaded')
   :periodLabel(month,mode)+' · '+days[0]+' to '+days.at(-1)+' · '+uploaded.length+' / '+days.length+' months uploaded'
  :'No monthly report uploaded yet.';
 el('perf-cards').innerHTML=fields.map(([key,label])=>{
  const growth=comparable&&rows.length&&priorRows.length?A.change(totals[key],priorTotals[key]):null;
  return '<div class="perf-card"><span>'+esc(label)+'</span><strong>'+esc(fmt(rows.length?totals[key]:null,key))+'</strong><small>'+esc(growth==null?'Previous: —':percent(growth))+'</small></div>';
 }).join('');
 const group=el('perf-group').value;
 if(group==='agent'){
  renderAgents(rows,priorRows,comparable,month);
 }else{
  el('perf-agent-controls').hidden=true;
  const groupKey=row=>group==='dh'?'M/S. Mostafa':group==='dss'?name(row.dso):String(row.dso);
  const groupRows=list=>{
   const grouped=new Map();
   for(const row of list){
    const key=groupKey(row);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(row);
   }
   return grouped;
  };
  const label=group==='dh'?'DH':group==='dss'?'DSS':'DSO';
  const columns=fields.length+3;
  const renderRows=(caption,list,previousList)=>{
   const grouped=groupRows(list),previous=groupRows(previousList);
   return [...grouped.keys()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(key=>{
    const summary=A.sum(grouped.get(key)),old=previous.get(key);
    const growth=old?A.change(summary.txn,A.sum(old).txn):null;
    return '<tr><td>'+esc(caption)+'</td><th>'+esc(key)+'</th>'+fields.map(([field])=>'<td>'+esc(fmt(summary[field],field))+'</td>').join('')+'<td>'+esc(percent(growth))+'</td></tr>';
   }).join('');
  };
  el('perf-table-head').innerHTML='<tr><th>Month</th><th>'+label+'</th>'+fields.map(([,title])=>'<th>'+esc(title)+'</th>').join('')+'<th>TXN Growth</th></tr>';
  const periodTotal=days.length>1?renderRows(periodLabel(month,mode)+' Total',rows,comparable?priorRows:[]):'';
  const monthlyRows=days.map(day=>renderRows(monthName(day),filtered(day),filtered(A.previousMonth(day)))).join('');
  el('perf-table-body').innerHTML=(periodTotal+monthlyRows)||'<tr><td colspan="'+columns+'">No data for this selection.</td></tr>';
 }
 draw(days,mode);
}
function renderAgents(rows,previous,prevExists,month){
 el('perf-agent-controls').hidden=false;
 const list=rows.flatMap(row=>(row.agentRows||[]).map(agent=>({...agent,dso:String(row.dso)}))),prior=new Map(previous.flatMap(row=>row.agentRows||[]).map(agent=>[String(agent.agent),agent]));
 const master=new Map((uddoktaDB||[]).map(row=>[String(row[1]||'').replace(/\D/g,'').replace(/^0/,''),row[2]||''])),agentName=agent=>master.get(String(agent).replace(/^0/,''))||'';
 const query=el('perf-agent-search').value.trim().toLowerCase(),size=Number(el('perf-agent-size').value)||25,signature=[el('perf-month').value,el('perf-dss').value,el('perf-dso').value,query,size].join('|');if(signature!==agentSignature){agentSignature=signature;agentPage=1;}
 const visible=list.filter(row=>!query||[row.agent,agentName(row.agent),row.dso].some(value=>String(value).toLowerCase().includes(query))).sort((a,b)=>String(a.agent).localeCompare(String(b.agent),undefined,{numeric:true}));const pages=Math.max(1,Math.ceil(visible.length/size));agentPage=Math.max(1,Math.min(agentPage,pages));
 el('perf-table-head').innerHTML='<tr>'+['Month','Uddokta Number','Uddokta Name','DSO','DSS','MTD TXN','MTD CI','MTD CO','Islamic MTD TXN','TXN Growth'].map(label=>'<th>'+label+'</th>').join('')+'</tr>';
 const amount=value=>value==null?'—':Number(value).toLocaleString('en-IN',{maximumFractionDigits:2});
 el('perf-table-body').innerHTML=visible.slice((agentPage-1)*size,agentPage*size).map(row=>{const old=prior.get(String(row.agent)),growth=prevExists&&old?A.change(row.txn,old.txn):null;return '<tr><td>'+esc(monthName(month))+'</td><th>'+esc(row.agent)+'</th><td>'+esc(agentName(row.agent))+'</td><td>'+esc(row.dso)+'</td><td>'+esc(name(row.dso))+'</td>'+['txn','ci','co','islamic'].map(key=>'<td>'+esc(amount(row[key]))+'</td>').join('')+'<td>'+esc(growth==null?'—':(growth>=0?'+':'')+growth.toFixed(2)+'%')+'</td></tr>';}).join('')||'<tr><td colspan="10">'+(list.length?'No matching agent.':'Agent details are unavailable for this month. Admin must upload its Excel file again.')+'</td></tr>';
 el('perf-agent-page').textContent='Page '+agentPage+' / '+pages+' · '+visible.length+' agents · Amounts in BDT';el('perf-agent-prev').disabled=agentPage<=1;el('perf-agent-next').disabled=agentPage>=pages;
}
window.performanceAgentPage=function(direction){agentPage+=direction;render();};
function draw(days,mode){
 const chart=el('perf-chart'),metric=el('perf-metric').value||'txn';
 const keys=[...days];
 if(mode==='monthly'&&keys.length){
  const earliest=Object.keys(months).sort()[0];
  for(let month=A.previousMonth(keys[0]);keys.length<12&&month>=earliest;month=A.previousMonth(month)){
   keys.unshift(month);
  }
 }
 const points=keys.map(month=>{
  const rows=filtered(month);
  return rows.length?A.sum(rows)[metric]:null;
 });
 if(!points.some(value=>value!=null)){chart.innerHTML='<p>No monthly data for this selection.</p>';return;}
 const max=Math.max(1,...points),step=keys.length>1?620/(keys.length-1):0;
 const coords=points.map((value,i)=>[keys.length===1?360:50+step*i,150-value/max*115]);
 const lines=coords.slice(1).map(([x,y],i)=>{
  if(points[i]==null||points[i+1]==null)return '';
  return '<line x1="'+coords[i][0]+'" y1="'+coords[i][1]+'" x2="'+x+'" y2="'+y+'" stroke="#047857" stroke-width="3"/>';
 }).join('');
 chart.innerHTML='<svg viewBox="0 0 720 190" role="img" aria-label="'+esc((fields.find(([key])=>key===metric)?.[1]||metric)+' by month')+'">'
  +'<line x1="50" y1="150" x2="670" y2="150" stroke="#cbd5e1"/>'+lines
  +coords.map(([x,y],i)=>{
   const month=keys[i],value=points[i],description=month+' · '+(value==null?'No data':fmt(value,metric));
   const point=value==null?'':'<circle cx="'+x+'" cy="'+y+'" r="4" fill="#047857"><title>'+esc(description)+'</title></circle><text x="'+x+'" y="'+(y-9)+'" text-anchor="middle" font-size="10" fill="#123c2c">'+esc(fmt(value,metric))+'</text>';
   return '<g>'+point+'<text x="'+x+'" y="175" text-anchor="middle" font-size="11" fill="#1e293b"><title>'+esc(description)+'</title>'+esc(month.slice(2))+'</text></g>';
  }).join('')+'</svg>';
}
async function anonymousBlocked(){try{const u=String(firebaseConfig.databaseURL).replace(/\/$/,'')+'/monthly_performance.json?shallow=true';const r=await fetch(u,{cache:'no-store',credentials:'omit'});return r.status===401||r.status===403;}catch{return false;}}
window.openPerformanceReport=async function(){if(!currentUser||!['Admin','DM','DSS','DSO'].includes(getRoleInfo().role))return;el('perf-upload-wrap').hidden=getRoleInfo().role!=='Admin';if(listener)listener.off();clearTimeout(refreshTimer);scopedDsos=null;serverNames=null;const gen=++token;months={};render();if(!await anonymousBlocked()){el('perf-meta').textContent='Secure database access is required before this report can be enabled.';return;}if(gen!==token||!currentUser)return;if(['DSS','DSO'].includes(getRoleInfo().role)){
 const load=async()=>{try{const idToken=await firebase.auth().currentUser.getIdToken();const result=await authServerRequest('/performance',{idToken});if(gen!==token||!currentUser)return;months=result.months||{};scopedDsos=new Set(result.allowedDsos||[]);serverNames=new Map(Object.entries(result.dssNames||{}));render();}catch(error){if(gen!==token||!currentUser)return;months={};scopedDsos=null;serverNames=null;render();el('perf-meta').textContent='Report access failed: '+error.message;}if(gen===token&&currentUser)refreshTimer=setTimeout(load,30000);};await load();return;
 }listener=db.ref('monthly_performance');listener.on('value',snap=>{if(gen!==token||!currentUser)return;months=snap.val()||{};render();},error=>{if(gen===token&&currentUser)el('perf-meta').textContent='Report access failed: '+error.message;});};
function usePerformanceSheet(sheetName){
 const entry=previewSheets.find(s=>s.name===sheetName);pending=null;el('perf-upload-button').disabled=true;if(!entry)return;
 try{const parsed=A.parse(entry.matrix),asOf=entry.asOf;let date='';if(asOf instanceof Date&&!isNaN(asOf))date=[asOf.getFullYear(),String(asOf.getMonth()+1).padStart(2,'0'),String(asOf.getDate()).padStart(2,'0')].join('-');if(date)el('perf-upload-month').value=date.slice(0,7);pending={...parsed,asOf:date};el('perf-upload-status').textContent='Sheet: '+entry.name+' · '+parsed.agents+' Uddokta · '+Object.keys(parsed.groups).length+' DSO · report date '+(date||'not found')+'. Verify the month before uploading.';el('perf-upload-button').disabled=false;}catch(e){el('perf-upload-status').textContent=e.message;}
}
window.selectPerformanceSheet=function(value){if(currentUser&&getRoleInfo().role==='Admin')usePerformanceSheet(value);};
window.previewPerformance=async function(input){
 if(!currentUser||getRoleInfo().role!=='Admin')return;const preview=++previewToken,session=appSessionGeneration;pending=null;previewSheets=[];el('perf-upload-button').disabled=true;el('perf-sheet-wrap').hidden=true;const file=input.files?.[0];if(!file)return;
 try{await ensureXlsxSdk();const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});if(preview!==previewToken||session!==appSessionGeneration||!currentUser)return;
 for(const sheetName of wb.SheetNames){const sheet=wb.Sheets[sheetName],matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,blankrows:false});try{A.mapColumns(matrix);previewSheets.push({name:sheetName,matrix,asOf:sheet.B2?.v});}catch(_){}}
 if(!previewSheets.length)throw Error('No matching report sheet found. Required: DSO, Uddokta number, MTD transaction amount, MTD CI and MTD CO. The sheet name can be anything.');
 const select=el('perf-sheet');select.innerHTML='<option value="">Select report sheet</option>'+previewSheets.map(s=>'<option value="'+esc(s.name)+'">'+esc(s.name)+'</option>').join('');el('perf-sheet-wrap').hidden=previewSheets.length===1;
 const preferred=previewSheets.length===1?previewSheets[0]:previewSheets.find(s=>/^uddokta$/i.test(s.name.trim()));if(preferred){select.value=preferred.name;usePerformanceSheet(preferred.name);}else el('perf-upload-status').textContent='More than one matching sheet found. Select the report sheet.';
 }catch(e){if(preview===previewToken&&session===appSessionGeneration&&currentUser)el('perf-upload-status').textContent=e.message;}
};
window.savePerformance=async function(){
 if(saving||!pending||!currentUser||getRoleInfo().role!=='Admin')return;
 const month=el('perf-upload-month').value,session=appSessionGeneration,upload=pending,user=currentUser;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return alert('Select a valid report month.');
 if(upload.asOf&&upload.asOf.slice(0,7)!==month)return alert('Selected month does not match the report date.');
 if(!confirm('Save the report for '+month+'? This replaces any existing report for that month.'))return;
 const b=el('perf-upload-button');saving=true;b.disabled=true;
 try{
  if(!await anonymousBlocked())throw Error('Secure database access is required before uploading.');
  if(session!==appSessionGeneration||currentUser!==user||getRoleInfo().role!=='Admin')return;
  await db.ref('monthly_performance/'+month).set({groups:upload.groups,asOf:upload.asOf,uploadedAt:Date.now(),uploadedBy:user,schema:2});
  if(session!==appSessionGeneration||currentUser!==user)return;
  pending=null;el('perf-upload-status').textContent='Report saved.';
 }catch(e){if(session===appSessionGeneration&&currentUser===user)el('perf-upload-status').textContent='Upload failed: '+e.message;}
 finally{saving=false;if(session===appSessionGeneration&&currentUser===user)b.disabled=!pending;}
};
window.renderPerformance=render;window.closePerformance=function(){token++;previewToken++;clearTimeout(refreshTimer);scopedDsos=null;serverNames=null;if(listener)listener.off();listener=null;months={};pending=null;previewSheets=[];};
})();
