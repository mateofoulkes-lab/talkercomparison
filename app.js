import * as THREE from 'three';
import { Client, handle_file } from '@gradio/client';
import { unzipSync } from 'fflate';

const MODELS = [
  { id:'pantomatrix', name:'PantoMatrix / EMAGE', source:'SMPL-X · REAL BACKEND' },
  { id:'streamtalk', name:'StreamTalk', source:'SMPL-X · pendiente' },
  { id:'unicamp', name:'UNICAMP GENEA', source:'SMPL-H · pendiente' },
  { id:'dlp3d', name:'DLP3D Speech2Motion', source:'3D motion · pendiente' },
  { id:'freeform', name:'Free-form Co-Speech', source:'pose sequence · pendiente' },
  { id:'custom', name:'Custom / imported', source:'Common JSON' },
];

const JOINTS = {
  hips:null, spine:'hips', chest:'spine', neck:'chest', head:'neck',
  leftShoulder:'chest', leftUpperArm:'leftShoulder', leftForeArm:'leftUpperArm', leftHand:'leftForeArm',
  rightShoulder:'chest', rightUpperArm:'rightShoulder', rightForeArm:'rightUpperArm', rightHand:'rightForeArm',
  leftUpperLeg:'hips', leftLowerLeg:'leftUpperLeg', leftFoot:'leftLowerLeg',
  rightUpperLeg:'hips', rightLowerLeg:'rightUpperLeg', rightFoot:'rightLowerLeg'
};

// Hierarchical offsets roughly matching an adult human in metres.
const REST = {
  hips:[0,1.02,0], spine:[0,.20,0], chest:[0,.30,0], neck:[0,.25,0], head:[0,.20,0],
  leftShoulder:[-.18,.05,0], leftUpperArm:[-.18,0,0], leftForeArm:[-.31,0,0], leftHand:[-.27,0,0],
  rightShoulder:[.18,.05,0], rightUpperArm:[.18,0,0], rightForeArm:[.31,0,0], rightHand:[.27,0,0],
  leftUpperLeg:[-.11,-.08,0], leftLowerLeg:[0,-.45,0], leftFoot:[0,-.43,.08],
  rightUpperLeg:[.11,-.08,0], rightLowerLeg:[0,-.45,0], rightFoot:[0,-.43,.08]
};

// SMPL-X standard body joint order (first 22 body joints).
const SMPLX_MAP = {
  hips:0,
  leftUpperLeg:1, rightUpperLeg:2,
  spine:3,
  leftLowerLeg:4, rightLowerLeg:5,
  chest:9,
  leftFoot:10, rightFoot:11,
  neck:12,
  leftShoulder:13, rightShoulder:14,
  head:15,
  leftUpperArm:16, rightUpperArm:17,
  leftForeArm:18, rightForeArm:19,
  leftHand:20, rightHand:21,
};

const state = {
  audio:document.querySelector('#audio'),
  audioFile:null,
  audioUrl:null,
  views:new Map(),
  viewMode:'front',
  showTrails:false,
  showRoot:true,
  intensity:1,
  imported:new Map(),
  generating:new Set(),
};

const $ = s => document.querySelector(s);
const grid = $('#grid');
const status = msg => { $('#backendStatus').textContent = msg; };

function formatTime(sec){
  if(!Number.isFinite(sec)) return '00:00.0';
  const m=Math.floor(sec/60), s=sec-m*60;
  return `${String(m).padStart(2,'0')}:${s.toFixed(1).padStart(4,'0')}`;
}

function buildCard(model){
  const card=document.createElement('article');
  card.className='viewer-card';
  card.dataset.model=model.id;
  card.innerHTML=`
    <div class="viewer-head">
      <div><div class="viewer-title">${model.name}</div><div class="viewer-meta">${model.source}</div></div>
      <span class="status">Sin resultado real</span>
    </div>
    <div class="canvas-wrap"></div>
    <div class="viewer-foot">
      <span class="metric">30 FPS</span><span class="metric">Same camera</span><span class="metric">Same rig</span>
      <span class="spacer"></span><button class="download" disabled>Descargar JSON</button>
    </div>`;
  grid.appendChild(card);
  const view=makeViewer(card.querySelector('.canvas-wrap'));
  state.views.set(model.id,{...view,model,card});
  card.querySelector('.download').addEventListener('click',()=>downloadMotion(model.id));
}

function makeViewer(container){
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(34,1,.01,100);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  container.appendChild(renderer.domElement);

  const root=new THREE.Group(); scene.add(root);
  const joints={}, bones=[];
  const jointMat=new THREE.MeshBasicMaterial({color:0xd8e1ff});
  const boneMat=new THREE.MeshBasicMaterial({color:0x8ca2ff});
  const rootMat=new THREE.MeshBasicMaterial({color:0xffc76b});

  for(const [name,parentName] of Object.entries(JOINTS)){
    const obj=new THREE.Group(); obj.name=name; obj.position.fromArray(REST[name]);
    const radius=name==='head'?.07:(name==='hips'?.035:.024);
    const sphere=new THREE.Mesh(new THREE.SphereGeometry(radius,14,10),name==='hips'?rootMat:jointMat);
    obj.add(sphere); joints[name]=obj;
    if(parentName) joints[parentName].add(obj); else root.add(obj);
  }
  root.updateMatrixWorld(true);
  for(const [name,parentName] of Object.entries(JOINTS)){
    if(!parentName) continue;
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.013,.013,1,8),boneMat);
    scene.add(mesh); bones.push({mesh,a:joints[parentName],b:joints[name]});
  }

  const pelvisBar=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.22,8),boneMat);
  pelvisBar.rotation.z=Math.PI/2; joints.hips.add(pelvisBar);
  const shoulderBar=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.36,8),boneMat);
  shoulderBar.rotation.z=Math.PI/2; joints.chest.add(shoulderBar);

  const trailMat=new THREE.LineBasicMaterial({color:0x7ce8ff,transparent:true,opacity:.7});
  const leftTrail=new THREE.Line(new THREE.BufferGeometry(),trailMat);
  const rightTrail=new THREE.Line(new THREE.BufferGeometry(),trailMat.clone());
  scene.add(leftTrail,rightTrail);
  const trails={left:[],right:[],leftTrail,rightTrail};

  camera.position.set(0,1.2,4); camera.lookAt(0,1.1,0);
  function resize(){
    const r=container.getBoundingClientRect(); renderer.setSize(r.width,r.height,false);
    camera.aspect=r.width/Math.max(1,r.height); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();
  return {scene,camera,renderer,root,joints,bones,trails};
}

function resetPose(view){
  for(const [name,obj] of Object.entries(view.joints)){
    obj.position.fromArray(REST[name]); obj.quaternion.identity();
  }
  view.root.position.set(0,0,0); view.root.quaternion.identity();
}

function neutralPose(view,t){
  resetPose(view);
  // Same subtle idle for every unconnected model. This is NOT model output.
  const i=state.intensity;
  view.joints.spine.rotation.z=Math.sin(t*.42)*.006*i;
  view.joints.chest.rotation.y=Math.sin(t*.31+.7)*.012*i;
  view.joints.neck.rotation.y=Math.sin(t*.38+1.4)*.01*i;
  view.joints.head.rotation.z=Math.sin(t*.29)*.006*i;
  // relaxed arms downward, tiny breathing only
  view.joints.leftUpperArm.rotation.z=.05;
  view.joints.rightUpperArm.rotation.z=-.05;
  view.root.position.y=Math.sin(t*.9)*.0015*i;
}

function sampleImported(data,t){
  const frames=data.frames||[]; if(!frames.length) return null;
  const fps=data.fps||30, f=Math.max(0,Math.min(frames.length-1,t*fps));
  const a=Math.floor(f), b=Math.min(frames.length-1,a+1); return {a:frames[a],b:frames[b],alpha:f-a};
}

function applyImported(view,data,t){
  resetPose(view); const s=sampleImported(data,t); if(!s) return;
  for(const joint of Object.keys(JOINTS)){
    const A=s.a?.joints?.[joint], B=s.b?.joints?.[joint]||A; if(!A||!B) continue;
    const obj=view.joints[joint];
    if(A.rotation&&B.rotation){
      const qa=new THREE.Quaternion(...A.rotation), qb=new THREE.Quaternion(...B.rotation);
      obj.quaternion.copy(qa).slerp(qb,s.alpha);
      if(state.intensity!==1){
        obj.quaternion.slerpQuaternions(new THREE.Quaternion(),obj.quaternion,state.intensity);
      }
    }
  }
}

function updateBones(view){
  const av=new THREE.Vector3(),bv=new THREE.Vector3(),mid=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  for(const bone of view.bones){
    bone.a.getWorldPosition(av); bone.b.getWorldPosition(bv);
    const dir=bv.clone().sub(av), dist=dir.length(); if(dist<1e-6) continue;
    mid.copy(av).add(bv).multiplyScalar(.5); bone.mesh.position.copy(mid); bone.mesh.scale.set(1,dist,1);
    bone.mesh.quaternion.setFromUnitVectors(up,dir.normalize());
  }
}

function updateTrails(view){
  const tr=view.trails;
  if(!state.showTrails){tr.leftTrail.visible=tr.rightTrail.visible=false;tr.left.length=tr.right.length=0;return;}
  tr.leftTrail.visible=tr.rightTrail.visible=true;
  const l=new THREE.Vector3(),r=new THREE.Vector3(); view.joints.leftHand.getWorldPosition(l);view.joints.rightHand.getWorldPosition(r);
  tr.left.push(l);tr.right.push(r);if(tr.left.length>60)tr.left.shift();if(tr.right.length>60)tr.right.shift();
  tr.leftTrail.geometry.setFromPoints(tr.left);tr.rightTrail.geometry.setFromPoints(tr.right);
}

function setCamera(view){
  if(state.viewMode==='front') view.camera.position.set(0,1.18,4);
  if(state.viewMode==='side') view.camera.position.set(4,1.18,0);
  if(state.viewMode==='threequarter') view.camera.position.set(2.7,1.35,2.7);
  view.camera.lookAt(0,1.1,0);
}

function render(){
  const t=state.audio.currentTime||0;
  for(const [id,view] of state.views){
    const data=state.imported.get(id); data?applyImported(view,data,t):neutralPose(view,t);
    view.joints.hips.children[0].visible=state.showRoot;
    view.root.updateMatrixWorld(true);updateBones(view);updateTrails(view);setCamera(view);view.renderer.render(view.scene,view.camera);
  }
  syncTimeline(); requestAnimationFrame(render);
}

function syncTimeline(){
  const a=state.audio; $('#currentTime').textContent=formatTime(a.currentTime);$('#duration').textContent=formatTime(a.duration);
  const tl=$('#timeline'); if(Number.isFinite(a.duration)&&a.duration>0&&document.activeElement!==tl) tl.value=String(a.currentTime/a.duration);
  $('#playPause').textContent=a.paused?'▶ Reproducir':'❚❚ Pausar';
}

function markImported(id,data,filename){
  const view=state.views.get(id); if(!view)return;
  state.imported.set(id,data); const badge=view.card.querySelector('.status');
  badge.textContent=`Movimiento real · ${filename}`;badge.classList.add('real');view.card.querySelector('.download').disabled=false;
}

function detectTarget(data,filename){
  if(data.model&&state.views.has(String(data.model).toLowerCase()))return String(data.model).toLowerCase();
  const f=filename.toLowerCase();return MODELS.find(m=>f.includes(m.id))?.id||'custom';
}

function downloadMotion(id){
  const data=state.imported.get(id);if(!data)return;
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`${id}-motion.json`;a.click();URL.revokeObjectURL(a.href);
}

function parseNpy(bytes){
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(dv.getUint8(0)!==0x93) throw new Error('NPY inválido');
  const major=dv.getUint8(6); let headerLen,off;
  if(major===1){headerLen=dv.getUint16(8,true);off=10;}else{headerLen=dv.getUint32(8,true);off=12;}
  const header=new TextDecoder().decode(bytes.subarray(off,off+headerLen));off+=headerLen;
  const descr=header.match(/'descr':\s*'([^']+)'/)?.[1];
  const shapeText=header.match(/'shape':\s*\(([^)]*)\)/)?.[1]||'';
  const shape=shapeText.split(',').map(x=>x.trim()).filter(Boolean).map(Number);
  if(!descr||!shape.length) throw new Error('Header NPY no soportado');
  const count=shape.reduce((a,b)=>a*b,1), out=new Float64Array(count);
  if(descr.endsWith('f4')) for(let i=0;i<count;i++)out[i]=dv.getFloat32(off+i*4,true);
  else if(descr.endsWith('f8')) for(let i=0;i<count;i++)out[i]=dv.getFloat64(off+i*8,true);
  else throw new Error(`dtype ${descr} no soportado`);
  return {shape,data:out};
}

function axisAngleQuat(x,y,z){
  const angle=Math.hypot(x,y,z); if(angle<1e-8)return [0,0,0,1];
  const s=Math.sin(angle/2)/angle; return [x*s,y*s,z*s,Math.cos(angle/2)];
}

function emageNpzToCommon(buffer){
  const zip=unzipSync(new Uint8Array(buffer));
  const keys=Object.keys(zip);
  const poseKey=keys.find(k=>/(^|\/)poses\.npy$/i.test(k));
  if(!poseKey) throw new Error(`El NPZ no contiene poses.npy (${keys.join(', ')})`);
  const poses=parseNpy(zip[poseKey]);
  const transKey=keys.find(k=>/(^|\/)trans\.npy$/i.test(k));
  const trans=transKey?parseNpy(zip[transKey]):null;
  const T=poses.shape[0], D=poses.shape[poses.shape.length-1];
  if(D<66) throw new Error(`poses tiene sólo ${D} valores por frame`);
  const frames=[];
  for(let f=0;f<T;f++){
    const joints={};
    for(const [name,idx] of Object.entries(SMPLX_MAP)){
      // Keep global pelvis neutral so every result faces the same benchmark camera.
      if(name==='hips'){joints[name]={rotation:[0,0,0,1]};continue;}
      const p=f*D+idx*3; joints[name]={rotation:axisAngleQuat(poses.data[p],poses.data[p+1],poses.data[p+2])};
    }
    const root={position:[0,0,0]};
    if(trans&&trans.shape[0]>f){const td=trans.shape[trans.shape.length-1];root.sourceTranslation=[trans.data[f*td],trans.data[f*td+1],trans.data[f*td+2]];}
    frames.push({joints,root});
  }
  return {model:'pantomatrix',generator:'PantoMatrix EMAGE official Hugging Face Space',fps:30,frames};
}

function resultUrl(v){
  if(!v)return null;if(typeof v==='string')return v;
  return v.url||v.path||v.orig_name||v.name||null;
}

async function generatePantoMatrix(){
  if(!state.audioFile||state.generating.has('pantomatrix'))return;
  state.generating.add('pantomatrix'); const btn=$('#generatePanto');btn.disabled=true;
  const badge=state.views.get('pantomatrix').card.querySelector('.status');badge.textContent='Conectando…';badge.classList.remove('real');
  try{
    status('PantoMatrix: conectando al Space oficial H-Liu1997/EMAGE…');
    const app=await Client.connect('H-Liu1997/EMAGE');
    let endpoint='/predict';
    try{
      const api=await app.view_api();
      const names=Object.keys(api?.named_endpoints||{}); if(names.length) endpoint=names[0];
    }catch(_){/* /predict is Gradio Interface default */}
    status('PantoMatrix: audio enviado. Esperando turno de ZeroGPU / generando movimiento real…');badge.textContent='Generando en ZeroGPU…';
    let result;
    const upload=handle_file(state.audioFile);
    const attempts=[
      ()=>app.predict(endpoint,{audio:upload}),
      ()=>app.predict(endpoint,{audio_path:upload}),
      ()=>app.predict('/predict',{audio:upload}),
    ];
    let lastErr;
    for(const attempt of attempts){try{result=await attempt();break;}catch(e){lastErr=e;}}
    if(!result)throw lastErr||new Error('El Space no devolvió resultado');
    const outputs=result.data||[];
    const candidate=outputs.find(x=>{const u=resultUrl(x)||'';return /\.npz($|\?)/i.test(u)||x?.orig_name?.toLowerCase?.().endsWith('.npz');})||outputs[1];
    const npzUrl=resultUrl(candidate); if(!npzUrl)throw new Error('EMAGE respondió, pero no encontré el archivo NPZ');
    status('PantoMatrix: descargando y convirtiendo SMPL-X al esqueleto común…');
    const res=await fetch(npzUrl);if(!res.ok)throw new Error(`No pude descargar NPZ (${res.status})`);
    const common=emageNpzToCommon(await res.arrayBuffer());markImported('pantomatrix',common,'EMAGE real');
    status(`PantoMatrix: LISTO · ${common.frames.length} frames reales a 30 FPS.`);badge.textContent='Movimiento real · EMAGE';
  }catch(err){
    console.error(err);badge.textContent='Error backend';status(`PantoMatrix: error — ${err?.message||err}`);
  }finally{state.generating.delete('pantomatrix');btn.disabled=!state.audioFile;}
}

for(const m of MODELS)buildCard(m);

$('#audioFile').addEventListener('change',e=>{
  const file=e.target.files?.[0];if(!file)return;state.audioFile=file;
  if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=URL.createObjectURL(file);state.audio.src=state.audioUrl;
  $('#fileName').textContent=file.name;$('#generatePanto').disabled=false;
  state.audio.addEventListener('loadedmetadata',()=>{$('#playPause').disabled=false;$('#restart').disabled=false;$('#timeline').disabled=false;syncTimeline();},{once:true});
});
$('#generatePanto').addEventListener('click',generatePantoMatrix);
$('#playPause').addEventListener('click',()=>state.audio.paused?state.audio.play():state.audio.pause());
$('#restart').addEventListener('click',()=>state.audio.currentTime=0);
$('#timeline').addEventListener('input',e=>{if(Number.isFinite(state.audio.duration))state.audio.currentTime=Number(e.target.value)*state.audio.duration;});
for(const btn of document.querySelectorAll('.view-button'))btn.addEventListener('click',()=>{state.viewMode=btn.dataset.view;document.querySelectorAll('.view-button').forEach(b=>b.classList.toggle('active',b===btn));});
$('#showTrails').addEventListener('change',e=>state.showTrails=e.target.checked);
$('#showRoot').addEventListener('change',e=>state.showRoot=e.target.checked);
$('#globalIntensity').addEventListener('input',e=>{state.intensity=Number(e.target.value);$('#intensityValue').textContent=`${state.intensity.toFixed(2)}×`;});
$('#motionFile').addEventListener('change',async e=>{for(const file of [...(e.target.files||[])]){try{const data=JSON.parse(await file.text());if(!Array.isArray(data.frames))throw new Error('Falta frames[]');markImported(detectTarget(data,file.name),data,file.name);}catch(err){alert(`No pude cargar ${file.name}: ${err.message}`);}}});

render();
