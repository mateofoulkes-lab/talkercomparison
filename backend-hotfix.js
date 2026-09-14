import { Client, handle_file } from '@gradio/client';
import { unzipSync } from 'fflate';

const audioInput = document.querySelector('#audioFile');
const motionInput = document.querySelector('#motionFile');
const statusEl = document.querySelector('#backendStatus');
const pantoBtn = document.querySelector('#generatePanto');
const tangoBtn = document.querySelector('#generateTango');

const SMPLX_MAP = {
  hips:0,leftUpperLeg:1,rightUpperLeg:2,spine:3,leftLowerLeg:4,rightLowerLeg:5,
  chest:9,leftFoot:10,rightFoot:11,neck:12,leftShoulder:13,rightShoulder:14,
  head:15,leftUpperArm:16,rightUpperArm:17,leftForeArm:18,rightForeArm:19,leftHand:20,rightHand:21
};

function setStatus(s){ if(statusEl) statusEl.textContent=s; }
function urlOf(v){ return typeof v==='string'?v:(v?.url||v?.path||v?.orig_name||v?.name||null); }

function parseNpy(bytes){
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(dv.getUint8(0)!==0x93) throw new Error('NPY inválido');
  const major=dv.getUint8(6); let n,off;
  if(major===1){n=dv.getUint16(8,true);off=10;}else{n=dv.getUint32(8,true);off=12;}
  const h=new TextDecoder().decode(bytes.subarray(off,off+n)); off+=n;
  const descr=h.match(/'descr':\s*'([^']+)'/)?.[1];
  const shape=(h.match(/'shape':\s*\(([^)]*)\)/)?.[1]||'').split(',').map(x=>x.trim()).filter(Boolean).map(Number);
  if(!descr||!shape.length) throw new Error('NPY no soportado');
  const count=shape.reduce((a,b)=>a*b,1), out=new Float64Array(count), little=descr[0]!=='>';
  if(descr.endsWith('f4')) for(let i=0;i<count;i++) out[i]=dv.getFloat32(off+i*4,little);
  else if(descr.endsWith('f8')) for(let i=0;i<count;i++) out[i]=dv.getFloat64(off+i*8,little);
  else throw new Error(`dtype ${descr} no soportado`);
  return {shape,data:out};
}
function aaQuat(x,y,z){const a=Math.hypot(x,y,z);if(a<1e-8)return [0,0,0,1];const s=Math.sin(a/2)/a;return [x*s,y*s,z*s,Math.cos(a/2)];}
function slerp(a,b,t){
  let dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3], bb=b;
  if(dot<0){dot=-dot;bb=b.map(x=>-x);} if(dot>.9995){const q=a.map((x,i)=>x+(bb[i]-x)*t),n=Math.hypot(...q);return q.map(x=>x/n);}
  const th=Math.acos(Math.max(-1,Math.min(1,dot))),s=Math.sin(th);return a.map((x,i)=>(Math.sin((1-t)*th)/s)*x+(Math.sin(t*th)/s)*bb[i]);
}
function npzToMotion(buffer,keyName,model){
  const zip=unzipSync(new Uint8Array(buffer)), keys=Object.keys(zip);
  const key=keys.find(k=>new RegExp(`(^|/)${keyName}\\.npy$`,'i').test(k));
  if(!key) throw new Error(`NPZ sin ${keyName}.npy`);
  const arr=parseNpy(zip[key]), T=arr.shape[0], D=arr.shape.at(-1);
  if(D<66) throw new Error(`Movimiento inválido (${D} valores/frame)`);
  const frames=[];
  for(let f=0;f<T;f++){
    const joints={};
    for(const [name,idx] of Object.entries(SMPLX_MAP)){
      if(name==='hips'){joints[name]={rotation:[0,0,0,1]};continue;}
      const p=f*D+idx*3;joints[name]={rotation:aaQuat(arr.data[p],arr.data[p+1],arr.data[p+2])};
    }
    frames.push({root:{position:[0,0,0]},joints});
  }
  return {model,fps:30,frames};
}
function mergeChunks(chunks,overlapSec){
  if(chunks.length===1)return chunks[0];
  let out={...chunks[0],frames:[...chunks[0].frames]}, overlap=Math.round(overlapSec*30);
  for(let c=1;c<chunks.length;c++){
    const b=chunks[c], n=Math.min(overlap,out.frames.length,b.frames.length);
    for(let i=0;i<n;i++){
      const A=out.frames[out.frames.length-n+i], B=b.frames[i], t=(i+1)/(n+1);
      for(const j of Object.keys(SMPLX_MAP)){
        const qa=A.joints?.[j]?.rotation,qb=B.joints?.[j]?.rotation;if(qa&&qb)A.joints[j].rotation=slerp(qa,qb,t);
      }
    }
    out.frames.push(...b.frames.slice(n));
  }
  return out;
}
async function decodeAudio(file){const ctx=new AudioContext();try{return await ctx.decodeAudioData(await file.arrayBuffer());}finally{ctx.close();}}
function wavFromBuffer(buf,startSec,endSec,name){
  const sr=buf.sampleRate,start=Math.floor(startSec*sr),end=Math.min(buf.length,Math.floor(endSec*sr)),len=end-start,channels=buf.numberOfChannels;
  const ab=new ArrayBuffer(44+len*channels*2),dv=new DataView(ab);let o=0;
  const ws=s=>{for(let i=0;i<s.length;i++)dv.setUint8(o++,s.charCodeAt(i));};const u32=v=>{dv.setUint32(o,v,true);o+=4;};const u16=v=>{dv.setUint16(o,v,true);o+=2;};
  ws('RIFF');u32(36+len*channels*2);ws('WAVE');ws('fmt ');u32(16);u16(1);u16(channels);u32(sr);u32(sr*channels*2);u16(channels*2);u16(16);ws('data');u32(len*channels*2);
  const data=Array.from({length:channels},(_,ch)=>buf.getChannelData(ch));
  for(let i=0;i<len;i++)for(let ch=0;ch<channels;ch++){const x=Math.max(-1,Math.min(1,data[ch][start+i]));dv.setInt16(o,x<0?x*32768:x*32767,true);o+=2;}
  return new File([ab],name,{type:'audio/wav'});
}
function makeSegments(duration,maxLen,overlap){const a=[];let s=0;while(s<duration-.01){const e=Math.min(duration,s+maxLen);a.push([s,e]);if(e>=duration)break;s=e-overlap;}return a;}
function injectCommon(data,filename){
  const file=new File([JSON.stringify(data)],filename,{type:'application/json'}),dt=new DataTransfer();dt.items.add(file);motionInput.files=dt.files;motionInput.dispatchEvent(new Event('change',{bubbles:true}));
}
async function getNpz(result,indexHint){
  const arr=result?.data||[], v=arr.find(x=>/\.npz(?:$|\?)/i.test(urlOf(x)||''))||arr[indexHint];const u=urlOf(v);if(!u)throw new Error('El backend respondió pero no encontré el NPZ');
  const r=await fetch(u);if(!r.ok)throw new Error(`No pude descargar NPZ (${r.status})`);return r.arrayBuffer();
}

async function runEmage(){
  const file=audioInput.files?.[0];if(!file)return;
  pantoBtn.disabled=true;try{
    const decoded=await decodeAudio(file), segs=makeSegments(decoded.duration,58,2), app=await Client.connect('H-Liu1997/EMAGE'), chunks=[];
    for(let i=0;i<segs.length;i++){
      const [s,e]=segs[i];setStatus(`EMAGE: tramo ${i+1}/${segs.length} (${s.toFixed(0)}–${e.toFixed(0)} s) · esperando ZeroGPU…`);
      const wav=wavFromBuffer(decoded,s,e,`emage_${i}.wav`);
      const result=await app.predict('/inference_app',{audio:handle_file(wav),model_type:'EMAGE (Full body + Face)',render_mesh:false,render_face:false,render_mesh_face:false});
      chunks.push(npzToMotion(await getNpz(result,4),'poses','pantomatrix'));
    }
    const merged=mergeChunks(chunks,2);merged.model='pantomatrix';merged.generator='EMAGE';injectCommon(merged,'pantomatrix-emage-long.json');
    setStatus(`EMAGE: LISTO · ${(merged.frames.length/30).toFixed(1)} s · ${segs.length} tramo(s), unión suavizada.`);
  }catch(e){console.error(e);setStatus(`EMAGE: error — ${e.message||e}`);}finally{pantoBtn.disabled=!audioInput.files?.[0];}
}

const TANGO_VIDEO='https://huggingface.co/spaces/H-Liu1997/TANGO/resolve/main/datasets/cached_audio/speaker9_o7Ik1OB4TaE_00-00-38.15_00-00-42.33.mp4';
async function runTango(){
  const file=audioInput.files?.[0];if(!file)return;
  tangoBtn.disabled=true;try{
    const decoded=await decodeAudio(file),segs=makeSegments(decoded.duration,7.5,1),app=await Client.connect('H-Liu1997/TANGO'),chunks=[];
    for(let i=0;i<segs.length;i++){
      const [s,e]=segs[i];setStatus(`TANGO: tramo ${i+1}/${segs.length} (${s.toFixed(1)}–${e.toFixed(1)} s) · esperando ZeroGPU…`);
      const wav=wavFromBuffer(decoded,s,e,`tango_${i}.wav`);
      const result=await app.predict('/tango_wrapper',{audio_path:handle_file(wav),character_name:handle_file(TANGO_VIDEO),seed:2024});
      chunks.push(npzToMotion(await getNpz(result,2),'motion','custom'));
    }
    const merged=mergeChunks(chunks,1);merged.model='custom';merged.generator='TANGO';injectCommon(merged,'custom-tango-long.json');
    setStatus(`TANGO: LISTO · ${(merged.frames.length/30).toFixed(1)} s · ${segs.length} tramos. Resultado cargado en Custom.`);
  }catch(e){console.error(e);setStatus(`TANGO: error — ${e.message||e}`);}finally{tangoBtn.disabled=!audioInput.files?.[0];}
}

pantoBtn?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();runEmage();},true);
tangoBtn?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();runTango();},true);
