import * as THREE from 'three';

const MODELS = [
  { id: 'pantomatrix', name: 'PantoMatrix / EMAGE', source: 'SMPL-X', profile: { tempo: 1.00, reach: 1.00, torso: 0.75, asymmetry: 0.55 } },
  { id: 'streamtalk', name: 'StreamTalk', source: 'SMPL-X', profile: { tempo: 0.86, reach: 0.82, torso: 0.58, asymmetry: 0.38 } },
  { id: 'unicamp', name: 'UNICAMP GENEA', source: 'SMPL-H', profile: { tempo: 1.12, reach: 1.12, torso: 0.66, asymmetry: 0.72 } },
  { id: 'dlp3d', name: 'DLP3D Speech2Motion', source: '3D motion', profile: { tempo: 0.94, reach: 0.92, torso: 0.88, asymmetry: 0.48 } },
  { id: 'freeform', name: 'Free-form Co-Speech', source: 'pose sequence', profile: { tempo: 1.24, reach: 1.22, torso: 0.72, asymmetry: 0.82 } },
  { id: 'custom', name: 'Custom / imported', source: 'Common JSON', profile: { tempo: 1, reach: 1, torso: 1, asymmetry: .5 } },
];

const JOINTS = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  leftShoulder: 'chest', leftUpperArm: 'leftShoulder', leftForeArm: 'leftUpperArm', leftHand: 'leftForeArm',
  rightShoulder: 'chest', rightUpperArm: 'rightShoulder', rightForeArm: 'rightUpperArm', rightHand: 'rightForeArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg'
};

const REST = {
  hips: [0, 1.00, 0], spine: [0, .24, 0], chest: [0, .27, 0], neck: [0, .22, 0], head: [0, .19, 0],
  leftShoulder: [-.20, .11, 0], leftUpperArm: [-.22, -.02, 0], leftForeArm: [-.28, -.02, 0], leftHand: [-.26, -.01, 0],
  rightShoulder: [.20, .11, 0], rightUpperArm: [.22, -.02, 0], rightForeArm: [.28, -.02, 0], rightHand: [.26, -.01, 0],
  leftUpperLeg: [-.12, -.12, 0], leftLowerLeg: [-.02, -.43, 0], leftFoot: [0, -.43, .04],
  rightUpperLeg: [.12, -.12, 0], rightLowerLeg: [.02, -.43, 0], rightFoot: [0, -.43, .04]
};

const state = {
  audio: document.querySelector('#audio'),
  views: new Map(),
  viewMode: 'front',
  showTrails: false,
  showRoot: true,
  intensity: 1,
  raf: null,
  imported: new Map(),
};

const $ = (s) => document.querySelector(s);
const grid = $('#grid');

function formatTime(sec) {
  if (!Number.isFinite(sec)) return '00:00.0';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2,'0')}:${s.toFixed(1).padStart(4,'0')}`;
}

function buildCard(model) {
  const card = document.createElement('article');
  card.className = 'viewer-card';
  card.dataset.model = model.id;
  card.innerHTML = `
    <div class="viewer-head">
      <div><div class="viewer-title">${model.name}</div><div class="viewer-meta">${model.source}</div></div>
      <span class="status">Preview procedural</span>
    </div>
    <div class="canvas-wrap"></div>
    <div class="viewer-foot">
      <span class="metric">Audio sync</span><span class="metric">Same camera</span><span class="metric">Same rig</span>
      <span class="spacer"></span>
      <button class="download" disabled>Descargar JSON</button>
    </div>`;
  grid.appendChild(card);
  const view = makeViewer(card.querySelector('.canvas-wrap'), model);
  state.views.set(model.id, { ...view, model, card });
  card.querySelector('.download').addEventListener('click', () => downloadMotion(model.id));
}

function makeViewer(container, model) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const root = new THREE.Group();
  scene.add(root);

  const joints = {};
  const bones = [];
  const jointMat = new THREE.MeshBasicMaterial({ color: 0xd8e1ff });
  const boneMat = new THREE.MeshBasicMaterial({ color: 0x8ca2ff });
  const rootMat = new THREE.MeshBasicMaterial({ color: 0xffc76b });

  for (const [name, parentName] of Object.entries(JOINTS)) {
    const obj = new THREE.Group();
    obj.name = name;
    obj.position.fromArray(REST[name]);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(name === 'head' ? .055 : .026, 14, 10), name === 'hips' ? rootMat : jointMat);
    obj.add(sphere);
    joints[name] = obj;
    if (parentName) joints[parentName].add(obj); else root.add(obj);
  }

  root.updateMatrixWorld(true);
  for (const [name, parentName] of Object.entries(JOINTS)) {
    if (!parentName) continue;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, 1, 8), boneMat);
    scene.add(mesh);
    bones.push({ mesh, a: joints[parentName], b: joints[name] });
  }

  const trailMat = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: .75 });
  const leftTrailGeo = new THREE.BufferGeometry();
  const rightTrailGeo = new THREE.BufferGeometry();
  const leftTrail = new THREE.Line(leftTrailGeo, trailMat);
  const rightTrail = new THREE.Line(rightTrailGeo, trailMat.clone());
  scene.add(leftTrail, rightTrail);
  const trails = { left: [], right: [], leftTrail, rightTrail };

  camera.position.set(0, 1.18, 4.0);
  camera.lookAt(0, 1.15, 0);

  function resize() {
    const r = container.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  return { scene, camera, renderer, root, joints, bones, trails };
}

function resetPose(view) {
  for (const [name, obj] of Object.entries(view.joints)) {
    obj.position.fromArray(REST[name]);
    obj.rotation.set(0,0,0);
    obj.quaternion.identity();
  }
  view.root.position.set(0,0,0);
  view.root.rotation.set(0,0,0);
}

function proceduralPose(view, t) {
  resetPose(view);
  const p = view.model.profile;
  const i = state.intensity;
  const beat = t * (2.3 * p.tempo);
  const slow = t * (.72 * p.tempo);
  const a = Math.sin(beat);
  const b = Math.sin(beat * .63 + 1.3);
  const c = Math.sin(slow + .4);
  const asym = p.asymmetry;

  view.joints.spine.rotation.z = c * .025 * p.torso * i;
  view.joints.chest.rotation.y = Math.sin(slow * 1.35) * .08 * p.torso * i;
  view.joints.chest.rotation.z = Math.sin(slow * .84 + .8) * .035 * p.torso * i;
  view.joints.neck.rotation.y = Math.sin(slow * 1.9) * .035 * i;
  view.joints.head.rotation.z = Math.sin(slow * 1.45 + .3) * .018 * i;

  const l = view.joints.leftUpperArm, r = view.joints.rightUpperArm;
  const lf = view.joints.leftForeArm, rf = view.joints.rightForeArm;
  l.rotation.z = .38 + (.34 * a + .16 * b) * p.reach * i;
  r.rotation.z = -.38 + (-.31 * Math.sin(beat + asym) - .15 * Math.sin(beat*.58 + 2.0)) * p.reach * i;
  l.rotation.x = (.17 + .18 * Math.sin(beat*.47 + .4)) * p.reach * i;
  r.rotation.x = (.17 + .16 * Math.sin(beat*.51 + 1.7)) * p.reach * i;
  lf.rotation.z = (.34 + .25 * Math.sin(beat * .72 + 1.0)) * i;
  rf.rotation.z = (-.34 - .23 * Math.sin(beat * .69 + 2.0)) * i;
  lf.rotation.y = .12 * Math.sin(beat*.9) * i;
  rf.rotation.y = .12 * Math.sin(beat*.82 + 1.1) * i;
  view.joints.leftHand.rotation.x = .13 * Math.sin(beat*1.4) * i;
  view.joints.rightHand.rotation.x = .13 * Math.sin(beat*1.3 + .8) * i;
  view.root.position.y = Math.sin(t * 2.1) * .004 * i;
}

function sampleImported(data, t) {
  const frames = data.frames || [];
  if (!frames.length) return null;
  const fps = data.fps || 30;
  const duration = frames.length / fps;
  const tt = Math.max(0, Math.min(t, Math.max(0, duration - 1/fps)));
  const f = tt * fps;
  const a = Math.floor(f), b = Math.min(frames.length - 1, a + 1), alpha = f - a;
  return { a: frames[a], b: frames[b], alpha };
}

function applyImported(view, data, t) {
  resetPose(view);
  const s = sampleImported(data, t);
  if (!s) return;
  const applyFrame = (joint, fa, fb, alpha) => {
    const A = fa?.joints?.[joint], B = fb?.joints?.[joint] || A;
    if (!A || !B) return;
    const obj = view.joints[joint];
    if (A.rotation && B.rotation) {
      const qa = new THREE.Quaternion(...A.rotation), qb = new THREE.Quaternion(...B.rotation);
      obj.quaternion.copy(qa).slerp(qb, alpha);
    }
    if (A.position && B.position) {
      const va = new THREE.Vector3(...A.position), vb = new THREE.Vector3(...B.position);
      obj.position.copy(va.lerp(vb, alpha));
    }
  };
  for (const joint of Object.keys(JOINTS)) applyFrame(joint, s.a, s.b, s.alpha);
  const RA = s.a.root, RB = s.b.root || RA;
  if (RA?.position && RB?.position) {
    view.root.position.fromArray(RA.position).lerp(new THREE.Vector3(...RB.position), s.alpha);
  }
}

function updateBones(view) {
  const av = new THREE.Vector3(), bv = new THREE.Vector3(), mid = new THREE.Vector3();
  for (const bone of view.bones) {
    bone.a.getWorldPosition(av); bone.b.getWorldPosition(bv);
    const dist = av.distanceTo(bv);
    mid.copy(av).add(bv).multiplyScalar(.5);
    bone.mesh.position.copy(mid);
    bone.mesh.scale.set(1, dist, 1);
    bone.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), bv.clone().sub(av).normalize());
  }
}

function updateTrails(view) {
  const { trails } = view;
  if (!state.showTrails) {
    trails.leftTrail.visible = trails.rightTrail.visible = false;
    trails.left.length = trails.right.length = 0;
    return;
  }
  trails.leftTrail.visible = trails.rightTrail.visible = true;
  const l = new THREE.Vector3(), r = new THREE.Vector3();
  view.joints.leftHand.getWorldPosition(l); view.joints.rightHand.getWorldPosition(r);
  trails.left.push(l); trails.right.push(r);
  if (trails.left.length > 55) trails.left.shift();
  if (trails.right.length > 55) trails.right.shift();
  trails.leftTrail.geometry.setFromPoints(trails.left);
  trails.rightTrail.geometry.setFromPoints(trails.right);
}

function setCamera(view) {
  if (state.viewMode === 'front') view.camera.position.set(0, 1.18, 4.0);
  if (state.viewMode === 'side') view.camera.position.set(4.0, 1.18, 0);
  if (state.viewMode === 'threequarter') view.camera.position.set(2.7, 1.35, 2.7);
  view.camera.lookAt(0, 1.13, 0);
}

function render() {
  const t = state.audio.currentTime || 0;
  for (const [id, view] of state.views) {
    const imported = state.imported.get(id);
    if (imported) applyImported(view, imported, t); else proceduralPose(view, t);
    view.joints.hips.children[0].visible = state.showRoot;
    view.root.updateMatrixWorld(true);
    updateBones(view);
    updateTrails(view);
    setCamera(view);
    view.renderer.render(view.scene, view.camera);
  }
  syncTimeline();
  state.raf = requestAnimationFrame(render);
}

function syncTimeline() {
  const audio = state.audio;
  $('#currentTime').textContent = formatTime(audio.currentTime);
  $('#duration').textContent = formatTime(audio.duration);
  const timeline = $('#timeline');
  if (Number.isFinite(audio.duration) && audio.duration > 0 && document.activeElement !== timeline) {
    timeline.value = String(audio.currentTime / audio.duration);
  }
  $('#playPause').textContent = audio.paused ? '▶ Reproducir' : '❚❚ Pausar';
}

function markImported(id, data, filename) {
  const view = state.views.get(id);
  if (!view) return;
  state.imported.set(id, data);
  const status = view.card.querySelector('.status');
  status.textContent = `Movimiento real · ${filename}`;
  status.classList.add('real');
  view.card.querySelector('.download').disabled = false;
}

function detectTarget(data, filename) {
  if (data.model && state.views.has(String(data.model).toLowerCase())) return String(data.model).toLowerCase();
  const f = filename.toLowerCase();
  return MODELS.find(m => f.includes(m.id))?.id || 'custom';
}

function downloadMotion(id) {
  const data = state.imported.get(id);
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}-motion.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

for (const model of MODELS) buildCard(model);

$('#audioFile').addEventListener('change', (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  state.audio.src = url;
  $('#fileName').textContent = file.name;
  state.audio.addEventListener('loadedmetadata', () => {
    $('#playPause').disabled = false;
    $('#restart').disabled = false;
    $('#timeline').disabled = false;
    syncTimeline();
  }, { once: true });
});

$('#playPause').addEventListener('click', () => state.audio.paused ? state.audio.play() : state.audio.pause());
$('#restart').addEventListener('click', () => { state.audio.currentTime = 0; });
$('#timeline').addEventListener('input', (e) => {
  if (Number.isFinite(state.audio.duration)) state.audio.currentTime = Number(e.target.value) * state.audio.duration;
});

for (const btn of document.querySelectorAll('.view-button')) btn.addEventListener('click', () => {
  state.viewMode = btn.dataset.view;
  document.querySelectorAll('.view-button').forEach(b => b.classList.toggle('active', b === btn));
});
$('#showTrails').addEventListener('change', e => state.showTrails = e.target.checked);
$('#showRoot').addEventListener('change', e => state.showRoot = e.target.checked);
$('#globalIntensity').addEventListener('input', e => {
  state.intensity = Number(e.target.value);
  $('#intensityValue').textContent = `${state.intensity.toFixed(2)}×`;
});

$('#motionFile').addEventListener('change', async (e) => {
  for (const file of [...(e.target.files || [])]) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.frames)) throw new Error('Falta frames[]');
      markImported(detectTarget(data, file.name), data, file.name);
    } catch (err) {
      alert(`No pude cargar ${file.name}: ${err.message}`);
    }
  }
});

render();
