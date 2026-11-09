import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// Seeded random so textures look the same every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// One tile = 8 m wide × 7 m tall: two window bays, two floors. Greyscale, tinted per building.
export function masonryTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(7);
  g.fillStyle = '#ececec';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 220 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  for (let fy = 0; fy < 2; fy++) {
    // floor band
    g.fillStyle = '#d6d6d6';
    g.fillRect(0, fy * 128 + 118, 256, 10);
    for (let fx = 0; fx < 2; fx++) {
      const x = fx * 128 + 30, y = fy * 128 + 30, w = 68, h = 72;
      const dark = 70 + Math.floor(r() * 50);
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, `rgb(${dark + 40},${dark + 48},${dark + 58})`);
      grd.addColorStop(1, `rgb(${dark},${dark + 6},${dark + 14})`);
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.fillStyle = '#f7f7f7';
      g.fillRect(x - 4, y + h, w + 8, 6); // sill
      g.fillRect(x + w / 2 - 2, y, 4, h); // mullion
    }
  }
  return finish(c);
}

// Curtain wall for towers. One tile = 6 m × 7 m.
export function glassTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(11);
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, 256, 256);
  const cols = 4, rows = 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = 95 + Math.floor(r() * 45);
      const grd = g.createLinearGradient(0, y * 128, 0, y * 128 + 128);
      grd.addColorStop(0, `rgb(${v + 50},${v + 60},${v + 70})`);
      grd.addColorStop(1, `rgb(${v},${v + 8},${v + 18})`);
      g.fillStyle = grd;
      g.fillRect(x * 64 + 4, y * 128 + 4, 56, 104);
    }
    g.fillStyle = '#cfcfcf';
    g.fillRect(0, y * 128 + 108, 256, 20);
  }
  return finish(c);
}

// Painted service ladder, one tile = 1.2 m tall.
export function ladderTexture() {
  const [c, g] = canvas(64, 128);
  g.clearRect(0, 0, 64, 128);
  g.fillStyle = '#ff6a2b';
  g.fillRect(4, 0, 9, 128);
  g.fillRect(51, 0, 9, 128);
  for (let i = 0; i < 3; i++) {
    g.fillRect(4, i * 43 + 16, 56, 7);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(11, 0, 2, 128);
  g.fillRect(58, 0, 2, 128);
  return finish(c);
}

export function noiseTexture(base, spread, seed = 3, size = 256) {
  const [c, g] = canvas(size, size);
  const r = rng(seed);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = base + (r() - 0.5) * spread;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // a few cracks / joints so large plazas don't look flat
  g.strokeStyle = `rgba(0,0,0,0.08)`;
  g.lineWidth = 2;
  for (let i = 0; i <= size; i += size / 4) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke();
  }
  return finish(c);
}

export function asphaltTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(5);
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 200 + (r() - 0.5) * 60;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c);
}

// Tileable water normal map from summed sine waves.
export function waterNormals() {
  const size = 256;
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const waves = [
    [1, 2, 0.6], [3, -1, 0.35], [-2, 3, 0.3], [5, 4, 0.15], [-6, 2, 0.12], [7, -5, 0.08],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const [kx, ky, a] of waves) {
        const ph = ((kx * x + ky * y) / size) * Math.PI * 2;
        const cs = Math.cos(ph) * a;
        dx += cs * kx; dy += cs * ky;
      }
      const nx = -dx * 0.08, ny = -dy * 0.08, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, { srgb: false });
}

export function clockFaceTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#e9e4d6';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#f8f5ea';
  g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = 6;
  g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.lineWidth = i % 3 === 0 ? 8 : 4;
    g.beginPath();
    g.moveTo(128 + Math.sin(a) * 92, 128 - Math.cos(a) * 92);
    g.lineTo(128 + Math.sin(a) * 106, 128 - Math.cos(a) * 106);
    g.stroke();
  }
  g.lineCap = 'round';
  g.lineWidth = 9;
  g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 50, 128 - 30); g.stroke();
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(128, 128); g.lineTo(128 - 10, 128 - 86); g.stroke();
  return finish(c, { repeat: false });
}

// Soft radial sprite used for fog banks.
export function puffTexture() {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return finish(c, { repeat: false });
}

// Night-time window lights laid out on the same grid as the facade textures, but covering
// 8 × 8 facade tiles so the pattern of lit windows doesn't visibly repeat.
export function windowLightsTexture(kind) {
  const tiles = 8, px = 128;
  const [c, g] = canvas(tiles * px, tiles * px);
  const r = rng(kind === 'glass' ? 21 : 17);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const warm = ['#ffd9a0', '#ffe6b8', '#fff1d6', '#ffcf8a', '#e8f0ff'];
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const ox = tx * px, oy = ty * px;
      if (kind === 'glass') {
        for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
          if (r() > 0.3) continue;
          g.fillStyle = warm[Math.floor(r() * warm.length)];
          g.fillRect(ox + x * 32 + 2, oy + y * 64 + 2, 28, 52);
        }
      } else {
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          if (r() > 0.28) continue;
          g.fillStyle = warm[Math.floor(r() * warm.length)];
          g.fillRect(ox + x * 64 + 15, oy + y * 64 + 15, 34, 36);
        }
      }
    }
  }
  const t = finish(c);
  t.repeat.set(1 / tiles, 1 / tiles);
  return t;
}
