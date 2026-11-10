# Enhancements log

A running list of what has been added, newest batch first, and what's queued next.

## Batch 7: people, events and property

Built in parallel by three subagents, each writing a self-contained module against
`docs/module-contract.md`, then integrated through the module host in `src/main.js`.

1. **Friends** (`src/friends.js`): affinity with Rosa, Theo and Captain Mei, raised by their story chapters
   and by hangouts. Hang out from the phone: race Theo across the district, eat at a food truck with Rosa,
   watch the sunset on the plaza with Mei. Your friend walks beside you as a character. Perks at 50 and 100:
   faster sprint (Theo), better courier pay (Rosa), double pay on pilot and patrol gigs (Mei). Friends text you.
2. **Weekly events** (`src/events.js`): a Fleet Week air show every seventh day (fly the seaplane through
   eight rings over the bay while jets loop overhead, $1,500), a Sunday fun run against 25 runners
   ($300 plus $50 per runner beaten), and a sailboat regatta every afternoon.
3. **Two careers with their own minigames** (`src/minigames.js`):
   - **Food-truck owner**: park your truck, then serve a queue of customers before their patience runs out.
   - **Walking tour guide**: lead six tourists to three stops; go too fast and they fall behind and get lost.
4. **Property**: buy a waterfront loft ($8,000) or a penthouse on the tallest building ($25,000, wake up on the roof).
   Better homes lift your mood every night.
5. **Your own car** ($3,000, choose a colour): parked by your door every morning.
6. **Start a new life** in Settings; the menu's City life button shows the day you're on.

## Batch 6: more ways to live

1. **Museum**: donate finds at the landmark plaza (E). Complete a set for a reward: Gold Rush (ship nail,
   coin, ship's bell, nugget) $2,500; The old city (bottle, pipe, brick, token) $1,200; Waterfront
   (crew button, Expo ticket) $900. Or sell finds to a dealer from the phone for half their value.
2. **Harbour patrol** career: fly out, land slowly beside a swimmer bobbing in a life ring, bring them back to the dock.
3. **Film stunt performer** career: a call sheet of three stunts (wall-runs, wall-jumps, long jumps,
   rolled drops, combos, zipline jumps, car stunt jumps, parachutes) before the light goes.
4. **Rooftop parties**: most nights from 21:00 a party lights up a rooftop with searchlights; Theo texts
   you. Climb up for a big mood boost and music.

## Batch 5: City Life (a life, not just a race)

Free roam is now **City Life**: a day-to-day life in the district that carries on between sessions.

1. **Clock and days**: 1 real second is 1 game minute. The sky follows the clock, with real nights (dark sky, moonlight, every window lit).
2. **Needs**: energy (drains faster when you sprint and climb; low energy slows you down), food and mood.
   Hunger drains energy; a good mood pays 15% more, a bad one 15% less.
3. **Home**: an apartment near the landmark with a glowing door. Sleep there to end the day (or nap for two hours).
   Stay out past 2 am and you pass out and wake up tired.
4. **Rent**: $400 every seven days.
5. **Food trucks**: six around the district (Fog Bowl Noodles, Bay Taco Truck, Pier Coffee & Buns…); E to eat.
6. **Daily goals**: three each day from a pool of fourteen, $100 each plus $200 for all three.
7. **Phone** (P or the Phone button): needs, today's goals, missions, work and messages.
8. **Story contacts** who text you chapter by chapter, a new chapter each morning after the last is done:
   Rosa at courier dispatch (4 chapters), Theo from the parkour crew (5), Captain Mei the seaplane pilot (4).
   Missions use everything in the game: deliveries, climbs, course medals, combos, flights, bail-outs.
9. **Six careers**, each with five ranks (Trainee to Legend) and rising pay:
   - **Courier**: pick up and deliver against the clock.
   - **Urban archaeologist**: follow a lead to a dig site, sweep it with a metal detector that beeps faster as you
     close in, hold E to dig. Ten kinds of find from the city's past, from a square ship nail to a Gold Rush
     coin, a buried ship's bell and a gold nugget, kept in your collection.
   - **Photojournalist**: briefs like the landmark from above, the bridge from the water, along the bridge deck,
     a ferry up close, the landmark at night; judged when you save a photo, with a bonus for a centred shot.
   - **Ride-share driver**: collect a passenger, drive them across town; every crash costs a star and the tip.
   - **Tour pilot**: fly sightseers over the landmark, the bridge tower and the span, then land at the dock.
   - **Bridge & tower inspector**: climb to points on the bridge tower, the main cable, rooftops and the landmark
     and hold E to inspect.
10. **End-of-day summary**: earned, spent, rent, goals, mood.
11. Home and food trucks are on the full map; the pointer leads to the current gig.

## Batch 4: a living city

1. **Weather**: clear, thick fog or rain, drifting every few minutes (or fixed in Settings). Rain dims the light, lights the windows, wets the roads (shinier, less grip) and drums on the roof.
2. **Ferries** shuttle across the bay from the hub's waterfront and sound their horn when they leave.
3. **Streetcars** run on the real tram tracks, stop now and then, and are solid.
4. **24 achievements**, with a panel on the start page.
5. **Photo mode** (O): the HUD hides, the world freezes, orbit with the mouse, zoom with the wheel, Enter saves a PNG.
6. **Garage**: spend cash on a tuned engine, bigger nitro, a reinforced body and a stronger seaplane prop.
7. **Speed traps** on the long streets record your best speed through each and pay for new records.
8. **Daily Run**: a new street route every day, the same for everyone, run any way you like.
9. **Seaplane smoke trail**: hold Space in the air.
10. **Fast travel**: right-click the map ($50, on foot in free roam).

## Batch 3: open-world feel

1. **Borrow any car in traffic** (F next to it). Up to three borrowed cars stay parked where you leave them.
2. **Traffic collisions**: bumping a car sparks, dents you and stops them; traffic can knock you over on foot.
3. **Traffic reacts**: cars brake for you and honk if you block them.
4. **Car radio** (Q): two generated stations, Fog FM (lo-fi) and Bay Beat (dance), plus off.
5. **Horn** (G): pedestrians nearby jump out of the way.
6. **Nitro** (Shift / RT): a refilling boost tank with a HUD meter and exhaust sparks.
7. **Car damage**: knocks dent and darken the paint, smoke pours out when it's low, and a wreck puts the car back where you found it.
8. **Lights**: headlights brighten at dusk, brake lights glow when you slow down.
9. **Pedestrians** on footpaths and sidewalks near you; they side-step you and hop clear of cars.
10. **Full-screen map** (Tab or the Map button) with landmarks, postcards, cars, the seaplane and your job.
11. **Waypoints**: click the map to set one; the on-screen pointer and its distance lead you there.
12. **Place names**: entering a street, the hub landmark or the bridge shows its name.
13. **Stunt jumps**: get a car airborne for cash, with slow motion on big ones.
14. **Near misses**: passing traffic fast and close pays out.
15. **Drift scoring**: long handbrake slides pay out by length and speed.
16. **Cash**: earned from jobs, stunts, drifts, near misses, postcards and new medals; shown in the HUD and on the menu.
17. **Courier jobs** (J in free roam): pick up a parcel, then deliver it across the district before the clock runs out.
18. **Vehicle camera** (V): normal, far or close.
19. **Fade transitions** on respawns, wrecks, unsticking and starting a run.
20. **City ambience**: a distant foghorn, traffic hum and gulls near the water.
21. **Lifetime stats** on the menu: distance run, driven and flown, stunt jumps, near misses and jobs.

## Batch 2: cheap in-game wins

Pause on tab switch, postcard pointer in free roam, R to unstick, 1.5 s retry countdown,
medal targets in the HUD and the results, controller restart, a control-hint strip.

## Batch 1

Marina & Crissy Field district with the Golden Gate Bridge, per-district loading, cinematic start
page, performance overlay and auto resolution, ghost-race links, combos and momentum, gamepads,
GitHub Pages hosting with offline install.

## Queued next

- **More story**: longer chapters per contact, a second set of contacts per district, small cutscenes with the camera.
- **Furnishing**: decorate your home; a boat of your own.
- **Night life**: more night-only events (street races, night markets).
- **More careers**: window cleaner on the towers, bike messenger, lifeguard.
- **Hunger and energy on vehicles**: fuel for the car and seaplane, charging, and gas stations.
