// City Life: free roam as a day-to-day life rather than one race.
//
// A clock runs while you're out (1 real second = 1 game minute). You have needs: energy
// (sleep at home), food (eat at the food trucks) and mood (fun things lift it). Rent is due
// every week. Each day brings three small goals, and three people text you story missions
// that unfold chapter by chapter. Deliveries build a courier career with better pay.
// Everything is saved per browser.

export const RANKS = [
  { name: 'Rookie', jobs: 0, pay: 1 },
  { name: 'Courier', jobs: 5, pay: 1.15 },
  { name: 'Senior Courier', jobs: 15, pay: 1.3 },
  { name: 'Pro', jobs: 30, pay: 1.5 },
  { name: 'Legend', jobs: 60, pay: 1.8 },
];

// Goal pool: [id, text, event, count]
const GOALS = [
  ['eat', 'Eat a proper meal', 'eat', 1],
  ['deliver2', 'Deliver two parcels', 'deliver', 2],
  ['postcard', 'Find a postcard', 'postcard', 1],
  ['zip', 'Ride a zipline', 'zip', 1],
  ['fly', 'Take the seaplane up', 'takeoff', 1],
  ['stunt', 'Land a stunt jump in a car', 'stunt', 1],
  ['view', 'Take in the view from the top of the landmark', 'view', 1],
  ['drive2', 'Drive 2 km', 'drive', 2000],
  ['run1', 'Run 1 km on foot', 'run', 1000],
  ['medal', 'Win a medal on any course', 'medal', 1],
  ['combo5', 'Pull off a five-move combo', 'combo5', 1],
  ['borrow', 'Borrow a car from traffic', 'borrow', 1],
  ['ferry', 'Watch a ferry leave from the waterfront', 'ferry', 1],
  ['photo', 'Take a photo of the city', 'photo', 1],
];

// Story missions. Steps:
//   { goto: 'hub'|'dock'|'bridge'|'home'|'food', text }  reach a place
//   { course: 'sprint', medal: true, text }             finish a course (start it from the phone)
//   { event: 'deliver', count: 1, text }                do something in the world
// Each chapter is unlocked a day after the previous one is done.
export const CONTACTS = [
  {
    id: 'rosa', name: 'Rosa', role: 'Courier dispatch', color: '#ff6a2b',
    chapters: [
      { title: 'First day', msg: "Welcome to the team. Grab a job (J) and get that parcel where it's going.", steps: [{ event: 'deliver', count: 1, text: 'Deliver a parcel' }], pay: 200 },
      { title: 'Lunch rush', msg: 'Three deliveries before the lunch rush ends. Eat something first, you look pale.', steps: [{ event: 'eat', count: 1, text: 'Eat at a food truck' }, { event: 'deliver', count: 3, text: 'Deliver three parcels' }], pay: 450 },
      { title: 'Rooftop drop', msg: 'Client wants it on the roof of the landmark. Yes, the roof. Climb.', steps: [{ goto: 'hub', text: 'Get to the landmark' }, { event: 'view', count: 1, text: 'Reach the very top' }], pay: 400 },
      { title: 'Promotion', msg: "Ten deliveries and you're Senior. The van keys are on me.", steps: [{ event: 'deliver', count: 10, text: 'Deliver ten parcels' }], pay: 1200 },
    ],
  },
  {
    id: 'theo', name: 'Theo', role: 'Parkour crew', color: '#2aa198',
    chapters: [
      { title: 'Meet up', msg: 'Heard you run. Meet me at the plaza by the landmark.', steps: [{ goto: 'hub', text: 'Meet Theo at the plaza' }], pay: 100 },
      { title: 'Show me', msg: "Street sprint. Medal or it didn't happen.", steps: [{ course: 'sprint', medal: true, text: 'Win a medal on the street sprint' }], pay: 300 },
      { title: 'Flow', msg: 'Real runners chain it. Five moves, no stopping.', steps: [{ event: 'combo5', count: 1, text: 'Land a five-move combo' }], pay: 300 },
      { title: 'The climb', msg: "Tonight we go up the landmark. I'll be watching from the bottom.", steps: [{ course: 'tower', medal: true, text: 'Win a medal on the landmark climb' }], pay: 500 },
      { title: 'The bridge', msg: 'Last one. The bridge run. Nobody in the crew has gold on it.', steps: [{ course: 'bridge', medal: true, text: 'Win a medal on the bridge run' }], pay: 900 },
    ],
  },
  {
    id: 'mei', name: 'Captain Mei', role: 'Seaplane pilot', color: '#2f6f8f',
    chapters: [
      { title: 'Ground school', msg: 'Want to fly? Come down to the dock.', steps: [{ goto: 'dock', text: 'Go to the seaplane dock' }], pay: 100 },
      { title: 'First flight', msg: 'Throttle up, nose up past 100. Then bring her down gently on the water.', steps: [{ event: 'takeoff', count: 1, text: 'Take off' }, { event: 'splashdown', count: 1, text: 'Land on the water' }], pay: 400 },
      { title: 'Under the bridge', msg: "Every pilot in this town has done it once. Your turn.", steps: [{ course: 'flyer', medal: true, text: 'Win a medal on the seaplane run' }], pay: 700 },
      { title: 'Jump', msg: 'Ever jumped out of a plane? I keep a chute under every seat.', steps: [{ event: 'bail', count: 1, text: 'Bail out in flight' }, { event: 'chute', count: 1, text: 'Land under your parachute' }], pay: 600 },
    ],
  },
];

const FOOD_NAMES = ['Fog Bowl Noodles', 'Bay Taco Truck', 'Pier Coffee & Buns', 'Sourdough Shack', 'Golden Burrito', 'Crab Stand'];

const DAY_START = 7 * 60;
const RENT = 400;

function fresh() {
  return {
    day: 1, minute: DAY_START, energy: 100, food: 70, mood: 65,
    jobs: 0, story: {}, goals: null, earned: 0, spent: 0, lastRent: 1, inbox: [],
  };
}

export class CityLife {
  constructor(saved) {
    this.s = Object.assign(fresh(), saved || {});
    if (!this.s.goals || this.s.goals.day !== this.s.day) this.newGoals();
    for (const c of CONTACTS) if (!this.s.story[c.id]) this.s.story[c.id] = { ch: 0, step: 0, prog: 0, readyDay: 1, sent: false };
    this.listeners = [];
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const f of this.listeners) f(type, data); }

  // ---------- clock ----------
  get clock() {
    const m = Math.floor(this.s.minute) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  // Sky position for the time: day until 18:00, golden hour into dusk by 20:00, dusk colours through
  // the night (with the night factor darkening them), dawn from 05:00 to 07:00.
  get skyU() {
    const h = (this.s.minute % 1440) / 60;
    if (h >= 7 && h < 18) return 0.05 + ((h - 7) / 11) * 0.37;
    if (h >= 18 && h < 20) return 0.42 + ((h - 18) / 2) * 0.32;
    if (h >= 5 && h < 7) return 0.86 + ((h - 5) / 2) * 0.14;
    return 0.74;
  }
  get night() {
    const h = (this.s.minute % 1440) / 60;
    if (h >= 20 && h < 22) return (h - 20) / 2;
    if (h >= 22 || h < 5) return 1;
    if (h >= 5 && h < 6.5) return 1 - (h - 5) / 1.5;
    return 0;
  }
  get rank() { let r = RANKS[0]; for (const k of RANKS) if (this.s.jobs >= k.jobs) r = k; return r; }
  get nextRank() { return RANKS.find((k) => k.jobs > this.s.jobs) || null; }
  // A good mood pays a little more; a bad one a little less.
  get payMul() { return this.rank.pay * (this.s.mood > 70 ? 1.15 : this.s.mood < 30 ? 0.85 : 1); }
  get speedMul() { return this.s.energy < 15 ? 0.78 : this.s.energy < 30 ? 0.9 : 1; }
  get rentDueIn() { return 7 - ((this.s.day - this.s.lastRent) % 7); }

  // Advance by game minutes. effort 0..1 (sprinting, climbing) makes you tire faster.
  tick(min, effort) {
    const s = this.s;
    s.minute += min;
    s.energy = Math.max(0, s.energy - min * (0.075 + effort * 0.06) * (s.food < 15 ? 2 : 1));
    s.food = Math.max(0, s.food - min * 0.13);
    s.mood = Math.max(0, Math.min(100, s.mood - min * 0.02 - (s.food < 15 ? min * 0.05 : 0)));
    const m = s.minute - (s.day - 1) * 1440;
    if (m >= 26 * 60) this.emit('passout');
    // Story messages arrive in the morning of the day they unlock.
    for (const c of CONTACTS) {
      const st = s.story[c.id];
      const ch = c.chapters[st.ch];
      if (ch && !st.sent && s.day >= st.readyDay && m >= DAY_START + 30) {
        st.sent = true;
        s.inbox.unshift({ from: c.id, title: ch.title, text: ch.msg, day: s.day, clock: this.clock, unread: true });
        s.inbox = s.inbox.slice(0, 30);
        this.emit('message', { contact: c, chapter: ch });
      }
    }
  }

  mood(n) { this.s.mood = Math.max(0, Math.min(100, this.s.mood + n)); }

  // ---------- goals ----------
  newGoals() {
    let seed = this.s.day * 7919 + 13;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pool = GOALS.slice();
    const list = [];
    while (list.length < 3 && pool.length) {
      const g = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      list.push({ id: g[0], text: g[1], event: g[2], need: g[3], have: 0, done: false });
    }
    this.s.goals = { day: this.s.day, list, bonus: false };
  }

  // ---------- events from the game ----------
  event(name, n = 1) {
    const s = this.s;
    if (name === 'deliver') s.jobs += n;
    for (const g of s.goals.list) {
      if (g.done || g.event !== name) continue;
      g.have += n;
      if (g.have >= g.need) { g.done = true; this.mood(8); this.emit('goal', g); }
    }
    if (!s.goals.bonus && s.goals.list.every((g) => g.done)) { s.goals.bonus = true; this.emit('allgoals'); }
    this.storyEvent({ event: name, n });
  }

  // Story progress: called with {event, n}, {goto: place}, or {course: id, medal}.
  storyEvent(e) {
    for (const c of CONTACTS) {
      const st = this.s.story[c.id];
      const ch = c.chapters[st.ch];
      if (!ch || !st.sent) continue;
      const step = ch.steps[st.step];
      if (!step) continue;
      let hit = false;
      if (step.event && e.event === step.event) { st.prog += e.n; hit = st.prog >= step.count; }
      if (step.goto && e.goto === step.goto) hit = true;
      if (step.course && e.course === step.course && (!step.medal || e.medal)) hit = true;
      if (!hit) continue;
      st.step++; st.prog = 0;
      if (st.step >= ch.steps.length) {
        st.ch++; st.step = 0; st.sent = false; st.readyDay = this.s.day + 1;
        this.mood(10);
        this.emit('chapter', { contact: c, chapter: ch });
      } else this.emit('step', { contact: c, chapter: ch, step: ch.steps[st.step] });
    }
  }

  // Active story steps, for the phone and the HUD pointer.
  activeSteps() {
    const out = [];
    for (const c of CONTACTS) {
      const st = this.s.story[c.id];
      const ch = c.chapters[st.ch];
      if (!ch || !st.sent) continue;
      const step = ch.steps[st.step];
      out.push({ contact: c, chapter: ch, step, prog: st.prog, index: st.step });
    }
    return out;
  }

  // ---------- money, food, sleep ----------
  earn(n) { this.s.earned += n; }
  spend(n) { this.s.spent += n; }
  eat(gain) { this.s.food = Math.min(100, this.s.food + gain); this.mood(5); this.s.energy = Math.min(100, this.s.energy + 8); this.event('eat'); }

  // End the day. Returns the summary shown on screen.
  sleep(passedOut = false) {
    const s = this.s;
    const summary = {
      day: s.day, earned: s.earned, spent: s.spent, goals: s.goals.list.map((g) => ({ text: g.text, done: g.done })),
      energy: s.energy, food: s.food, mood: s.mood, passedOut, rent: 0, rank: this.rank.name,
    };
    s.day++;
    s.minute = (s.day - 1) * 1440 + DAY_START;
    s.energy = passedOut ? 60 : 100;
    s.food = Math.max(0, s.food - 25);
    s.earned = 0; s.spent = 0;
    if (passedOut) this.mood(-15);
    if (s.day - s.lastRent >= 7) { s.lastRent = s.day; summary.rent = RENT; }
    this.newGoals();
    return summary;
  }

  save() { return this.s; }
}

export { FOOD_NAMES, RENT, DAY_START };
