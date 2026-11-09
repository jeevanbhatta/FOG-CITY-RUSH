import * as THREE from 'three';
import { pointInSolid, closestOnSolid } from './physics.js';

export const TUNING = {
  radius: 0.38,
  height: 1.8,
  run: 8.4,
  sprint: 12.5,
  accGround: 70,
  accAir: 16,
  gravity: 28,
  jump: 10.2,
  step: 0.6,
  mantleReach: 2.6,
  wallRunMax: 1.6,
  zipMax: 36,
};

const T = TUNING;
const _c = { x: 0, z: 0, d2: 0, edge: 0 };

export class Player {
  constructor(world, scene) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.mode = 'normal';
    this.onGround = false;
    this.ground = null;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.wall = null; // last wall contact {solid,nx,nz,px,pz}
    this.wallTimer = 0;
    this.wallRunTime = 0;
    this.wallRunning = false;
    this.wallClimbReady = true;
    this.lastWallJumpSolid = null;
    this.slideTime = 0;
    this.stumble = 0;
    this.rollTime = 0;
    this.slidePressedAt = -1;
    this.time = 0;
    this.mantle = null;
    this.ladder = null;
    this.ladderCooldown = 0;
    this.zip = null;
    this.zipCooldown = 0;
    this.safe = new THREE.Vector3();
    this.safeTimer = 0;
    this.events = []; // short strings the HUD can show ("Roll", "Wall jump"...)
    this.prompt = null;
    this.bounds = null;
    this.avatar = new Avatar();
    scene.add(this.avatar.root);
  }

  reset(p, facing = 0) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.mode = 'normal';
    this.mantle = this.ladder = this.zip = null;
    this.onGround = false;
    this.slideTime = this.stumble = this.rollTime = 0;
    this.wallRunTime = 0;
    this.safe.copy(p);
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  emit(e) {
    this.events.push(e);
  }

  update(dt, input, camYaw) {
    // Frame-level input edges.
    if (input.jumpHit) this.jumpBuffer = 0.14;
    if (input.slideHit) this.slidePressedAt = this.time;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    const wx = fx * input.move.y + rx * input.move.x;
    const wz = fz * input.move.y + rz * input.move.x;
    const wishLen = Math.hypot(wx, wz);
    const sprint = input.sprint || (input.touchMove.active && wishLen > 0.92);
    const ctx = { input, wx, wz, wishLen, sprint, grab: input.grabHit, jumpHeld: input.jump };

    this.prompt = null;
    const steps = Math.min(8, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, ctx, i === 0);
    this.avatar.update(dt, this);
  }

  step(h, ctx, first) {
    this.time += h;
    this.jumpBuffer -= h;
    this.coyote -= h;
    this.wallTimer -= h;
    this.ladderCooldown -= h;
    this.zipCooldown -= h;
    this.stumble -= h;
    this.rollTime -= h;

    if (this.mode === 'mantle') return this.stepMantle(h);
    if (this.mode === 'climb') return this.stepClimb(h, ctx);
    if (this.mode === 'zip') return this.stepZip(h, ctx);

    const { wx, wz, wishLen, sprint } = ctx;
    const v = this.vel;

    // --- Horizontal control ---
    let target = wishLen * (sprint ? T.sprint : T.run);
    if (this.stumble > 0) target *= 0.45;
    const tvx = wishLen > 0 ? (wx / wishLen) * target : 0;
    const tvz = wishLen > 0 ? (wz / wishLen) * target : 0;

    if (this.onGround && this.slideTime > 0) {
      this.slideTime -= h;
      const sp = Math.hypot(v.x, v.z);
      const ns = Math.max(0, sp - 5.5 * h);
      if (sp > 0) { v.x *= ns / sp; v.z *= ns / sp; }
      // Gentle steering during a slide.
      v.x += (tvx * 0.25) * h * 4;
      v.z += (tvz * 0.25) * h * 4;
      if (ns < 4) this.slideTime = 0;
    } else {
      const acc = this.onGround ? T.accGround : T.accAir * (this.wallRunning ? 0.4 : 1);
      if (this.onGround || wishLen > 0) {
        let dx = tvx - v.x, dz = tvz - v.z;
        const dl = Math.hypot(dx, dz), maxd = acc * h;
        if (dl > maxd) { dx *= maxd / dl; dz *= maxd / dl; }
        const before = Math.hypot(v.x, v.z);
        let nx = v.x + dx, nz = v.z + dz;
        const after = Math.hypot(nx, nz);
        // In the air, steering never bleeds momentum you already have.
        if (!this.onGround && after < before && before > target) {
          nx *= before / after; nz *= before / after;
        }
        v.x = nx; v.z = nz;
      }
    }

    // --- Start a slide ---
    if (this.onGround && this.slideTime <= 0 && this.time - this.slidePressedAt < 0.05 && this.speed > 6) {
      this.slideTime = 0.85;
      const sp = this.speed, boost = Math.min(sp * 1.18, T.sprint * 1.25) / sp;
      v.x *= boost; v.z *= boost;
      this.slidePressedAt = -1;
      this.emit('Slide');
    }

    // --- Gravity ---
    let g = T.gravity;
    if (this.wallRunning) g *= 0.12;
    else if (v.y > 0 && !ctx.jumpHeld) g *= 1.7;
    v.y -= g * h;
    if (this.wallRunning && v.y < -1.2) v.y = -1.2;
    if (v.y < -55) v.y = -55;

    // --- Jumps ---
    if (this.onGround) this.coyote = 0.11;
    if (this.jumpBuffer > 0) {
      if (this.coyote > 0) {
        v.y = T.jump;
        if (this.slideTime > 0) {
          v.x *= 1.12; v.z *= 1.12; v.y = T.jump * 0.92;
          this.slideTime = 0;
          this.emit('Long jump');
        }
        this.onGround = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
      } else if (this.wallTimer > 0 && this.wall) {
        const w = this.wall;
        const along = wishLen > 0 ? 3.5 : 0;
        v.x = w.nx * 7.5 + (wishLen > 0 ? (wx / wishLen) * along : 0);
        v.z = w.nz * 7.5 + (wishLen > 0 ? (wz / wishLen) * along : 0);
        v.y = T.jump * 1.02;
        this.wallTimer = 0;
        this.wallRunning = false;
        this.jumpBuffer = 0;
        this.emit('Wall jump');
      }
    }

    // --- Integrate horizontal and resolve walls ---
    this.pos.x += v.x * h;
    this.pos.z += v.z * h;
    const contact = this.resolveWalls();

    // --- Integrate vertical, floors, ceilings ---
    const prevY = this.pos.y;
    this.pos.y += v.y * h;
    const wasGround = this.onGround;
    const maxY = prevY + T.step;
    const floor = this.world.floorAt(this.pos.x, this.pos.z, maxY, T.radius * 0.55);
    const snap = wasGround && v.y <= 0 ? 0.45 : 0;
    if (floor.solid && v.y <= 0 && this.pos.y <= floor.y + snap) {
      if (!wasGround) this.land(-v.y);
      this.pos.y = floor.y;
      if (v.y < 0) v.y = 0;
      this.onGround = true;
      this.ground = floor.solid;
      this.wallRunTime = 0;
      this.wallClimbReady = true;
      this.wallRunning = false;
      this.lastWallJumpSolid = null;
    } else {
      this.onGround = false;
      this.ground = null;
    }
    if (v.y > 0) {
      const ceil = this.world.ceilingAt(this.pos.x, this.pos.z, prevY + 0.4);
      if (this.pos.y + T.height > ceil) {
        this.pos.y = ceil - T.height;
        v.y = 0;
      }
    }

    // --- Wall abilities ---
    this.wallRunning = false;
    if (contact) {
      this.wall = contact;
      this.wallTimer = 0.2;
      const s = contact.solid;
      const into = wishLen > 0 ? -(wx * contact.nx + wz * contact.nz) / wishLen : 0;
      const top = s.y1 - this.pos.y;
      // Mantle onto ledges within reach.
      if (into > 0.3 && top > T.step * 0.9 && top <= T.mantleReach && !s.noMantle) {
        const tx = contact.px - contact.nx * 0.75;
        const tz = contact.pz - contact.nz * 0.75;
        if (pointInSolid(s, tx, tz) && !this.world.pointBlocked(tx, s.y1 + 1.0, tz)) {
          this.startMantle(tx, s.y1, tz, contact);
          return;
        }
      }
      if (!this.onGround) {
        const hs = Math.hypot(v.x, v.z);
        const alongSpeed = Math.abs(v.x * -contact.nz + v.z * contact.nx);
        // Short run straight up a wall.
        if (sprint && into > 0.75 && this.wallClimbReady && top > T.mantleReach) {
          v.y = Math.max(v.y, 8.2);
          this.wallClimbReady = false;
          this.emit('Wall climb');
        } else if (sprint && into < 0.75 && alongSpeed > 5.5 && this.wallRunTime < T.wallRunMax && top > 1.0) {
          // Wall-run along the face.
          if (this.wallRunTime === 0) {
            v.y = Math.max(v.y, 3.2);
            this.emit('Wall run');
          }
          this.wallRunning = true;
          this.wallRunTime += h;
          v.x -= contact.nx * 2.5 * h * 10;
          v.z -= contact.nz * 2.5 * h * 10;
          // keep the speed along the wall
          const k = hs / Math.max(0.001, Math.hypot(v.x, v.z));
          v.x *= k; v.z *= k;
        }
      }
    }

    // --- Ladders & ziplines ---
    if (this.ladderCooldown <= 0) this.checkLadder(ctx);
    if (this.mode === 'normal' && this.zipCooldown <= 0) this.checkZip(ctx);

    // --- Bounds, safety, water ---
    const b = this.bounds;
    if (b) {
      if (this.pos.x < b[0]) { this.pos.x = b[0]; v.x = Math.max(0, v.x); }
      if (this.pos.x > b[2]) { this.pos.x = b[2]; v.x = Math.min(0, v.x); }
      if (this.pos.z < b[1]) { this.pos.z = b[1]; v.z = Math.max(0, v.z); }
      if (this.pos.z > b[3]) { this.pos.z = b[3]; v.z = Math.min(0, v.z); }
    }
    if (this.onGround) {
      this.safeTimer -= h;
      if (this.safeTimer <= 0 && this.ground && this.ground.kind !== 'cable') {
        this.safe.copy(this.pos);
        this.safeTimer = 0.5;
      }
    }
    if (this.pos.y < -1.4) {
      this.emit('Splash');
      this.inWater = true;
    }
  }

  land(fallSpeed) {
    const rolled = this.time - this.slidePressedAt < 0.3;
    if (fallSpeed > 21) {
      if (rolled) {
        this.rollTime = 0.45;
        this.emit('Roll');
      } else {
        this.stumble = Math.min(0.6, 0.25 + (fallSpeed - 21) * 0.02);
        this.emit('Hard landing');
      }
    }
  }

  resolveWalls() {
    const r = T.radius, p = this.pos, v = this.vel;
    const list = this.world.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1);
    let contact = null;
    const feet = p.y + T.step, head = p.y + (this.slideTime > 0 ? 1.0 : T.height);
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.y1 <= feet || s.y0 >= head) continue;
        if (p.x + r < s.minX || p.x - r > s.maxX || p.z + r < s.minZ || p.z - r > s.maxZ) continue;
        const inside = pointInSolid(s, p.x, p.z);
        closestOnSolid(s, p.x, p.z, _c);
        if (!inside && _c.d2 >= r * r) continue;
        let nx, nz;
        if (inside) {
          nx = s.nxs[_c.edge]; nz = s.nzs[_c.edge];
          p.x = _c.x + nx * (r + 0.001);
          p.z = _c.z + nz * (r + 0.001);
        } else {
          const d = Math.sqrt(_c.d2) || 0.0001;
          nx = (p.x - _c.x) / d; nz = (p.z - _c.z) / d;
          p.x = _c.x + nx * r;
          p.z = _c.z + nz * r;
        }
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) { v.x -= nx * vn; v.z -= nz * vn; }
        // Prefer reporting the tallest wall we touch, it's the one abilities care about.
        if (!contact || s.y1 > contact.solid.y1) contact = { solid: s, nx, nz, px: _c.x, pz: _c.z };
        moved = true;
      }
      if (!moved) break;
    }
    return contact;
  }

  startMantle(tx, ty, tz, contact) {
    this.mode = 'mantle';
    this.mantle = {
      t: 0,
      dur: 0.18 + Math.max(0, ty - this.pos.y) * 0.07,
      from: this.pos.clone(),
      to: new THREE.Vector3(tx, ty, tz),
      nx: contact.nx, nz: contact.nz,
    };
    this.vel.set(0, 0, 0);
    this.facing = Math.atan2(-contact.nx, -contact.nz);
    this.emit('Mantle');
  }

  stepMantle(h) {
    const m = this.mantle;
    m.t += h / m.dur;
    const t = Math.min(1, m.t);
    const ty = 1 - Math.pow(1 - Math.min(1, t * 1.5), 2);
    const txz = t * t;
    this.pos.set(
      m.from.x + (m.to.x - m.from.x) * txz,
      m.from.y + (m.to.y - m.from.y) * ty,
      m.from.z + (m.to.z - m.from.z) * txz,
    );
    if (t >= 1) {
      this.mode = 'normal';
      this.onGround = true;
      this.vel.set(-m.nx * 4, 0, -m.nz * 4);
      this.mantle = null;
      this.wallClimbReady = true;
    }
  }

  checkLadder(ctx) {
    const p = this.pos;
    const ladders = this.world.ladders;
    for (let i = 0; i < ladders.length; i++) {
      const L = ladders[i];
      const dx = p.x - L.x, dz = p.z - L.z;
      if (dx * dx + dz * dz > 4) continue;
      const along = dx * L.tx + dz * L.tz;
      const out = dx * L.nx + dz * L.nz;
      if (Math.abs(along) > 0.75 || out < -0.1 || out > 1.0) continue;
      if (p.y < L.y0 - 0.6 || p.y > L.y1 - 1.0) continue;
      const into = ctx.wishLen > 0 ? -(ctx.wx * L.nx + ctx.wz * L.nz) / ctx.wishLen : 0;
      if (into < 0.5 && !ctx.grab) {
        this.prompt = 'Push toward the ladder to climb';
        continue;
      }
      this.mode = 'climb';
      this.ladder = L;
      this.vel.set(0, 0, 0);
      this.pos.x = L.x + L.nx * 0.45;
      this.pos.z = L.z + L.nz * 0.45;
      this.facing = Math.atan2(-L.nx, -L.nz);
      this.emit('Climb');
      return;
    }
  }

  stepClimb(h, ctx) {
    const L = this.ladder;
    const dir = ctx.input.move.y;
    const speed = 5.5 + Math.min(16, (L.y1 - L.y0) / 6);
    this.pos.y += dir * speed * h;
    this.climbDir = dir;
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.mode = 'normal';
      this.ladder = null;
      this.ladderCooldown = 0.45;
      this.vel.set(L.nx * 7, T.jump * 0.9, L.nz * 7);
      this.emit('Wall jump');
      return;
    }
    if (this.pos.y >= L.y1 - 1.1) {
      // Over the top onto the roof.
      const tx = L.x - L.nx * 0.9, tz = L.z - L.nz * 0.9;
      this.ladder = null;
      this.mode = 'normal';
      this.ladderCooldown = 0.5;
      this.startMantle(tx, L.y1, tz, { nx: L.nx, nz: L.nz });
      return;
    }
    const floor = this.world.floorAt(this.pos.x, this.pos.z, this.pos.y + 0.05, 0);
    if (dir < 0 && this.pos.y <= Math.max(L.y0, floor.y)) {
      this.pos.y = Math.max(L.y0, floor.y);
      this.mode = 'normal';
      this.ladder = null;
      this.ladderCooldown = 0.6;
    }
  }

  checkZip(ctx) {
    const zips = this.world.ziplines;
    const hx = this.pos.x, hy = this.pos.y + 2.0, hz = this.pos.z;
    for (let i = 0; i < zips.length; i++) {
      const Z = zips[i];
      const ax = hx - Z.ax, ay = hy - Z.ay, az = hz - Z.az;
      let t = (ax * Z.dx + ay * Z.dy + az * Z.dz) / Z.len;
      if (t < -1.5 / Z.len || t > 0.94) continue;
      t = Math.max(0, t);
      const px = Z.ax + Z.dx * t * Z.len, py = Z.ay + Z.dy * t * Z.len, pz = Z.az + Z.dz * t * Z.len;
      const d2 = (hx - px) ** 2 + (hy - py) ** 2 + (hz - pz) ** 2;
      if (d2 > 1.3 * 1.3) continue;
      if (this.onGround && !ctx.grab) {
        this.prompt = 'Press E to ride the zipline';
        continue;
      }
      this.mode = 'zip';
      const along = this.vel.x * Z.dx + this.vel.y * Z.dy + this.vel.z * Z.dz;
      this.zip = { Z, t, speed: Math.max(5, along) };
      this.facing = Math.atan2(Z.dx, Z.dz);
      this.emit('Zipline');
      return;
    }
  }

  stepZip(h, ctx) {
    const z = this.zip, Z = z.Z;
    const slope = -Z.dy;
    z.speed = Math.min(T.zipMax, z.speed + (T.gravity * slope * 0.85 + 2) * h - z.speed * 0.02 * h);
    z.t += (z.speed * h) / Z.len;
    const t = Math.min(1, z.t);
    this.pos.set(Z.ax + Z.dx * t * Z.len, Z.ay + Z.dy * t * Z.len - 2.05, Z.az + Z.dz * t * Z.len);
    const release = this.jumpBuffer > 0;
    if (t >= 1 || release) {
      this.jumpBuffer = 0;
      this.mode = 'normal';
      this.vel.set(Z.dx * z.speed, Z.dy * z.speed + (release ? 7 : 0), Z.dz * z.speed);
      if (t >= 1) this.vel.multiplyScalar(0.5);
      this.zip = null;
      this.zipCooldown = 0.6;
    }
  }
}

// --- The courier: a small low-poly runner built from primitives ---
class Avatar {
  constructor() {
    const root = new THREE.Group();
    const jacket = new THREE.MeshStandardMaterial({ color: 0xe8552b, roughness: 0.7 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc58c66, roughness: 0.8 });
    const bag = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.6 });

    const body = new THREE.Group();
    body.position.y = 0.95;
    root.add(body);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.28), jacket);
    torso.position.y = 0.3;
    body.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin);
    head.position.y = 0.78;
    body.add(head);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.1, 0.3), dark);
    cap.position.set(0, 0.95, 0.02);
    body.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.14), dark);
    brim.position.set(0, 0.91, 0.2);
    body.add(brim);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.22), bag);
    pack.position.set(0, 0.34, -0.25);
    body.add(pack);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.06, 0.225), jacket);
    stripe.position.set(0, 0.42, -0.25);
    body.add(stripe);

    const limb = (w, l, mat) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, l, w), mat);
      m.position.y = -l / 2;
      g.add(m);
      return g;
    };
    this.armL = limb(0.13, 0.58, jacket); this.armL.position.set(-0.31, 0.56, 0); body.add(this.armL);
    this.armR = limb(0.13, 0.58, jacket); this.armR.position.set(0.31, 0.56, 0); body.add(this.armR);
    this.legL = limb(0.17, 0.92, pants); this.legL.position.set(-0.12, 0.0, 0); body.add(this.legL);
    this.legR = limb(0.17, 0.92, pants); this.legR.position.set(0.12, 0.0, 0); body.add(this.legR);

    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.root = root;
    this.body = body;
    this.phase = 0;
    this.yaw = 0;
    this.lean = 0;
  }

  update(dt, p) {
    const sp = p.speed;
    if (p.mode === 'normal') {
      if (sp > 0.6) p.facing = Math.atan2(p.vel.x, p.vel.z);
    }
    let d = p.facing - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 14);
    this.root.rotation.y = this.yaw;
    this.root.position.copy(p.pos);

    const k = Math.min(1, dt * 14);
    const set = (o, x, z = 0) => {
      o.rotation.x += (x - o.rotation.x) * k;
      o.rotation.z += (z - o.rotation.z) * k;
    };
    let bodyTilt = 0, bodyY = 0.95, roll = 0;
    if (p.mode === 'climb') {
      this.phase += dt * 9 * Math.abs(p.climbDir || 0);
      const s = Math.sin(this.phase);
      set(this.armL, -2.6 + s * 0.4); set(this.armR, -2.6 - s * 0.4);
      set(this.legL, -0.5 - s * 0.4); set(this.legR, -0.5 + s * 0.4);
    } else if (p.mode === 'zip') {
      set(this.armL, -2.9, 0.15); set(this.armR, -2.9, -0.15);
      set(this.legL, -0.3); set(this.legR, -0.1);
      bodyTilt = 0.1;
    } else if (p.mode === 'mantle') {
      set(this.armL, -1.8); set(this.armR, -1.8);
      set(this.legL, -1.2); set(this.legR, -0.2);
      bodyTilt = 0.4;
    } else if (p.slideTime > 0 && p.onGround) {
      set(this.armL, -0.6, 0.6); set(this.armR, -0.3, -0.6);
      set(this.legL, -1.45); set(this.legR, -0.9);
      bodyTilt = -0.55; bodyY = 0.55;
    } else if (!p.onGround) {
      const up = p.vel.y > 0;
      set(this.armL, up ? -2.2 : -1.2, 0.3); set(this.armR, up ? -2.2 : -1.2, -0.3);
      set(this.legL, up ? -1.1 : -0.4); set(this.legR, up ? 0.2 : -0.9);
      bodyTilt = 0.15;
      if (p.wallRunning && p.wall) {
        const side = Math.sin(p.facing) * p.wall.nz - Math.cos(p.facing) * p.wall.nx;
        roll = side * 0.35;
      }
    } else if (sp > 0.6) {
      this.phase += dt * (4 + sp * 0.75);
      const s = Math.sin(this.phase), amp = Math.min(1.1, 0.35 + sp * 0.07);
      set(this.armL, s * amp); set(this.armR, -s * amp);
      set(this.legL, -s * amp); set(this.legR, s * amp);
      bodyTilt = Math.min(0.32, sp * 0.022);
      bodyY = 0.95 + Math.abs(Math.cos(this.phase)) * 0.06;
    } else {
      set(this.armL, 0.05, 0.05); set(this.armR, 0.05, -0.05);
      set(this.legL, 0); set(this.legR, 0);
    }
    if (p.rollTime > 0) {
      this.body.rotation.x = (1 - p.rollTime / 0.45) * Math.PI * 2;
      bodyY = 0.6;
    } else {
      this.body.rotation.x += (bodyTilt - this.body.rotation.x) * k;
    }
    this.body.rotation.z += (roll - this.body.rotation.z) * k;
    this.body.position.y += (bodyY - this.body.position.y) * k;
  }
}
