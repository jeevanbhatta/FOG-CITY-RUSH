// Keyboard, mouse (pointer lock) and touch input, folded into one simple state object.

export class Input {
  constructor(canvas, touchRoot) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.lookDX = 0;
    this.lookDY = 0;
    this.move = { x: 0, y: 0 }; // x: right, y: forward
    this.touchMove = { x: 0, y: 0, active: false };
    this.touchButtons = new Set();
    this.isTouch = false;
    this.enabled = false;
    this.sensitivity = 0.0024;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => {
      if (this.enabled && !this.isTouch && document.pointerLockElement !== canvas) {
        try {
          const p = canvas.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch (_) { /* pointer lock unavailable: drag to look instead */ }
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      } else if (this.dragging) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 2 || document.pointerLockElement !== canvas) this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Show touch controls as soon as the device is touch-first or any touch happens.
    const markTouch = () => { this.isTouch = true; document.body.classList.add('touch'); };
    if (matchMedia('(pointer: coarse)').matches) markTouch();
    window.addEventListener('touchstart', markTouch, { capture: true, passive: true });

    this.setupTouch(touchRoot);
  }

  setupTouch(root) {
    const stick = root.querySelector('[data-stick]');
    const knob = root.querySelector('[data-knob]');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const radius = 56;

    const onStart = (e) => {
      this.isTouch = true;
      document.body.classList.add('touch');
      for (const t of e.changedTouches) {
        const btn = t.target.closest && t.target.closest('[data-btn]');
        if (btn) {
          const name = btn.dataset.btn;
          this.touchButtons.add(name);
          this.pressed.add('touch:' + name);
          btn.classList.add('down');
          btn.dataset.touch = t.identifier;
          continue;
        }
        if (t.clientX < window.innerWidth * 0.45 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = sx + 'px';
          stick.style.top = sy + 'px';
          stick.classList.add('on');
          this.touchMove.active = true;
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
      if (this.enabled) e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy;
          const d = Math.hypot(dx, dy);
          if (d > radius) { dx *= radius / d; dy *= radius / d; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.touchMove.x = dx / radius;
          this.touchMove.y = -dy / radius;
        } else if (t.identifier === lookId) {
          this.lookDX += (t.clientX - lx) * 1.6;
          this.lookDY += (t.clientY - ly) * 1.6;
          lx = t.clientX; ly = t.clientY;
        }
      }
      if (this.enabled) e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          stickId = null;
          this.touchMove.x = this.touchMove.y = 0;
          this.touchMove.active = false;
          knob.style.transform = '';
          stick.classList.remove('on');
        } else if (t.identifier === lookId) {
          lookId = null;
        }
        root.querySelectorAll('[data-btn]').forEach((b) => {
          if (b.dataset.touch == t.identifier) {
            this.touchButtons.delete(b.dataset.btn);
            b.classList.remove('down');
            delete b.dataset.touch;
          }
        });
      }
    };
    root.addEventListener('touchstart', onStart, { passive: false });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c) || (c.startsWith('touch:') && this.touchButtons.has(c.slice(6))));
  }

  hit(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  update() {
    let x = 0, y = 0;
    if (this.down('KeyW', 'ArrowUp')) y += 1;
    if (this.down('KeyS', 'ArrowDown')) y -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    if (this.touchMove.active) { x = this.touchMove.x; y = this.touchMove.y; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x;
    this.move.y = y;
  }

  get jump() { return this.down('Space', 'touch:jump'); }
  get jumpHit() { return this.hit('Space', 'touch:jump'); }
  get sprint() { return this.down('ShiftLeft', 'ShiftRight', 'touch:sprint'); }
  get slideHit() { return this.hit('KeyC', 'ControlLeft', 'touch:slide'); }
  get slide() { return this.down('KeyC', 'ControlLeft', 'touch:slide'); }
  get grabHit() { return this.hit('KeyE', 'touch:grab'); }

  consumeLook() {
    const dx = this.lookDX, dy = this.lookDY;
    this.lookDX = 0; this.lookDY = 0;
    return [dx * this.sensitivity, dy * this.sensitivity];
  }

  endFrame() {
    this.pressed.clear();
  }
}
