// Player settings, saved per browser.

const KEY = 'fcr.settings';

export function defaultSettings(isTouch) {
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* old browser */ }
  return {
    sensitivity: 1,
    volume: 0.8,
    quality: isTouch ? 'low' : 'high',
    timeOfDay: 'cycle',
    invertLook: false,
    invertFlight: false,
    reduceMotion: reduce,
    minimap: true,
    autoRes: true,
    showFps: false,
    look: 'courier',
    skin: 2,
  };
}

export function loadSettings(isTouch) {
  const s = defaultSettings(isTouch);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) Object.assign(s, saved);
    // Carry over the earlier standalone flight-invert toggle.
    const old = localStorage.getItem('fcr.invertFlight');
    if (old != null && !saved) s.invertFlight = JSON.parse(old);
  } catch (_) { /* storage blocked: use defaults */ }
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* storage blocked */ }
}

// Renderer-facing values for each quality level.
export const QUALITY = {
  high: { shadows: true, shadowSize: 2048, pixelRatio: 1.75, outlines: true, particles: 1, fogFar: 1150, traffic: 28, detailRadius: 420 },
  medium: { shadows: true, shadowSize: 1024, pixelRatio: 1.25, outlines: false, particles: 0.7, fogFar: 950, traffic: 18, detailRadius: 320 },
  low: { shadows: false, shadowSize: 512, pixelRatio: 1, outlines: false, particles: 0.4, fogFar: 800, traffic: 10, detailRadius: 220 },
};
