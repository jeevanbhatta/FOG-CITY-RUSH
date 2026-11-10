// DOM overlay: timer, stats, toasts, checkpoint pointer, menus.

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

const $ = (sel) => document.querySelector(sel);

export class Hud {
  constructor() {
    this.el = {
      hud: $('#hud'),
      course: $('#hud-course'),
      cp: $('#hud-cp'),
      time: $('#hud-time'),
      best: $('#hud-best'),
      speed: $('#hud-speed'),
      alt: $('#hud-alt'),
      toast: $('#toast'),
      prompt: $('#prompt'),
      pointer: $('#pointer'),
      pointerDist: $('#pointer-dist'),
      countdown: $('#countdown'),
    };
    this.toastTimer = 0;
  }

  show(on) {
    this.el.hud.hidden = !on;
  }

  setCourse(name, best, target) {
    this.el.course.textContent = name;
    const parts = [];
    if (best != null) parts.push(`Best ${fmtTime(best)}`);
    if (target) parts.push(`${target.name} ${fmtTime(target.time)}`);
    this.el.best.textContent = parts.join(' · ');
    this.el.time.hidden = name === 'Free roam' || name === 'City life';
    this.el.cp.hidden = name === 'Free roam' || name === 'City life';
  }

  setRival(name, time) {
    this.el.best.textContent = `${name} ${fmtTime(time)}`;
  }

  toast(text, ms = 1100) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.remove('on');
    void t.offsetWidth;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }

  countdown(text) {
    const c = this.el.countdown;
    if (!text) { c.hidden = true; return; }
    c.hidden = false;
    if (c.textContent !== text) {
      c.textContent = text;
      c.classList.remove('pop');
      void c.offsetWidth;
      c.classList.add('pop');
    }
  }

  update(state) {
    const { runner, camera, next, focus } = state;
    this.el.speed.textContent = Math.round(state.speed * 3.6);
    this.el.alt.textContent = Math.max(0, Math.round(state.alt));
    const thr = document.getElementById('stat-thr');
    thr.hidden = state.throttle == null;
    if (state.throttle != null) document.getElementById('hud-thr').textContent = Math.round(state.throttle * 100);
    if (runner.course) {
      this.el.time.textContent = fmtTime(runner.time);
      this.el.cp.textContent = `${Math.min(runner.index, runner.course.pts.length - 1)} / ${runner.course.pts.length - 1}`;
    }
    this.el.prompt.textContent = state.prompt || '';
    this.el.prompt.hidden = !state.prompt;

    // Checkpoint pointer: on-screen marker or an edge arrow.
    const p = this.el.pointer;
    if (!next) { p.hidden = true; return; }
    const v = next.clone();
    v.y += 1.4;
    const dist = focus.distanceTo(next);
    v.project(camera);
    const behind = v.z > 1;
    let x = v.x, y = v.y;
    if (behind) { x = -x; y = -y; }
    const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
    if (!onScreen) {
      const m = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.85);
      x /= m; y /= m;
    }
    const W = window.innerWidth, H = window.innerHeight;
    const sx = (x * 0.5 + 0.5) * W, sy = (-y * 0.5 + 0.5) * H;
    p.hidden = false;
    p.style.transform = `translate(${sx}px, ${sy}px)`;
    p.classList.toggle('edge', !onScreen);
    const ang = Math.atan2(-y, x);
    p.style.setProperty('--ang', `${ang}rad`);
    this.el.pointerDist.textContent = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`;
  }
}
