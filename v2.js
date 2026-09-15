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

const GROUP={
  hips:'torso',spine:'torso',chest:'torso',
  neck:'head',head:'head',
  leftShoulder:'arms',leftUpperArm:'arms',leftForeArm:'arms',leftHand:'arms',
  rightShoulder:'arms',rightUpperArm:'arms',rightForeArm:'arms',rightHand:'arms',
  leftUpperLeg:'legs',leftLowerLeg:'legs',leftFoot:'legs',
  rightUpperLeg:'legs',rightLowerLeg:'legs',rightFoot:'legs'
};

const state={
  motion:null,
  duration:0,
  playing:false,
  clockTime:0,
  clockStartedAt:0,
  audioUrl:null,
  hasAudio:false,
  view:'front',
  gains:{global:1,torso:1,arms:1,head:1,legs:1,smooth:.15},
  filtered:new Map(),
  lastSampleTime:null,
  footIK:false,
  footTargets:{left:null,right:null}
};

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0d131d);
const camera=new THREE.PerspectiveCamera(34,1,.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=false;
$('#viewer').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x263044,2.1));
const key=new THREE.DirectionalLight(0xffffff,2.8);key.position.set(2.5,4,3);scene.add(key);
const fill=new THREE.DirectionalLight(0xaec3ff,.9);fill.position.set(-3,2,1);scene.add(fill);
const floor=new THREE.Mesh(new THREE.CircleGeometry(1.25,64),new THREE.MeshStandardMaterial({color:0x151d29,roughness:1}));
floor.rotation.x=-Math.PI/2;scene.add(floor);

let modelRoot=null;
const bones={};
const restLocal={};
const restWorld={};

function normalize(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^mixamorig/,'');}
function findBone(joint,all){
  const wanted=TARGET_SUFFIX[joint]||[];
  for(const w of wanted){const b=all.find(x=>normalize(x.name)===w);if(b)return b;}
  for(const w of wanted){const b=all.find(x=>normalize(x.name).endsWith(w));if(b)return b;}
  return null;
}
function qIdentity(){return new THREE.Quaternion();}
function setStatus(text,real=false){const el=$('#modelStatus');el.textContent=text;el.classList.toggle('real',real);}

new GLTFLoader().load(MODEL_URL,gltf=>{
  modelRoot=gltf.scene;scene.add(modelRoot);
  modelRoot.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.castShadow=false;o.receiveShadow=false;}});
  const all=[];modelRoot.traverse(o=>{if(o.isBone)all.push(o);});
  for(const joint of Object.keys(JOINT_PARENT)){
    const b=findBone(joint,all);if(b){bones[joint]=b;restLocal[joint]=b.quaternion.clone();}
  }
  const box0=new THREE.Box3().setFromObject(modelRoot),size=box0.getSize(new THREE.Vector3()),center=box0.getCenter(new THREE.Vector3());
  const scale=size.y>0?1.75/size.y:1;
  modelRoot.scale.multiplyScalar(scale);
  modelRoot.position.set(-center.x*scale,-box0.min.y*scale,-center.z*scale);
  modelRoot.updateMatrixWorld(true);
  for(const [joint,b] of Object.entries(bones))restWorld[joint]=b.getWorldQuaternion(new THREE.Quaternion());
  const missing=Object.keys(JOINT_PARENT).filter(j=>!bones[j]);
  setStatus(missing.length?`Xbot listo · faltan ${missing.length} bones`:'Xbot listo · cargá JSON EMAGE',true);
  if(missing.length)console.warn('Bones faltantes:',missing,all.map(b=>b.name));
},undefined,err=>{console.error(err);setStatus('Error cargando Xbot');});

function resize(){const r=$('#viewer').getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($('#viewer'));resize();

function formatTime(sec){
  sec=Math.max(0,Number(sec)||0);const m=Math.floor(sec/60),s=sec-m*60;
  return `${String(m).padStart(2,'0')}:${s.toFixed(1).padStart(4,'0')}`;
}

function getTime(){
  const audio=$('#audio');
  if(state.hasAudio&&Number.isFinite(audio.currentTime))return Math.min(state.duration,audio.currentTime);
  if(!state.playing)return state.clockTime;
  return Math.min(state.duration,state.clockTime+(performance.now()-state.clockStartedAt)/1000);
}

function seek(t){
  t=Math.max(0,Math.min(state.duration,Number(t)||0));
  state.clockTime=t;state.clockStartedAt=performance.now();
  if(state.hasAudio){const audio=$('#audio');audio.currentTime=Math.min(t,Number.isFinite(audio.duration)?audio.duration:t);}
  resetFilter();
}

async function setPlaying(on){
  if(!state.motion)return;
  state.playing=on;
  if(on){
    if(getTime()>=state.duration-.001)seek(0);
    state.clockTime=getTime();state.clockStartedAt=performance.now();
    if(state.hasAudio){try{await $('#audio').play();}catch(e){console.warn(e);state.playing=false;}}
  }else{
    state.clockTime=getTime();state.clockStartedAt=performance.now();
    if(state.hasAudio)$('#audio').pause();
  }
  syncUi();
}

function sample(t){
  const frames=state.motion?.frames||[];if(!frames.length)return null;
  const fps=Number(state.motion.fps)||30;
  const f=Math.max(0,Math.min(frames.length-1,t*fps));
  const a=Math.floor(f),b=Math.min(frames.length-1,a+1);
  return {a:frames[a],b:frames[b],alpha:f-a};
}

function jointGain(joint){return state.gains.global*(state.gains[GROUP[joint]]??1);}

function resetFilter(){state.filtered.clear();state.lastSampleTime=null;}

function scaledLocalQuat(joint,A,B,alpha,t){
  const target=new THREE.Quaternion();
  if(A?.rotation&&B?.rotation){
    target.set(...A.rotation).slerp(new THREE.Quaternion(...B.rotation),alpha).normalize();
  }
  const gain=jointGain(joint);
  target.slerpQuaternions(qIdentity(),target,Math.max(0,Math.min(1.5,gain))).normalize();
  const smooth=state.gains.smooth;
  if(smooth<=.001)return target;
  const prev=state.filtered.get(joint);
  const jumped=state.lastSampleTime!=null&&(t<state.lastSampleTime-.05||Math.abs(t-state.lastSampleTime)>.25);
  if(!prev||jumped){state.filtered.set(joint,target.clone());return target;}
  const follow=Math.max(.035,1-smooth*.94);
  prev.slerp(target,follow).normalize();
  return prev.clone();
}

function sourceGlobals(s,t){
  const globals={};
  for(const joint of Object.keys(JOINT_PARENT)){
    const A=s.a?.joints?.[joint],B=s.b?.joints?.[joint]||A;
    const local=scaledLocalQuat(joint,A,B,s.alpha,t);
    const p=JOINT_PARENT[joint];
    globals[joint]=p&&globals[p]?globals[p].clone().multiply(local):local;
  }
  state.lastSampleTime=t;
  return globals;
}

function applyMotion(t){
  if(!modelRoot||!state.motion)return;
  const s=sample(t);if(!s)return;
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
  if(state.footIK)solveFeet();
}

function footWorld(side){
  const b=bones[side==='left'?'leftFoot':'rightFoot'];
  return b?.getWorldPosition(new THREE.Vector3())||null;
}

function captureFeet(){
  if(!modelRoot||!state.motion)return;
  modelRoot.updateMatrixWorld(true);
  const l=footWorld('left'),r=footWorld('right');
  if(l)state.footTargets.left=l.clone();
  if(r)state.footTargets.right=r.clone();
  $('#recaptureFeet').disabled=!(l&&r);
}

function rotateBoneToward(bone,effector,target){
  const pivot=bone.getWorldPosition(new THREE.Vector3());
  const end=effector.getWorldPosition(new THREE.Vector3());
  const from=end.sub(pivot),to=target.clone().sub(pivot);
  if(from.lengthSq()<1e-8||to.lengthSq()<1e-8)return;
  from.normalize();to.normalize();
  const deltaWorld=new THREE.Quaternion().setFromUnitVectors(from,to);
  const world=bone.getWorldQuaternion(new THREE.Quaternion());
  const desiredWorld=deltaWorld.multiply(world);
  const parentWorld=bone.parent?.getWorldQuaternion(new THREE.Quaternion())||qIdentity();
  bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
  bone.updateMatrixWorld(true);
}

function solveLeg(side,target){
  if(!target)return;
  const upper=bones[side==='left'?'leftUpperLeg':'rightUpperLeg'];
  const lower=bones[side==='left'?'leftLowerLeg':'rightLowerLeg'];
  const foot=bones[side==='left'?'leftFoot':'rightFoot'];
  if(!upper||!lower||!foot)return;
  // Small CCD solver: preserves EMAGE pose as the starting solution and only
  // adds the correction needed to keep the foot at the captured point.
  for(let i=0;i<5;i++){
    rotateBoneToward(lower,foot,target);
    modelRoot.updateMatrixWorld(true);
    rotateBoneToward(upper,foot,target);
    modelRoot.updateMatrixWorld(true);
    if(foot.getWorldPosition(new THREE.Vector3()).distanceTo(target)<.002)break;
  }
}

function solveFeet(){
  solveLeg('left',state.footTargets.left);
  solveLeg('right',state.footTargets.right);
}

function setCamera(){
  if(state.view==='front')camera.position.set(0,1.18,4);
  if(state.view==='side')camera.position.set(4,1.18,0);
  if(state.view==='threequarter')camera.position.set(2.7,1.35,2.7);
  camera.lookAt(0,1.06,0);
}

function syncUi(){
  const t=getTime();
  $('#timeNow').textContent=formatTime(t);$('#timeTotal').textContent=formatTime(state.duration);
  if(state.duration>0&&document.activeElement!==$('#timeline'))$('#timeline').value=String(t/state.duration);
  $('#play').textContent=state.playing?'❚❚ Pausar':'▶ Reproducir';
}

$('#motionFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.frames)||!data.frames.length)throw new Error('El JSON no contiene frames[]');
    state.motion=data;state.duration=data.frames.length/(Number(data.fps)||30);seek(0);resetFilter();
    $('#motionName').textContent=`${file.name} · ${data.frames.length} frames · ${Number(data.fps)||30} FPS`;
    $('#play').disabled=false;$('#restart').disabled=false;$('#timeline').disabled=false;
    setStatus(`Movimiento listo · ${state.duration.toFixed(1)} s`,true);
    applyMotion(0);
    if(state.footIK)captureFeet();
  }catch(err){console.error(err);alert(`No pude cargar el JSON: ${err.message}`);}
});

$('#audioFile').addEventListener('change',e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);
  state.audioUrl=URL.createObjectURL(file);const audio=$('#audio');audio.src=state.audioUrl;state.hasAudio=true;
  $('#audioName').textContent=file.name;$('#clearAudio').disabled=false;
  audio.addEventListener('loadedmetadata',()=>{audio.currentTime=Math.min(state.clockTime,audio.duration||state.clockTime);},{once:true});
});

$('#clearAudio').addEventListener('click',()=>{
  const t=getTime();const audio=$('#audio');audio.pause();audio.removeAttribute('src');audio.load();
  if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=null;state.hasAudio=false;state.clockTime=t;state.clockStartedAt=performance.now();
  $('#audioFile').value='';$('#audioName').textContent='Sin audio · usa reloj interno';$('#clearAudio').disabled=true;
});

$('#audio').addEventListener('ended',()=>{if(state.hasAudio)setPlaying(false);});
$('#play').addEventListener('click',()=>setPlaying(!state.playing));
$('#restart').addEventListener('click',()=>{seek(0);if(state.footIK){applyMotion(0);captureFeet();}});
$('#timeline').addEventListener('input',e=>{seek(Number(e.target.value)*state.duration);if(state.footIK){applyMotion(getTime());captureFeet();}});

const sliders=[
  ['globalGain','global','globalGainValue',true],['torsoGain','torso','torsoGainValue',true],['armsGain','arms','armsGainValue',true],
  ['headGain','head','headGainValue',true],['legsGain','legs','legsGainValue',true],['smoothGain','smooth','smoothGainValue',false]
];
for(const [id,key,out,mult] of sliders){
  $('#'+id).addEventListener('input',e=>{state.gains[key]=Number(e.target.value);$('#'+out).textContent=mult?`${state.gains[key].toFixed(2)}×`:state.gains[key].toFixed(2);resetFilter();});
}
$('#resetGains').addEventListener('click',()=>{
  const defaults={global:1,torso:1,arms:1,head:1,legs:1,smooth:.15};
  for(const [id,key,out,mult] of sliders){state.gains[key]=defaults[key];$('#'+id).value=String(defaults[key]);$('#'+out).textContent=mult?`${defaults[key].toFixed(2)}×`:defaults[key].toFixed(2);}resetFilter();
});

$('#footIK').addEventListener('change',e=>{
  if(e.target.checked&&!state.motion){e.target.checked=false;return;}
  state.footIK=e.target.checked;
  if(state.footIK){applyMotion(getTime());captureFeet();}else{$('#recaptureFeet').disabled=true;}
});
$('#recaptureFeet').addEventListener('click',()=>{applyMotion(getTime());captureFeet();});
for(const btn of document.querySelectorAll('.view'))btn.addEventListener('click',()=>{state.view=btn.dataset.view;document.querySelectorAll('.view').forEach(b=>b.classList.toggle('active',b===btn));});

function animate(){
  requestAnimationFrame(animate);
  let t=getTime();
  if(state.playing&&!state.hasAudio&&t>=state.duration){state.playing=false;state.clockTime=state.duration;}
  if(state.motion)applyMotion(t);
  setCamera();syncUi();renderer.render(scene,camera);
}
animate();
