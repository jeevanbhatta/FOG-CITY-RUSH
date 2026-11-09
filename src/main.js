import * as THREE from 'three';
import { buildWorld, BRIDGE } from './world.js';
import { Player, LOOKS, SKIN_TONES } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud, fmtTime } from './hud.js';
import { defineCourses, resolveCourse, CourseRunner } from './courses.js';
import { fallbackMap } from './fallback-map.js';
import { Car, Seaplane, findParking, findWater } from './vehicles.js';
import { Sound } from './audio.js';
import { Particles } from './particles.js';
import { Ghost, GhostRecorder } from './ghost.js';
import { loadSettings, saveSettings, QUALITY } from './settings.js';
import { Sky } from './sky.js';
import { Traffic, Gulls } from './life.js';
import { Minimap } from './minimap.js';
import { placeParcels, Parcels } from './parcels.js';
import { Details } from './details.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const isTouch = matchMedia('(pointer: coarse)').matches;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const store = {
  get(k) { try { const v = localStorage.getItem('fcr.' + k); return v == null ? null : JSON.parse(v); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem('fcr.' + k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
};
const S = loadSettings(isTouch);

// ---------- loading screen ----------
const loading = $('#loading');
function setLoad(pct, text) {
  $('#load-bar').style.width = `${Math.min(100, pct)}%`;
  if (text) $('#load-step').textContent = text;
}

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcdd5d8, 70, 1150);
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4000);
const hemi = new THREE.HemisphereLight(0xdfe7ec, 0x8b8273, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -80; sc.right = sc.top = 80; sc.near = 10; sc.far = 600;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const sky = new Sky(scene, sun, hemi, renderer);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (particles) particles.resize(h * renderer.getPixelRatio());
}
let particles = null;
window.addEventListener('resize', resize);

// ---------- load the map ----------
async function loadMap() {
  try {
    const res = await fetch('data/embarcadero.json');
    if (!res.ok) throw new Error(res.status);
    const total = +res.headers.get('content-length') || 0;
    if (!res.body || !total) return await res.json();
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      setLoad(5 + 50 * Math.min(1, got / total), 'Downloading the Embarcadero');
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return JSON.parse(new TextDecoder().decode(all));
  } catch (e) {
    console.warn('Using generated map:', e);
    return fallbackMap();
  }
}

setLoad(4, 'Downloading the Embarcadero');
const map = await loadMap();
$('#attribution').textContent = map.meta.generated ? 'Generated stand-in layout' : '© OpenStreetMap contributors';
setLoad(60, 'Raising the skyline');
await nextFrame();

const W = buildWorld(map, scene);
setLoad(82, 'Stringing ziplines and parking cars');
await nextFrame();

const player = new Player(W.world, scene);
player.setLook(S.look, S.skin);
const rig = new CameraRig(camera, W.world);
const input = new Input(canvas, $('#touch'));
const hud = new Hud();
const runner = new CourseRunner(scene);
const sound = new Sound();
particles = new Particles(scene);

// Keep the runner inside the city plus the bridge span.
{
  const b = W.bounds.slice();
  const end = W.landmarks.bridgeInfo.at(BRIDGE.centreU + 60, 0);
  b[0] = Math.min(b[0], end[0] - 40); b[2] = Math.max(b[2], end[0] + 40);
  b[1] = Math.min(b[1], end[1] - 40); b[3] = Math.max(b[3], end[1] + 40);
  player.bounds = b;
}

// ---------- vehicles ----------
const V = { cars: [], plane: null, carStart: null, dock: null };
{
  const f = W.landmarks.ferry;
  const bi = W.landmarks.bridgeInfo;
  // Nearest point on The Embarcadero to the plaza: the race start and the first parked car.
  let best = null, bd = Infinity;
  for (const r of map.roads) {
    if (!r.n || !/embarcadero/i.test(r.n)) continue;
    for (const q of r.p) {
      const d = Math.hypot(q[0] - f.plaza[0], q[1] - f.plaza[1]);
      if (d < bd) { bd = d; best = q; }
    }
  }
  const shore = bi.at(0, 0);
  const toBridge = Math.atan2(shore[0] - f.plaza[0], shore[1] - f.plaza[1]);
  const spots = [];
  if (best) spots.push([best[0], best[1], toBridge]);
  spots.push([f.plaza[0] - f.face[1] * 30, f.plaza[1] + f.face[0] * 30, toBridge]);
  const ramp = bi.at(-BRIDGE.rampLen - 25, 0);
  spots.push([ramp[0], ramp[1], Math.atan2(W.landmarks.bridge.dx, W.landmarks.bridge.dz)]);
  const colors = [0xe8552b, 0x2f6f8f, 0xf2c14e];
  spots.forEach(([x, z, h], i) => {
    const p = findParking(W.world, x, z, h);
    if (!p) return;
    const car = new Car(scene, p.x, p.y, p.z, h, colors[i % colors.length]);
    V.cars.push(car);
    if (!V.carStart) V.carStart = { pos: p.clone(), heading: h };
  });
  // Seaplane dock: open water off the bay side of the Ferry Building.
  const bx = -f.face[0], bz = -f.face[1];
  const wp = findWater(W.world, bx * 60, bz * 60, bx, bz);
  if (wp) {
    let sx = wp.x, sz = wp.z;
    for (let d = 0; d < 400; d += 2) {
      const qx = wp.x - bx * d, qz = wp.z - bz * d;
      const fl = W.world.floorAt(qx, qz, 3, 0);
      if (fl.solid && !W.world.pointBlocked(qx, fl.y + 1, qz)) { sx = qx; sz = qz; break; }
    }
    const heading = Math.atan2(bx, bz);
    V.dock = { pos: wp.clone(), heading, shore: new THREE.Vector3(sx, 0, sz) };
    V.plane = new Seaplane(scene, wp.x, wp.z, heading, V.dock);
    const b = W.bounds;
    V.plane.bounds = [b[0] - 700, b[1] - 700, b[2] + 1300, b[3] + 500];
  }
}
const vehicles = () => (V.plane ? [...V.cars, V.plane] : V.cars);
let driving = null;

// ---------- life and street detail ----------
const traffic = new Traffic(scene, map.roads, QUALITY[S.quality].traffic);
setLoad(90, 'Planting trees and painting crosswalks');
await nextFrame();
const details = (() => {
  const avoid = [];
  const f = W.landmarks.ferry;
  avoid.push([f.plaza[0], f.plaza[1], 22], [0, 0, 16]);
  for (const c of V.cars) avoid.push([c.pos.x, c.pos.z, 4]);
  if (V.dock) avoid.push([V.dock.shore.x, V.dock.shore.z, 8]);
  for (const L of W.world.ladders) {
    avoid.push([L.x + L.nx, L.z + L.nz, 2]);
    avoid.push([L.x - L.nx * 2, L.z - L.nz * 2, 3]);
  }
  for (const Z of W.world.ziplines) avoid.push([Z.ax, Z.az, 3], [Z.bx, Z.bz, 4]);
  // Keep the tallest roof clear: it's the Skyline Drop start.
  let tall = null;
  for (const b of W.buildings) if ((b.s.maxX - b.s.minX) * (b.s.maxZ - b.s.minZ) >= 600 && (!tall || b.s.y1 > tall.s.y1)) tall = b;
  if (tall) avoid.push([tall.cx, tall.cz, Math.max(tall.s.maxX - tall.s.minX, tall.s.maxZ - tall.s.minZ)]);
  return new Details(scene, W, map, {
    avoid,
    radius: QUALITY[S.quality].detailRadius,
    trafficRoads: new Set(traffic.routes.map((r) => r.p)),
  });
})();

const courses = defineCourses(W, V).map((c) => resolveCourse(c, W.world));

// ---------- ghosts, parcels, minimap ----------
const gullCentres = [[W.landmarks.ferry.face[0] * -120, W.landmarks.ferry.face[1] * -120]];
for (const p of map.piers.slice(0, 6)) gullCentres.push([p[0][0], p[0][1]]);
const gulls = new Gulls(scene, gullCentres);
const ghost = new Ghost(scene, V.cars[0] ? V.cars[0].mesh : new THREE.Group(), V.plane ? V.plane.mesh : new THREE.Group());
const recorder = new GhostRecorder();
const parcels = new Parcels(scene, placeParcels(W, V), store.get('parcels'));
const minimap = new Minimap($('#minimap'), map);
{
  const bi = W.landmarks.bridgeInfo;
  const a = bi.at(-BRIDGE.rampLen, 0), b = bi.at(BRIDGE.centreU, 0);
  minimap.line(a[0], a[1], b[0], b[1], 24, '#8f9aa1');
}

// Blob shadows stand in for real shadows on low quality.
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
const blobGeo = new THREE.CircleGeometry(0.55, 20).rotateX(-Math.PI / 2);
const blobs = [player, ...vehicles()].map((owner) => {
  const m = new THREE.Mesh(blobGeo, blobMat);
  if (owner.kind === 'car') m.scale.set(2, 1, 4);
  if (owner.kind === 'plane') m.scale.set(6, 1, 6);
  m.renderOrder = 1;
  scene.add(m);
  return { owner, m };
});

// ---------- settings ----------
function applySettings() {
  const q = QUALITY[S.quality] || QUALITY.high;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  if (renderer.shadowMap.enabled !== q.shadows) {
    renderer.shadowMap.enabled = q.shadows;
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }
  sun.castShadow = q.shadows;
  if (sun.shadow.mapSize.x !== q.shadowSize) {
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  W.outlines.visible = q.outlines;
  particles.density = q.particles;
  sky.fogBase = q.fogFar;
  traffic.setCount(q.traffic);
  details.setRadius(q.detailRadius);
  input.sensitivity = 0.0024 * S.sensitivity;
  input.invertY = S.invertLook;
  rig.reduceMotion = S.reduceMotion;
  sound.setVolume(S.volume);
  sky.setMode(S.timeOfDay);
  document.body.classList.toggle('no-minimap', !S.minimap);
  for (const b of blobs) b.m.visible = !q.shadows;
  resize();
}
applySettings();

let settingsReturn = '#menu';
function openSettings(from) {
  settingsReturn = from;
  $('#set-sens').value = S.sensitivity;
  $('#set-vol').value = S.volume;
  $('#set-quality').value = S.quality;
  $('#set-time').value = S.timeOfDay;
  $('#set-invert-look').checked = S.invertLook;
  $('#set-invert-flight').checked = S.invertFlight;
  $('#set-reduce').checked = S.reduceMotion;
  $('#set-minimap').checked = S.minimap;
  showScreen('#settings');
}
const bindSetting = (id, key, read) => $(id).addEventListener('input', (e) => {
  S[key] = read(e.target);
  saveSettings(S);
  applySettings();
});
bindSetting('#set-sens', 'sensitivity', (el) => +el.value);
bindSetting('#set-vol', 'volume', (el) => +el.value);
bindSetting('#set-quality', 'quality', (el) => el.value);
bindSetting('#set-time', 'timeOfDay', (el) => el.value);
bindSetting('#set-invert-look', 'invertLook', (el) => el.checked);
bindSetting('#set-invert-flight', 'invertFlight', (el) => el.checked);
bindSetting('#set-reduce', 'reduceMotion', (el) => el.checked);
bindSetting('#set-minimap', 'minimap', (el) => el.checked);

// ---------- first-time tips ----------
const seenTips = new Set(store.get('tips') || []);
const tipQueue = [];
let tipTimer = 0;
function tip(id, text) {
  if (seenTips.has(id) || tipQueue.some((t) => t.id === id)) return;
  tipQueue.push({ id, text });
}
function updateTips(dt) {
  const el = $('#tip');
  if (tipTimer > 0) {
    tipTimer -= dt;
    if (tipTimer <= 0) el.hidden = true;
    return;
  }
  const t = tipQueue.shift();
  if (!t) return;
  seenTips.add(t.id);
  store.set('tips', [...seenTips]);
  el.textContent = t.text;
  el.hidden = false;
  tipTimer = 5.5;
}

// ---------- game state ----------
let state = 'menu';
let active = null; // course or null for free roam
let countdown = 0;
let menuT = 0;
let timeScale = 1, slowmo = 0;

function spawnAt(p, lookAt) {
  const pos = p.clone ? p.clone() : new THREE.Vector3(p[0], 0, p[1]);
  const fl = W.world.floorAt(pos.x, pos.z, pos.y + 2, 0.2);
  if (fl.solid) pos.y = fl.y;
  let yaw = 0;
  if (lookAt) yaw = Math.atan2(lookAt.x - pos.x, lookAt.z - pos.z);
  player.reset(pos, yaw);
  rig.yaw = yaw + Math.PI;
  rig.pitch = 0.22;
  rig.target.copy(pos).y += 1.6;
}

function lockPointer() {
  if (isTouch) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* fine: drag to look */ }
}

function enterVehicle(v) {
  driving = v;
  player.avatar.root.visible = false;
  player.vel.set(0, 0, 0);
  rig.yaw = v.heading + Math.PI;
  rig.pitch = v.kind === 'plane' ? 0.25 : 0.2;
  rig.curDist = 8;
  setTouchMode(v.kind);
  sound.door();
  if (v.kind === 'plane') {
    tip('plane', isTouch
      ? 'Power + for throttle. Above 100 km/h push the stick up to take off. Land gently on the water. Exit in flight to bail out.'
      : 'Shift for throttle. Above 100 km/h hold W to take off. Land gently on the water. F in flight bails out.');
  } else {
    tip('car', isTouch ? 'Stick to drive and steer, Drift for a handbrake slide, Exit to get out.' : 'W/S to drive, A/D to steer, Space to drift. F to get out.');
  }
}

function exitVehicle(silent = false) {
  const v = driving;
  if (!v) return;
  if (silent) {
    // Leaving a run or the menu: just put the courier back on foot.
    driving = null;
    player.avatar.root.visible = true;
    setTouchMode('foot');
    return;
  }
  sound.door();
  if (v.kind === 'plane' && v.state === 'air') {
    // Bail out: drop below the plane with its momentum; the plane flies itself back to the dock.
    const p = v.pos.clone();
    p.y -= 2.5;
    driving = null;
    player.avatar.root.visible = true;
    player.reset(p, v.heading);
    player.vel.copy(v.vel).multiplyScalar(0.6);
    v.mesh.visible = false;
    v.state = 'crashed';
    v.crashTimer = 2.5;
    setTouchMode('foot');
    hud.toast('Bailed out! Jump to open your parachute', 1800);
    sound.whoosh();
    return;
  }
  let p;
  if (v.kind === 'plane') {
    p = v.dock.shore.clone();
  } else {
    const rx = -Math.cos(v.heading), rz = Math.sin(v.heading);
    p = new THREE.Vector3(v.pos.x - rx * 2.6, v.pos.y + 0.5, v.pos.z - rz * 2.6);
    if (W.world.pointBlocked(p.x, p.y + 1, p.z)) p.set(v.pos.x, v.pos.y + 1.8, v.pos.z);
  }
  driving = null;
  player.avatar.root.visible = true;
  spawnAt(p, null);
  rig.yaw = v.heading + Math.PI;
  player.facing = v.heading;
  if (v.kind === 'car') v.vel.set(0, 0, 0);
  setTouchMode('foot');
}

function setTouchMode(mode) {
  const L = { foot: ['Grab', 'Slide', 'Jump'], car: ['', '', 'Drift'], plane: ['', 'Power −', 'Power +'] }[mode];
  $('#tb-grab').textContent = L[0]; $('#tb-grab').hidden = !L[0];
  $('#tb-slide').textContent = L[1]; $('#tb-slide').hidden = !L[1];
  $('#tb-jump').textContent = L[2];
  if (mode !== 'foot') { $('#tb-use').hidden = false; $('#tb-use').textContent = 'Exit'; }
}

function nearestVehicle() {
  let best = null, bd = Infinity;
  for (const v of vehicles()) {
    if (v.kind === 'plane' && v.state === 'crashed') continue;
    const reach = v.kind === 'plane' ? 30 : 4.5;
    const d = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z);
    if (d < reach && d < bd && Math.abs(v.pos.y - player.pos.y) < (v.kind === 'plane' ? 6 : 3)) { bd = d; best = v; }
  }
  return best;
}

function resetVehicleAt(v, p, next, airborne) {
  const heading = next ? Math.atan2(next.x - p.x, next.z - p.z) : v.heading;
  if (v.kind === 'plane') {
    if (!airborne) v.resetToDock();
    else v.place(p.clone(), heading, true, 34);
  } else {
    v.place(p.clone(), heading);
  }
  rig.yaw = heading + Math.PI;
}

function resetAllVehicles() {
  for (const c of V.cars) c.place(c.home.pos, c.home.heading);
  if (V.plane) V.plane.resetToDock();
}

function startCourse(c) {
  if (driving) exitVehicle(true);
  active = c;
  resetAllVehicles();
  runner.start(c);
  spawnAt(c.pts[0], c.pts[1]);
  if (c.vehicle === 'car' && V.cars[0]) {
    resetVehicleAt(V.cars[0], c.pts[0], c.pts[1], false);
    enterVehicle(V.cars[0]);
  } else if (c.vehicle === 'plane' && V.plane) {
    V.plane.resetToDock();
    enterVehicle(V.plane);
  }
  hud.setCourse(c.name, store.get('best.' + c.id));
  ghost.load(store.get('ghost.' + c.id));
  ghost.update(0, 0);
  recorder.start();
  parcels.show(false);
  state = 'countdown';
  countdown = 3.0;
  lastBeep = 4;
  showScreen(null);
  hud.show(true);
  input.enabled = true;
  lockPointer();
  if (c.relay) tip('relay', 'Relay: any way is fair. Press F at the car and the seaplane, and bail out in flight for the final drop.');
}

function startFree() {
  if (driving) exitVehicle(true);
  active = null;
  runner.clear();
  ghost.hide();
  resetAllVehicles();
  const p = W.landmarks.ferry.plaza;
  spawnAt(new THREE.Vector3(p[0], 0, p[1]), new THREE.Vector3(0, 0, 0));
  hud.setCourse('Free roam', null);
  parcels.show(true);
  state = 'play';
  showScreen(null);
  hud.show(true);
  input.enabled = true;
  hud.toast('Free roam', 1400);
  tip('move', isTouch ? 'Left side to run, right side to look. Push the stick all the way to sprint.' : 'WASD to run, mouse to look. Hold Shift to sprint.');
  tip('parcels', `Fog City postcards glow on rooftops, piers and the bridge. Find all ${parcels.total}.`);
  lockPointer();
}

function toMenu() {
  if (driving) exitVehicle(true);
  state = 'menu';
  runner.clear();
  ghost.hide();
  parcels.show(false);
  hud.show(false);
  input.enabled = false;
  sound.silence();
  if (document.pointerLockElement) document.exitPointerLock();
  renderMenu();
  showScreen('#menu');
}

function pause() {
  if (state !== 'play' && state !== 'countdown') return;
  state = 'paused';
  input.enabled = false;
  sound.silence();
  showScreen('#pause');
}

function resume() {
  showScreen(null);
  state = countdown > 0 ? 'countdown' : 'play';
  input.enabled = true;
  lockPointer();
}

function finish() {
  state = 'results';
  input.enabled = false;
  sound.finish();
  sound.silence();
  if (document.pointerLockElement) document.exitPointerLock();
  const t = runner.time;
  const key = 'best.' + active.id;
  const prev = store.get(key);
  const prevSplits = store.get('splits.' + active.id);
  const isBest = prev == null || t < prev;
  if (isBest) {
    store.set(key, t);
    store.set('splits.' + active.id, runner.splits);
    store.set('ghost.' + active.id, recorder.samples);
  }
  const m = active.medals;
  const medal = t <= m.gold ? 'Gold' : t <= m.silver ? 'Silver' : t <= m.bronze ? 'Bronze' : null;
  $('#res-course').textContent = active.name;
  $('#res-time').textContent = fmtTime(t);
  $('#res-medal').textContent = medal ? `${medal} medal` : `No medal. Bronze is ${fmtTime(m.bronze)}`;
  $('#res-medal').dataset.medal = (medal || 'none').toLowerCase();
  $('#res-best').textContent = isBest
    ? (prev == null ? 'First finish recorded. Your ghost will race you next time.' : `New best, ${fmtTime(prev - t)} faster. Ghost updated.`)
    : `Best ${fmtTime(prev)}`;
  const list = $('#res-splits');
  list.innerHTML = '';
  runner.splits.forEach((s, i) => {
    const li = document.createElement('li');
    const last = i === runner.splits.length - 1;
    let delta = '';
    if (prevSplits && prevSplits[i] != null) {
      const d = s - prevSplits[i];
      delta = `<span class="d ${d <= 0 ? 'faster' : 'slower'}">${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}</span>`;
    }
    li.innerHTML = `<span>${last ? 'Finish' : 'Checkpoint ' + (i + 1)}</span><span>${fmtTime(s)} ${delta}</span>`;
    list.appendChild(li);
  });
  showScreen('#results');
}

function showScreen(sel) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = true;
  if (sel) $(sel).hidden = false;
  document.body.classList.toggle('in-game', !sel);
}

function renderMenu() {
  const list = $('#course-list');
  list.innerHTML = '';
  courses.forEach((c, i) => {
    const best = store.get('best.' + c.id);
    const m = c.medals;
    const medal = best == null ? '' : best <= m.gold ? 'gold' : best <= m.silver ? 'silver' : best <= m.bronze ? 'bronze' : '';
    const kind = c.vehicle === 'car' ? 'Car' : c.vehicle === 'plane' ? 'Seaplane' : c.relay ? 'Relay' : c.id === 'drop' ? 'Parachute' : 'On foot';
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="course" id="course-${c.id}" data-i="${i}">
        <span class="c-head"><span class="c-name">${c.name}</span><span class="c-diff" data-d="${c.difficulty.toLowerCase()}">${c.difficulty}</span></span>
        <span class="c-blurb">${c.blurb}</span>
        <span class="c-meta">
          <span>${kind} · ${(c.length / 1000).toFixed(2)} km · ${c.pts.length - 1} rings</span>
          <span>Gold ${fmtTime(m.gold)}</span>
          <span class="c-best ${medal}">${best != null ? 'Best ' + fmtTime(best) : 'Not run yet'}</span>
        </span>
      </button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button.course').forEach((b) => b.addEventListener('click', () => startCourse(courses[+b.dataset.i])));
  $('#parcel-count').textContent = `Postcards ${parcels.count} / ${parcels.total}`;
  renderCharacter();
}

function renderCharacter() {
  const chips = $('#look-chips');
  chips.innerHTML = '';
  for (const [id, L] of Object.entries(LOOKS)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.id = 'look-' + id;
    b.setAttribute('aria-pressed', String(S.look === id));
    b.innerHTML = `<i style="background:#${L.top.toString(16).padStart(6, '0')}"></i>${L.label}`;
    b.addEventListener('click', () => { S.look = id; saveSettings(S); player.setLook(S.look, S.skin); renderCharacter(); });
    chips.appendChild(b);
  }
  const sw = $('#skin-swatches');
  sw.innerHTML = '';
  SKIN_TONES.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.id = 'skin-' + i;
    b.style.background = c;
    b.setAttribute('aria-label', `Skin tone ${i + 1}`);
    b.setAttribute('aria-pressed', String(S.skin === i));
    b.addEventListener('click', () => { S.skin = i; saveSettings(S); player.setLook(S.look, S.skin); renderCharacter(); });
    sw.appendChild(b);
  });
}

$('#btn-free').addEventListener('click', startFree);
$('#btn-resume').addEventListener('click', resume);
$('#btn-restart').addEventListener('click', () => (active ? startCourse(active) : startFree()));
$('#btn-menu').addEventListener('click', toMenu);
$('#btn-retry').addEventListener('click', () => startCourse(active));
$('#btn-results-menu').addEventListener('click', toMenu);
$('#btn-pause').addEventListener('click', pause);
$('#btn-settings').addEventListener('click', () => openSettings('#menu'));
$('#btn-settings-2').addEventListener('click', () => openSettings('#pause'));
$('#btn-settings-done').addEventListener('click', () => showScreen(settingsReturn));

// Audio can only start after a gesture; also give buttons a click.
const unlock = () => sound.unlock();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);
document.addEventListener('click', (e) => { if (e.target.closest('button')) sound.click(); });

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && (state === 'play' || state === 'countdown') && !isTouch) pause();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    if (state === 'paused') resume(); else pause();
  }
  if (e.code === 'Escape') pause();
  if (e.code === 'KeyR' && (state === 'play' || state === 'countdown' || state === 'results') && active) startCourse(active);
  if (e.code === 'Enter' && state === 'results') startCourse(active);
  if (e.code === 'KeyI') {
    S.invertFlight = !S.invertFlight;
    saveSettings(S);
    if (state === 'play') hud.toast(S.invertFlight ? 'Flight: W dives' : 'Flight: W climbs', 1200);
  }
  if (e.code === 'KeyM') {
    S.minimap = !S.minimap;
    saveSettings(S);
    applySettings();
  }
});

// ---------- vehicles each frame ----------
let stallToast = 0;
let smokeT = 0;
function stepVehicle(dt, frozen) {
  const v = driving;
  const mv = frozen ? { x: 0, y: 0 } : input.move;
  if (v.kind === 'car') {
    v.update(dt, { throttle: mv.y, steer: mv.x, handbrake: !frozen && input.handbrake }, W.world);
    if (v.impact > 4) {
      const fx = Math.sin(v.heading) * 2, fz = Math.cos(v.heading) * 2;
      particles.sparks(v.pos.x + fx, v.pos.y + 0.6, v.pos.z + fz, Math.min(2, v.impact / 10));
      sound.scrape(v.impact);
      rig.shake(Math.min(0.9, v.impact / 25));
      if (v.impact > 12) hud.toast('Crunch', 500);
    }
    smokeT -= dt;
    if (v.drifting && v.onGround && smokeT <= 0) {
      smokeT = 0.04;
      const bx = -Math.sin(v.heading) * 1.4, bz = -Math.cos(v.heading) * 1.4;
      particles.smoke(v.pos.x + bx, v.pos.y, v.pos.z + bz);
    }
    if (v.pos.y < -1.4) {
      particles.splash(v.pos.x, -1.6, v.pos.z, 1.5);
      sound.splash(1.4);
      const r = active ? runner.respawn : null;
      const back = r && r.y < 5 ? r : v.home.pos;
      resetVehicleAt(v, back, active ? runner.next : null, false);
      hud.toast('The car went for a swim', 1400);
    }
  } else {
    const pitchIn = (S.invertFlight ? -1 : 1) * mv.y;
    const thr = frozen ? 0 : (input.throttleUp ? 1 : 0) - (input.throttleDown ? 1 : 0);
    v.update(dt, { pitch: pitchIn, bank: mv.x, throttleDelta: thr }, W.world, elapsed);
    if (v.state === 'water' && Math.abs(v.speed) > 3) {
      const sx = -Math.cos(v.heading) * 1.5, sz = Math.sin(v.heading) * 1.5;
      for (const s of [-1, 1]) particles.spray(v.pos.x + sx * s, -1.4, v.pos.z + sz * s, -Math.sin(v.heading) * 2, -Math.cos(v.heading) * 2);
    }
    for (const e of v.events) {
      if (e.startsWith('crash:')) {
        hud.toast(e.slice(6), 1600);
        particles.debris(v.pos.x, v.pos.y + 2, v.pos.z);
        if (v.pos.y < 2) particles.splash(v.pos.x, -1.6, v.pos.z, 2);
        sound.crash();
        rig.shake(1.2);
      } else if (e === 'Stall') {
        if (elapsed - stallToast > 2) { hud.toast('Stall! Nose down', 900); stallToast = elapsed; }
      } else if (e === 'respawn') {
        const idx = active ? runner.index - 1 : 0;
        if (active && idx > 0 && !active.relay) resetVehicleAt(v, runner.respawn.clone().setY(Math.max(30, runner.respawn.y)), runner.next, true);
        else v.resetToDock();
        rig.yaw = v.heading + Math.PI;
      } else if (e === 'Splashdown') {
        particles.splash(v.pos.x, -1.6, v.pos.z, 1);
        sound.splash(0.6);
        hud.toast(e, 900);
      } else {
        if (e === 'Takeoff') sound.whoosh();
        hud.toast(e, 900);
      }
    }
  }
  player.pos.copy(v.pos);
}

// ---------- on-foot effects ----------
let wasGround = true, slideDustT = 0, sprintDustT = 0;
function footEffects(dt) {
  const p = player, a = p.avatar;
  if (a.stepped) {
    a.stepped = false;
    if (p.onGround) {
      sound.step(p.ground && p.ground.kind === 'land' ? 'hard' : 'soft');
      if (p.speed > 11) { sprintDustT -= 1; if (sprintDustT <= 0) { particles.puff(p.pos.x, p.pos.y, p.pos.z); sprintDustT = 2; } }
    }
  }
  if (a.rung) { a.rung = false; sound.ladder(); }
  if (p.landed != null) {
    const f = p.landed;
    p.landed = null;
    sound.land(f);
    if (f > 9) particles.dust(p.pos.x, p.pos.y, p.pos.z, Math.min(2, f / 14));
    if (f > 16) rig.shake(Math.min(0.8, (f - 12) / 30));
  }
  if (wasGround && !p.onGround && p.vel.y > 8 && p.mode === 'normal') sound.jump();
  wasGround = p.onGround;
  if (p.slideTime > 0 && p.onGround) {
    slideDustT -= dt;
    if (slideDustT <= 0) { slideDustT = 0.05; particles.puff(p.pos.x, p.pos.y, p.pos.z); }
  }
  for (const e of p.events) {
    if (e === 'Wall jump' || e === 'Long jump') sound.jump();
    if (e === 'Slide') sound.whoosh();
    if (e === 'Roll') particles.dust(p.pos.x, p.pos.y, p.pos.z, 1);
    if (e === 'Parachute') { sound.whoosh(); rig.shake(0.3); tip('chute', isTouch ? 'Stick left/right to turn, up to dive, down to flare. Jump again to cut away.' : 'A/D to turn, W to dive, S to flare. Jump again to cut away.'); }
    if (e === 'Chute collapsed') rig.shake(0.5);
    if (e === 'Zipline') { sound.click(); tip('zip', 'Jump to let go early and keep your speed.'); }
    if (e === 'Climb') tip('ladder', 'Ladders run all the way to the roof. Jump to let go.');
    if (e === 'Splash') { particles.splash(p.pos.x, -1.6, p.pos.z, 1); sound.splash(1); }
    if (e !== 'Climb' && e !== 'Mantle' && e !== 'Splash') hud.toast(e, 700);
  }
  p.events.length = 0;
  // Contextual tips.
  if (!p.onGround && p.wallTimer > 0 && p.mode === 'normal') tip('walljump', 'Jump while touching a wall to wall-jump. Sprint along a wall to wall-run.');
  if (p.onGround && p.speed > 11) tip('slide', 'Press C while sprinting to slide. Tap it just before a big landing to roll.');
}

// ---------- main loop ----------
let last = performance.now();
let elapsed = 0;
let lastBeep = 4;
let mapT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Brief slow motion when you pass a ring.
  if (slowmo > 0) { slowmo -= realDt; timeScale = 0.35; } else timeScale += (1 - timeScale) * Math.min(1, realDt * 6);
  const dt = realDt * timeScale;
  elapsed += dt;
  W.update(dt, elapsed);
  sky.apply(realDt, elapsed);
  W.setWindowLights(sky.lights);
  for (const f of W.fogBanks) f.material.color.copy(scene.fog.color).lerp(new THREE.Color(0xffffff), 0.35);
  traffic.update(dt);
  gulls.update(dt, elapsed);
  particles.update(dt);
  details.update(state === 'menu' ? camera.position : (driving ? driving.pos : player.pos), sky.lights, elapsed);

  let speed3 = 0;
  if (state === 'menu') {
    menuT += realDt * 0.05;
    const r = 210;
    camera.position.set(Math.sin(menuT) * r, 70 + Math.sin(menuT * 0.7) * 12, Math.cos(menuT) * r);
    camera.lookAt(0, 38, 0);
    sun.target.position.set(0, 0, 0);
  } else {
    input.update();
    const look = input.enabled ? input.consumeLook() : [0, 0];
    if (state === 'countdown') {
      countdown -= dt;
      const n = Math.ceil(countdown);
      if (n !== lastBeep && n >= 0) { sound.beep(n === 0); lastBeep = n; }
      hud.countdown(countdown > 0 ? String(n) : 'Go');
      if (countdown <= 0) {
        state = 'play';
        runner.running = true;
        setTimeout(() => hud.countdown(null), 500);
      }
      if (driving) stepVehicle(dt, true);
      else player.update(dt, { ...input, move: { x: 0, y: 0 }, jumpHit: false, slideHit: false, grabHit: false, jump: false, sprint: false, touchMove: input.touchMove }, rig.yaw);
    } else if (state === 'play') {
      if (driving) {
        stepVehicle(dt, false);
        if (input.useHit) {
          if (active && active.vehicle) hud.toast('Finish the run, or press R to restart', 1200);
          else exitVehicle();
        }
      } else {
        player.update(dt, input, rig.yaw);
        footEffects(dt);
        if (player.pos.y < -1.4) {
          const back = active ? runner.respawn : player.safe;
          const next = active ? runner.next : null;
          spawnAt(back.clone(), next);
          hud.toast('Splash! Back on dry land', 1400);
        }
        const near = !active || !active.vehicle ? nearestVehicle() : null;
        if (near) {
          const verb = near.kind === 'plane' ? 'fly' : 'drive';
          player.prompt = `Press F to ${verb}`;
          if (input.useHit) enterVehicle(near);
        }
        $('#tb-use').hidden = !near;
        $('#tb-use').textContent = near ? (near.kind === 'plane' ? 'Fly' : 'Drive') : 'Drive';
      }
      const focus = driving ? driving.pos : player.pos;
      const ringPos = runner.next ? runner.next.clone() : null;
      const ev = runner.update(dt, focus);
      if (ev) {
        const k = active.ring || 1;
        if (ringPos) particles.confetti(ringPos.x, ringPos.y + 1.4 * k, ringPos.z);
        if (!S.reduceMotion) slowmo = 0.22;
      }
      if (ev === 'checkpoint') {
        sound.chime();
        const best = store.get('splits.' + active.id);
        const i = runner.splits.length - 1;
        const d = best && best[i] != null ? runner.splits[i] - best[i] : null;
        hud.toast(`Checkpoint ${runner.index - 1} · ${fmtTime(runner.time)}${d == null ? '' : `  ${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`}`, 1300);
      }
      if (ev === 'finish') finish();
      if (runner.running) {
        recorder.sample(runner.time, player, driving);
        ghost.update(dt, runner.time);
      }
      if (!active) {
        const got = parcels.update(dt, elapsed, focus, driving ? 4 : 1.8);
        if (got >= 0) {
          store.set('parcels', [...parcels.collected]);
          sound.pickup();
          particles.confetti(focus.x, focus.y + 1.5, focus.z);
          hud.toast(`Postcard ${parcels.count} / ${parcels.total} · ${parcels.spots[got][3]}`, 1800);
        }
      }
    }
    for (const v of vehicles()) {
      if (v === driving || v.kind !== 'plane') continue;
      if (v.state === 'water') { v.pos.y = -1.45 + Math.sin(elapsed * 1.7) * 0.05; v.sync(dt, elapsed); }
      if (v.state === 'crashed') { v.crashTimer -= dt; if (v.crashTimer <= 0) v.resetToDock(); }
    }
    if (state !== 'paused') {
      if (driving) {
        const plane = driving.kind === 'plane';
        rig.updateChase(dt, driving.pos, driving.heading, driving.speed, look, plane
          ? { height: 3.2, dist: 15, speedDist: 0.12, maxExtra: 8, pitch: 0.18, fovScale: 0.45, roll: driving.roll }
          : { height: 1.9, dist: 7.5, speedDist: 0.08, maxExtra: 4, pitch: 0.16, fovScale: 0.6 });
      } else if (player.mode === 'chute') {
        rig.updateChase(dt, player.pos, player.facing, player.speed, look,
          { height: 2.6, dist: 8.5, speedDist: 0.12, maxExtra: 3, pitch: 0.28, fovScale: 0.6, roll: player.chute ? player.chute.bank : 0 });
      } else {
        rig.update(dt, player, look);
      }
    }
    const focus = driving ? driving.pos : player.pos;
    sun.target.position.copy(focus);
    speed3 = driving ? Math.abs(driving.speed) : (player.mode === 'zip' ? player.zip.speed : player.vel.length());
    hud.update({
      runner, camera, next: runner.next, focus,
      speed: driving ? Math.abs(driving.speed) : (player.mode === 'zip' ? player.zip.speed : player.speed),
      alt: focus.y,
      throttle: driving && driving.kind === 'plane' ? driving.throttle : null,
      prompt: driving ? null : player.prompt,
    });

    // Minimap, redrawn about 15 times a second.
    mapT -= realDt;
    if (S.minimap && mapT <= 0) {
      mapT = 0.066;
      const marks = [];
      if (runner.next) marks.push({ x: runner.next.x, z: runner.next.z, color: '#ff6a2b', r: 5, ring: true });
      for (const c of V.cars) if (c !== driving) marks.push({ x: c.pos.x, z: c.pos.z, color: '#2f6f8f', shape: 'square' });
      if (V.plane && V.plane !== driving && V.plane.mesh.visible) marks.push({ x: V.plane.pos.x, z: V.plane.pos.z, color: '#ffffff', r: 4 });
      if (!active) {
        for (const it of parcels.items) {
          if (!it.g.visible) continue;
          if (it.g.position.distanceTo(focus) < 260) marks.push({ x: it.g.position.x, z: it.g.position.z, color: '#ffb347', r: 3 });
        }
      }
      const heading = driving ? driving.heading : player.facing;
      minimap.draw(focus, heading, rig.yaw, marks);
    }

    // Sound layers.
    if (state === 'play' || state === 'countdown') {
      sound.update({
        wind: Math.max(0, Math.min(1, (speed3 - 6) / 38)),
        zip: player.mode === 'zip' && !driving ? Math.min(1, player.zip.speed / 36) : 0,
        car: driving && driving.kind === 'car' ? { rpm: Math.min(1, Math.abs(driving.forwardSpeed) / 44 + (input.move.y > 0 ? 0.08 : 0)), throttle: Math.max(0, input.move.y) } : null,
        plane: driving && driving.kind === 'plane' && driving.state !== 'crashed' ? { rpm: driving.throttle, water: driving.state === 'water', speed: Math.abs(driving.speed) } : null,
        canopy: player.mode === 'chute' && !driving ? Math.min(1, player.speed / 14) : 0,
        t: elapsed,
      });
    }
    updateTips(realDt);
  }

  // Speed lines when moving fast.
  const sl = S.reduceMotion || state === 'menu' ? 0 : Math.max(0, Math.min(0.6, (speed3 - 16) / 40));
  $('#speedlines').style.opacity = sl.toFixed(2);

  // Blob shadows under the courier and vehicles on low quality.
  if (!renderer.shadowMap.enabled) {
    for (const b of blobs) {
      const o = b.owner;
      const vis = o === player ? player.avatar.root.visible && state !== 'menu' : (o.mesh ? o.mesh.visible : true);
      b.m.visible = vis;
      if (!vis) continue;
      const fl = W.world.floorAt(o.pos.x, o.pos.z, o.pos.y + 0.3, 0);
      const gy = fl.solid ? fl.y : -1.58;
      const h = o.pos.y - gy;
      b.m.visible = h < 40;
      b.m.position.set(o.pos.x, gy + 0.04, o.pos.z);
      if (o.heading != null) b.m.rotation.y = o.heading;
      b.m.material.opacity = 0.3;
    }
  }

  sun.position.copy(sun.target.position).add(sky.sunOffset);
  sky.follow(camera);
  input.endFrame();
  renderer.render(scene, camera);
}

renderMenu();
setLoad(100, 'Ready');
loading.hidden = true;
showScreen('#menu');
requestAnimationFrame(frame);

// Handy for testing from the console.
window.__fcr = { sun,
  W, player, rig, courses, runner, startCourse, startFree, input, camera, renderer, scene, V,
  details, enterVehicle, exitVehicle, sound, particles, ghost, recorder, parcels, sky, S, applySettings, traffic, finish,
};
