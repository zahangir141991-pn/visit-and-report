(function(g){
'use strict';
const el=id=>document.getElementById(id),fmt=n=>Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
const colors={blue:'#0cadd3',orange:'#f5a043',muted:'#7e92a2',grid:'#eaf0f5'};
function model(s,data){
 const rows=s.latest?data.history?.[s.latest.date]||{}:{};
 const ranking=Object.entries(data.targets||{}).map(([dso,target])=>({dso,target,actual:Number.isFinite(rows[dso])?rows[dso]:null})).map(r=>({...r,pct:r.actual!==null&&r.target>0?r.actual/r.target*100:null})).sort((a,b)=>(b.pct??-Infinity)-(a.pct??-Infinity)||a.dso.localeCompare(b.dso));
 const movement=s.points.slice(1).map((p,i)=>({date:p.date,from:s.points[i].date,amount:p.amount-s.points[i].amount}));
 return {ranking,movement,achieved:s.latest?.amount??null,remaining:s.latest?Math.max(0,s.total-s.latest.amount):null,pct:s.pct};
}
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function empty(box,message){if(box){box.replaceChildren(node('p','executive-empty',message));}}
function svgBox(box,label){box.replaceChildren();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 230');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);box.append(svg);return (tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;};}
function compact(n){const a=Math.abs(n);return a>=1e7?(n/1e7).toFixed(1)+' Cr':a>=1e5?(n/1e5).toFixed(1)+' L':a>=1e3?(n/1e3).toFixed(0)+'K':String(Math.round(n));}
function cumulative(s){const box=el('target-chart');if(!box)return;if(!s.latest)return empty(box,'No complete Morning Report for this selection.');const add=svgBox(box,'Cumulative achievement and target pace by day'),max=Math.max(s.total,...s.points.map(p=>p.amount),1),x=d=>54+d/s.days*518,y=v=>193-v/max*157;
 for(let i=0;i<5;i++){const v=max*i/4;add('line',{x1:54,x2:578,y1:y(v),y2:y(v),stroke:colors.grid});add('text',{x:46,y:y(v)+4,'text-anchor':'end',fill:colors.muted,'font-size':11},compact(v));}
 const width=Math.max(2,Math.min(12,340/s.points.length));for(const p of s.points){const r=add('rect',{x:x(p.day)-width/2,y:y(p.amount),width,height:Math.max(0,193-y(p.amount)),rx:2,fill:colors.blue,opacity:.6});r.append(document.createElementNS('http://www.w3.org/2000/svg','title'));r.lastChild.textContent=p.date+': '+fmt(p.amount);}
 add('path',{d:'M '+x(0)+' '+y(0)+' L '+x(s.days)+' '+y(s.total),fill:'none',stroke:colors.orange,'stroke-width':2,'stroke-dasharray':'5 4'});
 add('polyline',{points:s.points.map(p=>x(p.day)+','+y(p.amount)).join(' '),fill:'none',stroke:colors.blue,'stroke-width':2.5});for(const p of s.points)add('circle',{cx:x(p.day),cy:y(p.amount),r:3,fill:colors.blue});for(const d of [1,Math.ceil(s.days/2),s.days])add('text',{x:x(d),y:217,'text-anchor':'middle',fill:colors.muted,'font-size':11},'Day '+d);
}
function render(s,data,metric){const m=model(s,data);cumulative(s);const rank=el('executive-dso-chart'),coverage=el('executive-coverage'),movement=el('executive-movement');if(!rank||!coverage||!movement)return;
 if(!s.latest||!s.total){empty(rank,'No complete report for this scope.');empty(coverage,'Target and achievement data are needed.');empty(movement,'At least two complete reports are needed.');return;}
 rank.replaceChildren();for(const r of m.ranking){const row=node('div','executive-rank'),label=node('div','executive-rank-label');label.append(node('span','', 'DSO '+r.dso),node('b','',r.pct===null?'—':r.pct.toFixed(1)+'%'));const track=node('div','executive-track'),bar=node('i');bar.style.width=Math.min(100,Math.max(0,r.pct||0))+'%';track.append(bar);row.append(label,track,node('small','',(r.actual===null?'—':fmt(r.actual))+' / '+fmt(r.target)));rank.append(row);}
 coverage.replaceChildren();const ring=node('div','executive-donut');const percent=Math.min(100,Math.max(0,m.pct||0));ring.style.background='conic-gradient(#0dacce '+percent+'%, #e4edf3 0)';const center=node('div');center.append(node('b','',(m.pct||0).toFixed(1)+'%'),node('small','','achieved'));ring.append(center);const key=node('div','executive-coverage-key');for(const [label,value]of [['Achieved',m.achieved],['Remaining',m.remaining]]){const p=node('p','',label);p.append(node('strong','',fmt(value)));key.append(p);}coverage.append(ring,key);
 if(!m.movement.length){empty(movement,'At least two complete reports are needed.');return;}
 const add=svgBox(movement,'Changes between consecutive reported cumulative achievements'),points=m.movement.slice(-15),min=Math.min(0,...points.map(p=>p.amount)),max=Math.max(0,...points.map(p=>p.amount),1),y=v=>190-(v-min)/(max-min)*150,step=518/points.length;
 for(let i=0;i<4;i++){const v=min+(max-min)*i/3;add('line',{x1:54,x2:578,y1:y(v),y2:y(v),stroke:colors.grid});add('text',{x:46,y:y(v)+4,'text-anchor':'end',fill:colors.muted,'font-size':11},compact(v));}
 points.forEach((p,i)=>{const x=54+step*i+step*.2,r=add('rect',{x,y:Math.min(y(0),y(p.amount)),width:step*.6,height:Math.max(1,Math.abs(y(p.amount)-y(0))),rx:3,fill:p.amount<0?'#df6575':colors.orange});const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=p.from+' → '+p.date+': '+fmt(p.amount)+(metric==='five'?' Uddokta':' BDT');r.append(title);if(points.length<=7||i%3===0||i===points.length-1)add('text',{x:x+step*.3,y:216,'text-anchor':'middle',fill:colors.muted,'font-size':10},p.date.slice(8)+'/'+p.date.slice(5,7));});
}
function clear(){for(const id of ['executive-dso-chart','executive-coverage','executive-movement'])empty(el(id),'Waiting for report data.');}
g.DmsExecutive={model,render,clear};
})(globalThis);
