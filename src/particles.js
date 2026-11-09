import * as THREE from 'three';

// One pooled point cloud with per-particle size, colour and fade.
export class Particles {
  constructor(scene, max = 1400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.next = 0;
    this.enabled = true;
    this.density = 1;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.05, r));
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g;
    this.mat = m;
  }

  resize(h) {
    this.mat.uniforms.uScale.value = h * 0.9;
  }

  // o: { color, count, speed, spread, up, life, size, gravity, drag, grow, alpha, jitter }
  emit(x, y, z, o) {
    if (!this.enabled) return;
    this.busy = true;
    const n = Math.max(1, Math.round((o.count || 1) * this.density));
    const c = new THREE.Color(o.color ?? 0xffffff);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const j = o.jitter ?? 0.2;
      this.pos[i * 3] = x + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * j;
      const sp = (o.speed ?? 2) * (0.5 + Math.random() * 0.8);
      const a = Math.random() * Math.PI * 2, s = o.spread ?? 1;
      this.vel[i * 3] = Math.cos(a) * sp * s + (o.vx || 0);
      this.vel[i * 3 + 1] = (o.up ?? 1) * sp * (0.4 + Math.random() * 0.8) + (o.vy || 0);
      this.vel[i * 3 + 2] = Math.sin(a) * sp * s + (o.vz || 0);
      const shade = 0.85 + Math.random() * 0.3;
      this.col[i * 3] = c.r * shade; this.col[i * 3 + 1] = c.g * shade; this.col[i * 3 + 2] = c.b * shade;
      this.size[i] = (o.size ?? 0.4) * (0.7 + Math.random() * 0.6);
      this.life[i] = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.age[i] = 0;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      this.grow[i] = o.grow ?? 0.5;
      this.alpha[i] = o.alpha ?? 0.7;
      this.baseAlpha = this.baseAlpha || new Float32Array(this.max);
      this.baseAlpha[i] = o.alpha ?? 0.7;
    }
  }

  update(dt) {
    const P = this.pos, V = this.vel;
    // Nothing alive and nothing to clear: skip the loop and the GPU upload.
    if (!this.busy) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      alive++;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        P[i * 3 + 1] = -9999;
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      V[i * 3] *= dr; V[i * 3 + 2] *= dr;
      V[i * 3 + 1] = V[i * 3 + 1] * dr - this.grav[i] * dt;
      P[i * 3] += V[i * 3] * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += V[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.baseAlpha[i] * (1 - t) * Math.min(1, t * 8 + 0.3);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.busy = alive > 0;
  }

  // --- presets ---
  dust(x, y, z, k = 1) {
    this.emit(x, y + 0.1, z, { color: 0xcfc6b6, count: 10 * k, speed: 2.4 * k, up: 0.4, life: 0.8, size: 0.45, grow: 1.2, drag: 3, alpha: 0.55, jitter: 0.6 });
  }
  puff(x, y, z) {
    this.emit(x, y + 0.05, z, { color: 0xcfc6b6, count: 1, speed: 0.6, up: 0.6, life: 0.5, size: 0.3, grow: 0.8, alpha: 0.35 });
  }
  sparks(x, y, z, k = 1) {
    this.emit(x, y, z, { color: 0xffb347, count: 14 * k, speed: 7, up: 1.2, life: 0.45, size: 0.12, grow: -0.1, gravity: 18, drag: 1, alpha: 1 });
  }
  smoke(x, y, z) {
    this.emit(x, y + 0.2, z, { color: 0xd8d8d4, count: 1, speed: 0.8, up: 0.5, life: 1.2, size: 0.8, grow: 2, drag: 1.5, alpha: 0.35 });
  }
  spray(x, y, z, vx, vz) {
    this.emit(x, y, z, { color: 0xf2f6f7, count: 2, speed: 2.5, up: 1.4, life: 0.7, size: 0.35, grow: 0.8, gravity: 9, drag: 1, alpha: 0.6, vx, vz });
  }
  splash(x, y, z, k = 1) {
    this.emit(x, y + 0.2, z, { color: 0xf4f8f9, count: 40 * k, speed: 5 * k, spread: 0.6, up: 2.2, life: 1.1, size: 0.45, grow: 0.6, gravity: 14, drag: 0.6, alpha: 0.8, jitter: 1.2 * k });
  }
  confetti(x, y, z) {
    for (const color of [0xff6a2b, 0xf4efe6, 0x1f3440]) {
      this.emit(x, y, z, { color, count: 12, speed: 6, up: 0.8, life: 1.2, size: 0.22, grow: 0, gravity: 4, drag: 1.4, alpha: 1, jitter: 1.5 });
    }
  }
  debris(x, y, z) {
    this.emit(x, y, z, { color: 0x3a3f45, count: 30, speed: 9, up: 1.2, life: 1.6, size: 0.6, grow: 2.5, gravity: 2, drag: 1.2, alpha: 0.6, jitter: 2 });
    this.sparks(x, y, z, 2);
  }
}
