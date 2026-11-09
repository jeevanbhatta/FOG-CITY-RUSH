import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld, pointInSolid, closestOnSolid } from './physics.js';
import * as TX from './textures.js';

// ---------- small helpers ----------

function hash(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return a / 2;
}

function centroid(p) {
  let x = 0, z = 0;
  for (const q of p) { x += q[0]; z += q[1]; }
  return [x / p.length, z / p.length];
}

const _col = new THREE.Color();

// Accumulates triangles into flat arrays, then becomes one BufferGeometry.
class Batch {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = [];
  }
  get empty() { return this.pos.length === 0; }
  vert(x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
  }
  // Triangle whose winding is made to agree with the given normal.
  tri(a, b, c, n, uvs, color) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
    let ua = uvs[0], ub = uvs[1], uc = uvs[2];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    this.vert(a[0], a[1], a[2], n[0], n[1], n[2], ua[0], ua[1], color);
    this.vert(b[0], b[1], b[2], n[0], n[1], n[2], ub[0], ub[1], color);
    this.vert(c[0], c[1], c[2], n[0], n[1], n[2], uc[0], uc[1], color);
  }
  quad(a, b, c, d, n, uvs, color) {
    this.tri(a, b, c, n, [uvs[0], uvs[1], uvs[2]], color);
    this.tri(a, c, d, n, [uvs[0], uvs[2], uvs[3]], color);
  }
  // Vertical walls of a polygon prism. uScale/vScale are metres per texture tile.
  walls(poly, y0, y1, color, uScale = 8, vScale = 7) {
    const sign = polyArea(poly) > 0 ? 1 : -1;
    let run = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const n = [(sign * dz) / len, 0, (-sign * dx) / len];
      const u0 = run / uScale, u1 = (run + len) / uScale;
      run += len;
      this.quad(
        [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n,
        [[u0, y0 / vScale], [u1, y0 / vScale], [u1, y1 / vScale], [u0, y1 / vScale]], color,
      );
    }
  }
  // Flat cap (roof/floor) at height y facing up (or down when up=false).
  cap(poly, y, color, uvScale = 8, up = true) {
    const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    let tris;
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch (_) {
      return;
    }
    const n = up ? [0, 1, 0] : [0, -1, 0];
    for (const t of tris) {
      const p0 = poly[t[0]], p1 = poly[t[1]], p2 = poly[t[2]];
      this.tri(
        [p0[0], y, p0[1]], [p1[0], y, p1[1]], [p2[0], y, p2[1]], n,
        [[p0[0] / uvScale, p0[1] / uvScale], [p1[0] / uvScale, p1[1] / uvScale], [p2[0] / uvScale, p2[1] / uvScale]],
        color,
      );
    }
  }
  prism(poly, y0, y1, color, opts = {}) {
    this.walls(poly, y0, y1, color, opts.uScale, opts.vScale);
    this.cap(poly, y1, opts.topColor || color, opts.capScale);
    if (opts.bottom) this.cap(poly, y0, color, opts.capScale, false);
  }
  box(cx, cy0, cz, dirX, dirZ, halfLen, halfWid, cy1, color, opts) {
    const px = -dirZ, pz = dirX;
    const poly = [
      [cx - dirX * halfLen - px * halfWid, cz - dirZ * halfLen - pz * halfWid],
      [cx + dirX * halfLen - px * halfWid, cz + dirZ * halfLen - pz * halfWid],
      [cx + dirX * halfLen + px * halfWid, cz + dirZ * halfLen + pz * halfWid],
      [cx - dirX * halfLen + px * halfWid, cz - dirZ * halfLen + pz * halfWid],
    ];
    this.prism(poly, cy0, cy1, color, { bottom: true, ...opts });
    return poly;
  }
  ribbon(pts, halfW, y, color, uvScale = 8) {
    if (pts.length < 2) return;
    const left = [], right = [];
    let along = 0;
    const alongs = [0];
    for (let i = 1; i < pts.length; i++) {
      along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      alongs.push(along);
    }
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      let nx = -dz, nz = dx;
      // Miter: scale the offset at bends, clamped.
      let scale = 1;
      if (i > 0 && i < pts.length - 1) {
        const ax = pts[i][0] - prev[0], az = pts[i][1] - prev[1];
        const al = Math.hypot(ax, az) || 1;
        const cos = (-az / al) * nx + (ax / al) * nz;
        scale = Math.min(2, 1 / Math.max(0.5, Math.abs(cos)));
      }
      left.push([pts[i][0] + nx * halfW * scale, pts[i][1] + nz * halfW * scale]);
      right.push([pts[i][0] - nx * halfW * scale, pts[i][1] - nz * halfW * scale]);
    }
    const n = [0, 1, 0];
    for (let i = 0; i < pts.length - 1; i++) {
      const u0 = alongs[i] / uvScale, u1 = alongs[i + 1] / uvScale;
      this.quad(
        [left[i][0], y, left[i][1]], [right[i][0], y, right[i][1]],
        [right[i + 1][0], y, right[i + 1][1]], [left[i + 1][0], y, left[i + 1][1]], n,
        [[u0, 0], [u0, 1], [u1, 1], [u1, 0]], color,
      );
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Batches split into spatial tiles so the renderer can skip what's off screen.
class TiledBatches {
  constructor(size = 240) { this.size = size; this.map = new Map(); }
  get(x, z) {
    const k = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let b = this.map.get(k);
    if (!b) { b = new Batch(); this.map.set(k, b); }
    return b;
  }
  meshes(material, { cast = true, receive = true } = {}) {
    const out = [];
    for (const b of this.map.values()) {
      if (b.empty) continue;
      const m = new THREE.Mesh(b.geometry(), material);
      m.castShadow = cast; m.receiveShadow = receive;
      out.push(m);
    }
    return out;
  }
}

const MASONRY = ['#e6dfd0', '#dcd0b8', '#d2c4a8', '#ebe8e1', '#c9b69b', '#bba78e', '#ddd6c8', '#a95f45', '#b9b3a7', '#e9dcc5'];
const GLASS = ['#a3b6c4', '#8ca2b3', '#b7c5cf', '#74899a', '#a9b9ae', '#c2cbd1'];
const ROOF = ['#8f8e89', '#a29e95', '#7d8081', '#96928a', '#6f7477'];

function styleFor(b, i) {
  const r = hash(i + b.h * 3.1);
  const mat = (b.m || '').toLowerCase();
  let glass = (b.h > 42 && r < 0.72) || mat.includes('glass');
  if (mat.includes('brick') || mat.includes('stone') || mat.includes('concrete')) glass = false;
  const list = glass ? GLASS : MASONRY;
  let c = list[Math.floor(hash(i * 7.3) * list.length)];
  if (mat.includes('brick')) c = '#a95f45';
  return { glass, wall: new THREE.Color(c), roof: new THREE.Color(ROOF[Math.floor(hash(i * 3.7) * ROOF.length)]) };
}

// ---------- the world ----------

export const BRIDGE = {
  deckY: 58,
  rampLen: 460,
  halfWidth: 12,
  towers: [354, 1058],
  centreU: 1400,
  towerTop: 152,
};

export function buildWorld(map, scene) {
  const world = new CollisionWorld(24);
  const group = new THREE.Group();
  scene.add(group);

  const tex = {
    masonry: TX.masonryTexture(),
    glass: TX.glassTexture(),
    ladder: TX.ladderTexture(),
    concrete: TX.noiseTexture(205, 26, 3),
    roof: TX.noiseTexture(200, 40, 9, 128),
    asphalt: TX.asphaltTexture(),
    water: TX.waterNormals(),
    clock: TX.clockFaceTexture(),
    puff: TX.puffTexture(),
  };
  tex.masonry.repeat.set(1, 1);

  const mats = {
    masonry: new THREE.MeshStandardMaterial({ map: tex.masonry, vertexColors: true, roughness: 0.88 }),
    glass: new THREE.MeshStandardMaterial({ map: tex.glass, vertexColors: true, roughness: 0.32, metalness: 0.35 }),
    roof: new THREE.MeshStandardMaterial({ map: tex.roof, vertexColors: true, roughness: 0.95 }),
    ground: new THREE.MeshStandardMaterial({ map: tex.concrete, vertexColors: true, roughness: 0.95 }),
    road: new THREE.MeshStandardMaterial({
      map: tex.asphalt, vertexColors: true, roughness: 0.9,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    park: new THREE.MeshStandardMaterial({
      map: tex.concrete, vertexColors: true, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }),
    steel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 }),
    stone: new THREE.MeshStandardMaterial({ map: tex.concrete, vertexColors: true, roughness: 0.9 }),
    ladder: new THREE.MeshStandardMaterial({ map: tex.ladder, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x9aa4ab, roughness: 0.4, metalness: 0.6 }),
    zip: new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.5, metalness: 0.4 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.6 }),
  };

  const meta = map.meta;
  const bounds = meta.bounds; // minX, minZ, maxX, maxZ
  const bridge = bridgeFrame(meta);
  const corridor = (x, z) => {
    // Distance-along (u) and across (v) the bridge axis.
    const dx = x - bridge.sx, dz = z - bridge.sz;
    return [dx * bridge.dx + dz * bridge.dz, dx * bridge.px + dz * bridge.pz];
  };
  const deckYAt = (u) => (u >= 0 ? BRIDGE.deckY : Math.max(0, BRIDGE.deckY * (1 + u / BRIDGE.rampLen)));

  // ----- Ground: land + piers -----
  const ground = new TiledBatches(400);
  const groundColor = new THREE.Color('#cfc9bd');
  const wallColor = new THREE.Color('#8d877c');
  for (const poly of map.land) {
    world.addSolid(poly, -30, 0, { kind: 'land' });
    const [cx, cz] = centroid(poly);
    const b = ground.get(cx, cz);
    b.cap(poly, 0, groundColor, 6);
    b.walls(poly, -3, 0, wallColor, 6, 6);
  }
  group.add(...ground.meshes(mats.ground, { cast: false }));

  // ----- Parks & roads -----
  const flat = new Batch();
  const parkColor = new THREE.Color('#8ea576');
  for (const poly of map.parks) flat.cap(poly, 0.03, parkColor, 4);
  if (!flat.empty) {
    const m = new THREE.Mesh(flat.geometry(), mats.park);
    m.receiveShadow = true;
    group.add(m);
  }
  const roads = new Batch();
  const roadColors = {
    footway: new THREE.Color('#b3ab9c'), pedestrian: new THREE.Color('#c2b8a6'),
    service: new THREE.Color('#6d7177'), default: new THREE.Color('#5a5f66'),
  };
  for (const r of map.roads) {
    const c = roadColors[r.k] || roadColors.default;
    roads.ribbon(r.p, r.w / 2, r.k === 'footway' || r.k === 'pedestrian' ? 0.05 : 0.06, c, 10);
  }
  if (!roads.empty) {
    const m = new THREE.Mesh(roads.geometry(), mats.road);
    m.receiveShadow = true;
    group.add(m);
  }

  // ----- Buildings -----
  const ferry = { x: 0, z: 0 };
  const walls = { masonry: new TiledBatches(), glass: new TiledBatches() };
  const roofs = new TiledBatches();
  const buildingSolids = [];
  map.buildings.forEach((b, i) => {
    const y0 = b.b || 0;
    const [cx, cz] = centroid(b.p);
    // The hand-built clock tower replaces whatever OSM has at its spot.
    if (Math.hypot(cx - ferry.x, cz - ferry.z) < 14 && b.h > 28) return;
    // Clear buildings that would poke through the bridge approach.
    // Sample along every wall, so buildings that straddle the corridor are caught too.
    let blocked = false;
    for (let k = 0; k < b.p.length && !blocked; k++) {
      const a = b.p[k], c = b.p[(k + 1) % b.p.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 2));
      for (let t = 0; t <= steps; t++) {
        const [u, v] = corridor(a[0] + ((c[0] - a[0]) * t) / steps, a[1] + ((c[1] - a[1]) * t) / steps);
        if (u > -BRIDGE.rampLen - 4 && u < 40 && Math.abs(v) < BRIDGE.halfWidth + 3 && b.h > deckYAt(u) - 4) {
          blocked = true; break;
        }
      }
    }
    if (blocked) return;
    const st = styleFor(b, i);
    const tile = st.glass ? walls.glass : walls.masonry;
    tile.get(cx, cz).walls(b.p, y0, b.h, st.wall, st.glass ? 6 : 8, 7);
    roofs.get(cx, cz).cap(b.p, b.h, st.roof, 5);
    if (y0 > 0) roofs.get(cx, cz).cap(b.p, y0, st.wall, 5, false);
    const s = world.addSolid(b.p, y0, b.h, { kind: 'building', name: b.n });
    s.height = b.h;
    buildingSolids.push({ s, b, i, cx, cz });
  });
  group.add(...walls.masonry.meshes(mats.masonry));
  group.add(...walls.glass.meshes(mats.glass));
  group.add(...roofs.meshes(mats.roof));

  // ----- Landmarks -----
  const landmarks = { bridge };
  const steel = new Batch();
  const stone = new Batch();
  const ladders = [];
  landmarks.ferry = buildFerryTower(world, stone, mats, tex, group, ladders, map);
  landmarks.bridgeInfo = buildBridge(world, bridge, steel, stone, mats, group, ladders, deckYAt);
  {
    const m1 = new THREE.Mesh(steel.geometry(), mats.steel);
    m1.castShadow = m1.receiveShadow = true;
    const m2 = new THREE.Mesh(stone.geometry(), mats.stone);
    m2.castShadow = m2.receiveShadow = true;
    group.add(m1, m2);
  }

  // ----- Service ladders on buildings -----
  for (const { s, b, i } of buildingSolids) {
    if (b.h < 4 || b.h - (b.b || 0) < 3.5) continue;
    if (hash(i * 1.37) > 0.72 && b.h < 60) continue;
    const want = b.h > 70 ? 2 : 1;
    let placed = 0;
    const order = b.p.map((_, k) => k).sort((a, c) => hash(i * 13 + a) - hash(i * 13 + c));
    for (const e of order) {
      if (placed >= want) break;
      const a = b.p[e], c = b.p[(e + 1) % b.p.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 4) continue;
      const nx = s.nxs[e], nz = s.nzs[e];
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const fx = mx + nx * 1.2, fz = mz + nz * 1.2;
      const y0 = b.b || 0;
      const foot = world.floorAt(fx, fz, y0 + 0.7, 0);
      if (!foot.solid || Math.abs(foot.y - y0) > 0.7) continue;
      if (world.pointBlocked(fx, y0 + 1.2, fz) || world.pointBlocked(fx, b.h - 1, fz)) continue;
      if (world.pointBlocked(mx - nx * 0.9, b.h + 1, mz - nz * 0.9)) continue;
      if (!pointInSolid(s, mx - nx * 0.9, mz - nz * 0.9)) continue;
      ladders.push({ x: mx + nx * 0.05, z: mz + nz * 0.05, nx, nz, tx: -nz, tz: nx, y0: foot.y, y1: b.h });
      placed++;
    }
  }
  world.ladders = ladders;
  group.add(ladderMesh(ladders, mats.ladder));

  // ----- Ziplines between rooftops -----
  world.ziplines = buildZiplines(world, buildingSolids, landmarks);
  const zipMeshes = ziplineMeshes(world.ziplines, mats);
  if (zipMeshes) group.add(zipMeshes);

  // ----- Palms along the waterfront -----
  addPalms(map, world, group);

  // ----- Water, sky, fog -----
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({
      color: 0x4a6b78, roughness: 0.22, metalness: 0.15,
      normalMap: tex.water, normalScale: new THREE.Vector2(0.35, 0.35),
    }),
  );
  water.material.normalMap.repeat.set(220, 220);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.6;
  water.receiveShadow = true;
  group.add(water);

  const fogBanks = addFogBanks(group, tex.puff, bounds);

  return {
    world, group, landmarks, bounds, tex, mats, water, fogBanks, map,
    roofAt: (x, z) => world.floorAt(x, z, 1e6, 0).y,
    update(dt, t) {
      tex.water.offset.x = (t * 0.004) % 1;
      tex.water.offset.y = (t * 0.0025) % 1;
      for (const f of fogBanks) {
        f.position.x += f.userData.vx * dt;
        if (f.position.x > bounds[2] + 900) f.position.x = bounds[0] - 900;
      }
    },
  };
}

// Axis of the Bay Bridge: shore anchor point and unit direction toward Yerba Buena Island.
function bridgeFrame(meta) {
  let sx, sz, dx, dz;
  if (meta.bridge) {
    [sx, sz] = meta.bridge.shore;
    [dx, dz] = meta.bridge.dir;
  } else {
    // Fallback estimate: Rincon Point anchorage heading toward Yerba Buena Island.
    const [mx, mz] = meta.mPerDeg;
    const o = meta.origin;
    const P = (lat, lon) => [(lon - o.lon) * mx, -(lat - o.lat) * mz];
    [sx, sz] = P(37.7877, -122.3876);
    const [ex, ez] = P(37.8099, -122.3640);
    dx = ex - sx; dz = ez - sz;
  }
  const l = Math.hypot(dx, dz);
  dx /= l; dz /= l;
  return { sx, sz, dx, dz, px: -dz, pz: dx };
}

function buildBridge(world, B, steel, stone, mats, group, ladders, deckYAt) {
  const steelC = new THREE.Color('#b4bcc2');
  const darkC = new THREE.Color('#7f888f');
  const stoneC = new THREE.Color('#bdb6a8');
  const at = (u, v) => [B.sx + B.dx * u + B.px * v, B.sz + B.dz * u + B.pz * v];
  const hw = BRIDGE.halfWidth;

  // Approach ramp: smooth visual slab, fine collision steps.
  const segLen = 1.2;
  for (let u = -BRIDGE.rampLen; u < 0; u += segLen) {
    const y1 = deckYAt(u + segLen / 2);
    const [cx, cz] = at(u + segLen / 2, 0);
    world.addBox(cx, cz, B.dx, B.dz, segLen / 2 + 0.05, hw, y1 - 2.5, y1, { kind: 'bridge' });
  }
  for (let u = -BRIDGE.rampLen; u < 0; u += 12) {
    const u2 = Math.min(0, u + 12);
    const ya = deckYAt(u), yb = deckYAt(u2);
    const a1 = at(u, -hw), a2 = at(u, hw), b1 = at(u2, -hw), b2 = at(u2, hw);
    const up = [0, 1, 0];
    steel.quad([a1[0], ya, a1[1]], [a2[0], ya, a2[1]], [b2[0], yb, b2[1]], [b1[0], yb, b1[1]], up,
      [[0, 0], [1, 0], [1, 1], [0, 1]], darkC);
    // underside + sides
    steel.quad([a1[0], ya - 2.4, a1[1]], [a2[0], ya - 2.4, a2[1]], [b2[0], yb - 2.4, b2[1]], [b1[0], yb - 2.4, b1[1]], [0, -1, 0],
      [[0, 0], [1, 0], [1, 1], [0, 1]], steelC);
    for (const s of [-1, 1]) {
      const p1 = at(u, s * hw), p2 = at(u2, s * hw);
      steel.quad([p1[0], ya - 2.4, p1[1]], [p2[0], yb - 2.4, p2[1]], [p2[0], yb + 1.1, p2[1]], [p1[0], ya + 1.1, p1[1]],
        [B.px * s, 0, B.pz * s], [[0, 0], [1, 0], [1, 1], [0, 1]], steelC);
    }
    // support columns
    if (ya > 6) {
      for (const s of [-0.6, 0.6]) {
        const [px, pz] = at(u, s * hw);
        stone.box(px, 0, pz, B.dx, B.dz, 1.2, 1.2, ya - 2.4, stoneC);
        world.addBox(px, pz, B.dx, B.dz, 1.2, 1.2, 0, ya - 2.4, { kind: 'bridge' });
      }
    }
  }

  // Main deck over the water with a truss below and railings.
  const deckLen = BRIDGE.centreU;
  const [mx, mz] = at(deckLen / 2, 0);
  world.addBox(mx, mz, B.dx, B.dz, deckLen / 2, hw, BRIDGE.deckY - 6, BRIDGE.deckY, { kind: 'bridge' });
  steel.box(mx, BRIDGE.deckY - 0.3, mz, B.dx, B.dz, deckLen / 2, hw, BRIDGE.deckY, darkC);
  steel.box(mx, BRIDGE.deckY - 6, mz, B.dx, B.dz, deckLen / 2, hw - 1, BRIDGE.deckY - 0.3, steelC);
  for (const s of [-1, 1]) {
    const [rx, rz] = at(deckLen / 2, s * (hw - 0.2));
    world.addBox(rx, rz, B.dx, B.dz, deckLen / 2, 0.2, BRIDGE.deckY, BRIDGE.deckY + 1.15, { kind: 'rail', noMantle: false });
    steel.box(rx, BRIDGE.deckY, rz, B.dx, B.dz, deckLen / 2, 0.15, BRIDGE.deckY + 1.15, steelC);
  }
  // Lane stripes.
  for (let u = 4; u < deckLen; u += 14) {
    for (const v of [-4, 4]) {
      const [x, z] = at(u, v);
      steel.box(x, BRIDGE.deckY + 0.01, z, B.dx, B.dz, 2.5, 0.12, BRIDGE.deckY + 0.02, new THREE.Color('#e8e2d0'));
    }
  }

  // Shore anchorage: two blocks either side of the deck that the cables tie into.
  const anchorTop = BRIDGE.deckY + 8;
  for (const s of [-1, 1]) {
    const [ax, az] = at(5, s * (hw + 6));
    stone.box(ax, -4, az, B.dx, B.dz, 16, 6, anchorTop, stoneC);
    world.addBox(ax, az, B.dx, B.dz, 16, 6, -4, anchorTop, { kind: 'bridge' });
    const [lx, lz] = at(5, s * hw);
    ladders.push({ x: lx, z: lz, nx: -B.px * s, nz: -B.pz * s, tx: B.dx, tz: B.dz, y0: BRIDGE.deckY, y1: anchorTop });
  }

  // Towers.
  const T = BRIDGE.towerTop;
  for (const tu of BRIDGE.towers) {
    for (const s of [-1, 1]) {
      const [lx, lz] = at(tu, s * (hw + 2.5));
      steel.box(lx, -2, lz, B.dx, B.dz, 3.5, 2.5, T, steelC);
      world.addBox(lx, lz, B.dx, B.dz, 3.5, 2.5, -2, T, { kind: 'bridge' });
      // Ladder on the inner face, from deck to tower top.
      const [fx, fz] = at(tu, s * hw);
      ladders.push({ x: fx, z: fz, nx: -B.px * s, nz: -B.pz * s, tx: B.dx, tz: B.dz, y0: BRIDGE.deckY, y1: T });
    }
    for (const [y0, y1] of [[90, 94], [122, 126], [T - 4, T]]) {
      const [cx, cz] = at(tu, 0);
      steel.box(cx, y0, cz, B.dx, B.dz, 2.5, hw + 5, y1, steelC);
      world.addBox(cx, cz, B.dx, B.dz, 2.5, hw + 5, y0, y1, { kind: 'bridge' });
    }
    // Concrete pier at the waterline.
    const [px, pz] = at(tu, 0);
    stone.box(px, -12, pz, B.dx, B.dz, 9, hw + 9, 2, stoneC);
    world.addBox(px, pz, B.dx, B.dz, 9, hw + 9, -12, 2, { kind: 'bridge' });
  }

  // Centre anchorage at the end of the playable span.
  {
    const cu = BRIDGE.centreU + 22;
    const [cx, cz] = at(cu, 0);
    stone.box(cx, -10, cz, B.dx, B.dz, 22, hw + 16, 76, stoneC);
    world.addBox(cx, cz, B.dx, B.dz, 22, hw + 16, -10, 76, { kind: 'bridge' });
    const [lx, lz] = at(BRIDGE.centreU, 0);
    ladders.push({ x: lx, z: lz, nx: -B.dx, nz: -B.dz, tx: B.px, tz: B.pz, y0: BRIDGE.deckY, y1: 76 });
  }

  // Main cables: walkable. Parabolic sag between saddles.
  const spans = [
    [0, anchorTop - 0.3, BRIDGE.towers[0], T + 0.6, 7],
    [BRIDGE.towers[0], T + 0.6, BRIDGE.towers[1], T + 0.6, 88],
    [BRIDGE.towers[1], T + 0.6, BRIDGE.centreU + 4, 76, 7],
  ];
  const cableY = (u) => {
    for (const [u0, y0, u1, y1, sag] of spans) {
      if (u >= u0 && u <= u1) {
        const t = (u - u0) / (u1 - u0);
        return y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
      }
    }
    return null;
  };
  const cablePts = { '-1': [], '1': [] };
  for (const s of [-1, 1]) {
    const v = s * (hw + 0.5);
    for (let u = 0; u <= BRIDGE.centreU + 4; u += 0.5) {
      const y = cableY(u);
      const [x, z] = at(u + 0.25, v);
      const yc = cableY(Math.min(BRIDGE.centreU + 4, u + 0.25));
      world.addBox(x, z, B.dx, B.dz, 0.3, 0.75, yc - 1.6, yc + 0.7, { kind: 'cable', noMantle: true });
      if (Math.round(u * 2) % 16 === 0) cablePts[s].push(new THREE.Vector3(...at(u, v).slice(0, 1), y, at(u, v)[1]));
    }
  }
  const cableGeoms = [];
  for (const s of ['-1', '1']) {
    const pts = cablePts[s].map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(pts);
    cableGeoms.push(new THREE.TubeGeometry(curve, pts.length * 2, 0.75, 8, false));
    // Suspender ropes.
    for (let u = 15; u < BRIDGE.centreU; u += 15) {
      const y = cableY(u);
      if (y - BRIDGE.deckY < 2) continue;
      const [x, z] = at(u, Number(s) * (hw + 0.5));
      const g = new THREE.CylinderGeometry(0.08, 0.08, y - BRIDGE.deckY, 4);
      g.translate(x, BRIDGE.deckY + (y - BRIDGE.deckY) / 2, z);
      cableGeoms.push(g);
    }
  }
  const cables = new THREE.Mesh(mergeGeometries(cableGeoms.map((g) => g.toNonIndexed ? g.toNonIndexed() : g)), mats.cable);
  cables.castShadow = true;
  group.add(cables);

  return { at, cableY, deckY: BRIDGE.deckY, anchorTop, towerTop: T };
}

function buildFerryTower(world, stone, mats, tex, group, ladders, map) {
  // Tower axis lines up with Market Street, which runs south-west from the tower.
  const ax = Math.SQRT1_2, az = -Math.SQRT1_2; // toward north-east (the bay)
  const cream = new THREE.Color('#ebe4d2');
  const trim = new THREE.Color('#cfc5ae');
  const stages = [
    [0, 50, 8.5], [50, 64, 6.5], [64, 72, 4.6], [72, 80, 2.4],
  ];
  const at = (u, v) => [ax * u - az * v, az * u + ax * v];
  for (const [y0, y1, hwid] of stages) {
    const color = y0 === 0 ? cream : trim;
    stone.box(0, y0, 0, ax, az, hwid, hwid, y1, color);
    world.addBox(0, 0, ax, az, hwid, hwid, y0, y1, { kind: 'building', name: 'Ferry Building clock tower' });
  }
  // Clock faces on the second stage.
  const faceMat = new THREE.MeshStandardMaterial({ map: tex.clock, roughness: 0.6 });
  const faceGeo = new THREE.PlaneGeometry(8, 8);
  const dirs = [[ax, az], [-ax, -az], [-az, ax], [az, -ax]];
  for (const [dx, dz] of dirs) {
    const m = new THREE.Mesh(faceGeo, faceMat);
    m.position.set(dx * 6.55, 57, dz * 6.55);
    m.lookAt(dx * 20, 57, dz * 20);
    group.add(m);
  }
  // Flag pole on top.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), mats.steel);
  pole.position.set(0, 84, 0);
  group.add(pole);

  // Ladders: the plaza side (facing Market St) all the way up, stage by stage.
  const sx = -ax, sz = -az; // outward normal of the plaza face
  for (const [y0, y1, hwid] of stages.slice(0, 3)) {
    // Start each ladder on whatever the runner can stand on in front of that face
    // (the Ferry Building roof wraps around the tower base in the real data).
    const foot = world.floorAt(sx * (hwid + 1.0), sz * (hwid + 1.0), y1 - 1, 0);
    ladders.push({ x: sx * (hwid + 0.05), z: sz * (hwid + 0.05), nx: sx, nz: sz, tx: -sz, tz: sx, y0: Math.max(foot.y, y0), y1 });
  }
  // A ladder up the Ferry Building facade, straight ahead of the plaza.
  for (let d = 60; d > 9; d -= 0.5) {
    const px = sx * d, pz = sz * d;
    const hit = world.pointBlocked(px, 1, pz);
    if (!hit) continue;
    if (hit.kind === 'building' && hit.y1 < 45) {
      const c = closestOnSolid(hit, sx * (d + 0.5), sz * (d + 0.5), { x: 0, z: 0, d2: 0, edge: 0 });
      const nx = hit.nxs[c.edge], nz = hit.nzs[c.edge];
      ladders.push({ x: c.x + nx * 0.05, z: c.z + nz * 0.05, nx, nz, tx: -nz, tz: nx, y0: 0, y1: hit.y1 });
    }
    break;
  }
  return { x: 0, z: 0, top: 80, plaza: [sx * 40, sz * 40], face: [sx, sz], at };
}

function ladderMesh(ladders, mat) {
  const pos = [], uv = [], nor = [];
  for (const L of ladders) {
    const w = 0.42;
    const ox = L.x + L.nx * 0.06, oz = L.z + L.nz * 0.06;
    const a = [ox - L.tx * w, oz - L.tz * w], b = [ox + L.tx * w, oz + L.tz * w];
    const v0 = L.y0 / 1.2, v1 = L.y1 / 1.2;
    const quad = [
      [a[0], L.y0, a[1], 0, v0], [b[0], L.y0, b[1], 1, v0], [b[0], L.y1, b[1], 1, v1],
      [a[0], L.y0, a[1], 0, v0], [b[0], L.y1, b[1], 1, v1], [a[0], L.y1, a[1], 0, v1],
    ];
    for (const q of quad) {
      pos.push(q[0], q[1], q[2]); uv.push(q[3], q[4]); nor.push(L.nx, 0, L.nz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function buildZiplines(world, items, landmarks) {
  const zips = [];
  const starts = [];
  const tall = items.filter((it) => it.b.h > 16 && !(it.b.b > 0)).sort((a, b) => b.b.h - a.b.h);
  const used = new Set();
  const push = (ax, ay, az, bx, by, bz, tag) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    zips.push({ ax, ay, az, bx, by, bz, dx: dx / len, dy: dy / len, dz: dz / len, len, tag });
  };
  const edgePoint = (s, tx, tz, inset) => {
    // Point on s's boundary closest to (tx,tz), pulled inward.
    let best = Infinity, bx = 0, bz = 0, nx = 0, nz = 0;
    for (let i = 0; i < s.n; i++) {
      const j = (i + 1) % s.n;
      const ax = s.xs[i], az = s.zs[i];
      const ex = s.xs[j] - ax, ez = s.zs[j] - az;
      const l2 = ex * ex + ez * ez || 1;
      let t = ((tx - ax) * ex + (tz - az) * ez) / l2;
      t = Math.max(0.15, Math.min(0.85, t));
      const px = ax + ex * t, pz = az + ez * t;
      const d = (px - tx) ** 2 + (pz - tz) ** 2;
      if (d < best) { best = d; bx = px; bz = pz; nx = s.nxs[i]; nz = s.nzs[i]; }
    }
    return [bx - nx * inset, bz - nz * inset];
  };
  for (const A of tall) {
    if (zips.length >= 90) break;
    if (used.has(A.s.id)) continue;
    if (starts.some(([x, z]) => Math.hypot(x - A.cx, z - A.cz) < 45)) continue;
    let best = null;
    for (const Bt of items) {
      if (Bt === A || Bt.b.b > 0) continue;
      const d = Math.hypot(Bt.cx - A.cx, Bt.cz - A.cz);
      if (d < 22 || d > 110) continue;
      const drop = A.b.h - Bt.b.h;
      if (drop < 4 || drop / d < 0.07 || drop / d > 0.55) continue;
      const score = d * 0.6 + Math.abs(drop / d - 0.2) * 80 + hash(A.i + Bt.i) * 10;
      if (!best || score < best.score) best = { Bt, score };
    }
    if (!best) continue;
    const Bt = best.Bt;
    const [sx, sz] = edgePoint(A.s, Bt.cx, Bt.cz, 1.6);
    const [ex, ez] = edgePoint(Bt.s, A.cx, A.cz, 2.4);
    if (!pointInSolid(A.s, sx, sz) || !pointInSolid(Bt.s, ex, ez)) continue;
    const ay = A.b.h + 2.7, by = Bt.b.h + 2.7;
    // Make sure nothing is in the way (ignoring the ends).
    let clear = true;
    const n = 24;
    for (let k = 2; k < n - 1; k++) {
      const t = k / n;
      const x = sx + (ex - sx) * t, y = ay + (by - ay) * t, z = sz + (ez - sz) * t;
      if (world.pointBlocked(x, y, z) || world.pointBlocked(x, y - 2.2, z)) { clear = false; break; }
    }
    if (!clear) continue;
    push(sx, ay, sz, ex, by, ez, 'roof');
    used.add(A.s.id);
    starts.push([A.cx, A.cz]);
  }
  // Signature line: bridge tower top down to the Ferry Building clock tower.
  const bi = landmarks.bridgeInfo;
  if (bi) {
    const [tx, tz] = bi.at(BRIDGE.towers[0] - 2, 0);
    // Land on the clock tower's upper balcony (the 72 m roof, outside the spire).
    const l = Math.hypot(tx, tz);
    const ex = (tx / l) * 3.7, ez = (tz / l) * 3.7;
    push(tx, bi.towerTop + 2.7, tz, ex, 72 + 2.55, ez, 'signature');
  }
  return zips;
}

function ziplineMeshes(zips, mats) {
  const lineGeoms = [], poleGeoms = [];
  for (const Z of zips) {
    const g = new THREE.CylinderGeometry(0.05, 0.05, Z.len, 4, 1, true);
    g.translate(0, Z.len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Z.dx, Z.dy, Z.dz));
    g.applyQuaternion(q);
    g.translate(Z.ax, Z.ay, Z.az);
    lineGeoms.push(g);
    for (const [x, y, z] of [[Z.ax, Z.ay, Z.az], [Z.bx, Z.by, Z.bz]]) {
      const p = new THREE.CylinderGeometry(0.11, 0.14, 3, 6);
      p.translate(x, y - 1.4, z);
      poleGeoms.push(p);
    }
  }
  if (!lineGeoms.length) return null;
  const grp = new THREE.Group();
  const lines = new THREE.Mesh(mergeGeometries(lineGeoms), mats.zip);
  const poles = new THREE.Mesh(mergeGeometries(poleGeoms), mats.pole);
  poles.castShadow = true;
  grp.add(lines, poles);
  return grp;
}

function addPalms(map, world, group) {
  const spots = [];
  for (const r of map.roads) {
    if (!r.n || !/embarcadero/i.test(r.n)) continue;
    let carry = 0;
    for (let i = 1; i < r.p.length; i++) {
      const a = r.p[i - 1], b = r.p[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      for (let d = carry; d < len; d += 24) {
        for (const side of [-1, 1]) {
          const off = r.w / 2 + 3;
          const x = a[0] + dx * d - dz * off * side, z = a[1] + dz * d + dx * off * side;
          const f = world.floorAt(x, z, 0.5, 0);
          if (!f.solid || f.solid.kind !== 'land') continue;
          if (world.pointBlocked(x, 2, z)) continue;
          if (spots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < 100)) continue;
          spots.push([x, z]);
        }
      }
      carry = (carry + 24 - (len % 24)) % 24;
    }
  }
  if (!spots.length) return;
  const trunkG = new THREE.CylinderGeometry(0.28, 0.42, 9, 6);
  trunkG.translate(0, 4.5, 0);
  const fronds = [];
  for (let k = 0; k < 7; k++) {
    const f = new THREE.ConeGeometry(0.7, 4.2, 4);
    f.translate(0, 2.1, 0);
    f.rotateZ(Math.PI / 2 + 0.35);
    f.rotateY((k / 7) * Math.PI * 2);
    f.translate(0, 9, 0);
    fronds.push(f);
  }
  const crownG = mergeGeometries(fronds);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 1 }), spots.length);
  const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0x55703f, roughness: 0.9 }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    const s = 0.85 + hash(i) * 0.4;
    m.makeRotationY(hash(i * 3) * 6.28);
    m.scale(new THREE.Vector3(s, s, s));
    m.setPosition(x, 0, z);
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
  });
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);
}

function addFogBanks(group, puff, bounds) {
  const banks = [];
  const mat = new THREE.SpriteMaterial({ map: puff, color: 0xe4e8ea, transparent: true, depthWrite: false, opacity: 0.7, fog: true });
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Sprite(mat);
    const r1 = hash(i * 2.1), r2 = hash(i * 5.3), r3 = hash(i * 9.7);
    // Mostly over the bay (east / north) where fog actually rolls in.
    s.position.set(
      bounds[0] + r1 * (bounds[2] - bounds[0] + 1400) - 200,
      30 + r3 * 110,
      bounds[1] - 400 + r2 * (bounds[3] - bounds[1] + 400),
    );
    const sc = 160 + r3 * 260;
    s.scale.set(sc, sc * 0.45, 1);
    s.userData.vx = 2 + r2 * 3;
    group.add(s);
    banks.push(s);
  }
  return banks;
}
