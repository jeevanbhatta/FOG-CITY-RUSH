// Two self-running gigs for City Life: a food truck you park and cook from, and a walking tour
// you lead around the district. Each is a small class the gig engine in main.js delegates to
// (see docs/integration-minigames.md):
//   static start(ctx) -> instance | null     null when there's nowhere sensible to run it
//   update(dt, ctx)   -> null | {done: true, pay, note} | {failed: true, note}
//   dispose(ctx)      removes every mesh, texture and material it made
//   label / info / target                    HUD objective, short status, pointer position
// They only talk to the game through ctx (docs/module-contract.md).

export const CAREER_ENTRIES = [
  { id: 'foodtruck', name: 'Food-truck owner', blurb: 'Park your truck somewhere busy and feed the queue. Fast service earns tips; lunch and dinner bring crowds.', color: '#f4a259' },
  { id: 'guide', name: 'Walking tour guide', blurb: 'Lead a group of sightseers on foot to three stops and tell them the stories. Don’t lose anyone.', color: '#43aa8b' },
];

const SKIN = [0xf1c6a6, 0xd9a07a, 0xc58c66, 0x8d5a3b, 0x5a3a28];
const SHIRTS = [0xe8552b, 0x3d5a80, 0x2aa198, 0xd9a441, 0x6b6f73, 0x8a1f1f, 0xf2efe6, 0x1f3a2f, 0x9b5de5, 0x4f7a63];
const TOURIST_SHIRTS = [0xff6f91, 0x00b4d8, 0xffd166, 0x06d6a0, 0xf77f00, 0xb5179e];
const HATS = [0xfff1c1, 0xffffff, 0xf4d35e, 0xee964b, 0x90e0ef, 0xffadad];
const TRUCK_COLOURS = [0xe63946, 0x2a9d8f, 0xf4a261, 0x6a4c93, 0x1982c4, 0xffca3a];
const ORDERS = [
  { id: 'noodles', icon: '🍜', color: '#e9b44c' },
  { id: 'taco', icon: '🌮', color: '#e8552b' },
  { id: 'coffee', icon: '☕', color: '#7a4a2a' },
];

// --- shared helpers ---

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const focusOf = (ctx) => (ctx.getDriving() ? ctx.getDriving().pos : ctx.player.pos);

// Ground height at (x, z) if it's open street-level ground you could stand on, else null.
function groundAt(ctx, x, z, maxY = 3) {
  const fl = ctx.W.world.floorAt(x, z, maxY, 0);
  if (!fl.solid || ctx.W.world.pointBlocked(x, fl.y + 1, z)) return null;
  return fl.y;
}

// Named streets (no footways or service lanes), cached per map.
const streetCache = new WeakMap();
function namedStreets(ctx) {
  const map = ctx.W.map;
  if (!streetCache.has(map)) streetCache.set(map, (map.roads || []).filter((r) => r.n && r.k !== 'footway' && r.k !== 'service' && r.p.length > 1));
  return streetCache.get(map);
}

// A random named-street node minD..maxD from `from`, on solid open ground, with the street's direction.
function pickStreet(ctx, from, minD, maxD, ok = () => true) {
  const streets = namedStreets(ctx);
  for (let i = 0; i < 300 && streets.length; i++) {
    const r = pick(streets);
    const j = Math.floor(Math.random() * r.p.length);
    const q = r.p[j];
    const d = Math.hypot(q[0] - from.x, q[1] - from.z);
    if (d < minD || d > maxD) continue;
    const y = groundAt(ctx, q[0], q[1]);
    if (y == null) continue;
    const a = r.p[Math.max(0, j - 1)], b = r.p[Math.min(r.p.length - 1, j + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const s = { x: q[0], y, z: q[1], name: r.n, w: r.w || 8, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l };
    if (ok(s)) return s;
  }
  return null;
}

// Keeps track of everything a gig puts in the scene so dispose() can free it all.
class Bag {
  constructor(ctx) { this.ctx = ctx; this.res = []; this.roots = []; }
  keep(r) { this.res.push(r); return r; }
  add(o) { this.ctx.scene.add(o); this.roots.push(o); return o; }
  drop(o) {
    this.ctx.scene.remove(o);
    const i = this.roots.indexOf(o);
    if (i >= 0) this.roots.splice(i, 1);
    // Per-person sprites own their texture and material; free them now rather than at the end.
    o.traverse((c) => { if (c.isSprite && c.userData.own) { c.material.map.dispose(); c.material.dispose(); } });
  }
  dispose() {
    for (const o of this.roots.slice()) this.drop(o);
    for (const r of this.res) r.dispose();
    this.res = [];
  }
}

function canvasTex(ctx, bag, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new ctx.THREE.CanvasTexture(c);
  t.colorSpace = ctx.THREE.SRGBColorSpace;
  return bag ? bag.keep(t) : t;
}

// Low-poly people built from shared geometry: legs on hip pivots so they can swing, optional
// sun hat and camera for tourists.
function personKit(ctx, bag) {
  const { THREE } = ctx;
  const g = {
    leg: bag.keep(new THREE.CylinderGeometry(0.09, 0.075, 0.85, 6).translate(0, -0.425, 0)),
    torso: bag.keep(new THREE.CylinderGeometry(0.2, 0.24, 0.7, 7)),
    head: bag.keep(new THREE.SphereGeometry(0.15, 8, 6)),
    brim: bag.keep(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 12)),
    crown: bag.keep(new THREE.CylinderGeometry(0.13, 0.16, 0.13, 10)),
    cam: bag.keep(new THREE.BoxGeometry(0.2, 0.13, 0.1)),
    strap: bag.keep(new THREE.TorusGeometry(0.2, 0.012, 4, 12)),
  };
  const mats = new Map();
  const mat = (c) => {
    if (!mats.has(c)) mats.set(c, bag.keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })));
    return mats.get(c);
  };
  return ({ shirt, skin, pants = 0x2c3440, hat = null, camera = false }) => {
    const root = new THREE.Group();
    const legs = [-0.1, 0.1].map((x) => {
      const m = new THREE.Mesh(g.leg, mat(pants));
      m.position.set(x, 0.85, 0);
      return m;
    });
    const torso = new THREE.Mesh(g.torso, mat(shirt)); torso.position.y = 1.2;
    const head = new THREE.Mesh(g.head, mat(skin)); head.position.y = 1.72;
    root.add(...legs, torso, head);
    if (hat != null) {
      const brim = new THREE.Mesh(g.brim, mat(hat)); brim.position.y = 1.83;
      const crown = new THREE.Mesh(g.crown, mat(hat)); crown.position.y = 1.9;
      root.add(brim, crown);
    }
    if (camera) {
      const cam = new THREE.Mesh(g.cam, mat(0x1d1f22)); cam.position.set(0, 1.12, 0.26);
      const strap = new THREE.Mesh(g.strap, mat(0x1d1f22)); strap.position.set(0, 1.38, 0.05); strap.rotation.x = 1.2;
      root.add(cam, strap);
    }
    root.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    root.userData.legs = legs;
    root.userData.phase = Math.random() * 6;
    return root;
  };
}

// Swing the legs and bob while moving; settle when standing still.
function animatePerson(p, speed, t) {
  const k = clamp(speed / 1.6, 0, 1.4);
  const s = Math.sin(t * (5 + speed * 2.2) + p.userData.phase);
  p.userData.legs[0].rotation.x = s * 0.55 * k;
  p.userData.legs[1].rotation.x = -s * 0.55 * k;
  p.userData.bob = Math.abs(s) * 0.05 * k;
}

// Turn a person smoothly toward a heading.
function faceTo(p, yaw, dt) {
  let d = yaw - p.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  p.rotation.y += d * Math.min(1, dt * 8);
}

function playerName(ctx) {
  if (ctx.playerName) return String(ctx.playerName);
  try { return String(JSON.parse(localStorage.getItem('fcr.settings') || '{}').name || ''); } catch (_) { return ''; }
}

const mealRush = (ctx) => {
  const m = ((ctx.life.s.minute % 1440) + 1440) % 1440;
  return (m >= 690 && m <= 810) || (m >= 1080 && m <= 1230);
};

// ======================= Food truck =======================

const SERVICE_TIME = 90;
const MAX_QUEUE = 5;
const SERVE_COOLDOWN = 1.2;

export class FoodTruckGig {
  // A busy named street 100–500 m away, with room for the truck and a queue on its kerb side.
  static start(ctx) {
    const from = focusOf(ctx);
    const food = (() => { try { return ctx.foodSpots || []; } catch (_) { return []; } })();
    let place = null;
    const spot = pickStreet(ctx, from, 100, 500, (s) => {
      if (food.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < 25)) return false; // keep clear of the city's own trucks (their E prompt)
      for (const side of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
        const nx = -s.dz * side, nz = s.dx * side;
        const off = Math.max(0, s.w / 2 - 1.4); // park by the kerb, window toward the pavement
        const cx = s.x + nx * off, cz = s.z + nz * off;
        if (groundAt(ctx, cx, cz) == null) continue;
        // Window, front of the queue and its tail must all be open ground.
        const L = FoodTruckGig.local(cx, cz, s.dx, s.dz, nx, nz);
        if ([L(-0.8, 2.4), L(-0.8, 3.1), L(-5, 3.3), L(-10, 4)].every(([x, z]) => groundAt(ctx, x, z) != null)) {
          place = { x: cx, y: groundAt(ctx, cx, cz), z: cz, ax: s.dx, az: s.dz, nx, nz, name: s.name };
          return true;
        }
      }
      return false;
    });
    return spot && place ? new FoodTruckGig(ctx, place) : null;
  }

  // Local truck coordinates (x along the street, z out of the serving side) to world x, z.
  static local(cx, cz, ax, az, nx, nz) { return (lx, lz) => [cx + lx * ax + lz * nx, cz + lx * az + lz * nz]; }

  constructor(ctx, place) {
    this.p = place;
    this.L = FoodTruckGig.local(place.x, place.z, place.ax, place.az, place.nx, place.nz);
    this.bag = new Bag(ctx);
    this.stage = 0; // 0 drive/walk there, 1 service
    this.time = SERVICE_TIME;
    this.customers = [];
    this.served = 0;
    this.lost = 0;
    this.tips = 0;
    this.cool = 0;
    this.spawnT = 2;
    this.t = 0;
    this.note = '';
    this.noteT = 0;
    this.truck = null;
    this.wantsE = false;
    this.rush = false;
    this.dist = null;
    const [wx, wz] = this.L(-0.8, 2.0);
    this.window = { x: wx, y: place.y, z: wz };
  }

  get target() { return this.stage === 0 ? { x: this.p.x, y: this.p.y, z: this.p.z } : this.window; }
  get label() {
    return this.stage === 0 ? `Park your food truck on ${this.p.name}` : 'Serve the queue: stand at the window, press E';
  }
  get info() {
    if (this.stage === 0) return this.dist != null ? `${Math.round(this.dist)} m` : '';
    const waiting = this.customers.filter((c) => c.state === 'queue').length;
    const base = `${this.served} served · ${waiting} waiting · ${Math.ceil(this.time)} s${this.rush ? ' · meal rush' : ''}`;
    return this.noteT > 0 ? `${this.note} · ${base}` : base;
  }

  say(msg) { this.note = msg; this.noteT = 2.5; }

  update(dt, ctx) {
    this.t += dt;
    this.noteT -= dt;
    this.wantsE = false;
    const focus = focusOf(ctx);
    if (this.stage === 0) {
      this.dist = Math.hypot(focus.x - this.p.x, focus.z - this.p.z);
      if (this.dist < 6 && Math.abs(focus.y - this.p.y) < 4) {
        this.buildTruck(ctx);
        this.stage = 1;
        this.rush = mealRush(ctx);
        ctx.sound.chime();
        ctx.hud.toast(`Open for business! ${this.rush ? 'It’s a meal rush' : 'Customers incoming'}`, 1600);
        if (ctx.particles) ctx.particles.confetti(this.p.x, this.p.y + 3.5, this.p.z);
      }
      return null;
    }

    // --- service ---
    this.time -= dt;
    this.cool = Math.max(0, this.cool - dt);
    this.rush = mealRush(ctx);
    const away = Math.hypot(ctx.player.pos.x - this.window.x, ctx.player.pos.z - this.window.z);
    if (Math.hypot(focus.x - this.p.x, focus.z - this.p.z) > 80) {
      return { failed: true, note: 'You left the truck unattended. Gig failed' };
    }

    // New customers, quicker at lunch and dinner.
    this.spawnT -= dt;
    const live = this.customers.filter((c) => c.state !== 'leave').length;
    if (this.spawnT <= 0 && this.time > 6) {
      if (live < MAX_QUEUE) this.spawnCustomer(ctx);
      this.spawnT = this.rush ? 2.2 + Math.random() * 2.3 : 4.5 + Math.random() * 4;
    }

    this.updateCustomers(dt, ctx);

    // Serving: on foot, at the window.
    if (!ctx.getDriving() && away < 2.5 && Math.abs(ctx.player.pos.y - this.p.y) < 2) {
      const front = this.customers.find((c) => c.state === 'queue' && c.slot === 0 && c.arrived);
      if (front) {
        this.wantsE = true;
        ctx.setPrompt(this.cool > 0 ? 'Cooking…' : `Press E to serve the ${front.order.id}`);
        if (this.cool <= 0 && ctx.pressedE()) this.serve(ctx, front);
      } else if (this.cool > 0) ctx.setPrompt('Cooking…');
    } else if (ctx.getDriving()) {
      if (this.noteT <= 0) this.say('Get out and stand at the window');
    }

    // Steam off the griddle while there's a queue.
    if (ctx.particles && Math.random() < dt * (this.cool > 0 ? 8 : 1.5)) {
      const [sx, sz] = this.L(-0.6 + Math.random() * 0.6, 0.4);
      ctx.particles.smoke(sx, this.p.y + 3.1, sz);
    }

    if (this.time <= 0) {
      if (!this.served) return { failed: true, note: 'Nobody got fed. Gig failed' };
      const pay = this.served * 25 + this.tips;
      return { done: true, pay, note: `${this.served} served${this.lost ? `, ${this.lost} walked off` : ''} · $${this.tips} in tips` };
    }
    return null;
  }

  serve(ctx, c) {
    this.cool = SERVE_COOLDOWN;
    this.served++;
    const frac = clamp(c.patience / c.max, 0, 1);
    const tip = Math.round(frac > 0.75 ? 8 + Math.random() * 6 : frac > 0.45 ? 3 + Math.random() * 4 : 0);
    this.tips += tip;
    this.say(tip ? `+$25 · tip $${tip}` : '+$25');
    // Sizzle on the griddle, then a register ding.
    ctx.sound.burst(0.9, 'highpass', 3200, 0.14, 0.6);
    ctx.sound.burst(0.5, 'bandpass', 1800, 0.08, 1.2, 0.15);
    ctx.sound.tone(1568, 0.12, 'triangle', 0.08, null, 0.9);
    if (ctx.particles) ctx.particles.smoke(this.window.x, this.p.y + 2, this.window.z);
    this.leave(ctx, c, true);
  }

  // --- truck ---
  buildTruck(ctx) {
    const { THREE } = ctx;
    const bag = this.bag;
    const body = TRUCK_COLOURS[Math.floor(Math.random() * TRUCK_COLOURS.length)];
    const M = (o) => bag.keep(new THREE.MeshStandardMaterial({ roughness: 0.6, ...o }));
    const B = (w, h, d) => bag.keep(new THREE.BoxGeometry(w, h, d));
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    const paint = M({ color: body }), white = M({ color: 0xf6f3ea }), dark = M({ color: 0x22262b, roughness: 0.9 });
    add(B(4.4, 2.6, 2.4), paint, -0.8, 1.9, 0);                      // kitchen box
    add(B(1.7, 1.9, 2.3), paint, 2.25, 1.55, 0);                     // cab
    add(B(0.05, 0.8, 2.0), M({ color: 0x9ec9e0, metalness: 0.3, roughness: 0.2 }), 3.11, 1.95, 0); // windscreen
    add(B(6.2, 0.35, 2.45), white, -0.05, 0.75, 0);                  // trim stripe / chassis
    add(B(4.4, 0.12, 2.4), white, -0.8, 3.26, 0);                    // roof lip
    const wheel = bag.keep(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14).rotateX(Math.PI / 2));
    for (const [x, z] of [[-2.2, 1.1], [-2.2, -1.1], [2.2, 1.1], [2.2, -1.1]]) add(wheel, dark, x, 0.45, z);
    // Serving hatch: warm lit opening plus a fold-down counter.
    add(B(2.4, 1.1, 0.04), M({ color: 0x3a2a1a, emissive: 0xffb860, emissiveIntensity: 0.7 }), -0.8, 2.1, 1.21);
    add(B(2.6, 0.08, 0.5), M({ color: 0xc0c4c8, metalness: 0.5, roughness: 0.4 }), -0.8, 1.52, 1.45);
    // Striped awning, tilted down over the hatch.
    const stripes = canvasTex(ctx, bag, 128, 32, (c, w, h) => {
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#' + new THREE.Color(body).getHexString(); c.fillRect((i * w) / 8, 0, w / 8, h); }
    });
    const awning = add(B(3.2, 0.06, 1.3), M({ map: stripes }), -0.8, 3.0, 1.75);
    awning.rotation.x = 0.32;
    // Name board on the roof, both sides.
    const who = playerName(ctx);
    const title = who ? `${who.slice(0, 14)}’s Kitchen` : 'The Kitchen';
    const sign = canvasTex(ctx, bag, 512, 112, (c, w, h) => {
      c.fillStyle = '#1b1b1f'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffd34d'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#ffd34d'; c.textAlign = 'center'; c.textBaseline = 'middle';
      let size = 64;
      do { c.font = `bold ${size}px system-ui, sans-serif`; size -= 4; } while (c.measureText(title).width > w - 40 && size > 20);
      c.fillText(title, w / 2, h / 2 + 2);
    });
    const signMat = M({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.45 });
    const board = bag.keep(new THREE.PlaneGeometry(3.8, 0.83));
    const f = new THREE.Mesh(board, signMat); f.position.set(-0.8, 3.75, 0.05); g.add(f);
    const b = new THREE.Mesh(board, signMat); b.position.set(-0.8, 3.75, -0.05); b.rotation.y = Math.PI; g.add(b);
    add(B(3.9, 0.9, 0.06), dark, -0.8, 3.75, 0);
    // A chalkboard menu by the queue.
    const menu = canvasTex(ctx, bag, 128, 160, (c, w, h) => {
      c.fillStyle = '#20302a'; c.fillRect(0, 0, w, h);
      c.font = '28px system-ui, sans-serif'; c.textBaseline = 'middle';
      ORDERS.forEach((o, i) => { c.fillStyle = '#f2efe6'; c.fillText(`${o.icon} $${[9, 7, 4][i]}`, 14, 34 + i * 46); });
    });
    const mb = add(B(0.7, 0.9, 0.05), M({ map: menu }), 1.6, 0.9, 2.2);
    mb.rotation.x = -0.15;

    g.position.set(this.p.x, this.p.y, this.p.z);
    g.rotation.y = Math.atan2(this.p.nx, this.p.nz);
    this.truck = bag.add(g);
    this.kit = personKit(ctx, bag);
  }

  // --- customers ---
  slotPos(i) {
    return i === 0 ? this.L(-0.8, 3.1) : this.L(-0.8 - i * 1.05, 3.3 + (i % 2) * 0.25);
  }

  spawnCustomer(ctx) {
    const { THREE } = ctx;
    const side = Math.random() < 0.5 ? -1 : 1;
    let from = null;
    for (let i = 0; i < 8 && !from; i++) {
      const [x, z] = this.L(side * (12 + Math.random() * 14), 3 + Math.random() * 3);
      if (groundAt(ctx, x, z) != null) from = [x, z];
    }
    if (!from) from = this.L(-10, 4);
    const order = pick(ORDERS);
    const mesh = this.kit({ shirt: pick(SHIRTS), skin: pick(SKIN), pants: pick([0x2c3440, 0x3b3f46, 0x5c4a3a, 0x1f2a44]) });
    // Order bubble: icon in a disc, ringed by a patience arc that shrinks and goes red.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    sprite.scale.set(0.75, 0.75, 1);
    sprite.position.y = 2.35;
    sprite.userData.own = true;
    mesh.add(sprite);
    mesh.position.set(from[0], this.p.y, from[1]);
    this.bag.add(mesh);
    const max = 12 + Math.random() * 8;
    const c = { mesh, sprite, canvas, tex, order, patience: max, max, state: 'queue', slot: -1, arrived: false, drawn: -1, leaveT: 0 };
    this.customers.push(c);
    this.reslot();
    this.drawBubble(c);
  }

  drawBubble(c) {
    const f = clamp(c.patience / c.max, 0, 1);
    const q = Math.round(f * 40);
    if (q === c.drawn) return;
    c.drawn = q;
    const g = c.canvas.getContext('2d'), s = 96;
    g.clearRect(0, 0, s, s);
    g.beginPath(); g.arc(s / 2, s / 2, 44, 0, Math.PI * 2); g.fillStyle = 'rgba(20,22,26,0.55)'; g.fill();
    const col = f > 0.55 ? '#4cd964' : f > 0.28 ? '#ffcc00' : '#ff3b30';
    g.beginPath(); g.arc(s / 2, s / 2, 40, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); g.strokeStyle = col; g.lineWidth = 8; g.stroke();
    g.beginPath(); g.arc(s / 2, s / 2, 31, 0, Math.PI * 2); g.fillStyle = c.order.color; g.fill();
    g.font = '36px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(c.order.icon, s / 2, s / 2 + 3);
    c.tex.needsUpdate = true;
  }

  // Keep queue slots contiguous from the window.
  reslot() {
    let i = 0;
    for (const c of this.customers) if (c.state === 'queue') { if (c.slot !== i) c.arrived = false; c.slot = i++; }
  }

  leave(ctx, c, happy) {
    c.state = 'leave';
    c.slot = -1;
    c.happy = happy;
    const side = Math.random() < 0.5 ? -1 : 1;
    c.goal = this.L(side * 30, 4 + Math.random() * 3);
    c.mesh.remove(c.sprite);
    c.sprite.material.map.dispose(); c.sprite.material.dispose();
    if (!happy) {
      this.lost++;
      this.say('A customer gave up and left');
      ctx.sound.tone(330, 0.25, 'triangle', 0.07, 220);
    }
    this.reslot();
  }

  updateCustomers(dt, ctx) {
    for (const c of this.customers.slice()) {
      const m = c.mesh;
      let gx, gz;
      if (c.state === 'queue') {
        [gx, gz] = this.slotPos(c.slot);
        // Patience runs down once they're in line (and a little while still walking up).
        c.patience -= dt * (c.arrived ? 1 : 0.4);
        this.drawBubble(c);
        if (c.patience <= 0) { this.leave(ctx, c, false); continue; }
      } else { [gx, gz] = c.goal; c.leaveT += dt; }
      const dx = gx - m.position.x, dz = gz - m.position.z, d = Math.hypot(dx, dz);
      const speed = c.state === 'leave' ? (c.happy ? 1.4 : 1.9) : 1.5;
      let v = 0;
      if (d > 0.08) {
        const step = Math.min(d, speed * dt);
        m.position.x += (dx / d) * step; m.position.z += (dz / d) * step;
        v = step / Math.max(dt, 1e-4);
        faceTo(m, Math.atan2(dx, dz), dt);
      } else if (c.state === 'queue') {
        c.arrived = true;
        faceTo(m, Math.atan2(-this.p.nx, -this.p.nz), dt); // face the truck
      }
      animatePerson(m, v, this.t);
      m.position.y = this.p.y + (m.userData.bob || 0);
      if (c.sprite.parent) c.sprite.position.y = 2.35 + Math.sin(this.t * 3 + m.userData.phase) * 0.04;
      if (c.state === 'leave' && (d < 0.3 || c.leaveT > 25)) {
        this.bag.drop(m);
        this.customers.splice(this.customers.indexOf(c), 1);
      }
    }
  }

  dispose(ctx) {
    this.customers = [];
    this.truck = null;
    this.bag.dispose();
    this.wantsE = false;
  }
}

// ======================= Walking tour =======================

const GROUP = 6;
const WALK_MAX = 3.2;
const TALK_TIME = 8;

export class TourGuideGig {
  static start(ctx) {
    const H = ctx.W.landmarks && ctx.W.landmarks.hub;
    if (!H || !H.plaza) return null;
    const pz = H.plaza;
    const plazaY = ctx.W.world.floorAt(pz[0], pz[1], 3, 0);
    const s1 = { x: pz[0], y: plazaY.solid ? plazaY.y : 0, z: pz[1], name: `the ${ctx.D.hubName || 'hub'} plaza`, talk: 'history of the waterfront hub' };
    const s2 = pickStreet(ctx, s1, 150, 350);
    if (!s2) return null;
    const s3 = TourGuideGig.findWaterfront(ctx, s2, s1);
    if (!s3) return null;
    const p = ctx.player.pos;
    // Room around you for the group to spawn.
    const spots = [];
    for (let i = 0; i < 40 && spots.length < GROUP; i++) {
      const a = (i / GROUP) * Math.PI * 2 + Math.random() * 0.5, r = 2.2 + (i >= GROUP ? Math.random() * 3 : 0.6);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const fl = ctx.W.world.floorAt(x, z, p.y + 1, 0);
      if (fl.solid && Math.abs(fl.y - p.y) < 1.5 && !ctx.W.world.pointBlocked(x, fl.y + 1, z)) spots.push({ x, y: fl.y, z });
    }
    if (spots.length < GROUP) return null;
    return new TourGuideGig(ctx, [
      s1,
      { x: s2.x, y: s2.y, z: s2.z, name: s2.name, talk: `stories of ${s2.name}` },
      { ...s3, name: 'the waterfront', talk: 'the bay and its ships' },
    ], spots);
  }

  // Ground on the water's edge: solid underfoot, but nothing 25 m further out toward the bay.
  static findWaterfront(ctx, near, alt) {
    const H = ctx.W.landmarks.hub;
    let [dx, dz] = ctx.D.dockDir || [-H.face[0], -H.face[1]];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const edge = (x, z) => {
      const y = groundAt(ctx, x, z);
      if (y == null) return null;
      if (ctx.W.world.floorAt(x + dx * 25, z + dz * 25, 3, 0).solid) return null;
      if (ctx.W.world.floorAt(x + dx * 12, z + dz * 12, 3, 0).solid) return null;
      return y;
    };
    // March from the second stop (then the plaza) out toward the water, fanning a little.
    let best = null;
    for (const o of [near, alt]) {
      for (let k = 0; k < 24; k++) {
        const a = Math.atan2(dz, dx) + (k === 0 ? 0 : (Math.random() - 0.5) * 1.4);
        const ux = Math.cos(a), uz = Math.sin(a);
        for (let d = 0; d < 1600; d += 5) {
          const x = o.x + ux * d, z = o.z + uz * d;
          const y = edge(x, z);
          if (y == null) continue;
          // Step back a few metres so the stop isn't right on the lip.
          const bx = x - dx * 3, bz = z - dz * 3;
          const by = groundAt(ctx, bx, bz);
          const c = by != null ? { x: bx, y: by, z: bz } : { x, y, z };
          const dist = Math.hypot(c.x - near.x, c.z - near.z);
          if (dist > 60 && (!best || dist < best.d)) best = { ...c, d: dist };
          break;
        }
      }
      if (best) break;
    }
    if (!best && ctx.V && ctx.V.dock && ctx.V.dock.shore) {
      const s = ctx.V.dock.shore, y = groundAt(ctx, s.x, s.z);
      if (y != null) best = { x: s.x, y, z: s.z };
    }
    return best ? { x: best.x, y: best.y, z: best.z } : null;
  }

  constructor(ctx, stops, spots) {
    this.stops = stops;
    this.i = 0;
    this.talk = 0;
    this.happy = 1;
    this.t = 0;
    this.lostCool = 0;
    this.lostCount = 0;
    this.warn = '';
    this.paused = false;
    this.bag = new Bag(ctx);
    const kit = personKit(ctx, this.bag);
    this.tourists = spots.map((s, i) => {
      const m = kit({ shirt: TOURIST_SHIRTS[i % TOURIST_SHIRTS.length], skin: SKIN[(i * 3) % SKIN.length], pants: pick([0xd8c8a8, 0x2c3440, 0x6b8fb0]), hat: HATS[i % HATS.length], camera: i % 2 === 0 });
      m.position.set(s.x, s.y, s.z);
      this.bag.add(m);
      return { m, y: s.y, vx: 0, vz: 0, ox: ((i % 3) - 1) * 1.3, oz: 2.6 + Math.floor(i / 3) * 1.3 + Math.random() * 0.4, snap: 0 };
    });
    ctx.sound.pickup();
  }

  get stop() { return this.stops[Math.min(this.i, this.stops.length - 1)]; }
  get target() { const s = this.stop; return { x: s.x, y: s.y, z: s.z }; }
  get label() { return `Stop ${this.i + 1}/${this.stops.length} · Lead the group to ${this.stop.name}`; }
  get info() {
    const n = this.tourists.length;
    const base = `${n} tourist${n === 1 ? '' : 's'} · ${Math.round(this.happy * 100)}% happy`;
    if (this.warn) return `${this.warn} · ${base}`;
    if (this.talk > 0) return `Telling the ${this.stop.talk} ${'●'.repeat(Math.ceil(this.talk))}${'○'.repeat(Math.max(0, TALK_TIME - Math.ceil(this.talk)))} · ${base}`;
    return `${Math.round(this.dist || 0)} m · ${base}`;
  }

  centre() {
    let x = 0, z = 0;
    for (const t of this.tourists) { x += t.m.position.x; z += t.m.position.z; }
    const n = this.tourists.length || 1;
    return { x: x / n, z: z / n };
  }

  update(dt, ctx) {
    this.t += dt;
    this.warn = '';
    const p = ctx.player.pos;
    const st = this.stop;
    this.dist = Math.hypot(p.x - st.x, p.z - st.z);
    if (ctx.getDriving()) {
      // The group won't get in a car: everything waits until you're on foot again.
      this.warn = 'No driving on a walking tour. Get out and walk';
      this.paused = true;
      for (const t of this.tourists) animatePerson(t.m, 0, this.t);
      return null;
    }
    this.paused = false;

    this.moveGroup(dt, ctx, p);

    const c = this.centre();
    const lead = Math.hypot(p.x - c.x, p.z - c.z);
    if (lead > 18) {
      this.warn = 'Slow down, they’re falling behind';
      this.happy = Math.max(0.2, this.happy - dt * 0.03);
    }
    // Anyone left 45 m behind wanders off, one at a time.
    this.lostCool -= dt;
    if (this.lostCool <= 0) {
      let far = null, fd = 45;
      for (const t of this.tourists) { const d = Math.hypot(p.x - t.m.position.x, p.z - t.m.position.z); if (d > fd) { far = t; fd = d; } }
      if (far) {
        this.bag.drop(far.m);
        this.tourists.splice(this.tourists.indexOf(far), 1);
        this.lostCount++;
        this.happy = Math.max(0.2, this.happy - 0.08);
        this.lostCool = 3;
        ctx.sound.tone(392, 0.3, 'triangle', 0.08, 262);
        ctx.hud.toast(this.tourists.length ? `A tourist got lost. ${this.tourists.length} left` : 'You lost the whole group', 1600);
        if (!this.tourists.length) return { failed: true, note: 'Everyone got lost. Tour failed' };
      }
    }

    // At a stop: stay close with the group gathered for the talk.
    if (this.dist < 8 && Math.abs(p.y - st.y) < 4) {
      const gd = Math.hypot(c.x - st.x, c.z - st.z);
      if (gd > 14) { this.warn = this.warn || 'Wait for the group to gather'; }
      else {
        const before = Math.ceil(this.talk);
        this.talk += dt;
        this.happy = Math.min(1, this.happy + dt * 0.004);
        if (Math.ceil(this.talk) !== before && this.talk < TALK_TIME) ctx.sound.tone(660, 0.05, 'sine', 0.025);
        if (this.talk >= TALK_TIME) {
          ctx.sound.chime();
          this.i++;
          this.talk = 0;
          if (this.i >= this.stops.length) {
            const n = this.tourists.length;
            const pay = Math.round(90 * this.stops.length + 40 * n * this.happy);
            return { done: true, pay, note: `Tour done · ${n}/${GROUP} tourists · ${Math.round(this.happy * 100)}% happy` };
          }
          ctx.hud.toast(`Next: ${this.stop.name}`, 1400);
          if (ctx.particles) ctx.particles.confetti(p.x, p.y + 2, p.z);
        }
      }
    }
    return null;
  }

  // Follow the guide in a loose cluster behind them, at walking pace, keeping apart.
  moveGroup(dt, ctx, p) {
    const c = this.centre();
    let hx = p.x - c.x, hz = p.z - c.z;
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const atStop = this.dist < 8;
    const w = ctx.W.world;
    for (const t of this.tourists) {
      const m = t.m;
      // Slot behind the guide; at a stop, fan out in a half circle in front of them instead.
      let gx, gz;
      if (atStop) {
        const k = this.tourists.indexOf(t), a = (k / Math.max(1, this.tourists.length - 1) - 0.5) * 2.2;
        const fx = -hx, fz = -hz;
        gx = p.x + (fx * Math.cos(a) - fz * Math.sin(a)) * 3.2;
        gz = p.z + (fx * Math.sin(a) + fz * Math.cos(a)) * 3.2;
      } else {
        gx = p.x - hx * t.oz + -hz * t.ox;
        gz = p.z - hz * t.oz + hx * t.ox;
      }
      let dx = gx - m.position.x, dz = gz - m.position.z;
      const d = Math.hypot(dx, dz);
      const want = d < 0.4 ? 0 : Math.min(WALK_MAX, d * 0.9);
      let vx = d ? (dx / d) * want : 0, vz = d ? (dz / d) * want : 0;
      // Separation from the others and from the guide.
      for (const o of this.tourists) {
        if (o === t) continue;
        const sx = m.position.x - o.m.position.x, sz = m.position.z - o.m.position.z, sd = Math.hypot(sx, sz);
        if (sd < 1.1 && sd > 1e-3) { vx += (sx / sd) * (1.1 - sd) * 2.5; vz += (sz / sd) * (1.1 - sd) * 2.5; }
      }
      const px = m.position.x - p.x, pz = m.position.z - p.z, pd = Math.hypot(px, pz);
      if (pd < 1.2 && pd > 1e-3) { vx += (px / pd) * (1.2 - pd) * 3; vz += (pz / pd) * (1.2 - pd) * 3; }
      const sp = Math.hypot(vx, vz);
      if (sp > WALK_MAX) { vx *= WALK_MAX / sp; vz *= WALK_MAX / sp; }
      t.vx += (vx - t.vx) * Math.min(1, dt * 5);
      t.vz += (vz - t.vz) * Math.min(1, dt * 5);
      // Step, sliding around walls and refusing to walk into the water.
      const step = (ax, az) => {
        const nx = m.position.x + ax * dt, nz = m.position.z + az * dt;
        const fl = w.floorAt(nx, nz, t.y + 0.8, 0.15);
        if (!fl.solid || w.pointBlocked(nx, fl.y + 1, nz)) return false;
        m.position.x = nx; m.position.z = nz; t.y = fl.y;
        return true;
      };
      const v = Math.hypot(t.vx, t.vz);
      let moved = v < 0.05;
      if (!moved) {
        moved = step(t.vx, t.vz);
        for (const a of [0.7, -0.7, 1.5, -1.5]) {
          if (moved) break;
          const cs = Math.cos(a), sn = Math.sin(a);
          moved = step(t.vx * cs - t.vz * sn, t.vx * sn + t.vz * cs);
        }
        if (!moved) { t.vx *= 0.5; t.vz *= 0.5; }
      }
      animatePerson(m, moved ? v : 0, this.t);
      m.position.y = t.y + (m.userData.bob || 0);
      if (v > 0.2) faceTo(m, Math.atan2(t.vx, t.vz), dt);
      else faceTo(m, Math.atan2(p.x - m.position.x, p.z - m.position.z), dt);
    }
  }

  dispose(ctx) {
    this.tourists = [];
    this.bag.dispose();
  }
}
