// Collision world made of vertical prisms: a 2D polygon footprint extruded from y0 to y1.
// Every solid in the game (land, piers, buildings, bridge pieces, cable steps) is one of these,
// which keeps collision simple and fast: circle-vs-polygon sideways, point-in-polygon for floors.

export class CollisionWorld {
  constructor(cellSize = 24) {
    this.cell = cellSize;
    this.grid = new Map();
    this.solids = [];
    this.ladders = [];
    this.ziplines = [];
    this.stamp = 1;
    this._tmp = [];
  }

  key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  addSolid(poly, y0, y1, opts = {}) {
    const n = poly.length;
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, area = 0;
    for (let i = 0; i < n; i++) {
      const x = poly[i][0], z = poly[i][1];
      xs[i] = x; zs[i] = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      const j = (i + 1) % n;
      area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    // Outward edge normals.
    const nxs = new Float64Array(n), nzs = new Float64Array(n);
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = xs[j] - xs[i], dz = zs[j] - zs[i];
      const len = Math.hypot(dx, dz) || 1;
      nxs[i] = (sign * dz) / len;
      nzs[i] = (-sign * dx) / len;
    }
    const s = {
      id: this.solids.length, xs, zs, nxs, nzs, n, y0, y1,
      minX, maxX, minZ, maxZ, mark: 0,
      kind: opts.kind || 'building',
      name: opts.name || null,
      noMantle: !!opts.noMantle,
    };
    this.solids.push(s);
    const c = this.cell;
    const cx0 = Math.floor(minX / c), cx1 = Math.floor(maxX / c);
    const cz0 = Math.floor(minZ / c), cz1 = Math.floor(maxZ / c);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = this.key(cx, cz);
        let list = this.grid.get(k);
        if (!list) { list = []; this.grid.set(k, list); }
        list.push(s);
      }
    }
    return s;
  }

  // Oriented rectangle helper: centre (x,z), half sizes along/across a direction.
  addBox(cx, cz, dirX, dirZ, halfLen, halfWid, y0, y1, opts) {
    const px = -dirZ, pz = dirX;
    const poly = [
      [cx - dirX * halfLen - px * halfWid, cz - dirZ * halfLen - pz * halfWid],
      [cx + dirX * halfLen - px * halfWid, cz + dirZ * halfLen - pz * halfWid],
      [cx + dirX * halfLen + px * halfWid, cz + dirZ * halfLen + pz * halfWid],
      [cx - dirX * halfLen + px * halfWid, cz - dirZ * halfLen + pz * halfWid],
    ];
    return this.addSolid(poly, y0, y1, opts);
  }

  query(minX, minZ, maxX, maxZ) {
    const out = this._tmp;
    out.length = 0;
    const stamp = ++this.stamp;
    const c = this.cell;
    const cx0 = Math.floor(minX / c), cx1 = Math.floor(maxX / c);
    const cz0 = Math.floor(minZ / c), cz1 = Math.floor(maxZ / c);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (s.mark === stamp) continue;
          s.mark = stamp;
          if (s.maxX < minX || s.minX > maxX || s.maxZ < minZ || s.minZ > maxZ) continue;
          out.push(s);
        }
      }
    }
    return out;
  }

  // Highest floor at or below maxY under point (x,z). Samples a small footprint so you
  // don't drop off an edge the instant your centre passes it.
  floorAt(x, z, maxY, radius = 0) {
    const r = radius;
    const list = this.query(x - r, z - r, x + r, z + r);
    let best = -Infinity, bestSolid = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y1 > maxY || s.y1 <= best) continue;
      if (pointInSolid(s, x, z) ||
          (r > 0 && (pointInSolid(s, x + r, z) || pointInSolid(s, x - r, z) ||
                     pointInSolid(s, x, z + r) || pointInSolid(s, x, z - r)))) {
        best = s.y1; bestSolid = s;
      }
    }
    return { y: best, solid: bestSolid };
  }

  // True when a point is inside any solid's volume.
  pointBlocked(x, y, z) {
    const list = this.query(x, z, x, z);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (y > s.y0 && y < s.y1 && pointInSolid(s, x, z)) return s;
    }
    return null;
  }

  // Lowest solid bottom strictly above y at (x,z) — used for ceilings.
  ceilingAt(x, z, y) {
    const list = this.query(x, z, x, z);
    let best = Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y0 > y && s.y0 < best && pointInSolid(s, x, z)) best = s.y0;
    }
    return best;
  }
}

export function pointInSolid(s, x, z) {
  if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) return false;
  const xs = s.xs, zs = s.zs, n = s.n;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const zi = zs[i], zj = zs[j];
    if ((zi > z) !== (zj > z)) {
      const xc = xs[i] + ((z - zi) * (xs[j] - xs[i])) / (zj - zi);
      if (x < xc) inside = !inside;
    }
  }
  return inside;
}

// Closest point on the polygon boundary. Writes into out: {x, z, d2, edge}.
export function closestOnSolid(s, x, z, out) {
  const xs = s.xs, zs = s.zs, n = s.n;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = xs[i], az = zs[i];
    const dx = xs[j] - ax, dz = zs[j] - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) {
      best = d2; out.x = px; out.z = pz; out.edge = i;
    }
  }
  out.d2 = best;
  return out;
}

// Ray march a segment and return the fraction (0..1) of the first blocked sample.
export function segmentClear(world, ax, ay, az, bx, by, bz, steps = 16, ignore = null) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const s = world.pointBlocked(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    if (s && s !== ignore) return (i - 1) / steps;
  }
  return 1;
}
