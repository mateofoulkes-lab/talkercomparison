const audio=document.querySelector('#audio');
const motionInput=document.querySelector('#motionFile');
const listEl=document.querySelector('#gestureList');
const addBtn=document.querySelector('#addGesture');
const startEl=document.querySelector('#gestureStart');
const endEl=document.querySelector('#gestureEnd');
const promptEl=document.querySelector('#gesturePrompt');

const directives=[];
window.talkerDirectedGestures=directives;

const PRESETS={
  thumb_back_right:{label:'Pulgar atrás · derecha',joints:{rightUpperArm:[-0.18,0.18,-0.85],rightForeArm:[0.15,-0.15,-1.15],rightHand:[0.0,0.45,0.35]},handPose:{right:'thumb_back'}},
  thumb_back_left:{label:'Pulgar atrás · izquierda',joints:{leftUpperArm:[-0.18,-0.18,0.85],leftForeArm:[0.15,0.15,1.15],leftHand:[0.0,-0.45,-0.35]},handPose:{left:'thumb_back'}},
  point_right:{label:'Señalar · derecha',joints:{rightUpperArm:[-0.15,0.10,-1.0],rightForeArm:[0,-0.15,-0.35],rightHand:[0,0.05,0]},handPose:{right:'point'}},
  point_left:{label:'Señalar · izquierda',joints:{leftUpperArm:[-0.15,-0.10,1.0],leftForeArm:[0,0.15,0.35],leftHand:[0,-0.05,0]},handPose:{left:'point'}},
  present_both:{label:'Presentar · ambas manos',joints:{leftUpperArm:[-0.35,-0.1,0.55],leftForeArm:[0.1,0.0,0.55],rightUpperArm:[-0.35,0.1,-0.55],rightForeArm:[0.1,0.0,-0.55]},handPose:{left:'open',right:'open'}},
  shrug:{label:'Encogerse de hombros',joints:{leftShoulder:[0,0,0.18],rightShoulder:[0,0,-0.18],leftUpperArm:[0,0,0.18],rightUpperArm:[0,0,-0.18]},handPose:{left:'open',right:'open'}},
};

function classify(text){
  const t=(text||'').toLowerCase();
  if(/pulgar/.test(t)&&/(atr[aá]s|detr[aá]s)/.test(t)&&/(izq|left)/.test(t))return 'thumb_back_left';
  if(/pulgar/.test(t)&&/(atr[aá]s|detr[aá]s)/.test(t))return 'thumb_back_right';
  if(/señal|apunt/.test(t)&&/(izq|left)/.test(t))return 'point_left';
  if(/señal|apunt/.test(t))return 'point_right';
  if(/present|mostrar|ambas manos|dos manos/.test(t))return 'present_both';
  if(/encog|shrug|hombros/.test(t))return 'shrug';
  return 'present_both';
}
function qFromEuler(x,y,z){
  const c1=Math.cos(x/2),c2=Math.cos(y/2),c3=Math.cos(z/2),s1=Math.sin(x/2),s2=Math.sin(y/2),s3=Math.sin(z/2);
  return [s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3];
}
function mul(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
function slerp(a,b,t){let dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3],bb=b;if(dot<0){dot=-dot;bb=b.map(v=>-v);}if(dot>.9995){const q=a.map((v,i)=>v+(bb[i]-v)*t),n=Math.hypot(...q);return q.map(v=>v/n);}const th=Math.acos(Math.max(-1,Math.min(1,dot))),s=Math.sin(th);return a.map((v,i)=>Math.sin((1-t)*th)/s*v+Math.sin(t*th)/s*bb[i]);}
function envelope(t,start,end){const fade=Math.min(.35,Math.max(.12,(end-start)*.22));if(t<start||t>end)return 0;if(t<start+fade)return (t-start)/fade;if(t>end-fade)return (end-t)/fade;return 1;}
function bake(data){
  if(!data?.frames?.length||!directives.length)return data;
  const out=structuredClone(data),fps=out.fps||30;
  out.directedGestures=directives.map(x=>({...x}));
  for(let i=0;i<out.frames.length;i++){
    const t=i/fps,frame=out.frames[i];
    for(const d of directives){
      const w=envelope(t,d.start,d.end);if(w<=0)continue;
      const preset=PRESETS[d.preset];if(!preset)continue;
      for(const [joint,e] of Object.entries(preset.joints)){
        frame.joints??={};frame.joints[joint]??={rotation:[0,0,0,1]};
        const base=frame.joints[joint].rotation||[0,0,0,1],target=mul(base,qFromEuler(...e));
        frame.joints[joint].rotation=slerp(base,target,w);
      }
      frame.handPose={...(frame.handPose||{}),...(preset.handPose||{})};
    }
  }
  return out;
}
function render(){
  if(!listEl)return;listEl.innerHTML='';
  for(const [i,d] of directives.entries()){
    const row=document.createElement('div');row.className='gesture-chip';
    row.innerHTML=`<span><b>${d.start.toFixed(1)}–${d.end.toFixed(1)}s</b> · ${PRESETS[d.preset]?.label||d.prompt}</span><button data-i="${i}">×</button>`;
    row.querySelector('button').onclick=()=>{directives.splice(i,1);render();};listEl.appendChild(row);
  }
}
addBtn?.addEventListener('click',()=>{
  const start=Math.max(0,Number(startEl?.value||0)),end=Math.max(start+.1,Number(endEl?.value||start+1.5)),prompt=(promptEl?.value||'').trim();
  directives.push({start,end,prompt,preset:classify(prompt)});render();
});

document.querySelector('#gestureNow')?.addEventListener('click',()=>{const t=audio?.currentTime||0;if(startEl)startEl.value=t.toFixed(1);if(endEl)endEl.value=(t+1.5).toFixed(1);});

// Capture imports before the main viewer consumes them. Generated backends also feed results through #motionFile,
// so directed gestures are baked consistently into EMAGE/TANGO/common JSON results.
motionInput?.addEventListener('change',async e=>{
  if(!directives.length||e.__directedBaked)return;
  const files=[...(motionInput.files||[])];if(!files.length)return;
  e.stopImmediatePropagation();
  const dt=new DataTransfer();
  for(const f of files){
    try{const data=JSON.parse(await f.text()),baked=bake(data);dt.items.add(new File([JSON.stringify(baked)],f.name.replace(/\.json$/i,'')+'-directed.json',{type:'application/json'}));}
    catch{dt.items.add(f);}
  }
  motionInput.files=dt.files;const ev=new Event('change',{bubbles:true});ev.__directedBaked=true;motionInput.dispatchEvent(ev);
},true);

window.applyDirectedGestures=bake;
