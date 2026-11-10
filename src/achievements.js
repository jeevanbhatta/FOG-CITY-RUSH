// Achievements: checked about once a second against a snapshot of progress, or unlocked
// directly by an event name. Unlocked ids are saved per browser.

export const ACHIEVEMENTS = [
  { id: 'first-run', name: 'Off the Blocks', desc: 'Finish any course.' },
  { id: 'gold', name: 'Golden', desc: 'Win a gold medal.' },
  { id: 'all-gold', name: 'Fog City Champion', desc: 'Gold on every course in a district.' },
  { id: 'postcard', name: 'Wish You Were Here', desc: 'Find a postcard.' },
  { id: 'all-postcards', name: 'Collector', desc: 'Find every postcard in a district.' },
  { id: 'hub-top', name: 'On Top of It All', desc: 'Stand on top of the district landmark.' },
  { id: 'tower-top', name: 'Head for Heights', desc: 'Stand on top of a bridge tower.' },
  { id: 'zip', name: 'Zip It', desc: 'Ride a zipline.' },
  { id: 'chute', name: 'Soft Landing', desc: 'Land with your parachute.' },
  { id: 'bail', name: 'Bail Out', desc: 'Jump out of the seaplane in flight.' },
  { id: 'takeoff', name: 'Wheels Up', desc: 'Take off in the seaplane.' },
  { id: 'borrow', name: 'Just Borrowing', desc: 'Borrow a car from traffic.' },
  { id: 'stunt', name: 'Airtime', desc: 'Land a stunt jump.' },
  { id: 'near5', name: 'Close Shave', desc: 'Five near misses in total.' },
  { id: 'wreck', name: 'Totalled', desc: 'Wreck a car.' },
  { id: 'job', name: 'Signed For', desc: 'Deliver a courier parcel.' },
  { id: 'jobs10', name: 'Employee of the Month', desc: 'Deliver ten parcels.' },
  { id: 'combo8', name: 'Flow State', desc: 'An eight-move combo.' },
  { id: 'cash5k', name: 'Pocket Money', desc: 'Hold $5,000.' },
  { id: 'run10', name: 'Marathon Feet', desc: 'Run 10 km in total.' },
  { id: 'speed', name: 'Speed Demon', desc: 'Hit 150 km/h through a speed trap.' },
  { id: 'daily', name: 'Daily Grind', desc: 'Finish a daily run.' },
  { id: 'photo', name: 'Say Cheese', desc: 'Save a photo in photo mode.' },
  { id: 'rain', name: 'Singing in the Rain', desc: 'Drive in the rain.' },
];

export class Achievements {
  constructor(saved, onUnlock) {
    this.got = new Set(saved || []);
    this.onUnlock = onUnlock;
  }

  get count() { return this.got.size; }

  unlock(id) {
    if (this.got.has(id)) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.got.add(id);
    this.onUnlock(a, [...this.got]);
  }

  // p: a snapshot of progress numbers.
  check(p) {
    if (p.medals.some((m) => m)) this.unlock('first-run');
    if (p.medals.some((m) => m === 'gold')) this.unlock('gold');
    if (p.medals.length && p.medals.every((m) => m === 'gold')) this.unlock('all-gold');
    if (p.postcards > 0) this.unlock('postcard');
    if (p.postcards >= p.postcardTotal && p.postcardTotal) this.unlock('all-postcards');
    if (p.stats.nearMiss >= 5) this.unlock('near5');
    if (p.stats.jobs >= 1) this.unlock('job');
    if (p.stats.jobs >= 10) this.unlock('jobs10');
    if (p.stats.stunts >= 1) this.unlock('stunt');
    if (p.stats.run >= 10000) this.unlock('run10');
    if (p.cash >= 5000) this.unlock('cash5k');
    if (p.comboBest >= 8) this.unlock('combo8');
  }
}
