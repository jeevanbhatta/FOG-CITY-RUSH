# Fog City Rush

A browser parkour game set on San Francisco's Embarcadero. You're a courier: run, wall-jump,
wall-run, slide and mantle across rooftops, climb the orange service ladders, walk the
Bay Bridge's main cable, and ride ziplines back down to the Ferry Building clock tower.

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
| Restart run / pause | R / Esc | Pause button |

## Courses

- **Embarcadero Sprint** (Easy): a street-level run along the waterfront.
- **Clock Tower Climb** (Medium): ladders and ledges up to the Ferry Building balcony.
- **Bay Bridge Run** (Hard): up the approach ramp and the anchorage, along the main cable to the tower top, then a zipline home.

Best times are kept in the browser's local storage.

## Map data

`data/embarcadero.json` is baked from OpenStreetMap:

```sh
pip install -r tools/requirements.txt
python3 tools/fetch_osm.py   # downloads data/raw/embarcadero.osm.json from Overpass
python3 tools/build_map.py   # writes data/embarcadero.json
```

If that file is missing, the game falls back to a generated stand-in layout (`src/fallback-map.js`).
The Ferry Building clock tower and the Bay Bridge west span are hand-built in `src/world.js`,
because the OpenStreetMap geometry for them isn't detailed enough for gameplay.

Map data © OpenStreetMap contributors, available under the Open Database License.

## Code map

- `src/main.js`: renderer, game states, menus, main loop
- `src/world.js`: builds city meshes and collision from map data, plus the bridge, the tower, ladders and ziplines
- `src/physics.js`: collision world of vertical prisms (circle vs polygon, floor and ceiling queries)
- `src/player.js`: movement and parkour moves, and the courier model
- `src/camera.js`: third-person camera that avoids walls
- `src/courses.js`: course definitions, rings and timing
- `src/hud.js`, `src/input.js`, `src/textures.js`: UI, input and procedural textures
- `tools/build_artifact.py`: packages the game for a claude.ai Artifact preview
