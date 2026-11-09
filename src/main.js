import * as THREE from 'three';
import { buildWorld, BRIDGE } from './world.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud, fmtTime } from './hud.js';
import { defineCourses, resolveCourse, CourseRunner } from './courses.js';
import { fallbackMap } from './fallback-map.js';
import { Car, Seaplane, findParking, findWater } from './vehicles.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const isTouch = matchMedia('(pointer: coarse)').matches;

const store = {
  get(k) { try { const v = localStorage.getItem('fcr.' + k); return v == null ? null : JSON.parse(v); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem('fcr.' + k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
};

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.25 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !isTouch;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const FOG = 0xcdd5d8;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 70, 1150);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4000);

scene.add(new THREE.HemisphereLight(0xdfe7ec, 0x8b8273, 1.25));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -80; sc.right = sc.top = 80; sc.near = 10; sc.far = 500;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(-120, 210, 90);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- load the map ----------
const loading = $('#loading');
async function loadMap() {
  try {
    const res = await fetch('data/embarcadero.json');
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn('Using generated map:', e);
    return fallbackMap();
  }
}

const map = await loadMap();
$('#attribution').textContent = map.meta.generated
  ? 'Generated stand-in layout'
  : '© OpenStreetMap contributors';

const W = buildWorld(map, scene);
const player = new Player(W.world, scene);
const rig = new CameraRig(camera, W.world);
const input = new Input(canvas, $('#touch'));
const hud = new Hud();
const runner = new CourseRunner(scene);

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
let invertFlight = !!store.get('invertFlight');

const courses = defineCourses(W, V).map((c) => resolveCourse(c, W.world));

// ---------- game state ----------
let state = 'menu';
let active = null; // course or null for free roam
let countdown = 0;
let menuT = 0;

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
  hud.toast(v.kind === 'plane' ? 'Shift for throttle, W to climb' : 'W to drive, Space to drift', 1800);
}

function exitVehicle() {
  const v = driving;
  if (!v) return;
  if (v.kind === 'plane' && v.state === 'air') { hud.toast('Land first', 900); return; }
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

function startCourse(c) {
  if (driving) exitVehicle();
  active = c;
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
  state = 'countdown';
  countdown = 3.0;
  showScreen(null);
  hud.show(true);
  input.enabled = true;
  lockPointer();
}

function startFree() {
  if (driving) exitVehicle();
  active = null;
  runner.clear();
  const p = W.landmarks.ferry.plaza;
  spawnAt(new THREE.Vector3(p[0], 0, p[1]), new THREE.Vector3(0, 0, 0));
  hud.setCourse('Free roam', null);
  state = 'play';
  showScreen(null);
  hud.show(true);
  input.enabled = true;
  hud.toast('Free roam: climb anything orange, press F at a car or the seaplane', 2600);
  lockPointer();
}

function toMenu() {
  if (driving) exitVehicle();
  state = 'menu';
  runner.clear();
  hud.show(false);
  input.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  renderMenu();
  showScreen('#menu');
}

function pause() {
  if (state !== 'play' && state !== 'countdown') return;
  state = 'paused';
  input.enabled = false;
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
  if (document.pointerLockElement) document.exitPointerLock();
  const t = runner.time;
  const key = 'best.' + active.id;
  const prev = store.get(key);
  const isBest = prev == null || t < prev;
  if (isBest) store.set(key, t);
  const m = active.medals;
  const medal = t <= m.gold ? 'Gold' : t <= m.silver ? 'Silver' : t <= m.bronze ? 'Bronze' : null;
  $('#res-course').textContent = active.name;
  $('#res-time').textContent = fmtTime(t);
  $('#res-medal').textContent = medal ? `${medal} medal` : `No medal. Bronze is ${fmtTime(m.bronze)}`;
  $('#res-medal').dataset.medal = (medal || 'none').toLowerCase();
  $('#res-best').textContent = isBest ? (prev == null ? 'First finish recorded' : `New best, ${fmtTime(prev - t)} faster`) : `Best ${fmtTime(prev)}`;
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
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="course" id="course-${c.id}" data-i="${i}">
        <span class="c-head"><span class="c-name">${c.name}</span><span class="c-diff" data-d="${c.difficulty.toLowerCase()}">${c.difficulty}</span></span>
        <span class="c-blurb">${c.blurb}</span>
        <span class="c-meta">
          <span>${(c.length / 1000).toFixed(2)} km · ${c.pts.length - 1} rings</span>
          <span>Gold ${fmtTime(m.gold)}</span>
          <span class="c-best ${medal}">${best != null ? 'Best ' + fmtTime(best) : 'Not run yet'}</span>
        </span>
      </button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button.course').forEach((b) => b.addEventListener('click', () => startCourse(courses[+b.dataset.i])));
}

$('#btn-free').addEventListener('click', startFree);
$('#btn-resume').addEventListener('click', resume);
$('#btn-restart').addEventListener('click', () => (active ? startCourse(active) : startFree()));
$('#btn-menu').addEventListener('click', toMenu);
$('#btn-retry').addEventListener('click', () => startCourse(active));
$('#btn-results-menu').addEventListener('click', toMenu);
$('#btn-pause').addEventListener('click', pause);

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
    invertFlight = !invertFlight;
    store.set('invertFlight', invertFlight);
    if (state === 'play') hud.toast(invertFlight ? 'Flight: W dives' : 'Flight: W climbs', 1200);
  }
});

// ---------- vehicles each frame ----------
let stallToast = 0;
function stepVehicle(dt, frozen) {
  const v = driving;
  const mv = frozen ? { x: 0, y: 0 } : input.move;
  if (v.kind === 'car') {
    v.update(dt, { throttle: mv.y, steer: mv.x, handbrake: !frozen && input.handbrake }, W.world);
    if (v.impact > 12) hud.toast('Crunch', 500);
    if (v.pos.y < -1.4) {
      const back = active ? runner.respawn : v.home.pos;
      resetVehicleAt(v, back, active ? runner.next : null, false);
      hud.toast('The car went for a swim', 1400);
    }
  } else {
    const pitchIn = (invertFlight ? -1 : 1) * mv.y;
    const thr = frozen ? 0 : (input.throttleUp ? 1 : 0) - (input.throttleDown ? 1 : 0);
    v.update(dt, { pitch: pitchIn, bank: mv.x, throttleDelta: thr }, W.world, elapsed);
    for (const e of v.events) {
      if (e.startsWith('crash:')) hud.toast(e.slice(6), 1600);
      else if (e === 'Stall') { if (elapsed - stallToast > 2) { hud.toast('Stall! Nose down', 900); stallToast = elapsed; } }
      else if (e === 'respawn') {
        const idx = active ? runner.index - 1 : 0;
        if (active && idx > 0) resetVehicleAt(v, runner.respawn.clone().setY(Math.max(30, runner.respawn.y)), runner.next, true);
        else v.resetToDock();
        rig.yaw = v.heading + Math.PI;
      } else hud.toast(e, 900);
    }
  }
  player.pos.copy(v.pos);
}

// ---------- main loop ----------
let last = performance.now();
let elapsed = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;
  W.update(dt, elapsed);

  if (state === 'menu') {
    menuT += dt * 0.05;
    const r = 210;
    camera.position.set(Math.sin(menuT) * r, 70 + Math.sin(menuT * 0.7) * 12, Math.cos(menuT) * r);
    camera.lookAt(0, 38, 0);
    sun.target.position.set(0, 0, 0);
  } else {
    input.update();
    const look = input.enabled ? input.consumeLook() : [0, 0];
    if (state === 'countdown') {
      countdown -= dt;
      hud.countdown(countdown > 0 ? String(Math.ceil(countdown)) : 'Go');
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
        for (const e of player.events) if (e !== 'Climb' && e !== 'Mantle') hud.toast(e, 700);
        player.events.length = 0;
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
      const ev = runner.update(dt, focus);
      if (ev === 'checkpoint') hud.toast(`Checkpoint ${runner.index - 1} · ${fmtTime(runner.time)}`);
      if (ev === 'finish') finish();
    }
    for (const v of vehicles()) if (v !== driving && v.kind === 'plane' && v.state === 'water') v.pos.y = -1.45 + Math.sin(elapsed * 1.7) * 0.05, v.sync(dt, elapsed);
    if (state !== 'paused') {
      if (driving) {
        const plane = driving.kind === 'plane';
        rig.updateChase(dt, driving.pos, driving.heading, driving.speed, look, plane
          ? { height: 3.2, dist: 15, speedDist: 0.12, maxExtra: 8, pitch: 0.18, fovScale: 0.45, roll: driving.roll }
          : { height: 1.9, dist: 7.5, speedDist: 0.08, maxExtra: 4, pitch: 0.16, fovScale: 0.6 });
      } else {
        rig.update(dt, player, look);
      }
    }
    const focus = driving ? driving.pos : player.pos;
    sun.target.position.copy(focus);
    hud.update({
      runner, camera, next: runner.next, focus,
      speed: driving ? driving.speed : (player.mode === 'zip' ? player.zip.speed : player.speed),
      alt: focus.y,
      throttle: driving && driving.kind === 'plane' ? driving.throttle : null,
      prompt: driving ? null : player.prompt,
    });
  }
  sun.position.copy(sun.target.position).add(SUN_OFF);
  input.endFrame();
  renderer.render(scene, camera);
}

renderMenu();
loading.hidden = true;
showScreen('#menu');
requestAnimationFrame(frame);

// Handy for testing from the console.
window.__fcr = { W, player, rig, courses, runner, startCourse, startFree, input, camera, renderer, scene, V, enterVehicle, exitVehicle };
