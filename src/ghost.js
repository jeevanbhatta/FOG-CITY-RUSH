import * as THREE from 'three';
import { Avatar } from './player.js';

// Records a run at 10 samples per second and replays the best one as a translucent ghost.
// Sample: [t, x, y, z, heading, pitch, roll, kind, mode, onGround]
//   kind: 0 on foot, 1 car, 2 seaplane. mode: index into MODES (on foot only).

const MODES = ['normal', 'climb', 'mantle', 'zip', 'chute'];
const STEP = 0.1;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

export class GhostRecorder {
  start() { this.samples = []; this.next = 0; }

  sample(t, player, driving) {
    if (t < this.next) return;
    this.next = t + STEP;
    if (driving) {
      const kind = driving.kind === 'plane' ? 2 : 1;
      this.samples.push([r2(t), r1(driving.pos.x), r1(driving.pos.y), r1(driving.pos.z), r2(driving.heading),
        r2(driving.pitch || 0), r2(driving.roll || 0), kind, 0, 1]);
    } else {
      const bank = player.chute ? player.chute.bank : 0;
      this.samples.push([r2(t), r1(player.pos.x), r1(player.pos.y), r1(player.pos.z), r2(player.facing),
        0, r2(bank), 0, Math.max(0, MODES.indexOf(player.mode)), player.onGround ? 1 : 0]);
    }
  }
}

export class Ghost {
  constructor(scene, carMesh, planeMesh) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.38, depthWrite: false });
    const ghostify = (obj) => obj.traverse((o) => { if (o.isMesh) { o.material = this.mat; o.castShadow = false; } });
    this.avatar = new Avatar();
    ghostify(this.avatar.root);
    this.car = carMesh.clone(true);
    ghostify(this.car);
    this.plane = planeMesh.clone(true);
    ghostify(this.plane);
    this.group = new THREE.Group();
    this.group.add(this.avatar.root, this.car, this.plane);
    this.group.visible = false;
    scene.add(this.group);
    this.fake = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), facing: 0, mode: 'normal', onGround: true,
      slideTime: 0, rollTime: 0, wallRunning: false, wall: null, climbDir: 1, chute: { open: 1, bank: 0 },
      get speed() { return Math.hypot(this.vel.x, this.vel.z); },
    };
    this.data = null;
  }

  load(data) {
    this.data = data && data.length > 1 ? data : null;
    this.group.visible = !!this.data;
    this.i = 0;
  }

  hide() { this.group.visible = false; }

  update(dt, t) {
    const d = this.data;
    if (!d) return;
    while (this.i < d.length - 2 && d[this.i + 1][0] <= t) this.i++;
    const a = d[this.i], b = d[Math.min(d.length - 1, this.i + 1)];
    const span = Math.max(1e-3, b[0] - a[0]);
    const k = Math.max(0, Math.min(1, (t - a[0]) / span));
    const lerp = (j) => a[j] + (b[j] - a[j]) * k;
    let dh = b[4] - a[4];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const heading = a[4] + dh * k;
    const kind = a[7];
    this.avatar.root.visible = kind === 0;
    this.car.visible = kind === 1;
    this.plane.visible = kind === 2;
    const x = lerp(1), y = lerp(2), z = lerp(3);
    if (kind === 0) {
      const f = this.fake;
      f.vel.set((b[1] - a[1]) / span, (b[2] - a[2]) / span, (b[3] - a[3]) / span);
      f.pos.set(x, y, z);
      f.facing = heading;
      f.mode = MODES[a[8]] || 'normal';
      f.onGround = !!a[9];
      f.chute.bank = a[6];
      this.avatar.update(dt, f);
      this.avatar.root.rotation.y = heading;
    } else {
      const m = kind === 1 ? this.car : this.plane;
      m.position.set(x, y, z);
      m.rotation.order = 'YXZ';
      m.rotation.set(-lerp(5), heading, lerp(6));
    }
    this.group.visible = t <= d[d.length - 1][0] + 1;
  }
}
