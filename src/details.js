import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInSolid } from './physics.js';

// Street-level detail, streamed around the player.
//
// Everything is generated once at load (positions only, plus collision for solid things),
// bucketed into 160 m chunks. Only chunks within `radius` of the camera are drawn:
//  - repeated props (lamps, trees, parked cars, rooftop units…) share one InstancedMesh per
//    part, refilled from the active chunks whenever the active set changes;
//  - flat or one-off pieces (lane markings, crossings, curbs, rails, awnings, parapets,
//    overhead wires) are merged into one mesh per chunk, built on demand and dropped when far.
// Real OpenStreetMap furniture is used where the map has it; generated props fill the gaps.

const CHUNK = 160;
const ckey = (cx, cz) => `${cx},${cz}`;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const DRIVABLE = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk', 'primary_link', 'trunk_link']);
const TREE_ROADS = new Set(['residential', 'tertiary', 'secondary', 'unclassified']);
const PARK_ROADS = new Set(['residential', 'tertiary', 'unclassified', 'secondary']);
const CAR_COLORS = [0xd8d4cc, 0x2f3a44, 0x8a1f1f, 0x355f7a, 0xc9b26a, 0x6b6f73, 0xf2efe6, 0x1f2a24, 0x9c4a24, 0x40506a];
const AWNING_COLORS = ['#a3302a', '#2f5d50', '#1f3440', '#d9a441', '#6b2d5c', '#2a5a8a', '#3c3c3c'];

// ---------- shared prop geometry ----------
function part(geo, mat) { return { geo, mat }; }
function merged(list) { return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))); }
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });

function makeTypes() {
  const metal = M(0x2e3438, { roughness: 0.5, metalness: 0.4 });
  const T = {};
  const at = (g, x, y, z) => g.translate(x, y, z);

  T.lamp = {
    collide: [0.14, 6.5],
    parts: [
      part(merged([at(new THREE.CylinderGeometry(0.08, 0.12, 6.5, 6), 0, 3.25, 0), at(new THREE.BoxGeometry(0.08, 0.08, 1.7), 0, 6.4, 0.8)]), metal),
      part(at(new THREE.BoxGeometry(0.34, 0.14, 0.62), 0, 6.3, 1.55), M(0xfff1d0, { emissive: 0xffd9a0, emissiveIntensity: 0.2 })),
    ],
  };
  T.tree = {
    collide: [0.22, 3],
    parts: [
      part(at(new THREE.CylinderGeometry(0.14, 0.22, 3.2, 6), 0, 1.6, 0), M(0x6b5640, { roughness: 1 })),
      part(at(new THREE.IcosahedronGeometry(1.9, 1).scale(1, 0.85, 1), 0, 4.3, 0), M(0x5f7d4a, { roughness: 0.95, flatShading: true })),
    ],
    colors: true,
  };
  const signalRed = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  const signalGreen = new THREE.MeshBasicMaterial({ color: 0x2bd46a });
  T.signal = {
    collide: [0.14, 4.5],
    parts: [
      part(merged([at(new THREE.CylinderGeometry(0.1, 0.12, 4.4, 6), 0, 2.2, 0), at(new THREE.BoxGeometry(0.1, 0.1, 3.6), 0, 4.3, 1.8), at(new THREE.BoxGeometry(0.36, 1.0, 0.3), 0, 3.75, 3.4)]), M(0x22282c)),
      part(at(new THREE.BoxGeometry(0.2, 0.2, 0.06), 0, 4.05, 3.57), signalRed),
      part(at(new THREE.BoxGeometry(0.2, 0.2, 0.06), 0, 3.5, 3.57), signalGreen),
    ],
  };
  T.signal.red = signalRed; T.signal.green = signalGreen;
  T.hydrant = { parts: [part(merged([at(new THREE.CylinderGeometry(0.14, 0.18, 0.7, 8), 0, 0.35, 0), at(new THREE.SphereGeometry(0.15, 8, 6), 0, 0.72, 0), at(new THREE.BoxGeometry(0.42, 0.08, 0.08), 0, 0.5, 0)]), M(0xc23a2b))] };
  T.bin = { parts: [part(at(new THREE.CylinderGeometry(0.26, 0.22, 0.95, 10), 0, 0.48, 0), M(0x2f4a3a))] };
  T.bench = { parts: [part(merged([at(new THREE.BoxGeometry(1.7, 0.07, 0.45), 0, 0.46, 0), at(new THREE.BoxGeometry(1.7, 0.4, 0.06), 0, 0.78, -0.22), at(new THREE.BoxGeometry(0.06, 0.46, 0.4), -0.75, 0.23, 0), at(new THREE.BoxGeometry(0.06, 0.46, 0.4), 0.75, 0.23, 0)]), M(0x7a5a3a))] };
  T.bike = { parts: [part(merged([0, 0.7, -0.7].map((x) => at(new THREE.TorusGeometry(0.4, 0.03, 4, 10, Math.PI), x, 0.02, 0).rotateY(Math.PI / 2))), metal)] };
  T.bollard = { parts: [part(at(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 8), 0, 0.45, 0), M(0x34383b))] };
  T.water = { parts: [part(at(new THREE.CylinderGeometry(0.2, 0.25, 1.0, 8), 0, 0.5, 0), M(0x6d7478))] };
  T.post = { parts: [part(at(new THREE.BoxGeometry(0.5, 1.1, 0.5), 0, 0.55, 0), M(0x1f4f8a))] };
  T.bus = {
    collideBox: [1.8, 0.85, 2.6],
    parts: [
      part(merged([at(new THREE.BoxGeometry(3.6, 0.12, 1.7), 0, 2.6, 0), at(new THREE.BoxGeometry(0.08, 2.6, 0.08), -1.75, 1.3, -0.8), at(new THREE.BoxGeometry(0.08, 2.6, 0.08), 1.75, 1.3, -0.8), at(new THREE.BoxGeometry(3.4, 0.08, 0.45), 0, 0.48, -0.55)]), metal),
      part(at(new THREE.BoxGeometry(3.5, 2.2, 0.04), 0, 1.4, -0.82), new THREE.MeshStandardMaterial({ color: 0xbfd3dc, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false })),
    ],
  };
  T.car = {
    collideBox: [0.95, 2.15, 1.45],
    colors: true,
    parts: [
      part(at(new THREE.BoxGeometry(1.8, 0.72, 4.2), 0, 0.72, 0), M(0xffffff, { roughness: 0.45, metalness: 0.2 })),
      part(at(new THREE.BoxGeometry(1.6, 0.56, 2.1), 0, 1.34, -0.25), M(0x26323b, { roughness: 0.2, metalness: 0.4 })),
      part(merged([[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]].map(([x, z]) => at(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10).rotateZ(Math.PI / 2), x, 0.34, z))), M(0x17191b)),
    ],
  };
  T.roofunit = {
    parts: [part(at(new THREE.BoxGeometry(1, 1, 1), 0, 0.5, 0), M(0xb7b8b4, { roughness: 0.6, metalness: 0.2 }))],
    colors: true,
  };
  T.fan = { parts: [part(at(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12), 0, 0.06, 0), M(0x4a4f52))] };
  T.tower = {
    parts: [
      part(merged([[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]].map(([x, z]) => at(new THREE.BoxGeometry(0.16, 3, 0.16), x, 1.5, z))), M(0x2a2d30)),
      part(at(new THREE.CylinderGeometry(1.6, 1.6, 2.7, 14), 0, 4.35, 0), M(0x8a6a48, { roughness: 0.95 })),
      part(at(new THREE.ConeGeometry(1.75, 1.0, 14), 0, 6.2, 0), M(0x3a3c3e)),
    ],
  };
  T.antenna = { parts: [part(at(new THREE.CylinderGeometry(0.06, 0.1, 1, 6), 0, 0.5, 0), M(0x9aa0a4, { metalness: 0.6, roughness: 0.4 }))] };
  T.tramPole = { collide: [0.14, 6.2], parts: [part(merged([at(new THREE.CylinderGeometry(0.11, 0.14, 6.2, 6), 0, 3.1, 0), at(new THREE.BoxGeometry(0.08, 0.08, 3.2), 0, 5.9, 1.6)]), M(0x3a4044))] };
  return T;
}

// ---------- the module ----------
export class Details {
  constructor(scene, W, map, opts = {}) {
    this.scene = scene;
    this.world = W.world;
    this.radius = opts.radius || 400;
    this.types = makeTypes();
    this.chunks = new Map();
    this.active = new Set();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    // Spots to keep clear (spawn points, ladder feet, zipline ends…), in a coarse grid.
    this.avoidGrid = new Map();
    for (const a of opts.avoid || []) this.addAvoid(a[0], a[1], a[2]);
    this.trafficRoads = opts.trafficRoads || new Set();
    this.counts = {};
    const t0 = performance.now();
    this.generate(W, map);
    this.genMs = Math.round(performance.now() - t0);
    this.buildInstanced();
  }

  chunkAt(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const k = ckey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = { cx, cz, k, inst: {}, ground: [], solid: [], mesh: null, matrices: null };
      this.chunks.set(k, c);
    }
    return c;
  }

  // Record one prop. sx/sy/sz scale; color is a hex number for types that take colours.
  add(type, x, y, z, rot = 0, sx = 1, sy = 1, sz = 1, color = 0xffffff) {
    const c = this.chunkAt(x, z);
    (c.inst[type] || (c.inst[type] = [])).push(x, y, z, rot, sx, sy, sz, color);
    this.counts[type] = (this.counts[type] || 0) + 1;
    const T = this.types[type];
    if (T.collide) {
      const [r, h] = T.collide;
      this.world.addBox(x, z, 1, 0, r, r, y, y + h * sy, { kind: 'prop', noMantle: true });
    } else if (T.collideBox) {
      const [hw, hl, h] = T.collideBox;
      this.world.addBox(x, z, Math.sin(rot), Math.cos(rot), hl * sz, hw * sx, y, y + h * sy, { kind: 'prop' });
    }
  }

  // Flat rectangle on the ground (markings, curbs, rails): centre, direction, half sizes.
  rect(x, z, dx, dz, hl, hw, y, color) {
    this.chunkAt(x, z).ground.push(x, z, dx, dz, hl, hw, y, y, color.r, color.g, color.b);
  }

  box(x, z, dx, dz, hl, hw, y0, y1, color) {
    this.chunkAt(x, z).solid.push(x, z, dx, dz, hl, hw, y0, y1, color.r, color.g, color.b);
  }

  addAvoid(x, z, r) {
    const k = Math.floor(x / 25) * 100003 + Math.floor(z / 25);
    (this.avoidGrid.get(k) || this.avoidGrid.set(k, []).get(k)).push([x, z, r]);
  }

  clearOf(x, z, r) {
    const gx = Math.floor(x / 25), gz = Math.floor(z / 25);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const l = this.avoidGrid.get((gx + ox) * 100003 + gz + oz);
      if (!l) continue;
      for (const [ax, az, ar] of l) if ((x - ax) ** 2 + (z - az) ** 2 < (r + ar) ** 2) return false;
    }
    return true;
  }

  onStreetLevel(x, z, headroom = 2.5) {
    const fl = this.world.floorAt(x, z, 0.8, 0);
    if (!fl.solid || fl.solid.kind !== 'land' || Math.abs(fl.y) > 0.3) return false;
    return !this.world.pointBlocked(x, 0.5, z) && !this.world.pointBlocked(x, headroom, z);
  }

  generate(W, map) {
    const r = rng(77);
    const white = new THREE.Color('#e9e6dc');
    const world = this.world;
    const pts = map.points || {};
    const roads = map.roads.filter((rd) => DRIVABLE.has(rd.k) && rd.p.length > 1);

    // --- road segments in a grid, and intersections between different roads ---
    const segs = [];
    roads.forEach((rd, ri) => {
      for (let i = 1; i < rd.p.length; i++) {
        const a = rd.p[i - 1], b = rd.p[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.5) continue;
        segs.push({ ri, ax: a[0], az: a[1], bx: b[0], bz: b[1], dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len, len, w: rd.w, k: rd.k });
      }
    });
    const G = 40, grid = new Map();
    for (const s of segs) {
      const x0 = Math.floor(Math.min(s.ax, s.bx) / G), x1 = Math.floor(Math.max(s.ax, s.bx) / G);
      const z0 = Math.floor(Math.min(s.az, s.bz) / G), z1 = Math.floor(Math.max(s.az, s.bz) / G);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx * 100003 + gz;
        (grid.get(k) || grid.set(k, []).get(k)).push(s);
      }
    }
    const inters = [];
    const iGrid = new Map();
    for (const list of grid.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const s1 = list[i], s2 = list[j];
          if (s1.ri === s2.ri) continue;
          const den = s1.dx * s2.dz - s1.dz * s2.dx;
          if (Math.abs(den) < 0.25) continue; // nearly parallel (e.g. two carriageways)
          const qx = s2.ax - s1.ax, qz = s2.az - s1.az;
          const t = (qx * s2.dz - qz * s2.dx) / den, u = (qx * s1.dz - qz * s1.dx) / den;
          if (t < -2 || t > s1.len + 2 || u < -2 || u > s2.len + 2) continue;
          const x = s1.ax + s1.dx * t, z = s1.az + s1.dz * t;
          const gk = Math.floor(x / 12) * 100003 + Math.floor(z / 12);
          let found = null;
          for (let ox = -1; ox <= 1 && !found; ox++) for (let oz = -1; oz <= 1 && !found; oz++) {
            const l = iGrid.get(gk + ox * 100003 + oz);
            if (l) found = l.find((I) => (I.x - x) ** 2 + (I.z - z) ** 2 < 100);
          }
          if (found) {
            if (!found.segs.includes(s1)) found.segs.push(s1);
            if (!found.segs.includes(s2)) found.segs.push(s2);
            continue;
          }
          const I = { x, z, segs: [s1, s2] };
          inters.push(I);
          (iGrid.get(gk) || iGrid.set(gk, []).get(gk)).push(I);
        }
      }
    }
    const nearInter = (x, z, d) => {
      const gk = Math.floor(x / 12), gz = Math.floor(z / 12);
      const span = Math.ceil(d / 12);
      for (let ox = -span; ox <= span; ox++) for (let oz = -span; oz <= span; oz++) {
        const l = iGrid.get((gk + ox) * 100003 + gz + oz);
        if (l && l.some((I) => (I.x - x) ** 2 + (I.z - z) ** 2 < d * d)) return true;
      }
      return false;
    };
    const nearestSeg = (x, z) => {
      const l = grid.get(Math.floor(x / G) * 100003 + Math.floor(z / G)) || [];
      let best = null, bd = Infinity;
      for (const s of l) {
        const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.dx + (z - s.az) * s.dz));
        const d = (x - s.ax - s.dx * t) ** 2 + (z - s.az - s.dz * t) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      return best ? { s: best, d: Math.sqrt(bd) } : null;
    };
    this.intersections = inters.length;
    // True when (x,z) is clear of every road surface by at least `m` metres.
    const offRoad = (x, z, m = 0.4) => {
      const gx = Math.floor(x / G), gz = Math.floor(z / G);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        for (const sg of grid.get((gx + ox) * 100003 + gz + oz) || []) {
          const t = Math.max(0, Math.min(sg.len, (x - sg.ax) * sg.dx + (z - sg.az) * sg.dz));
          const d2 = (x - sg.ax - sg.dx * t) ** 2 + (z - sg.az - sg.dz * t) ** 2;
          const lim = sg.w / 2 + m;
          if (d2 < lim * lim) return false;
        }
      }
      return true;
    };
    const clearOfOtherRoads = (x, z, rd) => {
      const gx = Math.floor(x / G), gz = Math.floor(z / G);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        for (const sg of grid.get((gx + ox) * 100003 + gz + oz) || []) {
          if (roads[sg.ri] === rd) continue;
          const t = Math.max(0, Math.min(sg.len, (x - sg.ax) * sg.dx + (z - sg.az) * sg.dz));
          const lim = sg.w / 2 + 2.5;
          if ((x - sg.ax - sg.dx * t) ** 2 + (z - sg.az - sg.dz * t) ** 2 < lim * lim) return false;
        }
      }
      return true;
    };
    const free = (x, z, headroom, r) => this.onStreetLevel(x, z, headroom) && this.clearOf(x, z, r) && offRoad(x, z);

    // Walk a road's polyline at a fixed spacing, calling fn(x, z, dx, dz).
    const walk = (rd, start, step, fn) => {
      let carry = start;
      for (let i = 1; i < rd.p.length; i++) {
        const a = rd.p[i - 1], b = rd.p[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.01) continue;
        const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
        let d = carry;
        for (; d < len; d += step) fn(a[0] + dx * d, a[1] + dz * d, dx, dz);
        carry = d - len;
      }
    };

    const yellow = new THREE.Color('#e3bf3f'), curb = new THREE.Color('#a29d93');
    const steel = new THREE.Color('#585d62');
    const lampPos = [];
    const farFromLamps = (x, z, d) => !lampPos.some(([lx, lz]) => (lx - x) ** 2 + (lz - z) ** 2 < d * d);

    // --- OpenStreetMap furniture first ---
    const orientTo = (x, z) => {
      const n = nearestSeg(x, z);
      if (!n) return { rot: r() * 6.28, n: null };
      const s = n.s;
      const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.dx + (z - s.az) * s.dz));
      const px = s.ax + s.dx * t, pz = s.az + s.dz * t;
      return { rot: Math.atan2(px - x, pz - z), n, along: Math.atan2(s.dx, s.dz) };
    };
    for (const [x, z] of pts.lamp || []) {
      if (!free(x, z, 6, 1)) continue;
      this.add('lamp', x, 0, z, orientTo(x, z).rot);
      lampPos.push([x, z]);
    }
    for (const [x, z] of pts.tree || []) {
      if (!free(x, z, 4, 1.5)) continue;
      const s = 0.75 + r() * 0.6;
      this.add('tree', x, 0, z, r() * 6.28, s, s, s, new THREE.Color().setHSL(0.24 + r() * 0.08, 0.35, 0.32 + r() * 0.12).getHex());
    }
    const simple = { hydrant: 'hydrant', bin: 'bin', bollard: 'bollard', water: 'water', post: 'post', bike: 'bike', bench: 'bench' };
    for (const [kind, type] of Object.entries(simple)) {
      for (const [x, z] of pts[kind] || []) {
        if (!free(x, z, 1.5, 0.8)) continue;
        const o = orientTo(x, z);
        this.add(type, x, 0, z, type === 'bench' || type === 'bike' ? (o.along ?? o.rot) : o.rot);
      }
    }
    for (const [x, z] of pts.bus || []) {
      const o = orientTo(x, z);
      if (!o.n) continue;
      if (!free(x, z, 3, 3) || !offRoad(x, z, 1.9)) continue;
      this.add('bus', x, 0, z, o.rot + Math.PI);
    }
    const signalAt = new Set();
    for (const [x, z] of pts.signal || []) {
      const gk = Math.floor(x / 12) * 100003 + Math.floor(z / 12);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        for (const I of iGrid.get(gk + ox * 100003 + oz) || []) if ((I.x - x) ** 2 + (I.z - z) ** 2 < 400) signalAt.add(I);
      }
    }
    const haveOsmSignals = (pts.signal || []).length > 0;
    for (const [x, z] of pts.crossing || []) {
      const n = nearestSeg(x, z);
      if (!n || n.d > n.s.w / 2 + 2 || n.s.w < 6) continue;
      const sg = n.s;
      const t = Math.max(0, Math.min(sg.len, (x - sg.ax) * sg.dx + (z - sg.az) * sg.dz));
      const cx = sg.ax + sg.dx * t, cz = sg.az + sg.dz * t;
      const px = -sg.dz, pz = sg.dx;
      const k = Math.floor(sg.w / 1.15);
      for (let i = 0; i < k; i++) {
        const o = -sg.w / 2 + 0.6 + i * 1.15;
        this.rect(cx + px * o, cz + pz * o, sg.dx, sg.dz, 1.4, 0.3, 0.085, white);
      }
    }

    // --- intersections: crossings, signals, bins ---
    for (const I of inters) {
      const ws = I.segs.map((s) => s.w);
      const maxHalf = Math.max(...ws) / 2;
      const major = I.segs.filter((s) => ['primary', 'secondary', 'tertiary', 'trunk'].includes(s.k)).length;
      for (const s of (pts.crossing && pts.crossing.length > 100) ? [] : I.segs) {
        if (s.w < 7) continue;
        const others = I.segs.filter((o) => o.ri !== s.ri);
        const oh = others.length ? Math.max(...others.map((o) => o.w)) / 2 : maxHalf;
        for (const side of [-1, 1]) {
          const cx = I.x + s.dx * side * (oh + 2.2), cz = I.z + s.dz * side * (oh + 2.2);
          const fl = world.floorAt(cx, cz, 0.8, 0);
          if (!fl.solid || fl.solid.kind !== 'land') continue;
          // Zebra stripes run along the road, repeated across its width.
          const px = -s.dz, pz = s.dx;
          const n = Math.floor(s.w / 1.15);
          for (let i = 0; i < n; i++) {
            const o = -s.w / 2 + 0.6 + i * 1.15;
            this.rect(cx + px * o, cz + pz * o, s.dx, s.dz, 1.4, 0.3, 0.085, white);
          }
        }
      }
      const isSignal = haveOsmSignals ? signalAt.has(I) : major >= 2;
      if (I.segs.length >= 2) {
        const a = I.segs[0], b = I.segs.find((s) => s.ri !== a.ri) || I.segs[1];
        const corners = [[1, 1], [-1, -1], [1, -1], [-1, 1]];
        corners.forEach(([sa, sb], ci) => {
          const x = I.x + a.dx * sa * (b.w / 2 + 1.6) + b.dx * sb * (a.w / 2 + 1.6);
          const z = I.z + a.dz * sa * (b.w / 2 + 1.6) + b.dz * sb * (a.w / 2 + 1.6);
          if (!free(x, z, 4.5, 1.5)) return;
          const rot = Math.atan2(I.x - x, I.z - z);
          if (isSignal && ci < 2) this.add('signal', x, 0, z, rot - Math.PI / 4);
          else if (ci === 2 && r() < 0.45) this.add('bin', x + 0.8, 0, z, 0);
          else if (ci === 3 && r() < 0.3) this.add('hydrant', x, 0, z, rot);
        });
      }
    }

    // --- along every street ---
    const embarcadero = (rd) => rd.n && /embarcadero/i.test(rd.n);
    for (const rd of roads) {
      const hw = rd.w / 2;
      // Centre dashes and curbs.
      if (rd.w >= 8) {
        const col = rd.w >= 11 ? yellow : white;
        walk(rd, 4, 9, (x, z, dx, dz) => {
          if (!nearInter(x, z, hw + 6)) this.rect(x, z, dx, dz, 1.5, 0.08, 0.085, col);
        });
      }
      walk(rd, 1, 4, (x, z, dx, dz) => {
        if (nearInter(x, z, hw + 4)) return;
        for (const side of [-1, 1]) this.rect(x - dz * side * hw, z + dx * side * hw, dx, dz, 2.05, 0.16, 0.075, curb);
      });
      // Street lamps, both sides, staggered.
      if (rd.w >= 7 && !(pts.lamp && pts.lamp.length > 400)) {
        walk(rd, 8 + r() * 10, 30, (x, z, dx, dz) => {
          for (const side of [-1, 1]) {
            const lx = x - dz * side * (hw + 1.1), lz = z + dx * side * (hw + 1.1);
            if (nearInter(lx, lz, 9) || !farFromLamps(lx, lz, 14) || !this.clearOf(lx, lz, 1.5)) continue;
            if (!this.onStreetLevel(lx, lz, 6.5) || !offRoad(lx, lz)) continue;
            this.add('lamp', lx, 0, lz, Math.atan2(dz * side, -dx * side));
            lampPos.push([lx, lz]);
          }
        });
      }
      // Street trees on smaller streets.
      if (TREE_ROADS.has(rd.k) && !embarcadero(rd)) {
        walk(rd, 6 + r() * 6, 13, (x, z, dx, dz) => {
          for (const side of [-1, 1]) {
            if (r() > 0.5) continue;
            const tx = x - dz * side * (hw + 2.3), tz = z + dx * side * (hw + 2.3);
            if (nearInter(tx, tz, 10) || !farFromLamps(tx, tz, 4) || !this.clearOf(tx, tz, 2)) continue;
            if (!this.onStreetLevel(tx, tz, 4.5) || !offRoad(tx, tz, 0.6)) continue;
            const s = 0.7 + r() * 0.5;
            this.add('tree', tx, 0, tz, r() * 6.28, s, s, s, new THREE.Color().setHSL(0.22 + r() * 0.1, 0.32, 0.3 + r() * 0.14).getHex());
          }
        });
      }
      // Hydrants every block or so.
      if (!(pts.hydrant && pts.hydrant.length > 200)) {
        walk(rd, 20 + r() * 40, 85, (x, z, dx, dz) => {
          const side = r() < 0.5 ? -1 : 1;
          const hx = x - dz * side * (hw + 0.6), hz = z + dx * side * (hw + 0.6);
          if (free(hx, hz, 1.2, 1)) this.add('hydrant', hx, 0, hz, 0);
        });
      }
      // Parked cars along the kerb on side streets that traffic doesn't use.
      if (PARK_ROADS.has(rd.k) && rd.w >= 8 && !this.trafficRoads.has(rd.p) && !embarcadero(rd)) {
        walk(rd, 3, 6.4, (x, z, dx, dz) => {
          for (const side of [-1, 1]) {
            if (r() > 0.55) continue;
            const off = hw - 1.15;
            const px = x - dz * side * off, pz = z + dx * side * off;
            if (nearInter(px, pz, 13) || !this.clearOf(px, pz, 3)) continue;
            if (!clearOfOtherRoads(px, pz, rd)) continue;
            let ok = true;
            for (const t of [-2.2, 2.2]) {
              const qx = px + dx * t, qz = pz + dz * t;
              const fl = world.floorAt(qx, qz, 0.8, 0);
              if (!fl.solid || world.pointBlocked(qx, 0.8, qz)) ok = false;
            }
            if (!ok) continue;
            this.add('car', px, 0.02, pz, Math.atan2(dx, dz) + (side > 0 ? Math.PI : 0), 1, 1, 1, CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]);
          }
        });
      }
    }
    // Benches looking out over the bay along The Embarcadero promenade.
    if (!(pts.bench && pts.bench.length > 60)) {
      for (const rd of roads) {
        if (!embarcadero(rd)) continue;
        walk(rd, 10, 45, (x, z, dx, dz) => {
          for (const side of [-1, 1]) {
            const bx = x - dz * side * (rd.w / 2 + 6), bz = z + dx * side * (rd.w / 2 + 6);
            if (free(bx, bz, 1.5, 2)) this.add('bench', bx, 0, bz, Math.atan2(-dz * side, dx * side) + Math.PI / 2);
          }
        });
      }
    }

    // --- streetcar tracks and overhead wires ---
    for (const line of map.rails || []) {
      const rd = { p: line };
      walk(rd, 0, 3, (x, z, dx, dz) => {
        for (const o of [-0.72, 0.72]) this.rect(x - dz * o, z + dx * o, dx, dz, 1.55, 0.05, 0.09, steel);
      });
      walk(rd, 10, 40, (x, z, dx, dz) => {
        const px = x - dz * 3.4, pz = z + dx * 3.4;
        if (free(px, pz, 6, 1)) this.add('tramPole', px, 0, pz, Math.atan2(dz, -dx));
      });
      walk(rd, 0, 6, (x, z, dx, dz) => this.box(x, z, dx, dz, 3.05, 0.02, 5.85, 5.89, steel));
    }

    // --- buildings: parapets, awnings, rooftop kit ---
    const parapet = new THREE.Color('#8b877f');
    for (const { s, b, i } of W.buildings) {
      const h = b.h, poly = b.p;
      const rr = rng(1000 + i);
      // Roof parapet: a low wall inside the roof edge.
      if (h > 5 && poly.length <= 40) {
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], c = poly[(k + 1) % poly.length];
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (len < 1) continue;
          const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
          const nx = s.nxs[k], nz = s.nzs[k];
          const mx = (a[0] + c[0]) / 2 - nx * 0.12, mz = (a[1] + c[1]) / 2 - nz * 0.12;
          this.box(mx, mz, dx, dz, len / 2, 0.12, h, h + 0.55, parapet);
          // Storefront awnings on street-facing ground floors.
          if (!(b.b > 0) && h > 6 && len > 7 && rr() < 0.28) {
            const ox = (a[0] + c[0]) / 2 + nx * 3.5, oz = (a[1] + c[1]) / 2 + nz * 3.5;
            const near = nearestSeg(ox, oz);
            if (near && near.d < near.s.w / 2 + 9 && this.onStreetLevel(ox, oz, 3)) {
              const col = new THREE.Color(AWNING_COLORS[Math.floor(rr() * AWNING_COLORS.length)]);
              const hl = Math.min(len * 0.38, 9);
              const cx = (a[0] + c[0]) / 2 + nx * 0.95, cz = (a[1] + c[1]) / 2 + nz * 0.95;
              this.box(cx, cz, dx, dz, hl, 0.95, 3.1, 3.22, col);
              this.box(cx + nx * 0.9, cz + nz * 0.9, dx, dz, hl, 0.04, 2.75, 3.22, col.clone().multiplyScalar(0.8));
            }
          }
        }
      }
      if (h < 6) continue;
      let area = 0;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], c = poly[(k + 1) % poly.length];
        area += a[0] * c[1] - c[0] * a[1];
      }
      area = Math.abs(area) / 2;
      if (area < 90) continue;
      const ex = poly[1][0] - poly[0][0], ez = poly[1][1] - poly[0][1];
      const el = Math.hypot(ex, ez) || 1;
      const ax = ex / el, az = ez / el;
      const rot = Math.atan2(ax, az);
      const inside = (x, z, m) => pointInSolid(s, x, z) && pointInSolid(s, x + m, z) && pointInSolid(s, x - m, z) && pointInSolid(s, x, z + m) && pointInSolid(s, x, z - m);
      const placed = [];
      const placeOnRoof = (type, half, tries, cb) => {
        for (let t = 0; t < tries; t++) {
          const x = s.minX + rr() * (s.maxX - s.minX), z = s.minZ + rr() * (s.maxZ - s.minZ);
          if (!inside(x, z, half + 1.2) || !this.clearOf(x, z, half + 4)) continue;
          if (placed.some(([px, pz, ph]) => (px - x) ** 2 + (pz - z) ** 2 < (ph + half + 1.5) ** 2)) continue;
          if (world.pointBlocked(x, h + 0.5, z)) continue;
          cb(x, z);
          placed.push([x, z, half]);
          return true;
        }
        return false;
      };
      // Water tower on some mid-rise masonry roofs.
      if (h < 75 && area > 220 && rr() < 0.12) {
        placeOnRoof('tower', 2, 12, (x, z) => {
          this.add('tower', x, h, z, rr() * 6.28);
          world.addBox(x, z, 1, 0, 1.75, 1.75, h, h + 6.7, { kind: 'roofunit' });
        });
      }
      // HVAC boxes with fans.
      const n = Math.min(5, Math.max(1, Math.round(area / 450)));
      for (let k = 0; k < n; k++) {
        const sx = 1.4 + rr() * 2.6, sz = 1.2 + rr() * 2.2, sy = 0.9 + rr() * 1.4;
        placeOnRoof('roofunit', Math.max(sx, sz) / 2, 10, (x, z) => {
          const g = 0.62 + rr() * 0.2;
          this.add('roofunit', x, h, z, rot, sx, sy, sz, new THREE.Color(g, g, g * 0.98).getHex());
          world.addBox(x, z, ax, az, sz / 2, sx / 2, h, h + sy, { kind: 'roofunit' });
          if (rr() < 0.6) this.add('fan', x, h + sy, z, 0, Math.min(sx, sz) * 0.9, 1, Math.min(sx, sz) * 0.9);
        });
      }
      // Antennas on the tall towers.
      if (h > 100) {
        const m = 1 + Math.floor(rr() * 3);
        for (let k = 0; k < m; k++) placeOnRoof('antenna', 0.3, 8, (x, z) => this.add('antenna', x, h, z, 0, 1, 6 + rr() * 14, 1));
      }
    }
  }

  // One InstancedMesh per prop part, sized for the whole map, filled from active chunks.
  buildInstanced() {
    this.meshes = {};
    for (const [name, T] of Object.entries(this.types)) {
      const total = this.counts[name] || 0;
      if (!total) continue;
      this.meshes[name] = T.parts.map((p) => {
        const m = new THREE.InstancedMesh(p.geo, p.mat, total);
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = name === 'tree' || name === 'tower' || name === 'car';
        m.receiveShadow = true;
        if (T.colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
        this.group.add(m);
        return m;
      });
    }
  }

  chunkMatrices(c) {
    if (c.matrices) return c.matrices;
    const out = {};
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const [type, a] of Object.entries(c.inst)) {
      const n = a.length / 8;
      const mats = new Float32Array(n * 16), cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const o = i * 8;
        p.set(a[o], a[o + 1], a[o + 2]);
        q.setFromAxisAngle(up, a[o + 3]);
        s.set(a[o + 4], a[o + 5], a[o + 6]);
        m.compose(p, q, s);
        m.toArray(mats, i * 16);
        col.setHex(a[o + 7]);
        cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
      }
      out[type] = { mats, cols, n };
    }
    c.matrices = out;
    return out;
  }

  refill() {
    const fill = {};
    for (const k of this.active) {
      const c = this.chunks.get(k);
      const cm = this.chunkMatrices(c);
      for (const [type, d] of Object.entries(cm)) {
        const meshes = this.meshes[type];
        if (!meshes) continue;
        const start = fill[type] || 0;
        for (const mesh of meshes) {
          mesh.instanceMatrix.array.set(d.mats, start * 16);
          if (mesh.instanceColor) mesh.instanceColor.array.set(d.cols, start * 3);
        }
        fill[type] = start + d.n;
      }
    }
    for (const [type, meshes] of Object.entries(this.meshes)) {
      for (const mesh of meshes) {
        mesh.count = fill[type] || 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  buildChunkMesh(c) {
    const pos = [], nor = [], col = [];
    const push = (x, y, z, nx, ny, nz, r, g, b) => { pos.push(x, y, z); nor.push(nx, ny, nz); col.push(r, g, b); };
    const quad = (A, B, C, D, n, r, g, b) => {
      for (const P of [A, B, C, A, C, D]) push(P[0], P[1], P[2], n[0], n[1], n[2], r, g, b);
    };
    const corners = (a, o) => {
      const [x, z, dx, dz, hl, hw] = [a[o], a[o + 1], a[o + 2], a[o + 3], a[o + 4], a[o + 5]];
      const px = -dz, pz = dx;
      return [
        [x - dx * hl - px * hw, z - dz * hl - pz * hw], [x + dx * hl - px * hw, z + dz * hl - pz * hw],
        [x + dx * hl + px * hw, z + dz * hl + pz * hw], [x - dx * hl + px * hw, z - dz * hl + pz * hw],
      ];
    };
    const build = (arr, solid) => {
      pos.length = nor.length = col.length = 0;
      for (let o = 0; o < arr.length; o += 11) {
        const q = corners(arr, o), y0 = arr[o + 6], y1 = arr[o + 7], r = arr[o + 8], g = arr[o + 9], b = arr[o + 10];
        // Top face; winding chosen so it faces up.
        const top = q.map(([x, z]) => [x, y1, z]);
        const ccw = (top[1][0] - top[0][0]) * (top[2][2] - top[0][2]) - (top[1][2] - top[0][2]) * (top[2][0] - top[0][0]) < 0;
        if (ccw) quad(top[0], top[1], top[2], top[3], [0, 1, 0], r, g, b);
        else quad(top[0], top[3], top[2], top[1], [0, 1, 0], r, g, b);
        if (solid) {
          for (let k = 0; k < 4; k++) {
            const A = q[k], B = q[(k + 1) % 4];
            const ex = B[0] - A[0], ez = B[1] - A[1], l = Math.hypot(ex, ez) || 1;
            quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], [ez / l, 0, -ex / l], r * 0.85, g * 0.85, b * 0.85);
          }
        }
      }
      if (!pos.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      return geo;
    };
    const grp = new THREE.Group();
    const g1 = build(c.ground, false);
    if (g1) { const m = new THREE.Mesh(g1, this.groundMat); m.receiveShadow = true; grp.add(m); }
    const g2 = build(c.solid, true);
    if (g2) { const m = new THREE.Mesh(g2, this.solidMat); m.receiveShadow = true; m.castShadow = true; grp.add(m); }
    c.mesh = grp;
    this.group.add(grp);
  }

  setRadius(r) {
    this.radius = r;
    this.lastKey = null;
  }

  // focus: where the player (or camera) is. Call every frame.
  update(focus, lights = 0, t = 0) {
    const cx = Math.floor(focus.x / CHUNK), cz = Math.floor(focus.z / CHUNK);
    const keyNow = `${cx},${cz},${this.radius}`;
    if (keyNow !== this.lastKey) {
      this.lastKey = keyNow;
      const want = new Set();
      const span = Math.ceil(this.radius / CHUNK);
      for (let x = cx - span; x <= cx + span; x++) {
        for (let z = cz - span; z <= cz + span; z++) {
          const dx = Math.max(0, Math.abs((x + 0.5) * CHUNK - focus.x) - CHUNK / 2);
          const dz = Math.max(0, Math.abs((z + 0.5) * CHUNK - focus.z) - CHUNK / 2);
          if (dx * dx + dz * dz > this.radius * this.radius) continue;
          const k = ckey(x, z);
          if (this.chunks.has(k)) want.add(k);
        }
      }
      // Drop merged meshes for chunks well out of range.
      for (const k of this.active) {
        if (want.has(k)) continue;
        const c = this.chunks.get(k);
        if (c.mesh) {
          this.group.remove(c.mesh);
          c.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
          c.mesh = null;
        }
      }
      this.active = want;
      this.refill();
    }
    // Build at most two chunk meshes per frame, nearest first.
    let built = 0;
    for (const k of this.active) {
      if (built >= 2) break;
      const c = this.chunks.get(k);
      if (!c.mesh) { this.buildChunkMesh(c); built++; }
    }
    // Lamps glow at dusk; signals cycle.
    const lamp = this.types.lamp.parts[1].mat;
    lamp.emissiveIntensity = 0.15 + lights * 2.2;
    const phase = Math.floor(t / 9) % 2 === 0;
    this.types.signal.red.color.setHex(phase ? 0xff3b2f : 0x3a1412);
    this.types.signal.green.color.setHex(phase ? 0x0f2a18 : 0x2bd46a);
  }

  get stats() {
    let active = 0;
    for (const meshes of Object.values(this.meshes)) active += meshes[0].count;
    return { counts: this.counts, intersections: this.intersections, chunks: this.chunks.size, activeChunks: this.active.size, activeInstances: active, genMs: this.genMs };
  }
}
