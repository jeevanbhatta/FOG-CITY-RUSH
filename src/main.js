import * as THREE from 'three';
import { buildWorld, BRIDGE } from './world.js';
import { Player, LOOKS, SKIN_TONES } from './player.js';
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

function startFree() {
  fade();
  if (driving) exitVehicle(true);
  active = null;
  runner.clear();
  ghost.hide();
  resetAllVehicles();
  const p = W.landmarks.hub.plaza;
  spawnAt(new THREE.Vector3(p[0], 0, p[1]), new THREE.Vector3(0, 0, 0));
  hud.setCourse('Free roam', null);
  parcels.show(true);
  combo.reset();
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

$('#btn-free').addEventListener('click', startFree);

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
    if (state === 'paused') resume(); else pause();
  }
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
    if (!active) { add(K('Tab'), 'Map'); if (!v) add(K('J'), job ? 'Cancel job' : 'Courier job'); }
  } else if (dev === 'pad' && v && v.kind === 'car') add(K('RT'), 'Nitro');
  if (dev === 'keys' || dev === 'pad') add(pick(K('R'), K('View'), null), active ? 'Restart' : 'Unstick');
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
        if (e === 'Takeoff') { sound.whoosh(); ach.unlock('takeoff'); }
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
    if (e === 'Zipline') ach.unlock('zip');
    if (e === 'Landed') ach.unlock('chute');
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
}

// --- damage and wrecks ---
let wreckT = 0;
function carDamage(v, impact) {
  const before = v.health;
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

// --- courier jobs (J) ---
let job = null;
const jobBeacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 300, 16, 1, true).translate(0, 150, 0),
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
function toggleJob() {
  if (job) { endJob('Job cancelled'); return; }
  const from = driving ? driving.pos : player.pos;
  const pick = pickSpot(from, 120, 320);
  if (!pick) { hud.toast('No jobs nearby right now', 1200); return; }
  job = { stage: 'pickup', target: pick, time: null };
  jobBeacon.position.set(pick.x, pick.y, pick.z);
  jobBeacon.visible = true;
  $('#job').hidden = false;
  sound.chime();
  tip('job', 'Courier job: grab the parcel at the yellow beacon, then deliver it before the clock runs out. Any way is fair.');
}
function endJob(msg) {
  if (!job) return;
  job = null;
  jobBeacon.visible = false;
  $('#job').hidden = true;
  if (msg) hud.toast(msg, 1600);
}
function jobTick(dt, focus) {
  if (!job) return;
  const T = job.target;
  const reach = driving ? 7 : 3.5;
  if (Math.hypot(focus.x - T.x, focus.z - T.z) < reach && Math.abs(focus.y - T.y) < 4) {
    if (job.stage === 'pickup') {
      const drop = pickSpot(T, 380, 900);
      if (!drop) { endJob('No drop-off found'); return; }
      const dist = Math.hypot(drop.x - T.x, drop.z - T.z);
      job = { stage: 'deliver', target: drop, time: Math.round(dist / 7 + 25), dist };
      jobBeacon.position.set(drop.x, drop.y, drop.z);
      sound.pickup();
      hud.toast('Parcel picked up', 1000);
    } else {
      const pay = Math.round(150 + job.dist / 3 + job.time * 5);
      stats.jobs++;
      addCash(pay);
      particles.confetti(focus.x, focus.y + 1.5, focus.z);
      sound.finish();
      endJob(`Delivered! +$${pay}  ·  J for another job`);
      return;
    }
  }
  if (job.stage === 'deliver') {
    job.time -= dt;
    if (job.time <= 0) { endJob('Too late. Job failed'); return; }
  }
  const J = job.target;
  $('#job-text').textContent = job.stage === 'pickup' ? `Pick up the parcel · ${J.name}` : `Deliver to ${J.name}`;
  $('#job-time').textContent = job.time == null ? `${Math.round(Math.hypot(focus.x - J.x, focus.z - J.z))} m` : `${Math.ceil(job.time)} s`;
  $('#job').classList.toggle('urgent', job.time != null && job.time < 15);
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
  if (job) marks.push({ x: job.target.x, z: job.target.z, color: '#ffd34d', r: 6, ring: true, label: job.stage === 'pickup' ? 'Pick up' : 'Deliver' });
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
function openWorld(dt, realDt) {
  const focus = driving ? driving.pos : player.pos;
  trafficContact(dt);
  carTricks(dt);
  jobTick(dt, focus);
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
    if (driving && driving.kind === 'car') stats.drive += d;
    else if (driving) stats.fly += d;
    else stats.run += d;
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
  try {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `fog-city-rush-${Date.now()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    hud.toast('Photo saved', 1000);
    ach.unlock('photo');
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
  for (const ev of ferries.update(dt)) {
    const d = Math.hypot(ev.x - focus.x, ev.z - focus.z);
    if (d < 900 && state === 'play') sound.shipHorn(Math.min(1, d / 900));
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
  if (!driving && player.onGround && Math.hypot(player.pos.x, player.pos.z) < 12 && player.pos.y > h.balcony.y - 1) ach.unlock('hub-top');
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
        ? (job ? jobBeacon.position : waypoint || (parcels.nearestUncollected(focus) || {}).pos || null) : null), focus,
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
  get countdown() { return countdown; }, weather, ferries, streetcars, ach, traps, togglePhoto, get job() { return job; }, toggleJob, toggleMap, borrowCar, peds, bigmap, addCash, get cash() { return cash; }, combo, D, tour, menuAt: (t) => { menuT = t; }, details, enterVehicle, exitVehicle, sound, particles, ghost, recorder, parcels, sky, S, applySettings, traffic, finish,
};
