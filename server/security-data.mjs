// All client data paths are allowlisted. Scope is resolved from verified identity,
// never from a role, wallet, DSS name or user ID supplied by the browser.
export const DSS_USERS={sohag:'MOHOSIN HOSSAIN SOHAG',alamin:'MD. ALAMIN',imran:'MD. IMRAN HOSSAIN',rubel:'RUBEL',shofiq:'MD. SHOFIQ'};
export const wallet=v=>{const n=String(v||'').replace(/\D/g,'');return /^8(?:0[1-9]|[1-3]\d|4[0-6])$/.test(n)?n:/^0?13325178(?:0[1-9]|[1-3]\d|4[0-6])$/.test(n)?n.slice(-3):'';};
const name=v=>String(v||'').trim().toUpperCase().replace(/\s+/g,' ');
export function securityScope(id,assignments={}){
 const all=['admin','zahangir'].includes(id),dss=DSS_USERS[id],own=wallet(id),wallets=new Set();
 if(own)wallets.add(own);
 // Ambiguous assignment fails closed. Short aliases have exact canonical mappings.
 const seen=new Map();for(const r of Object.values(assignments||{})){const w=wallet(r?.dso),n=DSS_USERS[String(r?.dss||'').trim().toLowerCase()]||name(r?.dss);if(!w||!n)continue;if(!seen.has(w))seen.set(w,new Set());seen.get(w).add(n);}
 if(dss)for(const [w,names]of seen)if(names.size===1&&names.has(dss))wallets.add(w);
 return {id,all,dss,own,wallets};
}
const pick=(value,parts)=>parts.reduce((v,p)=>v&&typeof v==='object'?v[p]:null,value)??null;
const filter=(data,predicate)=>Object.fromEntries(Object.entries(data||{}).filter(([,r])=>r&&predicate(r)));
export async function secureData(input,id,read){
 const path=String(input.path||'');if(!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)||path.length>240)throw Object.assign(Error('Data permission required'),{status:403});
 const [section,...parts]=path.split('/');
 const assignments=DSS_USERS[id]?await read('dss_dso_assignments_common'):{};
 const s=securityScope(id,assignments),owned=r=>s.all||s.wallets.has(wallet(r.dsoWallet||r.dsoNumber));
 const visitOwned=r=>s.all||String(r.user||'').toLowerCase()===id||(!s.dss&&owned(r));
 let data;
 if(['uddokta_master','morning_report_current','afternoon_report_current'].includes(section)){
  if(s.dss||(!s.all&&!s.own))return parts.length?null:section==='uddokta_master'?{}:{headers:[],rows:[]};
  data=await read(section);
  if(section==='uddokta_master')data=filter(data,owned);
  else if(data){
   let rows=data.rows||[];
   if(data.chunked){
    const prefix=section.replace('_current','_chunks')+'/';
    if(typeof data.chunkRoot!=='string'||!data.chunkRoot.startsWith(prefix)||!/^\w+\/[-\w]+$/.test(data.chunkRoot)||!Number.isInteger(data.chunkCount)||data.chunkCount<0||data.chunkCount>250)throw Error('Invalid report manifest');
    rows=[];for(let i=0;i<data.chunkCount;i+=8){const chunks=await Promise.all(Array.from({length:Math.min(8,data.chunkCount-i)},(_,j)=>read(data.chunkRoot+'/chunk_'+(i+j))));for(const chunk of chunks)rows.push(...(Array.isArray(chunk)?chunk:[]));}
   }
   const headers=data.headers||[],column=headers.findIndex(h=>/^DSO(?:[ _-]*(?:WALLET|NUMBER|NO|ID))?$/i.test(String(h).trim()));
   rows=rows.filter(r=>s.all||(column>=0&&s.wallets.has(wallet(r[column]))));
   data={...data,rows,chunked:false,rowCount:rows.length};delete data.chunkRoot;delete data.chunkCount;
  }
 }else if(['visit_reports','visit_reports_index','visit_notices','new_uddokta_kyc'].includes(section)){
  const predicate=section==='new_uddokta_kyc'?owned:section==='visit_notices'?(r=>!s.dss&&owned(r)):visitOwned;
  // Fetch a single record only when requested; authorize its parent before any child.
  if(parts.length){const r=await read(section+'/'+parts[0]);return r&&predicate(r)?pick(r,parts.slice(1)):null;}
  data=filter(await read(section),predicate);
 }else if(['visit_report_photos','new_uddokta_kyc_photos'].includes(section)){
  if(parts.length!==1)throw Object.assign(Error('Photo permission required'),{status:403});
  const record=await read((section==='visit_report_photos'?'visit_reports':'new_uddokta_kyc')+'/'+parts[0]);
  if(!record||!(section==='visit_report_photos'?visitOwned(record):owned(record)))throw Object.assign(Error('Photo permission required'),{status:403});
  return read(path);
 }else if(section==='dss_dso_assignments_common')data=s.all?await read(section):filter(await read(section),r=>s.wallets.has(wallet(r.dso)));
 else if(section==='uddokta_master_meta')data=s.all?await read(section):null;
 else throw Object.assign(Error('Data permission required'),{status:403});
 return pick(data,parts);
}
