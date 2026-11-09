// A generated stand-in for the Embarcadero, used only when data/embarcadero.json can't be
// loaded. Same format as the baked OpenStreetMap file so the rest of the game doesn't care.

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function fallbackMap() {
  const r = rand(42);
  // Shoreline runs from the Ferry Building toward Rincon Point; water is to the north-east.
  const sd = [0.527, 0.85];
  const sn = [0.85, -0.527];
  const shoreOff = 14;
  const toWorld = (u, v) => [sd[0] * u + sn[0] * v, sd[1] * u + sn[1] * v];
  const B = 1100;
  const land = [[toWorld(-B * 1.6, shoreOff), toWorld(B * 1.6, shoreOff), toWorld(B * 1.6, -B * 2), toWorld(-B * 1.6, -B * 2)]];
  const piers = [];
  const buildings = [];
  const roads = [];
  const round = (p) => p.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);

  // Piers jutting into the bay with sheds on top.
  for (let u = -900; u <= 700; u += 110) {
    if (Math.abs(u) < 70) continue;
    const w = 26 + r() * 10, len = 140 + r() * 70;
    const p = round([toWorld(u - w / 2, shoreOff - 2), toWorld(u + w / 2, shoreOff - 2), toWorld(u + w / 2, shoreOff + len), toWorld(u - w / 2, shoreOff + len)]);
    piers.push(p);
    land.push(p);
    buildings.push({ p: round([toWorld(u - w / 2 + 3, shoreOff + 8), toWorld(u + w / 2 - 3, shoreOff + 8), toWorld(u + w / 2 - 3, shoreOff + len - 10), toWorld(u - w / 2 + 3, shoreOff + len - 10)]), h: 9 + r() * 5 });
  }
  // Ferry Building on its own pier.
  const fb = round([toWorld(-110, 2), toWorld(110, 2), toWorld(110, 42), toWorld(-110, 42)]);
  land.push(fb);
  buildings.push({ p: round([toWorld(-100, 6), toWorld(-12, 6), toWorld(-12, 34), toWorld(-100, 34)]), h: 18, n: 'Ferry Building' });
  buildings.push({ p: round([toWorld(12, 6), toWorld(100, 6), toWorld(100, 34), toWorld(12, 34)]), h: 18, n: 'Ferry Building' });

  // The Embarcadero roadway along the shore.
  roads.push({ p: round([toWorld(-B * 1.4, shoreOff - 22), toWorld(B * 1.4, shoreOff - 22)]), w: 24, k: 'primary', n: 'The Embarcadero' });

  // City blocks inland, aligned with the shoreline grid.
  const block = 96, street = 18;
  for (let gu = -10; gu <= 8; gu++) {
    for (let gv = 1; gv <= 9; gv++) {
      const u0 = gu * (block + street), v0 = -(gv * (block + street)) - 30;
      const centreDist = Math.hypot(gu * 110, gv * 110);
      if (centreDist > 1250) continue;
      // Split each block into 2–4 lots.
      const splits = 1 + Math.floor(r() * 3);
      const lot = block / splits;
      for (let k = 0; k < splits; k++) {
        for (const half of [0, 1]) {
          const a = u0 + k * lot + 1, b = u0 + (k + 1) * lot - 1;
          const c = v0 - half * (block / 2) - 1, d = v0 - (half + 1) * (block / 2) + 1;
          const inland = gv / 9, nearMarket = Math.max(0, 1 - Math.abs(gu + 1) / 6);
          const base = 14 + inland * 40 + nearMarket * 60;
          const h = Math.round((base * (0.45 + r() * 1.1) + (r() < 0.08 ? 90 : 0)) * 10) / 10;
          buildings.push({ p: round([toWorld(a, c), toWorld(b, c), toWorld(b, d), toWorld(a, d)]), h: Math.max(8, Math.min(220, h)) });
        }
      }
    }
  }
  for (let gu = -10; gu <= 9; gu++) {
    const u = gu * (block + street) - street / 2;
    roads.push({ p: round([toWorld(u, shoreOff - 30), toWorld(u, -1150)]), w: street - 2, k: 'secondary' });
  }
  for (let gv = 1; gv <= 10; gv++) {
    const v = -(gv * (block + street)) - 30 + street / 2;
    roads.push({ p: round([toWorld(-1250, v), toWorld(1100, v)]), w: street - 2, k: 'secondary' });
  }

  return {
    meta: {
      name: 'Embarcadero (generated)',
      origin: { lat: 37.79553, lon: -122.3937 },
      bounds: [-1150, -900, 1150, 1300],
      attribution: 'Generated layout',
      mPerDeg: [87695.0, 110950.0],
      bridge: { shore: [537, 866], dir: [0.647, -0.762] },
      generated: true,
    },
    land,
    piers,
    parks: [],
    roads,
    buildings,
  };
}
