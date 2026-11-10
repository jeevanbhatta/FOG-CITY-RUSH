// Corner minimap: the city pre-drawn once, then rotated so "up" is wherever the camera looks.

export const SCALE = 3; // metres per pixel in the pre-drawn map

export class Minimap {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const [minX, minZ, maxX, maxZ] = map.meta.bounds;
    this.minX = minX - 400; this.minZ = minZ - 400;
    const w = Math.ceil((maxX - minX + 1200) / SCALE), h = Math.ceil((maxZ - minZ + 800) / SCALE);
    const base = document.createElement('canvas');
    base.width = w; base.height = h;
    const g = base.getContext('2d');
    const P = (x, z) => [(x - this.minX) / SCALE, (z - this.minZ) / SCALE];
    const poly = (pts, fill) => {
      g.beginPath();
      pts.forEach((q, i) => { const [x, y] = P(q[0], q[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    g.fillStyle = '#4b6c79';
    g.fillRect(0, 0, w, h);
    for (const p of map.land) poly(p, '#d8d3c8');
    for (const p of map.parks) poly(p, '#9db487');
    g.lineCap = 'round';
    g.strokeStyle = '#7d8189';
    for (const r of map.roads) {
      if (r.k === 'footway' || r.k === 'service') continue;
      g.lineWidth = Math.max(1, r.w / SCALE);
      g.beginPath();
      r.p.forEach((q, i) => { const [x, y] = P(q[0], q[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    }
    for (const b of map.buildings) poly(b.p, b.h > 60 ? '#5f6b74' : '#a8a196');
    this.base = base;
    this.extras = [];
  }

  // A line drawn on the base map, e.g. the bridge.
  line(ax, az, bx, bz, width, color) {
    const g = this.base.getContext('2d');
    g.strokeStyle = color;
    g.lineWidth = width / SCALE;
    g.beginPath();
    g.moveTo((ax - this.minX) / SCALE, (az - this.minZ) / SCALE);
    g.lineTo((bx - this.minX) / SCALE, (bz - this.minZ) / SCALE);
    g.stroke();
  }

  draw(focus, heading, camYaw, marks) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const zoom = 1.25; // screen px per base px
    c.save();
    c.clearRect(0, 0, W, H);
    c.translate(W / 2, H / 2);
    // Camera forward is (-sin yaw, -cos yaw); rotate so it points up the canvas.
    c.rotate(camYaw);
    c.scale(zoom, zoom);
    c.drawImage(this.base, -(focus.x - this.minX) / SCALE, -(focus.z - this.minZ) / SCALE);
    c.restore();

    const R = W / 2 - 6;
    const toScreen = (x, z) => {
      const dx = (x - focus.x) / SCALE * zoom, dz = (z - focus.z) / SCALE * zoom;
      const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
      let sx = dx * cs - dz * sn, sy = dx * sn + dz * cs;
      const d = Math.hypot(sx, sy);
      const clamped = d > R;
      if (clamped) { sx *= R / d; sy *= R / d; }
      return [W / 2 + sx, H / 2 + sy, clamped];
    };
    for (const m of marks) {
      const [x, y, edge] = toScreen(m.x, m.z);
      c.fillStyle = m.color;
      c.beginPath();
      if (m.shape === 'square') c.rect(x - 3, y - 3, 6, 6);
      else c.arc(x, y, edge ? 4 : m.r || 4, 0, Math.PI * 2);
      c.fill();
      if (m.ring) { c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); }
    }
    // The courier: an arrow pointing along their heading.
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(camYaw - heading + Math.PI);
    c.fillStyle = '#ff6a2b';
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -8); c.lineTo(6, 6); c.lineTo(0, 3); c.lineTo(-6, 6); c.closePath();
    c.stroke(); c.fill();
    c.restore();
  }
}
