/* ============================================================
   TELEGRAM WEBAPP INTEGRATION
============================================================ */
try {
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    if (typeof tg.expand === 'function') tg.expand();
    if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
    /* Apply Telegram theme if available */
    if (tg.themeParams) {
      const tp = tg.themeParams;
      if (tp.bg_color) document.documentElement.style.setProperty('--tg-bg', tp.bg_color);
    }
    /* Haptic feedback helper */
    window.haptic = (type) => {
      try { if (tg.HapticFeedback) tg.HapticFeedback[type]?.(); } catch(e){}
    };
  }
} catch(e) {}
if (!window.haptic) window.haptic = () => {};

/* ============================================================
   CONSTANTS & STATE
============================================================ */
const GRID      = 40;
const CLOSE_DIST = 18;
const HANDLE_R   = 9;
const ALP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHC = ['#5b9cf5','#4cce7b','#a78bfa','#f0a04b','#f06b5e','#56d4c8'];
const WALL_H = GRID * 3;

let shapes   = [];
let cur      = null;
let appMode  = 'draw';
let snap     = true;
let selShape = null;
let hovArc   = null;
let hovPt    = null;
let drag     = null;
let mouse    = { x:0, y:0 };
let dimsDirty = true;

/* Mobile tab state */
let activeTab = 'preview';

/* 2D canvas view transform */
const view = { scale:1, tx:0, ty:0, minScale:0.07, maxScale:14 };

/* multi-touch state for 2D canvas */
const cvPtrs = new Map();
let cvPinch  = null;

const cv   = document.getElementById('cv');
const ctx  = cv.getContext('2d');
const pv   = document.getElementById('pv');
const pctx = pv.getContext('2d');

/* 3D preview state */
const PS = {
  yaw:-Math.PI/4, pitch:0.78, zoom:1, minZoom:0.55, maxZoom:2.8,
  drag:null, pointers:new Map(),
  pinchStartDist:0, pinchStartZoom:1,
  pinchStartYaw:0,  pinchStartPitch:0,
  pinchMidStart:{x:0,y:0}, lastTapAt:0
};

/* ============================================================
   ROOF CONFIGURATION
============================================================ */
const roofConfig = {
  type: 'gable',
  pitch: GRID * 2.5
};

const ROOF_NAMES = {
  flat:    'Tekis',
  shed:    'Bir tomonli',
  gable:   'Tizma',
  hip:     'Hip',
  pyramid: 'Piramida',
  mansard: 'Mansard'
};

function setRoofType(type) {
  roofConfig.type = type;
  document.querySelectorAll('.roof-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.roof === type)
  );
  haptic('impactLight');
  render3DPreview();
}

function setRoofPitch(val) {
  roofConfig.pitch = parseFloat(val) * GRID;
  const el = document.getElementById('pitch-val');
  if (el) el.textContent = parseFloat(val).toFixed(1) + 'm';
  render3DPreview();
}

/* ============================================================
   MOBILE TAB SWITCHING
============================================================ */
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  document.querySelectorAll('.panel-section').forEach(p =>
    p.classList.toggle('active-panel', p.dataset.panel === tab)
  );
  haptic('selectionChanged');
  if (tab === 'preview') {
    requestAnimationFrame(() => {
      initPreviewSize();
      render3DPreview();
    });
  }
}
function initMobileTabs() {
  document.querySelectorAll('.panel-section').forEach(p => {
    p.classList.toggle('active-panel', p.dataset.panel === activeTab);
  });
}

/* ============================================================
   CANVAS HINT
============================================================ */
function updateCanvasHint() {
  const hint = document.getElementById('cv-hint');
  if (!hint) return;
  const hasContent = shapes.length > 0 || (cur && cur.pts.length > 0);
  hint.classList.toggle('hidden', hasContent);
}

/* ============================================================
   MATH HELPERS
============================================================ */
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }

function hexToRgb(hex){
  const h=hex.replace('#','');
  const full=h.length===3?h.split('').map(c=>c+c).join(''):h;
  const n=parseInt(full,16);
  return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};
}
function rgba(hex,a){ const c=hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }

function normA(a){ return ((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI); }
function betweenCCW(a,s,e){
  a=normA(a);s=normA(s);e=normA(e);
  return s<=e?(a>=s&&a<=e):(a>=s||a<=e);
}
function pDist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function pMid(a,b){ return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; }

/* ============================================================
   VIEW TRANSFORM
============================================================ */
function s2w(sx,sy){ return {x:(sx-view.tx)/view.scale, y:(sy-view.ty)/view.scale}; }

function zoomAt(factor,sx,sy){
  const ns=clamp(view.scale*factor,view.minScale,view.maxScale);
  if(ns===view.scale) return;
  const r=ns/view.scale;
  view.tx=sx-r*(sx-view.tx);
  view.ty=sy-r*(sy-view.ty);
  view.scale=ns;
  renderCanvas();
}
function resetCanvasView(){ view.scale=1;view.tx=0;view.ty=0; renderCanvas(); }
function viewCentre(){ return s2w(cv.width/2,cv.height/2); }

function cvSP(e){ const r=cv.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }

function arcHitR()  { return (HANDLE_R+4)/view.scale; }
function ptHitR()   { return 12/view.scale; }
function closeDistW(){ return CLOSE_DIST/view.scale; }

/* ============================================================
   ARC GEOMETRY
============================================================ */
function arcGeom(x1,y1,x2,y2,bulge){
  if(Math.abs(bulge)<0.5) return null;
  const mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1;
  const len=Math.hypot(dx,dy); if(len<1) return null;
  const px=-dy/len,py=dx/len;
  const ax=mx+bulge*px,ay=my+bulge*py;
  const D=2*(x1*(ay-y2)+ax*(y2-y1)+x2*(y1-ay));
  if(Math.abs(D)<0.001) return null;
  const cx=((x1*x1+y1*y1)*(ay-y2)+(ax*ax+ay*ay)*(y2-y1)+(x2*x2+y2*y2)*(y1-ay))/D;
  const cy=((x1*x1+y1*y1)*(x2-ax)+(ax*ax+ay*ay)*(x1-x2)+(x2*x2+y2*y2)*(ax-x1))/D;
  const r=Math.hypot(x1-cx,y1-cy);
  const sa=Math.atan2(y1-cy,x1-cx),ea=Math.atan2(y2-cy,x2-cx);
  const ap=Math.atan2(ay-cy,ax-cy);
  const acw=!betweenCCW(ap,sa,ea);
  const span=acw?normA(sa-ea):normA(ea-sa);
  return {cx,cy,r,sa,ea,acw,span};
}
function arcLen(x1,y1,x2,y2,b){ const a=arcGeom(x1,y1,x2,y2,b); return a?a.r*a.span:Math.hypot(x2-x1,y2-y1); }

function sampleArc(x1,y1,x2,y2,b,n=28){
  const a=arcGeom(x1,y1,x2,y2,b);
  if(!a) return [{x:x1,y:y1},{x:x2,y:y2}];
  const dir=a.acw?-1:1,pts=[];
  for(let i=0;i<=n;i++){ const ang=a.sa+dir*a.span*(i/n); pts.push({x:a.cx+a.r*Math.cos(ang),y:a.cy+a.r*Math.sin(ang)}); }
  return pts;
}
function handlePos(x1,y1,x2,y2,b){ const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1; return {x:(x1+x2)/2+b*(-dy/len),y:(y1+y2)/2+b*(dx/len)}; }
function perpOff(x1,y1,x2,y2,mx,my){ const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1; return (mx-(x1+x2)/2)*(-dy/len)+(my-(y1+y2)/2)*(dx/len); }

function getShapePolyline(sh,n=24){
  const out=[];
  for(let i=0;i<sh.pts.length;i++){
    const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
    if(Math.abs(b)<0.5) out.push({x:sh.pts[i].x,y:sh.pts[i].y});
    else { const s=sampleArc(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b,n); s.pop(); out.push(...s); }
  }
  return out;
}
function getBBox(pts){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  pts.forEach(p=>{ x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y); });
  return {minX:x0,minY:y0,maxX:x1,maxY:y1,w:x1-x0,h:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2};
}

/* ============================================================
   SHAPE AREA / PERI / HIT
============================================================ */
function shapeArea(sh){
  if(!sh.closed||sh.pts.length<3) return 0;
  const all=getShapePolyline(sh,32);let a=0;
  for(let i=0;i<all.length;i++){const j=(i+1)%all.length;a+=all[i].x*all[j].y-all[j].x*all[i].y;}
  return Math.abs(a)/2;
}
function shapePeri(sh){
  let p=0;
  for(let i=0;i<sh.pts.length;i++){const j=(i+1)%sh.pts.length;p+=arcLen(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,sh.segs[i].bulge||0);}
  return p;
}
function ptInShape(x,y,sh){
  if(!sh.closed||sh.pts.length<3) return false;
  const all=getShapePolyline(sh,18);let ins=false;
  for(let i=0,j=all.length-1;i<all.length;j=i++){
    const xi=all[i].x,yi=all[i].y,xj=all[j].x,yj=all[j].y;
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi) ins=!ins;
  }
  return ins;
}
function findTopShapeAt(x,y){ for(let si=shapes.length-1;si>=0;si--) if(ptInShape(x,y,shapes[si])) return si; return null; }

/* ============================================================
   CANVAS INIT & RENDER
============================================================ */
function initCanvas(){
  const cw=document.getElementById('cwrap');
  cv.width=Math.max(1,Math.floor(cw.clientWidth * (window.devicePixelRatio || 1)));
  cv.height=Math.max(1,Math.floor(cw.clientHeight * (window.devicePixelRatio || 1)));
  cv.style.width = cw.clientWidth + 'px';
  cv.style.height = cw.clientHeight + 'px';
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  initPreviewSize();
  redrawAll();
}
function initPreviewSize(){
  const pw=document.querySelector('.preview-canvas-wrap');
  if(pw){
    const dpr = window.devicePixelRatio || 1;
    pv.width=Math.max(1,Math.floor(pw.clientWidth * dpr));
    pv.height=Math.max(1,Math.floor(pw.clientHeight * dpr));
    pv.style.width = pw.clientWidth + 'px';
    pv.style.height = pw.clientHeight + 'px';
    pctx.scale(dpr, dpr);
  }
}
function syncGeometryViews(){ renderCanvas();render3DPreview();updateArea();updateCanvasHint(); }
function redrawAll(){ syncGeometryViews();refreshDimsPanelIfNeeded(); }

function renderCanvas(){
  const dpr = window.devicePixelRatio || 1;
  const w = cv.width / dpr;
  const h = cv.height / dpr;
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.setTransform(view.scale,0,0,view.scale,view.tx,view.ty);
  drawGrid(w,h);
  shapes.forEach((sh,si)=>drawShape(sh,si,appMode==='edit'&&selShape===si));
  if(cur) drawCurrent();
  ctx.restore();
}

function drawGrid(cw,ch){
  const s=view.scale,lw=1/s;
  const gx0=Math.floor((-view.tx/s)/GRID)*GRID;
  const gy0=Math.floor((-view.ty/s)/GRID)*GRID;
  const gx1=Math.ceil(((cw-view.tx)/s)/GRID)*GRID;
  const gy1=Math.ceil(((ch-view.ty)/s)/GRID)*GRID;
  for(let x=gx0;x<=gx1;x+=GRID){
    ctx.strokeStyle=(x/GRID)%5===0?'rgba(91,156,245,.12)':'rgba(91,156,245,.04)';
    ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(x,gy0);ctx.lineTo(x,gy1);ctx.stroke();
  }
  for(let y=gy0;y<=gy1;y+=GRID){
    ctx.strokeStyle=(y/GRID)%5===0?'rgba(91,156,245,.12)':'rgba(91,156,245,.04)';
    ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(gx0,y);ctx.lineTo(gx1,y);ctx.stroke();
  }
  ctx.fillStyle='rgba(91,156,245,.18)';ctx.font=`${8/s}px "JetBrains Mono", monospace`;
  for(let x=Math.ceil(gx0/GRID/5)*GRID*5;x<=gx1;x+=GRID*5) ctx.fillText((x/GRID)+'m',x+2/s,gy0+10/s);
  for(let y=Math.ceil(gy0/GRID/5)*GRID*5;y<=gy1;y+=GRID*5) ctx.fillText((y/GRID)+'m',gx0+2/s,y-2/s);
}

function buildPath(sh){
  ctx.beginPath();
  for(let i=0;i<sh.pts.length;i++){
    const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
    if(i===0) ctx.moveTo(sh.pts[0].x,sh.pts[0].y);
    if(Math.abs(b)<0.5) ctx.lineTo(sh.pts[j].x,sh.pts[j].y);
    else{const a=arcGeom(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b);if(a)ctx.arc(a.cx,a.cy,a.r,a.sa,a.ea,a.acw);else ctx.lineTo(sh.pts[j].x,sh.pts[j].y);}
  }
  if(sh.closed) ctx.closePath();
}

function drawShape(sh,si,sel){
  const s=view.scale;
  buildPath(sh);
  ctx.fillStyle=sel?'rgba(212,175,55,.06)':'rgba(91,156,245,.03)';ctx.fill();
  ctx.strokeStyle=sel?'#d4af37':SHC[si%SHC.length];
  ctx.lineWidth=(sel?2.5:1.8)/s;ctx.setLineDash([]);buildPath(sh);ctx.stroke();

  sh.pts.forEach((p,i)=>{
    ctx.beginPath();ctx.arc(p.x,p.y,5/s,0,Math.PI*2);
    ctx.fillStyle=sel?'#d4af37':SHC[si%SHC.length];ctx.fill();
    ctx.strokeStyle='#0a0e14';ctx.lineWidth=1.5/s;ctx.stroke();
    ctx.fillStyle=sel?'#d4af37':SHC[si%SHC.length];
    ctx.font=`600 ${10/s}px "JetBrains Mono", monospace`;
    ctx.fillText(ALP[i]+(si+1),p.x+7/s,p.y-7/s);
  });

  sh.pts.forEach((p,i)=>{
    const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
    const hp=handlePos(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b);
    const vl=(arcLen(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b)/GRID).toFixed(2);
    const ml=sh.lens[i]!=null?sh.lens[i]:vl;
    const txt=ml+'m';
    ctx.font=`500 ${9/s}px "JetBrains Mono", monospace`;
    const tw=ctx.measureText(txt).width;
    ctx.fillStyle=b?'rgba(90,50,120,.88)':'rgba(12,18,26,.88)';
    ctx.beginPath();ctx.roundRect(hp.x-tw/2-5/s,hp.y-21/s,tw+10/s,16/s,4/s);ctx.fill();
    /* subtle border */
    ctx.strokeStyle=b?'rgba(167,139,250,.25)':'rgba(91,156,245,.15)';
    ctx.lineWidth=0.8/s;ctx.stroke();
    ctx.fillStyle=b?'#a78bfa':'#8f9baa';ctx.fillText(txt,hp.x-tw/2,hp.y-10/s);
  });

  if(sel){
    sh.pts.forEach((p,i)=>{
      const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
      const hp=handlePos(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b);
      const hov=hovArc&&hovArc.si===si&&hovArc.seg===i;
      ctx.beginPath();ctx.arc(hp.x,hp.y,(hov?HANDLE_R+2:HANDLE_R)/s,0,Math.PI*2);
      ctx.fillStyle=hov?'#d4af37':(b?'rgba(167,139,250,.85)':'rgba(50,65,90,.85)');ctx.fill();
      ctx.strokeStyle='#0a0e14';ctx.lineWidth=2/s;ctx.stroke();
      ctx.fillStyle='#fff';ctx.font=`bold ${9/s}px "DM Sans", sans-serif`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('\u2322',hp.x,hp.y+1/s);
      ctx.textAlign='left';ctx.textBaseline='alphabetic';
    });
    sh.pts.forEach((p,i)=>{
      if(hovPt&&hovPt.si===si&&hovPt.pi===i){
        ctx.beginPath();ctx.arc(p.x,p.y,12/s,0,Math.PI*2);
        ctx.strokeStyle='rgba(212,175,55,.5)';ctx.lineWidth=2/s;ctx.stroke();
      }
    });
  }
}

function drawCurrent(){
  const pts=cur.pts;if(!pts.length) return;
  const s=view.scale;
  ctx.strokeStyle='#4cce7b';ctx.lineWidth=2/s;ctx.setLineDash([5/s,4/s]);
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  pts.forEach((p,i)=>{if(i) ctx.lineTo(p.x,p.y);});
  ctx.lineTo(mouse.x,mouse.y);ctx.stroke();ctx.setLineDash([]);
  const cd=closeDistW();
  if(pts.length>2&&Math.hypot(pts[0].x-mouse.x,pts[0].y-mouse.y)<cd){
    ctx.beginPath();ctx.arc(pts[0].x,pts[0].y,cd,0,Math.PI*2);
    ctx.strokeStyle='rgba(76,206,123,.4)';ctx.lineWidth=2/s;
    ctx.setLineDash([3/s,3/s]);ctx.stroke();ctx.setLineDash([]);
  }
  pts.forEach((p,i)=>{
    ctx.beginPath();ctx.arc(p.x,p.y,5/s,0,Math.PI*2);
    ctx.fillStyle=i===0?'#4cce7b':'#5b9cf5';ctx.fill();
    ctx.strokeStyle='#0a0e14';ctx.lineWidth=1.5/s;ctx.stroke();
    ctx.fillStyle=i===0?'#4cce7b':'#5b9cf5';
    ctx.font=`600 ${10/s}px "JetBrains Mono", monospace`;ctx.fillText(ALP[i],p.x+7/s,p.y-7/s);
  });
}

/* ============================================================
   3D PREVIEW
============================================================ */
function orbitDepth(x,y,z,yaw,pitch){
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  return (x*sy+y*cy)*cp-z*sp;
}
function project3D(x,y,z,cam){
  const cy=Math.cos(cam.yaw),sy=Math.sin(cam.yaw),cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
  const x1=x*cy-y*sy,y1=x*sy+y*cy;
  const y2=y1*cp-z*sp,z2=y1*sp+z*cp;
  const persp=cam.distance/Math.max(80,y2+cam.distance);
  return {x:cam.ox+x1*cam.scale*persp,y:cam.oy-z2*cam.scale*persp,depth:y2};
}
function drawPoly3(c,pts,fill,stroke,lw=1.2){
  if(!pts||pts.length<2) return;
  c.beginPath();c.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) c.lineTo(pts[i].x,pts[i].y);
  c.closePath();
  if(fill){c.fillStyle=fill;c.fill();}
  if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke();}
}
function drawPreviewGrid(cam,spanX,spanY){
  const dpr = window.devicePixelRatio || 1;
  const pvW = pv.width / dpr;
  const step=Math.max(60,GRID*2),pad=Math.max(spanX,spanY)*0.8;
  for(let x=-spanX/2-pad;x<=spanX/2+pad;x+=step){
    const a=project3D(x,-spanY/2-pad,0,cam),b=project3D(x,spanY/2+pad,0,cam);
    pctx.beginPath();pctx.moveTo(a.x,a.y);pctx.lineTo(b.x,b.y);
    pctx.strokeStyle='rgba(91,156,245,.06)';pctx.lineWidth=1;pctx.stroke();
  }
  for(let y=-spanY/2-pad;y<=spanY/2+pad;y+=step){
    const a=project3D(-spanX/2-pad,y,0,cam),b=project3D(spanX/2+pad,y,0,cam);
    pctx.beginPath();pctx.moveTo(a.x,a.y);pctx.lineTo(b.x,b.y);
    pctx.strokeStyle='rgba(212,175,55,.04)';pctx.lineWidth=1;pctx.stroke();
  }
}
function makeFace(pts,fill,stroke,lw=1.2){ return {pts,fill,stroke,lw}; }
function faceAvgDepth(pts,yaw,pitch){ return pts.reduce((s,p)=>s+orbitDepth(p.x,p.y,p.z,yaw,pitch),0)/pts.length; }
function drawFace3D(face,cam){ drawPoly3(pctx,face.pts.map(p=>project3D(p.x,p.y,p.z,cam)),face.fill,face.stroke,face.lw); }

function buildHouseFaces(sh,contour,sceneCx,sceneCy,color,selected){
  const faces=[];
  const ring=contour.map(p=>({x:p.x-sceneCx,y:-(p.y-sceneCy)}));
  const rB=ring.map(p=>({...p,z:0}));
  const rT=ring.map(p=>({...p,z:WALL_H}));
  const wF1=selected?'rgba(212,175,55,.28)':rgba(color,.22);
  const wF2=selected?'rgba(212,175,55,.14)':rgba(color,.10);
  const wS =selected?'rgba(212,175,55,.50)':rgba(color,.38);
  faces.push(makeFace(rB.slice().reverse(),'rgba(255,255,255,.03)','rgba(255,255,255,.04)',1));
  for(let i=0;i<ring.length;i++){
    const j=(i+1)%ring.length;
    const nx=-(ring[j].y-ring[i].y),ny=ring[j].x-ring[i].x;
    faces.push(makeFace([rB[i],rB[j],rT[j],rT[i]],(nx+ny*0.5)>=0?wF1:wF2,wS,1.4));
  }
  return faces;
}

function buildRoofFaces(sh, contour, sceneCx, sceneCy, color, selected) {
  const ring = contour.map(p => ({x: p.x - sceneCx, y: -(p.y - sceneCy)}));
  const n = ring.length;
  if (n < 3) return [];

  const pitchH = roofConfig.pitch;
  const type   = roofConfig.type;

  const rFill   = selected ? 'rgba(212,175,55,.40)' : rgba(color, .30);
  const rFill2  = selected ? 'rgba(212,175,55,.22)' : rgba(color, .18);
  const rStroke = selected ? 'rgba(212,175,55,.90)' : rgba(color, .75);

  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  ring.forEach(p=>{
    if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
    if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y;
  });
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  const spanX=Math.max(maxX-minX,1), spanY=Math.max(maxY-minY,1);
  const isWide = spanX >= spanY;

  const base = ring.map(p => ({x:p.x, y:p.y, z:WALL_H}));
  const faces = [];

  if (type === 'flat') {
    faces.push(makeFace(base.slice(), rFill2, rStroke, 1.2));
    return faces;
  }

  if (type === 'pyramid') {
    const peak = {x:cx, y:cy, z:WALL_H + pitchH};
    for (let i=0;i<n;i++){
      const j=(i+1)%n;
      faces.push(makeFace([base[i], base[j], peak], rFill, rStroke, 1.4));
    }
    return faces;
  }

  if (type === 'mansard') {
    const k1=0.20, k2=0.42;
    const z1=WALL_H+pitchH*0.55, z2=WALL_H+pitchH*0.88, zT=WALL_H+pitchH;
    const r1=ring.map(p=>({x:cx+(p.x-cx)*(1-k1), y:cy+(p.y-cy)*(1-k1), z:z1}));
    const r2=ring.map(p=>({x:cx+(p.x-cx)*(1-k2), y:cy+(p.y-cy)*(1-k2), z:z2}));
    const peak={x:cx, y:cy, z:zT};
    for(let i=0;i<n;i++){
      const j=(i+1)%n;
      faces.push(makeFace([base[i], base[j], r1[j], r1[i]], rFill,  rStroke, 1.4));
      faces.push(makeFace([r1[i],   r1[j],   r2[j], r2[i]], rFill2, rStroke, 1.2));
    }
    for(let i=0;i<n;i++){
      const j=(i+1)%n;
      faces.push(makeFace([r2[i], r2[j], peak], rgba(color,.14), rStroke, 1.0));
    }
    return faces;
  }

  function elevZ(p) {
    if (type === 'shed') {
      return WALL_H + pitchH * (isWide ? (p.y-minY)/spanY : (p.x-minX)/spanX);
    }
    if (type === 'gable') {
      const d = isWide ? Math.abs(p.y-cy)/(spanY/2) : Math.abs(p.x-cx)/(spanX/2);
      return WALL_H + pitchH * Math.max(0, 1-d);
    }
    if (type === 'hip') {
      const dx=Math.abs(p.x-cx)/(spanX/2), dy=Math.abs(p.y-cy)/(spanY/2);
      return WALL_H + pitchH * Math.max(0, 1-Math.max(dx,dy));
    }
    return WALL_H;
  }

  const elevated = ring.map(p => ({x:p.x, y:p.y, z:elevZ(p)}));
  const peakZ = (type==='shed') ? WALL_H+pitchH*0.5 : WALL_H+pitchH;
  const fan   = {x:cx, y:cy, z:peakZ};

  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    faces.push(makeFace([elevated[i], elevated[j], fan], rFill, rStroke, 1.4));
  }
  return faces;
}

function render3DPreview(){
  const dpr = window.devicePixelRatio || 1;
  const pvW = pv.width / dpr;
  const pvH = pv.height / dpr;
  pctx.clearRect(0,0,pvW,pvH);
  const bg=pctx.createLinearGradient(0,0,0,pvH);
  bg.addColorStop(0,'rgba(86,212,200,.06)');bg.addColorStop(1,'rgba(10,14,20,0)');
  pctx.fillStyle=bg;pctx.fillRect(0,0,pvW,pvH);
  const deg=Math.round((PS.yaw*180/Math.PI+360)%360);
  const angleEl=document.getElementById('pv-angle');
  if(angleEl) angleEl.textContent=deg+'°';
  const noteEl=document.getElementById('pv-note');
  if(!shapes.length){
    if(noteEl) noteEl.textContent='Shakl chizib 3D ko\'ring';
    pctx.fillStyle='#5a6678';pctx.font='500 12px "DM Sans", sans-serif';pctx.textAlign='center';
    pctx.fillText("3D preview shu yerda ko'rinadi",pvW/2,pvH/2-6);
    pctx.font='11px "DM Sans", sans-serif';
    pctx.fillStyle='#3d4a5c';
    pctx.fillText("Shakl chizing",pvW/2,pvH/2+14);
    pctx.textAlign='left';return;
  }
  const contours=shapes.map(sh=>getShapePolyline(sh,18));
  const sceneBox=getBBox(contours.flat());
  const spanX=Math.max(sceneBox.w,1),spanY=Math.max(sceneBox.h,1);

  const roofExtra = roofConfig.pitch * 1.2;
  const cam={
    yaw:PS.yaw,pitch:PS.pitch,
    distance:Math.max(spanX,spanY)*1.9+520,
    scale:Math.min((pvW*0.55)/spanX,(pvH*0.46)/(spanY+roofExtra))*PS.zoom,
    ox:0, oy:0
  };

  const allScreen=[];
  contours.forEach(contour=>{
    contour.forEach(p=>{
      const wx=p.x-sceneBox.cx, wy=-(p.y-sceneBox.cy);
      allScreen.push(project3D(wx,wy,0,cam));
      allScreen.push(project3D(wx,wy,WALL_H+roofConfig.pitch,cam));
    });
  });
  const sb=getBBox(allScreen);
  const marginTop=14;
  cam.ox=pvW/2  - sb.cx;
  cam.oy=(marginTop+(pvH-marginTop)/2) - sb.cy;

  drawPreviewGrid(cam,spanX,spanY);

  const gc=project3D(0,0,0,cam);
  pctx.beginPath();pctx.ellipse(gc.x,gc.y+6,pvW*0.18,10,0,0,Math.PI*2);
  pctx.fillStyle='rgba(0,0,0,.16)';pctx.fill();

  const faces=[];
  contours.forEach((contour,si)=>{
    faces.push(...buildHouseFaces(shapes[si],contour,sceneBox.cx,sceneBox.cy,SHC[si%SHC.length],selShape===si));
    faces.push(...buildRoofFaces (shapes[si],contour,sceneBox.cx,sceneBox.cy,SHC[si%SHC.length],selShape===si));
  });
  faces.sort((a,b)=>faceAvgDepth(b.pts,cam.yaw,cam.pitch)-faceAvgDepth(a.pts,cam.yaw,cam.pitch));
  faces.forEach(f=>drawFace3D(f,cam));

  contours.forEach((contour,si)=>{
    const bb=getBBox(contour);
    const lp=project3D(bb.cx-sceneBox.cx,-(bb.cy-sceneBox.cy),WALL_H+roofConfig.pitch*1.15,cam);
    pctx.fillStyle=(selShape===si)?'#d4af37':SHC[si%SHC.length];
    pctx.font='bold 11px "JetBrains Mono", monospace';pctx.fillText('#'+(si+1),lp.x-10,lp.y);
  });

  const rName = ROOF_NAMES[roofConfig.type] || roofConfig.type;
  if(noteEl) noteEl.textContent = selShape!=null
    ? `${rName} · #${selShape+1} tanlangan`
    : `${shapes.length} shakl · ${rName}`;
}

/* ============================================================
   3D PREVIEW CONTROLS
============================================================ */
function setPreviewZoom(v){ PS.zoom=clamp(v,PS.minZoom,PS.maxZoom);render3DPreview(); }
function zoomPreview(mult){ setPreviewZoom(PS.zoom*mult); }
function resetPreviewCamera(){ PS.yaw=-Math.PI/4;PS.pitch=0.78;PS.zoom=1;render3DPreview(); }
function clampPvPitch(v){ return clamp(v,0.10,1.42); }

pv.addEventListener('wheel',e=>{
  e.preventDefault();
  PS.zoom=clamp(PS.zoom*(e.deltaY<0?1.10:1/1.10),PS.minZoom,PS.maxZoom);
  render3DPreview();
},{passive:false});

pv.addEventListener('pointerdown',e=>{
  if(!shapes.length) return;
  e.preventDefault();
  try{pv.setPointerCapture(e.pointerId);}catch(err){}
  PS.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const now=Date.now();
  if(now-PS.lastTapAt<260) resetPreviewCamera();
  PS.lastTapAt=now;
  if(PS.pointers.size===1)
    PS.drag={startX:e.clientX,startY:e.clientY,startYaw:PS.yaw,startPitch:PS.pitch};
  if(PS.pointers.size===2){
    const pts=[...PS.pointers.values()];PS.drag=null;
    PS.pinchStartDist=pDist(pts[0],pts[1]);PS.pinchStartZoom=PS.zoom;
    PS.pinchStartYaw=PS.yaw;PS.pinchStartPitch=PS.pitch;
    PS.pinchMidStart=pMid(pts[0],pts[1]);
  }
});

pv.addEventListener('pointermove',e=>{
  if(!PS.pointers.has(e.pointerId)) return;
  PS.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(PS.pointers.size===1&&PS.drag){
    const dx=e.clientX-PS.drag.startX,dy=e.clientY-PS.drag.startY;
    PS.yaw=PS.drag.startYaw+dx*0.0085;
    PS.pitch=clampPvPitch(PS.drag.startPitch+dy*0.0065);
    render3DPreview();return;
  }
  if(PS.pointers.size===2){
    const pts=[...PS.pointers.values()];
    const dist=pDist(pts[0],pts[1]),mid=pMid(pts[0],pts[1]);
    if(PS.pinchStartDist>0) PS.zoom=clamp(PS.pinchStartZoom*dist/PS.pinchStartDist,PS.minZoom,PS.maxZoom);
    PS.yaw=PS.pinchStartYaw+(mid.x-PS.pinchMidStart.x)*0.0045;
    PS.pitch=clampPvPitch(PS.pinchStartPitch+(mid.y-PS.pinchMidStart.y)*0.004);
    render3DPreview();
  }
});

function pvRelease(e){
  PS.pointers.delete(e.pointerId);
  if(PS.pointers.size===1){const only=[...PS.pointers.values()][0];PS.drag={startX:only.x,startY:only.y,startYaw:PS.yaw,startPitch:PS.pitch};}
  else PS.drag=null;
  if(PS.pointers.size<2) PS.pinchStartDist=0;
}
pv.addEventListener('pointerup',pvRelease);
pv.addEventListener('pointercancel',pvRelease);
pv.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse') pvRelease(e);});

/* ============================================================
   2D CANVAS EVENTS
============================================================ */
cv.addEventListener('wheel',e=>{
  e.preventDefault();
  const sp=cvSP(e);
  zoomAt(e.deltaY<0?1.14:1/1.14,sp.x,sp.y);
},{passive:false});

cv.addEventListener('pointerdown',e=>{
  e.preventDefault();
  try{cv.setPointerCapture(e.pointerId);}catch(err){}
  const sp=cvSP(e);
  cvPtrs.set(e.pointerId,sp);

  if(cvPtrs.size>=2){
    drag=null;
    const pts=[...cvPtrs.values()];
    cvPinch={
      startDist :pDist(pts[0],pts[1]),
      startScale:view.scale,
      startTx   :view.tx,startTy:view.ty,
      startMid  :pMid(pts[0],pts[1])
    };
    return;
  }

  cvPinch=null;
  const w=s2w(sp.x,sp.y);

  if(appMode==='edit'){
    if(selShape!=null){
      const sh=shapes[selShape];
      for(let i=0;i<sh.pts.length;i++){
        const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
        const hp=handlePos(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b);
        if(Math.hypot(hp.x-w.x,hp.y-w.y)<arcHitR()){drag={type:'arc',si:selShape,seg:i};cv.style.cursor='grabbing';return;}
      }
      for(let i=0;i<sh.pts.length;i++){
        if(Math.hypot(sh.pts[i].x-w.x,sh.pts[i].y-w.y)<ptHitR()){drag={type:'pt',si:selShape,pi:i};cv.style.cursor='grabbing';return;}
      }
    }
    const hit=findTopShapeAt(w.x,w.y);
    if(hit!=null){
      selShape=hit;dimsDirty=true;refreshDimsPanelIfNeeded();renderCanvas();
      drag={type:'shape',si:hit,sx:w.x,sy:w.y,orig:shapes[hit].pts.map(p=>({x:p.x,y:p.y}))};
      cv.style.cursor='grabbing';render3DPreview();
      haptic('impactLight');
      return;
    }
    selShape=null;dimsDirty=true;redrawAll();return;
  }

  if(appMode==='draw'){
    if(!cur) cur={pts:[],segs:[],lens:[],closed:false,slope:30};
    const wx=snap?Math.round(w.x/GRID)*GRID:w.x;
    const wy=snap?Math.round(w.y/GRID)*GRID:w.y;
    if(cur.pts.length>2&&Math.hypot(cur.pts[0].x-wx,cur.pts[0].y-wy)<closeDistW()){closeShape();return;}
    cur.pts.push({x:wx,y:wy});cur.segs.push({type:'line',bulge:0});cur.lens.push(null);
    haptic('impactLight');
    updateCanvasHint();
    renderCanvas();
  }
});

cv.addEventListener('pointermove',e=>{
  const sp=cvSP(e);
  if(cvPtrs.has(e.pointerId)) cvPtrs.set(e.pointerId,sp);

  if(cvPtrs.size===2&&cvPinch){
    const pts=[...cvPtrs.values()];
    const dist=pDist(pts[0],pts[1]),mid=pMid(pts[0],pts[1]);
    const factor=dist/cvPinch.startDist;
    const ns=clamp(cvPinch.startScale*factor,view.minScale,view.maxScale);
    const rf=ns/cvPinch.startScale;
    view.tx=cvPinch.startMid.x-rf*(cvPinch.startMid.x-cvPinch.startTx)+(mid.x-cvPinch.startMid.x);
    view.ty=cvPinch.startMid.y-rf*(cvPinch.startMid.y-cvPinch.startTy)+(mid.y-cvPinch.startMid.y);
    view.scale=ns;
    renderCanvas();return;
  }

  const w=s2w(sp.x,sp.y);
  mouse={
    x:snap&&appMode==='draw'?Math.round(w.x/GRID)*GRID:w.x,
    y:snap&&appMode==='draw'?Math.round(w.y/GRID)*GRID:w.y
  };

  if(drag){handleDragWorld(w.x,w.y);return;}

  if(appMode==='edit'){
    hovArc=null;hovPt=null;
    if(selShape!=null){
      const sh=shapes[selShape];
      for(let i=0;i<sh.pts.length;i++){
        const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
        const hp=handlePos(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b);
        if(Math.hypot(hp.x-w.x,hp.y-w.y)<arcHitR()){hovArc={si:selShape,seg:i};cv.style.cursor='grab';renderCanvas();return;}
      }
      for(let i=0;i<sh.pts.length;i++){
        if(Math.hypot(sh.pts[i].x-w.x,sh.pts[i].y-w.y)<ptHitR()){hovPt={si:selShape,pi:i};cv.style.cursor='move';renderCanvas();return;}
      }
      if(ptInShape(w.x,w.y,sh)){cv.style.cursor='grab';renderCanvas();return;}
    }
    cv.style.cursor='default';
  }
  renderCanvas();
});

function cvPtrRelease(e){
  cvPtrs.delete(e.pointerId);
  if(cvPtrs.size<2) cvPinch=null;
  if(cvPtrs.size===0){
    if(drag){drag=null;cv.style.cursor=appMode==='draw'?'crosshair':'default';dimsDirty=true;redrawAll();}
  }
}
cv.addEventListener('pointerup',   cvPtrRelease);
cv.addEventListener('pointercancel',cvPtrRelease);

function handleDragWorld(wx,wy){
  if(!drag) return;
  if(drag.type==='arc'){
    const sh=shapes[drag.si],i=drag.seg,j=(i+1)%sh.pts.length;
    const b=perpOff(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,wx,wy);
    const chord=Math.hypot(sh.pts[j].x-sh.pts[i].x,sh.pts[j].y-sh.pts[i].y);
    const cl=clamp(b,-chord*.75,chord*.75);
    sh.segs[i]=Math.abs(cl)<6?{type:'line',bulge:0}:{type:'arc',bulge:cl};
    const nb=sh.segs[i].bulge||0;
    sh.lens[i]=parseFloat((arcLen(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,nb)/GRID).toFixed(2));
    syncGeometryViews();return;
  }
  if(drag.type==='pt'){
    const sh=shapes[drag.si];
    const x=snap?Math.round(wx/GRID)*GRID:wx;
    const y=snap?Math.round(wy/GRID)*GRID:wy;
    sh.pts[drag.pi]={x,y};
    const n=sh.pts.length,k=drag.pi;
    for(const idx of [k,(k-1+n)%n]){
      const j=(idx+1)%n,b=sh.segs[idx].bulge||0;
      sh.lens[idx]=parseFloat((arcLen(sh.pts[idx].x,sh.pts[idx].y,sh.pts[j].x,sh.pts[j].y,b)/GRID).toFixed(2));
    }
    syncGeometryViews();return;
  }
  if(drag.type==='shape'){
    const sh=shapes[drag.si];
    let dx=wx-drag.sx,dy=wy-drag.sy;
    if(snap){dx=Math.round(dx/GRID)*GRID;dy=Math.round(dy/GRID)*GRID;}
    for(let i=0;i<sh.pts.length;i++){sh.pts[i].x=drag.orig[i].x+dx;sh.pts[i].y=drag.orig[i].y+dy;}
    syncGeometryViews();
  }
}

/* ============================================================
   MODES / ACTIONS
============================================================ */
function setAppMode(m){
  appMode=m;
  document.getElementById('btn-draw').classList.toggle('active',m==='draw');
  document.getElementById('btn-edit').classList.toggle('active',m==='edit');
  const b=document.getElementById('mode-badge');
  if(m==='draw'){
    b.innerHTML='<span class="mode-dot"></span>CHIZISH';
    b.className='mode-pill draw-mode';
    cv.style.cursor='crosshair';
  } else {
    b.innerHTML='<span class="mode-dot"></span>TAHRIR';
    b.className='mode-pill edit-mode';
    cv.style.cursor='default';
  }
  haptic('selectionChanged');
  dimsDirty=true;redrawAll();
}
function toggleSnap(){
  snap=!snap;
  document.getElementById('btn-snap').classList.toggle('active',snap);
  haptic('impactLight');
}

function undoAction(){
  if(appMode==='draw'&&cur){
    if(cur.pts.length>0){cur.pts.pop();cur.segs.pop();cur.lens.pop();}else cur=null;
  }else if(shapes.length>0){
    shapes.pop();
    if(selShape!=null&&selShape>=shapes.length) selShape=shapes.length-1;
    if(shapes.length===0) selShape=null;
  }
  haptic('impactMedium');
  dimsDirty=true;redrawAll();
}
function newShape(){ cur=null;selShape=null;setAppMode('draw');haptic('impactLight'); }
function resetAll(){ shapes=[];cur=null;selShape=null;setAppMode('draw');dimsDirty=true;redrawAll();haptic('notificationWarning'); }

function deleteShape(si){
  shapes.splice(si,1);
  if(selShape!=null){if(selShape>=shapes.length)selShape=shapes.length-1;if(selShape<0)selShape=null;}
  haptic('impactMedium');
  dimsDirty=true;redrawAll();
}
function closeShape(){
  if(!cur||cur.pts.length<3) return;
  cur.closed=true;
  cur.lens=cur.pts.map((p,i)=>{
    const j=(i+1)%cur.pts.length,b=cur.segs[i].bulge||0;
    return parseFloat((arcLen(p.x,p.y,cur.pts[j].x,cur.pts[j].y,b)/GRID).toFixed(2));
  });
  shapes.push(cur);cur=null;selShape=shapes.length-1;setAppMode('edit');
  haptic('notificationSuccess');
}

/* ============================================================
   QUICK SHAPES
============================================================ */
function addQuickRect(){
  const wM=parseFloat(document.getElementById('qw').value)||10;
  const lM=parseFloat(document.getElementById('ql_').value)||15;
  const c=viewCentre();makeRect(c.x,c.y,wM,lM);
}
function makeRect(cx,cy,wM,lM){
  const w=wM*GRID,l=lM*GRID;
  const x0=Math.round((cx-w/2)/GRID)*GRID,y0=Math.round((cy-l/2)/GRID)*GRID;
  const pts=[{x:x0,y:y0},{x:x0+w,y:y0},{x:x0+w,y:y0+l},{x:x0,y:y0+l}];
  shapes.push({pts,segs:pts.map(()=>({type:'line',bulge:0})),lens:[wM,lM,wM,lM],closed:true,slope:30});
  selShape=shapes.length-1;setAppMode('edit');
}
function addLShape(){
  const w1=parseFloat(document.getElementById('lw1').value)||10;
  const l1=parseFloat(document.getElementById('ll1').value)||12;
  const w2=parseFloat(document.getElementById('lw2').value)||5;
  const l2=parseFloat(document.getElementById('ll2').value)||6;
  const c=viewCentre();const cx=c.x,cy=c.y;
  const W=w1*GRID,L=l1*GRID,W2=w2*GRID,L2=l2*GRID;
  const x0=Math.round((cx-W/2)/GRID)*GRID,y0=Math.round((cy-L/2)/GRID)*GRID;
  const pts=[{x:x0,y:y0},{x:x0+W,y:y0},{x:x0+W,y:y0+L-L2},{x:x0+W-W2,y:y0+L-L2},{x:x0+W-W2,y:y0+L},{x:x0,y:y0+L}];
  shapes.push({pts,segs:pts.map(()=>({type:'line',bulge:0})),lens:[w1,l1-l2,w2,l2,w1-w2,l1],closed:true,slope:30});
  selShape=shapes.length-1;setAppMode('edit');
}

/* ============================================================
   DIMS PANEL
============================================================ */
function refreshDimsPanelIfNeeded(){ if(!dimsDirty) return;dimsDirty=false;updateDimsPanel(); }
function updateDimsPanel(){
  const el=document.getElementById('dims');
  if(!shapes.length){
    el.innerHTML=`<div class="empty-state"><svg width="40" height="40" viewBox="0 0 40 40" fill="none" opacity=".3"><rect x="4" y="8" width="32" height="24" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M14 20H26M20 14V26" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".5"/></svg><p>Shakl chizing yoki<br>tezkor shakl qo'shing</p></div>`;
    return;
  }
  el.innerHTML=shapes.map((sh,si)=>{
    const rows=sh.pts.map((p,i)=>{
      const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
      const vl=(arcLen(p.x,p.y,sh.pts[j].x,sh.pts[j].y,b)/GRID).toFixed(2);
      const ml=sh.lens[i]!=null?sh.lens[i]:vl;
      const tag=b?`<span class="seg-tag tag-arc">EGRI</span>`:`<span class="seg-tag tag-line">TO'G'RI</span>`;
      return `<div class="seg-row">${tag}<span class="seg-lbl">${ALP[i]}${si+1}–${ALP[j]}${si+1}</span><input class="seg-in" type="number" value="${ml}" min="0.01" step="0.1" inputmode="decimal" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()" oninput="setLen(${si},${i},this.value)"><span class="seg-unit">m</span></div>`;
    }).join('');
    return `<div class="shape-card ${selShape===si?'selected':''}" onclick="selectSh(${si})">
      <div class="shape-card-title"><span>◆ SHAKL #${si+1}${selShape===si?' ✓':''}</span><button class="del-btn" onclick="event.stopPropagation();deleteShape(${si})">✕</button></div>
      ${rows}</div>`;
  }).join('');
}
function selectSh(si){ selShape=si;if(appMode!=='edit')setAppMode('edit');dimsDirty=true;haptic('selectionChanged');redrawAll(); }
function setLen(si,i,v){ const n=parseFloat(v);if(!isNaN(n)&&n>0){shapes[si].lens[i]=n;renderCanvas();render3DPreview();updateArea();} }
function setSlope(si,v){ shapes[si].slope=parseInt(v,10);const lbl=document.getElementById('sv'+si);if(lbl)lbl.textContent=v+'°';render3DPreview();updateArea(); }

/* ============================================================
   AREA
============================================================ */
function updateArea(){
  let total=0;
  shapes.forEach(sh=>{
    if(!sh.closed) return;
    const vizA=shapeArea(sh)/(GRID*GRID);
    const vizP=shapePeri(sh)/GRID;
    const manP=sh.lens.reduce((s,v,i)=>{
      const j=(i+1)%sh.pts.length,b=sh.segs[i].bulge||0;
      const vis=arcLen(sh.pts[i].x,sh.pts[i].y,sh.pts[j].x,sh.pts[j].y,b)/GRID;
      return s+(v!=null?v:vis);
    },0);
    const sc=vizP>0?Math.pow(manP/vizP,2):1;
    total+=vizA*sc;
  });
  document.getElementById('area-val').textContent=total.toFixed(2)+' m²';
}

/* ============================================================
   INIT
============================================================ */
window.addEventListener('load', ()=>{
  initCanvas();
  initMobileTabs();
  updateCanvasHint();
  /* Set initial mode pill */
  const b = document.getElementById('mode-badge');
  b.className = 'mode-pill draw-mode';
  b.innerHTML = '<span class="mode-dot"></span>CHIZISH';
  redrawAll();
});
window.addEventListener('resize', ()=>{
  initCanvas();
  redrawAll();
});