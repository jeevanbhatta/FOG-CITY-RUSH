import * as THREE from 'three';
import { BRIDGE } from './world.js';

// Fog City postcards hidden around the city for free roam. Collected ones are remembered per browser.

function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function placeParcels(W, V) {
  const spots = [];
  const world = W.world;
  const r = rand(2026);
  const bi = W.landmarks.bridgeInfo;
  const f = W.landmarks.hub;
  const hb = f.balcony;
  // Landmark spots first.
  spots.push([f.face[0] * hb.r, hb.y + 0.6, f.face[1] * hb.r, hb.name]);
  const t1 = bi.at(BRIDGE.towers[0], 0); spots.push([t1[0], bi.towerTop + 0.6, t1[1], 'Bridge tower top']);
  const t2 = bi.at(BRIDGE.towers[1], 0); spots.push([t2[0], bi.towerTop + 0.6, t2[1], 'Far bridge tower']);
  const mid = bi.at((BRIDGE.towers[0] + BRIDGE.towers[1]) / 2, -(BRIDGE.halfWidth + 0.5));
  spots.push([mid[0], bi.cableY((BRIDGE.towers[0] + BRIDGE.towers[1]) / 2) + 1.3, mid[1], 'Cable low point']);
  const anc = bi.at(BRIDGE.centreU + 22, 0); spots.push([anc[0], bi.endTop + 0.6, anc[1], BRIDGE.endName || 'Bridge end']);
  if (W.landmarks.tallest) spots.push([W.landmarks.tallest.x, W.landmarks.tallest.y + 0.6, W.landmarks.tallest.z, 'Top of the skyline']);
  // Rooftops that have a ladder or a zipline landing.
  const roofs = [];
  for (const L of world.ladders) {
    if (L.y1 < 12 || L.y1 > 140) continue;
    const x = L.x - L.nx * 3, z = L.z - L.nz * 3;
    const fl = world.floorAt(x, z, L.y1 + 0.5, 0);
    if (fl.solid && Math.abs(fl.y - L.y1) < 0.6 && !world.pointBlocked(x, L.y1 + 1, z)) roofs.push([x, L.y1 + 0.6, z]);
  }
  for (const Z of world.ziplines) roofs.push([Z.bx, Z.by - 2.1, Z.bz]);
  // Spread them out: pick far-apart roofs.
  const picked = [];
  for (let tries = 0; tries < 2000 && picked.length < 14 && roofs.length; tries++) {
    const c = roofs[Math.floor(r() * roofs.length)];
    if (picked.some((p) => Math.hypot(p[0] - c[0], p[2] - c[2]) < 140)) continue;
    picked.push(c);
  }
  for (const c of picked) spots.push([c[0], c[1], c[2], 'Rooftop']);
  // Pier ends, reachable by running or by seaplane.
  for (const p of W.map.piers) {
    if (spots.length >= 25) break;
    let far = null, fd = -1;
    for (const q of p) {
      const d = Math.hypot(q[0], q[1]);
      if (d > fd) { fd = d; far = q; }
    }
    let cx = 0, cz = 0;
    for (const q of p) { cx += q[0]; cz += q[1]; }
    cx /= p.length; cz /= p.length;
    const x = far[0] + (cx - far[0]) * 0.15, z = far[1] + (cz - far[1]) * 0.15;
    const fl = world.floorAt(x, z, 3, 0);
    if (!fl.solid || world.pointBlocked(x, fl.y + 1, z)) continue;
    if (spots.some((s) => Math.hypot(s[0] - x, s[2] - z) < 120)) continue;
    spots.push([x, fl.y + 0.6, z, 'Pier end']);
  }
  return spots.slice(0, 25);
}

export class Parcels {
  constructor(scene, spots, collected) {
    this.spots = spots;
    this.collected = new Set(collected || []);
    // A little painted postcard: fog over the bay, the bridge, a sun.
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 88;
      const g = c.getContext('2d');
      g.fillStyle = '#f4efe2'; g.fillRect(0, 0, 128, 88);
      const sky = g.createLinearGradient(0, 6, 0, 60);
      sky.addColorStop(0, '#f2b880'); sky.addColorStop(1, '#e9d9c4');
      g.fillStyle = sky; g.fillRect(6, 6, 116, 54);
      g.fillStyle = '#ff6a2b'; g.beginPath(); g.arc(92, 26, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4b6c79'; g.fillRect(6, 46, 116, 14);
      g.strokeStyle = '#1f3440'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(30, 46); g.lineTo(30, 18); g.moveTo(80, 46); g.lineTo(80, 18); g.stroke();
      g.lineWidth = 1.5; g.beginPath(); g.moveTo(6, 30); g.quadraticCurveTo(18, 40, 30, 18); g.quadraticCurveTo(55, 44, 80, 18); g.quadraticCurveTo(100, 40, 122, 32); g.stroke();
      g.fillStyle = '#1f3440'; g.fillRect(6, 40, 116, 2);
      g.font = 'bold 13px sans-serif'; g.fillText('FOG CITY', 10, 78);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const geo = new THREE.BoxGeometry(0.9, 0.62, 0.03);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0x553311, emissiveIntensity: 0.35 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a4b, transparent: true, opacity: 0.18, depthWrite: false });
    const glowGeo = new THREE.CylinderGeometry(0.9, 0.9, 6, 12, 1, true);
    glowGeo.translate(0, 3, 0);
    this.items = spots.map((s, i) => {
      const g = new THREE.Group();
      const box = new THREE.Mesh(geo, mat);
      box.castShadow = true;
      g.add(box, new THREE.Mesh(glowGeo, glowMat));
      g.position.set(s[0], s[1], s[2]);
      g.visible = false;
      scene.add(g);
      return { g, box, i };
    });
  }

  get total() { return this.spots.length; }
  get count() { return this.collected.size; }

  show(on) {
    for (const it of this.items) it.g.visible = on && !this.collected.has(it.i);
  }

  // Returns the index collected this frame, or -1.
  update(dt, t, focus, reach) {
    let got = -1;
    for (const it of this.items) {
      if (!it.g.visible) continue;
      it.box.rotation.y = t * 1.5 + it.i;
      it.box.position.y = 0.35 + Math.sin(t * 2 + it.i) * 0.12;
      const p = it.g.position;
      const dx = focus.x - p.x, dy = focus.y + 0.9 - p.y, dz = focus.z - p.z;
      if (dx * dx + dz * dz < reach * reach && Math.abs(dy) < reach + 0.8) {
        this.collected.add(it.i);
        it.g.visible = false;
        got = it.i;
      }
    }
    return got;
  }

  nearestUncollected(focus) {
    let best = null, bd = Infinity;
    for (const it of this.items) {
      if (this.collected.has(it.i)) continue;
      const d = it.g.position.distanceTo(focus);
      if (d < bd) { bd = d; best = it; }
    }
    return best ? { pos: best.g.position, dist: bd, label: this.spots[best.i][3] } : null;
  }
}
