// Friends: the three story contacts as people you can spend time with.
//
// Affinity (0..100) grows when you finish a contact's story chapters and when you hang out.
// A hangout is started from the phone (10:00 to 23:00, once a day per friend): the friend
// appears beside you as a full avatar and walks or runs with you to an activity:
//   Theo  races you to a street 250-400 m away (he runs a straight line at 10 m/s)
//   Rosa  takes you to dinner at the nearest food truck (E to eat together)
//   Mei   watches the sunset with you at the plaza (20 game minutes, 17:00 to 20:00)
// Affinity 50 and 100 unlock perks that main.js reads from `friends.perks`.
// Friends also text now and then, at most once a game day, in the morning.

const FRIENDS = [
  {
    id: 'theo', name: 'Theo', color: '#2aa198', skin: 3, kind: 'race', run: 11, label: 'Race me',
    look: { label: 'Theo', top: 0x2aa198, pants: 0x23272b, bareArms: true, hat: 'headband', hatColor: 0xffd34d, pack: 'none', shoe: 0xffd34d, sole: 0x1b1f24, hair: 0x1d1612 },
    hello: "Theo: Let's go. Race you to %s, loser buys the burritos.",
    perk50: 'Theo taught you his sprint lines: +5% top sprint',
    perk100: 'Theo calls you crew now: +10% top sprint',
  },
  {
    id: 'rosa', name: 'Rosa', color: '#ff6a2b', skin: 1, kind: 'dinner', run: 9, label: 'Dinner',
    look: { label: 'Rosa', top: 0xffb000, trim: 'reflect', pants: 0x3a2f4a, hat: 'cap', hatColor: 0xd1495b, pack: 'courier', shoe: 0x1b1f24, sole: 0xffb000, hair: 0x3b2314 },
    hello: "Rosa: Dinner's on us both. %s, my favourite. Walk with me?",
    perk50: 'Rosa sends the good jobs your way: courier pay +10%',
    perk100: 'Rosa trusts you with the VIP clients: courier pay +20%',
  },
  {
    id: 'mei', name: 'Captain Mei', short: 'Mei', color: '#2f6f8f', skin: 0, kind: 'sunset', run: 9, label: 'Sunset walk',
    look: { label: 'Mei', top: 0xf2efe6, pants: 0x2f6f8f, shorts: true, hat: 'sunhat', hatColor: 0xd9c08a, pack: 'none', camera: true, glasses: true, shoe: 0xf4f4f0, sole: 0x2f6f8f, hair: 0x14100d },
    hello: "Mei: Walk me down to %s? The sun goes down over the water between five and eight.",
    perk50: 'Mei will top up the seaplane for free from now on',
    perk100: 'Mei vouches for you at the harbour: double pay on tour pilot and patrol gigs',
  },
];

// Morning texts. Warm, specific, no emoji.
const LINES = {
  rosa: [
    "Fog's thick on the Embarcadero this morning. Ride safe, and text me once you've had coffee.",
    'A client on Russian Hill tipped in sourdough. I saved you the heel, it is the best part.',
    "Reminder: the hills don't care how late you are. Pace yourself on the climbs.",
    'Dispatch radio is quiet. Too quiet. Enjoy it while it lasts.',
    'Saw a sea lion on Pier 39 that looked exactly like my old boss. Made my whole morning.',
    "If you're near the Ferry Building, the oyster guy owes me a favour. Say my name.",
    'Proud of you, you know. Most rookies quit after their first week of stairs.',
    'Rain later, they say. Keep the parcels dry and yourself drier.',
  ],
  theo: [
    "Found a rail by the Ferry Building that's begging to be run. You in later?",
    'Morning. Stretch your calves. Then stretch them again. Trust me.',
    'Crew is arguing about the cleanest line down Lombard. I said you would settle it.',
    'Fell off a planter yesterday in front of a tour bus. They clapped anyway.',
    'Fog is low today. Rooftops feel like running on clouds. Come see.',
    'New shoes. Grip is unreal. Already scuffed them on the Filbert Steps.',
    "Real talk: you've got good flow. Don't let anyone tell you otherwise.",
    "Burrito on 24th after training? Mission style, obviously, I'm not a monster.",
  ],
  mei: [
    'Clear skies over the Golden Gate this morning. Perfect flying weather, if you are free.',
    'Spotted a pod of porpoises off Alcatraz on my first run. Good omen.',
    "Checked the floats on the seaplane today. She's purring. You should take her up.",
    "Fog rolls in at four like clockwork. Land before then and you'll see the city glow.",
    "Old pilot's rule: always know where the water is. Luckily, here it is everywhere.",
    'Someone left a thermos of coffee on the dock with your name on it. Was not me. Probably.',
    'Saw your landing yesterday. Smoother than mine in my first year. Do not tell anyone.',
    'Sunset over the bay should be a good one tonight. Bring a jacket, it is still San Francisco.',
  ],
};

const OPEN_FROM = 10, OPEN_TO = 23; // hangout hours
const FOLLOW_SIDE = 2.0, FOLLOW_BACK = 1.0; // ~2.2 m from the player
const LEASH = 40, LEASH_UP = 6; // beyond this the friend waits
const RACE_SPEED = 10;
const SUNSET_MIN = 20;

const hourOf = (life) => (life.s.minute % 1440) / 60;

export class Friends {
  constructor(ctx) {
    this.ctx = ctx;
    const saved = ctx.store.get('friends') || {};
    this.s = Object.assign({ aff: {}, last: {}, unlocked: {}, line: {}, textDay: 0 }, saved);
    for (const f of FRIENDS) if (typeof this.s.aff[f.id] !== 'number') this.s.aff[f.id] = 0;
    this.h = null; // the active hangout
    this.ateNow = false;
    const T = ctx.THREE;
    this.fake = {
      pos: new T.Vector3(), vel: new T.Vector3(), facing: 0, mode: 'normal', onGround: true,
      slideTime: 0, rollTime: 0, wallRunning: false, wall: null, climbDir: 1, chute: { open: 1, bank: 0 },
      get speed() { return Math.hypot(this.vel.x, this.vel.z); },
    };
    // A soft beam over the hangout destination, like the job beacon.
    this.beacon = new T.Mesh(new T.CylinderGeometry(1.8, 1.8, 200, 20, 1, true).translate(0, 100, 0),
      new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false, fog: false, side: T.DoubleSide }));
    this.beacon.visible = false;
    ctx.scene.add(this.beacon);
    ctx.life.on((type, data) => {
      if (type === 'chapter' && data && data.contact) this.gain(data.contact.id, 10);
    });
  }

  save() { this.ctx.store.set('friends', this.s); }

  // Perks for main.js to apply (see docs/integration-friends.md).
  get perks() {
    const a = this.s.aff;
    return {
      sprintBonus: a.theo >= 100 ? 0.1 : a.theo >= 50 ? 0.05 : 0,
      payBonus: a.rosa >= 100 ? 0.2 : a.rosa >= 50 ? 0.1 : 0,
      planeDiscount: a.mei >= 50, // free seaplane refuel
      flightBonus: a.mei >= 100, // double pay on pilot and patrol gigs
    };
  }

  // Combined pay multiplier for a finished gig of the given career.
  payMul(career) {
    const p = this.perks;
    return (career === 'courier' ? 1 + p.payBonus : 1) * (p.flightBonus && (career === 'pilot' || career === 'patrol') ? 2 : 1);
  }

  gain(id, n) {
    const f = FRIENDS.find((k) => k.id === id);
    if (!f) return;
    const a = this.s.aff;
    a[id] = Math.max(0, Math.min(100, (a[id] || 0) + n));
    for (const t of [50, 100]) {
      const key = id + t;
      if (a[id] >= t && !this.s.unlocked[key]) {
        this.s.unlocked[key] = true;
        this.ctx.hud.toast(`Perk unlocked: ${t === 50 ? f.perk50 : f.perk100}`, 3200);
        this.ctx.sound.chime();
      }
    }
    this.save();
  }

  name(f) { return f.short || f.name; }

  // ---------- starting and ending a hangout ----------
  canHang(f) {
    const { life } = this.ctx;
    const h = hourOf(life);
    if (this.h) return 'You are already out with someone';
    if (this.s.last[f.id] === life.s.day) return 'Already saw them today';
    if (h < OPEN_FROM || h >= OPEN_TO) return 'Free 10:00 to 23:00';
    if (f.kind === 'sunset' && h >= 19.6) return 'Too late for the sunset today';
    if (f.kind === 'dinner' && !(this.ctx.foodSpots || []).length) return 'No food trucks around';
    return '';
  }

  start(id) {
    const ctx = this.ctx, f = FRIENDS.find((k) => k.id === id);
    if (!f || this.canHang(f) || ctx.getDriving()) {
      if (f && ctx.getDriving()) ctx.hud.toast(`${this.name(f)}: Park up first, I'm on foot.`, 1800);
      return;
    }
    const P = ctx.player.pos;
    const dest = this.pickDest(f);
    if (!dest) { ctx.hud.toast(`${this.name(f)}: Not today, sorry. Rain check?`, 1800); return; }
    this.s.last[f.id] = ctx.life.s.day;
    this.save();
    // Build the avatar from the friend's own look without adding it to the shared LOOKS table
    // (main.js lists LOOKS in the character picker).
    const key = '_friend_' + f.id;
    ctx.LOOKS[key] = f.look;
    const avatar = new ctx.Avatar(key, f.skin);
    delete ctx.LOOKS[key];
    avatar.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const tag = this.nameTag(f);
    if (tag) avatar.root.add(tag);
    ctx.scene.add(avatar.root);
    this.h = {
      f, avatar, dest, kind: f.kind, phase: f.kind === 'race' ? 'count' : 'walk', t: 0, count: 3,
      waiting: false, waitY: 0, stuck: 0, side: 1, heading: ctx.player.facing, minute: ctx.life.s.minute,
      watched: 0, winner: null, usedCar: false, endT: 0, toldEarly: false,
    };
    this.placeBeside(P);
    ctx.particles.dust(this.fake.pos.x, this.fake.pos.y + 0.2, this.fake.pos.z, 1);
    this.beacon.material.color.set(f.color);
    this.beacon.position.set(dest.x, dest.y, dest.z);
    this.beacon.visible = true;
    ctx.setTarget(dest);
    ctx.hud.toast(f.hello.replace('%s', dest.name), 3000);
    ctx.sound.tone(660, 0.12, 'sine', 0.08);
    ctx.sound.tone(990, 0.14, 'sine', 0.08, null, 0.12);
  }

  pickDest(f) {
    const ctx = this.ctx, P = ctx.player.pos, Wd = ctx.W.world;
    const floor = (x, z) => { const fl = Wd.floorAt(x, z, 3, 0); return fl.solid ? fl.y : 0; };
    if (f.kind === 'dinner') {
      let best = null, bd = Infinity;
      for (const s of ctx.foodSpots || []) {
        const d = Math.hypot(s.x - P.x, s.z - P.z);
        if (d < bd) { bd = d; best = s; }
      }
      return best && { x: best.x, y: floor(best.x, best.z), z: best.z, name: best.name, price: best.price || 10 };
    }
    if (f.kind === 'sunset') {
      const p = ctx.W.landmarks.hub.plaza;
      return { x: p[0], y: floor(p[0], p[1]), z: p[1], name: `the plaza at ${ctx.D.hubName}` };
    }
    // Race: a named street point 250-400 m away on open ground.
    const roads = (ctx.W.map.roads || []).filter((r) => r.n && r.k !== 'footway' && r.k !== 'service');
    for (let i = 0; i < 400 && roads.length; i++) {
      const r = roads[Math.floor(Math.random() * roads.length)];
      const q = r.p[Math.floor(Math.random() * r.p.length)];
      const d = Math.hypot(q[0] - P.x, q[1] - P.z);
      if (d < 250 || d > 400) continue;
      const fl = Wd.floorAt(q[0], q[1], 3, 0);
      if (!fl.solid || Wd.pointBlocked(q[0], fl.y + 1, q[1])) continue;
      return { x: q[0], y: fl.y, z: q[1], name: r.n };
    }
    return null;
  }

  // A small floating name label so you can spot your friend in a crowd.
  nameTag(f) {
    if (typeof document === 'undefined') return null;
    const T = this.ctx.THREE;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    if (g.roundRect) g.roundRect(8, 8, 240, 48, 24); else g.rect(8, 8, 240, 48);
    g.fill();
    g.fillStyle = f.color;
    g.font = '800 30px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.name(f).toUpperCase(), 128, 33);
    const tex = new T.CanvasTexture(c);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    sp.scale.set(1.2, 0.3, 1);
    sp.position.y = 2.25;
    return sp;
  }

  // Put the friend on solid ground next to (or behind) a point.
  placeBeside(P, behind = false) {
    const ctx = this.ctx, Wd = ctx.W.world, fk = this.fake;
    const fx = Math.sin(ctx.player.facing), fz = Math.cos(ctx.player.facing);
    const tries = behind ? [[0, -3], [1.5, -2.5], [-1.5, -2.5], [2, 0], [-2, 0]] : [[FOLLOW_SIDE, -FOLLOW_BACK], [-FOLLOW_SIDE, -FOLLOW_BACK], [0, -2.5], [0, 2]];
    for (const [sx, bz] of tries) {
      const x = P.x + fz * sx + fx * bz, z = P.z - fx * sx + fz * bz;
      const fl = Wd.floorAt(x, z, P.y + 1.2, 0.25);
      const y = fl.solid ? fl.y : P.y;
      if (Math.abs(y - P.y) > 1.5 || Wd.pointBlocked(x, y + 1, z)) continue;
      fk.pos.set(x, y, z);
      if (this.h) this.h.side = sx >= 0 ? 1 : -1;
      fk.vel.set(0, 0, 0);
      fk.facing = ctx.player.facing;
      return;
    }
    fk.pos.copy(P);
    fk.vel.set(0, 0, 0);
  }

  end(line, reward) {
    const ctx = this.ctx, h = this.h;
    if (!h) return;
    if (line) ctx.hud.toast(line, 3000);
    if (reward) {
      this.gain(h.f.id, 15);
      ctx.life.mood(15);
      ctx.life.event('hangout');
      ctx.particles.confetti(this.fake.pos.x, this.fake.pos.y + 1.6, this.fake.pos.z);
      ctx.sound.finish();
    }
    this.beacon.visible = false;
    ctx.setTarget(null);
    // Linger a moment so the goodbye reads, then leave.
    h.phase = 'bye';
    h.endT = 4;
  }

  removeAvatar() {
    const h = this.h;
    if (!h) return;
    this.ctx.particles.dust(this.fake.pos.x, this.fake.pos.y + 0.2, this.fake.pos.z, 1);
    this.ctx.scene.remove(h.avatar.root);
    h.avatar.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    this.h = null;
  }

  // ---------- per frame ----------
  update(dt, ctx) {
    this.ctx = ctx || this.ctx;
    this.texts();
    const h = this.h;
    if (h) this.hangout(dt);
    this.ateNow = false;
  }

  hangout(dt) {
    const ctx = this.ctx, h = this.h, f = h.f, life = ctx.life, P = ctx.player.pos;
    const driving = ctx.getDriving();
    const focus = driving ? driving.pos : P;
    const hour = hourOf(life);
    const dMin = Math.max(0, Math.min(5, life.s.minute - h.minute)); // game minutes this frame (naps don't count)
    h.minute = life.s.minute;
    h.t += dt;
    if (h.phase === 'bye') {
      h.endT -= dt;
      this.idle(dt);
      if (h.endT <= 0) this.removeAvatar();
      return;
    }
    if (hour >= 23.5 || hour < 5) { this.end(`${this.name(f)}: It's getting late. Rain check, okay?`, false); return; }

    if (h.kind === 'race') { this.race(dt, focus, driving); return; }

    // Walking together: follow, wait when left behind, catch up when you come back down.
    const dist = Math.hypot(focus.x - this.fake.pos.x, focus.z - this.fake.pos.z);
    const up = focus.y - this.fake.pos.y;
    if (!h.waiting && (driving || dist > LEASH || up > LEASH_UP)) {
      h.waiting = true;
      h.waitY = this.fake.pos.y;
      const why = driving ? "I'll walk. Meet you there, or come back for me." : up > LEASH_UP ? "I'm not climbing that. I'll wait down here." : "Hey, slow down! I'll wait here.";
      ctx.hud.toast(`${this.name(f)}: ${why}`, 2200);
    }
    if (h.waiting) {
      const back = !driving && ctx.player.onGround && ctx.player.mode === 'normal' && P.y - h.waitY < LEASH_UP;
      if (back) {
        h.waiting = false;
        if (dist > LEASH || Math.abs(P.y - this.fake.pos.y) > 1.5) {
          this.placeBeside(P, true);
          ctx.particles.dust(this.fake.pos.x, this.fake.pos.y + 0.2, this.fake.pos.z, 1);
          ctx.hud.toast(`${this.name(f)}: There you are. Caught up.`, 1600);
        }
      } else this.idle(dt);
    }
    if (!h.waiting) this.follow(dt);
    const together = !h.waiting && Math.hypot(P.x - this.fake.pos.x, P.z - this.fake.pos.z) < 10;

    if (h.kind === 'dinner') {
      // The E press itself is main.js's food-truck handler (it charges your share and feeds you,
      // then sends 'eat'); Rosa pays her own. That way there's one payment and one cash check.
      const d = Math.hypot(P.x - h.dest.x, P.z - h.dest.z);
      if (!driving && d < 6 && this.ateNow) {
        if (together) {
          this.end(`Rosa: ${this.pick(['Best noodles in the city, and I have tried them all.', 'You eat like a courier. That is a compliment.', 'Same time next week? My treat, kind of.'])}`, true);
          return;
        }
        ctx.hud.toast("Rosa: You started without me? Wait up, I'm still hungry!", 2000);
      } else if (!driving && together && d < 6) {
        ctx.setPrompt(`Press E at the counter to eat with Rosa ($${h.dest.price} each)`);
      } else if (!driving && together && d < 12) {
        ctx.setPrompt('Rosa: Step up to the counter, I am starving.');
      }
      if (h.t > 240 && h.phase !== 'bye') this.end("Rosa: Dispatch is calling. Raincheck on dinner.", false);
      return;
    }

    // Sunset with Mei.
    const there = !driving && Math.hypot(P.x - h.dest.x, P.z - h.dest.z) < 18 && together;
    if (there) {
      if (hour < 17) {
        ctx.setPrompt('Mei: The light gets good at five. Let us wait here.');
      } else if (hour < 20) {
        h.watched += dMin;
        ctx.setPrompt(`Watching the sunset with Mei  ${Math.floor(h.watched)} / ${SUNSET_MIN} min`);
        if (h.watched >= SUNSET_MIN) {
          this.end(`Mei: ${this.pick(['That orange over the bridge never gets old. Thank you for this.', 'From up there I see this every day. Down here, with a friend, it is better.', 'Next time, we watch it from the cockpit.'])}`, true);
          return;
        }
      }
    }
    if (hour >= 20) this.end("Mei: We missed it. The fog won tonight. Another day.", false);
  }

  // Theo's race: a countdown, then he runs a straight line at RACE_SPEED. First there wins.
  race(dt, focus, driving) {
    const ctx = this.ctx, h = this.h, fk = this.fake, d = h.dest;
    if (driving) h.usedCar = true;
    if (h.phase === 'count') {
      this.idle(dt);
      const before = Math.ceil(h.count);
      h.count -= dt;
      const now = Math.ceil(h.count);
      if (now !== before || h.t === dt) {
        if (h.count > 0) { ctx.hud.toast(`${Math.max(1, now)}...`, 700); ctx.sound.tone(520, 0.12, 'square', 0.06); }
      }
      if (h.count <= 0) { h.phase = 'run'; ctx.hud.toast('Theo: Go!', 900); ctx.sound.tone(880, 0.25, 'square', 0.08); }
      return;
    }
    if (h.phase === 'run') {
      const dx = d.x - fk.pos.x, dz = d.z - fk.pos.z, dist = Math.hypot(dx, dz);
      const step = Math.min(dist, RACE_SPEED * dt);
      if (dist > 0.01) {
        fk.vel.set((dx / dist) * RACE_SPEED, 0, (dz / dist) * RACE_SPEED);
        fk.pos.x += (dx / dist) * step;
        fk.pos.z += (dz / dist) * step;
        this.settle(dt);
      }
      fk.mode = 'normal';
      h.avatar.update(dt, fk);
      const youThere = Math.hypot(focus.x - d.x, focus.z - d.z) < 10;
      if (youThere) h.winner = 'you';
      else if (dist < 1) h.winner = 'theo';
      if (!h.winner) {
        if (h.t > 150) this.end("Theo: Did you get lost? I've been here ages. Next time.", false);
        return;
      }
      fk.vel.set(0, 0, 0);
      let line;
      if (h.winner === 'you' && h.usedCar) line = 'Theo: A car? Really? Fine, you win, but the crew is hearing about this.';
      else if (h.winner === 'you') line = `Theo: ${this.pick(['No way. NO way. Rematch tomorrow.', 'Okay, okay, you are fast. Burritos on me.', 'You took the hill line? Respect.'])}`;
      else line = `Theo: ${this.pick(['Too slow! Straight lines, my friend. Straight lines.', 'Ha! Buy me a burrito and we never speak of this.', 'Close one. Well, not that close.'])}`;
      this.end(line, true);
    }
  }

  // Smooth follow: aim for a slot to the side and slightly behind, match the player's pace.
  follow(dt) {
    const ctx = this.ctx, h = this.h, fk = this.fake, p = ctx.player, Wd = ctx.W.world;
    const pv = p.vel, ps = Math.hypot(pv.x, pv.z);
    // Heading from movement so the slot doesn't swing while the camera turns on the spot.
    if (ps > 0.8) {
      const want = Math.atan2(pv.x, pv.z);
      let dh = want - h.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      h.heading += dh * Math.min(1, dt * 4);
    }
    const fx = Math.sin(h.heading), fz = Math.cos(h.heading);
    const sx = FOLLOW_SIDE * h.side;
    const tx = p.pos.x + fz * sx - fx * FOLLOW_BACK, tz = p.pos.z - fx * sx - fz * FOLLOW_BACK;
    const ox = tx - fk.pos.x, oz = tz - fk.pos.z, od = Math.hypot(ox, oz);
    let wx = 0, wz = 0;
    if (od > 0.35) {
      const sp = Math.min(h.f.run, ps + (od - 0.35) * 1.6);
      wx = (ox / od) * sp; wz = (oz / od) * sp;
    } else { wx = pv.x; wz = pv.z; }
    // Don't crowd the player.
    const ax = fk.pos.x - p.pos.x, az = fk.pos.z - p.pos.z, ad = Math.hypot(ax, az);
    if (ad < 1.3 && ad > 0.01) { wx += (ax / ad) * 2.5; wz += (az / ad) * 2.5; }
    const k = Math.min(1, dt * 6);
    fk.vel.x += (wx - fk.vel.x) * k;
    fk.vel.z += (wz - fk.vel.z) * k;
    // Move with simple wall sliding; if boxed in for a while, hop back beside the player.
    const nx = fk.pos.x + fk.vel.x * dt, nz = fk.pos.z + fk.vel.z * dt, y = fk.pos.y + 1;
    if (!Wd.pointBlocked(nx, y, nz)) { fk.pos.x = nx; fk.pos.z = nz; h.stuck = 0; }
    else if (!Wd.pointBlocked(nx, y, fk.pos.z)) { fk.pos.x = nx; fk.vel.z *= 0.5; }
    else if (!Wd.pointBlocked(fk.pos.x, y, nz)) { fk.pos.z = nz; fk.vel.x *= 0.5; }
    else { fk.vel.x *= 0.3; fk.vel.z *= 0.3; h.stuck += dt; }
    if (h.stuck > 2.5 && od > 5 && p.onGround) { h.stuck = 0; this.placeBeside(p.pos, true); }
    this.settle(dt);
    fk.mode = 'normal';
    if (Math.hypot(fk.vel.x, fk.vel.z) < 0.5) fk.facing = p.facing; // face the same way when standing
    h.avatar.update(dt, fk);
  }

  // Keep feet on the floor: step up small ledges, drop down gently.
  settle(dt) {
    const fk = this.fake;
    const fl = this.ctx.W.world.floorAt(fk.pos.x, fk.pos.z, fk.pos.y + 1.0, 0.25);
    const gy = fl.solid ? fl.y : fk.pos.y;
    if (gy >= fk.pos.y) { fk.pos.y = gy; fk.onGround = true; fk.vel.y = 0; }
    else {
      fk.vel.y -= 25 * dt;
      fk.pos.y = Math.max(gy, fk.pos.y + fk.vel.y * dt);
      fk.onGround = fk.pos.y <= gy + 0.05;
      if (fk.onGround) fk.vel.y = 0;
    }
  }

  idle(dt) {
    const fk = this.fake;
    fk.vel.x *= Math.max(0, 1 - dt * 8);
    fk.vel.z *= Math.max(0, 1 - dt * 8);
    if (fk.speed < 0.3) fk.vel.set(0, 0, 0);
    this.settle(dt);
    // Look toward the player while waiting.
    const p = this.ctx.player.pos;
    fk.facing = Math.atan2(p.x - fk.pos.x, p.z - fk.pos.z);
    this.h.avatar.update(dt, fk);
  }

  pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  // ---------- morning texts ----------
  texts() {
    const life = this.ctx.life, s = life.s;
    if (this.s.textDay === s.day) return;
    const m = s.minute % 1440;
    // Seeded per day: a send time between 08:10 and 10:30, and three days in four.
    let seed = s.day * 2654435761 >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const at = 8 * 60 + 10 + Math.floor(rnd() * 140);
    if (m >= 12 * 60) { this.s.textDay = s.day; return; } // loaded after the morning: skip today
    if (m < at) return;
    this.s.textDay = s.day;
    if (rnd() > 0.75) { this.save(); return; }
    const f = FRIENDS[Math.floor(rnd() * FRIENDS.length)];
    const list = LINES[f.id];
    const i = (this.s.line[f.id] || 0) % list.length;
    this.s.line[f.id] = i + 1;
    s.inbox.unshift({ from: f.id, title: 'Text', text: list[i], day: s.day, clock: life.clock, unread: true });
    s.inbox = s.inbox.slice(0, 30);
    this.save();
    // Reuse the story-message path in main.js: toast, phone badge, ping, save.
    life.emit('message', { contact: { id: f.id, name: f.name, color: f.color }, chapter: { title: 'New text' } });
  }

  // ---------- game events ----------
  onEvent(name) {
    if (name === 'eat') this.ateNow = true;
    if (name === 'sleep' && this.h) { this.beacon.visible = false; this.ctx.setTarget(null); this.removeAvatar(); }
  }

  // ---------- phone ----------
  phoneHtml() {
    const life = this.ctx.life;
    const items = FRIENDS.map((f) => {
      const a = Math.round(this.s.aff[f.id] || 0);
      const perks = [a >= 50 ? f.perk50 : '', a >= 100 ? f.perk100 : ''].filter(Boolean);
      const active = this.h && this.h.f.id === f.id && this.h.phase !== 'bye';
      const why = this.canHang(f);
      const btn = active
        ? '<button class="btn ghost" data-friend-end="1">End hangout</button>'
        : why ? `<span class="meta">${why}</span>` : `<button class="btn" data-hangout="${f.id}">Hang out: ${f.label}</button>`;
      return `<li><span class="who" style="color:${f.color}">${f.name}</span>
        <span class="meta">Affinity ${a} / 100${a < 50 ? ' · perk at 50' : a < 100 ? ' · next perk at 100' : ''}</span>
        <i class="bar"><i style="width:${a}%;background:${f.color}"></i></i>
        ${perks.map((p) => `<span class="meta">${p}</span>`).join('')}
        ${active ? `<span class="meta">Out with ${this.name(f)} · ${this.h.dest.name}</span>` : ''}
        ${btn}</li>`;
    }).join('');
    return `<span class="label">Friends · ${life.clock}</span><ul class="ph-list">${items}</ul>`;
  }

  onPhoneClick(t) {
    if (!t || !t.dataset) return;
    if (t.dataset.hangout) { this.start(t.dataset.hangout); return this.h ? 'close' : undefined; }
    if (t.dataset.friendEnd && this.h) {
      this.end(`${this.name(this.h.f)}: All good, see you around.`, false);
      return 'close';
    }
  }

  // ---------- map ----------
  mapMarks() {
    const h = this.h;
    if (!h || h.phase === 'bye') return [];
    const out = [{ x: h.dest.x, z: h.dest.z, color: h.f.color, r: 6, ring: true, label: `${this.name(h.f)}: ${h.dest.name}` }];
    out.push({ x: this.fake.pos.x, z: this.fake.pos.z, color: h.f.color, r: 3 });
    return out;
  }

  hints() {
    return this.h && this.h.kind === 'dinner' && this.h.phase !== 'bye' ? [['E', 'Eat with Rosa']] : [];
  }
}
