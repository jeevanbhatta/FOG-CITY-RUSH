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
    this.flow = 0; // 0..1 from the combo chain: a faster top sprint
    this.carry = 0; // seconds of "keep your speed" after a roll or a clean landing
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
    this.scene = scene;
    this.avatar = new Avatar();
    scene.add(this.avatar.root);
  }

  setLook(look, skinTone) {
    const visible = this.avatar.root.visible;
    this.scene.remove(this.avatar.root);
    this.avatar = new Avatar(look, skinTone);
    this.avatar.root.visible = visible;
    this.scene.add(this.avatar.root);
  }

  reset(p, facing = 0) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.mode = 'normal';
    this.mantle = this.ladder = this.zip = null;
    this.onGround = false;
    this.slideTime = this.stumble = this.rollTime = this.carry = 0;
    this.wallRunTime = 0;
    this.coyote = this.jumpBuffer = this.wallTimer = 0;
    this.chute = null;
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
    if (this.mode === 'chute') return this.stepChute(h, ctx);

    const { wx, wz, wishLen, sprint } = ctx;
    const v = this.vel;

    // --- Horizontal control ---
    const top = T.sprint * (1 + 0.18 * this.flow);
    let target = wishLen * (sprint ? top : T.run);
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
      this.carry -= h;
      // Momentum: right after a roll or a clean landing, running on keeps the extra speed for a moment.
      const carrying = this.onGround && this.carry > 0 && wishLen > 0.5
        && (v.x * wx + v.z * wz) / wishLen > Math.max(target, this.speed * 0.85);
      if (carrying) {
        const sp = this.speed, ns = Math.max(target, sp - 3 * h);
        const dx = wx / wishLen, dz = wz / wishLen;
        v.x += (dx * sp - v.x) * Math.min(1, h * 6); v.z += (dz * sp - v.z) * Math.min(1, h * 6);
        const k = ns / Math.max(1e-3, this.speed); v.x *= k; v.z *= k;
      } else if (this.onGround || wishLen > 0) {
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
        // Keep the speed you had along the wall (capped), push off, and add a little toward your input.
        const vn = v.x * w.nx + v.z * w.nz;
        let tx = v.x - w.nx * vn, tz = v.z - w.nz * vn;
        const tl = Math.hypot(tx, tz), cap = top * 0.9;
        if (tl > cap) { tx *= cap / tl; tz *= cap / tl; }
        v.x = w.nx * 7.5 + tx * 0.85 + (wishLen > 0 ? (wx / wishLen) * along : 0);
        v.z = w.nz * 7.5 + tz * 0.85 + (wishLen > 0 ? (wz / wishLen) * along : 0);
        v.y = T.jump * 1.02;
        this.wallTimer = 0;
        this.wallRunning = false;
        this.jumpBuffer = 0;
        this.emit('Wall jump');
      } else if (!this.onGround && v.y < 3 && this.heightAboveGround() > 6) {
        this.jumpBuffer = 0;
        this.openChute();
        return;
      }
    }
    if (!this.onGround && v.y < -9 && this.heightAboveGround() > 10) this.prompt = 'Jump again to open your parachute';

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

  heightAboveGround() {
    const f = this.world.floorAt(this.pos.x, this.pos.z, this.pos.y + 0.1, 0);
    return this.pos.y - (f.solid ? f.y : -1.6);
  }

  openChute() {
    this.mode = 'chute';
    if (this.speed > 0.6) this.facing = Math.atan2(this.vel.x, this.vel.z);
    this.chute = { open: 0, speed: Math.min(14, this.speed), bank: 0 };
    this.emit('Parachute');
  }

  // Ram-air canopy: steer like the seaplane (bank to turn), trade sink rate for forward speed.
  stepChute(h, ctx) {
    const c = this.chute, v = this.vel, inp = ctx.input.move;
    c.open = Math.min(1, c.open + h / 0.45);
    c.bank += (inp.x - c.bank) * Math.min(1, h * 3);
    this.facing -= c.bank * 1.15 * h;
    const fwdT = 12 + (inp.y > 0 ? inp.y * 5 : inp.y * 7);    // W dives faster, S flares
    const sinkT = 5 + (inp.y > 0 ? inp.y * 4.5 : inp.y * 2.5);
    c.speed += (fwdT - c.speed) * Math.min(1, h * 1.5);
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const k = Math.min(1, h * 2.5 * c.open);
    v.x += (fx * c.speed - v.x) * k;
    v.z += (fz * c.speed - v.z) * k;
    v.y += (-sinkT - v.y) * Math.min(1, h * (1 + 3.5 * c.open)); // opening shock
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.mode = 'normal';
      this.chute = null;
      this.emit('Cut away');
      return;
    }
    this.pos.x += v.x * h;
    this.pos.z += v.z * h;
    const before = Math.hypot(v.x, v.z);
    const contact = this.resolveWalls();
    if (contact && before - Math.hypot(v.x, v.z) > 5) {
      this.mode = 'normal';
      this.chute = null;
      this.emit('Chute collapsed');
      return;
    }
    const prevY = this.pos.y;
    this.pos.y += v.y * h;
    const floor = this.world.floorAt(this.pos.x, this.pos.z, prevY + 0.3, T.radius * 0.55);
    if (floor.solid && this.pos.y <= floor.y) {
      this.pos.y = floor.y;
      if (v.y < -7) this.stumble = 0.35;
      v.y = 0;
      v.x *= 0.45; v.z *= 0.45;
      this.mode = 'normal';
      this.chute = null;
      this.onGround = true;
      this.emit('Landed');
    }
    if (this.pos.y < -1.4) this.inWater = true;
  }

  land(fallSpeed) {
    this.landed = fallSpeed;
    const rolled = this.time - this.slidePressedAt < 0.3;
    // Land running and you keep your air speed for a beat; a roll keeps it longer.
    this.carry = fallSpeed > 21 ? (rolled ? 0.6 : 0) : 0.25;
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
      inSpeed: this.speed,
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
      // Vault through: come out of a mantle at a good share of the speed you went in with.
      const out = Math.max(4, Math.min(T.sprint, m.inSpeed * 0.8));
      this.vel.set(-m.nx * out, 0, -m.nz * out);
      this.carry = 0.3;
      this.mantle = null;
      this.wallClimbReady = true;
    }
  }

  checkLadder(ctx) {
    const p = this.pos;
    const ladders = this.world.laddersNear(p.x, p.z);
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
    z.speed = Math.min(Z.max || T.zipMax, z.speed + (T.gravity * slope * 0.85 + 2) * h - z.speed * 0.02 * h);
    z.t += (z.speed * h) / Z.len;
    const t = Math.min(1, z.t);
    this.pos.set(Z.ax + Z.dx * t * Z.len, Z.ay + Z.dy * t * Z.len - 2.05, Z.az + Z.dz * t * Z.len);
    const release = this.jumpBuffer > 0;
    if (t >= 1 || release) {
      this.jumpBuffer = 0;
      this.mode = 'normal';
      this.vel.set(Z.dx * z.speed, Z.dy * z.speed + (release ? 7 : 0), Z.dz * z.speed);
      if (t >= 1) this.vel.multiplyScalar(0.5);
      if (release && t < 0.97) this.emit('Zip jump');
      this.zip = null;
      this.zipCooldown = 0.6;
    }
  }
}

// --- The courier: a small low-poly runner built from primitives ---
// Character looks. Each preset sets clothes, headwear and what they carry.
export const SKIN_TONES = ['#f1c6a6', '#d9a07a', '#c58c66', '#8d5a3b', '#5a3a28'];
export const LOOKS = {
  courier: { label: 'Courier', top: 0xe8552b, trim: 'reflect', pants: 0x2c3440, hat: 'cap', hatColor: 0x23303b, pack: 'courier', shoe: 0xf4f4f0, sole: 0xff6a2b, hair: 0x2a1d16 },
  skater: { label: 'Skater', top: 0x3d5a80, pants: 0x8a8460, shorts: true, hat: 'beanie', hatColor: 0xd9a441, pack: 'none', shoe: 0x1b1f24, sole: 0xf4f4f0, hair: 0x5a3a20 },
  tourist: { label: 'Tourist', top: 0x2aa198, pants: 0xd8c39a, shorts: true, hat: 'sunhat', hatColor: 0xe9dcc0, pack: 'none', camera: true, shoe: 0xf4f4f0, sole: 0x8a6a48, hair: 0x6b4a2a },
  techie: { label: 'Techie', top: 0x6b6f73, pants: 0x34486b, hat: 'none', pack: 'backpack', glasses: true, shoe: 0xf4f4f0, sole: 0x1b1f24, hair: 0x1d1612 },
  freerunner: { label: 'Freerunner', top: 0x1f3a2f, pants: 0x2b2b2b, bareArms: true, hat: 'headband', hatColor: 0xff6a2b, pack: 'none', shoe: 0xff6a2b, sole: 0xf4f4f0, hair: 0x2a1d16 },
};

export class Avatar {
  constructor(look = 'courier', skinTone = 2) {
    const L = LOOKS[look] || LOOKS.courier;
    const root = new THREE.Group();
    const M = (color, roughness = 0.75, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    const top = M(L.top, 0.7);
    const topDark = M(new THREE.Color(L.top).multiplyScalar(0.82), 0.75);
    const pants = M(L.pants, 0.85);
    const skin = M(SKIN_TONES[skinTone] || SKIN_TONES[2], 0.8);
    const dark = M(0x1b1f24, 0.6);
    const hatMat = M(L.hatColor || 0x23303b, 0.6);
    const trim = L.trim === 'reflect' ? M(0xdfe6ea, 0.3, { metalness: 0.4, emissive: 0x30363a }) : topDark;
    const shoe = M(L.shoe, 0.6);
    const sole = M(L.sole, 0.6);
    const hair = M(L.hair, 0.9);
    const eyeMat = M(0x151515, 0.3);
    const sleeve = L.bareArms ? skin : top;

    const mesh = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const box = (w, h, d, mat, x, y, z, parent) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
    const capsule = (r, len, mat, y, parent) => mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat, 0, y, 0, parent);

    // Body pivots at the hips.
    const body = new THREE.Group();
    body.position.y = 0.95;
    root.add(body);
    box(0.36, 0.2, 0.24, pants, 0, 0.02, 0, body);
    box(0.37, 0.05, 0.25, dark, 0, 0.12, 0, body); // belt
    // Top: zip, collar, a band across the chest and a small patch.
    box(0.44, 0.5, 0.26, top, 0, 0.37, 0, body);
    box(0.445, 0.05, 0.265, trim, 0, 0.3, 0, body);
    if (!L.bareArms) box(0.02, 0.44, 0.01, dark, 0, 0.38, 0.135, body);
    box(0.3, 0.08, 0.24, topDark, 0, 0.64, 0, body);
    box(0.08, 0.08, 0.01, trim, -0.12, 0.5, 0.135, body);
    if (L.pack !== 'none') {
      for (const x of [-0.13, 0.13]) {
        box(0.05, 0.42, 0.02, dark, x, 0.4, 0.137, body);
        box(0.05, 0.03, 0.3, dark, x, 0.635, -0.02, body);
      }
    }
    if (L.camera) {
      box(0.16, 0.1, 0.07, dark, 0.06, 0.45, 0.17, body);
      mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10).rotateX(Math.PI / 2), M(0x30363a, 0.3), 0.06, 0.45, 0.22, body);
      box(0.02, 0.3, 0.01, dark, -0.1, 0.55, 0.14, body);
    }

    // Head: face, hair, headwear.
    mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin, 0, 0.7, 0, body);
    const head = new THREE.Group();
    head.position.y = 0.86;
    body.add(head);
    mesh(new THREE.SphereGeometry(0.15, 16, 12), skin, 0, 0, 0, head).scale.set(1, 1.12, 1.02);
    mesh(new THREE.SphereGeometry(0.155, 16, 12), hair, 0, 0.01, -0.035, head).scale.set(1, 1.1, 1);
    if (L.hat === 'none') mesh(new THREE.SphereGeometry(0.158, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, 0, 0.03, -0.01, head).scale.set(1.02, 1.1, 1.04);
    this.eyes = [];
    for (const x of [-0.055, 0.055]) {
      const e = mesh(new THREE.SphereGeometry(0.019, 8, 6), eyeMat, x, 0.02, 0.143, head);
      this.eyes.push(e);
      box(0.055, 0.012, 0.012, hair, x, 0.065, 0.146, head); // brows
    }
    box(0.03, 0.05, 0.03, skin, 0, -0.02, 0.158, head); // nose
    box(0.06, 0.012, 0.01, M(0x7a3f33, 0.7), 0, -0.075, 0.146, head); // mouth
    if (L.glasses) {
      for (const x of [-0.055, 0.055]) box(0.06, 0.045, 0.012, M(0x111111, 0.2, { metalness: 0.3 }), x, 0.02, 0.158, head);
      box(0.05, 0.01, 0.01, dark, 0, 0.03, 0.16, head);
    }
    if (L.hat === 'cap') {
      const crown = mesh(new THREE.SphereGeometry(0.162, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hatMat, 0, 0.05, 0, head);
      crown.scale.set(1.02, 0.85, 1.05);
      const brim = box(0.21, 0.02, 0.14, hatMat, 0, 0.065, 0.18, head);
      brim.rotation.x = 0.12;
      box(0.07, 0.05, 0.012, sole, 0, 0.12, 0.148, head);
      mesh(new THREE.SphereGeometry(0.022, 8, 6), sole, 0, 0.19, 0, head);
    } else if (L.hat === 'beanie') {
      mesh(new THREE.SphereGeometry(0.165, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hatMat, 0, 0.04, 0, head).scale.set(1.02, 1.05, 1.04);
      mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.06, 16), M(new THREE.Color(L.hatColor).multiplyScalar(0.8), 0.8), 0, 0.05, 0, head);
    } else if (L.hat === 'sunhat') {
      mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.12, 16), hatMat, 0, 0.16, 0, head);
      mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.015, 20), hatMat, 0, 0.1, 0, head);
      mesh(new THREE.CylinderGeometry(0.162, 0.162, 0.03, 16), M(0x2a5a8a, 0.7), 0, 0.13, 0, head);
    } else if (L.hat === 'headband') {
      mesh(new THREE.CylinderGeometry(0.157, 0.157, 0.04, 16), hatMat, 0, 0.07, 0, head);
    }
    this.head = head;

    // Arms: shoulder pivot, elbow joint, cuff and hand.
    const arm = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.29, 0.56, 0);
      body.add(pivot);
      box(0.15, 0.12, 0.18, L.bareArms ? top : sleeve, 0, -0.02, 0, pivot);
      capsule(0.065, 0.2, sleeve, -0.16, pivot);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      pivot.add(elbow);
      capsule(0.058, 0.17, sleeve, -0.12, elbow);
      if (!L.bareArms) box(0.13, 0.05, 0.13, trim, 0, -0.21, 0, elbow);
      box(0.09, 0.11, 0.1, look === 'courier' ? dark : skin, 0, -0.29, 0.01, elbow);
      return { pivot, elbow };
    };
    // Legs: hip pivot, knee joint, shoes.
    const leg = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.11, 0, 0);
      body.add(pivot);
      capsule(0.085, 0.27, pants, -0.22, pivot);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      pivot.add(knee);
      capsule(0.075, 0.25, L.shorts ? skin : pants, -0.2, knee);
      box(0.15, 0.05, 0.15, L.shorts ? M(0xf2f2ee, 0.9) : dark, 0, -0.37, 0, knee); // sock or cuff
      box(0.13, 0.09, 0.27, shoe, 0, -0.43, 0.05, knee);
      box(0.135, 0.03, 0.28, sole, 0, -0.485, 0.05, knee);
      return { pivot, knee };
    };
    const aL = arm(-1), aR = arm(1), lL = leg(-1), lR = leg(1);
    this.armL = aL.pivot; this.elbowL = aL.elbow;
    this.armR = aR.pivot; this.elbowR = aR.elbow;
    this.legL = lL.pivot; this.kneeL = lL.knee;
    this.legR = lR.pivot; this.kneeR = lR.knee;

    if (L.pack === 'courier') {
      const pack = new THREE.Group();
      pack.position.set(0, 0.38, -0.25);
      body.add(pack);
      box(0.4, 0.46, 0.22, M(0xf2efe6, 0.6), 0, 0, 0, pack);
      box(0.42, 0.14, 0.24, M(0xe0dacb, 0.65), 0, 0.19, 0.0, pack);
      box(0.41, 0.06, 0.225, top, 0, 0.04, 0, pack);
      box(0.16, 0.08, 0.01, trim, 0, -0.13, -0.112, pack);
    } else if (L.pack === 'backpack') {
      const pack = new THREE.Group();
      pack.position.set(0, 0.36, -0.22);
      body.add(pack);
      mesh(new THREE.CapsuleGeometry(0.15, 0.2, 4, 10), M(0x22262a, 0.8), 0, 0, 0, pack).scale.set(1.15, 1, 0.65);
      box(0.2, 0.14, 0.05, M(0x30353a, 0.8), 0, -0.08, -0.1, pack);
    }

    // Parachute canopy: an arched ram-air wing in orange and white cells, with lines to the shoulders.
    const chute = new THREE.Group();
    const cellMats = [
      new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.7, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.7, side: THREE.DoubleSide }),
    ];
    const cells = 7, arc = 1.7, R = 4.5;
    for (let i = 0; i < cells; i++) {
      const g = new THREE.CylinderGeometry(R, R, 2.8, 3, 1, true, -arc / 2 + (i * arc) / cells, arc / cells);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 2.2, 0);
      chute.add(new THREE.Mesh(g, cellMats[i % 2]));
    }
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x2a3138 });
    const line = (a, b) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, d.length(), 3), lineMat);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      chute.add(m);
    };
    for (const sx of [-1, 1]) {
      for (const tz of [-1.2, 1.2]) {
        const tip = new THREE.Vector3(sx * R * Math.sin(arc / 2), 2.2 + R * Math.cos(arc / 2), tz);
        line(new THREE.Vector3(sx * 0.3, 1.55, 0), tip);
      }
      line(new THREE.Vector3(sx * 0.3, 1.55, 0), new THREE.Vector3(sx * 1.6, 2.2 + R * Math.cos(0.36), 0));
    }
    chute.visible = false;
    root.add(chute);
    this.chute = chute;

    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.root = root;
    this.body = body;
    this.blink = 2;
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
    let knee = [0.05, 0.05], elbow = [-0.15, -0.15];
    this.chute.visible = p.mode === 'chute';
    if (p.mode === 'chute') {
      const c = p.chute;
      this.chute.scale.set(0.3 + 0.7 * c.open, 0.2 + 0.8 * c.open, 0.3 + 0.7 * c.open);
      this.chute.rotation.z += (c.bank * 0.3 - this.chute.rotation.z) * k;
      set(this.armL, -2.7, 0.35 - c.bank * 0.3); set(this.armR, -2.7, -0.35 - c.bank * 0.3);
      set(this.legL, -0.25); set(this.legR, -0.1);
      knee = [0.35, 0.2]; elbow = [-0.35, -0.35];
      roll = c.bank * 0.25;
    } else if (p.mode === 'climb') {
      const rung = Math.floor(this.phase / Math.PI);
      this.phase += dt * 9 * Math.abs(p.climbDir || 0);
      if (Math.floor(this.phase / Math.PI) !== rung) this.rung = true;
      const s = Math.sin(this.phase);
      set(this.armL, -2.6 + s * 0.4); set(this.armR, -2.6 - s * 0.4);
      set(this.legL, -0.5 - s * 0.4); set(this.legR, -0.5 + s * 0.4);
      knee = [0.9 + s * 0.5, 0.9 - s * 0.5]; elbow = [-0.5, -0.5];
    } else if (p.mode === 'zip') {
      set(this.armL, -2.9, 0.15); set(this.armR, -2.9, -0.15);
      set(this.legL, -0.3); set(this.legR, -0.1);
      knee = [0.45, 0.25]; elbow = [-0.05, -0.05];
      bodyTilt = 0.1;
    } else if (p.mode === 'mantle') {
      set(this.armL, -1.8); set(this.armR, -1.8);
      set(this.legL, -1.2); set(this.legR, -0.2);
      knee = [1.4, 0.4]; elbow = [-0.7, -0.7];
      bodyTilt = 0.4;
    } else if (p.slideTime > 0 && p.onGround) {
      set(this.armL, -0.6, 0.6); set(this.armR, -0.3, -0.6);
      set(this.legL, -1.45); set(this.legR, -0.9);
      knee = [0.1, 1.3]; elbow = [-0.3, -0.5];
      bodyTilt = -0.55; bodyY = 0.55;
    } else if (!p.onGround) {
      const up = p.vel.y > 0;
      set(this.armL, up ? -2.2 : -1.2, 0.3); set(this.armR, up ? -2.2 : -1.2, -0.3);
      set(this.legL, up ? -1.1 : -0.4); set(this.legR, up ? 0.2 : -0.9);
      knee = up ? [1.3, 0.5] : [0.5, 1.0]; elbow = [-0.8, -0.8];
      bodyTilt = 0.15;
      if (p.wallRunning && p.wall) {
        const side = Math.sin(p.facing) * p.wall.nz - Math.cos(p.facing) * p.wall.nx;
        roll = side * 0.35;
      }
    } else if (sp > 0.6) {
      const before = Math.floor(this.phase / Math.PI);
      this.phase += dt * (4 + sp * 0.75);
      if (Math.floor(this.phase / Math.PI) !== before) this.stepped = true;
      const s = Math.sin(this.phase), amp = Math.min(1.1, 0.35 + sp * 0.07);
      set(this.armL, s * amp); set(this.armR, -s * amp);
      set(this.legL, -s * amp); set(this.legR, s * amp);
      // Knees fold as each leg swings back; elbows bend more at a sprint.
      knee = [0.15 + Math.max(0, s) * amp * 1.6, 0.15 + Math.max(0, -s) * amp * 1.6];
      const eb = -0.35 - Math.min(1, sp / 12) * 1.0;
      elbow = [eb, eb];
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
    this.kneeL.rotation.x += (knee[0] - this.kneeL.rotation.x) * k;
    this.kneeR.rotation.x += (knee[1] - this.kneeR.rotation.x) * k;
    this.elbowL.rotation.x += (elbow[0] - this.elbowL.rotation.x) * k;
    this.elbowR.rotation.x += (elbow[1] - this.elbowR.rotation.x) * k;
    // Keep the head level with the horizon while the body leans, and blink now and then.
    this.head.rotation.x = -this.body.rotation.x * 0.6;
    this.blink -= dt;
    const closed = this.blink < 0.12;
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1;
    if (this.blink < 0) this.blink = 2.5 + Math.random() * 3;
  }
}
