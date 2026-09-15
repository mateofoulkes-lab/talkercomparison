import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';

const MODEL_URL='https://cdn.jsdelivr.net/gh/mrdoob/three.js@r180/examples/models/gltf/Xbot.glb';
const $=s=>document.querySelector(s);

const JOINT_PARENT={
  hips:null,spine:'hips',chest:'spine',neck:'chest',head:'neck',
  leftShoulder:'chest',leftUpperArm:'leftShoulder',leftForeArm:'leftUpperArm',leftHand:'leftForeArm',
  rightShoulder:'chest',rightUpperArm:'rightShoulder',rightForeArm:'rightUpperArm',rightHand:'rightForeArm',
  leftUpperLeg:'hips',leftLowerLeg:'leftUpperLeg',leftFoot:'leftLowerLeg',
  rightUpperLeg:'hips',rightLowerLeg:'rightUpperLeg',rightFoot:'rightLowerLeg'
};

const TARGET_SUFFIX={
  hips:['hips'],spine:['spine'],chest:['spine2','spine1'],neck:['neck'],head:['head'],
  leftShoulder:['leftshoulder'],leftUpperArm:['leftarm'],leftForeArm:['leftforearm'],leftHand:['lefthand'],
  rightShoulder:['rightshoulder'],rightUpperArm:['rightarm'],rightForeArm:['rightforearm'],rightHand:['righthand'],
  leftUpperLeg:['leftupleg'],leftLowerLeg:['leftleg'],leftFoot:['leftfoot'],
  rightUpperLeg:['rightupleg'],rightLowerLeg:['rightleg'],rightFoot:['rightfoot']
};

const LEG_JOINTS=new Set([
  'leftUpperLeg','leftLowerLeg','leftFoot',
  'rightUpperLeg','rightLowerLeg','rightFoot'
]);

const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^mixamorig/,'');
const qIdentity=()=>new THREE.Quaternion();

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0d131d);
const camera=new THREE.PerspectiveCamera(34,1,.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
$('#viewer').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x263044,2.2));
const key=new THREE.DirectionalLight(0xffffff,2.6);key.position.set(2.5,4,3);scene.add(key);
const fill=new THREE.DirectionalLight(0x9fb7ff,1.0);fill.position.set(-3,2,1);scene.add(fill);
const floor=new THREE.Mesh(new THREE.CircleGeometry(1.2,64),new THREE.MeshStandardMaterial({color:0x111722,roughness:1,transparent:true,opacity:.72}));
floor.rotation.x=-Math.PI/2;floor.position.y=.002;scene.add(floor);
camera.position.set(0,1.18,4);camera.lookAt(0,1.05,0);

let modelRoot=null;
let bones={};
let restLocal={};
let restWorld={};
let motion=null;
let duration=0;
let playing=false;
let playhead=0;
let startedAt=0;
let hasAudio=false;
let audioUrl=null;
let footIK=false;

const motionSettings={legs:1,body:1,smooth:0};
const smoothQuats=new Map();
let lastSmoothTime=null;
const referenceQuats=new Map();
let referenceTime=null;

const footTargets={
  left:{position:null,rotation:null,groundY:null},
  right:{position:null,rotation:null,groundY:null}
};
const restFootGroundY={left:null,right:null};

function resize(){const r=$('#viewer').getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($('#viewer'));resize();

function findBoneFor(joint,allBones){
  const candidates=TARGET_SUFFIX[joint]||[];
  for(const wanted of candidates){const exact=allBones.find(b=>normalize(b.name)===wanted);if(exact)return exact;}
  for(const wanted of candidates){const suffix=allBones.find(b=>normalize(b.name).endsWith(wanted));if(suffix)return suffix;}
  return null;
}

function setStatus(text,real=false){const el=$('#modelStatus');el.textContent=text;el.classList.toggle('real',real);}

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
  const box=new THREE.Box3().setFromObject(modelRoot),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const scale=size.y>0?1.75/size.y:1;
  modelRoot.scale.multiplyScalar(scale);
  modelRoot.position.x-=center.x*scale;
  modelRoot.position.z-=center.z*scale;
  modelRoot.position.y-=box.min.y*scale;
  modelRoot.updateMatrixWorld(true);
  for(const [joint,b] of Object.entries(bones))restWorld[joint]=b.getWorldQuaternion(new THREE.Quaternion());
  const leftRest=bones.leftFoot?.getWorldPosition(new THREE.Vector3());
  const rightRest=bones.rightFoot?.getWorldPosition(new THREE.Vector3());
  restFootGroundY.left=leftRest?.y??null;
  restFootGroundY.right=rightRest?.y??null;
  const missing=Object.keys(JOINT_PARENT).filter(j=>!bones[j]);
  setStatus(missing.length?`Modelo listo · faltan ${missing.length} bones`:'Modelo listo · cargá JSON EMAGE',true);
  if(missing.length)console.warn('Human preview bones faltantes:',missing,allBones.map(b=>b.name));
  if(motion)applyMotion(motion,currentTime());
},undefined,err=>{console.error(err);setStatus('Error cargando Xbot');});

function sample(data,t){
  const frames=data?.frames||[];if(!frames.length)return null;
  const fps=Number(data.fps)||30;
  const f=Math.max(0,Math.min(frames.length-1,t*fps));
  const a=Math.floor(f),b=Math.min(frames.length-1,a+1);
  return {a:frames[a],b:frames[b],alpha:f-a};
}

function resetSmoothing(){
  smoothQuats.clear();
  lastSmoothTime=null;
}

function rawLocalQuat(A,B,alpha){
  const local=qIdentity();
  if(A?.rotation&&B?.rotation){
    const qa=new THREE.Quaternion(...A.rotation),qb=new THREE.Quaternion(...B.rotation);
    local.copy(qa).slerp(qb,alpha).normalize();
  }
  return local;
}

function captureReferencePose(){
  if(!motion)return;
  const t=currentTime();
  const s=sample(motion,t);if(!s)return;
  referenceQuats.clear();
  for(const joint of Object.keys(JOINT_PARENT)){
    const A=s.a?.joints?.[joint],B=s.b?.joints?.[joint]||A;
    referenceQuats.set(joint,rawLocalQuat(A,B,s.alpha));
  }
  referenceTime=t;
  resetSmoothing();
  $('#referenceInfo').textContent=`Referencia: ${formatTime(t)}`;
  if(motion)applyMotion(motion,t);
}

function adjustedLocalQuat(joint,A,B,alpha,jumped){
  const local=rawLocalQuat(A,B,alpha);

  // 0 = frame de referencia elegido; 1 = animación original.
  // Si todavía no se definió referencia, conserva el comportamiento anterior (T-pose/identidad).
  const gain=LEG_JOINTS.has(joint)?motionSettings.legs:motionSettings.body;
  const reference=referenceQuats.get(joint)||qIdentity();
  const attenuated=new THREE.Quaternion().slerpQuaternions(
    reference,
    local,
    THREE.MathUtils.clamp(gain,0,1)
  ).normalize();

  const smooth=motionSettings.smooth;
  if(smooth<=0.001)return attenuated;

  const prev=smoothQuats.get(joint);
  if(!prev||jumped){
    smoothQuats.set(joint,attenuated.clone());
    return attenuated;
  }

  const follow=THREE.MathUtils.lerp(1,0.06,smooth);
  prev.slerp(attenuated,follow).normalize();
  return prev.clone();
}

function sourceGlobals(sampled,t){
  const globals={};
  const jumped=lastSmoothTime!==null&&(t<lastSmoothTime-0.02||Math.abs(t-lastSmoothTime)>0.25);
  if(jumped)smoothQuats.clear();

  for(const joint of Object.keys(JOINT_PARENT)){
    const A=sampled.a?.joints?.[joint],B=sampled.b?.joints?.[joint]||A;
    const local=adjustedLocalQuat(joint,A,B,sampled.alpha,jumped);
    const p=JOINT_PARENT[joint];
    globals[joint]=p&&globals[p]?globals[p].clone().multiply(local):local;
  }
  lastSmoothTime=t;
  return globals;
}

// Copia fiel del retarget usado por human-preview.js original.
// Los controles sólo modifican las rotaciones fuente antes de entrar acá.
function applyMotion(data,t){
  if(!modelRoot||!Object.keys(bones).length)return;
  const s=sample(data,t);if(!s)return;
  for(const [joint,b] of Object.entries(bones))b.quaternion.copy(restLocal[joint]);
  modelRoot.updateMatrixWorld(true);
  const src=sourceGlobals(s,t);
  for(const joint of Object.keys(JOINT_PARENT)){
    const b=bones[joint];if(!b||!src[joint]||!restWorld[joint])continue;
    const desiredWorld=src[joint].clone().multiply(restWorld[joint]);
    const parentWorld=b.parent?.getWorldQuaternion(new THREE.Quaternion())||qIdentity();
    b.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
    b.updateMatrixWorld(true);
  }
  modelRoot.updateMatrixWorld(true);
  if(footIK)solveFeetIK();
}

function footWorld(side){
  const foot=bones[side==='left'?'leftFoot':'rightFoot'];
  return foot?.getWorldPosition(new THREE.Vector3())||null;
}

function captureFootTargets(){
  if(!modelRoot)return;
  modelRoot.updateMatrixWorld(true);
  for(const side of ['left','right']){
    const foot=bones[side==='left'?'leftFoot':'rightFoot'];
    if(!foot)continue;
    const p=foot.getWorldPosition(new THREE.Vector3());
    p.y=restFootGroundY[side]??p.y;
    footTargets[side].position=p;
    footTargets[side].rotation=restWorld[side==='left'?'leftFoot':'rightFoot']?.clone()||foot.getWorldQuaternion(new THREE.Quaternion());
    footTargets[side].groundY=p.y;
  }
}

function rotateBoneToward(bone,effector,target){
  const pivot=bone.getWorldPosition(new THREE.Vector3());
  const end=effector.getWorldPosition(new THREE.Vector3());
  const from=end.sub(pivot),to=target.clone().sub(pivot);
  if(from.lengthSq()<1e-10||to.lengthSq()<1e-10)return;
  const deltaWorld=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
  const currentWorld=bone.getWorldQuaternion(new THREE.Quaternion());
  const desiredWorld=deltaWorld.multiply(currentWorld);
  const parentWorld=bone.parent?.getWorldQuaternion(new THREE.Quaternion())||qIdentity();
  bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
  bone.updateMatrixWorld(true);
}

function setBoneWorldRotation(bone,targetWorld){
  if(!bone||!targetWorld)return;
  const parentWorld=bone.parent?.getWorldQuaternion(new THREE.Quaternion())||qIdentity();
  bone.quaternion.copy(parentWorld.invert().multiply(targetWorld)).normalize();
  bone.updateMatrixWorld(true);
}

function solveLegIK(side,target){
  if(!target?.position)return;
  const upper=bones[side==='left'?'leftUpperLeg':'rightUpperLeg'];
  const lower=bones[side==='left'?'leftLowerLeg':'rightLowerLeg'];
  const foot=bones[side==='left'?'leftFoot':'rightFoot'];
  if(!upper||!lower||!foot)return;
  for(let i=0;i<10;i++){
    rotateBoneToward(lower,foot,target.position);
    modelRoot.updateMatrixWorld(true);
    rotateBoneToward(upper,foot,target.position);
    modelRoot.updateMatrixWorld(true);
    if(foot.getWorldPosition(new THREE.Vector3()).distanceTo(target.position)<0.0008)break;
  }
  setBoneWorldRotation(foot,target.rotation);
  modelRoot.updateMatrixWorld(true);
}

function solveFeetIK(){
  solveLegIK('left',footTargets.left);
  solveLegIK('right',footTargets.right);
  modelRoot.updateMatrixWorld(true);
}

function currentTime(){
  if(hasAudio){const a=$('#audio');return Math.min(duration,Number(a.currentTime)||0);}
  if(!playing)return playhead;
  return Math.min(duration,playhead+(performance.now()-startedAt)/1000);
}

function seek(t){
  t=Math.max(0,Math.min(duration,Number(t)||0));
  playhead=t;startedAt=performance.now();
  if(hasAudio){const a=$('#audio');if(Number.isFinite(a.duration)&&a.duration>0)a.currentTime=Math.min(t,a.duration);}
  resetSmoothing();
}

async function setPlaying(on){
  if(!motion)return;
  const now=currentTime();
  if(on){
    if(now>=duration-.001)seek(0);else{playhead=now;startedAt=performance.now();}
    playing=true;
    if(hasAudio){try{await $('#audio').play();}catch(e){console.warn(e);playing=false;}}
  }else{
    playhead=now;startedAt=performance.now();playing=false;
    if(hasAudio)$('#audio').pause();
  }
  syncUi();
}

function formatTime(sec){sec=Math.max(0,Number(sec)||0);const m=Math.floor(sec/60),s=sec-m*60;return `${String(m).padStart(2,'0')}:${s.toFixed(1).padStart(4,'0')}`;}
function syncUi(){
  const t=currentTime();
  $('#timeNow').textContent=formatTime(t);$('#timeTotal').textContent=formatTime(duration);
  if(duration>0&&document.activeElement!==$('#timeline'))$('#timeline').value=String(t/duration);
  $('#play').textContent=playing?'❚❚ Pausar':'▶ Reproducir';
}

function setMotionControl(key,value){
  motionSettings[key]=Number(value);
  resetSmoothing();
  if(motion)applyMotion(motion,currentTime());
}

$('#legsGain').addEventListener('input',e=>{
  setMotionControl('legs',e.target.value);
  $('#legsGainValue').textContent=`${Math.round(motionSettings.legs*100)}%`;
});
$('#bodyGain').addEventListener('input',e=>{
  setMotionControl('body',e.target.value);
  $('#bodyGainValue').textContent=`${Math.round(motionSettings.body*100)}%`;
});
$('#smoothGain').addEventListener('input',e=>{
  setMotionControl('smooth',e.target.value);
  $('#smoothGainValue').textContent=`${Math.round(motionSettings.smooth*100)}%`;
});
$('#setReferencePose').addEventListener('click',()=>captureReferencePose());
$('#resetMotionControls').addEventListener('click',()=>{
  motionSettings.legs=1;motionSettings.body=1;motionSettings.smooth=0;
  $('#legsGain').value='1';$('#bodyGain').value='1';$('#smoothGain').value='0';
  $('#legsGainValue').textContent='100%';$('#bodyGainValue').textContent='100%';$('#smoothGainValue').textContent='0%';
  resetSmoothing();
  if(motion)applyMotion(motion,currentTime());
});

$('#motionFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.frames)||!data.frames.length)throw new Error('El JSON no contiene frames[]');
    motion=data;
    referenceQuats.clear();referenceTime=null;
    $('#referenceInfo').textContent='Referencia: T-pose (por defecto)';
    duration=data.frames.length/(Number(data.fps)||30);
    playing=false;seek(0);
    $('#motionName').textContent=`${file.name} · ${data.frames.length} frames · ${Number(data.fps)||30} FPS`;
    $('#play').disabled=false;$('#restart').disabled=false;$('#timeline').disabled=false;
    setStatus(`Movimiento listo · ${duration.toFixed(1)} s`,true);
    applyMotion(motion,0);
    if(footIK)captureFootTargets();
  }catch(err){console.error(err);alert(`No pude cargar el JSON: ${err.message}`);}
});

$('#audioFile').addEventListener('change',e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioUrl=URL.createObjectURL(file);
  const a=$('#audio');a.src=audioUrl;hasAudio=true;
  $('#audioName').textContent=file.name;$('#clearAudio').disabled=false;
  a.addEventListener('loadedmetadata',()=>{if(Number.isFinite(a.duration)&&a.duration>0)a.currentTime=Math.min(playhead,a.duration);},{once:true});
});

$('#clearAudio').addEventListener('click',()=>{
  const t=currentTime(),a=$('#audio');a.pause();a.removeAttribute('src');a.load();
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioUrl=null;hasAudio=false;playhead=t;startedAt=performance.now();
  $('#audioFile').value='';$('#audioName').textContent='Sin audio · usa reloj interno';$('#clearAudio').disabled=true;
});

$('#audio').addEventListener('ended',()=>setPlaying(false));
$('#play').addEventListener('click',()=>setPlaying(!playing));
$('#restart').addEventListener('click',()=>{playing=false;$('#audio').pause();seek(0);applyMotion(motion,0);if(footIK)captureFootTargets();syncUi();});
$('#timeline').addEventListener('input',e=>{seek(Number(e.target.value)*duration);applyMotion(motion,currentTime());if(footIK)captureFootTargets();syncUi();});
$('#footIK').addEventListener('change',e=>{
  footIK=e.target.checked;
  if(footIK&&motion){
    applyMotion(motion,currentTime());
    captureFootTargets();
  }
});
$('#recaptureFeet').addEventListener('click',()=>{
  if(!motion||!footIK)return;
  applyMotion(motion,currentTime());
  captureFootTargets();
});

function animate(){
  requestAnimationFrame(animate);
  let t=currentTime();
  if(playing&&!hasAudio&&t>=duration){playing=false;playhead=duration;t=duration;}
  if(motion)applyMotion(motion,t);
  syncUi();renderer.render(scene,camera);
}
animate();