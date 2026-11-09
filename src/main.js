import * as THREE from 'three';
import { buildWorld, BRIDGE } from './world.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud, fmtTime } from './hud.js';
import { defineCourses, resolveCourse, CourseRunner } from './courses.js';
import { fallbackMap } from './fallback-map.js';

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
  ? 'Generated stand-in layout. Real map data loads once data/embarcadero.json is built.'
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

const courses = defineCourses(W).map((c) => resolveCourse(c, W.world));

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

function startCourse(c) {
  active = c;
  runner.start(c);
  spawnAt(c.pts[0], c.pts[1]);
  hud.setCourse(c.name, store.get('best.' + c.id));
  state = 'countdown';
  countdown = 3.0;
  showScreen(null);
  hud.show(true);
  input.enabled = true;
  lockPointer();
}

function startFree() {
  active = null;
  runner.clear();
  const p = W.landmarks.ferry.plaza;
  spawnAt(new THREE.Vector3(p[0], 0, p[1]), new THREE.Vector3(0, 0, 0));
  hud.setCourse('Free roam', null);
  state = 'play';
  showScreen(null);
  hud.show(true);
  input.enabled = true;
  hud.toast('Free roam: climb anything orange', 2200);
  lockPointer();
}

function toMenu() {
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
});

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
      player.update(dt, { ...input, move: { x: 0, y: 0 }, jumpHit: false, slideHit: false, grabHit: false, jump: false, sprint: false, touchMove: input.touchMove }, rig.yaw);
    } else if (state === 'play') {
      player.update(dt, input, rig.yaw);
      const ev = runner.update(dt, player);
      if (ev === 'checkpoint') hud.toast(`Checkpoint ${runner.index - 1} · ${fmtTime(runner.time)}`);
      if (ev === 'finish') finish();
      for (const e of player.events) if (e !== 'Climb' && e !== 'Mantle') hud.toast(e, 700);
      player.events.length = 0;
      if (player.pos.y < -1.4) {
        const back = active ? runner.respawn : player.safe;
        const next = active ? runner.next : null;
        spawnAt(back.clone(), next);
        hud.toast('Splash! Back on dry land', 1400);
      }
    }
    if (state !== 'paused') rig.update(dt, player, look);
    sun.target.position.copy(player.pos);
    hud.update({ player, runner, camera, next: runner.next });
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
window.__fcr = { W, player, rig, courses, runner, startCourse, startFree, input, camera, renderer, scene };
