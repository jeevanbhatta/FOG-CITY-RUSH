import * as THREE from 'three';

// City events on the City Life calendar. Three things happen on a schedule:
//   Fleet Week air show  Saturdays (day % 7 === 6) 12:00–16:00: a line of glowing rings over the
//                        bay and three jets looping overhead. Fly the seaplane through all eight
//                        rings in order for a prize.
//   Sunday fun run       Sundays (day % 7 === 0) 08:00–11:00: a crowd jogs a five-checkpoint street
//                        route from the hub plaza. Walk through the start arch to race them.
//   Afternoon regatta    every day 14:00–18:00: sailboats loop on open water off the hub. Scenery.
// The clock is the City Life clock: 1 real second = 1 game minute, so a three-hour window is three
// real minutes. Races already under way keep going after their window closes.

const AIR = { day: 6, from: 12 * 60, to: 16 * 60 };
const RUN = { day: 0, from: 8 * 60, to: 11 * 60 };
const SAIL = { from: 14 * 60, to: 18 * 60 };
const RINGS = 8;
const RING_REACH = 25;
const CP_REACH = 6;
const RUNNERS = 25;
const BOATS = 6;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const RUNNER_COLORS = [0xff4fa3, 0x4fd1ff, 0xffd34d, 0x7cff6b, 0xff6a2b, 0x9b5de5, 0xf2efe6, 0x2aa198, 0xe84393, 0x355f7a];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

function mat(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6 }, o)); }
function box(w, h, l, m, x, y, z) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  return b;
}

// A banner arch across the route; text is painted on a canvas so it reads from a distance.
function makeArch(text, color) {
  const g = new THREE.Group();
  const post = mat(0xf2efe6);
  g.add(box(0.5, 5.2, 0.5, post, -4.2, 2.6, 0), box(0.5, 5.2, 0.5, post, 4.2, 2.6, 0));
  let bannerMat = mat(color);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#' + new THREE.Color(color).getHexString();
    x.fillRect(0, 0, 512, 96);
    x.fillStyle = '#ffffff';
    x.font = '900 60px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 256, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    bannerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  }
  g.add(box(9, 1.3, 0.3, bannerMat, 0, 5.4, 0));
  const balloon = [mat(0xff4fa3), mat(0x4fd1ff), mat(0xffd34d)];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), balloon[i % 3]);
    b.position.set(i < 3 ? -4.2 : 4.2, 6.4 + (i % 3) * 0.55, (i % 3 - 1) * 0.35);
    g.add(b);
  }
  return g;
}

// A small fast jet, nose along +Z.
function makeJet(color) {
  const g = new THREE.Group();
  const body = mat(color, { roughness: 0.35, metalness: 0.3 });
  const trim = mat(0x24333d, { roughness: 0.3 });
  g.add(box(1.3, 1.3, 9, body, 0, 0, 0));
  g.add(box(0.9, 0.7, 2, trim, 0, 0.75, 1.8));      // canopy
  g.add(box(8, 0.2, 2.6, body, 0, -0.1, -0.5));     // wings
  g.add(box(3.4, 0.15, 1.3, body, 0, 0, -3.9));     // tailplane
  g.add(box(0.2, 1.9, 1.5, body, 0, 1.1, -3.9));    // fin
  g.scale.setScalar(1.4);
  return g;
}

// A dinghy-sized keelboat: hull, mast, mainsail and jib. Bow along +Z.
function makeBoat(hull, sail, jib) {
  const g = new THREE.Group();
  g.add(box(2.4, 1.0, 8, mat(hull), 0, 0.3, 0));
  g.add(box(1.6, 0.6, 2.4, mat(0xe9e4d8), 0, 1.0, -1.4));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 11, 6), mat(0xb8bcc0, { metalness: 0.5 }));
  mast.position.set(0, 6.3, 0.8);
  g.add(mast);
  const tri = (pts, color) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide }));
  };
  // Sails pivot about the mast so they can swing out to leeward.
  const main = new THREE.Group();
  main.position.set(0, 0, 0.8);
  main.add(tri([0, 1.6, 0, 0, 11.3, 0, 0, 1.6, -4.4], sail));
  const fore = new THREE.Group();
  fore.position.set(0, 0, 0.8);
  fore.add(tri([0, 1.6, 0.2, 0, 9.6, 0.1, 0, 1.4, 3.2], jib));
  g.add(main, fore);
  g.userData.sails = [main, fore];
  return g;
}

// Tiny binary heap of [cost, node] for Dijkstra.
class Heap {
  constructor() { this.c = []; this.n = []; }
  get size() { return this.c.length; }
  push(cost, node) {
    const c = this.c, n = this.n;
    let i = c.length;
    c.push(cost); n.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p]; n[i] = n[p]; i = p;
    }
    c[i] = cost; n[i] = node;
  }
  pop() {
    const c = this.c, n = this.n;
    const top = n[0];
    const lc = c.pop(), ln = n.pop();
    if (c.length) {
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= c.length) break;
        if (k + 1 < c.length && c[k + 1] < c[k]) k++;
        if (c[k] >= lc) break;
        c[i] = c[k]; n[i] = n[k]; i = k;
      }
      c[i] = lc; n[i] = ln;
    }
    return top;
  }
}

export class CityEvents {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene, W, D } = ctx;
    this.saved = Object.assign({ airMsg: 0, runMsg: 0, airPaid: 0, runPaid: 0 }, ctx.store.get('cityEvents') || {});
    this.t = 0;
    this.target = null;   // what we last handed to setTarget
    this.guide = null;    // a "show me" waypoint picked on the phone
    const hub = W.landmarks.hub;
    const [bx, bz] = D.dockDir || [-hub.face[0], -hub.face[1]];
    const bl = Math.hypot(bx, bz) || 1;
    this.bay = [bx / bl, bz / bl];
    this.perp = [-this.bay[1], this.bay[0]];
    this.wasOn = { air: false, run: false, sail: false };

    this.buildAirShow(scene, W);
    this.buildFunRun(scene, W, hub);
    this.buildRegatta(scene, W);
  }

  save() { this.ctx.store.set('cityEvents', this.saved); }

  // ---------- schedule ----------
  minuteOfDay() { return Math.floor(this.ctx.life.s.minute) % 1440; }
  static airDay(day) { return day % 7 === AIR.day; }
  static runDay(day) { return day % 7 === RUN.day; }
  airOn() { const m = this.minuteOfDay(); return CityEvents.airDay(this.ctx.life.s.day) && m >= AIR.from && m < AIR.to; }
  runOn() { const m = this.minuteOfDay(); return CityEvents.runDay(this.ctx.life.s.day) && m >= RUN.from && m < RUN.to; }
  sailOn() { const m = this.minuteOfDay(); return m >= SAIL.from && m < SAIL.to; }

  // ---------- Fleet Week air show ----------
  buildAirShow(scene, W) {
    const [bx, bz] = this.bay, [px, pz] = this.perp;
    const bi = W.landmarks.bridgeInfo;
    // Bridge centreline samples, so the formation stays well clear of the span and towers.
    const bridge = [];
    if (bi) for (let u = -300; u <= 2 * this.ctx.BRIDGE.centreU + 300; u += 60) bridge.push(bi.at(u, 0));
    const layout = (lat0, scale) => {
      const pts = [];
      for (let i = 0; i < RINGS; i++) {
        const t = i / (RINGS - 1);
        const d = 300 + 900 * t * scale;
        const lat = lat0 + 160 * Math.sin(t * Math.PI * 2);
        pts.push(new THREE.Vector3(bx * d + px * lat, 60 + 100 * Math.sin(t * Math.PI), bz * d + pz * lat));
      }
      return pts;
    };
    const clear = (pts) => pts.every((p) => {
      if (W.world.pointBlocked(p.x, p.y, p.z) || W.world.pointBlocked(p.x, p.y + 14, p.z) || W.world.pointBlocked(p.x, p.y - 14, p.z)) return false;
      if (W.world.floorAt(p.x, p.z, p.y + 20, 0).y > p.y - 30) return false;
      return bridge.every(([x, z]) => Math.hypot(x - p.x, z - p.z) > 140);
    });
    let pts = null;
    for (const scale of [1, 0.8, 0.6]) {
      for (const lat of [0, 250, -250, 450, -450]) {
        const p = layout(lat, scale);
        if (clear(p)) { pts = p; break; }
      }
      if (pts) break;
    }
    this.ringPos = pts || layout(0, 1);

    this.air = new THREE.Group();
    this.air.visible = false;
    scene.add(this.air);
    const ringGeo = new THREE.TorusGeometry(12, 1.1, 10, 48);
    const haloGeo = new THREE.TorusGeometry(12, 2.6, 8, 48);
    this.rings = this.ringPos.map((p, i) => {
      const g = new THREE.Group();
      g.position.copy(p);
      const look = this.ringPos[Math.min(RINGS - 1, i + 1)];
      const back = this.ringPos[Math.max(0, i - 1)];
      // Face along the line of flight (towards the next ring, or away from the last).
      g.lookAt(i < RINGS - 1 ? look : p.clone().multiplyScalar(2).sub(back));
      const m = new THREE.MeshBasicMaterial({ color: 0x4fd1ff, fog: false });
      const h = new THREE.MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      g.add(new THREE.Mesh(ringGeo, m), new THREE.Mesh(haloGeo, h));
      this.air.add(g);
      return { g, m, h, pos: p };
    });
    this.ringNext = 0;

    // Jets loop high over the middle of the formation.
    const mid = this.ringPos[RINGS >> 1];
    this.jetCentre = [mid.x, mid.z];
    this.jets = [0xd1495b, 0xf2efe6, 0x2f5fa8].map((c, i) => {
      const g = makeJet(c);
      this.air.add(g);
      return { g, lag: i * 0.035, lat: (i - 1) * 14 };
    });
    this.jetA = 0;
    this.smokeT = 0;
  }

  ringColours() {
    const day = this.ctx.life.s.day;
    const done = this.saved.airPaid === day;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
    this.rings.forEach((r, i) => {
      let c = 0x4fd1ff, s = 1;
      if (done || i < this.ringNext) c = 0x7cff6b;
      else if (i === this.ringNext) { c = 0xffd34d; s = 1 + pulse * 0.12; }
      r.m.color.setHex(c); r.h.color.setHex(c);
      r.h.opacity = 0.18 + (i === this.ringNext && !done ? pulse * 0.25 : 0);
      r.g.scale.setScalar(s);
    });
  }

  updateAir(dt, on) {
    const { ctx } = this;
    const { life, hud, sound } = ctx;
    const day = life.s.day;
    const v = ctx.getDriving && ctx.getDriving();
    const inPlane = !!(v && v.kind === 'plane');
    const flying = inPlane && v.state === 'air';
    // A ring run in progress keeps the rings up past 16:00 so it can be finished.
    const show = on || this.ringNext > 0;
    this.air.visible = show;
    for (const j of this.jets) j.g.visible = on;
    if (!show) { this.ringNext = 0; return null; }

    if (on) {
      this.jetA += dt * 0.22;
      const [cx, cz] = this.jetCentre;
      const R = 320;
      const at = (a, lat) => {
        const r = R + lat;
        return new THREE.Vector3(cx + Math.cos(a) * r, 215 + Math.sin(a * 2) * 45, cz + Math.sin(a) * r);
      };
      this.smokeT -= dt;
      const puff = this.smokeT <= 0;
      if (puff) this.smokeT = 0.035;
      for (const j of this.jets) {
        const a = this.jetA - j.lag;
        const p = at(a, j.lat);
        j.g.position.copy(p);
        j.g.lookAt(at(a + 0.03, j.lat));
        j.g.rotateZ(-0.55); // bank into the turn
        if (puff && ctx.particles) {
          const f = new THREE.Vector3(0, 0, -7).applyQuaternion(j.g.quaternion).add(p);
          ctx.particles.emit(f.x, f.y, f.z, { color: 0xffffff, count: 1, speed: 0.25, up: 0, life: 3.2, size: 2.6, grow: 2.2, drag: 0.6, alpha: 0.55, jitter: 0.8 });
        }
      }
    }

    if (this.saved.airPaid !== day) {
      if (flying) {
        const r = this.rings[this.ringNext];
        if (r && v.pos.distanceTo(r.pos) < RING_REACH) {
          this.ringNext++;
          sound.tone(560 + this.ringNext * 70, 0.14, 'triangle', 0.1, 900 + this.ringNext * 70);
          if (this.ringNext >= RINGS) {
            this.saved.airPaid = day; this.save();
            this.ringNext = 0;
            ctx.addCash(1500);
            hud.toast('Fleet Week: all eight rings! The crowd goes wild  +$1,500', 3000);
            sound.finish();
            life.mood(15);
            life.event('airshow');
          } else hud.toast(`Air show ring ${this.ringNext} / ${RINGS}`, 900);
        }
      } else if (this.ringNext > 0) {
        this.ringNext = 0;
        hud.toast('Ring run broken. Take off again and start from ring 1.', 2000);
      }
    }
    this.ringColours();
    return inPlane && this.saved.airPaid !== day ? this.rings[this.ringNext].pos : null;
  }

  // ---------- Sunday fun run ----------
  buildFunRun(scene, W, hub) {
    const [sx, sz] = hub.plaza;
    const fl = W.world.floorAt(sx, sz, 3, 0);
    this.start = new THREE.Vector3(sx, fl.solid ? fl.y : 0, sz);
    this.route = this.planRoute(W, hub);
    this.run = { racing: false, next: 0, t: 0, idle: false };

    this.runG = new THREE.Group();
    this.runG.visible = false;
    scene.add(this.runG);
    this.arch = makeArch('FUN RUN', 0xff4fa3);
    this.arch.position.copy(this.start);
    this.runG.add(this.arch);
    if (!this.route) return;
    const R = this.route;
    const d0 = this.dirAt(0.5);
    this.arch.rotation.y = Math.atan2(d0[0], d0[1]);
    const last = R.cps[R.cps.length - 1];
    this.finishArch = makeArch('FINISH', 0x2aa198);
    this.finishArch.position.copy(last);
    const d1 = this.dirAt(R.len - 0.5);
    this.finishArch.rotation.y = Math.atan2(d1[0], d1[1]);
    this.runG.add(this.finishArch);
    // Small flag posts mark each checkpoint; a tall beacon marks the next one while you race.
    const flagM = mat(0xff4fa3);
    for (const c of R.cps.slice(0, -1)) {
      const f = new THREE.Group();
      f.add(box(0.12, 3, 0.12, mat(0xf2efe6), 0, 1.5, 0), box(0.05, 0.8, 1.2, flagM, 0, 2.6, 0.6));
      f.position.copy(c);
      this.runG.add(f);
    }
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(CP_REACH * 0.6, CP_REACH * 0.6, 40, 20, 1, true).translate(0, 20, 0),
      new THREE.MeshBasicMaterial({ color: 0xff4fa3, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beacon.visible = false;
    scene.add(this.beacon);

    // Runners: one instanced capsule body and one instanced head.
    const bodyG = new THREE.CapsuleGeometry(0.26, 0.85, 4, 8).translate(0, 0.72, 0);
    const headG = new THREE.SphereGeometry(0.18, 8, 6).translate(0, 1.55, 0);
    this.rBody = new THREE.InstancedMesh(bodyG, mat(0xffffff), RUNNERS);
    this.rHead = new THREE.InstancedMesh(headG, mat(0xffffff), RUNNERS);
    this.rBody.frustumCulled = this.rHead.frustumCulled = false;
    this.rBody.castShadow = true;
    const c = new THREE.Color();
    this.runners = [];
    for (let i = 0; i < RUNNERS; i++) {
      this.rBody.setColorAt(i, c.setHex(RUNNER_COLORS[i % RUNNER_COLORS.length]));
      this.rHead.setColorAt(i, c.setHex(SKIN[(i * 3) % SKIN.length]));
      this.runners.push({ s: 0, speed: 3.5 + Math.random() * 2, lat: (Math.random() - 0.5) * 3, ph: Math.random() * 6 });
    }
    this.runG.add(this.rBody, this.rHead);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.one = new THREE.Vector3(1, 1, 1);
    this.tmp = new THREE.Vector3();
  }

  // Street route: a graph of the road network (roads share nodes at junctions), then five
  // checkpoints on named streets 200–400 m apart, each leg the shortest way along the streets.
  // The legs swing round in a rough loop so the route doesn't double back on itself.
  planRoute(W, hub) {
    const roads = (W.map && W.map.roads) || [];
    const key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
    const idx = new Map();
    const X = [], Z = [], Y = [], named = [], adj = [];
    const node = (x, z, n) => {
      const k = key(x, z);
      let i = idx.get(k);
      if (i === undefined) {
        const f = W.world.floorAt(x, z, 3, 0);
        i = X.length;
        idx.set(k, i);
        X.push(x); Z.push(z); Y.push(f.solid ? f.y : NaN); named.push(false); adj.push([]);
      }
      if (n) named[i] = true;
      return i;
    };
    for (const r of roads) {
      if (/motorway/.test(r.k || '')) continue;
      let prev = -1;
      for (const [x, z] of r.p) {
        const i = node(x, z, !!r.n);
        if (prev >= 0 && prev !== i && !Number.isNaN(Y[i]) && !Number.isNaN(Y[prev])) {
          const d = Math.hypot(X[i] - X[prev], Z[i] - Z[prev]);
          adj[i].push(prev, d); adj[prev].push(i, d);
        }
        prev = i;
      }
    }
    const N = X.length;
    if (N < 10) return null;
    // Footpaths often don't join the street grid, so start on a node of a big connected piece.
    const comp = new Int32Array(N).fill(-1), size = [];
    for (let i = 0; i < N; i++) {
      if (comp[i] >= 0) continue;
      const c = size.length, stack = [i];
      let n = 0;
      comp[i] = c;
      while (stack.length) {
        const u = stack.pop();
        n++;
        const a = adj[u];
        for (let k = 0; k < a.length; k += 2) if (comp[a[k]] < 0) { comp[a[k]] = c; stack.push(a[k]); }
      }
      size.push(n);
    }
    const big = Math.max(...size) * 0.2;
    const [sx, sz] = hub.plaza;
    let start = -1, bd = 160;
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(Y[i]) || size[comp[i]] < big) continue;
      const d = Math.hypot(X[i] - sx, Z[i] - sz);
      if (d < bd) { bd = d; start = i; }
    }
    if (start < 0) return null;
    const dijkstra = (src) => {
      const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
      dist[src] = 0;
      const h = new Heap();
      h.push(0, src);
      while (h.size) {
        const u = h.pop();
        const du = dist[u];
        if (du > 2500) break; // legs are short; no need to flood the whole map
        const a = adj[u];
        for (let k = 0; k < a.length; k += 2) {
          const v = a[k], nd = du + a[k + 1];
          if (nd < dist[v]) { dist[v] = nd; prev[v] = u; h.push(nd, v); }
        }
      }
      return { dist, prev };
    };
    const h0 = Math.atan2(hub.face[1], hub.face[0]); // inland, away from the water
    const cps = [start];
    const path = [[sx, this.start.y, sz]];
    let cur = start;
    for (let leg = 0; leg < 5; leg++) {
      const { dist, prev } = dijkstra(cur);
      const want = h0 + leg * (Math.PI / 3);
      let best = -1, bs = Infinity;
      for (const [lo, hi, ratio] of [[200, 400, 2], [150, 520, 2], [120, 700, 3]]) {
        for (let i = 0; i < N; i++) {
          if (!named[i] || !Number.isFinite(dist[i])) continue;
          const d = Math.hypot(X[i] - X[cur], Z[i] - Z[cur]);
          if (d < lo || d > hi || dist[i] > d * ratio) continue;
          if (cps.some((c) => Math.hypot(X[c] - X[i], Z[c] - Z[i]) < 150)) continue;
          let da = Math.atan2(Z[i] - Z[cur], X[i] - X[cur]) - want;
          da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
          const score = da + (dist[i] / d - 1) * 0.5;
          if (score < bs) { bs = score; best = i; }
        }
        if (best >= 0) break;
      }
      if (best < 0) break;
      const seg = [];
      for (let i = best; i !== cur && i >= 0; i = prev[i]) seg.push(i);
      seg.reverse();
      for (const i of seg) path.push([X[i], Y[i], Z[i]]);
      cps.push(best);
      cur = best;
    }
    if (cps.length < 3) return null;
    // Cumulative distance along the path, and where each checkpoint falls on it.
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]));
    const cpS = [];
    let k = 1;
    for (const c of cps.slice(1)) {
      while (k < path.length && (path[k][0] !== X[c] || path[k][2] !== Z[c])) k++;
      cpS.push(cum[Math.min(k, path.length - 1)]);
    }
    return {
      path, cum, len: cum[cum.length - 1], cpS,
      cps: cps.slice(1).map((c) => new THREE.Vector3(X[c], Y[c], Z[c])),
    };
  }

  // Position and heading along the route at distance s (behind the start line for s < 0).
  posAt(s, out) {
    const R = this.route, p = R.path;
    if (s <= 0) {
      const [dx, dz] = this.dirAt(0.5);
      return out.set(p[0][0] + dx * s, p[0][1], p[0][2] + dz * s);
    }
    s = Math.min(s, R.len);
    let lo = 0, hi = R.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R.cum[m] <= s) lo = m; else hi = m; }
    const a = p[lo], b = p[hi];
    const t = (s - R.cum[lo]) / ((R.cum[hi] - R.cum[lo]) || 1);
    return out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }
  dirAt(s) {
    const R = this.route, p = R.path;
    s = Math.max(0, Math.min(R.len, s));
    let i = 1;
    while (i < R.cum.length - 1 && R.cum[i] < s) i++;
    const dx = p[i][0] - p[i - 1][0], dz = p[i][2] - p[i - 1][2], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  resetRunners(race) {
    this.runners.forEach((r, i) => {
      r.speed = 3.5 + Math.random() * 2;
      if (race) { r.s = -1 - Math.floor(i / 5) * 1.3; r.lat = ((i % 5) - 2) * 1.1; }
      else { r.s = -30 + Math.random() * (this.route.len + 30); r.lat = (Math.random() - 0.5) * 3; }
    });
  }

  updateRun(dt, on) {
    const { ctx } = this;
    const { life, hud, sound, player } = ctx;
    const day = life.s.day;
    const run = this.run;
    const show = on || run.racing;
    this.runG.visible = show;
    if (this.beacon) this.beacon.visible = run.racing;
    if (!show) { run.idle = false; return null; }
    if (!this.route) return null;
    const R = this.route;
    if (!run.idle && !run.racing) { this.resetRunners(false); run.idle = true; }

    // Runners jog; idle ones that finish start again from the back of the crowd.
    const pos = this.tmp;
    for (let i = 0; i < RUNNERS; i++) {
      const r = this.runners[i];
      r.s += r.speed * dt;
      r.ph += dt * r.speed * 2.6;
      if (!run.racing && r.s > R.len + 20) { r.s = -10 - Math.random() * 25; r.speed = 3.5 + Math.random() * 2; }
      if (r.s > R.len + 2) { this.m4.makeScale(0, 0, 0); this.rBody.setMatrixAt(i, this.m4); this.rHead.setMatrixAt(i, this.m4); continue; }
      const [dx, dz] = this.dirAt(r.s);
      this.posAt(r.s, pos);
      pos.x += -dz * r.lat; pos.z += dx * r.lat;
      pos.y += Math.abs(Math.sin(r.ph)) * 0.12;
      this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
      this.m4.compose(pos, this.q, this.one);
      this.rBody.setMatrixAt(i, this.m4);
      this.rHead.setMatrixAt(i, this.m4);
    }
    this.rBody.instanceMatrix.needsUpdate = this.rHead.instanceMatrix.needsUpdate = true;

    const onFoot = !(ctx.getDriving && ctx.getDriving());
    const p = player.pos;
    if (!run.racing) {
      if (!on) return null;
      const d = Math.hypot(p.x - this.start.x, p.z - this.start.z);
      if (this.saved.runPaid === day) {
        if (d < 14 && onFoot) ctx.setPrompt('You ran today’s fun run. Same time next Sunday!');
        return null;
      }
      if (d < 20 && onFoot) ctx.setPrompt('Walk through the start arch to join the fun run');
      if (d < 8 && onFoot && Math.abs(p.y - this.start.y) < 4) {
        run.racing = true; run.next = 0; run.t = 0; run.idle = false;
        this.resetRunners(true);
        hud.toast(`Fun run: go! ${R.cps.length} checkpoints, ${(R.len / 1000).toFixed(1)} km`, 2200);
        sound.tone(880, 0.25, 'square', 0.08);
      }
      return null;
    }

    // Racing.
    run.t += dt;
    const cp = R.cps[run.next];
    this.beacon.position.copy(cp);
    if (!onFoot) return this.endRun('Fun run: runners only, no vehicles. You’re out.');
    if (Math.hypot(p.x - cp.x, p.z - cp.z) > 900) return this.endRun('Fun run: you strayed too far off the route.');
    if (Math.hypot(p.x - cp.x, p.z - cp.z) < CP_REACH && Math.abs(p.y - cp.y) < 4) {
      const prog = R.cpS[run.next];
      const ahead = this.runners.filter((r) => r.s > prog).length;
      run.next++;
      if (run.next >= R.cps.length) {
        const beaten = RUNNERS - ahead;
        const pay = 300 + 50 * beaten;
        this.saved.runPaid = day; this.save();
        ctx.addCash(pay);
        hud.toast(`Fun run finished ${ordinal(ahead + 1)} of ${RUNNERS + 1} in ${Math.floor(run.t / 60)}:${String(Math.floor(run.t % 60)).padStart(2, '0')}  +$${pay}`, 3200);
        sound.finish();
        life.mood(10);
        life.event('funrun');
        if (ctx.particles) ctx.particles.confetti(cp.x, cp.y + 2, cp.z);
        run.racing = false;
        run.idle = true; // the crowd carries on round behind you
        return null;
      }
      sound.chime();
      hud.toast(`Checkpoint ${run.next} / ${R.cps.length} · you're ${ordinal(ahead + 1)} of ${RUNNERS + 1}`, 1600);
    }
    return R.cps[run.next];
  }

  endRun(msg) {
    this.run.racing = false;
    this.run.idle = true;
    this.ctx.hud.toast(msg, 2200);
    return null;
  }

  // ---------- afternoon regatta ----------
  buildRegatta(scene, W) {
    const [bx, bz] = this.bay, [px, pz] = this.perp;
    const RA = 150, RB = 75;
    const water = (cx, cz) => {
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        for (const m of [0, 30]) {
          const ca = Math.cos(a) * (RA + m), sb = Math.sin(a) * (RB + m);
          const x = cx + bx * ca + px * sb, z = cz + bz * ca + pz * sb;
          if (W.world.floorAt(x, z, 5, 0).solid || W.world.pointBlocked(x, 1, z) || W.world.pointBlocked(x, 8, z)) return false;
        }
      }
      return true;
    };
    // Off to one side of the hub so the ferry lanes (straight out, ~140 m either side) stay clear.
    let centre = null;
    for (const d of [450, 650, 300, 850, 1100]) {
      for (const lat of [320, -320, 480, -480, 650, -650]) {
        const cx = bx * d + px * lat, cz = bz * d + pz * lat;
        if (water(cx, cz)) { centre = [cx, cz]; break; }
      }
      if (centre) break;
    }
    this.sail = { centre, RA, RB };
    this.boats = [];
    if (!centre) return;
    const hulls = [0xf2efe6, 0x1f3440, 0xf2efe6, 0x8a1f1f, 0xf2efe6, 0x355f7a];
    const sails = [0xffffff, 0xffffff, 0xff6a2b, 0xffffff, 0x4fd1ff, 0xffd34d];
    const jibs = [0xd1495b, 0x4fd1ff, 0xffffff, 0xffd34d, 0xffffff, 0xff4fa3];
    for (let i = 0; i < BOATS; i++) {
      const g = makeBoat(hulls[i], sails[i], jibs[i]);
      g.visible = false;
      scene.add(g);
      this.boats.push({ g, a: (i / BOATS) * Math.PI * 2, v: 5.5 + Math.random() * 1.5, x: 0, z: 0, k: i });
    }
  }

  updateSail(dt, on) {
    for (const b of this.boats) b.g.visible = on;
    if (!on || !this.boats.length) return;
    const { centre: [cx, cz], RA, RB } = this.sail;
    const [bx, bz] = this.bay, [px, pz] = this.perp;
    for (const b of this.boats) {
      const ca = Math.cos(b.a), sa = Math.sin(b.a);
      // Angular speed from the boat's speed along the ellipse at this point.
      const tl = Math.hypot(RA * sa, RB * ca) || 1;
      b.a += (b.v / tl) * dt;
      const x = cx + bx * RA * ca + px * RB * sa, z = cz + bz * RA * ca + pz * RB * sa;
      const tx = -bx * RA * sa + px * RB * ca, tz = -bz * RA * sa + pz * RB * ca;
      b.x = x; b.z = z;
      const heel = 0.16 + 0.06 * Math.sin(this.t * 0.7 + b.k * 1.3);
      b.g.position.set(x, -1.55 + Math.sin(this.t * 1.1 + b.k) * 0.12, z);
      b.g.rotation.set(Math.sin(this.t * 0.9 + b.k * 2) * 0.03, Math.atan2(tx, tz), heel);
      // Sails eased out to leeward (the boats turn the same way round, so it's always one side).
      b.g.userData.sails[0].rotation.y = -0.35 + Math.sin(this.t * 0.5 + b.k) * 0.05;
      b.g.userData.sails[1].rotation.y = -0.15;
    }
  }

  // ---------- messages ----------
  notify(from, title, text) {
    const { life, hud } = this.ctx;
    life.s.inbox.unshift({ from, title, text, day: life.s.day, clock: life.clock, unread: true });
    life.s.inbox = life.s.inbox.slice(0, 30);
    hud.toast(`${title} today · P for phone`, 2600);
    // Light the phone badge the same way main.js does for story messages.
    if (typeof document !== 'undefined') { const b = document.getElementById('phone-badge'); if (b) b.hidden = false; }
  }

  messages() {
    const s = this.ctx.life.s, m = this.minuteOfDay();
    if (CityEvents.airDay(s.day) && this.saved.airMsg !== s.day && m >= 7 * 60 + 20 && m < AIR.to) {
      this.saved.airMsg = s.day; this.save();
      this.notify('mei', 'Fleet Week air show', `Fleet Week air show over the bay, ${hhmm(AIR.from)}–${hhmm(AIR.to)}. The organisers hung eight rings out over the water. Take the seaplane up and thread all eight in order: there's $1,500 in it.`);
    }
    if (CityEvents.runDay(s.day) && this.saved.runMsg !== s.day && m >= 7 * 60 + 15 && m < RUN.to) {
      this.saved.runMsg = s.day; this.save();
      this.notify('theo', 'Sunday fun run', `Fun run from the plaza, ${hhmm(RUN.from)}–${hhmm(RUN.to)}. Walk through the start arch and race the crowd. $300, plus $50 for everyone you beat.`);
    }
  }

  // ---------- per frame ----------
  update(dt, ctx = this.ctx) {
    this.ctx = ctx;
    this.t += dt;
    this.messages();
    const air = this.airOn(), run = this.runOn(), sail = this.sailOn();
    if (air && !this.wasOn.air) ctx.hud.toast('Fleet Week air show is on over the bay', 2200);
    if (run && !this.wasOn.run) ctx.hud.toast('The Sunday fun run is starting at the plaza', 2200);
    if (sail && !this.wasOn.sail && this.boats.length) ctx.hud.toast('Afternoon regatta out on the bay', 1800);
    this.wasOn = { air, run, sail };

    const ringT = this.updateAir(dt, air);
    const runT = this.updateRun(dt, run);
    this.updateSail(dt, sail);

    // The phone's "show me" waypoint lasts until you get there or the event is over.
    if (this.guide) {
      const f = ctx.getDriving && ctx.getDriving() ? ctx.getDriving().pos : ctx.player.pos;
      const live = this.guide.ev === 'air' ? air : this.guide.ev === 'run' ? run : sail;
      if (!live || Math.hypot(f.x - this.guide.pos.x, f.z - this.guide.pos.z) < 30) this.guide = null;
    }
    const want = runT || ringT || (this.guide && this.guide.pos) || null;
    if (want !== this.target) { this.target = want; ctx.setTarget(want); }
  }

  // Going to bed calls off anything in progress.
  onEvent(name) {
    if (name !== 'sleep') return;
    this.run.racing = false;
    this.ringNext = 0;
    this.guide = null;
    if (this.target) { this.target = null; this.ctx.setTarget(null); }
  }

  // ---------- phone, map, hints ----------
  schedule(day) {
    const out = [];
    if (CityEvents.runDay(day) && this.route) out.push({ ev: 'run', name: 'Sunday fun run', from: RUN.from, to: RUN.to, where: 'Start arch at the plaza', paid: this.saved.runPaid === day });
    if (CityEvents.airDay(day)) out.push({ ev: 'air', name: 'Fleet Week air show', from: AIR.from, to: AIR.to, where: 'Over the bay · fly the rings', paid: this.saved.airPaid === day });
    if (this.boats.length) out.push({ ev: 'sail', name: 'Afternoon regatta', from: SAIL.from, to: SAIL.to, where: 'Sailboats off the waterfront' });
    return out;
  }

  phoneHtml() {
    const day = this.ctx.life.s.day, m = this.minuteOfDay();
    const row = (e, today) => {
      const now = today && m >= e.from && m < e.to;
      const over = today && m >= e.to;
      const state = e.paid ? 'Done ✓' : now ? 'On now' : over ? 'Over' : today ? `Starts ${hhmm(e.from)}` : 'Tomorrow';
      return `<li class="${over || e.paid ? 'done' : ''}"><span class="who" style="color:${now ? '#ff4fa3' : '#1f3440'}">${e.name}</span>`
        + `<span>${hhmm(e.from)}–${hhmm(e.to)} · ${e.where}</span><span class="meta">${today ? 'Today' : DAY_NAMES[(day + 1) % 7]} · ${state}</span>`
        + (now && !e.paid ? `<button class="btn ghost" data-ev="${e.ev}">Show me</button>` : '') + '</li>';
    };
    const items = [...this.schedule(day).map((e) => row(e, true)), ...this.schedule(day + 1).map((e) => row(e, false))];
    const nextIn = (d) => { for (let k = 0; k < 7; k++) if ((day + k) % 7 === d) return k; return 0; };
    const na = nextIn(AIR.day), nr = nextIn(RUN.day);
    const later = [];
    if (na > 1) later.push(`air show ${DAY_NAMES[AIR.day]} (in ${na} days)`);
    if (nr > 1 && this.route) later.push(`fun run ${DAY_NAMES[RUN.day]} (in ${nr} days)`);
    if (later.length) items.push(`<li class="meta">Coming up: ${later.join(' · ')}</li>`);
    return `<div class="ph-sec"><span class="label">City events · ${DAY_NAMES[day % 7]}</span><ul class="ph-list">${items.join('')}</ul></div>`;
  }

  // Phone "Show me" buttons carry data-ev="air" | "run" | "sail". Returns 'close' to shut the phone.
  onPhoneClick(target) {
    const ev = target && target.dataset && target.dataset.ev;
    if (!ev) return undefined;
    let pos = null;
    if (ev === 'air') pos = this.rings[0].pos;
    if (ev === 'run') pos = this.start;
    if (ev === 'sail' && this.boats.length) pos = new THREE.Vector3(this.sail.centre[0], 0, this.sail.centre[1]);
    if (!pos) return undefined;
    this.guide = { ev, pos };
    this.ctx.hud.toast('Waypoint set', 900);
    return 'close';
  }

  mapMarks() {
    const marks = [];
    if (this.air.visible) {
      this.rings.forEach((r, i) => marks.push({ x: r.pos.x, z: r.pos.z, color: i === this.ringNext ? '#ffd34d' : '#4fd1ff', r: 3, ring: i === this.ringNext, label: i === 0 ? 'Air show rings' : undefined }));
    }
    if (this.runG.visible) {
      marks.push({ x: this.start.x, z: this.start.z, color: '#ff4fa3', r: 5, ring: true, label: 'Fun run start' });
      if (this.route) this.route.cps.forEach((c, i) => {
        const next = this.run.racing && i === this.run.next;
        marks.push({ x: c.x, z: c.z, color: next ? '#ffd34d' : '#ff4fa3', r: next ? 5 : 3, ring: next, label: i === this.route.cps.length - 1 ? 'Fun run finish' : undefined });
      });
    }
    this.boats.forEach((b, i) => { if (b.g.visible) marks.push({ x: b.x, z: b.z, color: '#ffffff', r: 3, label: i === 0 ? 'Regatta' : undefined }); });
    return marks;
  }

  hints() {
    const out = [];
    if (this.run.racing && this.route) out.push(['Fun run', `Checkpoint ${this.run.next + 1} / ${this.route.cps.length}`]);
    else if (this.runG.visible && this.saved.runPaid !== this.ctx.life.s.day) {
      const p = this.ctx.player.pos;
      if (Math.hypot(p.x - this.start.x, p.z - this.start.z) < 40) out.push(['Fun run', 'Walk through the start arch to join']);
    }
    const v = this.ctx.getDriving && this.ctx.getDriving();
    if (this.air.visible && v && v.kind === 'plane' && this.saved.airPaid !== this.ctx.life.s.day) {
      out.push(['Air show', `Ring ${this.ringNext + 1} / ${RINGS} · fly through in order`]);
    }
    return out;
  }
}
