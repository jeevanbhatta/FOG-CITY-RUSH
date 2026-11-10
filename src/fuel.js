// Fuel: cars and the seaplane burn it, gas stations and a fuel dock sell it.
// Written to the module contract in docs/module-contract.md (City Life free roam only).
//
// Each vehicle object gets a `fuel` field (0..1). Driving burns fuel with throttle and speed; an
// empty car crawls (we bleed its speed), an empty seaplane loses its engine and glides down.
// Stations are placed beside long named streets; the fuel dock is by the seaplane dock.
// Captain Mei's perk (ctx.perks().planeDiscount) makes seaplane fuel free.

const PRICE_CAR = 60;   // full tank
const PRICE_PLANE = 140;

export class Fuel {
  constructor(ctx) {
    const { THREE, W, scene, V } = ctx;
    this.stations = [];
    this.saved = ctx.store.get('fuel') || {};
    const roads = W.map.roads.filter((r) => r.n && ['primary', 'secondary', 'tertiary', 'trunk'].includes(r.k));
    const mat = {
      canopy: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 }),
      edge: new THREE.MeshStandardMaterial({ color: 0xd1495b, emissive: 0xd1495b, emissiveIntensity: 0.4 }),
      pump: new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.5 }),
      post: new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.5 }),
      glow: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c4, emissiveIntensity: 1 }),
    };
    // Up to four stations, spread out, on the pavement side of a long straight segment.
    for (const r of roads) {
      if (this.stations.length >= 4) break;
      for (let i = 1; i < r.p.length && this.stations.length < 4; i++) {
        const a = r.p[i - 1], b = r.p[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 40) continue;
        const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
        const off = r.w / 2 + 6;
        const x = (a[0] + b[0]) / 2 - dz * off, z = (a[1] + b[1]) / 2 + dx * off;
        if (this.stations.some((s) => Math.hypot(s.x - x, s.z - z) < 450)) continue;
        let ok = true;
        for (const [ox, oz] of [[0, 0], [dx * 6, dz * 6], [-dx * 6, -dz * 6], [-dz * 3, dx * 3]]) {
          const fl = W.world.floorAt(x + ox, z + oz, 2, 0);
          if (!fl.solid || fl.y > 0.6 || W.world.pointBlocked(x + ox, 1, z + oz)) ok = false;
        }
        if (!ok) continue;
        const g = new THREE.Group();
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 12), mat.canopy);
        canopy.position.y = 4.6;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(7.1, 0.25, 12.1), mat.edge);
        edge.position.y = 4.3;
        const light = new THREE.Mesh(new THREE.PlaneGeometry(6, 11), mat.glow);
        light.rotation.x = Math.PI / 2; light.position.y = 4.33;
        g.add(canopy, edge, light);
        for (const [px, pz] of [[-3, -5.5], [3, -5.5], [-3, 5.5], [3, 5.5]]) {
          const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 0.3), mat.post);
          p.position.set(px, 2.2, pz); g.add(p);
        }
        for (const pz of [-2.5, 2.5]) {
          const pump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.6), mat.pump);
          pump.position.set(0, 0.8, pz); g.add(pump);
        }
        g.position.set(x, 0, z);
        g.rotation.y = Math.atan2(dx, dz);
        scene.add(g);
        this.stations.push({ x, z, name: `${r.n} Gas`, plane: false });
      }
    }
    // Seaplane fuel dock: a small float with a pump right by the dock.
    if (V.dock) {
      const d = V.dock;
      const sx = Math.cos(d.heading), sz = -Math.sin(d.heading);
      const x = d.pos.x + sx * 14, z = d.pos.z + sz * 14;
      const g = new THREE.Group();
      const float = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 6), mat.post);
      float.position.y = -1.4;
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.6), mat.edge);
      pump.position.set(0, -0.4, 0);
      g.add(float, pump);
      g.position.set(x, 0, z);
      scene.add(g);
      this.stations.push({ x, z, name: 'Fuel dock', plane: true });
    }
    this.hudEl = null;
    this.warned = 0;
  }

  vehicleFuel(v) {
    if (v.fuel == null) v.fuel = this.saved[v.kind === 'plane' ? 'plane' : 'car'] ?? 1;
    return v.fuel;
  }

  update(dt, ctx) {
    const v = ctx.getDriving();
    this.near = null;
    if (v) {
      const f = this.vehicleFuel(v);
      // Burn: a full car tank lasts roughly 12 km of hard driving, the seaplane about 8 minutes of flying.
      if (v.kind === 'car') {
        v.fuel = Math.max(0, f - dt * (0.00012 * Math.abs(v.speed) + (v.boosting ? 0.004 : 0)));
        if (v.fuel <= 0) { v.vel.x *= Math.exp(-dt * 1.5); v.vel.z *= Math.exp(-dt * 1.5); }
      } else if (v.state === 'air') {
        v.fuel = Math.max(0, f - dt * (0.0008 + 0.0014 * (v.throttle || 0)));
        if (v.fuel <= 0) v.throttle = 0;
      }
      if (v.fuel < 0.15 && performance.now() - this.warned > 20000) {
        this.warned = performance.now();
        ctx.hud.toast(v.fuel <= 0 ? 'Out of fuel' : 'Fuel low: find a gas station (on the map)', 1800);
      }
      this.saved[v.kind === 'plane' ? 'plane' : 'car'] = v.fuel;
      // Refuel at a station of the right kind.
      for (const s of this.stations) {
        if (s.plane !== (v.kind === 'plane')) continue;
        if (Math.hypot(v.pos.x - s.x, v.pos.z - s.z) > (s.plane ? 18 : 9)) continue;
        if (v.fuel > 0.97) break;
        this.near = s;
        const free = s.plane && ctx.perks && ctx.perks().planeDiscount;
        const cost = free ? 0 : Math.ceil((1 - v.fuel) * (s.plane ? PRICE_PLANE : PRICE_CAR));
        ctx.setPrompt(`Press E to fill up at ${s.name} (${cost ? '$' + cost : 'free: Mei’s account'})`);
        if (ctx.pressedE()) {
          if (cost) ctx.addCash(-cost);
          v.fuel = 1;
          ctx.sound.tone(660, 0.12, 'triangle', 0.08);
          ctx.sound.tone(990, 0.2, 'triangle', 0.08, null, 0.1);
          ctx.hud.toast(`Tank full${cost ? `  −$${cost}` : ''}`, 1200);
        }
      }
    }
    this.renderGauge(v);
    this.saveT = (this.saveT || 0) - dt;
    if (this.saveT <= 0) { this.saveT = 5; ctx.store.set('fuel', this.saved); }
  }

  // A small fuel gauge pinned under the speed readout while you drive.
  renderGauge(v) {
    if (!this.hudEl) {
      this.hudEl = document.createElement('div');
      this.hudEl.id = 'fuel-gauge';
      this.hudEl.style.cssText = 'position:absolute;left:max(16px,env(safe-area-inset-left,0px));bottom:calc(84px + env(safe-area-inset-bottom,0px));'
        + 'background:rgba(236,241,242,0.78);border-radius:4px;padding:5px 9px;font:600 0.72rem/1 "Barlow Semi Condensed",sans-serif;'
        + 'letter-spacing:0.1em;text-transform:uppercase;color:#6f8591;display:flex;align-items:center;gap:8px;pointer-events:none;';
      this.hudEl.innerHTML = 'Fuel <i style="display:block;width:90px;height:6px;border-radius:3px;background:rgba(31,52,64,0.18);overflow:hidden"><i id="fuel-bar" style="display:block;height:100%;background:#4f9a6a"></i></i>';
      (document.getElementById('hud') || document.body).appendChild(this.hudEl);
    }
    this.hudEl.hidden = !v;
    if (!v) return;
    const bar = this.hudEl.querySelector('#fuel-bar');
    bar.style.width = `${Math.round(v.fuel * 100)}%`;
    bar.style.background = v.fuel < 0.15 ? '#d1495b' : v.fuel < 0.35 ? '#e0a030' : '#4f9a6a';
  }

  mapMarks() {
    return this.stations.map((s) => ({ x: s.x, z: s.z, color: '#d1495b', r: 4, label: s.plane ? 'Fuel dock' : 'Gas' }));
  }

  hints() {
    return this.near ? [['E', 'Fill up']] : [];
  }

  onEvent(name) {
    if (name === 'sleep') this.hudEl && (this.hudEl.hidden = true);
  }
}
