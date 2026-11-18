import {DSS_USERS,wallet} from './security-data.mjs';
const FEEDBACK_ROOT='attendance_server/dms_visit_feedback';
const management=id=>id==='admin'||id==='zahangir';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const clean=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(label+' is required (maximum '+max+' characters).');return value.trim();};
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(value)?value:fail('Invalid request identity.');
const canonical=value=>DSS_USERS[String(value||'').trim().toLowerCase()]||String(value||'').trim().toUpperCase().replace(/\s+/g,' ');
export function feedbackAssignments(assignments){
 const map=new Map();for(const row of Object.values(assignments||{})){const w=wallet(row?.dso),name=canonical(row?.dss);if(!w||!name)continue;if(!map.has(w))map.set(w,new Set());map.get(w).add(name);}
 return [...map].flatMap(([dso,names])=>{if(names.size!==1)return [];const name=[...names][0],id=Object.keys(DSS_USERS).find(id=>DSS_USERS[id]===name);return id?[{dso,dsoId:'01332517'+dso,dssId:id,dssName:name}]:[];}).sort((a,b)=>a.dso.localeCompare(b.dso));
}
export function feedbackCanRead(id,row){return !!row&&(management(id)||row.dsoId===id||row.dssId===id);}
export function feedbackSummary(row){const replies=Object.values(row.replies||{});return {dsoPending:!replies.some(r=>r?.by===row.dsoId),dssPending:!replies.some(r=>r?.by===row.dssId)};}
async function readJson(firebase,env,path){const r=await firebase(env,path);if(!r.ok)fail('Feedback could not load. Please retry.',503);return r.json();}
async function createOnce(firebase,env,path,record,match){
 for(let attempt=0;attempt<3;attempt++){
  const r=await firebase(env,path,{headers:{'X-Firebase-ETag':'true'}});if(!r.ok)fail('Feedback could not load. Please retry.',503);
  const old=await r.json(),etag=r.headers.get('etag');if(old){if(match(old))return old;fail('This request identity is already in use.',409);}if(!etag)fail('Feedback save unavailable. Please retry.',503);
  const saved=await firebase(env,path,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(record)});
  if(saved.status===412)continue;if(!saved.ok)fail('Feedback was not saved. Please retry.',503);return record;
 }fail('Feedback changed. Please retry.',409);
}
export async function visitFeedback(env,input,id,firebase){
 if(!management(id)&&!DSS_USERS[id]&&!/^013325178(?:0[1-9]|[1-3]\d|4[0-6])$/.test(id))fail('Feedback permission required.',403);
 const action=input.action||'list';
 if(action==='list'){
  const [data,assignments]=await Promise.all([readJson(firebase,env,FEEDBACK_ROOT),management(id)?readJson(firebase,env,'dss_dso_assignments_common'):Promise.resolve({})]);
  const threads=Object.entries(data||{}).filter(([,r])=>feedbackCanRead(id,r)).map(([key,r])=>({...r,id:key,...feedbackSummary(r)})).sort((a,b)=>b.createdAt-a.createdAt);
  return {threads,assignments:management(id)?feedbackAssignments(assignments):[],canCreate:management(id)};
 }
 if(action==='create'){
  if(!management(id))fail('Only Admin or DM can send feedback.',403);
  const feedbackId=key(input.feedbackId),dso=wallet(input.dso),subject=clean(input.subject,120,'Subject'),text=clean(input.text,3000,'Feedback');
  const existing=await readJson(firebase,env,FEEDBACK_ROOT+'/'+feedbackId);
  if(existing){if(existing.createdBy===id&&existing.dso===dso&&existing.subject===subject&&existing.text===text)return {thread:{...existing,id:feedbackId,...feedbackSummary(existing)}};fail('This feedback identity is already in use.',409);}
  const assignments=feedbackAssignments(await readJson(firebase,env,'dss_dso_assignments_common')),recipient=assignments.find(r=>r.dso===dso);
  if(!recipient)fail('This DSO has no unambiguous DSS assignment. Update DSO assignments first.');
  const row={...recipient,subject,text,createdBy:id,createdAt:Date.now(),replies:{}};
  const stored=await createOnce(firebase,env,FEEDBACK_ROOT+'/'+feedbackId,row,r=>r.createdBy===id&&r.dso===dso&&r.subject===subject&&r.text===text);
  return {thread:{...stored,id:feedbackId,...feedbackSummary(stored)}};
 }
 if(action==='reply'){
  const feedbackId=key(input.feedbackId),replyId=key(input.replyId),text=clean(input.text,3000,'Reply'),row=await readJson(firebase,env,FEEDBACK_ROOT+'/'+feedbackId);
  if(!row||!feedbackCanRead(id,row))fail('Feedback permission required.',403);
  if(id!==row.dsoId&&id!==row.dssId)fail('Only the assigned DSS or DSO can reply.',403);
  const reply={by:id,role:id===row.dssId?'DSS':'DSO',text,at:Date.now()};
  await createOnce(firebase,env,FEEDBACK_ROOT+'/'+feedbackId+'/replies/'+replyId,reply,r=>r.by===id&&r.text===text);
  return {ok:true};
 }
 fail('Unknown feedback action.');
}
