import * as THREE from 'three';
import { pointInSolid, closestOnSolid } from './physics.js';

const WATER_Y = -1.6;
const _c = { x: 0, z: 0, d2: 0, edge: 0 };

// Push a circle out of any solid it overlaps between yLow and yHigh.
// Returns the strongest contact normal, or null.
function resolveCircle(world, p, r, yLow, yHigh, vel, bounce = 0) {
  const list = world.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1);
  let hit = null;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.y1 <= yLow || s.y0 >= yHigh) continue;
      if (p.x + r < s.minX || p.x - r > s.maxX || p.z + r < s.minZ || p.z - r > s.maxZ) continue;
      const inside = pointInSolid(s, p.x, p.z);
      closestOnSolid(s, p.x, p.z, _c);
      if (!inside && _c.d2 >= r * r) continue;
      let nx, nz;
      if (inside) {
        nx = s.nxs[_c.edge]; nz = s.nzs[_c.edge];
        p.x = _c.x + nx * (r + 0.001); p.z = _c.z + nz * (r + 0.001);
      } else {
        const d = Math.sqrt(_c.d2) || 0.0001;
        nx = (p.x - _c.x) / d; nz = (p.z - _c.z) / d;
        p.x = _c.x + nx * r; p.z = _c.z + nz * r;
      }
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= nx * vn * (1 + bounce);
        vel.z -= nz * vn * (1 + bounce);
        if (!hit || -vn > hit.impact) hit = { nx, nz, impact: -vn };
      }
      moved = true;
    }
    if (!moved) break;
  }
  return hit;
}

// ---------------------------------------------------------------- Car

export const CAR = {
  accel: 16, brake: 34, reverseMax: 11, max: 44, drag: 0.012, roll: 1.2,
  grip: 9, driftGrip: 1.6, steerRate: 2.4, step: 0.85, gravity: 26,
  boostRefill: 0.08, armour: 1, // garage upgrades change these
};

export class Car {
  constructor(scene, x, y, z, heading, color = 0xe8552b) {
    this.kind = 'car';
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.heading = heading;
    this.home = { pos: this.pos.clone(), heading };
    this.onGround = true;
    this.steer = 0;
    this.drifting = false;
    this.wheelSpin = 0;
    this.impact = 0;
    this.health = 100;   // knocks wear it down; at zero the car is wrecked
    this.boost = 1;      // nitro tank, 0..1
    this.boosting = false;
    this.braking = false;
    this.color = color;
    this.mesh = buildCarMesh(color);
    scene.add(this.mesh);
    this.sync(0);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading); }

  place(pos, heading) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.steer = 0;
    this.sync(0);
  }

  repair() {
    this.health = 100;
    this.boost = 1;
    this.mesh.userData.paint.color.set(this.color);
  }

  // Dent the car. Paint darkens as it wears.
  damage(n) {
    this.health = Math.max(0, this.health - n * CAR.armour);
    const k = 0.45 + 0.55 * (this.health / 100);
    this.mesh.userData.paint.color.set(this.color).multiplyScalar(k);
  }

  // Headlights at dusk, brake lights when slowing (and dimly at night).
  setLights(night) {
    const u = this.mesh.userData;
    u.lamp.emissiveIntensity = 0.6 + night * 2.4;
    u.tail.emissiveIntensity = this.braking ? 2.2 : 0.25 + night * 0.9;
  }

  update(dt, ctl, world) {
    const steps = Math.min(8, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    this.impact = 0;
    for (let i = 0; i < steps; i++) this.step(h, ctl, world);
    this.sync(dt);
  }

  step(h, ctl, world) {
    const C = CAR;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const rx = -ch, rz = sh; // right vector
    let fs = this.vel.x * sh + this.vel.z * ch;
    let lat = this.vel.x * rx + this.vel.z * rz;
    const thr = ctl.throttle, steerIn = ctl.steer;
    // Nitro: hold boost with throttle to dump the tank into a burst of speed.
    this.boosting = !!ctl.boost && this.boost > 0.02 && thr > 0 && this.onGround;
    if (this.boosting) { this.boost = Math.max(0, this.boost - 0.32 * h); fs += 15 * h; }
    else this.boost = Math.min(1, this.boost + C.boostRefill * h);
    this.braking = (thr < 0 && fs > 0.5) || (thr > 0 && fs < -0.5) || !!ctl.handbrake;
    const top = this.boosting ? C.max * 1.35 : C.max;

    if (this.onGround) {
      if (thr > 0) {
        if (fs < -0.5) fs += C.brake * thr * h;
        else if (fs < top) fs += C.accel * thr * (1 - Math.max(0, fs) / (top * 1.15)) * h;
      } else if (thr < 0) {
        if (fs > 0.5) fs += C.brake * thr * h;
        else if (fs > -C.reverseMax) fs += C.accel * 0.7 * thr * h;
      }
      fs -= fs * C.drag * Math.abs(fs) * h * 0.1 + Math.sign(fs) * Math.min(Math.abs(fs), C.roll * h);
      this.drifting = ctl.handbrake && Math.abs(fs) > 8;
      if (ctl.handbrake) fs -= Math.sign(fs) * Math.min(Math.abs(fs), 6 * h);
      const grip = this.drifting ? C.driftGrip : C.grip;
      lat *= Math.exp(-grip * h);
      // Steering: smoother at speed, sharper during a handbrake slide.
      this.steer += (steerIn - this.steer) * Math.min(1, h * 8);
      const sp = Math.abs(fs);
      // Turn rate falls off with speed so the car stays planted on the boulevard.
      const rate = (C.steerRate * Math.min(1, sp / 6)) / (1 + sp / 18) * (this.drifting ? 1.5 : 1);
      this.heading -= this.steer * rate * Math.sign(fs || 1) * h;
    }
    const nsh = Math.sin(this.heading), nch = Math.cos(this.heading);
    const nrx = -nch, nrz = nsh;
    this.vel.x = nsh * fs + nrx * lat;
    this.vel.z = nch * fs + nrz * lat;
    this.vel.y -= C.gravity * h;

    this.pos.x += this.vel.x * h;
    this.pos.z += this.vel.z * h;
    // Two circles, front and back, against walls taller than a curb.
    let hit = null;
    for (const off of [1.35, -1.35]) {
      const c = new THREE.Vector3(this.pos.x + nsh * off, 0, this.pos.z + nch * off);
      const before = c.clone();
      const contact = resolveCircle(world, c, 1.05, this.pos.y + C.step, this.pos.y + 1.6, this.vel, 0.25);
      if (contact) {
        this.pos.x += c.x - before.x;
        this.pos.z += c.z - before.z;
        if (!hit || contact.impact > hit.impact) hit = contact;
      }
    }
    if (hit) this.impact = Math.max(this.impact, hit.impact);

    const prevY = this.pos.y;
    this.pos.y += this.vel.y * h;
    const fl = world.floorAt(this.pos.x, this.pos.z, prevY + C.step, 0.9);
    const snap = this.onGround ? 0.6 : 0;
    if (fl.solid && this.vel.y <= 0 && this.pos.y <= fl.y + snap) {
      this.pos.y = fl.y;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
  }

  sync(dt) {
    const m = this.mesh;
    m.position.copy(this.pos);
    m.rotation.y = this.heading;
    this.wheelSpin += this.forwardSpeed * dt / 0.36;
    for (const w of m.userData.wheels) w.rotation.x = this.wheelSpin;
    for (const w of m.userData.front) w.rotation.y = this.steer * 0.45;
    const lean = this.onGround ? -this.steer * Math.min(1, this.speed / 30) * 0.06 : 0;
    m.userData.body.rotation.z += (lean - m.userData.body.rotation.z) * Math.min(1, dt * 8);
  }
}

function buildCarMesh(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x24333d, roughness: 0.15, metalness: 0.4 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.9 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c4, emissiveIntensity: 0.6 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x8a1a14, emissive: 0xff2a1a, emissiveIntensity: 0.25 });
  const body = new THREE.Group();
  body.position.y = 0.0;
  g.add(body);
  const box = (w, h, l, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    body.add(m);
    return m;
  };
  box(1.9, 0.6, 4.2, paint, 0, 0.75, 0);
  box(1.92, 0.12, 4.22, white, 0, 0.98, 0); // stripe
  box(1.7, 0.62, 2.1, paint, 0, 1.36, -0.35);
  box(1.72, 0.5, 0.05, glass, 0, 1.38, 0.72).rotation.x = -0.35;
  box(1.74, 0.42, 1.7, glass, 0, 1.38, -0.4);
  box(0.4, 0.18, 0.06, lamp, -0.62, 0.82, 2.11);
  box(0.4, 0.18, 0.06, lamp, 0.62, 0.82, 2.11);
  box(1.2, 0.08, 0.5, white, 0, 1.7, -0.6); // roof sign
  box(0.42, 0.16, 0.06, tail, -0.62, 0.84, -2.11);
  box(0.42, 0.16, 0.06, tail, 0.62, 0.84, -2.11);
  const wheels = [], front = [];
  for (const [x, z] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.38, z);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14), tyre);
    w.rotation.z = Math.PI / 2;
    const spin = new THREE.Group();
    spin.add(w);
    pivot.add(spin);
    w.castShadow = true;
    g.add(pivot);
    wheels.push(spin);
    if (z > 0) front.push(pivot);
  }
  g.userData = { wheels, front, body, paint, lamp, tail };
  return g;
}

// ---------------------------------------------------------------- Seaplane

export const PLANE = {
  thrust: 24, drag: 0.0095, waterDrag: 0.028, stall: 21, takeoff: 27,
  pitchRate: 0.95, bankMax: 1.05, turnRate: 0.95, ceiling: 650, gravity: 9.8,
};

export class Seaplane {
  constructor(scene, x, z, heading, dock) {
    this.kind = 'plane';
    this.pos = new THREE.Vector3(x, WATER_Y + 0.15, z);
    this.vel = new THREE.Vector3();
    this.heading = heading;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.throttle = 0;
    this.state = 'water';
    this.dock = dock; // { pos, heading, shore: Vector3 }
    this.crashTimer = 0;
    this.prop = 0;
    this.mesh = buildPlaneMesh();
    scene.add(this.mesh);
    this.sync(0);
  }

  get onGround() { return this.state !== 'air'; }

  place(pos, heading, airborne = false, speed = 0) {
    this.pos.copy(pos);
    this.heading = heading;
    this.pitch = 0;
    this.roll = 0;
    this.speed = speed;
    this.throttle = airborne ? 0.75 : 0;
    this.state = airborne ? 'air' : 'water';
    if (!airborne) this.pos.y = WATER_Y + 0.15;
    this.crashTimer = 0;
    this.mesh.visible = true;
    this.sync(0);
  }

  resetToDock() {
    this.place(this.dock.pos, this.dock.heading);
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.heading) * cp, Math.sin(this.pitch), Math.cos(this.heading) * cp);
  }

  // ctl: { pitch (-1..1, +1 = nose up), bank (-1..1, +1 = right), throttleDelta, }
  update(dt, ctl, world, t) {
    this.events = [];
    if (this.state === 'crashed') {
      this.crashTimer -= dt;
      this.pos.y -= dt * 2;
      this.sync(dt, t);
      if (this.crashTimer <= 0) this.events.push('respawn');
      return;
    }
    const P = PLANE;
    this.throttle = Math.max(0, Math.min(1, this.throttle + ctl.throttleDelta * dt * 0.7));
    const thrust = this.throttle * P.thrust;

    if (this.state === 'water' || this.state === 'land') {
      const drag = this.state === 'water' ? P.waterDrag : P.waterDrag * 1.6;
      this.speed += (thrust - drag * this.speed * this.speed - 0.6 * Math.sign(this.speed)) * dt;
      if (this.speed < 0) this.speed = Math.max(this.speed, -2);
      if (this.throttle === 0 && Math.abs(this.speed) < 0.4) this.speed *= 0.9;
      this.heading -= ctl.bank * 0.75 * Math.min(1, Math.abs(this.speed) / 4 + 0.25) * dt;
      this.roll += (0 - this.roll) * Math.min(1, dt * 4);
      // Rotate for takeoff once fast enough.
      const wantPitch = this.speed > P.takeoff ? Math.max(0, ctl.pitch) * 0.25 : 0;
      this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 3);
      const f = this.forward();
      this.pos.x += f.x * this.speed * dt;
      this.pos.z += f.z * this.speed * dt;
      if (this.pitch > 0.12 && this.speed > P.takeoff) {
        this.state = 'air';
        this.events.push('Takeoff');
      } else if (this.state === 'water') {
        this.pos.y = WATER_Y + 0.15 + Math.sin(t * 1.7) * 0.05;
      }
      // Bump into piers and seawalls.
      const v = new THREE.Vector3(f.x * this.speed, 0, f.z * this.speed);
      const hit = resolveCircle(world, this.pos, 4.5, this.pos.y + 0.3, this.pos.y + 3, v, 0);
      if (hit) {
        this.speed *= 0.4;
        if (hit.impact > 14) return this.crash('Crashed into the pier');
      }
      // Run up onto land: only at walking pace.
      const fl = world.floorAt(this.pos.x, this.pos.z, this.pos.y + 1.2, 0);
      if (fl.solid && fl.y > WATER_Y + 0.5) {
        if (Math.abs(this.speed) > 12) return this.crash('Ran aground');
        this.state = 'land';
        this.pos.y = fl.y;
      } else if (this.state === 'land' && (!fl.solid || fl.y < WATER_Y + 0.5)) {
        this.state = 'water';
      }
    } else {
      // --- Flight ---
      this.pitch += ctl.pitch * P.pitchRate * dt;
      const bankWant = ctl.bank * P.bankMax;
      this.roll += (bankWant - this.roll) * Math.min(1, dt * 2.6);
      // Slow planes lose authority and drop their nose.
      if (this.speed < P.stall) {
        this.pitch -= (P.stall - this.speed) * 0.07 * dt;
        if (this.speed < P.stall * 0.8) this.events.push('Stall');
      }
      this.pitch = Math.max(-1.25, Math.min(1.1, this.pitch));
      const authority = Math.min(1, this.speed / 30);
      this.heading -= Math.sin(this.roll) * P.turnRate * authority * dt;
      this.speed += (thrust - P.drag * this.speed * this.speed - P.gravity * Math.sin(this.pitch)) * dt;
      this.speed = Math.max(4, this.speed);
      const f = this.forward();
      const sink = Math.max(0, P.stall - this.speed) * 0.55;
      this.pos.x += f.x * this.speed * dt;
      this.pos.y += f.y * this.speed * dt - sink * dt;
      this.pos.z += f.z * this.speed * dt;
      if (this.pos.y > P.ceiling) { this.pos.y = P.ceiling; this.pitch = Math.min(this.pitch, 0); }
      // Past the edge of the map the plane banks itself back toward the city.
      const b = this.bounds;
      if (b && (this.pos.x < b[0] || this.pos.x > b[2] || this.pos.z < b[1] || this.pos.z > b[3])) {
        const home = Math.atan2((b[0] + b[2]) / 2 - this.pos.x, (b[1] + b[3]) / 2 - this.pos.z);
        let dh = home - this.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.heading += Math.sign(dh) * Math.min(Math.abs(dh), 0.8 * dt);
        this.roll += (-Math.sign(dh) * 0.6 - this.roll) * Math.min(1, dt * 2);
        if (!this.warned) { this.events.push('Turning back to the city'); this.warned = true; }
      } else {
        this.warned = false;
      }

      // Collisions: nose, tail, wingtips, body.
      const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
      const wing = 6.5 * Math.cos(this.roll), wingY = 6.5 * Math.sin(this.roll);
      const pts = [
        [f.x * 4.5, f.y * 4.5, f.z * 4.5], [-f.x * 4.5, -f.y * 4.5 + 0.8, -f.z * 4.5], [0, 0, 0],
        [-ch * wing, -wingY, sh * wing], [ch * wing, wingY, -sh * wing],
      ];
      for (const [dx, dy, dz] of pts) {
        const hitS = world.pointBlocked(this.pos.x + dx, this.pos.y + dy + 1.2, this.pos.z + dz);
        if (hitS && hitS.kind !== 'land') return this.crash(hitS.kind === 'cable' || hitS.kind === 'bridge' ? 'Hit the bridge' : 'Hit a building');
      }
      // Touchdown on water or land.
      const fl = world.floorAt(this.pos.x, this.pos.z, this.pos.y + 1, 0);
      const groundY = fl.solid ? fl.y : WATER_Y + 0.15;
      if (this.pos.y <= groundY) {
        const vy = f.y * this.speed - sink;
        const gentle = vy > -7.5 && Math.abs(this.roll) < 0.4 && this.pitch > -0.25;
        if (fl.solid) {
          if (!gentle || this.speed > 30) return this.crash('Crash landing');
          this.state = 'land';
          this.pos.y = groundY;
        } else {
          if (!gentle) return this.crash('Crashed into the bay');
          this.state = 'water';
          this.speed *= 0.75;
          this.pos.y = groundY;
          this.events.push('Splashdown');
        }
        this.pitch = 0;
      }
    }
    this.vel.copy(this.forward()).multiplyScalar(this.speed);
    this.sync(dt, t);
  }

  crash(why) {
    this.state = 'crashed';
    this.crashTimer = 1.6;
    this.speed = 0;
    this.throttle = 0;
    this.events.push('crash:' + why);
    return null;
  }

  sync(dt, t = 0) {
    const m = this.mesh;
    m.position.copy(this.pos);
    m.rotation.set(0, 0, 0);
    m.rotation.order = 'YXZ';
    m.rotation.y = this.heading;
    m.rotation.x = -this.pitch;
    m.rotation.z = this.state === 'crashed' ? 0.9 : this.roll;
    this.prop += (6 + this.throttle * 60) * dt;
    m.userData.prop.rotation.z = this.prop;
  }
}

function buildPlaneMesh() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2b3f4c, roughness: 0.1, metalness: 0.5 });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  // Fuselage along +z.
  add(new THREE.BoxGeometry(1.4, 1.5, 7.5), white, 0, 2.6, 0);
  add(new THREE.BoxGeometry(1.42, 0.3, 7.52), orange, 0, 2.5, 0);
  add(new THREE.BoxGeometry(1.2, 0.7, 1.4), glass, 0, 3.25, 1.6);
  add(new THREE.BoxGeometry(1.0, 1.0, 1.0), white, 0, 2.6, 4.2);
  // Wings (high wing) and tail.
  add(new THREE.BoxGeometry(13, 0.18, 1.9), white, 0, 3.45, 0.9);
  add(new THREE.BoxGeometry(1.6, 0.2, 1.92), orange, -5.6, 3.47, 0.9);
  add(new THREE.BoxGeometry(1.6, 0.2, 1.92), orange, 5.6, 3.47, 0.9);
  add(new THREE.BoxGeometry(4.2, 0.14, 1.2), white, 0, 2.9, -3.5);
  add(new THREE.BoxGeometry(0.14, 1.8, 1.4), orange, 0, 3.7, -3.6);
  // Struts and floats.
  for (const x of [-1.5, 1.5]) {
    add(new THREE.BoxGeometry(0.6, 0.55, 6), white, x, 0.3, 0.4);
    add(new THREE.BoxGeometry(0.1, 1.6, 0.1), dark, x, 1.2, 1.6);
    add(new THREE.BoxGeometry(0.1, 1.6, 0.1), dark, x, 1.2, -0.8);
  }
  const prop = new THREE.Group();
  prop.position.set(0, 2.6, 4.75);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.06), dark);
  prop.add(blade);
  const blade2 = blade.clone();
  blade2.rotation.z = Math.PI / 2;
  prop.add(blade2);
  g.add(prop);
  g.userData = { prop };
  return g;
}

// ---------------------------------------------------------------- placement

// Finds a clear spot for a car near (x,z) at street level.
export function findParking(world, x, z, heading) {
  const sh = Math.sin(heading), ch = Math.cos(heading);
  for (let r = 0; r <= 60; r += 3) {
    const n = r === 0 ? 1 : Math.round(r * 1.2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      let ok = true, y = 0;
      for (const [fx, sx] of [[0, 0], [2.4, 1.2], [2.4, -1.2], [-2.4, 1.2], [-2.4, -1.2]]) {
        const qx = px + sh * fx - ch * sx, qz = pz + ch * fx + sh * sx;
        const fl = world.floorAt(qx, qz, 1.5, 0);
        if (!fl.solid || world.pointBlocked(qx, fl.y + 1, qz) || world.pointBlocked(qx, fl.y + 2.2, qz)) { ok = false; break; }
        y = Math.max(y, fl.y);
      }
      if (ok) return new THREE.Vector3(px, y, pz);
    }
  }
  return null;
}

// Finds open water near (x,z), heading away from shore.
export function findWater(world, x, z, dirX, dirZ) {
  for (let d = 0; d < 600; d += 6) {
    const px = x + dirX * d, pz = z + dirZ * d;
    let clear = true;
    for (let a = 0; a < 8 && clear; a++) {
      const qx = px + Math.cos(a) * 12, qz = pz + Math.sin(a) * 12;
      if (world.floorAt(qx, qz, 5, 0).solid || world.pointBlocked(qx, 1, qz)) clear = false;
    }
    if (clear && !world.floorAt(px, pz, 5, 0).solid) return new THREE.Vector3(px, WATER_Y + 0.15, pz);
  }
  return null;
}

export { WATER_Y };
