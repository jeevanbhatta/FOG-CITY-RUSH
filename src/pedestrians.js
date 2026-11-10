import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// People strolling the footpaths near you. Instanced and recycled: when a walker ends up far
// behind, they reappear on a path closer to wherever you are now. They side-step out of
// your way, and hop clear of a car coming at them.

const SHIRTS = [0xe8552b, 0x3d5a80, 0x2aa198, 0xd9a441, 0x6b6f73, 0x8a1f1f, 0xf2efe6, 0x1f3a2f, 0x9b5de5, 0x4f7a63];
const SKIN = [0xf1c6a6, 0xd9a07a, 0xc58c66, 0x8d5a3b, 0x5a3a28];

export class Pedestrians {
  constructor(scene, roads, world, max = 70) {
    this.world = world;
    // Walkable lines: footways, pedestrian streets, and both sidewalks of ordinary streets.
    const lines = [];
    for (const r of roads) {
      if (r.k === 'footway' || r.k === 'pedestrian') lines.push(r.p);
      else if (['residential', 'tertiary', 'secondary', 'primary', 'unclassified'].includes(r.k)) {
        for (const side of [-1, 1]) {
          const off = r.w / 2 + 1.6;
          const p = r.p.map((q, i) => {
            const a = r.p[Math.max(0, i - 1)], b = r.p[Math.min(r.p.length - 1, i + 1)];
            const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
            return [q[0] - (dz / l) * off * side, q[1] + (dx / l) * off * side];
          });
          lines.push(p);
        }
      }
    }
    // Break lines into short segments with a grid for "segments near me" lookups.
    this.segs = [];
    for (const p of lines) {
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len > 2) this.segs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], len });
      }
    }
    this.cell = 60;
    this.grid = new Map();
    this.segs.forEach((s, i) => {
      const k = `${Math.floor((s.ax + s.bx) / 2 / this.cell)},${Math.floor((s.az + s.bz) / 2 / this.cell)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });

    // One low-poly person: legs, torso, head. Colours per instance.
    const legs = new THREE.CylinderGeometry(0.16, 0.13, 0.85, 6); legs.translate(0, 0.43, 0);
    const torso = new THREE.CylinderGeometry(0.2, 0.24, 0.7, 7); torso.translate(0, 1.2, 0);
    const head = new THREE.SphereGeometry(0.15, 8, 6); head.translate(0, 1.72, 0);
    const paint = (g, c) => {
      const col = new THREE.Color(c);
      const a = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) { a[i] = col.r; a[i + 1] = col.g; a[i + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    // Legs dark, torso white (tinted per instance), head light (tinted per instance via a second mesh).
    this.bodyMesh = new THREE.InstancedMesh(mergeGeometries([paint(legs, 0x2c3440), paint(torso, 0xffffff)]),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), max);
    this.headMesh = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ roughness: 0.7 }), max);
    for (const m of [this.bodyMesh, this.headMesh]) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }
    this.max = max;
    this.people = [];
    const c = new THREE.Color();
    for (let i = 0; i < max; i++) {
      this.people.push({ seg: null, t: 0, dir: 1, speed: 1.1 + Math.random() * 0.6, x: 1e9, z: 1e9, side: 0, hop: 0, phase: Math.random() * 6 });
      this.bodyMesh.setColorAt(i, c.set(SHIRTS[i % SHIRTS.length]));
      this.headMesh.setColorAt(i, c.set(SKIN[i % SKIN.length]));
    }
    this.count = max;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
  }

  setCount(n) {
    this.count = Math.min(this.max, n);
    this.bodyMesh.count = this.headMesh.count = this.count;
  }

  // A random walkable segment 40–220 m from (x, z), clear of buildings.
  spawn(p, x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let tries = 0; tries < 12; tries++) {
      const k = `${cx + Math.floor(Math.random() * 7) - 3},${cz + Math.floor(Math.random() * 7) - 3}`;
      const list = this.grid.get(k);
      if (!list) continue;
      const s = this.segs[list[Math.floor(Math.random() * list.length)]];
      const t = Math.random();
      const px = s.ax + (s.bx - s.ax) * t, pz = s.az + (s.bz - s.az) * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < 40 || d > 220) continue;
      if (this.world.pointBlocked(px, 1, pz)) continue;
      const fl = this.world.floorAt(px, pz, 2, 0);
      if (!fl.solid) continue;
      Object.assign(p, { seg: s, t, dir: Math.random() < 0.5 ? 1 : -1, side: 0, hop: 0, y: fl.y });
      return;
    }
  }

  // threats: [{x, z, vx, vz, r}] things to step away from (you, cars).
  update(dt, focus, threats, t) {
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.seg || Math.hypot(p.x - focus.x, p.z - focus.z) > 260) { this.spawn(p, focus.x, focus.z); if (!p.seg) continue; }
      const s = p.seg;
      p.t += (p.speed * p.dir * dt) / s.len;
      if (p.t > 1 || p.t < 0) { p.dir *= -1; p.t = Math.max(0, Math.min(1, p.t)); }
      const fx = ((s.bx - s.ax) / s.len) * p.dir, fz = ((s.bz - s.az) / s.len) * p.dir;
      let x = s.ax + (s.bx - s.ax) * p.t, z = s.az + (s.bz - s.az) * p.t;
      // Step aside from anything close; jump clear of fast cars.
      let push = 0;
      for (const o of threats) {
        const dx = x + -fz * p.side - o.x, dz = z + fx * p.side - o.z;
        const d = Math.hypot(dx, dz);
        const reach = o.r + (Math.hypot(o.vx, o.vz) > 6 ? 4 : 1.2);
        if (d < reach) {
          const sideDir = Math.sign(dx * -fz + dz * fx) || 1;
          push = sideDir * (reach - d + 0.5);
          if (Math.hypot(o.vx, o.vz) > 6 && p.hop <= 0) p.hop = 0.5;
        }
      }
      p.side += (Math.max(-3, Math.min(3, p.side + push)) - p.side) * Math.min(1, dt * 6);
      if (!push) p.side *= Math.exp(-dt * 0.5);
      const ox = x - fz * p.side, oz = z + fx * p.side;
      if (!this.world.pointBlocked(ox, 1, oz)) { x = ox; z = oz; } else p.side *= 0.5;
      p.x = x; p.z = z;
      p.hop = Math.max(0, p.hop - dt);
      const bob = Math.abs(Math.sin(t * 7 * p.speed + p.phase)) * 0.05 + (p.hop > 0 ? Math.sin((p.hop / 0.5) * Math.PI) * 0.6 : 0);
      this.q.setFromAxisAngle(this.up, Math.atan2(fx, fz));
      this.m.compose(this.v.set(x, (p.y || 0) + bob, z), this.q, this.s);
      this.bodyMesh.setMatrixAt(i, this.m);
      this.headMesh.setMatrixAt(i, this.m);
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
  }
}
