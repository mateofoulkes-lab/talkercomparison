import * as THREE from 'three';

const MODELS = [
  { id: 'pantomatrix', name: 'PantoMatrix / EMAGE', source: 'SMPL-X' },
  { id: 'streamtalk', name: 'StreamTalk', source: 'SMPL-X' },
  { id: 'unicamp', name: 'UNICAMP GENEA', source: 'SMPL-H' },
  { id: 'dlp3d', name: 'DLP3D Speech2Motion', source: '3D motion' },
  { id: 'freeform', name: 'Free-form Co-Speech', source: 'pose sequence' },
  { id: 'custom', name: 'Custom / imported', source: 'Common JSON' },
];

const JOINTS = {
  hips: null,
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  leftShoulder: 'chest', leftUpperArm: 'leftShoulder', leftForeArm: 'leftUpperArm', leftHand: 'leftForeArm',
  rightShoulder: 'chest', rightUpperArm: 'rightShoulder', rightForeArm: 'rightUpperArm', rightHand: 'rightForeArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg'
};

// Humanoid neutral rest pose. Arms hang naturally instead of starting in a T-pose.
const REST = {
  hips: [0, 0.98, 0],
  spine: [0, 0.20, 0],
  chest: [0, 0.26, 0],
  neck: [0, 0.20, 0],
  head: [0, 0.18, 0],

  leftShoulder: [-0.17, 0.08, 0],
  leftUpperArm: [-0.08, -0.18, 0],
  leftForeArm: [-0.02, -0.29, 0.015],
  leftHand: [-0.01, -0.20, 0.025],

  rightShoulder: [0.17, 0.08, 0],
  rightUpperArm: [0.08, -0.18, 0],
  rightForeArm: [0.02, -0.29, 0.015],
  rightHand: [0.01, -0.20, 0.025],

  leftUpperLeg: [-0.10, -0.10, 0],
  leftLowerLeg: [0, -0.43, 0],
  leftFoot: [0, -0.40, 0.08],
  rightUpperLeg: [0.10, -0.10, 0],
  rightLowerLeg: [0, -0.43, 0],
  rightFoot: [0, -0.40, 0.08]
};

const state = {
  audio: document.querySelector('#audio'),
  views: new Map(),
  viewMode: 'front',
  showTrails: false,
  showRoot: true,
  intensity: 1,
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
      <div>
        <div class="viewer-title">${model.name}</div>
        <div class="viewer-meta">${model.source}</div>
      </div>
      <span class="status">Sin resultado real</span>
    </div>
    <div class="canvas-wrap"></div>
    <div class="viewer-foot">
      <span class="metric">Rig común</span>
      <span class="metric">Idle neutro</span>
      <span class="spacer"></span>
      <button class="download" disabled>Descargar JSON</button>
    </div>`;

  grid.appendChild(card);
  const view = makeViewer(card.querySelector('.canvas-wrap'));
  state.views.set(model.id, { ...view, model, card });
  card.querySelector('.download').addEventListener('click', () => downloadMotion(model.id));
}

function makeViewer(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1, 0.01, 100);
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

    const radius = name === 'head' ? 0.07 : (name.includes('Hand') || name.includes('Foot') ? 0.022 : 0.027);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 16, 12),
      name === 'hips' ? rootMat : jointMat
    );
    obj.add(sphere);
    joints[name] = obj;

    if (parentName) joints[parentName].add(obj);
    else root.add(obj);
  }

  root.updateMatrixWorld(true);
  for (const [name, parentName] of Object.entries(JOINTS)) {
    if (!parentName) continue;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1, 8), boneMat);
    scene.add(mesh);
    bones.push({ mesh, a: joints[parentName], b: joints[name] });
  }

  // Pelvis and shoulder bars make the stick figure read as an actual humanoid.
  const barMat = new THREE.MeshBasicMaterial({ color: 0x8ca2ff });
  const pelvisBar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), barMat);
  const shoulderBar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), barMat.clone());
  scene.add(pelvisBar, shoulderBar);

  const trailMat = new THREE.LineBasicMaterial({ color: 0x7ce8ff, transparent: true, opacity: 0.75 });
  const leftTrail = new THREE.Line(new THREE.BufferGeometry(), trailMat);
  const rightTrail = new THREE.Line(new THREE.BufferGeometry(), trailMat.clone());
  scene.add(leftTrail, rightTrail);

  const trails = { left: [], right: [], leftTrail, rightTrail };

  camera.position.set(0, 1.15, 4.25);
  camera.lookAt(0, 1.05, 0);

  function resize() {
    const r = container.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  return { scene, camera, renderer, root, joints, bones, pelvisBar, shoulderBar, trails };
}

function resetPose(view) {
  for (const [name, obj] of Object.entries(view.joints)) {
    obj.position.fromArray(REST[name]);
    obj.rotation.set(0, 0, 0);
    obj.quaternion.identity();
  }
  view.root.position.set(0, 0, 0);
  view.root.rotation.set(0, 0, 0);
}

function smoothPulse(t, center, width) {
  const x = Math.abs(t - center) / width;
  if (x >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * x);
}

// Neutral placeholder only. It is intentionally the SAME for every model.
// It should read as a person quietly talking, never as a model result.
function neutralTalkingIdle(view, t) {
  resetPose(view);
  const i = state.intensity;

  const breathe = Math.sin(t * 1.15) * 0.008 * i;
  const weight = Math.sin(t * 0.38) * 0.018 * i;
  const headNod = Math.sin(t * 0.72 + 0.7) * 0.018 * i;

  view.joints.spine.rotation.z = weight * 0.22;
  view.joints.chest.rotation.y = Math.sin(t * 0.31) * 0.022 * i;
  view.joints.chest.rotation.x = breathe;
  view.joints.neck.rotation.y = Math.sin(t * 0.44 + 1.1) * 0.018 * i;
  view.joints.head.rotation.x = headNod;
  view.joints.head.rotation.z = Math.sin(t * 0.29) * 0.008 * i;

  // Occasional, low-amplitude conversational beats instead of continuous arm waving.
  const cycle = t % 12;
  const leftBeat = smoothPulse(cycle, 3.3, 1.05);
  const rightBeat = smoothPulse(cycle, 7.7, 1.10);
  const bothBeat = smoothPulse(cycle, 10.3, 0.75) * 0.55;

  view.joints.leftUpperArm.rotation.x = -(0.15 * leftBeat + 0.07 * bothBeat) * i;
  view.joints.leftUpperArm.rotation.z = -(0.08 * leftBeat + 0.035 * bothBeat) * i;
  view.joints.leftForeArm.rotation.x = -(0.34 * leftBeat + 0.18 * bothBeat) * i;
  view.joints.leftForeArm.rotation.z = 0.05 * leftBeat * i;
  view.joints.leftHand.rotation.x = -0.08 * leftBeat * i;

  view.joints.rightUpperArm.rotation.x = -(0.15 * rightBeat + 0.07 * bothBeat) * i;
  view.joints.rightUpperArm.rotation.z = (0.08 * rightBeat + 0.035 * bothBeat) * i;
  view.joints.rightForeArm.rotation.x = -(0.34 * rightBeat + 0.18 * bothBeat) * i;
  view.joints.rightForeArm.rotation.z = -0.05 * rightBeat * i;
  view.joints.rightHand.rotation.x = -0.08 * rightBeat * i;

  // Tiny stance variation; feet stay planted.
  view.joints.hips.position.x += weight * 0.12;
}

function sampleImported(data, t) {
  const frames = data.frames || [];
  if (!frames.length) return null;
  const fps = data.fps || 30;
  const duration = frames.length / fps;
  const tt = Math.max(0, Math.min(t, Math.max(0, duration - 1 / fps)));
  const f = tt * fps;
  const a = Math.floor(f);
  const b = Math.min(frames.length - 1, a + 1);
  return { a: frames[a], b: frames[b], alpha: f - a };
}

function applyImported(view, data, t) {
  resetPose(view);
  const s = sampleImported(data, t);
  if (!s) return;

  for (const joint of Object.keys(JOINTS)) {
    const A = s.a?.joints?.[joint];
    const B = s.b?.joints?.[joint] || A;
    if (!A || !B) continue;
    const obj = view.joints[joint];

    if (A.rotation && B.rotation) {
      const qa = new THREE.Quaternion(...A.rotation);
      const qb = new THREE.Quaternion(...B.rotation);
      obj.quaternion.copy(qa).slerp(qb, s.alpha);
    }
    if (A.position && B.position) {
      const va = new THREE.Vector3(...A.position);
      const vb = new THREE.Vector3(...B.position);
      obj.position.copy(va.lerp(vb, s.alpha));
    }
  }

  const RA = s.a.root;
  const RB = s.b.root || RA;
  if (RA?.position && RB?.position) {
    view.root.position.fromArray(RA.position).lerp(new THREE.Vector3(...RB.position), s.alpha);
  }
}

function alignCylinder(mesh, aObj, bObj) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  aObj.getWorldPosition(a);
  bObj.getWorldPosition(b);
  const d = b.clone().sub(a);
  const dist = d.length();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(1, dist, 1);
  if (dist > 0.00001) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
}

function updateBones(view) {
  for (const bone of view.bones) alignCylinder(bone.mesh, bone.a, bone.b);
  alignCylinder(view.pelvisBar, view.joints.leftUpperLeg, view.joints.rightUpperLeg);
  alignCylinder(view.shoulderBar, view.joints.leftShoulder, view.joints.rightShoulder);
}

function updateTrails(view) {
  const { trails } = view;
  if (!state.showTrails) {
    trails.leftTrail.visible = trails.rightTrail.visible = false;
    trails.left.length = trails.right.length = 0;
    return;
  }

  trails.leftTrail.visible = trails.rightTrail.visible = true;
  const l = new THREE.Vector3();
  const r = new THREE.Vector3();
  view.joints.leftHand.getWorldPosition(l);
  view.joints.rightHand.getWorldPosition(r);
  trails.left.push(l);
  trails.right.push(r);
  if (trails.left.length > 55) trails.left.shift();
  if (trails.right.length > 55) trails.right.shift();
  trails.leftTrail.geometry.setFromPoints(trails.left);
  trails.rightTrail.geometry.setFromPoints(trails.right);
}

function setCamera(view) {
  if (state.viewMode === 'front') view.camera.position.set(0, 1.15, 4.25);
  if (state.viewMode === 'side') view.camera.position.set(4.25, 1.15, 0);
  if (state.viewMode === 'threequarter') view.camera.position.set(3.0, 1.35, 3.0);
  view.camera.lookAt(0, 1.05, 0);
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

function render() {
  const t = state.audio.currentTime || 0;
  for (const [id, view] of state.views) {
    const imported = state.imported.get(id);
    if (imported) applyImported(view, imported, t);
    else neutralTalkingIdle(view, t);

    view.joints.hips.children[0].visible = state.showRoot;
    view.root.updateMatrixWorld(true);
    updateBones(view);
    updateTrails(view);
    setCamera(view);
    view.renderer.render(view.scene, view.camera);
  }
  syncTimeline();
  requestAnimationFrame(render);
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
  const file = e.target.files?.[0];
  if (!file) return;
  state.audio.src = URL.createObjectURL(file);
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

for (const btn of document.querySelectorAll('.view-button')) {
  btn.addEventListener('click', () => {
    state.viewMode = btn.dataset.view;
    document.querySelectorAll('.view-button').forEach(b => b.classList.toggle('active', b === btn));
  });
}

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
