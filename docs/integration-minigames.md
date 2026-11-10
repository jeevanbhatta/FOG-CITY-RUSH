# Integrating the food-truck and walking-tour gigs

`src/minigames.js` adds two careers that don't fit the stage types (`goto`, `search`, `inspect`,
`photo`, `event`) the gig engine in `src/main.js` knows. Each is a self-running class; the engine only
has to start it, tick it, show its HUD text, point the beacon at it, and pay or fail on its result.

```js
FoodTruckGig / TourGuideGig
  static start(ctx) -> instance | null   // null: no valid spot right now
  update(dt, ctx)   -> null | { done: true, pay, note } | { failed: true, note }
  dispose(ctx)                           // removes all its meshes, textures, materials
  label    // one-line objective for #job-text
  info     // short status for #job-time ("3 served · 2 waiting · 61 s")
  target   // {x, y, z} for the beacon / pointer
  wantsE   // FoodTruckGig only: true on frames where E serves a customer
```

`ctx` is the module-host object already built in `main.js` (`const ctx = { THREE, scene, … }`, see
`docs/module-contract.md`). It is declared further down the file than the gig engine, but it is only
read when a gig runs, so there is no ordering problem. The gigs call `ctx.setPrompt` (sets
`lifePrompt`), `ctx.pressedE`, `ctx.getDriving`, `ctx.sound`, `ctx.hud.toast`, `ctx.particles`, and read
`ctx.life.s.minute`, `ctx.W`, `ctx.D`, `ctx.V`, `ctx.player`, and `ctx.foodSpots` (optional).

## 1. Imports and career list

```js
// top of src/main.js
import { FoodTruckGig, TourGuideGig, CAREER_ENTRIES } from './minigames.js';
```

Add the two entries to the career list. Either append them in `src/careers.js`:

```js
import { CAREER_ENTRIES } from './minigames.js';
export const CAREERS = [ /* …existing… */, ...CAREER_ENTRIES ];
```

or, without touching `careers.js`, right after the imports in `main.js`:

```js
for (const c of CAREER_ENTRIES) if (!CAREERS.some((k) => k.id === c.id)) CAREERS.push(c);
```

(`CAREERS` is an exported `const` array, so pushing to it is fine.) The phone's Work tab, `workRank`,
`life.s.work[id]` and the beacon colour all key off `CAREERS`, so nothing else is needed for them.

Optional: give the truck sign your player's name instead of reading it from saved settings:

```js
const ctx = { …, playerName: S.name || '' };   // in the module-host block
```

## 2. `makeGig(id, from)`: delegate

Near the top of `makeGig`, before the `if (id === 'courier')` branch:

```js
const MINI = { foodtruck: FoodTruckGig, guide: TourGuideGig };
// …
function makeGig(id, from) {
  if (MINI[id]) {
    const m = MINI[id].start(ctx);
    if (!m) return null;                  // startGig shows "No work like that around here right now"
    return {
      title: id === 'foodtruck' ? 'Food truck service' : 'Walking tour',
      base: 0,                             // the gig computes its own pay
      mini: m,
      stages: [{ type: 'mini', label: m.label, ...m.target }],
    };
  }
  // …existing careers unchanged…
}
```

One synthetic stage keeps `startGig`/`enterStage` working unchanged (it places the beacon at the first
target and colours it). Optionally add tips in `startGig` next to the others:

```js
if (id === 'foodtruck') tip('foodtruck', 'Food truck: park where the beacon is, then stand at the window and press E to serve the customer at the front.');
if (id === 'guide') tip('guide', 'Tour guide: walk (no driving) to each stop and stay close while you talk. Don’t run off: lost tourists cost you.');
```

## 3. `jobTick(dt, focus)`: tick the gig instead of the stage logic

Insert right after `if (!job) return;`:

```js
if (job.mini) {
  const m = job.mini;
  const r = m.update(dt, ctx);
  if (r && r.done) return finishGig(r.pay, r.note);
  if (r && r.failed) { endJob(r.note); return; }
  const t = m.target;
  jobBeacon.position.set(t.x, t.y || 0, t.z);
  jobBeacon.scale.set(1, 1, 1);
  $('#job-text').textContent = m.label;
  $('#job-time').textContent = m.info;
  $('#job').classList.toggle('urgent', /falling behind|gave up|Get out|No driving/.test(m.info));
  return;
}
```

`finishGig(extra, note)` already does the rest: `pay = job.base (0) + extra`, then the rank multiplier and
mood modifier, `life.s.work[id]++`, stats, cash, confetti, promotion toast and save. No `timeBonus` or
`stars` are set, so the courier/driver branches don't apply. `life.event(id === 'courier' ? 'deliver' : 'gig')`
logs it as a regular gig.

The `job.time` countdown is not used (the food truck keeps its own 90 s service clock), so leave
`time: null` as `startGig` sets it.

## 4. `endJob(msg)`: always dispose

`finishGig` and cancelling (J / phone "Quit this gig") both go through `endJob`, so dispose there, before
`job = null`:

```js
function endJob(msg) {
  if (!job) return;
  if (job.mini) job.mini.dispose(ctx);
  job = null;
  // …unchanged…
}
```

Also call `endJob(null)` (or `job.mini.dispose(ctx)`) anywhere else `job` is dropped without `endJob`,
e.g. a district switch or a reload path, if one exists.

## 5. E key: don't fight the city's own E prompts

`jobTick` runs before `lifeTick` in `openWorld`, and `lifeTick` reads `input.grabHit` for eating at food
trucks, donating finds and sleeping. The food-truck gig already avoids spots within 25 m of
`ctx.foodSpots`, but to be safe, skip those E actions on frames the gig wants E. In `lifeTick`:

```js
if (!driving && !(job && job.mini && job.mini.wantsE)) {
  const t = nearFood(player.pos);
  // …unchanged…
}
```

The player's own grab (`player.update` reads `input.grabHit` for ledges) is harmless while standing at
the window.

## 6. Things to check in game

- Food truck: take the gig, walk or drive to the beacon (within 6 m) and the truck appears with
  "<name>’s Kitchen"; get out, stand at the hatch (within 2.5 m), press E for the front customer. Each
  serve has a 1.2 s cooldown with a sizzle. Bubbles above heads show the order (🍜 / 🌮 / ☕) inside a
  patience ring that shrinks from green to red; at zero they walk off. More customers arrive 11:30–13:30
  and 18:00–20:30. After 90 s: $25 per serve + tips, failed if nobody was served. Going more than 80 m
  from the truck fails the gig. Cancel (J) removes the truck and customers.
- Tour: six tourists in sun hats (every other one with a camera) appear around you and follow at up to
  3.2 m/s. Stops: hub plaza → a named street 150–350 m from it → the waterfront. More than 18 m ahead of
  the group: warning and happiness drops. A tourist more than 45 m away gets lost (one every 3 s). At a
  stop, stay within 8 m with the group gathered for 8 s. Driving pauses the tour with a warning. Pay:
  `90 × 3 + 40 × tourists left × happiness`, failed if everyone is lost.
- Neither gig adds collision boxes: the truck is visual only, and people walk through it.
