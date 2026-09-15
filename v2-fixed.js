import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import * as SkeletonUtils from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/utils/SkeletonUtils.js';

const MODEL_URL='https://cdn.jsdelivr.net/gh/mrdoob/three.js@r180/examples/models/gltf/Xbot.glb';
const $=s=>document.querySelector(s);

const JOINT_PARENT={
  hips:null,spine:'hips',chest:'spine',neck:'chest',head:'neck',
  leftShoulder:'chest',leftUpperArm:'leftShoulder',leftForeArm:'leftUpperArm',leftHand:'leftForeArm',
  rightShoulder:'chest',rightUpperArm:'rightShoulder',rightForeArm:'rightUpperArm',rightHand:'rightForeArm',
  leftUpperLeg:'hips',leftLowerLeg:'leftUpperLeg',leftFoot:'leftLowerLeg',
  rightUpperLeg:'hips',rightLowerLeg:'rightUpperLeg',rightFoot:'rightLowerLeg'
};

// Same simple zero-pose used by the original Talker Comparison source skeleton.
const REST={
  hips:[0,1.02,0],spine:[0,.20,0],chest:[0,.30,0],neck:[0,.25,0],head:[0,.20,0],
  leftShoulder:[-.18,.05,0],leftUpperArm:[-.18,0,0],leftForeArm:[-.31,0,0],leftHand:[-.27,0,0],
  rightShoulder:[.18,.05,0],rightUpperArm:[.18,0,0],rightForeArm:[.31,0,0],rightHand:[.27,0,0],
  leftUpperLeg:[-.11,-.08,0],leftLowerLeg:[0,-.45,0],leftFoot:[0,-.43,.08],
  rightUpperLeg:[.11,-.08,0],rightLowerLeg:[0,-.45,0],rightFoot:[0,-.43,.08]
};

const TARGET_SUFFIX={
  hips:['hips'],spine:['spine'],chest:['spine2','spine1'],neck:['neck'],head:['head'],
  leftShoulder:['leftshoulder'],leftUpperArm:['leftarm'],leftForeArm:['leftforearm'],leftHand:['lefthand'],
  rightShoulder:['rightshoulder'],rightUpperArm:['rightarm'],rightForeArm:['rightforearm'],rightHand:['righthand'],
  leftUpperLeg:['leftupleg'],leftLowerLeg:['leftleg'],leftFoot:['leftfoot'],
  rightUpperLeg:['rightupleg'],rightLowerLeg:['rightleg'],rightFoot:['rightfoot']
};
const GROUP={
  hips:'torso',spine:'torso',chest:'torso',neck:'head',head:'head',
  leftShoulder:'arms',leftUpperArm:'arms',leftForeArm:'arms',leftHand:'arms',
  rightShoulder:'arms',rightUpperArm:'arms',rightForeArm:'arms',rightHand:'arms',
  leftUpperLeg:'legs',leftLowerLeg:'legs',leftFoot:'legs',rightUpperLeg:'legs',rightLowerLeg:'legs',rightFoot:'legs'
};

const state={motion:null,duration:0,playing:false,playhead:0,startedAt:0,audioUrl:null,hasAudio:false,
  gains:{global:1,torso:1,arms:1,head:1,legs:1,smooth:.15},filtered:new Map(),lastTime:null,
  footIK:false,footTargets:{left:null,right:null}};

const scene=new THREE.Scene();scene.background=new THREE.Color(0x0d131d);
const camera=new THREE.PerspectiveCamera(34,1,.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
$('#viewer').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x263044,2.1));
const key=new THREE.DirectionalLight(0xffffff,2.8);key.position.set(2.5,4,3);scene.add(key);
const fill=new THREE.DirectionalLight(0xaec3ff,.9);fill.position.set(-3,2,1);scene.add(fill);
const floor=new THREE.Mesh(new THREE.CircleGeometry(1.25,64),new THREE.MeshStandardMaterial({color:0x151d29,roughness:1}));floor.rotation.x=-Math.PI/2;scene.add(floor);

camera.position.set(0,1.18,4);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,1.05,0);orbit.enableDamping=true;orbit.dampingFactor=.08;orbit.minDistance=1.7;orbit.maxDistance=8;orbit.update();

const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^mixamorig/,'');
function findBone(joint,all){const wanted=TARGET_SUFFIX[joint]||[];for(const w of wanted){const b=all.find(x=>normalize(x.name)===w);if(b)return b;}for(const w of wanted){const b=all.find(x=>normalize(x.name).endsWith(w));if(b)return b;}return null;}
function setStatus(text,real=false){const el=$('#modelStatus');el.textContent=text;el.classList.toggle('real',real);}
function setDiag(){
  const mapped=Object.keys(targetBones).length;
  let animated=0;
  const f=state.motion?.frames?.[0];
  for(const j of Object.keys(JOINT_PARENT))if(f?.joints?.[j]?.rotation) animated++;
  $('#diag').textContent=`Rig Xbot: ${mapped}/19 huesos · JSON: ${animated}/19 joints animados · retarget oficial Three.js`;
}

// Build an actual source Skeleton whose joints/names exactly match the JSON.
const sourceRoot=new THREE.Group();sourceRoot.visible=false;scene.add(sourceRoot);
const sourceBones={};
for(const [joint,parentName] of Object.entries(JOINT_PARENT)){
  const b=new THREE.Bone();b.name=joint;b.position.fromArray(REST[joint]);sourceBones[joint]=b;
  if(parentName)sourceBones[parentName].add(b);else sourceRoot.add(b);
}
const sourceSkeleton=new THREE.Skeleton(Object.values(sourceBones));
sourceRoot.updateMatrixWorld(true);

let modelRoot=null,targetSkin=null;
const targetBones={};
let retargetNames={};

new GLTFLoader().load(MODEL_URL,gltf=>{
  modelRoot=gltf.scene;scene.add(modelRoot);
  const all=[];
  modelRoot.traverse(o=>{
    if(o.isMesh){o.frustumCulled=false;o.castShadow=false;o.receiveShadow=false;}
    if(o.isSkinnedMesh&&!targetSkin)targetSkin=o;
    if(o.isBone)all.push(o);
  });
  for(const joint of Object.keys(JOINT_PARENT)){
    const b=findBone(joint,all);if(b)targetBones[joint]=b;
  }
  // SkeletonUtils expects { targetBoneName: sourceBoneName }.
  retargetNames={};for(const [joint,b] of Object.entries(targetBones))retargetNames[b.name]=joint;

  const box=new THREE.Box3().setFromObject(modelRoot),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const scale=size.y>0?1.75/size.y:1;modelRoot.scale.multiplyScalar(scale);modelRoot.position.x-=center.x*scale;modelRoot.position.z-=center.z*scale;modelRoot.position.y-=box.min.y*scale;
  modelRoot.updateMatrixWorld(true);
  const missing=Object.keys(JOINT_PARENT).filter(j=>!targetBones[j]);
  setStatus(!targetSkin?'Xbot cargó pero no encontré SkinnedMesh':(missing.length?`Xbot listo · faltan ${missing.length} huesos`:'Xbot listo · cargá JSON EMAGE'),!!targetSkin);
  if(missing.length)console.warn('Bones faltantes:',missing,all.map(b=>b.name));
  setDiag();
  if(state.motion)applyMotion(currentTime());
},undefined,err=>{console.error(err);setStatus('Error cargando Xbot');});

function resize(){const r=$('#viewer').getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($('#viewer'));resize();
function formatTime(sec){sec=Math.max(0,Number(sec)||0);const m=Math.floor(sec/60),s=sec-m*60;return `${String(m).padStart(2,'0')}:${s.toFixed(1).padStart(4,'0')}`;}
function currentTime(){if(state.hasAudio){const a=$('#audio');return Math.min(state.duration,Number(a.currentTime)||0);}if(!state.playing)return state.playhead;return Math.min(state.duration,state.playhead+(performance.now()-state.startedAt)/1000);}
function seek(t){t=Math.max(0,Math.min(state.duration,Number(t)||0));state.playhead=t;state.startedAt=performance.now();if(state.hasAudio){const a=$('#audio');if(Number.isFinite(a.duration)&&a.duration>0)a.currentTime=Math.min(t,a.duration);}resetFilter();}
async function setPlaying(on){if(!state.motion)return;const now=currentTime();if(on){if(now>=state.duration-.001)seek(0);else{state.playhead=now;state.startedAt=performance.now();}state.playing=true;if(state.hasAudio){try{await $('#audio').play();}catch(e){console.warn(e);state.playing=false;}}}else{state.playhead=now;state.startedAt=performance.now();state.playing=false;if(state.hasAudio)$('#audio').pause();}syncUi();}
function sample(t){const frames=state.motion?.frames||[];if(!frames.length)return null;const fps=Number(state.motion.fps)||30,f=Math.max(0,Math.min(frames.length-1,t*fps));const a=Math.floor(f),b=Math.min(frames.length-1,a+1);return {a:frames[a],b:frames[b],alpha:f-a};}
function resetFilter(){state.filtered.clear();state.lastTime=null;}
function jointGain(j){return state.gains.global*(state.gains[GROUP[j]]??1);}
function filteredLocal(j,A,B,alpha,t){
  let q=new THREE.Quaternion();
  if(A?.rotation){q.fromArray(A.rotation);if(B?.rotation)q.slerp(new THREE.Quaternion().fromArray(B.rotation),alpha);q.normalize();}
  const g=Math.max(0,Math.min(1.5,jointGain(j)));q.slerpQuaternions(new THREE.Quaternion(),q,g).normalize();
  const smooth=state.gains.smooth;if(smooth<=.001)return q;
  const prev=state.filtered.get(j),jumped=state.lastTime!=null&&(t<state.lastTime-.05||Math.abs(t-state.lastTime)>.25);
  if(!prev||jumped){state.filtered.set(j,q.clone());return q;}const follow=Math.max(.04,1-smooth*.94);prev.slerp(q,follow).normalize();return prev.clone();
}
function driveSource(s,t){
  for(const j of Object.keys(JOINT_PARENT)){
    const A=s.a?.joints?.[j],B=s.b?.joints?.[j]||A;
    sourceBones[j].quaternion.copy(filteredLocal(j,A,B,s.alpha,t));
  }
  state.lastTime=t;sourceRoot.updateMatrixWorld(true);
}

function applyMotion(t){
  if(!targetSkin||!state.motion)return;
  const s=sample(t);if(!s)return;
  driveSource(s,t);
  SkeletonUtils.retarget(targetSkin,sourceSkeleton,{
    names:retargetNames,
    hip:'hips',
    hipInfluence:new THREE.Vector3(0,0,0),
    preserveBonePositions:true,
    preserveBoneMatrix:true
  });
  modelRoot.updateMatrixWorld(true);
  if(state.footIK)solveFeet();
}

function footWorld(side){const b=targetBones[side==='left'?'leftFoot':'rightFoot'];return b?.getWorldPosition(new THREE.Vector3())||null;}
function captureFeet(){if(!modelRoot||!state.motion)return;modelRoot.updateMatrixWorld(true);state.footTargets.left=footWorld('left');state.footTargets.right=footWorld('right');$('#recaptureFeet').disabled=!(state.footTargets.left&&state.footTargets.right);}
function rotateBoneToward(bone,effector,target){const pivot=bone.getWorldPosition(new THREE.Vector3()),from=effector.getWorldPosition(new THREE.Vector3()).sub(pivot),to=target.clone().sub(pivot);if(from.lengthSq()<1e-8||to.lengthSq()<1e-8)return;const deltaWorld=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize()),world=bone.getWorldQuaternion(new THREE.Quaternion()),desired=deltaWorld.multiply(world),parentWorld=bone.parent?.getWorldQuaternion(new THREE.Quaternion())||new THREE.Quaternion();bone.quaternion.copy(parentWorld.invert().multiply(desired)).normalize();bone.updateMatrixWorld(true);}
function solveLeg(side,target){if(!target)return;const upper=targetBones[side==='left'?'leftUpperLeg':'rightUpperLeg'],lower=targetBones[side==='left'?'leftLowerLeg':'rightLowerLeg'],foot=targetBones[side==='left'?'leftFoot':'rightFoot'];if(!upper||!lower||!foot)return;for(let i=0;i<6;i++){rotateBoneToward(lower,foot,target);modelRoot.updateMatrixWorld(true);rotateBoneToward(upper,foot,target);modelRoot.updateMatrixWorld(true);if(foot.getWorldPosition(new THREE.Vector3()).distanceTo(target)<.002)break;}}
function solveFeet(){solveLeg('left',state.footTargets.left);solveLeg('right',state.footTargets.right);}
function syncUi(){const t=currentTime();$('#timeNow').textContent=formatTime(t);$('#timeTotal').textContent=formatTime(state.duration);if(state.duration>0&&document.activeElement!==$('#timeline'))$('#timeline').value=String(t/state.duration);$('#play').textContent=state.playing?'❚❚ Pausar':'▶ Reproducir';}

$('#motionFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!Array.isArray(data.frames)||!data.frames.length)throw new Error('El JSON no contiene frames[]');state.motion=data;state.duration=data.frames.length/(Number(data.fps)||30);state.playing=false;seek(0);$('#motionName').textContent=`${file.name} · ${data.frames.length} frames · ${Number(data.fps)||30} FPS`;$('#play').disabled=false;$('#restart').disabled=false;$('#timeline').disabled=false;setStatus(`Movimiento listo · ${state.duration.toFixed(1)} s`,true);setDiag();applyMotion(0);if(state.footIK)captureFeet();}catch(err){console.error(err);alert(`No pude cargar el JSON: ${err.message}`);}});
$('#audioFile').addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=URL.createObjectURL(file);const a=$('#audio');a.src=state.audioUrl;state.hasAudio=true;$('#audioName').textContent=file.name;$('#clearAudio').disabled=false;a.addEventListener('loadedmetadata',()=>{if(Number.isFinite(a.duration)&&a.duration>0)a.currentTime=Math.min(state.playhead,a.duration);},{once:true});});
$('#clearAudio').addEventListener('click',()=>{const t=currentTime(),a=$('#audio');a.pause();a.removeAttribute('src');a.load();if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=null;state.hasAudio=false;state.playhead=t;state.startedAt=performance.now();$('#audioFile').value='';$('#audioName').textContent='Sin audio · usa reloj interno';$('#clearAudio').disabled=true;});
$('#audio').addEventListener('ended',()=>setPlaying(false));$('#play').addEventListener('click',()=>setPlaying(!state.playing));$('#restart').addEventListener('click',()=>{state.playing=false;$('#audio').pause();seek(0);applyMotion(0);if(state.footIK)captureFeet();});$('#timeline').addEventListener('input',e=>{seek(Number(e.target.value)*state.duration);applyMotion(currentTime());});

const sliders=[['globalGain','global','globalGainValue',true],['torsoGain','torso','torsoGainValue',true],['armsGain','arms','armsGainValue',true],['headGain','head','headGainValue',true],['legsGain','legs','legsGainValue',true],['smoothGain','smooth','smoothGainValue',false]];
for(const [id,key,out,mult] of sliders){$('#'+id).addEventListener('input',e=>{state.gains[key]=Number(e.target.value);$('#'+out).textContent=mult?`${state.gains[key].toFixed(2)}×`:state.gains[key].toFixed(2);resetFilter();applyMotion(currentTime());});}
$('#resetGains').addEventListener('click',()=>{const d={global:1,torso:1,arms:1,head:1,legs:1,smooth:.15};for(const [id,key,out,mult] of sliders){state.gains[key]=d[key];$('#'+id).value=String(d[key]);$('#'+out).textContent=mult?`${d[key].toFixed(2)}×`:d[key].toFixed(2);}resetFilter();applyMotion(currentTime());});
$('#footIK').addEventListener('change',e=>{if(e.target.checked&&!state.motion){e.target.checked=false;return;}state.footIK=e.target.checked;if(state.footIK){applyMotion(currentTime());captureFeet();}else{$('#recaptureFeet').disabled=true;applyMotion(currentTime());}});$('#recaptureFeet').addEventListener('click',()=>{applyMotion(currentTime());captureFeet();});
for(const btn of document.querySelectorAll('.view'))btn.addEventListener('click',()=>{document.querySelectorAll('.view').forEach(b=>b.classList.toggle('active',b===btn));const v=btn.dataset.view;if(v==='front')camera.position.set(0,1.18,4);if(v==='side')camera.position.set(4,1.18,0);if(v==='threequarter')camera.position.set(2.7,1.35,2.7);orbit.target.set(0,1.05,0);orbit.update();});

function animate(){requestAnimationFrame(animate);let t=currentTime();if(state.playing&&!state.hasAudio&&t>=state.duration){state.playing=false;state.playhead=state.duration;t=state.duration;}if(state.motion)applyMotion(t);orbit.update();syncUi();renderer.render(scene,camera);}animate();