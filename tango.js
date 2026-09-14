import * as THREE from 'three';
import { Client, handle_file } from '@gradio/client';
import { unzipSync } from 'fflate';

const DEFAULT_TANGO_VIDEO = 'https://huggingface.co/spaces/H-Liu1997/TANGO/resolve/main/datasets/cached_audio/speaker9_o7Ik1OB4TaE_00-00-38.15_00-00-42.33.mp4';

const JOINTS = {
  hips:null, spine:'hips', chest:'spine', neck:'chest', head:'neck',
  leftShoulder:'chest', leftUpperArm:'leftShoulder', leftForeArm:'leftUpperArm', leftHand:'leftForeArm',
  rightShoulder:'chest', rightUpperArm:'rightShoulder', rightForeArm:'rightUpperArm', rightHand:'rightForeArm',
  leftUpperLeg:'hips', leftLowerLeg:'leftUpperLeg', leftFoot:'leftLowerLeg',
  rightUpperLeg:'hips', rightLowerLeg:'rightUpperLeg', rightFoot:'rightLowerLeg'
};

const REST = {
  hips:[0,1.02,0], spine:[0,.20,0], chest:[0,.30,0], neck:[0,.25,0], head:[0,.20,0],
  leftShoulder:[-.18,.05,0], leftUpperArm:[-.18,0,0], leftForeArm:[-.31,0,0], leftHand:[-.27,0,0],
  rightShoulder:[.18,.05,0], rightUpperArm:[.18,0,0], rightForeArm:[.31,0,0], rightHand:[.27,0,0],
  leftUpperLeg:[-.11,-.08,0], leftLowerLeg:[0,-.45,0], leftFoot:[0,-.43,.08],
  rightUpperLeg:[.11,-.08,0], rightLowerLeg:[0,-.45,0], rightFoot:[0,-.43,.08]
};

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

const audio = document.querySelector('#audio');
const audioFileInput = document.querySelector('#audioFile');
const generateButton = document.querySelector('#generateTango');
const globalStatus = document.querySelector('#backendStatus');

let currentMotion = null;
let generating = false;
let card = null;
let view = null;

function setStatus(text){ if(globalStatus) globalStatus.textContent = text; }

function resultUrl(v){
  if(!v) return null;
  if(typeof v === 'string') return v;
  return v.url || v.path || v.orig_name || v.name || null;
}

function parseNpy(bytes){
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if(dv.getUint8(0) !== 0x93) throw new Error('NPY inválido');
  const major = dv.getUint8(6);
  let headerLen, off;
  if(major === 1){ headerLen = dv.getUint16(8,true); off = 10; }
  else { headerLen = dv.getUint32(8,true); off = 12; }
  const header = new TextDecoder().decode(bytes.subarray(off, off + headerLen));
  off += headerLen;
  const descr = header.match(/'descr':\s*'([^']+)'/)?.[1];
  const shapeText = header.match(/'shape':\s*\(([^)]*)\)/)?.[1] || '';
  const shape = shapeText.split(',').map(x=>x.trim()).filter(Boolean).map(Number);
  if(!descr || !shape.length) throw new Error('Header NPY no soportado');
  const count = shape.reduce((a,b)=>a*b,1);
  const out = new Float64Array(count);
  const little = descr[0] !== '>';
  if(descr.endsWith('f4')) for(let i=0;i<count;i++) out[i] = dv.getFloat32(off+i*4,little);
  else if(descr.endsWith('f8')) for(let i=0;i<count;i++) out[i] = dv.getFloat64(off+i*8,little);
  else throw new Error(`dtype ${descr} no soportado`);
  return {shape,data:out};
}

function axisAngleQuat(x,y,z){
  const angle = Math.hypot(x,y,z);
  if(angle < 1e-8) return [0,0,0,1];
  const s = Math.sin(angle/2)/angle;
  return [x*s,y*s,z*s,Math.cos(angle/2)];
}

function tangoNpzToCommon(buffer){
  const zip = unzipSync(new Uint8Array(buffer));
  const keys = Object.keys(zip);
  const motionKey = keys.find(k=>/(^|\/)motion\.npy$/i.test(k));
  if(!motionKey) throw new Error(`El NPZ de TANGO no contiene motion.npy (${keys.join(', ')})`);
  const motion = parseNpy(zip[motionKey]);
  const T = motion.shape[0];
  const D = motion.shape[motion.shape.length-1];
  if(D < 66) throw new Error(`motion tiene sólo ${D} valores por frame; esperaba al menos 66`);
  const frames = [];
  for(let f=0; f<T; f++){
    const joints = {};
    for(const [name,idx] of Object.entries(SMPLX_MAP)){
      if(name === 'hips'){
        // Normalizamos la orientación global para que todas las tarjetas miren a la misma cámara.
        joints[name] = {rotation:[0,0,0,1]};
        continue;
      }
      const p = f*D + idx*3;
      joints[name] = {rotation:axisAngleQuat(motion.data[p],motion.data[p+1],motion.data[p+2])};
    }
    frames.push({root:{position:[0,0,0]},joints});
  }
  return {
    model:'tango',
    generator:'TANGO official Hugging Face Space',
    fps:30,
    frames
  };
}

function makeViewer(container){
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34,1,.01,100);
  const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  container.appendChild(renderer.domElement);

  const root = new THREE.Group(); scene.add(root);
  const joints = {}, bones = [];
  const jointMat = new THREE.MeshBasicMaterial({color:0xd8e1ff});
  const boneMat = new THREE.MeshBasicMaterial({color:0x8ca2ff});
  const rootMat = new THREE.MeshBasicMaterial({color:0xffc76b});

  for(const [name,parentName] of Object.entries(JOINTS)){
    const obj = new THREE.Group(); obj.name = name; obj.position.fromArray(REST[name]);
    const radius = name==='head' ? .07 : (name==='hips' ? .035 : .024);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius,14,10), name==='hips' ? rootMat : jointMat);
    obj.add(sphere); joints[name] = obj;
    if(parentName) joints[parentName].add(obj); else root.add(obj);
  }

  root.updateMatrixWorld(true);
  for(const [name,parentName] of Object.entries(JOINTS)){
    if(!parentName) continue;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.013,.013,1,8),boneMat);
    scene.add(mesh); bones.push({mesh,a:joints[parentName],b:joints[name]});
  }

  const pelvisBar = new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.22,8),boneMat);
  pelvisBar.rotation.z = Math.PI/2; joints.hips.add(pelvisBar);
  const shoulderBar = new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.36,8),boneMat);
  shoulderBar.rotation.z = Math.PI/2; joints.chest.add(shoulderBar);

  const trailMat = new THREE.LineBasicMaterial({color:0x7ce8ff,transparent:true,opacity:.7});
  const leftTrail = new THREE.Line(new THREE.BufferGeometry(),trailMat);
  const rightTrail = new THREE.Line(new THREE.BufferGeometry(),trailMat.clone());
  scene.add(leftTrail,rightTrail);
  const trails = {left:[],right:[],leftTrail,rightTrail};

  camera.position.set(0,1.2,4); camera.lookAt(0,1.1,0);
  function resize(){
    const r = container.getBoundingClientRect();
    renderer.setSize(r.width,r.height,false);
    camera.aspect = r.width/Math.max(1,r.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();
  return {scene,camera,renderer,root,joints,bones,trails};
}

function resetPose(){
  for(const [name,obj] of Object.entries(view.joints)){
    obj.position.fromArray(REST[name]); obj.quaternion.identity();
  }
  view.root.position.set(0,0,0); view.root.quaternion.identity();
}

function neutralPose(t){
  resetPose();
  const intensity = Number(document.querySelector('#globalIntensity')?.value || 1);
  view.joints.spine.rotation.z = Math.sin(t*.42)*.006*intensity;
  view.joints.chest.rotation.y = Math.sin(t*.31+.7)*.012*intensity;
  view.joints.neck.rotation.y = Math.sin(t*.38+1.4)*.01*intensity;
  view.joints.head.rotation.z = Math.sin(t*.29)*.006*intensity;
  view.joints.leftUpperArm.rotation.z = .05;
  view.joints.rightUpperArm.rotation.z = -.05;
}

function sampleMotion(t){
  if(!currentMotion?.frames?.length) return null;
  const fps = currentMotion.fps || 30;
  const f = Math.max(0,Math.min(currentMotion.frames.length-1,t*fps));
  const a = Math.floor(f), b = Math.min(currentMotion.frames.length-1,a+1);
  return {a:currentMotion.frames[a],b:currentMotion.frames[b],alpha:f-a};
}

function applyMotion(t){
  resetPose();
  const sample = sampleMotion(t); if(!sample) return;
  const intensity = Number(document.querySelector('#globalIntensity')?.value || 1);
  for(const name of Object.keys(JOINTS)){
    const A = sample.a?.joints?.[name], B = sample.b?.joints?.[name] || A;
    if(!A?.rotation || !B?.rotation) continue;
    const qa = new THREE.Quaternion(...A.rotation);
    const qb = new THREE.Quaternion(...B.rotation);
    view.joints[name].quaternion.copy(qa).slerp(qb,sample.alpha);
    if(intensity !== 1){
      view.joints[name].quaternion.slerpQuaternions(new THREE.Quaternion(),view.joints[name].quaternion,intensity);
    }
  }
}

function updateBones(){
  const av = new THREE.Vector3(), bv = new THREE.Vector3(), mid = new THREE.Vector3(), up = new THREE.Vector3(0,1,0);
  for(const bone of view.bones){
    bone.a.getWorldPosition(av); bone.b.getWorldPosition(bv);
    const dir = bv.clone().sub(av), dist = dir.length(); if(dist < 1e-6) continue;
    mid.copy(av).add(bv).multiplyScalar(.5);
    bone.mesh.position.copy(mid); bone.mesh.scale.set(1,dist,1);
    bone.mesh.quaternion.setFromUnitVectors(up,dir.normalize());
  }
}

function updateTrails(){
  const show = !!document.querySelector('#showTrails')?.checked;
  const tr = view.trails;
  if(!show){ tr.leftTrail.visible = tr.rightTrail.visible = false; tr.left.length = tr.right.length = 0; return; }
  tr.leftTrail.visible = tr.rightTrail.visible = true;
  const l = new THREE.Vector3(), r = new THREE.Vector3();
  view.joints.leftHand.getWorldPosition(l); view.joints.rightHand.getWorldPosition(r);
  tr.left.push(l); tr.right.push(r);
  if(tr.left.length>60) tr.left.shift(); if(tr.right.length>60) tr.right.shift();
  tr.leftTrail.geometry.setFromPoints(tr.left); tr.rightTrail.geometry.setFromPoints(tr.right);
}

function setCamera(){
  const mode = document.querySelector('.view-button.active')?.dataset.view || 'front';
  if(mode==='front') view.camera.position.set(0,1.18,4);
  if(mode==='side') view.camera.position.set(4,1.18,0);
  if(mode==='threequarter') view.camera.position.set(2.7,1.35,2.7);
  view.camera.lookAt(0,1.1,0);
}

function render(){
  const t = audio?.currentTime || 0;
  currentMotion ? applyMotion(t) : neutralPose(t);
  if(view){
    view.joints.hips.children[0].visible = !!document.querySelector('#showRoot')?.checked;
    view.root.updateMatrixWorld(true);
    updateBones(); updateTrails(); setCamera();
    view.renderer.render(view.scene,view.camera);
  }
  requestAnimationFrame(render);
}

function downloadJson(){
  if(!currentMotion) return;
  const blob = new Blob([JSON.stringify(currentMotion,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'tango-motion.json'; a.click();
  URL.revokeObjectURL(a.href);
}

async function generateTango(){
  const file = audioFileInput?.files?.[0];
  if(!file || generating) return;
  generating = true;
  generateButton.disabled = true;
  const badge = card.querySelector('.status');
  badge.textContent = 'Conectando…'; badge.classList.remove('real');
  try{
    setStatus('TANGO: conectando al Space oficial H-Liu1997/TANGO…');
    const app = await Client.connect('H-Liu1997/TANGO');
    let named = [];
    try{
      const api = await app.view_api();
      named = Object.keys(api?.named_endpoints || {});
    }catch(_){/* fallbacks below */}
    const endpoints = [...new Set([
      ...named.filter(x=>/tango|predict|generate/i.test(x)),
      ...named,
      '/tango_wrapper','/predict'
    ])];
    const audioUpload = handle_file(file);
    const videoUpload = handle_file(DEFAULT_TANGO_VIDEO);
    badge.textContent = 'Generando en ZeroGPU…';
    setStatus('TANGO: audio enviado. Esperando ZeroGPU; la demo pública procesa hasta 8 s de audio…');

    let result = null, lastErr = null;
    for(const endpoint of endpoints){
      const attempts = [
        ()=>app.predict(endpoint,{audio_path:audioUpload,character_name:videoUpload,seed:2024}),
        ()=>app.predict(endpoint,{audio:audioUpload,video:videoUpload,seed:2024}),
        ()=>app.predict(endpoint,{audio_input:audioUpload,video_input:videoUpload,seed_input:2024}),
        ()=>app.predict(endpoint,[audioUpload,videoUpload,2024]),
      ];
      for(const attempt of attempts){
        try{ result = await attempt(); if(result) break; }
        catch(err){ lastErr = err; }
      }
      if(result) break;
    }
    if(!result) throw lastErr || new Error('El Space de TANGO no devolvió resultado');

    const outputs = result.data || [];
    const candidate = outputs.find(x=>{
      const u = resultUrl(x) || '';
      return /\.npz($|\?)/i.test(u) || x?.orig_name?.toLowerCase?.().endsWith('.npz');
    }) || outputs[2];
    const npzUrl = resultUrl(candidate);
    if(!npzUrl) throw new Error('TANGO respondió, pero no encontré el archivo NPZ');

    setStatus('TANGO: descargando motion.npy y convirtiendo 55-joint SMPL-X al rig común…');
    const res = await fetch(npzUrl);
    if(!res.ok) throw new Error(`No pude descargar NPZ (${res.status})`);
    currentMotion = tangoNpzToCommon(await res.arrayBuffer());
    badge.textContent = 'Movimiento real · TANGO'; badge.classList.add('real');
    card.querySelector('.download').disabled = false;
    setStatus(`TANGO: LISTO · ${currentMotion.frames.length} frames reales a 30 FPS.`);
  }catch(err){
    console.error(err);
    badge.textContent = 'Error backend';
    setStatus(`TANGO: error — ${err?.message || err}`);
  }finally{
    generating = false;
    generateButton.disabled = !audioFileInput?.files?.[0];
  }
}

function init(){
  const grid = document.querySelector('#grid');
  if(!grid || !generateButton) return;
  card = document.createElement('article');
  card.className = 'viewer-card';
  card.dataset.model = 'tango';
  card.innerHTML = `
    <div class="viewer-head">
      <div><div class="viewer-title">TANGO</div><div class="viewer-meta">SMPL-X 55 joints · REAL BACKEND · ZeroGPU</div></div>
      <span class="status">Sin resultado real</span>
    </div>
    <div class="canvas-wrap"></div>
    <div class="viewer-foot">
      <span class="metric">30 FPS</span><span class="metric">Same camera</span><span class="metric">Same rig</span>
      <span class="metric">HF demo: primeros 8 s</span>
      <span class="spacer"></span><button class="download" disabled>Descargar JSON</button>
    </div>`;
  if(grid.children[1]) grid.insertBefore(card,grid.children[1]); else grid.appendChild(card);
  view = makeViewer(card.querySelector('.canvas-wrap'));
  card.querySelector('.download').addEventListener('click',downloadJson);
  generateButton.disabled = !audioFileInput?.files?.[0];
  audioFileInput?.addEventListener('change',()=>{ generateButton.disabled = !audioFileInput.files?.[0]; });
  generateButton.addEventListener('click',generateTango);
  render();
}

init();
