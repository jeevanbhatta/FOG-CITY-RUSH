import * as THREE from 'three';
import { BRIDGE } from './world.js';

// Courses are described relative to landmarks so they survive map rebuilds.
// Each checkpoint resolves to a point in the world; the run is timed from the
// countdown to the last ring.

export function defineCourses(W) {
  const f = W.landmarks.ferry;
  const bi = W.landmarks.bridgeInfo;
  const plaza = f.plaza;
  const ground = (x, z) => ({ kind: 'ground', x, z });
  const top = (x, y, z) => ({ kind: 'fixed', x, y, z });

  // Points along The Embarcadero heading away from the bridge (north-west).
  const bridgeShore = bi.at(0, 0);
  const toBridge = [bridgeShore[0] - plaza[0], bridgeShore[1] - plaza[1]];
  const tbl = Math.hypot(...toBridge);
  const ux = toBridge[0] / tbl, uz = toBridge[1] / tbl;
  // Inland is "toward the plaza from the tower", i.e. along the tower's plaza face normal.
  const ix = f.face[0], iz = f.face[1];

  const sprint = [ground(plaza[0], plaza[1])];
  for (let d = 140; d <= 700; d += 140) {
    sprint.push(ground(plaza[0] - ux * d + ix * 8, plaza[1] - uz * d + iz * 8));
  }

  const tower = [
    ground(plaza[0], plaza[1]),
    top(f.face[0] * 7.6, 50.1, f.face[1] * 7.6),
    top(f.face[0] * 5.6, 64.1, f.face[1] * 5.6),
    top(f.face[0] * 3.6, 72.1, f.face[1] * 3.6),
  ];

  const [d0x, d0z] = bi.at(-BRIDGE.rampLen + 30, 0);
  const [d1x, d1z] = bi.at(120, 0);
  const [anx, anz] = bi.at(5, -(BRIDGE.halfWidth + 6));
  const [c1x, c1z] = bi.at(180, -(BRIDGE.halfWidth + 0.5));
  const [t1x, t1z] = bi.at(BRIDGE.towers[0], 0);
  const bridge = [
    ground(plaza[0], plaza[1]),
    ground(d0x, d0z),
    top(d1x, bi.deckY + 0.05, d1z),
    top(anx, bi.anchorTop + 0.05, anz),
    top(c1x, bi.cableY(180) + 0.75, c1z),
    top(t1x, bi.towerTop + 0.05, t1z),
    top((t1x / Math.hypot(t1x, t1z)) * 3.6, 72.1, (t1z / Math.hypot(t1x, t1z)) * 3.6),
  ];

  return [
    {
      id: 'sprint', name: 'Embarcadero Sprint', difficulty: 'Easy',
      blurb: 'Street-level dash up the waterfront from the Ferry Building plaza.',
      points: sprint, start: plaza,
    },
    {
      id: 'tower', name: 'Clock Tower Climb', difficulty: 'Medium',
      blurb: 'Ladders and ledges to the balcony of the Ferry Building clock tower.',
      points: tower, start: plaza,
    },
    {
      id: 'bridge', name: 'Bay Bridge Run', difficulty: 'Hard',
      blurb: 'Up the approach, onto the cable, over the tower, and zipline home.',
      points: bridge, start: plaza,
    },
  ];
}

// Find a standable spot near (x,z) at street level.
function resolveGround(world, x, z) {
  for (let r = 0; r <= 40; r += 2) {
    const n = r === 0 ? 1 : Math.max(6, Math.round(r * 1.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const fl = world.floorAt(px, pz, 3, 0);
      if (!fl.solid) continue;
      if (world.pointBlocked(px, fl.y + 1, pz) || world.pointBlocked(px, fl.y + 2.5, pz)) continue;
      return new THREE.Vector3(px, fl.y, pz);
    }
  }
  return new THREE.Vector3(x, 0, z);
}

export function resolveCourse(course, world) {
  const pts = course.points.map((p) => (p.kind === 'ground' ? resolveGround(world, p.x, p.z) : new THREE.Vector3(p.x, p.y, p.z)));
  let len = 0, est = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const horiz = Math.hypot(b.x - a.x, b.z - a.z), dy = b.y - a.y;
    len += a.distanceTo(b);
    // Rough pace: 11 m/s running, ~12 m/s up ladders, ~28 m/s down long ziplines.
    est += dy < -20 ? Math.hypot(horiz, dy) / 28 : horiz / 11 + Math.max(0, dy) / 12;
  }
  const gold = Math.ceil(est * 1.2 + 2);
  return {
    ...course,
    pts,
    length: len,
    medals: { gold, silver: Math.ceil(gold * 1.3), bronze: Math.ceil(gold * 1.7) },
  };
}

// Visible rings and beacons for an active course.
export class CourseRunner {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ringGeo = new THREE.TorusGeometry(2.6, 0.22, 10, 40);
    this.beaconGeo = new THREE.CylinderGeometry(1.1, 1.1, 400, 12, 1, true);
    this.beaconGeo.translate(0, 200, 0);
    this.matNext = new THREE.MeshBasicMaterial({ color: 0xff6a2b, fog: false });
    this.matLater = new THREE.MeshBasicMaterial({ color: 0xf4efe6, transparent: true, opacity: 0.55 });
    this.beaconNext = new THREE.MeshBasicMaterial({ color: 0xff6a2b, transparent: true, opacity: 0.22, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.beaconLater = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
    this.course = null;
  }

  start(course) {
    this.clear();
    this.course = course;
    this.index = 1; // 0 is the start
    this.time = 0;
    this.running = false;
    this.finished = false;
    this.splits = [];
    this.rings = course.pts.map((p, i) => {
      if (i === 0) return null;
      const g = new THREE.Group();
      const ring = new THREE.Mesh(this.ringGeo, this.matLater);
      ring.position.y = 1.4;
      g.add(ring);
      const beacon = new THREE.Mesh(this.beaconGeo, this.beaconLater);
      g.add(beacon);
      g.position.copy(p);
      const next = course.pts[i + 1] || course.pts[i - 1];
      const dir = new THREE.Vector3().subVectors(next, p);
      ring.rotation.y = Math.atan2(dir.x, dir.z);
      g.userData = { ring, beacon };
      this.group.add(g);
      return g;
    });
    this.refresh();
  }

  refresh() {
    this.rings.forEach((g, i) => {
      if (!g) return;
      const active = i === this.index;
      g.visible = i >= this.index;
      g.userData.ring.material = active ? this.matNext : this.matLater;
      g.userData.beacon.material = active ? this.beaconNext : this.beaconLater;
      g.userData.beacon.visible = i <= this.index + 1;
    });
  }

  get next() {
    return this.course && !this.finished ? this.course.pts[this.index] : null;
  }

  update(dt, player) {
    if (!this.course) return null;
    const t = performance.now() / 1000;
    this.rings.forEach((g) => { if (g) g.userData.ring.rotation.z = Math.sin(t * 2) * 0.05; });
    if (!this.running || this.finished) return null;
    this.time += dt;
    const p = this.course.pts[this.index];
    const dx = player.pos.x - p.x, dy = player.pos.y + 1 - (p.y + 1.4), dz = player.pos.z - p.z;
    if (dx * dx + dz * dz < 3.4 * 3.4 && Math.abs(dy) < 3.2) {
      this.splits.push(this.time);
      this.index++;
      if (this.index >= this.course.pts.length) {
        this.finished = true;
        this.running = false;
        this.refresh();
        return 'finish';
      }
      this.refresh();
      return 'checkpoint';
    }
    return null;
  }

  // Where to respawn after a fall into the bay.
  get respawn() {
    if (!this.course) return null;
    const p = this.course.pts[Math.max(0, this.index - 1)];
    return p;
  }

  clear() {
    this.group.clear();
    this.course = null;
    this.finished = false;
    this.running = false;
  }
}
