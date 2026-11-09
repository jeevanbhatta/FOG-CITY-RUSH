// Shareable ghost races: a finished run is packed into a link. Whoever opens it races that ghost.
//
// Binary layout (then deflated and base64url-encoded into the URL fragment):
//   header JSON (length-prefixed): { v, c: course id, d: district, n: name, t: time }
//   per sample, 12 bytes: dt (u16, centiseconds), dx dy dz (i16, decimetres),
//   heading, pitch, roll (i8, radians × 40), flags (u8: kind | mode << 2 | onGround << 5)

export const PUBLIC_URL = 'https://jeevanbhatta.github.io/FOG-CITY-RUSH/';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  if (typeof CompressionStream === 'undefined') return null;
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function packGhost(meta, samples) {
  const head = enc.encode(JSON.stringify({ v: 1, ...meta }));
  const buf = new ArrayBuffer(2 + head.length + samples.length * 12);
  const dv = new DataView(buf);
  dv.setUint16(0, head.length);
  new Uint8Array(buf, 2, head.length).set(head);
  let o = 2 + head.length;
  let pt = 0, px = 0, py = 0, pz = 0;
  for (const s of samples) {
    const t = Math.round(s[0] * 100), x = Math.round(s[1] * 10), y = Math.round(s[2] * 10), z = Math.round(s[3] * 10);
    dv.setUint16(o, clampI(t - pt, 0, 65535));
    dv.setInt16(o + 2, clampI(x - px, -32768, 32767));
    dv.setInt16(o + 4, clampI(y - py, -32768, 32767));
    dv.setInt16(o + 6, clampI(z - pz, -32768, 32767));
    dv.setInt8(o + 8, clampI(wrap(s[4]) * 40, -127, 127));
    dv.setInt8(o + 9, clampI(wrap(s[5]) * 40, -127, 127));
    dv.setInt8(o + 10, clampI(wrap(s[6]) * 40, -127, 127));
    dv.setUint8(o + 11, (s[7] & 3) | ((s[8] & 7) << 2) | ((s[9] ? 1 : 0) << 5));
    // Track the rounded values so error never accumulates.
    pt += dv.getUint16(o); px += dv.getInt16(o + 2); py += dv.getInt16(o + 4); pz += dv.getInt16(o + 6);
    o += 12;
  }
  return new Uint8Array(buf);
}

export function unpackGhost(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hl = dv.getUint16(0);
  const meta = JSON.parse(dec.decode(bytes.subarray(2, 2 + hl)));
  const samples = [];
  let t = 0, x = 0, y = 0, z = 0;
  for (let o = 2 + hl; o + 12 <= bytes.length; o += 12) {
    t += dv.getUint16(o); x += dv.getInt16(o + 2); y += dv.getInt16(o + 4); z += dv.getInt16(o + 6);
    const f = dv.getUint8(o + 11);
    samples.push([t / 100, x / 10, y / 10, z / 10, dv.getInt8(o + 8) / 40, dv.getInt8(o + 9) / 40, dv.getInt8(o + 10) / 40,
      f & 3, (f >> 2) & 7, (f >> 5) & 1]);
  }
  return { meta, samples };
}

// "z" prefix = deflated, "r" = raw (browsers without CompressionStream).
export async function encodeRace(meta, samples) {
  const raw = packGhost(meta, samples);
  const z = await pipe(raw, new CompressionStream('deflate-raw')).catch(() => null);
  return z ? 'z' + b64url(z) : 'r' + b64url(raw);
}

export async function decodeRace(str) {
  let bytes = unb64url(str.slice(1));
  if (str[0] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  if (!bytes) throw new Error('This browser cannot open compressed race links');
  return unpackGhost(bytes);
}

// Link that opens the right district and starts the challenge.
export function raceUrl(district, code) {
  let base = PUBLIC_URL;
  try {
    // When the game itself is served from a normal web page, link back to that page.
    if (/^https?:$/.test(location.protocol) && !/claude|anthropic|localhost|127\.0\.0\.1/.test(location.hostname)) {
      base = location.origin + location.pathname;
    }
  } catch (_) { /* keep the public URL */ }
  return `${base}?d=${encodeURIComponent(district)}#race=${code}`;
}

export function readRaceFromUrl() {
  try {
    const m = /[#&]race=([A-Za-z0-9_-]+)/.exec(location.hash);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}
