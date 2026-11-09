import * as THREE from 'three';

// Third-person orbit camera that pulls in when a wall is between it and the runner.
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = Math.PI * 0.75;
    this.pitch = 0.28;
    this.dist = 5.5;
    this.curDist = 5.5;
    this.target = new THREE.Vector3();
    this.roll = 0;
  }

  update(dt, player, look) {
    this.yaw -= look[0];
    this.pitch = Math.max(-0.9, Math.min(1.25, this.pitch + look[1]));
    const sp = player.speed + (player.mode === 'zip' ? 10 : 0);
    const want = 5.2 + Math.min(3.5, sp * 0.18);

    const t = this.target;
    const desired = player.pos.clone();
    desired.y += player.slideTime > 0 && player.onGround ? 1.1 : 1.65;
    // Smooth vertical follow so steps and mantles don't jolt the view.
    t.x = desired.x; t.z = desired.z;
    t.y += (desired.y - t.y) * Math.min(1, dt * 14);
    if (Math.abs(desired.y - t.y) > 6) t.y = desired.y;

    const cp = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cp, oy = sp2, oz = Math.cos(this.yaw) * cp;
    // March out from the runner and stop short of anything solid.
    let free = want;
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const d = (want * i) / steps;
      if (this.world.pointBlocked(t.x + ox * d, t.y + oy * d + 0.2, t.z + oz * d)) {
        free = Math.max(0.8, d - want / steps - 0.25);
        break;
      }
    }
    // Pull in fast, ease back out.
    if (free < this.curDist) this.curDist = free;
    else this.curDist += (free - this.curDist) * Math.min(1, dt * 3);
    const d = this.curDist;
    this.camera.position.set(t.x + ox * d, t.y + oy * d + 0.35, t.z + oz * d);
    if (this.camera.position.y < -1.2) this.camera.position.y = -1.2;
    this.camera.lookAt(t);

    this.applyRoll(dt, player);
    this.applyFov(dt, sp);
  }

  // Chase camera for vehicles: free look with the mouse, drifts back behind after a moment.
  updateChase(dt, pos, heading, speed, look, opts) {
    if (look[0] || look[1]) this.idle = 0; else this.idle = (this.idle || 0) + dt;
    this.yaw -= look[0];
    this.pitch = Math.max(-0.5, Math.min(1.2, this.pitch + look[1]));
    if (this.idle > 0.9) {
      let d = heading + Math.PI - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const k = Math.min(1, dt * (speed > 3 ? 2.5 : 0.6));
      this.yaw += d * k;
      this.pitch += (opts.pitch - this.pitch) * k;
    }
    const t = this.target;
    t.set(pos.x, pos.y + opts.height, pos.z);
    const want = opts.dist + Math.min(opts.maxExtra, speed * opts.speedDist);
    const cp = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cp, oy = sp2, oz = Math.cos(this.yaw) * cp;
    let free = want;
    for (let i = 1; i <= 14; i++) {
      const d = (want * i) / 14;
      if (this.world.pointBlocked(t.x + ox * d, t.y + oy * d + 0.2, t.z + oz * d)) {
        free = Math.max(2, d - want / 14 - 0.3);
        break;
      }
    }
    if (free < this.curDist) this.curDist = free;
    else this.curDist += (free - this.curDist) * Math.min(1, dt * 3);
    const d = this.curDist;
    this.camera.position.set(t.x + ox * d, t.y + oy * d + 0.4, t.z + oz * d);
    if (this.camera.position.y < -1.0) this.camera.position.y = -1.0;
    this.camera.lookAt(t);
    if (opts.roll) this.camera.rotateZ(-opts.roll * 0.35);
    this.applyFov(dt, speed * opts.fovScale);
  }

  applyRoll(dt, player) {
    let wantRoll = 0;
    if (player.wallRunning && player.wall) {
      const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
      wantRoll = (player.wall.nx * rightX + player.wall.nz * rightZ) * 0.08;
    }
    this.roll += (wantRoll - this.roll) * Math.min(1, dt * 6);
    this.camera.rotateZ(this.roll);
  }

  applyFov(dt, sp) {
    const fov = 70 + Math.min(16, Math.max(0, sp - 8) * 0.9);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
  }
}
