# Writing a self-contained gameplay module

New gameplay systems live in their own file under `src/` and talk to the rest of the game only
through a context object `ctx` that `src/main.js` builds and passes in. This keeps `main.js`
the single place where systems are wired together.

## The context object

```js
ctx = {
  THREE,                 // three.js namespace
  scene,                 // THREE.Scene
  camera,                // THREE.PerspectiveCamera
  W,                     // world: W.world (CollisionWorld: floorAt(x,z,maxY,r) -> {y, solid}, pointBlocked(x,y,z), addBox(...), ladders[], ziplines[]),
                         //        W.landmarks.hub {x,z,top,plaza:[x,z],face:[x,z],balcony:{r,y}},
                         //        W.landmarks.bridgeInfo {at(u,v)->[x,z], deckY, towerTop, cableY(u)}, W.map (roads[{p:[[x,z]...],w,k,n}], parks, piers, rails)
  BRIDGE,                // {towers:[u0,u1], centreU, rampLen, halfWidth, deckY, towerTop}
  D,                     // district: {id, name, hubName, bridgeName, dockDir}
  V,                     // vehicles: {cars: Car[], plane: Seaplane|null, dock: {pos, heading, shore}}
  player,                // Player: pos (Vector3), vel, facing, mode ('normal'|'climb'|'zip'|'chute'|'mantle'), onGround, speed, events[]
  getDriving: () => Car|Seaplane|null,
  life,                  // CityLife (src/citylife.js): life.s.day, life.s.minute (absolute game minutes), life.clock ('HH:MM'),
                         //   life.night (0..1), life.mood(n), life.event(name, n), life.s.inbox (array of messages), life.on(fn)
  sound,                 // Sound (src/audio.js): tone(freq, dur, type, gain, slideTo, delay), burst(...), chime(), pickup(), finish(), click(), horn(far), shipHorn(far)
  hud,                   // hud.toast(text, ms)
  particles,             // confetti(x,y,z), dust(x,y,z,k), sparks(x,y,z,k), smoke(x,y,z), emit(x,y,z,opts)
  store,                 // store.get(key) / store.set(key, value): per-browser JSON storage (keys are prefixed for you)
  addCash(n),            // pay (negative to charge)
  setPrompt(text),       // show a one-line prompt this frame ("Press E to ...")
  holdE(): boolean,      // E (or the touch Grab / pad X button) held this frame
  pressedE(): boolean,   // E pressed this frame
  setTarget(pos|null),   // point the on-screen pointer + map at a world position (Vector3-like {x,y,z}), null to clear
  Avatar,                // class from src/player.js: new Avatar(look, skinTone) -> {root: Group, update(dt, fakePlayer)}
  LOOKS,                 // character presets
}
```

## What a module exports

A class with:

- `constructor(ctx)` — build meshes, read saved state.
- `update(dt, ctx)` — called every frame while the player is in City Life free roam (not during courses
  or menus). `dt` is game seconds; the life clock advances 1 game minute per real second.
- Optional `phoneHtml()` returning an HTML string for a section of the phone, and `onPhoneClick(target)`.
- Optional `mapMarks()` returning `[{x, z, color, r, label, ring}]` for the full-screen map.
- Optional `hints()` returning `[[keyLabel, actionLabel]]` for the control-hint strip.
- Optional `onEvent(name, data)` for game events: `'Wall run'`, `'Zipline'`, `'Takeoff'`, `'Splashdown'`,
  `'stunt'`, `'deliver'`, `'eat'`, `'photo'`, `'sleep'`.

Keep it dependency-free beyond `ctx` and three.js. Use plain ES modules, 2-space indentation,
single quotes, and short comments that say why, in the same style as `src/careers.js` and `src/citylife.js`.
