// Neighbourhoods. Only the one being played is downloaded and built.
// Map files come from tools/build_map.py (see tools/districts.py for the extract boxes).

export const DISTRICTS = {
  embarcadero: {
    id: 'embarcadero',
    name: 'Embarcadero',
    tagline: 'Ferry Building, the Bay Bridge and the downtown towers.',
    file: 'data/embarcadero.json',
    hub: 'ferry',
    hubName: 'Ferry Building',
    bridgeName: 'Bay Bridge',
    bridge: {
      style: 'bay', deckY: 58, rampLen: 460, halfWidth: 12, towers: [354, 1058], centreU: 1400,
      towerTop: 152, endTop: 76, endName: 'Centre anchorage',
      struts: [[90, 94], [122, 126]],
      // Used only if the map file doesn't carry the bridge axis.
      fallback: [[37.7877, -122.3876], [37.8099, -122.3640]],
    },
    boulevard: /embarcadero/i,
    sprintAway: true,
    dockDir: null, // straight out from the hub
    courseIds: '',
    text: {
      sprint: ['Embarcadero Sprint', 'Street-level dash up the waterfront from the Ferry Building plaza.'],
      tower: ['Clock Tower Climb', 'Ladders and ledges to the balcony of the Ferry Building clock tower.'],
      bridge: ['Bay Bridge Run', 'Up the approach, onto the cable, over the tower, and zipline home.'],
      drop: ['Skyline Drop', 'Jump off the tallest tower downtown and steer your parachute down to the Ferry Building.'],
      relay: ['Fog City Express', 'The full delivery: run to the car, drive the waterfront, fly over the skyline, bail out and parachute onto the clock tower.'],
      race: ['Waterfront Grand Prix', 'Race a car out along The Embarcadero toward the bridge and back.'],
      flyer: ['Under the Bay Bridge', 'Seaplane run: under the deck, round the anchorage, over the clock tower, splash down.'],
    },
  },
  marina: {
    id: 'marina',
    name: 'Marina & Crissy Field',
    tagline: 'The Palace of Fine Arts, Crissy Field and the Golden Gate Bridge.',
    file: 'data/marina.json',
    hub: 'palace',
    hubName: 'Palace of Fine Arts',
    bridgeName: 'Golden Gate',
    bridge: {
      style: 'golden', deckY: 67, rampLen: 520, halfWidth: 13, towers: [300, 1300], centreU: 1360,
      towerTop: 227, endTop: 80, endName: 'Far end of the Golden Gate',
      struts: [[105, 111], [145, 151], [185, 191]],
      fallback: [[37.8100, -122.4772], [37.8262, -122.4786]],
    },
    boulevard: /marina b|mason st/i,
    sprintAway: false,
    dockDir: [-0.45, -0.89],
    courseIds: 'marina.',
    text: {
      sprint: ['Crissy Field Dash', 'From the Palace of Fine Arts out along Crissy Field toward the Golden Gate.'],
      tower: ['Rotunda Climb', 'Up a pier, round the colonnade and over the terraces to the top of the Palace dome.'],
      bridge: ['Golden Gate Run', 'Up the toll-plaza ramp, onto the cable, over the south tower, then the long zipline home.'],
      drop: ['Tower Leap', 'Jump off the Golden Gate south tower and parachute down to Crissy Field.'],
      relay: ['Presidio Express', 'Run to the car, drive Marina Boulevard, fly over the Golden Gate, bail out and land on the Palace dome.'],
      race: ['Marina Green Grand Prix', 'Race a car along Marina Boulevard and back.'],
      flyer: ['Under the Golden Gate', 'Seaplane run: under the deck, round the far end, over the Palace dome, splash down.'],
    },
  },
};

export function pickDistrict(saved) {
  let id = null;
  try { id = new URLSearchParams(location.search).get('d'); } catch (_) { /* no URL */ }
  if (!DISTRICTS[id]) id = saved;
  return DISTRICTS[id] || DISTRICTS.embarcadero;
}
