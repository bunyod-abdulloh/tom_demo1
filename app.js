/* ============================================================
     TELEGRAM WEBAPP
============================================================ */
let tgApp=null;
try{
if(window.Telegram&&window.Telegram.WebApp){
  tgApp=window.Telegram.WebApp;
  tgApp.ready();
  if(tgApp.expand)tgApp.expand();
  if(tgApp.disableVerticalSwipes)tgApp.disableVerticalSwipes();
  if(tgApp.setHeaderColor)tgApp.setHeaderColor('#070d18');
  if(tgApp.setBackgroundColor)tgApp.setBackgroundColor('#070d18');
  /* In Telegram: hide external phone CTA */
  const cta=document.getElementById('hdr-cta');
  if(cta)cta.style.display='none';
}
}catch(e){}
function haptic(t){try{if(tgApp&&tgApp.HapticFeedback)tgApp.HapticFeedback[t]?.()}catch(e){}}

/* ============================================================
 PAGE NAV
============================================================ */
function goPage(p){
document.querySelectorAll('.page').forEach(el=>{el.classList.remove('active')});
document.getElementById('pg-'+p).classList.add('active');
document.querySelectorAll('.nav-t').forEach(t=>t.classList.toggle('active',t.dataset.p===p));
if(p==='calc')requestAnimationFrame(()=>{initCv();redraw()});
haptic('selectionChanged');
}

/* ============================================================
 PANEL TABS
============================================================ */
function rpTab(t){
document.querySelectorAll('.rpt').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
document.querySelectorAll('.rpn').forEach(p=>p.classList.toggle('vis',p.dataset.t===t));
haptic('selectionChanged');
}

/* ============================================================
 STATE
============================================================ */
const G=40,CD=18,HR=9,ALP='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SC=['#2EAC66','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#06b6d4'];
let shapes=[],cur=null,mode='draw',snap=true,sel=null;
let hovA=null,hovP=null,drg=null,ms={x:0,y:0},dirty=true;
const V={s:1,tx:0,ty:0,mn:.07,mx:14};
const ptrs=new Map();let pinch=null;
const cv=document.getElementById('cv'),cx=cv.getContext('2d');

/* Config */
const cfg={roof:'gable',pitch:2.5,type:'C8',thick:'0.40',country:'russia',color:'3005'};
const PRICES={china:{0.35:42000,0.40:48000,0.45:54000,0.50:60000,0.55:67000,0.60:74000,0.70:88000},russia:{0.35:55000,0.40:62000,0.45:70000,0.50:78000,0.55:86000,0.60:95000,0.70:112000},korea:{0.35:58000,0.40:66000,0.45:74000,0.50:83000,0.55:92000,0.60:102000,0.70:120000},kazakhstan:{0.35:45000,0.40:52000,0.45:58000,0.50:65000,0.55:72000,0.60:80000,0.70:95000}};
const TMUL={C8:1,C10:1.02,C20:1.08,C21:1.10,HC35:1.18,HC44:1.25,H57:1.32,H60:1.38,H75:1.48};
const RMUL={flat:1.0,shed:1.15,gable:1.22,hip:1.30,pyramid:1.28,mansard:1.45};
const RAL=[
{c:'1014',n:"Sarg'ish",h:'#E1CC4F'},{c:'1015',n:"Och sarg'ish",h:'#E6D690'},
{c:'2004',n:"To'q sariq",h:'#E75B12'},{c:'3003',n:'Yoqut qizil',h:'#8D1D2C'},
{c:'3005',n:"Qizil-to'q",h:'#5E2028'},{c:'3009',n:'Oksid qizil',h:'#6D342D'},
{c:'3011',n:'Qizil-jigarrang',h:'#792423'},{c:'5002',n:"Ko'k",h:'#00387B'},
{c:'5005',n:"Signal ko'k",h:'#154889'},{c:'5021',n:"Suv ko'k",h:'#07737A'},
{c:'6002',n:'Yashil',h:'#325928'},{c:'6005',n:"Yashil-to'q",h:'#0F4336'},
{c:'6020',n:'Xrom yashil',h:'#37422F'},{c:'7004',n:'Signal kulrang',h:'#9EA0A1'},
{c:'7024',n:'Grafit',h:'#474A50'},{c:'7035',n:'Och kulrang',h:'#CBD0CC'},
{c:'8004',n:'Mis jigarrang',h:'#8D4931'},{c:'8017',n:'Shokolad',h:'#44322D'},
{c:'9002',n:'Oq-kulrang',h:'#E0DDD4'},{c:'9003',n:'Signal oq',h:'#F4F4F4'},
{c:'9005',n:'Qora',h:'#0A0A0D'},{c:'9006',n:'Oq alyuminiy',h:'#A5A8A6'},
];
const PROJ=[
{t:'Chorsu turar-joy',d:'4 qavatli turar-joy binosiga HC-35 profnastil bilan tom yopildi.',a:'1 200 m²',tp:'HC-35',cl:'#5E2028',y:'2024'},
{t:'Toshkent 32-maktab',d:'Maktab binosiga yangi tom yopish ishlari bajarildi.',a:'2 400 m²',tp:'H-60',cl:'#154889',y:'2024'},
{t:'Chilonzor savdo markazi',d:'Savdo markazi uchun mansard tipidagi tom loyihasi.',a:'3 200 m²',tp:'H-75',cl:'#474A50',y:'2023'},
{t:'Samarqand mehmonxonasi',d:'5 yulduzli mehmonxona uchun premium tom qoplama.',a:'1 800 m²',tp:'HC-44',cl:'#44322D',y:'2023'},
{t:"Farg'ona sanoat binosi",d:'Zavodning ishlab chiqarish sehi uchun tom yopish.',a:'5 600 m²',tp:'H-75',cl:'#A5A8A6',y:'2023'},
{t:'Namangan turar-joy',d:'120 ta xonadonlik yangi turar-joy majmuasi.',a:'4 200 m²',tp:'C-21',cl:'#325928',y:'2022'},
];

/* ============================================================
 SELECTORS
============================================================ */
function setPT(el){document.querySelectorAll('#pt-type .pp').forEach(b=>b.classList.remove('on'));el.classList.add('on');cfg.type=el.dataset.v;upCost();haptic('impactLight')}
function setTH(el){document.querySelectorAll('#pt-thick .pp').forEach(b=>b.classList.remove('on'));el.classList.add('on');cfg.thick=el.dataset.v;upCost();haptic('impactLight')}
function setCN(el){document.querySelectorAll('#pt-country .pp').forEach(b=>b.classList.remove('on'));el.classList.add('on');cfg.country=el.dataset.v;upCost();haptic('impactLight')}
function setRoof(r){cfg.roof=r;document.querySelectorAll('.rf').forEach(b=>b.classList.toggle('on',b.dataset.r===r));upCost();haptic('impactLight')}
function setPitch(v){
cfg.pitch=parseFloat(v);
document.getElementById('pv').textContent=parseFloat(v).toFixed(1)+' m';
document.getElementById('pf').style.width=((v-.5)/5.5*100)+'%';
upCost();
}
function initColors(){
const g=document.getElementById('cg');
g.innerHTML=RAL.map((c,i)=>`<div class="clr${i===4?' on':''}" style="background:${c.h}" data-i="${i}" onclick="pickClr(${i})"></div>`).join('');
}
function pickClr(i){
document.querySelectorAll('.clr').forEach(c=>c.classList.remove('on'));
document.querySelectorAll('.clr')[i].classList.add('on');
cfg.color=RAL[i].c;
document.getElementById('cp').style.background=RAL[i].h;
document.getElementById('cc').textContent='RAL '+RAL[i].c;
document.getElementById('cn').textContent=RAL[i].n;
haptic('selectionChanged');
}
function initPortfolio(){
document.getElementById('pgrid').innerHTML=PROJ.map(p=>`<div class="pcard"><div class="pc-img"><div class="pc-img-bg" style="background:linear-gradient(135deg,${p.cl} 0%,#060c16 100%)"></div><span class="pc-badge">${p.tp}</span></div><div class="pc-info"><h3>${p.t}</h3><p>${p.d}</p><div class="pc-meta"><span><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.1"/></svg>${p.a}</span><span><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.1"/><path d="M6 3V6H9" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>${p.y}</span></div></div></div>`).join('');
}

/* ============================================================
 MATH
============================================================ */
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function hrgb(h){const x=h.replace('#','');const f=x.length===3?x.split('').map(c=>c+c).join(''):x;const n=parseInt(f,16);return{r:(n>>16)&255,g:(n>>8)&255,b:n&255}}
function rgba(h,a){const c=hrgb(h);return`rgba(${c.r},${c.g},${c.b},${a})`}
function normA(a){return((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI)}
function betCCW(a,s,e){a=normA(a);s=normA(s);e=normA(e);return s<=e?(a>=s&&a<=e):(a>=s||a<=e)}
function pD(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function pM(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2}}

/* ── View ── */
function s2w(sx,sy){return{x:(sx-V.tx)/V.s,y:(sy-V.ty)/V.s}}
function zoomAt(f,sx,sy){const ns=clamp(V.s*f,V.mn,V.mx);if(ns===V.s)return;const r=ns/V.s;V.tx=sx-r*(sx-V.tx);V.ty=sy-r*(sy-V.ty);V.s=ns;render()}
function resetView(){V.s=1;V.tx=0;V.ty=0;render()}
function vc(){return s2w(cv.width/2,cv.height/2)}
function csp(e){const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function ahr(){return(HR+4)/V.s}function phr(){return 12/V.s}function cdw(){return CD/V.s}

/* ── Arc ── */
function arcG(x1,y1,x2,y2,b){
if(Math.abs(b)<.5)return null;
const mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,ln=Math.hypot(dx,dy);if(ln<1)return null;
const px=-dy/ln,py=dx/ln,ax=mx+b*px,ay=my+b*py;
const D=2*(x1*(ay-y2)+ax*(y2-y1)+x2*(y1-ay));if(Math.abs(D)<.001)return null;
const ccx=((x1*x1+y1*y1)*(ay-y2)+(ax*ax+ay*ay)*(y2-y1)+(x2*x2+y2*y2)*(y1-ay))/D;
const ccy=((x1*x1+y1*y1)*(x2-ax)+(ax*ax+ay*ay)*(x1-x2)+(x2*x2+y2*y2)*(ax-x1))/D;
const r=Math.hypot(x1-ccx,y1-ccy),sa=Math.atan2(y1-ccy,x1-ccx),ea=Math.atan2(y2-ccy,x2-ccx),ap=Math.atan2(ay-ccy,ax-ccx);
const acw=!betCCW(ap,sa,ea),span=acw?normA(sa-ea):normA(ea-sa);
return{cx:ccx,cy:ccy,r,sa,ea,acw,span};
}
function aLen(x1,y1,x2,y2,b){const a=arcG(x1,y1,x2,y2,b);return a?a.r*a.span:Math.hypot(x2-x1,y2-y1)}
function hPos(x1,y1,x2,y2,b){const dx=x2-x1,dy=y2-y1,l=Math.hypot(dx,dy)||1;return{x:(x1+x2)/2+b*(-dy/l),y:(y1+y2)/2+b*(dx/l)}}
function pOff(x1,y1,x2,y2,mx,my){const dx=x2-x1,dy=y2-y1,l=Math.hypot(dx,dy)||1;return(mx-(x1+x2)/2)*(-dy/l)+(my-(y1+y2)/2)*(dx/l)}
function sPoly(sh,n=24){
const o=[];for(let i=0;i<sh.pts.length;i++){const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
  if(Math.abs(b)<.5)o.push({x:sh.pts[i].x,y:sh.pts[i].y});
  else{const a=arcG(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b);if(!a){o.push({x:sh.pts[i].x,y:sh.pts[i].y});continue}
    const d=a.acw?-1:1;for(let k=0;k<n;k++){const ang=a.sa+d*a.span*(k/n);o.push({x:a.cx+a.r*Math.cos(ang),y:a.cy+a.r*Math.sin(ang)})}}
}return o;
}
function sArea(sh){if(!sh.closed||sh.pts.length<3)return 0;const a=sPoly(sh,32);let s=0;for(let i=0;i<a.length;i++){const j=(i+1)%a.length;s+=a[i].x*a[j].y-a[j].x*a[i].y}return Math.abs(s)/2}
function ptIn(x,y,sh){if(!sh.closed||sh.pts.length<3)return false;const a=sPoly(sh,18);let ins=false;for(let i=0,j=a.length-1;i<a.length;j=i++){const xi=a[i].x,yi=a[i].y,xj=a[j].x,yj=a[j].y;if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)ins=!ins}return ins}
function topAt(x,y){for(let i=shapes.length-1;i>=0;i--)if(ptIn(x,y,shapes[i]))return i;return null}

/* ============================================================
 CANVAS
============================================================ */
function initCv(){
const w=document.getElementById('cwrap'),dpr=devicePixelRatio||1;
cv.width=Math.max(1,Math.floor(w.clientWidth*dpr));cv.height=Math.max(1,Math.floor(w.clientHeight*dpr));
cv.style.width=w.clientWidth+'px';cv.style.height=w.clientHeight+'px';cx.scale(dpr,dpr);
}
function sync(){render();upCost();upHint()}
function redraw(){sync();if(dirty){dirty=false;upDims()}}

function render(){
const dpr=devicePixelRatio||1,w=cv.width/dpr,h=cv.height/dpr;
cx.clearRect(0,0,w,h);cx.save();cx.setTransform(V.s,0,0,V.s,V.tx,V.ty);
drawGrid(w,h);shapes.forEach((sh,i)=>drawSh(sh,i,mode==='edit'&&sel===i));
if(cur)drawCur();cx.restore();
}
function drawGrid(cw,ch){
const s=V.s,lw=1/s;
const gx0=Math.floor((-V.tx/s)/G)*G,gy0=Math.floor((-V.ty/s)/G)*G;
const gx1=Math.ceil(((cw-V.tx)/s)/G)*G,gy1=Math.ceil(((ch-V.ty)/s)/G)*G;
for(let x=gx0;x<=gx1;x+=G){cx.strokeStyle=(x/G)%5===0?'rgba(46,172,102,.12)':'rgba(46,172,102,.03)';cx.lineWidth=lw;cx.beginPath();cx.moveTo(x,gy0);cx.lineTo(x,gy1);cx.stroke()}
for(let y=gy0;y<=gy1;y+=G){cx.strokeStyle=(y/G)%5===0?'rgba(46,172,102,.12)':'rgba(46,172,102,.03)';cx.lineWidth=lw;cx.beginPath();cx.moveTo(gx0,y);cx.lineTo(gx1,y);cx.stroke()}
cx.fillStyle='rgba(46,172,102,.18)';cx.font=`${8/s}px "JetBrains Mono",monospace`;
for(let x=Math.ceil(gx0/G/5)*G*5;x<=gx1;x+=G*5)cx.fillText((x/G)+'m',x+2/s,gy0+10/s);
for(let y=Math.ceil(gy0/G/5)*G*5;y<=gy1;y+=G*5)cx.fillText((y/G)+'m',gx0+2/s,y-2/s);
}

function bPath(sh){
cx.beginPath();for(let i=0;i<sh.pts.length;i++){const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
  if(i===0)cx.moveTo(sh.pts[0].x,sh.pts[0].y);
  if(Math.abs(b)<.5)cx.lineTo(sh.pts[j].x,sh.pts[j].y);
  else{const a=arcG(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b);if(a)cx.arc(a.cx,a.cy,a.r,a.sa,a.ea,a.acw);else cx.lineTo(sh.pts[j].x,sh.pts[j].y)}}
if(sh.closed)cx.closePath();
}
function drawSh(sh,si,isSel){
const s=V.s,col=isSel?'#2EAC66':SC[si%SC.length];
bPath(sh);cx.fillStyle=isSel?'rgba(46,172,102,.07)':'rgba(27,55,100,.05)';cx.fill();
cx.strokeStyle=col;cx.lineWidth=(isSel?2.5:1.8)/s;cx.setLineDash([]);bPath(sh);cx.stroke();
/* points */
sh.pts.forEach((p,i)=>{cx.beginPath();cx.arc(p.x,p.y,5/s,0,Math.PI*2);cx.fillStyle=col;cx.fill();cx.strokeStyle='#070d18';cx.lineWidth=1.5/s;cx.stroke();cx.fillStyle=col;cx.font=`600 ${10/s}px "JetBrains Mono",monospace`;cx.fillText(ALP[i]+(si+1),p.x+7/s,p.y-7/s)});
/* labels */
sh.pts.forEach((p,i)=>{
  const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0,hp=hPos(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b);
  const vl=(aLen(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b)/G).toFixed(2),ml=sh.lens[i]!=null?sh.lens[i]:vl,txt=ml+'m';
  cx.font=`500 ${9/s}px "JetBrains Mono",monospace`;const tw=cx.measureText(txt).width;
  cx.fillStyle=b?'rgba(90,50,120,.85)':'rgba(7,13,24,.85)';cx.beginPath();cx.roundRect(hp.x-tw/2-5/s,hp.y-21/s,tw+10/s,16/s,4/s);cx.fill();
  cx.strokeStyle=b?'rgba(139,92,246,.2)':'rgba(46,172,102,.12)';cx.lineWidth=.8/s;cx.stroke();
  cx.fillStyle=b?'#8b5cf6':'#94a3b8';cx.fillText(txt,hp.x-tw/2,hp.y-10/s);
});
if(isSel){
  sh.pts.forEach((p,i)=>{const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0,hp=hPos(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b);const hv=hovA&&hovA.si===si&&hovA.seg===i;cx.beginPath();cx.arc(hp.x,hp.y,(hv?HR+2:HR)/s,0,Math.PI*2);cx.fillStyle=hv?'#2EAC66':(b?'rgba(139,92,246,.8)':'rgba(27,55,100,.8)');cx.fill();cx.strokeStyle='#070d18';cx.lineWidth=2/s;cx.stroke();cx.fillStyle='#fff';cx.font=`bold ${9/s}px "Plus Jakarta Sans",sans-serif`;cx.textAlign='center';cx.textBaseline='middle';cx.fillText('\u2322',hp.x,hp.y+1/s);cx.textAlign='left';cx.textBaseline='alphabetic'});
  sh.pts.forEach((p,i)=>{if(hovP&&hovP.si===si&&hovP.pi===i){cx.beginPath();cx.arc(p.x,p.y,12/s,0,Math.PI*2);cx.strokeStyle='rgba(46,172,102,.45)';cx.lineWidth=2/s;cx.stroke()}});
}
}
function drawCur(){
const p=cur.pts;if(!p.length)return;const s=V.s;
cx.strokeStyle='#2EAC66';cx.lineWidth=2/s;cx.setLineDash([5/s,4/s]);cx.beginPath();cx.moveTo(p[0].x,p[0].y);p.forEach((pt,i)=>{if(i)cx.lineTo(pt.x,pt.y)});cx.lineTo(ms.x,ms.y);cx.stroke();cx.setLineDash([]);
if(p.length>2&&Math.hypot(p[0].x-ms.x,p[0].y-ms.y)<cdw()){cx.beginPath();cx.arc(p[0].x,p[0].y,cdw(),0,Math.PI*2);cx.strokeStyle='rgba(46,172,102,.35)';cx.lineWidth=2/s;cx.setLineDash([3/s,3/s]);cx.stroke();cx.setLineDash([])}
p.forEach((pt,i)=>{cx.beginPath();cx.arc(pt.x,pt.y,5/s,0,Math.PI*2);cx.fillStyle=i===0?'#2EAC66':'#3b82f6';cx.fill();cx.strokeStyle='#070d18';cx.lineWidth=1.5/s;cx.stroke();cx.fillStyle=i===0?'#2EAC66':'#3b82f6';cx.font=`600 ${10/s}px "JetBrains Mono",monospace`;cx.fillText(ALP[i],pt.x+7/s,pt.y-7/s)});
}

/* ============================================================
 CANVAS EVENTS
============================================================ */
cv.addEventListener('wheel',e=>{e.preventDefault();const sp=csp(e);zoomAt(e.deltaY<0?1.14:1/1.14,sp.x,sp.y)},{passive:false});
cv.addEventListener('pointerdown',e=>{
e.preventDefault();try{cv.setPointerCapture(e.pointerId)}catch(x){}
const sp=csp(e);ptrs.set(e.pointerId,sp);
if(ptrs.size>=2){drg=null;const ps=[...ptrs.values()];pinch={d0:pD(ps[0],ps[1]),s0:V.s,tx0:V.tx,ty0:V.ty,m0:pM(ps[0],ps[1])};return}
pinch=null;const w=s2w(sp.x,sp.y);
if(mode==='edit'){
  if(sel!=null){const sh=shapes[sel];
    for(let i=0;i<sh.pts.length;i++){const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0,hp=hPos(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b);if(Math.hypot(hp.x-w.x,hp.y-w.y)<ahr()){drg={t:'arc',si:sel,seg:i};cv.style.cursor='grabbing';return}}
    for(let i=0;i<sh.pts.length;i++){if(Math.hypot(sh.pts[i].x-w.x,sh.pts[i].y-w.y)<phr()){drg={t:'pt',si:sel,pi:i};cv.style.cursor='grabbing';return}}
  }
  const hit=topAt(w.x,w.y);if(hit!=null){sel=hit;dirty=true;upDims();render();drg={t:'sh',si:hit,sx:w.x,sy:w.y,orig:shapes[hit].pts.map(p=>({x:p.x,y:p.y}))};cv.style.cursor='grabbing';haptic('impactLight');return}
  sel=null;dirty=true;redraw();return;
}
if(mode==='draw'){
  if(!cur)cur={pts:[],segs:[],lens:[],closed:false};
  const wx=snap?Math.round(w.x/G)*G:w.x,wy=snap?Math.round(w.y/G)*G:w.y;
  if(cur.pts.length>2&&Math.hypot(cur.pts[0].x-wx,cur.pts[0].y-wy)<cdw()){closeSh();return}
  cur.pts.push({x:wx,y:wy});cur.segs.push({type:'line',bulge:0});cur.lens.push(null);upHint();render();haptic('impactLight');
}
});
cv.addEventListener('pointermove',e=>{
const sp=csp(e);if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,sp);
if(ptrs.size===2&&pinch){const ps=[...ptrs.values()],d=pD(ps[0],ps[1]),m=pM(ps[0],ps[1]);const f=d/pinch.d0;const ns=clamp(pinch.s0*f,V.mn,V.mx);const r=ns/pinch.s0;V.tx=pinch.m0.x-r*(pinch.m0.x-pinch.tx0)+(m.x-pinch.m0.x);V.ty=pinch.m0.y-r*(pinch.m0.y-pinch.ty0)+(m.y-pinch.m0.y);V.s=ns;render();return}
const w=s2w(sp.x,sp.y);ms={x:snap&&mode==='draw'?Math.round(w.x/G)*G:w.x,y:snap&&mode==='draw'?Math.round(w.y/G)*G:w.y};
if(drg){doDrag(w.x,w.y);return}
if(mode==='edit'){hovA=null;hovP=null;if(sel!=null){const sh=shapes[sel];for(let i=0;i<sh.pts.length;i++){const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0,hp=hPos(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b);if(Math.hypot(hp.x-w.x,hp.y-w.y)<ahr()){hovA={si:sel,seg:i};cv.style.cursor='grab';render();return}}for(let i=0;i<sh.pts.length;i++){if(Math.hypot(sh.pts[i].x-w.x,sh.pts[i].y-w.y)<phr()){hovP={si:sel,pi:i};cv.style.cursor='move';render();return}}if(ptIn(w.x,w.y,sh)){cv.style.cursor='grab';render();return}}cv.style.cursor='default'}
render();
});
function ptrUp(e){ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;if(ptrs.size===0&&drg){drg=null;cv.style.cursor=mode==='draw'?'crosshair':'default';dirty=true;redraw()}}
cv.addEventListener('pointerup',ptrUp);cv.addEventListener('pointercancel',ptrUp);

function doDrag(wx,wy){
if(!drg)return;
if(drg.t==='arc'){const sh=shapes[drg.si],i=drg.seg,j=(i+1)%sh.pts.length;const b=pOff(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,wx,wy);const ch=Math.hypot(sh.pts[j].x-sh.pts[i].x,sh.pts[j].y-sh.pts[i].y);const cl=clamp(b,-ch*.75,ch*.75);sh.segs[i]=Math.abs(cl)<6?{type:'line',bulge:0}:{type:'arc',bulge:cl};sh.lens[i]=parseFloat((aLen(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,sh.segs[i].bulge||0)/G).toFixed(2));sync();return}
if(drg.t==='pt'){const sh=shapes[drg.si],x=snap?Math.round(wx/G)*G:wx,y=snap?Math.round(wy/G)*G:wy;sh.pts[drg.pi]={x,y};const n=sh.pts.length;for(const idx of[drg.pi,(drg.pi-1+n)%n]){const j=(idx+1)%n;sh.lens[idx]=parseFloat((aLen(sh.pts[idx].x,sh.pts[idx].y,sh.pts[j].x,sh.pts[j].y,sh.segs[idx].bulge||0)/G).toFixed(2))}sync();return}
if(drg.t==='sh'){const sh=shapes[drg.si];let dx=wx-drg.sx,dy=wy-drg.sy;if(snap){dx=Math.round(dx/G)*G;dy=Math.round(dy/G)*G}for(let i=0;i<sh.pts.length;i++){sh.pts[i].x=drg.orig[i].x+dx;sh.pts[i].y=drg.orig[i].y+dy}sync()}
}

/* ============================================================
 ACTIONS
============================================================ */
function setMode(m){mode=m;document.getElementById('b-draw').classList.toggle('on',m==='draw');document.getElementById('b-edit').classList.toggle('on',m==='edit');cv.style.cursor=m==='draw'?'crosshair':'default';dirty=true;redraw();haptic('selectionChanged')}
function toggleSnap(){snap=!snap;document.getElementById('b-snap').classList.toggle('on',snap);haptic('impactLight')}
function undoAction(){if(mode==='draw'&&cur){if(cur.pts.length>0){cur.pts.pop();cur.segs.pop();cur.lens.pop()}else cur=null}else if(shapes.length>0){shapes.pop();if(sel!=null&&sel>=shapes.length)sel=shapes.length-1;if(!shapes.length)sel=null}dirty=true;redraw();haptic('impactMedium')}
function newShape(){cur=null;sel=null;setMode('draw');haptic('impactLight')}
function resetAll(){shapes=[];cur=null;sel=null;setMode('draw');dirty=true;redraw();haptic('notificationWarning')}
function delSh(i){shapes.splice(i,1);if(sel!=null){if(sel>=shapes.length)sel=shapes.length-1;if(sel<0)sel=null}dirty=true;redraw();haptic('impactMedium')}
function closeSh(){if(!cur||cur.pts.length<3)return;cur.closed=true;cur.lens=cur.pts.map((p,i)=>{const j=(i+1)%cur.pts.length;return parseFloat((aLen(p.x,p.y,cur.pts[j].x,cur.pts[j].y,cur.segs[i].bulge||0)/G).toFixed(2))});shapes.push(cur);cur=null;sel=shapes.length-1;setMode('edit');haptic('notificationSuccess')}
function upHint(){const h=document.getElementById('cv-hint');if(h)h.classList.toggle('hidden',shapes.length>0||(cur&&cur.pts.length>0))}

/* ============================================================
 DIMS
============================================================ */
function upDims(){
const el=document.getElementById('dims');
if(!shapes.length){el.innerHTML='<div class="empty"><svg width="44" height="44" viewBox="0 0 44 44" fill="none" opacity=".25"><rect x="4" y="8" width="36" height="28" rx="4" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M16 22H28M22 16V28" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".5"/></svg><p>Shakl chizing yoki<br>tezkor shakl qo\'shing</p></div>';return}
el.innerHTML=shapes.map((sh,si)=>{
  const rows=sh.pts.map((p,i)=>{const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0,vl=(aLen(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b)/G).toFixed(2),ml=sh.lens[i]!=null?sh.lens[i]:vl;const tag=b?'<span class="seg-t arc">EGRI</span>':'<span class="seg-t lin">TO\'G\'RI</span>';return'<div class="seg-r">'+tag+'<span class="seg-l">'+ALP[i]+(si+1)+'–'+ALP[j]+(si+1)+'</span><input class="seg-i" type="number" value="'+ml+'" min="0.01" step="0.1" inputmode="decimal" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()" oninput="setL('+si+','+i+',this.value)"><span class="seg-u">m</span></div>'}).join('');
  return'<div class="sc'+(sel===si?' sel':'')+'" onclick="pickSh('+si+')"><div class="sc-top"><span>◆ SHAKL #'+(si+1)+(sel===si?' ✓':'')+'</span><button class="sc-del" onclick="event.stopPropagation();delSh('+si+')">✕</button></div>'+rows+'</div>'
}).join('');
}
function pickSh(i){sel=i;if(mode!=='edit')setMode('edit');dirty=true;redraw();haptic('selectionChanged')}
function setL(si,i,v){const n=parseFloat(v);if(!isNaN(n)&&n>0){shapes[si].lens[i]=n;render();upCost()}}

/* ============================================================
 COST
============================================================ */
function calcArea(){
let t=0;shapes.forEach(sh=>{if(!sh.closed)return;const va=sArea(sh)/(G*G);let vizP=0,manP=0;
  sh.pts.forEach((p,i)=>{const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0,vis=aLen(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b)/G;vizP+=vis;manP+=(sh.lens[i]!=null?sh.lens[i]:vis)});
  const sc=vizP>0?Math.pow(manP/vizP,2):1;t+=va*sc});
return t*(RMUL[cfg.roof]||1)*(1+(cfg.pitch-.5)*.04);
}
function calcCost(a){return Math.round(a*(PRICES[cfg.country]?.[cfg.thick]||60000)*(TMUL[cfg.type]||1))}
function fmt(n){return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ')}
function upCost(){
const a=calcArea(),c=calcCost(a);
document.getElementById('ra').textContent=a.toFixed(2)+' m²';
document.getElementById('rc').textContent=fmt(c)+' so\'m';
const cn={china:'Xitoy',russia:'Rossiya',korea:'Koreya',kazakhstan:"Qozog'iston"};
document.getElementById('rs').textContent=cfg.type+' · '+cfg.thick+'mm · '+(cn[cfg.country]||cfg.country);
}

/* ============================================================
 INIT
============================================================ */
window.addEventListener('load',()=>{initCv();initColors();initPortfolio();upHint();upCost();redraw()});
window.addEventListener('resize',()=>{if(document.getElementById('pg-calc').classList.contains('active')){initCv();redraw()}});