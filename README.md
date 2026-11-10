# Fog City Rush

A browser game set on San Francisco's waterfront, built from real OpenStreetMap data. Run,
wall-jump, wall-run, slide and mantle across rooftops, climb the orange service ladders,
walk the bridge cables and ride ziplines back down. Drive cars along the boulevards, fly a
seaplane under the bridge and parachute down to the shore. Play as a courier, skater,
tourist, techie or freerunner.

**Play it:** https://jeevanbhatta.github.io/FOG-CITY-RUSH/ (works on phones; "Add to Home Screen" installs it).

Two districts, each downloaded only when you play it:

- **Embarcadero:** the Ferry Building clock tower, the Bay Bridge and the downtown towers.
- **Marina & Crissy Field:** the Palace of Fine Arts rotunda, Crissy Field and the Golden Gate Bridge.

Built with [three.js](https://threejs.org) (loaded from jsDelivr) and plain ES modules, with no build step.

## Play locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Run | W A S D | Left-side stick |
| Sprint, wall-run | Shift | Push the stick all the way |
| Look | Mouse (click to lock) | Drag the right side |
| Jump, wall-jump | Space | Jump |
| Slide (press just before landing to roll) | C | Slide |
| Grab a zipline from a standstill | E | Grab |
| Open parachute (while falling) / cut away | Space | Jump |
| Parachute: steer, dive, flare | A/D, W, S | Stick |
| Get in / out of a car or the seaplane (bail out in flight) | F | Drive / Fly button |
| Car: drive, steer, handbrake drift | W/S, A/D, Space | Stick, Drift |
| Seaplane: climb/dive, bank, throttle | W/S, A/D, Shift/C (I inverts W/S) | Stick, Power + / − |
| Restart run (free roam: back to safe ground) / pause | R / Esc | Pause button |
| Toggle minimap / invert seaplane pitch | M / I | Settings |
| FPS readout | F3 | Settings |
| Show / hide control hints | H | Settings |

A hint strip at the bottom of the screen always shows the controls that matter right now: on foot,
on a ladder, on a zipline, under the parachute, driving or flying. It switches to gamepad buttons or
touch wording as soon as you use them. "How to play" on the start page opens by itself on your
first visit.

Gamepads work too: left stick runs (push all the way to sprint, or hold a trigger), right stick
looks, A jumps, B slides, X grabs, Y drives or flies, the triggers set the seaplane throttle, and
Start pauses, View/Back restarts. The d-pad and A move around the menus.

Small touches: switching tabs pauses a run, a quick restart has a 1.5 second countdown, the HUD
shows the next medal you're chasing, the results say how far off the next medal you were, and in
free roam the pointer leads to the nearest postcard you haven't found.

## City life

The **City life** button starts a day-to-day life in the district that carries on between visits:
a clock and real nights, energy, food and mood, an apartment where you sleep, weekly rent, food
trucks, three goals a day, a phone (P) with messages and story missions from three contacts, and six
careers with their own ranks: courier, urban archaeologist (metal detector and digging), photojournalist,
ride-share driver, tour pilot and bridge inspector. J takes a gig in your current career.

## Open world

Free roam is a small open city: borrow any car in traffic (F), use nitro (Shift), the horn (G) and
the radio (Q, two generated stations), and cycle the camera (V). Traffic brakes for you and honks,
pedestrians step aside, and bumps dent your car until it's wrecked. Tab opens a full map where a
click sets a waypoint. Press J for a courier job: pick up a parcel, then deliver it against the
clock. Cash comes from jobs, stunt jumps, drifts, near misses, postcards and new medals, and the
menu keeps lifetime stats. See [docs/enhancements.md](docs/enhancements.md) for the full list.

## Style and momentum

Chain moves without stalling (wall runs, wall jumps, slides, long jumps, rolls, vaults, ziplines,
zipline jumps, parachutes) to build a combo multiplier. The chain is banked about two seconds after
you stop flowing, and lost on a hard landing or a dip in the bay. Repeating the same move scores
half. A long chain also builds flow, which raises your top sprint speed by up to 18%. Speed carries
through wall jumps, landings (longer after a roll) and vaults over ledges.

## Race a friend's ghost

After a run, **Challenge a friend** makes a link holding your best run (compressed into the
link itself, no server). Whoever opens it races your ghost in orange, and the results say who won.

## Courses

Every district has the same seven course types: a street sprint, a landmark climb, a bridge run,
a parachute drop, a relay mission, a car race and a seaplane run. In the Marina they are Crissy Field
Dash, Rotunda Climb, Golden Gate Run, Tower Leap, Presidio Express, Marina Green Grand Prix and
Under the Golden Gate. The Embarcadero set:

- **Embarcadero Sprint** (Easy): a street-level run along the waterfront.
- **Clock Tower Climb** (Medium): ladders and ledges up to the Ferry Building balcony.
- **Bay Bridge Run** (Hard): up the approach ramp and the anchorage, along the main cable to the tower top, then a zipline home.
- **Skyline Drop** (Medium, parachute): jump off the tallest tower downtown and glide through rings to the Ferry Building plaza.
- **Fog City Express** (Hard, relay): run to the courier car, drive the waterfront, fly the seaplane over the skyline, then bail out and parachute onto the clock tower balcony.
- **Waterfront Grand Prix** (Medium, car): out along The Embarcadero toward the bridge and back.
- **Under the Bay Bridge** (Hard, seaplane): take off from the Ferry Building dock, fly under the deck, round the far anchorage, pass over the clock tower and splash down.

Seaplane rules: take off above about 100 km/h by pulling up. Land on the water gently: level wings, a shallow descent and the nose not pointing down. Anything harder, and any building or bridge contact, is a crash and you respawn.

Best times, checkpoint splits and a ghost of your best run are kept in the browser's local storage.
The ghost races you on your next attempt, and the results screen compares every checkpoint with your best.

## Free roam

25 Fog City postcards per district are hidden on rooftops, pier ends, the bridge towers and cable, and the top of the skyline.
Nearby ones show on the minimap; your count is on the main menu.

## Street detail

Around 15,000 props are generated from OpenStreetMap furniture plus rules that fill the gaps. They're
bucketed into 160 m chunks, and only chunks within a few hundred metres of you are drawn (420 m on
High, 320 m on Medium, 220 m on Low). Repeated props share instanced meshes; markings, curbs,
rails, awnings and parapets are merged into one mesh per chunk and built on demand. Trees, lamp
posts, signals, bus shelters, parked cars, rooftop units and water towers have collision.

## Presentation

- **Sound:** synthesised in the browser with Web Audio (footsteps, wind, zipline, car engine, propeller, canopy, splashes, chimes). There are no audio files.
- **Sky:** a gradient sky dome and a slow day cycle (foggy day, golden hour, dusk with lit windows) with rolling fog. You can fix it to day or dusk in Settings.
- **Effects:** particles (dust, sparks, drift smoke, spray, splashes, confetti), camera shake, speed lines and a brief slow-motion as you pass a ring. **Reduce motion** in Settings turns off the shake, speed lines, slow-motion and FOV kick.
- **Life:** traffic on the real street network and gulls over the piers.
- **Settings:** look sensitivity, volume, graphics quality (High, Medium or Low for phones, which uses blob shadows instead of real ones), time of day, inverted look and flight, reduce motion, the minimap, automatic resolution and an FPS readout.
- **Performance:** automatic resolution lowers the render scale when frames run slow and raises it again when there's headroom.

## Map data

`data/<district>.json` files are baked from OpenStreetMap. Districts (extract box, origin,
land probes, which bridge to find) are listed in `tools/districts.py`.

```sh
pip install -r tools/requirements.txt
python3 tools/fetch_osm.py [district ...]   # downloads data/raw/<district>.osm.json from Overpass
python3 tools/build_map.py [district ...]   # writes data/<district>.json
```

The **Build map data** GitHub Actions workflow runs both steps and commits the results whenever the
tools change. If a map file is missing, the game falls back to a generated stand-in layout
(`src/fallback-map.js`). The hub landmarks (the Ferry Building clock tower, the Palace of Fine Arts
rotunda) and the suspension bridges are hand-built in `src/world.js`, because the OpenStreetMap
geometry for them isn't detailed enough for gameplay.

## Hosting

The **Publish site** workflow deploys the game to GitHub Pages on every push to `main`
(one-time setup: Settings → Pages → Source: GitHub Actions). On that site the game registers a web
app manifest and a service worker, so it can be installed and played offline after the first visit.

Map data © OpenStreetMap contributors, available under the Open Database License.

## Code map

- `src/main.js`: renderer, game states, menus (with the fly-through), main loop, performance readout
- `src/districts.js`: per-district settings (map file, landmarks, bridge, course names)
- `src/combo.js`, `src/share.js`: style combos, and packing ghost runs into race links
- `src/world.js`: builds city meshes and collision from map data, plus the bridge, the tower, ladders and ziplines
- `src/physics.js`: collision world of vertical prisms (circle vs polygon, floor and ceiling queries)
- `src/player.js`: movement and parkour moves, and the courier model
- `src/vehicles.js`: arcade car and seaplane physics, models, parking and dock placement
- `src/audio.js`, `src/particles.js`: synthesised sound and pooled particles
- `src/sky.js`: sky dome and time-of-day cycle
- `src/ghost.js`: best-run recording and ghost replay
- `src/life.js`, `src/minimap.js`, `src/parcels.js`: traffic and gulls, the corner map, and postcards
- `src/details.js`: streamed street detail (OSM trees, lamps, signals, crossings, benches, bus stops, hydrants, tram tracks; generated lamps, trees, markings, curbs, parked cars, awnings, rooftop units, water towers, parapets)
- `src/settings.js`: saved settings and quality presets
- `src/camera.js`: third-person camera that avoids walls
- `src/courses.js`: course definitions, rings and timing
- `src/hud.js`, `src/input.js`, `src/textures.js`: UI, input and procedural textures
- `tools/build_artifact.py`: packages the game for a claude.ai Artifact preview
