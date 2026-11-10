// The Fog City Chronicle: a morning paper on your phone, written from what you did yesterday.
// Module contract (docs/module-contract.md). It listens to game events during the day,
// writes a front page when you sleep, and shows it in the phone the next morning.

const WEATHER = ['Fog rolls in by noon, burns off by three', 'Karl the Fog takes the day off', 'Drizzle on the waterfront, clear by dusk', 'Bright and windy on the bay'];

export class News {
  constructor(ctx) {
    this.ctx = ctx;
    const saved = ctx.store.get('news') || {};
    this.day = saved.day || { gigs: {}, stunts: 0, best: 0, airshow: false, funrun: false, races: 0, finds: 0, eats: 0, photos: 0, hangouts: 0, parties: 0 };
    this.paper = saved.paper || null;
    ctx.life.on((type, data) => {
      if (type === 'chapter') this.day.chapter = `${data.contact.name}: ${data.chapter.title}`;
    });
  }

  save() { this.ctx.store.set('news', { day: this.day, paper: this.paper }); }

  onEvent(name, data) {
    const d = this.day;
    if (name === 'gig' || name === 'deliver') { const c = (data && data.career) || 'courier'; d.gigs[c] = (d.gigs[c] || 0) + 1; if (data && data.pay > d.best) d.best = data.pay; }
    if (name === 'stunt') d.stunts++;
    if (name === 'eat') d.eats++;
    if (name === 'photo') d.photos++;
    if (name === 'sleep') { this.write(data && data.passedOut); this.save(); }
  }

  write(passedOut) {
    const d = this.day, life = this.ctx.life, D = this.ctx.D;
    const gigs = Object.entries(d.gigs).sort((a, b) => b[1] - a[1]);
    const total = gigs.reduce((a, g) => a + g[1], 0);
    const names = { courier: 'courier', archaeologist: 'archaeologist', photographer: 'photographer', driver: 'driver', pilot: 'pilot', inspector: 'inspector', patrol: 'harbour patrol', stunt: 'stunt performer', foodtruck: 'food-truck cook', guide: 'tour guide', windows: 'window cleaner' };
    let headline;
    if (passedOut) headline = 'Local found asleep on the pavement at 2 a.m., “just resting my eyes”';
    else if (d.chapter) headline = `Word on the street: ${d.chapter}`;
    else if (d.stunts >= 3) headline = `${d.stunts} cars airborne in ${D.name}: “stunt driver” blamed`;
    else if (gigs.length && gigs[0][1] >= 3) headline = `${D.name}’s busiest ${names[gigs[0][0]] || gigs[0][0]} works ${gigs[0][1]} jobs in a day`;
    else if (d.eats >= 3) headline = 'Food trucks report record day; one customer came back three times';
    else if (total) headline = `Quiet day in ${D.name}; a new face takes ${total} job${total > 1 ? 's' : ''}`;
    else headline = `Nothing much happened in ${D.name}, and that was fine`;
    const lines = [];
    if (total) lines.push(`Work: ${gigs.map(([c, n]) => `${n} ${names[c] || c}${n > 1 ? ' jobs' : ' job'}`).join(', ')}.${d.best ? ` Best payday: $${d.best}.` : ''}`);
    if (d.stunts) lines.push(`Traffic desk: ${d.stunts} stunt jump${d.stunts > 1 ? 's' : ''} reported.`);
    if (d.photos) lines.push(`${d.photos} photo${d.photos > 1 ? 's' : ''} of the city made the rounds online.`);
    if (d.eats) lines.push(`Ate ${d.eats} time${d.eats > 1 ? 's' : ''} at the food trucks.`);
    lines.push(`Weather: ${WEATHER[(life.s.day * 7) % WEATHER.length]}.`);
    this.paper = { day: life.s.day + 1, headline, lines };
    this.day = { gigs: {}, stunts: 0, best: 0, eats: 0, photos: 0 };
  }

  phoneHtml() {
    if (!this.paper || this.paper.day !== this.ctx.life.s.day) return '';
    const p = this.paper;
    return `<div class="news"><span class="label">The Fog City Chronicle · Day ${p.day}</span>
      <b style="font:800 1.15rem/1.1 'Big Shoulders Display',sans-serif;text-transform:uppercase;display:block;margin:4px 0">${p.headline}</b>
      ${p.lines.map((l) => `<span class="meta" style="display:block">${l}</span>`).join('')}</div>`;
  }
}
