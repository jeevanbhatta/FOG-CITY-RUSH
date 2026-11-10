import * as THREE from 'three';
import { buildWorld, BRIDGE } from './world.js';
import { Player, LOOKS, SKIN_TONES, Avatar } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud, fmtTime } from './hud.js';
import { defineCourses, resolveCourse, CourseRunner } from './courses.js';
import { fallbackMap } from './fallback-map.js';
import { Car, Seaplane, findParking, findWater, CAR, PLANE } from './vehicles.js';
import { Sound } from './audio.js';
import { Particles } from './particles.js';
import { Ghost, GhostRecorder } from './ghost.js';
import { loadSettings, saveSettings, QUALITY } from './settings.js';
import { Sky } from './sky.js';
import { Traffic, Gulls, Ferries, Streetcars } from './life.js';
import { Minimap } from './minimap.js';
import { placeParcels, Parcels } from './parcels.js';
import { Details } from './details.js';
import { DISTRICTS, pickDistrict } from './districts.js';
import { Combo } from './combo.js';
import { CityLife, CONTACTS, FOOD_NAMES, RENT } from './citylife.js';
import { CAREERS, ARTIFACTS, SETS, rollArtifact, careerRank } from './careers.js';
import { Weather } from './weather.js';
import { Achievements, ACHIEVEMENTS } from './achievements.js';
import { Pedestrians } from './pedestrians.js';
import { BigMap } from './bigmap.js';
import { encodeRace, decodeRace, raceUrl, readRaceFromUrl } from './share.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const isTouch = matchMedia('(pointer: coarse)').matches;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const store = {
  get(k) { try { const v = localStorage.getItem('fcr.' + k); return v == null ? null : JSON.parse(v); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem('fcr.' + k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
};
const S = loadSettings(isTouch);
const D = pickDistrict(S.district);
if (S.district !== D.id) { S.district = D.id; saveSettings(S); }

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
    const res = await fetch(D.file);
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
      setLoad(5 + 50 * Math.min(1, got / total), `Downloading ${D.name}`);
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

setLoad(4, `Downloading ${D.name}`);
const map = await loadMap();
$('#attribution').textContent = map.meta.generated ? 'Generated stand-in layout' : '© OpenStreetMap contributors';
setLoad(60, 'Raising the skyline');
await nextFrame();

const W = buildWorld(map, scene, D);
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
  const f = W.landmarks.hub;
  const bi = W.landmarks.bridgeInfo;
  // Nearest point on the district's boulevard to the plaza: the race start and the first parked car.
  let best = null, bd = Infinity;
  for (const r of map.roads) {
    if (!r.n || !D.boulevard.test(r.n)) continue;
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
  // Seaplane dock: open water off the bay side of the hub.
  const [bx, bz] = D.dockDir || [-f.face[0], -f.face[1]];
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
const peds = new Pedestrians(scene, map.roads, W.world, 70);
setLoad(90, 'Planting trees and painting crosswalks');
await nextFrame();
const details = (() => {
  const avoid = [];
  const f = W.landmarks.hub;
  avoid.push([f.plaza[0], f.plaza[1], 22], [0, 0, D.hub === 'palace' ? 26 : 16]);
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
    boulevard: D.boulevard,
    radius: QUALITY[S.quality].detailRadius,
    trafficRoads: new Set(traffic.routes.map((r) => r.p)),
  });
})();

const courses = defineCourses(W, V, D).map((c) => resolveCourse(c, W.world));

// ---------- the menu's fly-through: a loop past the hub, along the bridge and back over the water ----------
const _look = new THREE.Vector3();
const tour = (() => {
  const h = W.landmarks.hub, bi = W.landmarks.bridgeInfo;
  const [fx, fz] = h.face;
  const sx = -fz, sz = fx; // sideways from the plaza face
  const pos = [], look = [];
  const add = (p, l) => { pos.push(new THREE.Vector3(...p)); look.push(new THREE.Vector3(...l)); };
  const t0 = bi.at(BRIDGE.towers[0], 0), t1 = bi.at(BRIDGE.towers[1], 0);
  const ramp = bi.at(-BRIDGE.rampLen * 0.4, 0);
  add([fx * 70 + sx * 30, 14, fz * 70 + sz * 30], [0, h.top * 0.55, 0]);
  add([sx * 110, h.top * 0.9, sz * 110], [0, h.top * 0.7, 0]);
  add([-fx * 120 + sx * 40, h.top + 30, -fz * 120 + sz * 40], [0, h.top * 0.5, 0]);
  const mid = [(ramp[0] - fx * 120) / 2, (ramp[1] - fz * 120) / 2];
  add([mid[0], 70, mid[1]], [ramp[0], 40, ramp[1]]);
  const r1 = bi.at(-60, -70);
  add([r1[0], BRIDGE.deckY + 18, r1[1]], [t0[0], BRIDGE.towerTop * 0.7, t0[1]]);
  const r2 = bi.at(BRIDGE.towers[0] + 120, -55);
  add([r2[0], BRIDGE.deckY + 6, r2[1]], [t1[0], BRIDGE.deckY + 20, t1[1]]);
  const r3 = bi.at(BRIDGE.towers[0] + 260, 90);
  add([r3[0], BRIDGE.towerTop + 25, r3[1]], [t0[0], BRIDGE.towerTop, t0[1]]);
  const r4 = bi.at(BRIDGE.towers[0] - 80, 260);
  add([r4[0], 140, r4[1]], [0, 40, 0]);
  add([-fx * 260 - sx * 120, 90, -fz * 260 - sz * 120], [0, h.top * 0.6, 0]);
  add([fx * 160 - sx * 90, 45, fz * 160 - sz * 90], [0, h.top * 0.6, 0]);
  const P = new THREE.CatmullRomCurve3(pos, true, 'centripetal');
  const L = new THREE.CatmullRomCurve3(look, true, 'centripetal');
  return { pos: P, look: L, duration: Math.max(70, P.getLength() / 34) };
})();

// ---------- ghosts, parcels, minimap ----------
const gullCentres = [[W.landmarks.hub.face[0] * -120, W.landmarks.hub.face[1] * -120]];
for (const p of map.piers.slice(0, 6)) gullCentres.push([p[0][0], p[0][1]]);
const gulls = new Gulls(scene, gullCentres);
const ghost = new Ghost(scene, V.cars[0] ? V.cars[0].mesh : new THREE.Group(), V.plane ? V.plane.mesh : new THREE.Group());
const recorder = new GhostRecorder();
const combo = new Combo();
combo.best = store.get('combo.best') || 0;
let comboShown = 0, comboMult = 0;
function updateCombo(dt) {
  const notice = driving ? combo.bank() : combo.update(dt, player, player.events);
  player.flow = combo.flow;
  if (notice) {
    if (notice.n && notice.n > comboMovesBest) { comboMovesBest = notice.n; store.set('combo.moves', comboMovesBest); }
    if (notice.n >= 5 && !active) { life.event('combo5'); life.mood(2); }
    if (notice.n >= 4) gigEvent('combo');
    hud.toast(notice.text, 1300);
    if (!notice.lost) { sound.chime(); if (combo.best > (store.get('combo.best') || 0)) store.set('combo.best', combo.best); }
  }
  $('#hud-style').textContent = Math.round(combo.total).toLocaleString();
  const el = $('#combo');
  if (combo.live && combo.mult > 1) comboShown = 0.6;
  else comboShown -= dt;
  el.hidden = comboShown <= 0;
  if (el.hidden) { comboMult = 0; return; }
  if (combo.live) {
    $('#cb-mult').textContent = `×${combo.mult}`;
    $('#cb-move').textContent = combo.flash ? combo.flash.text : '';
    $('#cb-pts').textContent = `${combo.points.toLocaleString()} × ${combo.mult}`;
    $('#cb-bar').style.transform = `scaleX(${Math.max(0, combo.timer / 2).toFixed(3)})`;
    if (combo.mult !== comboMult) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); comboMult = combo.mult; }
  }
}
const parcelKey = D.id === 'embarcadero' ? 'parcels' : `parcels.${D.id}`;
const parcels = new Parcels(scene, placeParcels(W, V), store.get(parcelKey));
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
let maxRatio = 1, dynRatio = 0;
function applySettings() {
  const q = QUALITY[S.quality] || QUALITY.high;
  maxRatio = Math.min(window.devicePixelRatio, q.pixelRatio);
  if (!S.autoRes) dynRatio = maxRatio;
  dynRatio = Math.min(dynRatio || maxRatio, maxRatio);
  renderer.setPixelRatio(dynRatio);
  $('#perf').hidden = !S.showFps;
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
  peds.setCount({ high: 60, medium: 36, low: 18 }[S.quality] || 36);
  details.setRadius(q.detailRadius);
  input.sensitivity = 0.0024 * S.sensitivity;
  input.invertY = S.invertLook;
  rig.reduceMotion = S.reduceMotion;
  sound.setVolume(S.volume);
  sky.setMode(S.timeOfDay);
  document.body.classList.toggle('no-minimap', !S.minimap);
  document.body.classList.toggle('no-hints', !S.keyHints);
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
  $('#set-autores').checked = S.autoRes;
  $('#set-fps').checked = S.showFps;
  $('#set-hints').checked = S.keyHints;
  $('#set-weather').value = S.weather || 'changes';
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
bindSetting('#set-autores', 'autoRes', (el) => el.checked);
bindSetting('#set-fps', 'showFps', (el) => el.checked);
bindSetting('#set-hints', 'keyHints', (el) => el.checked);

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
  sound.setRadio(v.kind === 'car' ? radioStation : 0);
  $('#stat-boost').hidden = v.kind !== 'car';
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
  sound.setRadio(0);
  $('#stat-boost').hidden = true;
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
    ach.unlock('bail');
    if (!active) life.event('bail');
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

// The next medal you haven't earned yet on a course (or null once you hold gold).
function nextMedal(c) {
  const best = store.get('best.' + c.id), m = c.medals;
  for (const [name, time] of [['Bronze', m.bronze], ['Silver', m.silver], ['Gold', m.gold]]) {
    if (best == null || best > time) return { name, time };
  }
  return null;
}

function startCourse(c) {
  const retry = active === c && state !== 'menu';
  endJob(null);
  fade();
  if (driving) exitVehicle(true);
  store.set('last.' + D.id, c.id);
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
  rival = challenge && challenge.course === c ? challenge : null;
  hud.setCourse(c.name, rival ? null : store.get('best.' + c.id), rival ? null : nextMedal(c));
  if (rival) hud.setRival(rival.name, rival.time);
  ghost.load(rival ? rival.samples : store.get('ghost.' + c.id));
  ghost.setRival(!!rival);
  combo.reset();
  ghost.update(0, 0);
  recorder.start();
  parcels.show(false);
  state = 'countdown';
  // A quick restart gets a short countdown: you already know the course.
  countdown = retry ? 1.5 : 3.0;
  lastBeep = 4;
  showScreen(null);
  hud.show(true);
  input.enabled = true;
  lockPointer();
  if (c.relay) tip('relay', 'Relay: any way is fair. Press F at the car and the seaplane, and bail out in flight for the final drop.');
}

function startFree(resume = false) {
  fade();
  if (driving) exitVehicle(true);
  active = null;
  runner.clear();
  ghost.hide();
  resetAllVehicles();
  const lp = store.get('lifePos');
  if (resume && lp) spawnAt(new THREE.Vector3(lp[0], lp[1], lp[2]), null);
  else spawnAt(...wakeSpot());
  hud.setCourse('City life', null);
  parcels.show(true);
  combo.reset();
  state = 'play';
  showScreen(null);
  hud.show(true);
  input.enabled = true;
  hud.toast(`Day ${life.s.day} · ${life.clock}`, 1400);
  tip('life', 'City life: keep an eye on energy, food and mood. P opens your phone: work, goals and messages. Sleep at home.');
  tip('move', isTouch ? 'Left side to run, right side to look. Push the stick all the way to sprint.' : 'WASD to run, mouse to look. Hold Shift to sprint.');
  tip('parcels', `Fog City postcards glow on rooftops, piers and the bridge. Find all ${parcels.total}.`);
  lockPointer();
}

function toMenu() {
  endJob(null);
  if (bigmap.open) bigmap.show(false);
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
  // Prize money the first time you reach each medal on a course.
  const rank = (x) => (x == null ? 0 : x <= m.gold ? 3 : x <= m.silver ? 2 : x <= m.bronze ? 1 : 0);
  const PRIZE = [0, 100, 250, 500];
  if (rank(t) > rank(prev)) addCash(PRIZE[rank(t)] - PRIZE[rank(prev)]);
  if (active.daily) ach.unlock('daily');
  if (medal) { life.event('medal'); life.mood(5); }
  life.storyEvent({ course: active.id.replace(D.courseIds, ''), medal: !!medal });
  $('#btn-results-city').hidden = !lifeReturn;
  saveLife();
  $('#res-course').textContent = active.name;
  $('#res-time').textContent = fmtTime(t);
  // Say how close the next medal was.
  const up = medal === 'Gold' ? null : medal === 'Silver' ? ['Gold', m.gold] : medal === 'Bronze' ? ['Silver', m.silver] : ['Bronze', m.bronze];
  const gap = up ? ` · ${(t - up[1]).toFixed(2)} s off ${up[0]}` : '';
  $('#res-medal').textContent = (medal ? `${medal} medal` : 'No medal') + gap;
  $('#res-medal').dataset.medal = (medal || 'none').toLowerCase();
  const rv = $('#res-rival');
  rv.hidden = !rival;
  if (rival) {
    const d = t - rival.time;
    rv.className = d <= 0 ? 'won' : 'lost';
    rv.textContent = d <= 0 ? `You beat ${rival.name} by ${fmtTime(-d)}` : `${rival.name} is ${fmtTime(d)} ahead`;
  }
  $('#share-box').hidden = true;
  combo.bank();
  $('#res-style').textContent = combo.total > 0 ? `Style ${Math.round(combo.total).toLocaleString()} · best combo ever ${Math.round(Math.max(combo.best, store.get('combo.best') || 0)).toLocaleString()}` : '';
  if (combo.best > (store.get('combo.best') || 0)) store.set('combo.best', combo.best);
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

const ICONS = {
  run: '<circle cx="15" cy="4.5" r="2"/><path d="M7 21l3.5-6 3 2.5V22M5 12.5l4-3.5 4.5 1 3 4h3M10.5 15l1.5-5.5"/>',
  car: '<path d="M3 16v-3l2.2-5h13.6L21 13v3z"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>',
  plane: '<path d="M2 12h20M12 12l-4 8M12 12l-4-8M18 12l2-3M18 12l2 3M4 15h5"/>',
  chute: '<path d="M3 10a9 7 0 0 1 18 0M3 10l9 9 9-9M12 10v9"/>',
  relay: '<path d="M3 12h13M12 6l6 6-6 6M21 5v14"/>',
};
const TABS = [['all', 'All'], ['parkour', 'Parkour'], ['drive', 'Drive'], ['fly', 'Fly'], ['mission', 'Missions']];
function category(c) {
  if (c.relay || c.daily) return 'mission';
  if (c.vehicle === 'car') return 'drive';
  if (c.vehicle === 'plane' || c.kind === 'Parachute') return 'fly';
  return 'parkour';
}
function medalOf(c) {
  const best = store.get('best.' + c.id), m = c.medals;
  return best == null ? null : best <= m.gold ? 'gold' : best <= m.silver ? 'silver' : best <= m.bronze ? 'bronze' : 'none';
}
let menuTab = store.get('tab') || 'all';

// Open "How to play" on a first visit.
if (!store.get('seenHelp')) { $('#fold-help').open = true; store.set('seenHelp', true); }

function renderMenu() {
  // Big play button: carry on with the last run, or the first one without a gold medal.
  const lastId = store.get('last.' + D.id);
  const last = courses.find((c) => c.id === lastId);
  const next = last || courses.find((c) => medalOf(c) !== 'gold') || courses[0];
  $('#continue-sub').textContent = next ? `${last ? 'Continue' : 'Start'} · ${next.name}` : '';
  $('#btn-continue').onclick = () => (next ? startCourse(next) : startFree());
  $('#btn-free').textContent = `City life · Day ${life.s.day}`;
  $('#challenge').hidden = !challenge;
  if (challenge) {
    const esc = (t) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    $('#challenge-text').innerHTML = `<b>${esc(challenge.name)}</b> challenged you to <b>${esc(challenge.course.name)}</b>. Their time: <b>${fmtTime(challenge.time)}</b>`;
  }

  // Progress strip.
  const tally = { gold: 0, silver: 0, bronze: 0 };
  for (const c of courses) { const m = medalOf(c); if (tally[m] != null) tally[m]++; }
  $('#progress').innerHTML = `
    <span><i style="background:var(--gold)"></i>${tally.gold}</span>
    <span><i style="background:var(--silver)"></i>${tally.silver}</span>
    <span><i style="background:var(--bronze)"></i>${tally.bronze}</span>
    <span>Postcards ${parcels.count} / ${parcels.total}</span>
    <span style="color:#2f7a4a">$${Math.round(cash).toLocaleString()}</span>`;
  const km = (m) => (m / 1000).toFixed(1) + ' km';
  $('#stats').innerHTML = [
    ['Ran', km(stats.run)], ['Drove', km(stats.drive)], ['Flew', km(stats.fly)],
    ['Stunt jumps', stats.stunts], ['Near misses', stats.nearMiss], ['Jobs', stats.jobs],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');

  // Tabs.
  const tabs = $('#course-tabs');
  tabs.innerHTML = '';
  for (const [id, label] of TABS) {
    if (id !== 'all' && !courses.some((c) => category(c) === id)) continue;
    const b = document.createElement('button');
    b.className = 'tab';
    b.id = 'tab-' + id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(menuTab === id));
    b.textContent = label;
    b.addEventListener('click', () => { menuTab = id; store.set('tab', id); renderMenu(); });
    tabs.appendChild(b);
  }

  const list = $('#course-list');
  list.innerHTML = '';
  courses.forEach((c, i) => {
    const cat = category(c);
    if (menuTab !== 'all' && cat !== menuTab) return;
    const best = store.get('best.' + c.id);
    const m = c.medals;
    const medal = medalOf(c) || '';
    const kind = c.vehicle === 'car' ? 'Car' : c.vehicle === 'plane' ? 'Seaplane' : c.relay ? 'Relay' : c.kind || 'On foot';
    const icon = ICONS[c.vehicle === 'car' ? 'car' : c.vehicle === 'plane' ? 'plane' : c.relay ? 'relay' : c.kind === 'Parachute' ? 'chute' : 'run'];
    const rank = { bronze: 1, silver: 2, gold: 3 }[medal] || 0;
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="course" id="course-${c.id.replace('.', '-')}" data-i="${i}">
        <span class="c-kind"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${kind} · ${(c.length / 1000).toFixed(1)} km</span>
        <span class="c-head"><span class="c-name">${c.name}</span><span class="c-diff" data-d="${c.difficulty.toLowerCase()}">${c.difficulty}</span></span>
        <span class="c-blurb">${c.blurb}</span>
        <span class="c-meta">
          <span class="medal-pips" aria-label="${medal || 'no'} medal"><i class="b ${rank >= 1 ? 'on' : ''}"></i><i class="s ${rank >= 2 ? 'on' : ''}"></i><i class="g ${rank >= 3 ? 'on' : ''}"></i></span>
          <span>Gold ${fmtTime(m.gold)}</span>
          <span class="c-best ${medal}">${best != null ? 'Best ' + fmtTime(best) : 'Not run yet'}</span>
        </span>
      </button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button.course').forEach((b) => b.addEventListener('click', () => startCourse(courses[+b.dataset.i])));
  renderCharacter();
  renderDistricts();
  renderGarage();
  renderAchievements();
}

function renderDistricts() {
  $('#district-name').textContent = D.name;
  const o = map.meta.origin;
  if (o) $('#district-coords').textContent = `${o.lat.toFixed(4)}° N · ${Math.abs(o.lon).toFixed(4)}° W`;
  const box = $('#district-cards');
  box.innerHTML = '';
  for (const d of Object.values(DISTRICTS)) {
    const b = document.createElement('button');
    b.className = 'district';
    b.id = 'district-' + d.id;
    b.setAttribute('aria-pressed', String(d === D));
    b.innerHTML = `<span class="d-state">${d === D ? 'You are here' : 'Travel'}</span><span class="d-name">${d.name}</span><span class="d-tag">${d.tagline}</span>`;
    // Each district is its own download: switch by reloading with just that map.
    b.addEventListener('click', () => {
      if (d === D) return;
      S.district = d.id;
      saveSettings(S);
      const u = new URL(location.href);
      u.searchParams.set('d', d.id);
      location.href = u.toString();
    });
    box.appendChild(b);
  }
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
  const L = LOOKS[S.look];
  $('#char-val').textContent = L ? L.label : '';
}

$('#btn-free').addEventListener('click', () => startFree(true));

// ---------- ghost-race links ----------
let challenge = null, rival = null;
{
  const code = readRaceFromUrl();
  if (code) {
    decodeRace(code).then(({ meta, samples }) => {
      const c = courses.find((k) => k.id === meta.c);
      if (!c || meta.d !== D.id || samples.length < 2) throw new Error('unknown course');
      challenge = { course: c, name: String(meta.n || 'A friend').slice(0, 16), time: +meta.t, samples };
      if (state === 'menu') renderMenu();
    }).catch((e) => { console.warn('Race link:', e); hud.toast('That race link could not be opened', 2000); });
  }
}
$('#btn-challenge').addEventListener('click', () => challenge && startCourse(challenge.course));
$('#btn-challenge-x').addEventListener('click', () => {
  challenge = null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* sandboxed */ }
  renderMenu();
});
async function shareRun() {
  const c = active;
  const samples = store.get('ghost.' + c.id), best = store.get('best.' + c.id);
  if (!samples || best == null) return;
  const box = $('#share-box');
  box.hidden = false;
  const name = ($('#share-name').value || '').trim().slice(0, 16);
  if (name !== (S.name || '')) { S.name = name; saveSettings(S); }
  const code = await encodeRace({ c: c.id, d: D.id, n: name || 'A friend', t: Math.round(best * 1000) / 1000 }, samples);
  const url = raceUrl(D.id, code);
  $('#share-link').value = url;
  const text = `I ran ${c.name} in ${fmtTime(best)} in Fog City Rush. Beat my ghost:`;
  if (navigator.share && isTouch) {
    try { await navigator.share({ title: 'Fog City Rush', text, url }); return; } catch (_) { /* cancelled: leave the box open */ }
  }
  copyLink();
}
async function copyLink() {
  const el = $('#share-link');
  try {
    await navigator.clipboard.writeText(el.value);
    $('#share-note').textContent = 'Link copied. Anyone who opens it races your best run as a ghost.';
  } catch (_) {
    el.focus(); el.select();
    $('#share-note').textContent = 'Copy this link and send it. Anyone who opens it races your best run as a ghost.';
  }
}
$('#btn-share').addEventListener('click', () => { $('#share-name').value = S.name || ''; shareRun(); });
$('#share-name').addEventListener('change', shareRun);
$('#btn-copy').addEventListener('click', copyLink);
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

// Switching tabs or windows pauses a run instead of letting the clock run on.
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', () => { if (state === 'play' || state === 'countdown') pause(); });

// Free roam: R puts you back somewhere safe if you're stuck (and rights a stuck car).
function unstick() {
  if (driving && driving.kind === 'plane') { driving.resetToDock(); rig.yaw = driving.heading + Math.PI; hud.toast('Back at the dock', 1000); return; }
  if (driving) {
    const fl = W.world.floorAt(driving.pos.x, driving.pos.z, driving.pos.y + 3, 0);
    resetVehicleAt(driving, new THREE.Vector3(driving.pos.x, fl.solid ? fl.y : driving.pos.y, driving.pos.z), null, false);
    hud.toast('Car back on its wheels', 1000);
    return;
  }
  spawnAt(player.safe.clone(), null);
  fade();
  hud.toast('Back on safe ground', 1000);
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && (state === 'play' || state === 'countdown') && !isTouch) pause();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    if (state === 'phone') togglePhone(false);
    else if (state === 'play' && !active) togglePhone(true);
    else if (state === 'paused') resume(); else pause();
  }
  if (e.code === 'Escape' && state === 'phone') { togglePhone(false); return; }
  if (state === 'photo') {
    if (e.code === 'Enter') savePhoto();
    if (e.code === 'Escape' || e.code === 'KeyO') { togglePhoto(false); input.enabled = true; }
    return;
  }
  if (e.code === 'KeyO' && state === 'play') { togglePhoto(true); input.enabled = false; return; }
  if (e.code === 'Escape') { if (bigmap.open) toggleMap(false); else pause(); }
  if (e.code === 'Tab' && (state === 'play' || state === 'map')) { e.preventDefault(); toggleMap(); }
  if (state === 'play' && driving && driving.kind === 'car' && e.code === 'KeyG') honk();
  if (state === 'play' && driving && e.code === 'KeyQ') cycleRadio();
  if (state === 'play' && driving && e.code === 'KeyV') { camMode = (camMode + 1) % CAM_MODES.length; hud.toast(`Camera: ${CAM_MODES[camMode].name}`, 800); }
  if (state === 'play' && !active && e.code === 'KeyJ') toggleJob();
  if (e.code === 'KeyR' && (state === 'play' || state === 'countdown' || state === 'results') && active) startCourse(active);
  else if (e.code === 'KeyR' && state === 'play' && !active) unstick();
  if (e.code === 'Enter' && state === 'results') startCourse(active);
  if (e.code === 'KeyI') {
    S.invertFlight = !S.invertFlight;
    saveSettings(S);
    if (state === 'play') hud.toast(S.invertFlight ? 'Flight: W dives' : 'Flight: W climbs', 1200);
  }
  if (e.code === 'F3') {
    e.preventDefault();
    S.showFps = !S.showFps;
    saveSettings(S);
    applySettings();
  }
  if (e.code === 'KeyH' && state !== 'menu' && !/INPUT|SELECT/.test(e.target.tagName)) {
    S.keyHints = !S.keyHints;
    saveSettings(S);
    applySettings();
  }
  if (e.code === 'KeyM') {
    S.minimap = !S.minimap;
    saveSettings(S);
    applySettings();
  }
});

// ---------- gamepad on menus: d-pad moves focus, A presses, Start pauses ----------
function padMenus() {
  if (input.hit('pad:back')) {
    if (active && (state === 'play' || state === 'countdown' || state === 'results')) startCourse(active);
    else if (state === 'play') unstick();
  }
  if (input.hit('pad:start')) {
    if (state === 'play' || state === 'countdown') pause();
    else if (state === 'paused') resume();
  }
  if (state === 'play' || state === 'countdown') return;
  const screen = document.querySelector('.screen:not([hidden])');
  if (!screen) return;
  const items = [...screen.querySelectorAll('button:not([hidden]), summary, input, select')].filter((b) => b.offsetParent);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  const move = (d) => {
    const n = items[(Math.max(0, i) + d + items.length) % items.length];
    n.focus();
    n.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  if (input.hit('pad:down') || input.hit('pad:right')) move(i < 0 ? 0 : 1);
  if (input.hit('pad:up') || input.hit('pad:left')) move(i < 0 ? 0 : -1);
  if (input.hit('pad:jump')) {
    if (i >= 0) items[i].click();
    else if (state === 'menu') $('#btn-continue').click();
    else if (state === 'results') $('#btn-retry').click();
  }
  if (input.hit('pad:slide') && (state === 'paused')) resume();
}

// ---------- control hints: the keys that matter right now, for keyboard, gamepad or touch ----------
let keysHtml = '';
function updateKeyHints() {
  if (!S.keyHints) return;
  const dev = input.device;
  const K = (...k) => k.map((x) => `<kbd>${x}</kbd>`).join('');
  // [keyboard, gamepad, touch] for each action.
  const pick = (kb, pad, touch) => (dev === 'pad' ? pad : dev === 'touch' ? touch : kb);
  const items = [];
  const add = (keys, label) => { if (keys != null) items.push(`<span>${keys} ${label}</span>`); };
  const hint = (text) => items.push(`<span class="hint">${text}</span>`);
  const v = driving;
  if (v && v.kind === 'plane') {
    const climb = S.invertFlight ? 'S' : 'W', dive = S.invertFlight ? 'W' : 'S';
    add(pick(K('Shift') + K('C'), K('RT') + K('LT'), null), 'Throttle');
    add(pick(K(climb) + '/' + K(dive), K('L↕'), null), 'Climb / dive');
    add(pick(K('A') + K('D'), K('L↔'), null), 'Bank');
    add(pick(K('F'), K('Y'), null), v.state === 'air' ? 'Bail out' : 'Get out');
    if (v.state === 'air') add(pick(K('Space'), K('A'), null), 'Smoke trail');
    if (v.state === 'water') hint(pick('Full throttle, then hold W above 100 km/h to take off', 'Hold RT, then push up above 100 km/h to take off', 'Hold Power +, then push the stick up above 100 km/h to take off'));
    if (dev === 'keys') add(K('I'), 'Swap W/S');
  } else if (v) {
    add(pick(K('W') + K('S'), K('L↕'), null), 'Drive');
    add(pick(K('A') + K('D'), K('L↔'), null), 'Steer');
    add(pick(K('Space'), K('A'), null), 'Drift');
    if (!(active && active.vehicle)) add(pick(K('F'), K('Y'), null), 'Get out');
    if (dev === 'touch') hint('Stick to drive and steer · Drift to slide · Exit to get out');
  } else if (player.mode === 'chute') {
    add(pick(K('A') + K('D'), K('L↔'), null), 'Turn');
    add(pick(K('W'), K('L↑'), null), 'Dive');
    add(pick(K('S'), K('L↓'), null), 'Flare to land soft');
    add(pick(K('Space'), K('A'), null), 'Cut away');
    if (dev === 'touch') hint('Stick: left/right turns, up dives, down flares · Jump cuts away');
  } else if (player.mode === 'climb') {
    add(pick(K('W') + K('S'), K('L↕'), null), 'Up / down');
    add(pick(K('Space'), K('A'), null), 'Let go');
    if (dev === 'touch') hint('Push the stick up to climb · Jump to let go');
  } else if (player.mode === 'zip') {
    add(pick(K('Space'), K('A'), 'Jump'), 'Let go and keep your speed');
  } else {
    add(pick(K('W') + K('A') + K('S') + K('D'), K('L'), null), 'Move');
    add(pick(K('Mouse'), K('R'), null), 'Look');
    add(pick(K('Shift'), K('RT'), null), 'Sprint');
    add(pick(K('Space'), K('A'), null), 'Jump');
    add(pick(K('C'), K('B'), null), 'Slide');
    add(pick(K('E'), K('X'), null), 'Zipline');
    if (dev === 'touch') hint('Left side moves (push all the way to sprint), right side looks');
    if (player.prompt && /parachute/i.test(player.prompt)) hint(pick('Space again to open your parachute', 'A again to open your parachute', 'Jump again to open your parachute'));
    else if (player.prompt && /fly|drive/.test(player.prompt)) hint(pick(player.prompt, player.prompt.replace('Press F', 'Press Y'), player.prompt.replace('Press F to', 'Tap')));
  }
  if (dev === 'keys') {
    if (v && v.kind === 'car') { add(K('Shift'), 'Nitro'); add(K('G'), 'Horn'); add(K('Q'), 'Radio'); }
    if (v) add(K('V'), 'Camera');
    if (!active) { add(K('Tab'), 'Map'); add(K('P'), 'Phone'); if (!v) add(K('J'), job ? 'Cancel gig' : 'Take a gig'); }
  } else if (dev === 'pad' && v && v.kind === 'car') add(K('RT'), 'Nitro');
  if (dev === 'keys' || dev === 'pad') add(pick(K('R'), K('View'), null), active ? 'Restart' : 'Unstick');
  if (dev === 'keys' && !active) for (const m of modules) if (m.hints) for (const [k, l] of m.hints()) add(K(k), l);
  if (dev === 'keys') add(K('Esc'), 'Pause');
  if (dev === 'keys') add(K('H'), 'Hide hints');
  const html = items.join('');
  if (html !== keysHtml) { keysHtml = html; $('#keys').innerHTML = html; }
}

// ---------- vehicles each frame ----------
let stallToast = 0;
let smokeT = 0;
function stepVehicle(dt, frozen) {
  const v = driving;
  const mv = frozen ? { x: 0, y: 0 } : input.move;
  if (v.kind === 'car') {
    const wasBoosting = v.boosting;
    v.update(dt, { throttle: mv.y, steer: mv.x, handbrake: !frozen && input.handbrake, boost: !frozen && input.sprint }, W.world);
    if (v.boosting && !wasBoosting) { sound.boost(); tip('nitro', 'Nitro! It refills slowly when you let go.'); }
    if (v.boosting) { const bx = -Math.sin(v.heading) * 2.3, bz = -Math.cos(v.heading) * 2.3; particles.sparks(v.pos.x + bx, v.pos.y + 0.5, v.pos.z + bz, 0.3); }
    if (v.impact > 4) carDamage(v, v.impact);
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
    if (!frozen && input.jump && v.state === 'air') {
      const bx = -Math.sin(v.heading) * 5, bz = -Math.cos(v.heading) * 5;
      particles.emit(v.pos.x + bx, v.pos.y, v.pos.z + bz, { color: 0xffffff, count: 2, speed: 0.3, up: 0.1, life: 4, size: 2.2, grow: 3, drag: 0.5, alpha: 0.5, jitter: 0.6 });
    }
    if (v.state === 'water' && Math.abs(v.speed) > 3) {
      const sx = -Math.cos(v.heading) * 1.5, sz = Math.sin(v.heading) * 1.5;
      for (const s of [-1, 1]) particles.spray(v.pos.x + sx * s, -1.4, v.pos.z + sz * s, -Math.sin(v.heading) * 2, -Math.cos(v.heading) * 2);
    }
    for (const e of v.events) {
      if (e.startsWith('crash:')) {
        if (job && job.career === 'pilot') endJob('The tour ended badly. Gig failed');
        if (job && job.career === 'patrol') endJob('Crashed on the way. The coastguard took over');
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
        if (!active) life.event('splashdown');
        moduleEvent('Splashdown');
        particles.splash(v.pos.x, -1.6, v.pos.z, 1);
        sound.splash(0.6);
        hud.toast(e, 900);
      } else {
        if (e === 'Takeoff') { sound.whoosh(); ach.unlock('takeoff'); if (!active) life.event('takeoff'); moduleEvent('Takeoff'); }
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
    gigEvent(e);
    moduleEvent(e);
    if (e === 'Slide') sound.whoosh();
    if (e === 'Roll') particles.dust(p.pos.x, p.pos.y, p.pos.z, 1);
    if (e === 'Parachute') { sound.whoosh(); rig.shake(0.3); tip('chute', isTouch ? 'Stick left/right to turn, up to dive, down to flare. Jump again to cut away.' : 'A/D to turn, W to dive, S to flare. Jump again to cut away.'); }
    if (e === 'Chute collapsed') rig.shake(0.5);
    if (e === 'Zipline') { ach.unlock('zip'); if (!active) life.event('zip'); }
    if (e === 'Landed') { ach.unlock('chute'); if (!active) life.event('chute'); }
    if (e === 'Zipline') { sound.click(); tip('zip', 'Jump to let go early and keep your speed.'); }
    if (e === 'Climb') tip('ladder', 'Ladders run all the way to the roof. Jump to let go.');
    if (e === 'Splash') { particles.splash(p.pos.x, -1.6, p.pos.z, 1); sound.splash(1); }
    if (e !== 'Climb' && e !== 'Mantle' && e !== 'Splash' && !(combo.live && combo.mult > 1)) hud.toast(e, 700);
  }
  p.events.length = 0;
  // Contextual tips.
  if (!p.onGround && p.wallTimer > 0 && p.mode === 'normal') tip('walljump', 'Jump while touching a wall to wall-jump. Sprint along a wall to wall-run.');
  if (p.onGround && p.speed > 11) tip('slide', 'Press C while sprinting to slide. Tap it just before a big landing to roll.');
}

// ================= open world: cash, borrowed cars, traffic, stunts, jobs, map =================
let cash = store.get('cash') || 0;
const stats = Object.assign({ run: 0, drive: 0, fly: 0, stunts: 0, nearMiss: 0, jobs: 0 }, store.get('stats') || {});
let statsSave = 0;
function addCash(n) {
  if (!n) return;
  cash += n;
  if (typeof life !== 'undefined') { if (n > 0) life.earn(n); else life.spend(-n); }
  store.set('cash', Math.round(cash));
  const el = $('#cash');
  el.textContent = `$${Math.round(cash).toLocaleString()}`;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  sound.cash();
}
$('#cash').textContent = `$${Math.round(cash).toLocaleString()}`;

function fade() {
  if (S.reduceMotion) return;
  const f = $('#fade');
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

// --- camera distance (V) ---
const CAM_MODES = [{ name: 'Normal', d: 1, h: 1, p: 1 }, { name: 'Far', d: 1.6, h: 1.4, p: 1.3 }, { name: 'Close', d: 0.62, h: 0.8, p: 0.8 }];
let camMode = 0;

// --- radio (Q) ---
const STATIONS = ['Radio off', 'Fog FM 88.5 · lo-fi', 'Bay Beat 101.3 · dance'];
let radioStation = store.get('radio') ?? 1;
let radioToastT = 0;
function cycleRadio() {
  radioStation = (radioStation + 1) % STATIONS.length;
  store.set('radio', radioStation);
  sound.setRadio(driving && driving.kind === 'car' ? radioStation : 0);
  const el = $('#radio');
  el.textContent = STATIONS[radioStation];
  el.hidden = false;
  radioToastT = 1.6;
}

// --- horn (G): people nearby hop out of the way ---
function honk() {
  sound.horn();
  for (const p of peds.people) if (Math.hypot(p.x - driving.pos.x, p.z - driving.pos.z) < 18) p.hop = 0.5;
}

// --- borrowing a car from traffic ---
const borrowed = [];
function borrowCar(tc) {
  const t = traffic.take(tc);
  const fl = W.world.floorAt(t.x, t.z, 3, 0);
  const car = new Car(scene, t.x, fl.solid ? fl.y : 0, t.z, t.heading, t.color);
  car.borrowed = true;
  V.cars.push(car);
  borrowed.push(car);
  // Keep at most three borrowed cars lying around.
  while (borrowed.length > 3) {
    const old = borrowed.shift();
    if (old === driving) { borrowed.push(old); break; }
    scene.remove(old.mesh);
    V.cars.splice(V.cars.indexOf(old), 1);
  }
  enterVehicle(car);
  hud.toast('Borrowed a car', 900);
  ach.unlock('borrow');
  life.event('borrow');
}

// --- damage and wrecks ---
let wreckT = 0;
function carDamage(v, impact) {
  const before = v.health;
  if (job && job.career === 'driver' && job.i > 0 && impact > 7) { job.stars = Math.max(1, job.stars - 1); hud.toast('Your passenger did not enjoy that', 900); }
  v.damage(impact * 1.3);
  if (active) v.health = Math.max(8, v.health); // runs never end in a wreck
  if (v.health <= 0 && before > 0) {
    particles.debris(v.pos.x, v.pos.y + 1.2, v.pos.z);
    sound.crash();
    rig.shake(1.2);
    hud.toast('Wrecked', 1600);
    ach.unlock('wreck');
    wreckT = 1.4;
  }
}

// --- traffic contact and near misses ---
function trafficContact(dt) {
  const v = driving;
  for (let i = 0; i < traffic.count; i++) {
    const c = traffic.cars[i];
    if (c.taken > 0) continue;
    if (c.nm > 0) c.nm -= dt;
    if (v && v.kind === 'car') {
      const dx = v.pos.x - c.x, dz = v.pos.z - c.z, d = Math.hypot(dx, dz);
      if (d < 2.7 && v.pos.y < 2) {
        // Bump: push apart, lose speed along the hit, dent your car.
        const nx = dx / (d || 1), nz = dz / (d || 1);
        v.pos.x = c.x + nx * 2.7; v.pos.z = c.z + nz * 2.7;
        const vn = v.vel.x * nx + v.vel.z * nz;
        if (vn < 0) {
          v.vel.x -= nx * vn * 1.4; v.vel.z -= nz * vn * 1.4;
          const hit = -vn;
          if (hit > 2) {
            particles.sparks(c.x + nx * 1.3, 0.8, c.z + nz * 1.3, Math.min(2, hit / 8));
            sound.scrape(hit * 2);
            rig.shake(Math.min(0.8, hit / 20));
            carDamage(v, hit);
            c.bumped = 2.5;
            c.nm = 3;
          }
        }
      } else if (d < 4.6 && v.speed > 17 && !(c.nm > 0)) {
        c.nm = 3;
        stats.nearMiss++;
        addCash(25);
        hud.toast('Near miss +$25', 700);
      }
    } else if (!v) {
      const dx = player.pos.x - c.x, dz = player.pos.z - c.z, d = Math.hypot(dx, dz);
      if (d < 1.9 && player.pos.y < 1.5) {
        const nx = dx / (d || 1), nz = dz / (d || 1);
        player.pos.x = c.x + nx * 1.9; player.pos.z = c.z + nz * 1.9;
        if (c.speed > 4 && !(c.nm > 0)) {
          player.vel.x += nx * c.speed * 0.8; player.vel.z += nz * c.speed * 0.8; player.vel.y = 5;
          player.onGround = false; player.stumble = 0.6;
          c.bumped = 2; c.nm = 2;
          sound.land(18);
          hud.toast('Watch the traffic!', 1000);
        }
      }
    }
  }
}

// --- stunt jumps, drifts, smoke, wrecks ---
const air = { t: 0, from: null, slow: false };
const drift = { t: 0, pts: 0, gap: 0 };
function carTricks(dt) {
  const v = driving;
  if (!v || v.kind !== 'car') { air.t = 0; drift.t = 0; return; }
  if (!v.onGround) {
    if (air.t === 0) air.from = v.pos.clone();
    air.t += dt;
    const fl = W.world.floorAt(v.pos.x, v.pos.z, v.pos.y, 0);
    if (!air.slow && air.t > 0.3 && v.speed > 15 && v.pos.y - (fl.solid ? fl.y : -1.6) > 3 && !S.reduceMotion) { slowmo = 0.5; air.slow = true; }
  } else if (air.t > 0) {
    if (air.t > 0.8 && air.from) {
      const dist = Math.hypot(v.pos.x - air.from.x, v.pos.z - air.from.z);
      const pay = Math.round(50 + dist * 4 + air.t * 40);
      stats.stunts++;
      addCash(pay);
      if (!active) { life.event('stunt'); life.mood(3); }
      gigEvent('stunt');
      moduleEvent('stunt');
      hud.toast(`Stunt jump · ${air.t.toFixed(1)} s · ${Math.round(dist)} m  +$${pay}`, 1800);
    }
    air.t = 0; air.slow = false;
  }
  if (v.drifting && v.speed > 10) { drift.t += dt; drift.pts += v.speed * dt; drift.gap = 0; }
  else if (drift.t > 0) {
    drift.gap += dt;
    if (drift.gap > 0.4) {
      if (drift.t > 1.2) {
        const pay = Math.round(drift.pts / 3);
        addCash(pay);
        hud.toast(`Drift ${drift.t.toFixed(1)} s  +$${pay}`, 1200);
      }
      drift.t = 0; drift.pts = 0;
    }
  }
  if (v.health < 40 && Math.random() < dt * (v.health < 15 ? 30 : 12)) {
    const fx = Math.sin(v.heading) * 1.6, fz = Math.cos(v.heading) * 1.6;
    particles.smoke(v.pos.x + fx, v.pos.y + 1, v.pos.z + fz);
  }
  $('#hud-boost').style.width = `${Math.round(v.boost * 100)}%`;
  if (wreckT > 0) {
    wreckT -= dt;
    if (wreckT <= 0) {
      fade();
      exitVehicle();
      v.repair();
      v.place(v.home.pos, v.home.heading);
      hud.toast('Car repaired and back where you found it', 1600);
    }
  }
}

// --- City Life: the day-to-day layer (see citylife.js) ---
const life = new CityLife(store.get('life'));
life.s.work = life.s.work || {};
life.s.view = life.s.view || 0;
let career = store.get('career') || 'courier';
const finds = store.get('finds') || [];
const saveLife = () => store.set('life', life.save());

// --- gigs: one active job from any career (J, or the phone's Work tab) ---
let job = null;
const jobBeacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 300, 24, 1, true).translate(0, 150, 0),
  new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.3, depthWrite: false, fog: false, side: THREE.DoubleSide }));
jobBeacon.visible = false;
scene.add(jobBeacon);
const STREETS = map.roads.filter((r) => r.n && r.k !== 'footway' && r.k !== 'service');
function pickSpot(from, minD, maxD) {
  for (let i = 0; i < 300 && STREETS.length; i++) {
    const r = STREETS[Math.floor(Math.random() * STREETS.length)];
    const q = r.p[Math.floor(Math.random() * r.p.length)];
    const d = Math.hypot(q[0] - from.x, q[1] - from.z);
    if (d < minD || d > maxD) continue;
    const fl = W.world.floorAt(q[0], q[1], 3, 0);
    if (!fl.solid || W.world.pointBlocked(q[0], fl.y + 1, q[1])) continue;
    return { x: q[0], y: fl.y, z: q[1], name: r.n };
  }
  return null;
}
function groundAround(cx, cz, r) {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const fl = W.world.floorAt(x, z, 3, 0);
    if (fl.solid && !W.world.pointBlocked(x, fl.y + 1, z)) return { x, y: fl.y, z };
  }
  return null;
}
const workRank = (id) => careerRank(life.s.work[id] || 0);

function makeGig(id, from) {
  const H = W.landmarks.hub, bi = W.landmarks.bridgeInfo;
  const t0 = bi.at(BRIDGE.towers[0], 0), t1 = bi.at(BRIDGE.towers[1], 0);
  if (id === 'courier') {
    const a = pickSpot(from, 120, 320); if (!a) return null;
    const b = pickSpot(a, 380, 900); if (!b) return null;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    return { title: 'Courier run', base: 150 + dist / 3, timeBonus: 5, stages: [
      { type: 'goto', ...a, reach: 4, label: `Pick up the parcel · ${a.name}` },
      { type: 'goto', ...b, reach: 4, timed: Math.round(dist / 7 + 25), label: `Deliver to ${b.name}`, done: 'deliver' },
    ] };
  }
  if (id === 'archaeologist') {
    const c = pickSpot(from, 200, 700); if (!c) return null;
    const h = groundAround(c.x, c.z, 32); if (!h) return null;
    return { title: 'Dig', base: 0, stages: [
      { type: 'goto', ...c, reach: 30, label: `Head to the dig site near ${c.name}` },
      { type: 'search', x: c.x, y: c.y, z: c.z, r: 36, hx: h.x, hy: h.y, hz: h.z, label: 'Sweep with the detector, dig where it screams' },
    ] };
  }
  if (id === 'photographer') {
    const briefs = [
      { text: `The ${D.hubName} from above. Get higher than its top.`, subject: () => new THREE.Vector3(0, H.top * 0.6, 0),
        ok: (c) => c.y > H.top + 12 && Math.hypot(c.x, c.z) < 350, x: 0, y: H.top, z: 0 },
      { text: `The ${D.bridgeName} from the water. Be out on the bay.`, subject: () => new THREE.Vector3(t0[0], bi.towerTop * 0.5, t0[1]),
        ok: (c) => !W.world.floorAt(c.x, c.z, c.y, 0).solid && Math.hypot(c.x - t0[0], c.z - t0[1]) < 700, x: t0[0], y: 0, z: t0[1] },
      { text: `Along the ${D.bridgeName} deck, the far tower in shot.`, subject: () => new THREE.Vector3(t1[0], bi.towerTop * 0.6, t1[1]),
        ok: (c) => (player.pos.y > bi.deckY - 3 || (driving && driving.pos.y > bi.deckY - 3)) && Math.hypot(c.x - t0[0], c.z - t0[1]) < 900, x: t0[0], y: bi.deckY, z: t0[1] },
      { text: 'A ferry, up close.', subject: () => { const f = nearestFerry(); return new THREE.Vector3(f.x, 4, f.z); },
        ok: (c) => { const f = nearestFerry(); return Math.hypot(c.x - f.x, c.z - f.z) < 90; }, dyn: true },
      { text: `The ${D.hubName} at night.`, subject: () => new THREE.Vector3(0, H.top * 0.6, 0),
        ok: (c) => life.night > 0.5 && Math.hypot(c.x, c.z) < 600, x: 0, y: 0, z: 0, night: true },
    ];
    const pool = briefs.filter((b) => !b.night || life.night > 0.3 || life.s.minute % 1440 > 17 * 60);
    const b = pool[Math.floor(Math.random() * pool.length)];
    return { title: 'Photo assignment', base: 260, stages: [{ type: 'photo', brief: b, label: b.text, ...(b.dyn ? nearestFerry() : { x: b.x, y: b.y, z: b.z }) }] };
  }
  if (id === 'driver') {
    const a = pickSpot(from, 60, 260); if (!a) return null;
    const b = pickSpot(a, 450, 1300); if (!b) return null;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    return { title: 'Ride', base: 120 + dist / 2.5, stars: 5, stages: [
      { type: 'goto', ...a, reach: 7, need: 'car', label: `Pick up your passenger · ${a.name}` },
      { type: 'goto', ...b, reach: 7, need: 'car', timed: Math.round(dist / 12 + 35), label: `Drop them at ${b.name}` },
    ] };
  }
  if (id === 'pilot') {
    if (!V.plane) return null;
    const dock = V.dock;
    const mid = bi.at((BRIDGE.towers[0] + BRIDGE.towers[1]) / 2, 0);
    return { title: 'Sightseeing flight', base: 650, stages: [
      { type: 'goto', x: dock.pos.x, y: dock.pos.y, z: dock.pos.z, reach: 30, need: 'plane', label: 'Board the seaplane at the dock' },
      { type: 'goto', x: 0, y: H.top + 60, z: 0, reach: 45, air: true, need: 'plane', label: `Circle over the ${D.hubName}` },
      { type: 'goto', x: t0[0], y: bi.towerTop + 45, z: t0[1], reach: 45, air: true, need: 'plane', label: `Over the ${D.bridgeName} tower` },
      { type: 'goto', x: mid[0], y: bi.deckY + 40, z: mid[1], reach: 50, air: true, need: 'plane', label: 'Along the middle of the span' },
      { type: 'goto', x: dock.pos.x, y: dock.pos.y, z: dock.pos.z, reach: 80, need: 'plane', water: true, label: 'Land them back at the dock' },
    ] };
  }
  if (id === 'patrol') {
    if (!V.plane || !V.dock) return null;
    const dock = V.dock;
    const [dx, dz] = D.dockDir || [-H.face[0], -H.face[1]];
    let spot = null;
    for (let i = 0; i < 40 && !spot; i++) {
      const a = Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.6, d = 350 + Math.random() * 600;
      const x = dock.pos.x + Math.cos(a) * d, z = dock.pos.z + Math.sin(a) * d;
      let ok = true;
      for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) if (W.world.floorAt(x + ox, z + oz, 5, 0).solid || W.world.pointBlocked(x + ox, 2, z + oz)) ok = false;
      if (ok) spot = { x, z };
    }
    if (!spot) return null;
    return { title: 'Rescue', base: 500, swimmer: spot, stages: [
      { type: 'goto', x: dock.pos.x, y: dock.pos.y, z: dock.pos.z, reach: 30, need: 'plane', label: 'Get to the seaplane' },
      { type: 'goto', x: spot.x, y: -1.4, z: spot.z, reach: 28, need: 'plane', water: true, slow: true, timed: 150, label: 'Land on the water beside the swimmer' },
      { type: 'goto', x: dock.pos.x, y: dock.pos.y, z: dock.pos.z, reach: 70, need: 'plane', water: true, label: 'Bring them back to the dock' },
    ] };
  }
  if (id === 'stunt') {
    const calls = [
      { ev: 'Wall run', count: 2, label: 'Two wall-runs for the camera' },
      { ev: 'Wall jump', count: 3, label: 'Three wall-jumps' },
      { ev: 'Long jump', count: 2, label: 'Two slide long-jumps' },
      { ev: 'Roll', count: 1, label: 'A big drop, rolled out clean' },
      { ev: 'combo', count: 4, label: 'A four-move combo' },
      { ev: 'Zip jump', count: 1, label: 'Let go of a zipline mid-ride' },
      { ev: 'stunt', count: 1, label: 'A car stunt jump' },
      { ev: 'Parachute', count: 1, label: 'Open a parachute in the air' },
    ];
    const pick = calls.sort(() => Math.random() - 0.5).slice(0, 3);
    return { title: 'Film shoot', base: 450, stages: pick.map((c) => ({ type: 'event', ev: c.ev, count: c.count, have: 0, timed: 150, label: c.label, x: from.x, y: from.y, z: from.z })) };
  }
  if (id === 'inspector') {
    const pts = [
      { x: t0[0], y: bi.towerTop, z: t0[1], label: `The top of the ${D.bridgeName} tower` },
      { ...(() => { const c = bi.at(BRIDGE.towers[0] * 0.55, -(BRIDGE.halfWidth + 0.5)); return { x: c[0], z: c[1], y: bi.cableY(BRIDGE.towers[0] * 0.55) + 0.7 }; })(), label: 'A cable band halfway up the main cable' },
      { x: H.face[0] * H.balcony.r, y: H.balcony.y, z: H.face[1] * H.balcony.r, label: `The top of the ${D.hubName}` },
    ];
    const roofs = W.world.ladders.filter((L) => L.y1 > 25 && L.y1 < 120);
    if (roofs.length) {
      const L = roofs[Math.floor(Math.random() * roofs.length)];
      pts.push({ x: L.x - L.nx * 2.5, y: L.y1, z: L.z - L.nz * 2.5, label: 'A rooftop service hatch' });
    }
    const pick = pts.sort(() => Math.random() - 0.5).slice(0, 2);
    return { title: 'Inspection round', base: 220 + pick.reduce((a, p) => a + p.y * 1.6, 0), stages: pick.map((p) => ({ type: 'inspect', ...p, label: `Inspect: ${p.label}` })) };
  }
  return null;
}
function nearestFerry() {
  const f = driving ? driving.pos : player.pos;
  let best = ferries.boats[0];
  for (const b of ferries.boats) if (Math.hypot(b.x - f.x, b.z - f.z) < Math.hypot(best.x - f.x, best.z - f.z)) best = b;
  return best ? { x: best.x, y: 2, z: best.z } : { x: 0, y: 0, z: 0 };
}

function startGig(id = career) {
  if (active) return;
  if (job) endJob(null);
  const from = driving ? driving.pos : player.pos;
  const g = makeGig(id, from);
  if (!g) { hud.toast('No work like that around here right now', 1400); return; }
  career = id;
  store.set('career', id);
  job = { career: id, ...g, i: 0, time: null, hold: 0, beep: 0, nearMisses: 0 };
  enterStage();
  $('#job').hidden = false;
  sound.chime();
  const C = CAREERS.find((c) => c.id === id);
  hud.toast(`${C.name}: ${g.title}`, 1400);
  if (id === 'archaeologist') tip('dig', 'Archaeology: the detector beeps faster as you close in. Stand where it screams and hold E to dig.');
  if (id === 'photographer') tip('photo-gig', 'Photojournalism: get into position, press O for photo mode, frame the subject, Enter to shoot.');
  if (id === 'driver') tip('ride', 'Ride-share: you need a car (borrow one with F). Every crash costs a star.');
  if (id === 'inspector') tip('inspect', 'Inspector: climb to each point and hold E to inspect it.');
  if (id === 'pilot') tip('tour', 'Tour pilot: fly through each marker, then land gently by the dock. A crash ends the tour.');
}
function enterStage() {
  const st = job.stages[job.i];
  job.target = st;
  job.stage = st.label;
  job.time = st.timed != null ? st.timed : job.time;
  job.hold = 0;
  jobBeacon.position.set(st.x, st.type === 'goto' && st.air ? st.y - 40 : (st.y || 0), st.z);
  jobBeacon.scale.set(st.type === 'search' ? st.r / 2.2 : st.air ? 6 : 1, 1, st.type === 'search' ? st.r / 2.2 : st.air ? 6 : 1);
  const C = CAREERS.find((c) => c.id === job.career);
  jobBeacon.material.color.set(C ? C.color : '#ffd34d');
  jobBeacon.visible = true;
}
function toggleJob() {
  if (job) { endJob('Gig cancelled'); return; }
  startGig(career);
}
function endJob(msg) {
  if (!job) return;
  job = null;
  jobBeacon.visible = false;
  $('#job').hidden = true;
  if (msg) hud.toast(msg, 1800);
}
function finishGig(extra = 0, note = '') {
  const id = job.career;
  const before = workRank(id).name;
  let pay = job.base + extra;
  if (job.timeBonus && job.time > 0) pay += job.time * job.timeBonus;
  if (id === 'driver') pay = pay * (job.stars / 5) + (job.stars >= 5 ? 60 : 0);
  pay = Math.round(pay * workRank(id).pay * (life.s.mood > 70 ? 1.15 : life.s.mood < 30 ? 0.85 : 1));
  life.s.work[id] = (life.s.work[id] || 0) + 1;
  stats.jobs++;
  addCash(pay);
  life.event(id === 'courier' ? 'deliver' : 'gig');
  moduleEvent(id === 'courier' ? 'deliver' : 'gig', { career: id, pay });
  life.mood(4);
  const focus = driving ? driving.pos : player.pos;
  particles.confetti(focus.x, focus.y + 1.5, focus.z);
  sound.finish();
  const after = workRank(id).name;
  endJob(`${note}${note ? ' · ' : ''}Paid $${pay}${after !== before ? ` · Promoted to ${after}!` : ''}  ·  J for another`);
  saveLife();
}
// Feed in-world moments to a stunt-performer gig.
function gigEvent(ev, n = 1) {
  if (!job) return;
  const st = job.stages[job.i];
  if (st.type !== 'event' || st.ev !== ev) return;
  st.have += n;
  sound.click();
  if (st.have >= st.count) { st.have = 0; advanceStage(); }
}
function holdE() { return input.down('KeyE', 'touch:grab', 'pad:grab'); }
function jobTick(dt, focus) {
  if (!job) return;
  const st = job.stages[job.i];
  let info = '';
  const inCar = driving && driving.kind === 'car', inPlane = driving && driving.kind === 'plane';
  const need = st.need === 'car' ? !inCar : st.need === 'plane' ? !inPlane : false;
  if (job.time != null) {
    job.time -= dt;
    if (job.time <= 0) { endJob('Out of time. Gig failed'); return; }
  }
  if (st.dyn || st.brief?.dyn) { const f = nearestFerry(); st.x = f.x; st.z = f.z; jobBeacon.position.set(f.x, 0, f.z); }
  const dx = focus.x - st.x, dz = focus.z - st.z, d = Math.hypot(dx, dz);
  if (need && !(st.need === 'plane' && job.i === 0 && d < st.reach)) {
    info = st.need === 'car' ? 'You need a car: borrow one from traffic (F)' : 'Get in the seaplane';
  } else if (st.type === 'goto') {
    const dy = Math.abs(focus.y - st.y);
    const vertical = st.air ? st.reach : Math.max(4, st.reach * 0.6);
    const watered = (!st.water || (inPlane && driving.state === 'water')) && (!st.slow || (inPlane && Math.abs(driving.speed) < 9));
    if (d < st.reach && dy < vertical && watered && (!st.need || !need)) return advanceStage();
    info = `${Math.round(d)} m`;
  } else if (st.type === 'search') {
    const hd = Math.hypot(focus.x - st.hx, focus.z - st.hz);
    if (d > st.r * 1.3 && hd > st.r) { info = `${Math.round(d)} m to the site`; }
    else {
      const k = Math.max(0, 1 - hd / (st.r * 1.2));
      job.beep -= dt;
      if (job.beep <= 0) { job.beep = Math.max(0.09, 1.1 - k * 1.05); sound.tone(500 + k * 1100, 0.05, 'square', 0.05); }
      info = `Detector ${'▮'.repeat(1 + Math.round(k * 7))}${'▯'.repeat(7 - Math.round(k * 7))}`;
      if (hd < 2.6 && !driving) {
        lifePrompt = 'Hold E to dig';
        if (holdE()) {
          job.hold += dt;
          if (Math.random() < dt * 20) particles.dust(st.hx, st.hy, st.hz, 0.6);
          info = `Digging ${'●'.repeat(Math.ceil(job.hold / 0.5))}`;
          if (job.hold >= 2) {
            const a = rollArtifact();
            finds.unshift({ id: a.id, day: life.s.day, district: D.id });
            store.set('finds', finds.slice(0, 200));
            life.event('dig');
            return finishGig(a.value, `Found: ${a.name} (${a.era})`);
          }
        } else job.hold = 0;
      }
    }
  } else if (st.type === 'inspect') {
    const dy = focus.y - st.y;
    if (d < 3.2 && dy > -1.5 && dy < 3 && !driving) {
      lifePrompt = 'Hold E to inspect';
      if (holdE()) {
        job.hold += dt;
        info = `Inspecting ${'●'.repeat(Math.ceil(job.hold / 0.4))}`;
        if (job.hold >= 2) { sound.chime(); return advanceStage(); }
      } else job.hold = 0;
    } else info = `${Math.round(Math.hypot(d, dy))} m · ${Math.round(st.y)} m up`;
  } else if (st.type === 'photo') {
    info = 'O for photo mode, Enter to shoot';
  } else if (st.type === 'event') {
    info = `${st.have} / ${st.count} · cameras rolling`;
    jobBeacon.position.set(focus.x, focus.y, focus.z);
  }
  $('#job-text').textContent = `${job.i + 1}/${job.stages.length} · ${st.label}`;
  $('#job-time').textContent = info + (job.time != null ? ` · ${Math.ceil(job.time)} s` : '') + (job.career === 'driver' && job.i > 0 ? ` · ${'★'.repeat(Math.max(1, Math.round(job.stars)))}` : '');
  $('#job').classList.toggle('urgent', job.time != null && job.time < 15);
}
function advanceStage() {
  job.i++;
  if (job.i >= job.stages.length) return finishGig();
  sound.pickup();
  enterStage();
  hud.toast(job.stage, 1300);
}
// Photo gigs are judged when you save a photo.
function judgePhoto() {
  if (!job || job.stages[job.i].type !== 'photo') return;
  const st = job.stages[job.i];
  const subj = st.brief.subject();
  const v = subj.clone().project(camera);
  const framed = v.z < 1 && Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8;
  const clear = framed && W.world.segmentClear ? true : framed;
  if (clear && st.brief.ok(camera.position)) {
    const centred = 1 - Math.min(1, Math.hypot(v.x, v.y));
    togglePhoto(false); input.enabled = true;
    finishGig(Math.round(centred * 150), centred > 0.7 ? 'Front page shot' : 'Good shot');
  } else hud.toast(framed ? `Not quite: ${st.brief.text}` : 'The subject isn’t in the frame', 1800);
}

const swimmer = (() => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.2, 8, 20), new THREE.MeshStandardMaterial({ color: 0xff6a2b, emissive: 0xff6a2b, emissiveIntensity: 0.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc58c66 }));
  head.position.y = 0.45;
  g.add(ring, head);
  g.visible = false;
  scene.add(g);
  return g;
})();

// --- home and food trucks ---
// Homes you can live in. A studio to start with; a waterfront loft and a penthouse to buy.
// `home` always describes where you live now (fields are swapped in place when you move).
function makeDoor(s, e, color) {
  const j = (e + 1) % s.n;
  const mx = (s.xs[e] + s.xs[j]) / 2, mz = (s.zs[e] + s.zs[j]) / 2;
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.7, 0.2), new THREE.MeshStandardMaterial({ color: 0x1f3440 }));
  frame.position.y = 1.35;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, emissive: 0xffb860, emissiveIntensity: 0.6 }));
  panel.position.set(0, 1.25, 0.11);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.08), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
  sign.position.set(0, 2.95, 0.12);
  g.add(frame, panel, sign);
  const fl = W.world.floorAt(mx + s.nxs[e] * 1.4, mz + s.nzs[e] * 1.4, 2, 0);
  g.position.set(mx + s.nxs[e] * 0.02, fl.y, mz + s.nzs[e] * 0.02);
  g.rotation.y = Math.atan2(s.nxs[e], s.nzs[e]);
  scene.add(g);
  return { g, sign };
}
function doorOn(items, test = () => true) {
  for (const it of items) {
    const s = it.s;
    for (let e = 0; e < s.n; e++) {
      const j = (e + 1) % s.n;
      if (Math.hypot(s.xs[j] - s.xs[e], s.zs[j] - s.zs[e]) < 5) continue;
      const mx = (s.xs[e] + s.xs[j]) / 2, mz = (s.zs[e] + s.zs[j]) / 2;
      const ox = mx + s.nxs[e] * 1.4, oz = mz + s.nzs[e] * 1.4;
      const fl = W.world.floorAt(ox, oz, 2, 0);
      if (!fl.solid || fl.y > 0.6 || W.world.pointBlocked(ox, 1, oz) || W.world.pointBlocked(ox + s.nxs[e] * 2, 1, oz + s.nzs[e] * 2)) continue;
      if (!test(ox, oz, s.nxs[e], s.nzs[e])) continue;
      return { it, e, x: ox, y: fl.y, z: oz, nx: s.nxs[e], nz: s.nzs[e] };
    }
  }
  return null;
}
const HOMES = (() => {
  const out = [];
  const ground = W.buildings.filter((b) => !(b.b.b > 0));
  const near = (a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz);
  // Studio: a modest block near the landmark.
  const studio = doorOn(ground.filter((b) => b.b.h > 10 && b.b.h < 45 && Math.hypot(b.cx, b.cz) > 120 && Math.hypot(b.cx, b.cz) < 500).sort(near));
  if (studio) out.push({ id: 'studio', name: 'Studio apartment', price: 0, mood: 0, ...studio });
  // Loft: a door that looks out over the water.
  const loft = doorOn(ground.filter((b) => b.b.h > 8 && Math.hypot(b.cx, b.cz) < 900).sort(near), (x, z, nx, nz) => {
    for (const d of [20, 30, 40]) if (!W.world.floorAt(x + nx * d, z + nz * d, 2, 0).solid) return true;
    return false;
  });
  if (loft && (!studio || loft.it !== studio.it)) out.push({ id: 'loft', name: 'Waterfront loft', price: 8000, mood: 10, ...loft });
  // Penthouse: the tallest building around; you wake up on the roof.
  const tall = ground.filter((b) => (b.s.maxX - b.s.minX) * (b.s.maxZ - b.s.minZ) > 300).sort((a, b) => b.s.y1 - a.s.y1).slice(0, 3);
  const pent = doorOn(tall);
  if (pent) out.push({ id: 'penthouse', name: 'Penthouse', price: 25000, mood: 20, roof: { x: pent.it.cx, y: pent.it.s.y1, z: pent.it.cz }, ...pent });
  for (const h of out) {
    const { g, sign } = makeDoor(h.it.s, h.e, h.id === 'studio' ? 0xff6a2b : 0x4f9a6a);
    h.mesh = g; h.signMat = sign.material;
  }
  if (!out.length) { const p = W.landmarks.hub.plaza; out.push({ id: 'studio', name: 'Studio apartment', price: 0, mood: 0, x: p[0], y: 0, z: p[1], nx: 0, nz: 1 }); }
  return out;
})();
const ownedHomes = new Set(['studio', ...(store.get(`homes.${D.id}`) || [])]);
const home = {};
function moveInto(id) {
  const h = HOMES.find((k) => k.id === id) || HOMES[0];
  Object.assign(home, { id: h.id, name: h.name, x: h.x, y: h.y, z: h.z, nx: h.nx, nz: h.nz, mood: h.mood, roof: h.roof || null });
  store.set(`home.${D.id}`, h.id);
  for (const k of HOMES) if (k.signMat) { const mine = k.id === h.id; k.signMat.color.set(mine ? 0xff6a2b : 0x4f9a6a); k.signMat.emissive.set(mine ? 0xff6a2b : 0x4f9a6a); }
}
moveInto(store.get(`home.${D.id}`) || 'studio');
function buyHome(id) {
  const h = HOMES.find((k) => k.id === id);
  if (!h) return;
  if (!ownedHomes.has(id)) {
    if (cash < h.price) { hud.toast(`${h.name} costs $${h.price.toLocaleString()}`, 1400); return; }
    addCash(-h.price);
    ownedHomes.add(id);
    store.set(`homes.${D.id}`, [...ownedHomes]);
    sound.finish();
  }
  moveInto(id);
  hud.toast(`You live in the ${h.name.toLowerCase()} now`, 1800);
}
// Waking up: at the door, or on the penthouse roof.
function wakeSpot() {
  if (home.roof) {
    const fl = W.world.floorAt(home.roof.x, home.roof.z, home.roof.y + 1, 0);
    if (fl.solid) return [new THREE.Vector3(home.roof.x, fl.y, home.roof.z), new THREE.Vector3(0, 0, 0)];
  }
  return [new THREE.Vector3(home.x, home.y, home.z), new THREE.Vector3(home.x + home.nx * 10, 0, home.z + home.nz * 10)];
}

// --- your own car: bought once, waiting by your door every morning ---
let myCar = null;
function placeMyCar() {
  if (!store.get('mycar')) return;
  const sx = -home.nz, sz = home.nx;
  const p = findParking(W.world, home.x + home.nx * 6 + sx * 4, home.z + home.nz * 6 + sz * 4, Math.atan2(sx, sz));
  if (!p) return;
  if (!myCar) {
    myCar = new Car(scene, p.x, p.y, p.z, Math.atan2(sx, sz), store.get('mycar.color') || 0x1f8a70);
    V.cars.push(myCar);
  }
  myCar.repair();
  myCar.place(p, Math.atan2(sx, sz));
  myCar.home = { pos: p.clone(), heading: Math.atan2(sx, sz) };
}
placeMyCar();
const CAR_COLORS = [0x1f8a70, 0xd1495b, 0x2f6f8f, 0xe0a030, 0x1f2a30, 0xf2efe6];
function buyCar(color) {
  if (!store.get('mycar')) {
    if (cash < 3000) { hud.toast('Your own car costs $3,000', 1400); return; }
    addCash(-3000);
    store.set('mycar', true);
    sound.finish();
    hud.toast('Bought a car. It waits by your door every morning.', 2200);
  }
  store.set('mycar.color', color);
  if (myCar) { myCar.color = color; myCar.repair(); }
  placeMyCar();
}

const foodTrucks = (() => {
  const out = [];
  const colors = [0xd1495b, 0x2aa198, 0xe0a030, 0x3d5a80, 0x9b5de5, 0x4f9a6a];
  const plaza = W.landmarks.hub.plaza;
  for (let tries = 0; tries < 400 && out.length < 6; tries++) {
    const r = STREETS[Math.floor(Math.random() * STREETS.length)];
    if (!r || r.p.length < 2) continue;
    const i = 1 + Math.floor(Math.random() * (r.p.length - 1));
    const a = r.p[i - 1], b = r.p[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 12) continue;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const mx = (a[0] + b[0]) / 2 - dz * (r.w / 2 + 2.2), mz = (a[1] + b[1]) / 2 + dx * (r.w / 2 + 2.2);
    const dd = Math.hypot(mx - plaza[0], mz - plaza[1]);
    if (dd < 60 || dd > 800 || out.some((t) => Math.hypot(t.x - mx, t.z - mz) < 170)) continue;
    const fl = W.world.floorAt(mx, mz, 2, 0);
    if (!fl.solid || W.world.pointBlocked(mx, 1, mz) || W.world.pointBlocked(mx + dx * 3, 1, mz + dz * 3)) continue;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.5, 5), new THREE.MeshStandardMaterial({ color: colors[out.length % colors.length], roughness: 0.5 }));
    body.position.y = 1.6;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 4), new THREE.MeshStandardMaterial({ color: 0xf2efe6 }));
    awning.position.set(-1.7, 2.6, 0); awning.rotation.z = -0.25;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1), new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffd8a0, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
    glow.position.set(-1.16, 1.9, 0); glow.rotation.y = -Math.PI / 2;
    for (const [wx, wz] of [[-1, 1.6], [1, 1.6], [-1, -1.6], [1, -1.6]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x1b1d20 }));
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.4, wz); g.add(w);
    }
    g.add(body, awning, glow);
    g.position.set(mx, fl.y, mz);
    g.rotation.y = Math.atan2(dx, dz);
    scene.add(g);
    W.world.addBox(mx, mz, dx, dz, 2.5, 1.15, fl.y, fl.y + 2.9, { kind: 'prop' });
    const price = 8 + out.length * 2;
    out.push({ x: mx + dz * 2.4, z: mz - dx * 2.4, tx: mx, tz: mz, name: FOOD_NAMES[out.length % FOOD_NAMES.length], price, fill: 35 + price * 2 });
  }
  return out;
})();
const museum = { donated: new Set(store.get('museum') || []), sets: new Set(store.get('museum.sets') || []) };
function donateAll() {
  let n = 0;
  for (let i = finds.length - 1; i >= 0; i--) {
    if (!museum.donated.has(finds[i].id)) { museum.donated.add(finds[i].id); finds.splice(i, 1); n++; }
  }
  store.set('finds', finds);
  store.set('museum', [...museum.donated]);
  if (!n) { hud.toast('Nothing new for the museum. Keep digging.', 1400); return; }
  life.mood(6);
  hud.toast(`Donated ${n} find${n > 1 ? 's' : ''} to the museum`, 1500);
  for (const S2 of SETS) {
    if (museum.sets.has(S2.id) || !S2.items.every((id) => museum.donated.has(id))) continue;
    museum.sets.add(S2.id);
    store.set('museum.sets', [...museum.sets]);
    addCash(S2.reward);
    sound.finish();
    hud.toast(`Museum set complete: ${S2.name}  +$${S2.reward}`, 2600);
  }
}
function sellFinds() {
  if (!finds.length) return;
  const total = finds.reduce((a, f) => a + Math.round(((ARTIFACTS.find((x) => x.id === f.id) || {}).value || 0) * 0.5), 0);
  finds.length = 0;
  store.set('finds', finds);
  addCash(total);
  hud.toast(`Sold your finds to a dealer  +$${total}`, 1500);
}
function nearFood(p) { return foodTrucks.find((t) => Math.hypot(p.x - t.x, p.z - t.z) < 3.4 || Math.hypot(p.x - t.tx, p.z - t.tz) < 3.6); }

// --- phone (P) ---
let phoneOpen = false;
function togglePhone(on = !phoneOpen) {
  if (on && (state !== 'play' || active)) return;
  phoneOpen = on;
  $('#phone').hidden = !on;
  if (on) {
    state = 'phone';
    input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    for (const m of life.s.inbox) m.unread = false;
    $('#phone-badge').hidden = true;
    renderPhone();
  } else {
    state = 'play';
    input.enabled = true;
    lockPointer();
  }
}
function placePoint(name) {
  if (name === 'hub') { const p = W.landmarks.hub.plaza; return { x: p[0], y: 0, z: p[1] }; }
  if (name === 'dock') return V.dock ? V.dock.shore : { x: 0, y: 0, z: 0 };
  if (name === 'home') return home;
  if (name === 'food') return foodTrucks[0] || home;
  return null;
}
function renderPhone() {
  const s = life.s;
  $('#ph-clock').textContent = life.clock;
  $('#ph-day').textContent = `Day ${s.day} · rent in ${life.rentDueIn} day${life.rentDueIn === 1 ? '' : 's'}`;
  const bar = (v) => `<i class="bar"><i class="${v < 25 ? 'low' : v < 50 ? 'mid' : ''}" style="width:${Math.round(v)}%"></i></i>`;
  $('#ph-you').innerHTML = `
    <div class="need"><span>Energy</span>${bar(s.energy)}</div>
    <div class="need"><span>Food</span>${bar(s.food)}</div>
    <div class="need"><span>Mood</span>${bar(s.mood)}</div>
    <div class="meta">Cash $${Math.round(cash).toLocaleString()} · Home: apartment on ${placeName(home) || 'the waterfront'}</div>`;
  $('#ph-goals').innerHTML = s.goals.list.map((g) => `<li class="${g.done ? 'done' : ''}">${g.text}${g.need > 1 && !g.done ? ` <span class="meta">${g.event === 'drive' || g.event === 'run' ? `${(g.have / 1000).toFixed(1)} / ${(g.need / 1000).toFixed(1)} km` : `${g.have} / ${g.need}`}</span>` : ''}</li>`).join('')
    + `<li class="meta">Each goal pays $100, all three another $200.</li>`;
  // Work: every career, its rank, and a button to take a gig.
  const work = CAREERS.map((C) => {
    const n = s.work[C.id] || 0, R = careerRank(n);
    const doing = job && job.career === C.id;
    return `<li><span class="who" style="color:${C.color}">${C.name}</span><span class="meta">${R.name} · ${n} gig${n === 1 ? '' : 's'} · pay ×${R.pay}</span><span>${C.blurb}</span>
      ${doing ? `<button class="btn ghost" data-quit="1">Quit this gig</button>` : `<button class="btn" data-gig="${C.id}">Take a gig</button>`}</li>`;
  }).join('');
  const story = life.activeSteps().map((a) => {
    const st = a.step;
    const btn = st.course ? `<button class="btn" data-course="${st.course}">Start the run</button>` : st.goto ? `<button class="btn ghost" data-goto="${st.goto}">Set waypoint</button>` : '';
    return `<li><span class="who" style="color:${a.contact.color}">${a.contact.name} · ${a.chapter.title}</span><span>${st.text}${st.count > 1 ? ` (${a.prog} / ${st.count})` : ''}</span>${btn}</li>`;
  }).join('') || '<li class="meta">No missions right now. New messages arrive in the morning.</li>';
  $('#ph-story').innerHTML = story + `<li class="meta" style="margin-top:6px">WORK</li>` + work
    + `<li><span class="who">Archaeology</span>
        <span class="meta">${finds.length ? `Carrying: ${finds.slice(0, 6).map((f) => (ARTIFACTS.find((a) => a.id === f.id) || {}).name).join(' · ')}${finds.length > 6 ? ` and ${finds.length - 6} more` : ''}` : 'Nothing in your bag.'}</span>
        ${SETS.map((S2) => `<span class="meta">${museum.sets.has(S2.id) ? '✓' : '·'} ${S2.name}: ${S2.items.filter((id) => museum.donated.has(id)).length} / ${S2.items.length} in the museum · $${S2.reward}</span>`).join('')}
        <span class="meta">Donate at the plaza by the landmark, or sell for half value.</span>
        ${finds.length ? '<button class="btn ghost" data-sell="1">Sell to a dealer</button>' : ''}</li>`;
  $('#ph-homes').innerHTML = HOMES.map((h) => {
    const mine = home.id === h.id, own = ownedHomes.has(h.id);
    return `<li><span class="who">${h.name}${mine ? ' · home' : ''}</span><span class="meta">on ${placeName(h) || 'the waterfront'}${h.mood ? ` · +${h.mood} mood each night` : ''}${h.roof ? ' · wake up on the roof' : ''}</span>
      ${mine ? '' : `<button class="btn ${own ? 'ghost' : ''}" data-home="${h.id}">${own ? 'Move back here' : `Buy · $${h.price.toLocaleString()}`}</button>`}</li>`;
  }).join('') + `<li><span class="who">Your car</span><span class="meta">${store.get('mycar') ? 'Parked by your door every morning. Pick a colour:' : 'Buy a car of your own for $3,000. Pick a colour:'}</span>
      <span class="row">${CAR_COLORS.map((c) => `<button class="swatch" data-car="${c}" style="background:#${c.toString(16).padStart(6, '0')}" aria-label="Car colour"></button>`).join('')}</span></li>`;
  $('#ph-inbox').innerHTML = s.inbox.slice(0, 12).map((m) => {
    const c = CONTACTS.find((k) => k.id === m.from);
    return `<li class="${m.unread ? 'unread' : ''}"><span class="who" style="color:${c ? c.color : '#1f3440'}">${c ? c.name : m.from}</span><span>${m.text}</span><span class="meta">Day ${m.day} · ${m.clock}</span></li>`;
  }).join('') || '<li class="meta">No messages yet.</li>';
  const extra = modules.map((m) => (m.phoneHtml ? m.phoneHtml() : '')).join('');
  $('#ph-mods').innerHTML = extra;
  $('#ph-mods').hidden = !extra;
  const P = $('#phone');
  P.querySelectorAll('[data-gig]').forEach((b) => b.addEventListener('click', () => { togglePhone(false); startGig(b.dataset.gig); }));
  P.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', () => { buyHome(b.dataset.home); renderPhone(); }));
  P.querySelectorAll('[data-car]').forEach((b) => b.addEventListener('click', () => { buyCar(+b.dataset.car); renderPhone(); }));
  P.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', () => { sellFinds(); renderPhone(); }));
  P.querySelectorAll('[data-quit]').forEach((b) => b.addEventListener('click', () => { endJob('Gig cancelled'); renderPhone(); }));
  P.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    const p = placePoint(b.dataset.goto);
    if (p) { waypoint = new THREE.Vector3(p.x, p.y || 0, p.z); hud.toast('Waypoint set', 900); }
    togglePhone(false);
  }));
  P.querySelectorAll('[data-course]').forEach((b) => b.addEventListener('click', () => {
    const c = courses.find((k) => k.id === D.courseIds + b.dataset.course);
    if (!c) return;
    togglePhone(false);
    lifeReturn = true;
    store.set('lifePos', [player.pos.x, player.pos.y, player.pos.z]);
    startCourse(c);
  }));
}
$('#btn-phone').addEventListener('click', () => togglePhone());
// Start City Life over: clears the day, needs, story, careers, finds, homes and car (not best times).
$('#btn-newlife').addEventListener('click', () => {
  if (!confirm('Start a new life? Your days, money, story, careers, finds, homes and car are reset. Best times and ghosts stay.')) return;
  for (const k of ['life', 'lifePos', 'finds', 'museum', 'museum.sets', 'cash', 'career', 'mycar', 'mycar.color', 'friends', `homes.${D.id}`, `home.${D.id}`]) store.set(k, null);
  location.reload();
});
// Buttons inside module sections of the phone: the module decides; re-render after.
$('#ph-mods').addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-action]');
  if (!t) return;
  let close = false;
  for (const m of modules) if (m.onPhoneClick && m.onPhoneClick(t) === 'close') close = true;
  if (close) togglePhone(false); else renderPhone();
});
$('#btn-phone-x').addEventListener('click', () => togglePhone(false));
let lifeReturn = false;
$('#btn-results-city').addEventListener('click', () => { lifeReturn = false; startFree(true); });

// --- sleeping and the day summary ---
function endDay(passedOut) {
  moduleEvent('sleep', { passedOut });
  const sum = life.sleep(passedOut);
  if (!passedOut && home.mood) life.mood(home.mood);
  if (sum.rent) addCash(-sum.rent);
  const done = sum.goals.filter((g) => g.done).length;
  $('#de-title').textContent = `Day ${sum.day}`;
  $('#de-head').textContent = passedOut ? 'You passed out' : 'Good night';
  $('#de-list').innerHTML = [
    ['Earned', `$${Math.round(sum.earned).toLocaleString()}`],
    ['Spent', `$${Math.round(sum.spent).toLocaleString()}`],
    ...(sum.rent ? [['Rent paid', `$${sum.rent}`]] : []),
    ['Goals', `${done} / ${sum.goals.length}`],
    ...sum.goals.map((g) => [`${g.done ? '✓' : '·'} ${g.text}`, '']),
    ['Mood', `${Math.round(sum.mood)}%`],
    ...(passedOut ? [['Woke up on the street. Tomorrow starts tired.', '']] : []),
  ].map(([a, b]) => `<li><span>${a}</span><span>${b}</span></li>`).join('');
  $('#btn-newday').textContent = `Start day ${life.s.day}`;
  endJob(null);
  if (driving) exitVehicle(true);
  state = 'dayend';
  input.enabled = false;
  sound.silence();
  if (document.pointerLockElement) document.exitPointerLock();
  showScreen('#dayend');
  saveLife();
}
$('#btn-newday').addEventListener('click', () => {
  showScreen(null);
  hud.show(true);
  placeMyCar();
  spawnAt(...wakeSpot());
  fade();
  state = 'play';
  input.enabled = true;
  hud.toast(`Day ${life.s.day} · ${life.clock}`, 1600);
  lockPointer();
});
life.on((type, data) => {
  if (type === 'message') {
    hud.toast(`Message from ${data.contact.name}: ${data.chapter.title} · P for phone`, 2600);
    $('#phone-badge').hidden = false;
    [1320, 1760].forEach((f, i) => sound.tone(f, 0.1, 'sine', 0.08, null, i * 0.12));
  }
  if (type === 'goal') { addCash(100); hud.toast(`Goal done: ${data.text}  +$100`, 1800); }
  if (type === 'allgoals') { addCash(200); hud.toast('All of today’s goals done  +$200', 2000); }
  if (type === 'chapter') { addCash(data.chapter.pay); hud.toast(`${data.contact.name}: “${data.chapter.title}” complete  +$${data.chapter.pay}`, 2400); sound.finish(); }
  if (type === 'step') hud.toast(`${data.contact.name}: ${data.step.text}`, 1800);
  if (type === 'passout') endDay(true);
  saveLife();
});

// --- night life: a rooftop party somewhere most nights ---
const party = (() => {
  const g = new THREE.Group();
  const cols = [0xff4fa3, 0x4fd1ff, 0xffd34d, 0x7cff6b];
  for (let i = 0; i < 4; i++) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 2.5, 60, 10, 1, true).translate(0, 30, 0),
      new THREE.MeshBasicMaterial({ color: cols[i], transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.userData.k = i;
    g.add(beam);
  }
  g.visible = false;
  scene.add(g);
  return { g, spot: null, day: 0, joined: 0 };
})();
function partyTick(dt, focus) {
  const h = (life.s.minute % 1440) / 60;
  const on = (h >= 21 || h < 1) && life.s.day % 3 !== 0; // most nights, not every night
  if (on && party.day !== life.s.day) {
    party.day = life.s.day;
    const roofs = W.world.ladders.filter((L) => L.y1 > 18 && L.y1 < 70);
    const L = roofs[Math.floor(Math.random() * roofs.length)];
    party.spot = L ? { x: L.x - L.nx * 3, y: L.y1, z: L.z - L.nz * 3 } : null;
    if (party.spot) {
      hud.toast('Theo: rooftop party tonight. Look for the lights.', 2400);
      $('#phone-badge').hidden = false;
      life.s.inbox.unshift({ from: 'theo', title: 'Party', text: 'Rooftop party tonight, find the lights in the sky. Bring your best moves.', day: life.s.day, clock: life.clock, unread: true });
    }
  }
  party.g.visible = on && !!party.spot;
  if (!party.g.visible) return;
  party.g.position.set(party.spot.x, party.spot.y, party.spot.z);
  party.g.children.forEach((b, i) => { b.rotation.z = Math.sin(elapsed * 0.8 + i * 1.6) * 0.35; b.rotation.x = Math.cos(elapsed * 0.6 + i) * 0.35; });
  if (party.joined !== life.s.day && Math.hypot(focus.x - party.spot.x, focus.z - party.spot.z) < 8 && Math.abs(focus.y - party.spot.y) < 3) {
    party.joined = life.s.day;
    life.mood(25);
    life.s.energy = Math.max(0, life.s.energy - 10);
    if (radioStation === 0) radioStation = 2;
    sound.setRadio(2);
    setTimeout(() => { if (!driving) sound.setRadio(0); }, 20000);
    hud.toast('You made the party. Mood way up.', 2000);
    life.event('party');
  }
}


// --- module host: self-contained City Life systems plug in here (see docs/module-contract.md) ---
const modules = [];
let moduleTarget = null;
const ctx = {
  THREE, scene, camera, W, BRIDGE, D, V, player, life, sound, hud, particles, store, Avatar, LOOKS,
  getDriving: () => driving,
  addCash: (n) => addCash(n),
  setPrompt: (t) => { lifePrompt = t; },
  holdE: () => holdE(),
  pressedE: () => input.grabHit,
  setTarget: (p) => { moduleTarget = p ? new THREE.Vector3(p.x, p.y || 0, p.z) : null; },
  get foodSpots() { return foodTrucks.map((t) => ({ x: t.tx, z: t.tz, name: t.name, price: t.price })); },
};
function moduleEvent(name, data) { for (const m of modules) if (m.onEvent) m.onEvent(name, data); }
function addModule(m) { if (m) modules.push(m); return m; }

// --- the per-frame life tick (free roam only) ---
let lifeSaveT = 0, placeT = 0;
function lifeTick(dt, realDt) {
  $('#life').hidden = !!active;
  $('#btn-phone').hidden = !!active;
  if (active) { player.energyMul = 1; return; }
  const focus = driving ? driving.pos : player.pos;
  const effort = !driving && (player.mode === 'climb' ? 0.8 : player.onGround && player.speed > 10 ? 1 : 0);
  life.tick(realDt, effort);
  if (state !== 'play') return; // passing out ends the day
  player.energyMul = life.speedMul;
  if (driving && driving.kind === 'car' && radioStation) life.mood(realDt * 0.02);
  // HUD.
  const s = life.s;
  $('#life-clock').textContent = life.clock;
  $('#life-day').textContent = `Day ${s.day}`;
  for (const [k, v] of [['energy', s.energy], ['food', s.food], ['mood', s.mood]]) {
    const el = $('#need-' + k);
    el.style.width = `${Math.round(v)}%`;
    el.className = v < 25 ? 'low' : v < 50 ? 'mid' : '';
  }
  const h = (s.minute % 1440) / 60;
  $('#life-note').textContent = s.energy < 15 ? 'Exhausted. Go home and sleep.' : s.food < 15 ? 'Starving. Find a food truck.'
    : (h >= 23 || h < 5) ? 'It’s late. Home is marked on the map.' : life.rentDueIn === 1 ? `Rent ($${RENT}) is due tomorrow.` : '';
  // Places for the story, and interactions.
  placeT -= realDt;
  if (placeT <= 0) {
    placeT = 0.5;
    const plaza = W.landmarks.hub.plaza;
    if (Math.hypot(focus.x - plaza[0], focus.z - plaza[1]) < 25) life.storyEvent({ goto: 'hub' });
    if (V.dock && Math.hypot(focus.x - V.dock.shore.x, focus.z - V.dock.shore.z) < 18) life.storyEvent({ goto: 'dock' });
    if (Math.hypot(focus.x - home.x, focus.z - home.z) < 5) life.storyEvent({ goto: 'home' });
  }
  if (!driving) {
    const t = nearFood(player.pos);
    if (t) {
      lifePrompt = `Press E to eat at ${t.name} ($${t.price})`;
      if (input.grabHit) {
        if (cash < t.price) hud.toast('Not enough cash. Take a gig (J).', 1400);
        else { addCash(-t.price); life.eat(t.fill); sound.pickup(); hud.toast(`${t.name}: delicious`, 1200); saveLife(); moduleEvent('eat', t); }
      }
    } else if (finds.length && Math.hypot(player.pos.x - W.landmarks.hub.plaza[0], player.pos.z - W.landmarks.hub.plaza[1]) < 6) {
      lifePrompt = `Press E to donate ${finds.length} find${finds.length > 1 ? 's' : ''} to the museum`;
      if (input.grabHit) donateAll();
    } else if (Math.hypot(player.pos.x - home.x, player.pos.z - home.z) < 3 && Math.abs(player.pos.y - home.y) < 2) {
      const late = h >= 18 || h < 5 || s.energy < 35;
      lifePrompt = late ? 'Press E to go to bed (ends the day)' : 'Press E to nap for two hours';
      if (input.grabHit) {
        if (late) endDay(false);
        else { life.tick(120, 0); s.energy = Math.min(100, s.energy + 30); fade(); hud.toast('Napped for two hours', 1200); saveLife(); }
      }
    }
  }
  partyTick(dt, focus);
  for (const m of modules) if (m.update) m.update(dt, ctx);
  lifeSaveT -= realDt;
  if (lifeSaveT <= 0) { lifeSaveT = 5; saveLife(); store.set('lifePos', [player.pos.x, player.pos.y, player.pos.z]); }
}

// --- waypoint and the full-screen map (Tab) ---
let waypoint = null;
const bigmap = new BigMap($('#bigmap'), minimap, (x, z) => {
  if (waypoint && Math.hypot(waypoint.x - x, waypoint.z - z) < 60) { waypoint = null; return; }
  const fl = W.world.floorAt(x, z, 400, 0);
  waypoint = new THREE.Vector3(x, fl.solid ? fl.y : 0, z);
  sound.click();
});
function mapState() {
  const focus = driving ? driving.pos : player.pos;
  const marks = [];
  for (const it of parcels.items) if (!parcels.collected.has(it.i)) marks.push({ x: it.g.position.x, z: it.g.position.z, color: '#ffb347', r: 3 });
  for (const c of V.cars) if (c !== driving) marks.push({ x: c.pos.x, z: c.pos.z, color: '#2f6f8f', square: true });
  if (V.plane && V.plane !== driving) marks.push({ x: V.plane.pos.x, z: V.plane.pos.z, color: '#ffffff', r: 4 });
  const t0 = W.landmarks.bridgeInfo.at(BRIDGE.towers[0], 0);
  marks.push({ x: 0, z: 0, color: '#1f3440', r: 5, label: D.hubName });
  marks.push({ x: t0[0], z: t0[1], color: '#c0442c', r: 5, label: D.bridgeName });
  if (job) marks.push({ x: job.target.x, z: job.target.z, color: '#ffd34d', r: 6, ring: true, label: (CAREERS.find((c) => c.id === job.career) || {}).name });
  if (!active) {
    marks.push({ x: home.x, z: home.z, color: '#ff6a2b', r: 5, ring: true, label: 'Home' });
    for (const h of HOMES) if (h.id !== home.id && !ownedHomes.has(h.id)) marks.push({ x: h.x, z: h.z, color: '#4f9a6a', r: 4, label: `${h.name} for sale` });
    for (const t of foodTrucks) marks.push({ x: t.tx, z: t.tz, color: '#4f9a6a', r: 4, label: t.name });
  }
  if (!active) for (const m of modules) if (m.mapMarks) marks.push(...m.mapMarks());
  return { focus, heading: driving ? driving.heading : player.facing, marks, waypoint };
}
function toggleMap(on = !bigmap.open) {
  if (on && state !== 'play') return;
  if (on) {
    state = 'map';
    input.enabled = false;
    sound.silence();
    if (document.pointerLockElement) document.exitPointerLock();
    bigmap.show(true, mapState());
  } else {
    bigmap.show(false);
    state = 'play';
    input.enabled = true;
    if (driving && driving.kind === 'car') sound.setRadio(radioStation);
    lockPointer();
  }
}
$('#btn-map').addEventListener('click', () => toggleMap());
window.addEventListener('resize', () => { if (bigmap.open) bigmap.draw(mapState()); });

// --- place names ---
const named = new Map();
for (const r of map.roads) {
  if (!r.n || r.k === 'service') continue;
  for (const q of r.p) {
    const k = `${Math.floor(q[0] / 40)},${Math.floor(q[1] / 40)}`;
    if (!named.has(k)) named.set(k, []);
    named.get(k).push([q[0], q[1], r.n]);
  }
}
let areaT = 0, areaName = '', areaShownT = 0, nearWater = false;
function placeName(p) {
  const B = W.landmarks.bridge;
  const dx = p.x - B.sx, dz = p.z - B.sz;
  const u = dx * B.dx + dz * B.dz, v = dx * B.px + dz * B.pz;
  if (Math.abs(v) < 28 && u > -BRIDGE.rampLen * 0.5 && u < BRIDGE.centreU + 40) return D.bridgeName;
  if (Math.hypot(p.x, p.z) < 80) return D.hubName;
  let best = null, bd = 30 * 30;
  const cx = Math.floor(p.x / 40), cz = Math.floor(p.z / 40);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    for (const q of named.get(`${cx + i},${cz + j}`) || []) {
      const d = (q[0] - p.x) ** 2 + (q[1] - p.z) ** 2;
      if (d < bd) { bd = d; best = q[2]; }
    }
  }
  return best;
}

// --- per-frame open-world tick ---
const lastFocus = new THREE.Vector3();
let lifePrompt = null;
function openWorld(dt, realDt) {
  lifePrompt = null;
  const focus = driving ? driving.pos : player.pos;
  trafficContact(dt);
  carTricks(dt);
  jobTick(dt, focus);
  lifeTick(dt, realDt);
  if (waypoint && Math.hypot(focus.x - waypoint.x, focus.z - waypoint.z) < 20) { waypoint = null; hud.toast('Waypoint reached', 900); sound.chime(); }
  areaT -= realDt; areaShownT -= realDt;
  if (areaT <= 0) {
    areaT = 0.5;
    const n = placeName(focus);
    if (n && n !== areaName) {
      areaName = n;
      $('#area-name').textContent = n;
      $('#area-sub').textContent = `${D.name} · San Francisco`;
      $('#area').classList.add('on');
      areaShownT = 3;
    }
    let w = 0;
    for (const [ox, oz] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) if (!W.world.floorAt(focus.x + ox, focus.z + oz, focus.y + 5, 0).solid) w++;
    nearWater = w > 0;
  }
  if (areaShownT <= 0) $('#area').classList.remove('on');
  if (radioToastT > 0) { radioToastT -= realDt; if (radioToastT <= 0) $('#radio').hidden = true; }
  for (const c of V.cars) c.setLights(sky.lights);
  const d = lastFocus.distanceTo(focus);
  if (d < 50) {
    if (driving && driving.kind === 'car') { stats.drive += d; if (!active) life.event('drive', d); }
    else if (driving) stats.fly += d;
    else { stats.run += d; if (!active) life.event('run', d); }
  }
  lastFocus.copy(focus);
  statsSave -= realDt;
  if (statsSave <= 0) { statsSave = 5; store.set('stats', stats); }
}


// ================= batch 4: weather, boats, streetcars, achievements, photo mode, garage, traps, daily run =================
const weather = new Weather(scene, W.mats);
weather.setMode(S.weather || 'changes');

// --- ferries: two lanes out from the hub's waterfront ---
const ferries = (() => {
  const h = W.landmarks.hub;
  const [dx, dz] = D.dockDir || [-h.face[0], -h.face[1]];
  const routes = [];
  for (const side of [-1, 1]) {
    const sx = -dz * side * 140, sz = dx * side * 140;
    const a = findWater(W.world, sx + dx * 80, sz + dz * 80, dx, dz);
    if (!a) continue;
    let L = 1300;
    while (L > 300 && W.world.floorAt(a.x + dx * L, a.z + dz * L, 5, 0).solid) L -= 100;
    routes.push([a.x + dx * 20, a.z + dz * 20, a.x + dx * L, a.z + dz * L]);
  }
  return new Ferries(scene, routes);
})();
const streetcars = new Streetcars(scene, map.rails || []);

// --- achievements ---
const ach = new Achievements(store.get('ach'), (a, list) => {
  store.set('ach', list);
  hud.toast(`Achievement · ${a.name}`, 2200);
  [784, 1175, 1568].forEach((f, i) => sound.tone(f, 0.25, 'triangle', 0.1, null, i * 0.07));
});
let comboMovesBest = store.get('combo.moves') || 0;
function achSnapshot() {
  return {
    medals: courses.filter((c) => !c.daily).map((c) => medalOf(c)),
    postcards: parcels.count, postcardTotal: parcels.total, stats, cash, comboBest: comboMovesBest,
  };
}

// --- garage upgrades (bought with cash, saved per browser) ---
const UPGRADES = [
  { id: 'engine', name: 'Tuned engine', desc: 'Higher top speed and quicker acceleration.', price: 2500, apply: () => { CAR.max = 50; CAR.accel = 18.5; } },
  { id: 'nitro', name: 'Bigger nitro', desc: 'The boost tank refills twice as fast.', price: 1500, apply: () => { CAR.boostRefill = 0.16; } },
  { id: 'armour', name: 'Reinforced body', desc: 'Bumps do half the damage.', price: 1200, apply: () => { CAR.armour = 0.5; } },
  { id: 'prop', name: 'Seaplane prop', desc: 'More thrust: faster take-offs and climbs.', price: 2000, apply: () => { PLANE.thrust = 28; } },
];
const owned = new Set(store.get('upgrades') || []);
for (const u of UPGRADES) if (owned.has(u.id)) u.apply();
function renderGarage() {
  const box = $('#garage');
  box.innerHTML = '';
  $('#garage-val').textContent = `${owned.size} / ${UPGRADES.length} · $${Math.round(cash).toLocaleString()}`;
  for (const u of UPGRADES) {
    const b = document.createElement('button');
    b.className = 'upg';
    b.id = 'upg-' + u.id;
    const have = owned.has(u.id);
    b.setAttribute('aria-pressed', String(have));
    b.disabled = !have && cash < u.price;
    b.innerHTML = `<b>${u.name}</b><span>${u.desc}</span><em>${have ? 'Installed' : '$' + u.price.toLocaleString()}</em>`;
    b.addEventListener('click', () => {
      if (have || cash < u.price) return;
      addCash(-u.price);
      owned.add(u.id);
      store.set('upgrades', [...owned]);
      u.apply();
      renderGarage();
    });
    box.appendChild(b);
  }
}
function renderAchievements() {
  $('#ach-val').textContent = `${ach.count} / ${ACHIEVEMENTS.length}`;
  $('#ach-list').innerHTML = ACHIEVEMENTS.map((a) => `<li class="${ach.got.has(a.id) ? 'got' : ''}"><b>${a.name}</b><span>${a.desc}</span></li>`).join('');
}

// --- speed traps on the long streets ---
const traps = (() => {
  const out = [];
  const roads = map.roads.filter((r) => ['primary', 'secondary', 'trunk', 'tertiary'].includes(r.k)).sort((a, b) => b.p.length - a.p.length);
  for (const r of roads) {
    for (let i = 1; i < r.p.length && out.length < 4; i++) {
      const a = r.p[i - 1], b = r.p[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 90) continue;
      const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
      if (out.some((t) => Math.hypot(t.x - x, t.z - z) < 350)) continue;
      if (!W.world.floorAt(x, z, 3, 0).solid) continue;
      out.push({ x, z, dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len, w: r.w, name: r.n || 'the street', cool: 0 });
    }
    if (out.length >= 4) break;
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6 });
  const camMat = new THREE.MeshStandardMaterial({ color: 0x9b5de5, emissive: 0x9b5de5, emissiveIntensity: 0.4 });
  out.forEach((t, i) => {
    const sx = -t.dz * (t.w / 2 + 1.5), sz = t.dx * (t.w / 2 + 1.5);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), poleMat);
    pole.position.y = 2.5;
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1), camMat);
    cam.position.y = 5;
    g.add(pole, cam);
    g.position.set(t.x + sx, 0, t.z + sz);
    scene.add(g);
    t.mesh = cam;
    t.key = `trap.${D.id}.${i}`;
  });
  return out;
})();
function trapTick(dt) {
  const v = driving;
  for (const t of traps) {
    t.cool -= dt;
    if (!v || v.kind !== 'car' || t.cool > 0) continue;
    if (Math.hypot(v.pos.x - t.x, v.pos.z - t.z) > t.w / 2 + 4) continue;
    t.cool = 4;
    const kmh = Math.round(v.speed * 3.6);
    const best = store.get(t.key) || 0;
    t.mesh.material.emissiveIntensity = 3;
    setTimeout(() => { t.mesh.material.emissiveIntensity = 0.4; }, 200);
    sound.tone(1800, 0.08, 'square', 0.06);
    if (kmh >= 150) ach.unlock('speed');
    if (kmh > best) {
      store.set(t.key, kmh);
      const pay = Math.max(0, kmh - best);
      addCash(pay);
      hud.toast(`Speed trap · ${t.name} · ${kmh} km/h  New best  +$${pay}`, 1800);
    } else hud.toast(`Speed trap · ${kmh} km/h  (best ${best})`, 1300);
  }
}

// --- daily run: a fresh street route every day, same for everyone ---
(() => {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  let seed = +ymd ^ (D.id.length * 7919);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const nodes = [];
  for (const r of STREETS) for (const q of r.p) nodes.push(q);
  if (nodes.length < 20) return;
  const plaza = W.landmarks.hub.plaza;
  const pts = [{ kind: 'ground', x: plaza[0], z: plaza[1] }];
  let cur = plaza;
  for (let k = 0; k < 6; k++) {
    let pick = null;
    for (let tries = 0; tries < 400 && !pick; tries++) {
      const q = nodes[Math.floor(rnd() * nodes.length)];
      const d = Math.hypot(q[0] - cur[0], q[1] - cur[1]);
      if (d < 200 || d > 420) continue;
      if (pts.some((p) => Math.hypot(p.x - q[0], p.z - q[1]) < 150)) continue;
      if (!W.world.floorAt(q[0], q[1], 3, 0).solid) continue;
      pick = q;
    }
    if (!pick) break;
    pts.push({ kind: 'ground', x: pick[0], z: pick[1] });
    cur = pick;
  }
  if (pts.length < 4) return;
  const label = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  courses.push(resolveCourse({
    id: `${D.courseIds}daily.${ymd}`, name: `Daily Run · ${label}`, difficulty: 'Medium', daily: true, kind: 'Daily',
    blurb: 'A new route through the streets every day. Any way you like: run, borrow a car, even fly.',
    points: pts, start: plaza, pace: 12,
  }, W.world));
})();

// --- photo mode (O) ---
const photo = { yaw: 0, pitch: 0.3, dist: 9, prev: 'play' };
function togglePhoto(on = state !== 'photo') {
  if (on && state !== 'play') return;
  if (on) {
    photo.prev = state;
    state = 'photo';
    photo.yaw = rig.yaw; photo.pitch = 0.3; photo.dist = 9;
    document.body.classList.add('photo');
    $('#photo-ui').hidden = false;
    sound.silence();
  } else {
    state = 'play';
    document.body.classList.remove('photo');
    $('#photo-ui').hidden = true;
    if (driving && driving.kind === 'car') sound.setRadio(radioStation);
  }
}
function photoFrame(realDt) {
  const [lx, ly] = input.consumeLook();
  photo.yaw -= lx; photo.pitch = Math.max(-0.2, Math.min(1.4, photo.pitch + ly));
  const f = driving ? driving.pos : player.pos;
  const cp = Math.cos(photo.pitch);
  camera.position.set(f.x + Math.sin(photo.yaw) * cp * photo.dist, f.y + 1.2 + Math.sin(photo.pitch) * photo.dist, f.z + Math.cos(photo.yaw) * cp * photo.dist);
  camera.lookAt(f.x, f.y + 1.2, f.z);
}
function savePhoto() {
  renderer.render(scene, camera);
  judgePhoto();
  try {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `fog-city-rush-${Date.now()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    hud.toast('Photo saved', 1000);
    ach.unlock('photo');
    if (!active) life.event('photo');
    moduleEvent('photo');
  } catch (_) { hud.toast('This browser blocked the download', 1400); }
  const fl = $('#fade');
  fl.style.background = '#fff'; fade();
  setTimeout(() => { fl.style.background = ''; }, 700);
}
canvas.addEventListener('wheel', (e) => { if (state === 'photo') { photo.dist = Math.max(2.5, Math.min(60, photo.dist * (e.deltaY > 0 ? 1.1 : 0.9))); e.preventDefault(); } }, { passive: false });

// --- fast travel: right-click the map ---
$('#bigmap canvas').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (driving || active) { hud.toast('Fast travel works on foot in free roam', 1200); return; }
  const r = e.target.getBoundingClientRect();
  const [x, z] = bigmap.toWorld((e.clientX - r.left) * bigmap.dpr, (e.clientY - r.top) * bigmap.dpr);
  const fl = W.world.floorAt(x, z, 3, 0);
  if (!fl.solid || W.world.pointBlocked(x, fl.y + 1, z)) { hud.toast("Can't fast travel there", 1000); return; }
  if (cash < 50) { hud.toast('Fast travel costs $50', 1000); return; }
  addCash(-50);
  toggleMap(false);
  spawnAt(new THREE.Vector3(x, fl.y, z), null);
  fade();
  hud.toast('Fast travel  −$50', 1000);
});

// --- per-frame tick for batch 4 ---
let achT = 0;
function worldExtras(dt, realDt) {
  const focus = driving ? driving.pos : player.pos;
  // The swimmer for a harbour-patrol rescue: a bobbing head and an orange ring.
  swimmer.visible = !!(job && job.career === 'patrol' && job.i <= 1);
  if (swimmer.visible) swimmer.position.set(job.swimmer.x, -1.5 + Math.sin(elapsed * 2) * 0.12, job.swimmer.z);
  for (const ev of ferries.update(dt)) {
    const d = Math.hypot(ev.x - focus.x, ev.z - focus.z);
    if (d < 900 && state === 'play') sound.shipHorn(Math.min(1, d / 900));
    if (d < 500 && state === 'play' && !active) life.event('ferry');
  }
  streetcars.update(dt, state === 'play' ? [focus] : []);
  if (state !== 'play') return;
  // Streetcars are solid.
  if (driving && driving.kind === 'car') {
    const hit = streetcars.push(driving.pos, 2.2);
    if (hit) {
      const vn = driving.vel.x * hit.nx + driving.vel.z * hit.nz;
      if (vn < 0) { driving.vel.x -= hit.nx * vn * 1.4; driving.vel.z -= hit.nz * vn * 1.4; if (-vn > 3) { carDamage(driving, -vn); sound.scrape(-vn * 2); particles.sparks(driving.pos.x, 1, driving.pos.z, 1); } }
    }
  } else if (!driving) streetcars.push(player.pos, 0.4);
  trapTick(dt);
  // Achievements by place and moment.
  const h = W.landmarks.hub, bi = W.landmarks.bridgeInfo;
  if (!driving && player.onGround && Math.hypot(player.pos.x, player.pos.z) < 12 && player.pos.y > h.balcony.y - 1) {
    ach.unlock('hub-top');
    if (!active && life.s.view !== life.s.day) { life.s.view = life.s.day; life.event('view'); life.mood(10); }
  }
  if (!driving && player.onGround && player.pos.y > bi.towerTop - 1) ach.unlock('tower-top');
  if (driving && driving.kind === 'car' && weather.k.rain > 0.6 && driving.speed > 8) ach.unlock('rain');
  achT -= realDt;
  if (achT <= 0) { achT = 1; ach.check(achSnapshot()); }
}
$('#set-weather').addEventListener('input', (e) => { S.weather = e.target.value; saveSettings(S); weather.setMode(S.weather); });

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
  input.pollPad(realDt);
  padMenus();
  W.update(dt, elapsed);
  if (S.timeOfDay === 'cycle' && !active && state !== 'menu') { sky.mode = 'clock'; sky.u = life.skyU; sky.night = life.night; }
  else if (sky.mode === 'clock') sky.setMode(S.timeOfDay);
  sky.apply(realDt, elapsed);
  weather.apply(realDt, camera, sky, sun, hemi);
  sound.rainLevel(state === 'play' || state === 'countdown' ? weather.k.rain : 0);
  W.setWindowLights(sky.lights);
  for (const f of W.fogBanks) f.material.color.copy(scene.fog.color).lerp(new THREE.Color(0xffffff), 0.35);
  const honks = traffic.update(dt, state === 'menu' ? [] : [driving ? driving.pos : player.pos]);
  for (const h of honks) {
    const d = Math.hypot(h.x - player.pos.x, h.z - player.pos.z);
    if (d < 60 && state === 'play') sound.horn(d / 60);
  }
  worldExtras(dt, realDt);
  if (state === 'play' || state === 'menu') {
    const th = [];
    if (state === 'play') {
      th.push({ x: player.pos.x, z: player.pos.z, vx: player.vel.x, vz: player.vel.z, r: 0.6 });
      if (driving && driving.kind === 'car') th.push({ x: driving.pos.x, z: driving.pos.z, vx: driving.vel.x, vz: driving.vel.z, r: 2.2 });
    }
    peds.update(dt, state === 'menu' ? camera.position : (driving ? driving.pos : player.pos), th, elapsed);
  }
  gulls.update(dt, elapsed);
  particles.update(dt);
  details.update(state === 'menu' ? camera.position : (driving ? driving.pos : player.pos), sky.lights, elapsed);

  let speed3 = 0;
  if (state === 'menu') {
    menuT += realDt;
    const u = (menuT / tour.duration) % 1;
    tour.pos.getPointAt(u, camera.position);
    tour.look.getPointAt(u, _look);
    camera.lookAt(_look);
    camera.fov += (62 - camera.fov) * Math.min(1, realDt * 3);
    camera.updateProjectionMatrix();
    sun.target.position.copy(camera.position).setY(0);
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
        updateCombo(dt);
        if (input.useHit) {
          if (active && active.vehicle) hud.toast('Finish the run, or press R to restart', 1200);
          else exitVehicle();
        }
      } else {
        player.update(dt, input, rig.yaw);
        updateCombo(dt);
        footEffects(dt);
        if (player.pos.y < -1.4) {
          const back = active ? runner.respawn : player.safe;
          const next = active ? runner.next : null;
          spawnAt(back.clone(), next);
          fade();
          hud.toast('Splash! Back on dry land', 1400);
        }
        let near = !active || !active.vehicle ? nearestVehicle() : null;
        if (near) {
          const verb = near.kind === 'plane' ? 'fly' : 'drive';
          player.prompt = `Press F to ${verb}`;
          if (input.useHit) enterVehicle(near);
        } else if (!active) {
          // Any car in traffic can be borrowed.
          const tc = traffic.nearest(player.pos.x, player.pos.z, 3.6);
          if (tc) {
            near = { kind: 'car' };
            player.prompt = 'Press F to borrow this car';
            if (input.useHit) borrowCar(tc);
          }
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
          store.set(parcelKey, [...parcels.collected]);
          sound.pickup();
          particles.confetti(focus.x, focus.y + 1.5, focus.z);
          hud.toast(`Postcard ${parcels.count} / ${parcels.total} · ${parcels.spots[got][3]}`, 1800);
          addCash(250);
          life.event('postcard'); life.mood(5);
        }
      }
    }
    for (const v of vehicles()) {
      if (v === driving || v.kind !== 'plane') continue;
      if (v.state === 'water') { v.pos.y = -1.45 + Math.sin(elapsed * 1.7) * 0.05; v.sync(dt, elapsed); }
      if (v.state === 'crashed') { v.crashTimer -= dt; if (v.crashTimer <= 0) v.resetToDock(); }
    }
    if (state === 'photo') photoFrame(realDt);
    else if (state !== 'paused') {
      if (driving) {
        const plane = driving.kind === 'plane';
        const cm = CAM_MODES[camMode];
        rig.updateChase(dt, driving.pos, driving.heading, driving.speed, look, plane
          ? { height: 3.2 * cm.h, dist: 15 * cm.d, speedDist: 0.12, maxExtra: 8, pitch: 0.18, fovScale: 0.45, roll: driving.roll }
          : { height: 1.9 * cm.h, dist: 7.5 * cm.d, speedDist: 0.08, maxExtra: 4, pitch: 0.16 * cm.p, fovScale: 0.6 });
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
      // Free roam: the pointer leads to the nearest postcard you haven't found.
      runner, camera, next: runner.next || (!active && state === 'play'
        ? (job ? jobBeacon.position : moduleTarget || waypoint || (parcels.nearestUncollected(focus) || {}).pos || null) : null), focus,
      speed: driving ? Math.abs(driving.speed) : (player.mode === 'zip' ? player.zip.speed : player.speed),
      alt: focus.y,
      throttle: driving && driving.kind === 'plane' ? driving.throttle : null,
      prompt: driving ? lifePrompt : (player.prompt || lifePrompt),
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
    updateKeyHints();
    if (state === 'play') openWorld(dt, realDt);
    sound.radioTick();
    sound.ambience(realDt, state === 'play' || state === 'countdown', nearWater);
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
  perfTick(now, realDt);
}

// ---------- performance: FPS readout and automatic resolution ----------
const perf = { frames: 0, t0: performance.now(), worst: 0, sum: 0, n: 0, cool: 0 };
function perfTick(now, dt) {
  perf.frames++;
  perf.worst = Math.max(perf.worst, dt);
  perf.sum += dt; perf.n++;
  const span = (now - perf.t0) / 1000;
  if (span < 0.5) return;
  const fps = perf.frames / span;
  if (S.showFps) {
    const i = renderer.info.render;
    $('#perf').textContent = `${fps.toFixed(0)} fps  ${(1000 / fps).toFixed(1)} ms  worst ${(perf.worst * 1000).toFixed(0)} ms\n`
      + `${i.calls} draws  ${(i.triangles / 1000).toFixed(0)}k tris  res ×${renderer.getPixelRatio().toFixed(2)}\n`
      + `detail chunks ${details.active ? details.active.size : 0}`;
  }
  // Auto resolution: drop the render scale when frames are slow, creep back up when there's headroom.
  perf.cool -= span;
  if (S.autoRes && document.visibilityState === 'visible' && perf.cool <= 0 && state !== 'paused') {
    const avg = perf.sum / perf.n;
    let next = dynRatio;
    if (avg > 1 / 45 && dynRatio > 0.6) next = Math.max(0.6, dynRatio - 0.15);
    else if (avg < 1 / 57 && dynRatio < maxRatio) next = Math.min(maxRatio, dynRatio + 0.1);
    if (next !== dynRatio) {
      dynRatio = next;
      renderer.setPixelRatio(dynRatio);
      resize();
      perf.cool = 2.5;
    }
  }
  perf.frames = 0; perf.t0 = now; perf.worst = 0; perf.sum = 0; perf.n = 0;
}

renderMenu();
setLoad(100, 'Ready');
loading.hidden = true;
showScreen('#menu');
requestAnimationFrame(frame);

// Installable app on the public site: manifest, home-screen icon and offline cache.
if (/\.github\.io$/.test(location.hostname)) {
  const add = (rel, href) => { const l = document.createElement('link'); l.rel = rel; l.href = href; document.head.appendChild(l); };
  add('manifest', 'manifest.webmanifest');
  add('apple-touch-icon', 'icons/apple-touch-icon.png');
  add('icon', 'icons/icon.svg');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Handy for testing from the console.
window.__fcr = { sun,
  W, player, rig, courses, runner, startCourse, startFree, input, camera, renderer, scene, V,
  get countdown() { return countdown; }, life, startGig, togglePhone, home, foodTrucks, endDay, weather, ferries, streetcars, ach, traps, togglePhoto, get job() { return job; }, toggleJob, toggleMap, borrowCar, peds, bigmap, addCash, get cash() { return cash; }, combo, D, tour, menuAt: (t) => { menuT = t; }, details, enterVehicle, exitVehicle, sound, particles, ghost, recorder, parcels, sky, S, applySettings, traffic, finish,
};
