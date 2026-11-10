import { SCALE } from './minimap.js';

// Full-screen map (Tab): the whole district, you, postcards, jobs and your waypoint.
// Click or tap anywhere to set a waypoint; click it again to clear it.

export class BigMap {
  constructor(el, minimap, onPick) {
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.mini = minimap;
    this.onPick = onPick;
    this.marks = [];
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const [x, z] = this.toWorld((e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr);
      this.onPick(x, z);
      this.draw(this.last);
    });
  }

  get open() { return !this.el.hidden; }

  show(on, state) {
    this.el.hidden = !on;
    if (on) this.draw(state);
  }

  fit() {
    const b = this.mini.base;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth * this.dpr, H = this.canvas.clientHeight * this.dpr;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.k = Math.min(W / b.width, H / b.height) * 0.96;
    this.ox = (W - b.width * this.k) / 2;
    this.oy = (H - b.height * this.k) / 2;
  }

  toScreen(x, z) { return [this.ox + ((x - this.mini.minX) / SCALE) * this.k, this.oy + ((z - this.mini.minZ) / SCALE) * this.k]; }
  toWorld(sx, sy) { return [((sx - this.ox) / this.k) * SCALE + this.mini.minX, ((sy - this.oy) / this.k) * SCALE + this.mini.minZ]; }

  // state: { focus, heading, marks: [{x, z, color, r, label, ring, square}], waypoint }
  draw(state) {
    if (!state) return;
    this.last = state;
    this.fit();
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    c.fillStyle = '#3f5f6c';
    c.fillRect(0, 0, W, H);
    c.drawImage(this.mini.base, this.ox, this.oy, this.mini.base.width * this.k, this.mini.base.height * this.k);
    const px = 1 * this.dpr;
    c.font = `600 ${12 * px}px "Barlow Semi Condensed", sans-serif`;
    c.textAlign = 'center';
    for (const m of state.marks) {
      const [x, y] = this.toScreen(m.x, m.z);
      c.fillStyle = m.color;
      c.beginPath();
      if (m.square) c.rect(x - 4 * px, y - 4 * px, 8 * px, 8 * px);
      else c.arc(x, y, (m.r || 4) * px, 0, Math.PI * 2);
      c.fill();
      if (m.ring) { c.lineWidth = 2 * px; c.strokeStyle = '#fff'; c.stroke(); }
      if (m.label) {
        c.fillStyle = '#1f3440';
        c.strokeStyle = 'rgba(255,255,255,0.85)';
        c.lineWidth = 3 * px;
        c.strokeText(m.label, x, y - 9 * px);
        c.fillText(m.label, x, y - 9 * px);
      }
    }
    if (state.waypoint) {
      const [x, y] = this.toScreen(state.waypoint.x, state.waypoint.z);
      c.fillStyle = '#ffd34d'; c.strokeStyle = '#1f3440'; c.lineWidth = 2 * px;
      c.beginPath();
      c.moveTo(x, y); c.lineTo(x - 7 * px, y - 14 * px); c.arc(x, y - 16 * px, 7 * px, Math.PI * 0.8, Math.PI * 0.2, false); c.closePath();
      c.fill(); c.stroke();
    }
    // You.
    const [x, y] = this.toScreen(state.focus.x, state.focus.z);
    c.save();
    c.translate(x, y);
    c.rotate(Math.PI - state.heading);
    c.fillStyle = '#ff6a2b'; c.strokeStyle = '#fff'; c.lineWidth = 2 * px;
    c.beginPath(); c.moveTo(0, -10 * px); c.lineTo(7 * px, 8 * px); c.lineTo(0, 4 * px); c.lineTo(-7 * px, 8 * px); c.closePath();
    c.stroke(); c.fill();
    c.restore();
  }
}
