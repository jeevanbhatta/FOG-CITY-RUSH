import * as THREE from 'three';
import { CAR } from './vehicles.js';

// Weather on top of the time of day: clear, thick fog, or rain. In "changes" mode it drifts
// from one to another every few minutes. Rain darkens the light, wets the roads (shinier,
// less grip) and falls as streaks around the camera.

const STATES = {
  clear: { fog: 1, dim: 1, rain: 0 },
  fog: { fog: 0.38, dim: 0.9, rain: 0 },
  rain: { fog: 0.62, dim: 0.72, rain: 1 },
};
const ORDER = ['clear', 'clear', 'fog', 'clear', 'rain'];
const BASE_GRIP = CAR.grip;

export class Weather {
  constructor(scene, mats) {
    this.scene = scene;
    this.mats = mats;
    this.mode = 'changes';
    this.name = 'clear';
    this.k = { fog: 1, dim: 1, rain: 0 };
    this.timer = 120 + Math.random() * 120;
    this.step = 0;
    // Rain: short line streaks in a box that follows the camera.
    const N = 2400;
    this.N = N;
    this.box = 70;
    const pos = new Float32Array(N * 6);
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * this.box * 2;
      this.drops[i * 3 + 1] = Math.random() * 60;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * this.box * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9d6dd, transparent: true, opacity: 0, depthWrite: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.roadBase = { r: mats.road.roughness, m: mats.road.metalness };
  }

  setMode(m) {
    this.mode = m;
    if (m !== 'changes') this.name = m;
  }

  // Call after the sky has set this frame's light and fog.
  apply(dt, camera, sky, sun, hemi) {
    if (this.mode === 'changes') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.step = (this.step + 1) % ORDER.length;
        this.name = ORDER[this.step];
        this.timer = this.name === 'clear' ? 150 + Math.random() * 120 : 90 + Math.random() * 60;
      }
    }
    const want = STATES[this.name] || STATES.clear;
    const a = Math.min(1, dt * 0.25);
    for (const key of ['fog', 'dim', 'rain']) this.k[key] += (want[key] - this.k[key]) * a;
    const k = this.k;
    // Light and fog.
    this.scene.fog.far *= k.fog;
    this.scene.fog.near *= k.fog;
    sun.intensity *= k.dim * (1 - k.rain * 0.35);
    hemi.intensity *= 0.6 + 0.4 * k.dim;
    const grey = new THREE.Color(0x8e979c);
    this.scene.fog.color.lerp(grey, k.rain * 0.55);
    sky.uniforms.horizon.value.lerp(grey, k.rain * 0.55);
    sky.uniforms.zenith.value.lerp(new THREE.Color(0x6f7a80), k.rain * 0.7);
    sky.lights = Math.max(sky.lights, k.rain * 0.45);
    // Wet roads: glossier, and cars slide more.
    this.mats.road.roughness = this.roadBase.r - k.rain * 0.55;
    this.mats.road.metalness = this.roadBase.m + k.rain * 0.3;
    CAR.grip = BASE_GRIP * (1 - k.rain * 0.3);
    // Streaks.
    this.lines.visible = k.rain > 0.02;
    if (!this.lines.visible) return;
    this.lines.material.opacity = 0.65 * k.rain;
    const P = this.lines.geometry.attributes.position.array, D = this.drops, B = this.box;
    const fall = 24 * dt, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < this.N; i++) {
      D[i * 3 + 1] -= fall;
      if (D[i * 3 + 1] < -30) { D[i * 3 + 1] += 60; D[i * 3] = (Math.random() - 0.5) * B * 2; D[i * 3 + 2] = (Math.random() - 0.5) * B * 2; }
      const x = cx + D[i * 3], y = cy + D[i * 3 + 1], z = cz + D[i * 3 + 2];
      P[i * 6] = x; P[i * 6 + 1] = y; P[i * 6 + 2] = z;
      P[i * 6 + 3] = x + 0.08; P[i * 6 + 4] = y + 0.9; P[i * 6 + 5] = z + 0.05;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
