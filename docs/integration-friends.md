# Integrating `src/friends.js`

`Friends` follows `docs/module-contract.md`. `src/main.js` already has the module host
(`modules`, `ctx`, `addModule`, `moduleEvent`, `ctx.foodSpots`, the `#ph-mods` phone section,
the map/hint hooks), so most of the wiring is automatic once the module is registered.

## 1. Import

With the other imports at the top of `src/main.js`:

```js
import { Friends } from './friends.js';
```

## 2. Construct and register

Directly after `function addModule(m) { ... }` in the "module host" block:

```js
const friends = addModule(new Friends(ctx));
```

`ctx.foodSpots` is already defined there as a getter over `foodTrucks`
(`{x: t.tx, z: t.tz, name, price}`). Rosa's dinner reads `x`, `z`, `name` and `price`. If you build
`ctx` somewhere else, keep that getter (or pass an array with the same shape).

The constructor:
- reads its saved state from `ctx.store.get('friends')` and saves with `ctx.store.set('friends', ...)`;
- subscribes to `life.on(...)`: each `'chapter'` completion gives that contact +10 affinity;
- adds one hidden beacon mesh to the scene. Friend avatars are created only during a hangout.

## 3. Update

Nothing to add: `lifeTick` already runs `for (const m of modules) if (m.update) m.update(dt, ctx);`.
Two ordering details the module relies on, both true today:
- The modules loop runs **after** the food-truck E handler in `lifeTick`. Rosa's dinner completes
  when that handler calls `moduleEvent('eat', t)` while Rosa is beside you; the handler charges your
  share (`addCash(-t.price)`) and checks cash, so there is a single payment.
- `moduleEvent('sleep', ...)` is sent from `endDay`; Friends uses it to send the friend home.

## 4. Phone

Nothing to add: `renderPhone` appends `phoneHtml()` to `#ph-mods`, and the `#ph-mods` click
listener passes the clicked button to `onPhoneClick`. Buttons use `data-hangout="theo|rosa|mei"`
and `data-friend-end="1"`. `onPhoneClick` returns `'close'` when a hangout starts or ends (the phone
closes), otherwise `undefined` (the phone re-renders and shows why a hangout is unavailable).

Morning texts are pushed to `life.s.inbox` as `{from: 'theo'|'rosa'|'mei', title, text, day, clock, unread: true}`
and then announced with `life.emit('message', {contact: {id, name, color}, chapter: {title: 'New text'}})`,
so the existing `life.on` handler shows the toast, lights the phone badge, pings and saves.
The inbox renderer already colours messages by `CONTACTS` id.

## 5. Map and pointer

Nothing to add: `mapState` already appends `mapMarks()` (the destination ring plus the friend's dot).
The module calls `ctx.setTarget(dest)` when a hangout starts and `ctx.setTarget(null)` when it ends;
`moduleTarget` drives the on-screen pointer when no gig is active.

## 6. Perks

Read `friends.perks` (a fresh object each read):

| field | from | value |
| --- | --- | --- |
| `sprintBonus` | Theo 50 / 100 | `0.05` / `0.1` (0 below 50) |
| `payBonus` | Rosa 50 / 100 | `0.1` / `0.2` (courier gigs) |
| `planeDiscount` | Mei 50 | `true`: seaplane refuel is free (for the refuel feature when it lands) |
| `flightBonus` | Mei 100 | `true`: double pay on `pilot` and `patrol` gigs |

### Sprint (Theo)

In `lifeTick`, replace

```js
player.energyMul = life.speedMul;
```

with

```js
player.energyMul = life.speedMul * (1 + friends.perks.sprintBonus);
```

`Player` multiplies both the sprint top speed and the run speed by `energyMul`
(`src/player.js`, `const top = T.sprint * (1 + 0.18 * this.flow) * (this.energyMul || 1)`). If the bonus
should touch only the sprint, that needs a small change in `player.js` (e.g. a `sprintMul` field used
only in `top`) rather than `flow`, which the combo system overwrites every frame.

### Pay (Rosa, Mei)

In `finishGig`, multiply by `friends.payMul(id)`, which combines both perks for the career:
`(courier ? 1 + payBonus : 1) * (flightBonus && (pilot || patrol) ? 2 : 1)`.

```js
pay = Math.round(pay * workRank(id).pay * (life.s.mood > 70 ? 1.15 : life.s.mood < 30 ? 0.85 : 1) * friends.payMul(id));
```

To give Rosa's bonus to every career instead of courier only, use
`(1 + friends.perks.payBonus) * (friends.perks.flightBonus && (id === 'pilot' || id === 'patrol') ? 2 : 1)`.

### Seaplane refuel (Mei 50)

There is no fuel yet. When a refuel charge is added, skip it with `if (friends.perks.planeDiscount)`.

## Behaviour summary (for testing)

- Hang out from the phone, 10:00 to 23:00, once per friend per game day, on foot, one friend at a time.
  Mei's button closes at 19:36 (the sunset can no longer be finished).
- The friend appears beside you with their own look and a name tag and follows ~2.2 m to your side,
  matching your pace. Drive off, get 40 m ahead or climb more than 6 m and they wait (with a toast);
  when you're back on foot within 6 m of their level, they rejoin, teleporting behind you if far.
- Theo: 3-2-1 countdown, then he runs a straight line at 10 m/s to a named street 250 to 400 m away.
  First within 10 m (you) or at the point (Theo) wins. Using a car still counts, with a comment.
- Rosa: walk to the nearest food truck together and press E at the counter.
- Mei: walk to the hub plaza and stay within 18 m together for 20 game minutes between 17:00 and 20:00.
  Arriving early is fine; still there unfinished at 20:00 ends it with no reward.
- Completion: affinity +15, `life.mood(15)`, a toast line, `life.event('hangout')`, confetti.
  Hangouts also end without reward at 23:30, after a timeout, or from the phone's "End hangout".
- Affinity also rises +10 per story chapter. Perks toast once each when unlocked.
