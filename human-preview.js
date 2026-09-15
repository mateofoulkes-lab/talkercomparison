import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';

// Human diagnostic preview for EMAGE/Common Motion JSON.
// Xbot is a standard humanoid/Mixamo-style rig from the official Three.js examples.
const MODEL_URL='https://cdn.jsdelivr.net/gh/mrdoob/three.js@r180/examples/models/gltf/Xbot.glb';

const JOINT_PARENT={
  hips:null,spine:'hips',chest:'spine',neck:'chest',head:'neck',
  leftShoulder:'chest',leftUpperArm:'leftShoulder',leftForeArm:'leftUpperArm',leftHand:'leftForeArm',
  rightShoulder:'chest',rightUpperArm:'rightShoulder',rightForeArm:'rightUpperArm',rightHand:'rightForeArm',
  leftUpperLeg:'hips',leftLowerLeg:'leftUpperLeg',leftFoot:'leftLowerLeg',
  rightUpperLeg:'hips',rightLowerLeg:'rightUpperLeg',rightFoot:'rightLowerLeg'
};

const TARGET_SUFFIX={
  hips:['hips'],
  spine:['spine'],
  chest:['spine2','spine1'],
  neck:['neck'],head:['head'],
  leftShoulder:['leftshoulder'],leftUpperArm:['leftarm'],leftForeArm:['leftforearm'],leftHand:['lefthand'],
  rightShoulder:['rightshoulder'],rightUpperArm:['rightarm'],rightForeArm:['rightforearm'],rightHand:['righthand'],
  leftUpperLeg:['leftupleg'],leftLowerLeg:['leftleg'],leftFoot:['leftfoot'],
  rightUpperLeg:['rightupleg'],rightLowerLeg:['rightleg'],rightFoot:['rightfoot']
};

const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^mixamorig/,'');
const qIdentity=()=>new THREE.Quaternion();

const grid=document.querySelector('#grid');
const card=document.createElement('article');
card.className='viewer-card human-preview-card';
card.innerHTML=`
  <div class="viewer-head">
    <div><div class="viewer-title">EMAGE · cuerpo 3D</div><div class="viewer-meta">Xbot humanoide · retarget diagnóstico</div></div>
    <span class="status" id="humanPreviewStatus">Cargando modelo…</span>
  </div>
  <div class="canvas-wrap" id="humanPreviewCanvas"></div>
  <div class="viewer-foot">
    <span class="metric">Mismo JSON</span><span class="metric">Misma timeline</span><span class="metric">Retarget humanoide</span>
    <span class="spacer"></span><span class="metric">Three.js Xbot</span>
  </div>`;
// Put it immediately after the EMAGE card if possible.
const emageCard=grid?.querySelector('[data-model="pantomatrix"]');
if(grid){ if(emageCard?.nextSibling) grid.insertBefore(card,emageCard.nextSibling); else grid.appendChild(card); }

const container=card.querySelector('#humanPreviewCanvas');
const statusEl=card.querySelector('#humanPreviewStatus');
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(34,1,.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x263044,2.2));
const key=new THREE.DirectionalLight(0xffffff,2.6);key.position.set(2.5,4,3);scene.add(key);
const fill=new THREE.DirectionalLight(0x9fb7ff,1.0);fill.position.set(-3,2,1);scene.add(fill);
const floor=new THREE.Mesh(new THREE.CircleGeometry(1.2,64),new THREE.MeshStandardMaterial({color:0x111722,roughness:1,transparent:true,opacity:.72}));
floor.rotation.x=-Math.PI/2;floor.position.y=.002;scene.add(floor);

camera.position.set(0,1.18,4);camera.lookAt(0,1.05,0);
function resize(){const r=container.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(container);resize();

let modelRoot=null;
let bones={};
let restLocal={};
let restWorld={};
let motion=null;

function findBoneFor(joint,allBones){
  const candidates=TARGET_SUFFIX[joint]||[];
  for(const wanted of candidates){
    const exact=allBones.find(b=>normalize(b.name)===wanted); if(exact)return exact;
  }
  for(const wanted of candidates){
    const suffix=allBones.find(b=>normalize(b.name).endsWith(wanted)); if(suffix)return suffix;
  }
  return null;
}

new GLTFLoader().load(MODEL_URL,gltf=>{
  modelRoot=gltf.scene;
  scene.add(modelRoot);
  modelRoot.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.castShadow=false;o.receiveShadow=false;}});
  const allBones=[];modelRoot.traverse(o=>{if(o.isBone)allBones.push(o);});
  for(const joint of Object.keys(JOINT_PARENT)){
    const b=findBoneFor(joint,allBones);
    if(b){bones[joint]=b;restLocal[joint]=b.quaternion.clone();}
  }
  modelRoot.updateMatrixWorld(true);
  for(const [joint,b] of Object.entries(bones))restWorld[joint]=b.getWorldQuaternion(new THREE.Quaternion());
  const box=new THREE.Box3().setFromObject(modelRoot), size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
  const scale=size.y>0?1.75/size.y:1;modelRoot.scale.multiplyScalar(scale);modelRoot.position.x-=center.x*scale;modelRoot.position.z-=center.z*scale;modelRoot.position.y-=box.min.y*scale;
  modelRoot.updateMatrixWorld(true);
  // Re-capture world rest after normalization.
  for(const [joint,b] of Object.entries(bones))restWorld[joint]=b.getWorldQuaternion(new THREE.Quaternion());
  const missing=Object.keys(JOINT_PARENT).filter(j=>!bones[j]);
  statusEl.textContent=missing.length?`Modelo listo · faltan ${missing.length} bones`:'Modelo listo · cargá JSON EMAGE';
  if(missing.length)console.warn('Human preview bones faltantes:',missing,allBones.map(b=>b.name));
},undefined,err=>{console.error(err);statusEl.textContent='Error cargando Xbot';});

function sample(data,t){
  const frames=data?.frames||[];if(!frames.length)return null;
  const fps=Number(data.fps)||30;
  const f=Math.max(0,Math.min(frames.length-1,t*fps));
  const a=Math.floor(f),b=Math.min(frames.length-1,a+1);
  return {a:frames[a],b:frames[b],alpha:f-a};
}

function sourceGlobals(sampled){
  const globals={};
  for(const joint of Object.keys(JOINT_PARENT)){
    const A=sampled.a?.joints?.[joint],B=sampled.b?.joints?.[joint]||A;
    let local=qIdentity();
    if(A?.rotation&&B?.rotation){
      const qa=new THREE.Quaternion(...A.rotation),qb=new THREE.Quaternion(...B.rotation);
      local.copy(qa).slerp(qb,sampled.alpha).normalize();
    }
    const p=JOINT_PARENT[joint];
    globals[joint]=p&&globals[p]?globals[p].clone().multiply(local):local;
  }
  return globals;
}

// SMPL-X body rotations are local rotations from its zero-pose, whose joint
// coordinate frames are aligned. Transfer the GLOBAL rotational delta onto
// Xbot's captured bind/rest world orientation, then solve back to target local.
function applyMotion(data,t){
  if(!modelRoot||!Object.keys(bones).length)return;
  const s=sample(data,t);if(!s)return;
  for(const [joint,b] of Object.entries(bones))b.quaternion.copy(restLocal[joint]);
  modelRoot.updateMatrixWorld(true);
  const src=sourceGlobals(s);
  for(const joint of Object.keys(JOINT_PARENT)){
    const b=bones[joint];if(!b||!src[joint]||!restWorld[joint])continue;
    const desiredWorld=src[joint].clone().multiply(restWorld[joint]);
    const parentWorld=b.parent?.getWorldQuaternion(new THREE.Quaternion())||qIdentity();
    b.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
    b.updateMatrixWorld(true);
  }
  modelRoot.updateMatrixWorld(true);
}

function setCameraFromUi(){
  const active=document.querySelector('.view-button.active')?.dataset?.view||'front';
  if(active==='front')camera.position.set(0,1.18,4);
  if(active==='side')camera.position.set(4,1.18,0);
  if(active==='threequarter')camera.position.set(2.7,1.35,2.7);
  camera.lookAt(0,1.08,0);
}

const motionInput=document.querySelector('#motionFile');
motionInput?.addEventListener('change',async e=>{
  for(const file of [...(e.target.files||[])]){
    try{
      const data=JSON.parse(await file.text());
      if(!Array.isArray(data.frames))continue;
      const model=String(data.model||'').toLowerCase();
      const likelyEmage=model==='pantomatrix'||/emage|pantomatrix/i.test(file.name)||data.generator?.toLowerCase?.().includes('emage');
      if(likelyEmage){motion=data;statusEl.textContent=`Movimiento cargado · ${file.name}`;statusEl.classList.add('real');break;}
    }catch(err){console.warn('Human preview no pudo leer',file.name,err);}
  }
});

function animate(){
  requestAnimationFrame(animate);
  if(motion)applyMotion(motion,document.querySelector('#audio')?.currentTime||0);
  setCameraFromUi();renderer.render(scene,camera);
}
animate();
