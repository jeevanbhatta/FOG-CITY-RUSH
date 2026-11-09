import * as THREE from 'three';

// Gradient sky dome plus a slow time-of-day cycle: bright fog-day, golden hour, dusk, and back.
// Everything the cycle touches (sun, ambient, fog, sky, window lights) is driven from here.

const KEYS = [
  // u, sunElev, sunColor, sunI, hemiSky, hemiGround, hemiI, zenith, horizon, lights, exposure
  [0.0, 0.95, '#fff0d8', 1.7, '#dfe7ec', '#8b8273', 1.25, '#9fb3bf', '#cdd5d8', 0, 1.05],
  [0.42, 0.95, '#fff0d8', 1.7, '#dfe7ec', '#8b8273', 1.25, '#9fb3bf', '#cdd5d8', 0, 1.05],
  [0.6, 0.32, '#ffc58a', 1.5, '#e8d9c8', '#7d6b5c', 1.0, '#8ea2b8', '#e6c9a8', 0.25, 1.05],
  [0.74, 0.08, '#ff9a6a', 0.75, '#9196ad', '#4f454c', 0.85, '#41557a', '#c99a8f', 1, 1.12],
  [0.86, 0.3, '#ffc58a', 1.4, '#d9d2c8', '#6f6458', 0.95, '#8396ad', '#ddc0a6', 0.35, 1.05],
  [1.0, 0.95, '#fff0d8', 1.7, '#dfe7ec', '#8b8273', 1.25, '#9fb3bf', '#cdd5d8', 0, 1.05],
];
const FIXED = { day: 0.2, dusk: 0.74 };
const CYCLE_SECONDS = 600;

export class Sky {
  constructor(scene, sun, hemi, renderer) {
    this.scene = scene; this.sun = sun; this.hemi = hemi; this.renderer = renderer;
    this.mode = 'cycle';
    this.u = 0.1;
    this.uniforms = {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.uniforms,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.7, h));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18) * smoothstep(0.02, 0.3, vDir.y);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 16), mat);
    this.dome.renderOrder = -1;
    scene.add(this.dome);
    this.sunOffset = new THREE.Vector3();
    this.lights = 0;
    this.fogBase = 1150;
    this.state = {};
    this.apply(0);
  }

  setMode(m) { this.mode = m; }

  sample(u) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (u >= KEYS[i][0] && u <= KEYS[i + 1][0]) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const t = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
    const n = (i) => a[i] + (b[i] - a[i]) * t;
    const c = (i) => new THREE.Color(a[i]).lerp(new THREE.Color(b[i]), t);
    return {
      elev: n(1), sunColor: c(2), sunI: n(3), hemiSky: c(4), hemiGround: c(5), hemiI: n(6),
      zenith: c(7), horizon: c(8), lights: n(9), exposure: n(10),
    };
  }

  apply(dt, elapsed = 0) {
    if (this.mode === 'cycle') this.u = (this.u + dt / CYCLE_SECONDS) % 1;
    else this.u = FIXED[this.mode];
    const s = this.sample(this.u);
    const az = 2.3;
    const el = s.elev;
    this.sunOffset.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(260);
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunI;
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiI;
    this.uniforms.zenith.value.copy(s.zenith);
    this.uniforms.horizon.value.copy(s.horizon);
    this.uniforms.sunColor.value.copy(s.sunColor);
    this.uniforms.sunDir.value.copy(this.sunOffset).normalize();
    this.scene.fog.color.copy(s.horizon);
    this.scene.background = s.horizon;
    // Fog breathes in and out over a couple of minutes.
    const roll = 0.5 + 0.5 * Math.sin(elapsed * 0.045) * Math.sin(elapsed * 0.017 + 1.3);
    this.scene.fog.far = this.fogBase * (0.72 + 0.4 * roll);
    this.scene.fog.near = 40 + 60 * roll;
    this.renderer.toneMappingExposure = s.exposure;
    this.lights = s.lights;
  }

  follow(camera) {
    this.dome.position.copy(camera.position);
  }
}
