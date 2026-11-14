import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export const PROJECT='visit-report-ea224';
export const BRANCH='dms-encrypted-backups';
const REPO='zahangir141991-pn/visit-and-report';
const WORKER='https://dms-attendance-login.zahangir-ithome.workers.dev';
const MAGIC=Buffer.from('DMSBKP1\n');
const MAX_SOURCE=128*1024*1024,MAX_ENCRYPTED=32*1024*1024;
function keyBytes(value){if(!/^[a-f0-9]{64}$/.test(String(value||'')))throw Error('Backup key must contain 64 hexadecimal characters');return Buffer.from(value,'hex');}
export function validateSnapshot(s){
 if(!s||s.project!==PROJECT||!s.data||Array.isArray(s.data)||typeof s.data!=='object'||!s.data.user_auth||!s.rules?.rules||typeof s.rules.rules!=='object')throw Error('Incomplete or wrong-project backup');
 if(!['uddokta_master','visit_reports','new_uddokta_kyc','attendance'].some(k=>s.data[k]&&typeof s.data[k]==='object'))throw Error('Business data missing from backup');
 return s;
}
export function encryptSnapshot(snapshot,keyHex,iv=randomBytes(12)){
 validateSnapshot(snapshot);const key=keyBytes(keyHex);
 const header=Buffer.from(JSON.stringify({format:'DMSBKP1',project:PROJECT,algorithm:'AES-256-GCM',compression:'gzip',createdAt:snapshot.createdAt,iv:iv.toString('base64')}));
 const length=Buffer.alloc(4);length.writeUInt32BE(header.length);
 const prefix=Buffer.concat([MAGIC,length,header]),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(prefix);
 const zipped=gzipSync(Buffer.from(JSON.stringify(snapshot)),{level:6});
 const encrypted=Buffer.concat([prefix,cipher.update(zipped),cipher.final(),cipher.getAuthTag()]);
 if(encrypted.length>MAX_ENCRYPTED)throw Error('Encrypted backup exceeds the configured 32 MiB safety limit; no old backup was removed');
 return encrypted;
}
export function decryptSnapshot(file,keyHex){
 const key=keyBytes(keyHex);if(file.length<44||file.length>MAX_ENCRYPTED||!file.subarray(0,8).equals(MAGIC))throw Error('Invalid backup file');
 const n=file.readUInt32BE(8);if(n<1||n>4096||12+n+16>file.length)throw Error('Invalid backup header');
 const h=JSON.parse(file.subarray(12,12+n));if(h.project!==PROJECT||h.algorithm!=='AES-256-GCM'||h.compression!=='gzip')throw Error('Wrong backup format or project');
 const iv=Buffer.from(h.iv,'base64');if(iv.length!==12)throw Error('Invalid backup IV');
 const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(file.subarray(0,12+n));decipher.setAuthTag(file.subarray(-16));
 const plain=Buffer.concat([decipher.update(file.subarray(12+n,-16)),decipher.final()]);
 const snapshot=JSON.parse(gunzipSync(plain,{maxOutputLength:MAX_SOURCE*2}));return validateSnapshot(snapshot);
}
export async function fetchExport(part,token,fetcher=fetch){
 if(!['data','rules'].includes(part)||!/^[a-f0-9]{64}$/.test(String(token||'')))throw Error('Backup export configuration is incomplete');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);let reader;
 try{
  const response=await fetcher(WORKER+'/backup/export?part='+part,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:controller.signal});
  if(!response.ok||response.headers.get('X-DMS-Backup-Project')!==PROJECT||!response.headers.get('Content-Type')?.includes('json'))throw Error('Backup source unavailable (HTTP '+response.status+'); existing backups kept');
  if(Number(response.headers.get('Content-Length')||0)>MAX_SOURCE)throw Error('Source exceeds backup size limit');
  reader=response.body.getReader();const pieces=[];let bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_SOURCE){await reader.cancel();throw Error('Source exceeds backup size limit');}pieces.push(Buffer.from(value));}
  try{return JSON.parse(Buffer.concat(pieces).toString('utf8'));}catch(_){throw Error('Backup source returned invalid JSON');}
 }finally{clearTimeout(timer);}
}
export function retainedEntries(entries,newEntry){
 const pattern=/^DMS_FULL_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dmsbackup$/;
 for(const e of entries)if(!pattern.test(e.name)||e.mode!=='100644'||e.type!=='blob'||!/^[a-f0-9]{40}$/.test(e.sha))throw Error('Backup branch has unexpected contents; refusing to overwrite');
 return [...entries.filter(e=>e.name!==newEntry.name),newEntry].sort((a,b)=>b.name.localeCompare(a.name)).slice(0,7);
}
function git(args,input){const r=spawnSync('git',args,{input,encoding:'utf8',maxBuffer:8*1024*1024,env:process.env});if(r.status!==0)throw Error('Backup storage operation failed; previous backups retained');return r.stdout.trim();}
export function persistBackup(file,name){
 if(process.env.GITHUB_REPOSITORY!==REPO||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Backup storage is restricted to the DMS default branch workflow');
 const stored=readFileSync(file);if(stored.length>MAX_ENCRYPTED||!stored.subarray(0,8).equals(MAGIC))throw Error('Only encrypted DMS backup files may be published');
 const remote=git(['ls-remote','--heads','origin','refs/heads/'+BRANCH]);let old='',entries=[];
 if(remote){old=remote.split(/\s/)[0];if(!/^[a-f0-9]{40}$/.test(old))throw Error('Invalid backup branch');git(['fetch','--depth=1','origin','refs/heads/'+BRANCH]);if(git(['rev-parse','FETCH_HEAD'])!==old)throw Error('Backup branch changed; retry later');
  const listing=git(['ls-tree','-r','FETCH_HEAD']);entries=listing?listing.split('\n').map(l=>{const m=l.match(/^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/);if(!m)throw Error('Invalid backup tree');return {mode:m[1],type:m[2],sha:m[3],name:m[4]};}).filter(e=>e.name!=='README.md'):[];
 }
 const sha=git(['hash-object','-w',file]),kept=retainedEntries(entries,{mode:'100644',type:'blob',sha,name});
 const readme='# DMS encrypted backups\n\nOnly encrypted database and rules snapshots are stored here.\nThe private 64-character recovery key is required to open them.\nKeep a copy of the key offline. No credentials or plaintext data belong in this branch.\n\nLatest snapshots (UTC filenames):\n'+kept.map(e=>'* '+e.name).join('\n')+'\n\nThe latest seven successful snapshots are retained in this branch view. Old Git objects may remain recoverable until GitHub garbage collection; they remain encrypted.\n';
 const readmeSha=git(['hash-object','-w','--stdin'],readme);
 const tree=git(['mktree'],kept.map(e=>'100644 blob '+e.sha+'\t'+e.name+'\n').join('')+'100644 blob '+readmeSha+'\tREADME.md\n');
 // A new root commit bounds visible backup history. Lease protects concurrent writes.
 const commit=git(['-c','user.name=DMS Backup','-c','user.email=backup@users.noreply.github.com','commit-tree',tree], 'Encrypted DMS snapshot '+name+'\n');
 git(['push','--force-with-lease=refs/heads/'+BRANCH+':'+old,'origin',commit+':refs/heads/'+BRANCH]);return {count:kept.length,commit};
}
export async function runBackup(env=process.env){
 keyBytes(env.DMS_BACKUP_KEY);if(!/^[a-f0-9]{64}$/.test(String(env.DMS_BACKUP_TOKEN||'')))throw Error('Configure both backup secrets before running');
 if(env.DMS_BACKUP_KEY===env.DMS_BACKUP_TOKEN)throw Error('Export token and recovery key must be different');
 const data=await fetchExport('data',env.DMS_BACKUP_TOKEN),rules=await fetchExport('rules',env.DMS_BACKUP_TOKEN);
 const snapshot=validateSnapshot({project:PROJECT,createdAt:new Date().toISOString(),data,rules}),encrypted=encryptSnapshot(snapshot,env.DMS_BACKUP_KEY);
 // Verify full decrypt+decompress+parse before the upload or retention operation.
 const verified=decryptSnapshot(encrypted,env.DMS_BACKUP_KEY);if(verified.createdAt!==snapshot.createdAt)throw Error('Backup verification failed');
 const name='DMS_FULL_'+snapshot.createdAt.replace(/[:.]/g,'-')+'.dmsbackup';mkdirSync('.dms-backup-private',{recursive:true,mode:0o700});
 const file='.dms-backup-private/'+name;writeFileSync(file,encrypted,{mode:0o600});const result=persistBackup(file,name);
 return {name,bytes:encrypted.length,sha256:createHash('sha256').update(encrypted).digest('hex'),count:result.count};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 runBackup().then(r=>console.log('Encrypted backup verified and saved. Snapshots: '+r.count+'; encrypted bytes: '+r.bytes)).catch(()=>{console.error('Backup failed. Check configuration, Worker deployment, Firebase quota, size limits and repository permissions. Existing backups were not replaced.');process.exitCode=1;});
}
