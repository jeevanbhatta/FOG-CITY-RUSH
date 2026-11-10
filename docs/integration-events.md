# Integrating city events (air show, fun run, regatta)

`src/events.js` exports `CityEvents`, a module that follows `docs/module-contract.md`. It schedules
three events on the City Life clock (`life.s.day`, `life.s.minute % 1440`):

| Event | When | What |
| --- | --- | --- |
| Fleet Week air show | `day % 7 === 6` (Saturday), 12:00–16:00 | 8 glowing rings over the bay, 3 red/white/blue jets looping overhead with white smoke. Fly the seaplane through all 8 rings in order (within 25 m each): $1,500, `life.mood(15)`, `life.event('airshow')`. Inbox message from `mei` that morning. |
| Sunday fun run | `day % 7 === 0` (Sunday), 08:00–11:00 | Start arch at the hub plaza, 5 checkpoints on named streets (each leg is the shortest path along the road graph), 25 instanced runners. Walk into the arch (within 8 m) to start; hit the checkpoints in order on foot (within 6 m). Pays $300 + $50 per runner beaten, `life.mood(10)`, `life.event('funrun')`. Inbox message from `theo` that morning. |
| Afternoon regatta | every day, 14:00–18:00 | 6 sailboats loop on open water off to one side of the hub (clear of the ferry lanes). Scenery only. |

Because the clock runs at 1 game minute per real second, each window lasts only 3–4 real minutes. A
ring run or a fun run that has already started keeps going after its window closes. The air show and
fun run each pay once per day. That state is saved under the store key `cityEvents`.

## What it uses from `ctx`

`THREE` (it also imports `three` directly, like `life.js`), `scene`, `W` (`world.floorAt`,
`world.pointBlocked`, `landmarks.hub`, `landmarks.bridgeInfo`, `map.roads`), `BRIDGE.centreU`,
`D.dockDir`, `player.pos`, `getDriving()`, `life` (`s.day`, `s.minute`, `s.inbox`, `clock`, `mood`,
`event`), `sound` (`tone`, `chime`, `finish`), `hud.toast`, `particles` (`emit`, `confetti`), `store`,
`addCash`, `setPrompt` and `setTarget`.

The module host block that `main.js` already has (`const ctx = { … }` after the party code, with
`modules`, `moduleTarget` and `addModule`) provides all of these, so `ctx` doesn't need anything new.

It lights `#phone-badge` itself (via `document.getElementById`) when it adds an inbox message, so
`main.js` doesn't need to do anything for that.

## Steps in `src/main.js`

1. **Import** with the other imports at the top:

   ```js
   import { CityEvents } from './events.js';
   ```

2. **Construct** it right after the existing `const friends = addModule(new Friends(ctx));` line in the
   module-host block:

   ```js
   const cityEvents = addModule(new CityEvents(ctx));
   ```

   The constructor builds the road graph and plans the fun-run route (about 50 ms on the Embarcadero
   and Marina maps). It also places the ring line and the regatta loop, testing for water and keeping
   them clear of the bridge.

3. **Update**: nothing to add. `lifeTick()` already runs
   `for (const m of modules) if (m.update) m.update(dt, ctx);`, which only happens in free roam.

4. **Phone**: nothing to add. `renderPhone()` already fills `#ph-mods` from `m.phoneHtml()`. The
   `#ph-mods` click listener already calls `m.onPhoneClick(t)`. The events section lists today's and
   tomorrow's events with their times, plus "Coming up" lines for the next air show and fun run. While
   an event is on, it shows a **Show me** button (`data-ev="air|run|sail"`). The button sets a waypoint
   through `setTarget` and returns `'close'`, so the phone shuts.

5. **Map**: nothing to add for the full-screen map. `mapState()` already adds `m.mapMarks()` when
   `!active`. The marks cover:
   - the rings during the show, with the next one ringed and the first labelled "Air show rings"
   - the start arch, the checkpoints and the finish while the run is open or you are racing it
   - each sailboat during the regatta, with the first labelled "Regatta"

   Optional: to put them on the minimap too, add this to the `if (!active) { … }` block in the minimap
   section of `frame()`:

   ```js
   for (const m of modules) if (m.mapMarks) for (const k of m.mapMarks()) if (Math.hypot(k.x - focus.x, k.z - focus.z) < 400) marks.push(k);
   ```

6. **Hints**: nothing to add. `updateKeyHints()` already adds `m.hints()` (keyboard, free roam). Hints
   appear:
   - while racing: `Fun run: Checkpoint n / 5`
   - near the arch while the run is open: `Fun run: Walk through the start arch to join`
   - in the seaplane during the show: `Air show: Ring n / 8 · fly through in order`

7. **Events**: nothing to add. `endDay()` already calls `moduleEvent('sleep', { passedOut })`. On
   `'sleep'`, `onEvent` calls off a run in progress and clears its pointer.

## Pointer (`setTarget`)

`CityEvents` calls `ctx.setTarget()` only when its target changes, not every frame:
- the next checkpoint while you race the fun run
- the next ring while you are in the seaplane during the show (or partway through a ring run)
- a **Show me** waypoint until you get within 30 m or the event ends

When none of these applies, it sets the target to `null` once. `moduleTarget` comes before `waypoint`
in the HUD pointer (`job ? jobBeacon.position : moduleTarget || waypoint || …`), so an active gig
still takes priority.

## Optional extras

- **Daily goals**: `life.event('airshow')` and `life.event('funrun')` are fired, but there are no
  goals for them yet. To add them, add these to `GOALS` in `src/citylife.js`:
  `['airshow', 'Fly the Fleet Week rings', 'airshow', 1]` and
  `['funrun', 'Finish the Sunday fun run', 'funrun', 1]`. Today those goals would come up on days
  without the event, so filtering by weekday would be needed first.
- **Testing**: `life` is not exposed globally. To try the events without waiting, temporarily add
  `window.life = life;` in `main.js`, then set the clock and day from the console, for example:
  `life.s.day = 6; life.s.minute = 5 * 1440 + 11 * 60 + 55` for just before the Saturday air show.
  Keep the rule `minute = (day - 1) * 1440 + minute-of-day`.
