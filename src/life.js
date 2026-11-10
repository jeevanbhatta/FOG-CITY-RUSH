import * as THREE from 'three';

// Background life: cars cruising the real street network and gulls wheeling over the piers.
// Traffic slows for whatever is in its lane (honking if you dawdle), can be borrowed, and
// reports where each car is so the game can handle bumps and near misses.

const TRAFFIC_COLORS = [0xd8d4cc, 0x2f3a44, 0x8a1f1f, 0x355f7a, 0xc9b26a, 0x6b6f73, 0xf2efe6, 0x1f2a24];

export class Traffic {
  constructor(scene, roads, count) {
    const routes = [];
    for (const r of roads) {
      if (!['primary', 'secondary', 'tertiary', 'trunk', 'residential'].includes(r.k)) continue;
      let len = 0;
      for (let i = 1; i < r.p.length; i++) len += Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]);
      if (len < 160) continue;
      routes.push({ p: r.p, len, w: r.w });
    }
    routes.sort((a, b) => b.len - a.len);
    this.routes = routes.slice(0, 60);
    const bodyG = new THREE.BoxGeometry(1.8, 0.75, 4.2);
    bodyG.translate(0, 0.72, 0);
    const cabG = new THREE.BoxGeometry(1.6, 0.6, 2.1);
    cabG.translate(0, 1.38, -0.3);
    this.max = 40;
    this.body = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }), this.max);
    this.cab = new THREE.InstancedMesh(cabG, new THREE.MeshStandardMaterial({ color: 0x2b3742, roughness: 0.2, metalness: 0.4 }), this.max);
    this.body.castShadow = this.cab.castShadow = true;
    this.body.frustumCulled = this.cab.frustumCulled = false;
    scene.add(this.body, this.cab);
    this.cars = [];
    const c = new THREE.Color();
    for (let i = 0; i < this.max && this.routes.length; i++) {
      const route = this.routes[i % this.routes.length];
      const cruise = 8 + Math.random() * 6;
      this.cars.push({
        i, route, s: Math.random() * route.len, dir: i % 2 ? 1 : -1, cruise, speed: cruise,
        color: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length], x: 0, z: 0, fx: 0, fz: 1,
        taken: 0, blocked: 0, honked: 0, bumped: 0,
      });
      this.body.setColorAt(i, c.set(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]));
    }
    this.setCount(count);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  setCount(n) {
    this.count = Math.min(n, this.cars.length);
    this.body.count = this.cab.count = this.count;
  }

  at(route, s) {
    let acc = 0;
    const p = route.p;
    for (let i = 1; i < p.length; i++) {
      const dx = p[i][0] - p[i - 1][0], dz = p[i][1] - p[i - 1][1];
      const l = Math.hypot(dx, dz);
      if (acc + l >= s || i === p.length - 1) {
        const t = Math.min(1, Math.max(0, (s - acc) / (l || 1)));
        return [p[i - 1][0] + dx * t, p[i - 1][1] + dz * t, dx / (l || 1), dz / (l || 1)];
      }
      acc += l;
    }
    return [p[0][0], p[0][1], 1, 0];
  }

  // Hand a car over to the player: it leaves traffic (and comes back a while later).
  take(car) {
    car.taken = 45;
    return { x: car.x, z: car.z, heading: Math.atan2(car.fx, car.fz), color: car.color };
  }

  // obstacles: [{x, z}] things traffic should not drive into (you, your car).
  // Returns honks: [{x, z}] for cars that have been held up a while.
  update(dt, obstacles = []) {
    const honks = [];
    for (let i = 0; i < this.count; i++) {
      const car = this.cars[i];
      if (car.taken > 0) {
        car.taken -= dt;
        this.m.makeScale(0, 0, 0);
        this.body.setMatrixAt(i, this.m);
        this.cab.setMatrixAt(i, this.m);
        car.x = car.z = 1e9;
        continue;
      }
      // Brake for anything a few car lengths ahead in the lane; honk if it doesn't move.
      let want = car.cruise;
      for (const o of obstacles) {
        const dx = o.x - car.x, dz = o.z - car.z;
        const ahead = dx * car.fx + dz * car.fz, side = Math.abs(dx * car.fz - dz * car.fx);
        if (ahead > 0 && ahead < 16 && side < 2.4) want = Math.min(want, Math.max(0, (ahead - 5) * 0.8));
      }
      if (car.bumped > 0) { car.bumped -= dt; want = 0; }
      car.speed += (want - car.speed) * Math.min(1, dt * (want < car.speed ? 4 : 1.2));
      if (car.speed < 0.5 && want < 0.5) {
        car.blocked += dt;
        car.honked -= dt;
        if (car.blocked > 1.5 && car.honked <= 0) { honks.push({ x: car.x, z: car.z }); car.honked = 2.5 + Math.random() * 2; }
      } else car.blocked = 0;
      car.s += car.speed * car.dir * dt;
      if (car.s > car.route.len) { car.s = car.route.len; car.dir = -1; }
      if (car.s < 0) { car.s = 0; car.dir = 1; }
      const [x, z, dx, dz] = this.at(car.route, car.s);
      const fx = dx * car.dir, fz = dz * car.dir;
      // Drive on the right-hand side of the road.
      const off = Math.min(3, car.route.w / 4);
      const px = x - fz * off, pz = z + fx * off;
      car.x = px; car.z = pz; car.fx = fx; car.fz = fz;
      this.q.setFromAxisAngle(this.up, Math.atan2(fx, fz));
      this.m.compose(new THREE.Vector3(px, 0.02, pz), this.q, new THREE.Vector3(1, 1, 1));
      this.body.setMatrixAt(i, this.m);
      this.cab.setMatrixAt(i, this.m);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.cab.instanceMatrix.needsUpdate = true;
    return honks;
  }

  // Nearest car (within r) to a point.
  nearest(x, z, r) {
    let best = null, bd = r * r;
    for (let i = 0; i < this.count; i++) {
      const c = this.cars[i];
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}

export class Gulls {
  constructor(scene, centres) {
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.8, side: THREE.DoubleSide });
    const grey = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.8, side: THREE.DoubleSide });
    this.birds = [];
    let k = 0;
    for (const [cx, cz] of centres) {
      for (let j = 0; j < 6; j++, k++) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.6), white);
        g.add(body);
        const wings = [];
        for (const side of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.x = side * 0.08;
          const w = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.28), j % 3 ? white : grey);
          w.rotation.x = -Math.PI / 2;
          w.position.x = side * 0.38;
          pivot.add(w);
          g.add(pivot);
          wings.push([pivot, side]);
        }
        scene.add(g);
        this.birds.push({
          g, wings, cx: cx + (Math.random() - 0.5) * 40, cz: cz + (Math.random() - 0.5) * 40,
          r: 18 + Math.random() * 40, h: 14 + Math.random() * 30, a: Math.random() * 6.28,
          w: (0.25 + Math.random() * 0.2) * (Math.random() < 0.5 ? 1 : -1), flap: Math.random() * 6,
        });
      }
    }
  }

  update(dt, t) {
    for (const b of this.birds) {
      b.a += b.w * dt;
      b.flap += dt * 9;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
      const y = b.h + Math.sin(t * 0.5 + b.r) * 3;
      b.g.position.set(x, y, z);
      // Face along the circle, banked into the turn.
      const dir = Math.sign(b.w);
      b.g.rotation.set(0, Math.atan2(-Math.sin(b.a) * dir, Math.cos(b.a) * dir), -dir * 0.3);
      // Flap in bursts, glide in between.
      const flapping = Math.sin(t * 0.7 + b.r) > 0;
      const ang = flapping ? Math.sin(b.flap) * 0.6 : 0.1;
      for (const [p, side] of b.wings) p.rotation.z = side * ang;
    }
  }
}
