// Style combos: chain parkour moves without stalling to build a multiplier.
// The chain is banked when you stop flowing (about two seconds on the ground without a move)
// and lost on a hard landing or a dip in the bay. A higher chain also builds "flow",
// which lets the runner sprint a little faster (see Player.flow).

const POINTS = {
  'Wall jump': 100, 'Wall run': 150, 'Wall climb': 80, 'Long jump': 120, 'Slide': 50, 'Roll': 150,
  'Mantle': 40, 'Zipline': 100, 'Parachute': 100, 'Climb': 30, 'Zip jump': 150, 'Cut away': 120,
};
const WINDOW = 2.0;

export class Combo {
  constructor() {
    this.reset();
    this.best = 0;
  }

  reset() {
    this.chain = []; // moves in the current chain
    this.points = 0;
    this.timer = 0;
    this.total = 0; // banked this session / run
    this.last = null;
    this.flash = null;
    this.flow = 0;
  }

  get mult() { return Math.max(1, this.chain.length); }
  get live() { return this.chain.length > 0; }

  // Feed player events; returns a banked/lost notice or null.
  update(dt, player, events) {
    let notice = null;
    for (const e of events) {
      if (e === 'Hard landing' || e === 'Splash') {
        if (this.chain.length > 1) notice = { lost: true, text: 'Combo lost' };
        this.chain = []; this.points = 0; this.timer = 0; this.last = null;
        continue;
      }
      const p = POINTS[e];
      if (!p) continue;
      // The same move twice in a row only scores half: mix it up.
      const pts = e === this.last ? Math.round(p / 2) : p;
      this.chain.push(e);
      this.points += pts;
      this.last = e;
      this.timer = WINDOW;
      this.flash = { text: e, pts };
    }
    // The clock only runs while you're on the ground doing nothing special.
    const idle = player.onGround && player.mode === 'normal' && player.slideTime <= 0 && player.rollTime <= 0;
    if (this.live) {
      if (idle || player.speed < 2) this.timer -= dt * (player.speed < 2 ? 2 : 1);
      if (this.timer <= 0) notice = this.bank() || notice;
    }
    const target = Math.min(1, (this.mult - 1) / 6) * (this.live ? 1 : 0);
    this.flow += (target - this.flow) * Math.min(1, dt * (target > this.flow ? 4 : 1.2));
    return notice;
  }

  bank() {
    if (!this.live) return null;
    const score = this.points * this.mult;
    const n = this.chain.length;
    this.total += score;
    this.best = Math.max(this.best, score);
    this.chain = []; this.points = 0; this.timer = 0; this.last = null;
    return n > 1 ? { lost: false, text: `${n} move combo +${score.toLocaleString()}`, score, n } : null;
  }
}
