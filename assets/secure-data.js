/* Read adapter: private reads always use the authenticated server scope.
   Writes still use Firebase, whose rules independently enforce ownership. */
(function(global){
 const roots=new Set(['uddokta_master','uddokta_master_meta','morning_report_current','afternoon_report_current','visit_reports','visit_reports_index','visit_notices','new_uddokta_kyc','visit_report_photos','new_uddokta_kyc_photos','dss_dso_assignments_common']);
 const handles=()=>new Set();
 function snapshot(value,key=null){return {key,val:()=>value??null,exists:()=>value!=null,numChildren:()=>Object.keys(value||{}).length,child:path=>snapshot(String(path).split('/').reduce((v,p)=>v?.[p],value),String(path).split('/').pop()),forEach:fn=>{for(const [k,v]of Object.entries(value||{}))if(fn(snapshot(v,k))===true)return true;return false;}};}
 function select(data,q){if(!q.order)return data;let rows=Object.entries(data||{});const val=([k,v])=>q.order==='$key'?k:q.order.split('/').reduce((x,p)=>x?.[p],v)??null;rows.sort((a,b)=>val(a)<val(b)?-1:val(a)>val(b)?1:a[0].localeCompare(b[0]));if('equal'in q)rows=rows.filter(r=>val(r)===q.equal);if('start'in q)rows=rows.filter(r=>val(r)>=q.start);if('end'in q)rows=rows.filter(r=>val(r)<=q.end);if(q.first)rows=rows.slice(0,q.first);if(q.last)rows=rows.slice(-q.last);return Object.fromEntries(rows);}
 function database(native,request){const subscriptions=handles();
  function ref(path='',q={}){path=String(path).replace(/^\/+|\/+$/g,'');if(!roots.has(path.split('/')[0]))return native.ref(path);
   const target=native.ref(path),own=new Set();const result={
    child:p=>ref(path+'/'+p,q),get key(){return path.split('/').pop();},toString:()=>target.toString(),
    orderByChild:order=>ref(path,{...q,order}),orderByKey:()=>ref(path,{...q,order:'$key'}),equalTo:equal=>ref(path,{...q,equal}),startAt:start=>ref(path,{...q,start}),endAt:end=>ref(path,{...q,end}),limitToFirst:first=>ref(path,{...q,first,order:q.order||'$key'}),limitToLast:last=>ref(path,{...q,last,order:q.order||'$key'}),
    once:async(event,ok,fail)=>{try{if(event!=='value')throw Error('Unsupported scoped event');const value=snapshot(select(await request(path),q),result.key);ok?.(value);return value;}catch(e){fail?.(e);throw e;}},
    on:(event,callback,fail)=>{if(event!=='value')throw Error('Unsupported scoped event');const h={active:true,timer:null};own.add(h);subscriptions.add(h);let previous;const poll=async()=>{try{const value=select(await request(path),q),encoded=JSON.stringify(value);if(h.active&&encoded!==previous){previous=encoded;callback(snapshot(value,result.key));}}catch(e){if(h.active)fail?.(e);}finally{if(h.active)h.timer=setTimeout(poll,15000);}};h.callback=callback;poll();return callback;},
    off:(event,callback)=>{for(const h of own)if(!callback||h.callback===callback){h.active=false;clearTimeout(h.timer);subscriptions.delete(h);own.delete(h);}},
   };for(const method of ['set','update','push','transaction','onDisconnect'])result[method]=(...args)=>target[method](...args);return result;
  }
  return {ref,goOffline:()=>native.goOffline(),goOnline:()=>native.goOnline(),stopScopedReads:()=>{for(const h of subscriptions){h.active=false;clearTimeout(h.timer);}subscriptions.clear();}};
 }
 global.DmsSecureData={database,isPrivate:path=>roots.has(String(path).split('/')[0]),snapshot,select};
})(globalThis);
