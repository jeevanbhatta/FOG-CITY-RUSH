// Careers for City Life. Each career hands out "gigs" built from a few stage types the game
// knows how to run:
//   goto     reach a point (optionally in a car or the seaplane, optionally against the clock)
//   search   sweep an area with a metal detector, then dig where it's loudest (archaeology)
//   inspect  climb to a point and hold E there for a couple of seconds
//   photo    save a photo (O, then Enter) that meets the brief
// Ranks are per career: more gigs done, better pay.

export const CAREER_RANKS = [
  { name: 'Trainee', gigs: 0, pay: 1 },
  { name: 'Junior', gigs: 3, pay: 1.15 },
  { name: 'Senior', gigs: 10, pay: 1.3 },
  { name: 'Expert', gigs: 25, pay: 1.55 },
  { name: 'Legend', gigs: 50, pay: 1.9 },
];

export const CAREERS = [
  { id: 'courier', name: 'Courier', blurb: 'Pick up a parcel, deliver it across the district before the clock runs out.', color: '#ff6a2b' },
  { id: 'archaeologist', name: 'Urban archaeologist', blurb: 'Follow a lead, sweep the area with a metal detector, dig up the city’s past.', color: '#b08442' },
  { id: 'photographer', name: 'Photojournalist', blurb: 'Shoot to a brief: the right subject, from the right place. Photo mode is your camera.', color: '#9b5de5' },
  { id: 'driver', name: 'Ride-share driver', blurb: 'Collect passengers and drive them across town. Smooth driving earns stars and tips.', color: '#2f6f8f' },
  { id: 'pilot', name: 'Tour pilot', blurb: 'Fly sightseers over the landmarks in the seaplane and land them gently.', color: '#2aa198' },
  { id: 'inspector', name: 'Bridge & tower inspector', blurb: 'Climb to inspection points on the bridge and rooftops and check them over.', color: '#d1495b' },
  { id: 'patrol', name: 'Harbour patrol', blurb: 'Someone is in the water. Fly out, land beside them and bring them back to the dock.', color: '#ff8c42' },
  { id: 'stunt', name: 'Film stunt performer', blurb: 'The crew is rolling. Pull off the stunts on the call sheet before the light goes.', color: '#e84393' },
];

// Things you can dig up. Weighted by rarity; values in dollars.
export const ARTIFACTS = [
  { id: 'nail', name: 'Square ship nail', era: 'Gold Rush, 1849', value: 60, w: 10 },
  { id: 'bottle', name: 'Barbary Coast bottle', era: '1860s', value: 90, w: 9 },
  { id: 'brick', name: 'Scorched earthquake brick', era: '1906', value: 80, w: 9 },
  { id: 'token', name: 'Cable car token', era: '1890s', value: 120, w: 7 },
  { id: 'pipe', name: 'Clay pipe', era: '1850s', value: 110, w: 7 },
  { id: 'button', name: 'Brass ferry-crew button', era: '1900s', value: 140, w: 6 },
  { id: 'ticket', name: 'Expo ticket stub in a tin', era: '1915 Panama–Pacific Exposition', value: 220, w: 4 },
  { id: 'coin', name: 'Gold Rush coin', era: '1852', value: 400, w: 3 },
  { id: 'bell', name: "Buried ship's bell", era: 'Gold Rush ship hull, 1849', value: 650, w: 2 },
  { id: 'nugget', name: 'Gold nugget', era: '1849', value: 900, w: 1 },
];

// Museum sets: donate every piece in a set for a reward.
export const SETS = [
  { id: 'goldrush', name: 'Gold Rush', items: ['nail', 'coin', 'bell', 'nugget'], reward: 2500 },
  { id: 'oldcity', name: 'The old city', items: ['bottle', 'pipe', 'brick', 'token'], reward: 1200 },
  { id: 'waterfront', name: 'Waterfront', items: ['button', 'ticket'], reward: 900 },
];

export function rollArtifact(rnd = Math.random) {
  const total = ARTIFACTS.reduce((a, b) => a + b.w, 0);
  let x = rnd() * total;
  for (const a of ARTIFACTS) { x -= a.w; if (x <= 0) return a; }
  return ARTIFACTS[0];
}

export function careerRank(gigs) {
  let r = CAREER_RANKS[0];
  for (const k of CAREER_RANKS) if (gigs >= k.gigs) r = k;
  return r;
}
