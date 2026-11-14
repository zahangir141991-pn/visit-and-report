// Read-only machine export for the encrypted GitHub backup job. No browser CORS.
const backupEncoder=new TextEncoder();
function backupReply(error,status){return Response.json({error},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function backupTokenMatches(configured,provided){
 if(!/^[a-f0-9]{64}$/.test(String(configured||''))||typeof provided!=='string'||provided.length>256)return false;
 const [a,b]=await Promise.all([configured,provided].map(v=>crypto.subtle.digest('SHA-256',backupEncoder.encode(v))));
 const x=new Uint8Array(a),y=new Uint8Array(b);let difference=0;for(let i=0;i<x.length;i++)difference|=x[i]^y[i];return difference===0;
}
export async function handleBackupExport(req,env,{firebase,rateLimit}){
 if(!/^[a-f0-9]{64}$/.test(String(env.DMS_BACKUP_TOKEN||'')))return backupReply('Not found',404);
 if(req.method!=='GET')return backupReply('GET required',405);
 if(req.headers.has('Origin'))return backupReply('Browser export is not permitted',403);
 const auth=req.headers.get('Authorization')||'';
 if(!auth.startsWith('Bearer ')||!await backupTokenMatches(env.DMS_BACKUP_TOKEN,auth.slice(7)))return backupReply('Export permission required',403);
 const u=new URL(req.url),part=u.searchParams.get('part');
 if(!['data','rules'].includes(part)||[...u.searchParams.keys()].some(k=>k!=='part'))return backupReply('Invalid export part',400);
 try{
  if(!await rateLimit(env,req.headers.get('CF-Connecting-IP')||'unknown','backup-export',4))return backupReply('Export rate limited',429);
  const response=await firebase(env,part==='data'?'':'.settings/rules');
  if(!response.ok||!response.headers.get('Content-Type')?.includes('json'))return backupReply('Database export unavailable',503);
  // Stream the upstream response. Never cache plaintext or embed the service account.
  return new Response(response.body,{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-DMS-Backup-Project':'visit-report-ea224'}});
 }catch(_){return backupReply('Database export unavailable',503);}
}
