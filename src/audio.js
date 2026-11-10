// All sound is synthesised with Web Audio: no files to load or license.
// Continuous layers (wind, zipline, engine, propeller, canopy) are steered every frame;
// one-shots (steps, landings, splashes, chimes) are short envelopes.

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
  }

  // Browsers only allow audio after a user gesture, so this runs on the first click/tap.
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {
        return;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  build() {
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);

    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.wind = this.noiseLoop('bandpass', 500, 0.5);
    this.canopy = this.noiseLoop('bandpass', 260, 1.2);
    this.zipHiss = this.noiseLoop('highpass', 2400, 0.7);
    this.zipHum = this.oscLoop('sawtooth', 80, 700);
    this.engA = this.oscLoop('sawtooth', 50, 900);
    this.engB = this.oscLoop('square', 25, 500);
    this.prop = this.oscLoop('sawtooth', 70, 600);
    this.wake = this.noiseLoop('lowpass', 700, 0.5);
  }

  noiseLoop(type, freq, Q) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { src, f, g };
  }

  oscLoop(type, freq, cutoff) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type; o.frequency.value = freq;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(this.master);
    o.start();
    return { o, f, g };
  }

  to(param, v, tc = 0.08) {
    param.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  // s: { wind 0..1, zip 0..1, car {rpm 0..1, throttle} | null, plane {rpm 0..1, water} | null, canopy 0..1, t }
  update(s) {
    if (!this.ctx) return;
    const to = this.to.bind(this);
    to(this.wind.g.gain, 0.04 + s.wind * 0.32);
    to(this.wind.f.frequency, 350 + s.wind * 900);
    to(this.zipHiss.g.gain, s.zip * 0.12);
    to(this.zipHum.g.gain, s.zip * 0.06);
    to(this.zipHum.o.frequency, 70 + s.zip * 110);
    const flutter = 0.6 + 0.4 * Math.sin(s.t * 23);
    to(this.canopy.g.gain, s.canopy * 0.18 * flutter, 0.02);
    if (s.car) {
      const f = 38 + s.car.rpm * 120;
      to(this.engA.o.frequency, f);
      to(this.engB.o.frequency, f / 2);
      to(this.engA.f.frequency, 500 + s.car.throttle * 1400);
      to(this.engA.g.gain, 0.05 + s.car.throttle * 0.05);
      to(this.engB.g.gain, 0.05);
    } else {
      to(this.engA.g.gain, 0); to(this.engB.g.gain, 0);
    }
    if (s.plane) {
      to(this.prop.o.frequency, 55 + s.plane.rpm * 95);
      to(this.prop.g.gain, 0.03 + s.plane.rpm * 0.07);
      to(this.prop.f.frequency, 400 + s.plane.rpm * 900);
      to(this.wake.g.gain, s.plane.water ? Math.min(0.25, s.plane.speed / 60) : 0);
    } else {
      to(this.prop.g.gain, 0); to(this.wake.g.gain, 0);
    }
  }

  silence() {
    if (!this.ctx) return;
    if (this.radioBus) this.radioBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    if (this.hum) this.to(this.hum.g.gain, 0);
    if (this.rainLoop) this.to(this.rainLoop.g.gain, 0);
    this.update({ wind: 0, zip: 0, car: null, plane: null, canopy: 0, t: 0 });
    this.to(this.wind.g.gain, 0);
  }

  // --- one-shots ---
  burst(dur, type, freq, gain, Q = 1, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  step(surface = 'hard') {
    const soft = surface === 'soft';
    this.burst(0.08, 'bandpass', soft ? 500 : 1300 + Math.random() * 500, soft ? 0.12 : 0.16, 1.4);
  }
  jump() { this.burst(0.12, 'bandpass', 900, 0.1, 0.8); this.tone(180, 0.1, 'sine', 0.05, 240); }
  land(force) {
    const k = Math.min(1, force / 25);
    this.tone(90, 0.18 + k * 0.2, 'sine', 0.12 + k * 0.3, 40);
    this.burst(0.15 + k * 0.2, 'lowpass', 900, 0.1 + k * 0.25);
  }
  ladder() { this.tone(520 + Math.random() * 80, 0.05, 'triangle', 0.05); }
  splash(big = 1) {
    this.burst(0.7 * big + 0.2, 'lowpass', 1800, 0.35 * big + 0.1, 0.4);
    this.burst(0.4, 'highpass', 3000, 0.12 * big, 0.5, 0.05);
  }
  crash() {
    this.burst(0.9, 'lowpass', 1200, 0.6, 0.6);
    this.tone(70, 0.6, 'sine', 0.4, 30);
  }
  scrape(k) { this.burst(0.18, 'bandpass', 2500, 0.08 + Math.min(0.25, k * 0.015), 3); }
  chime() { this.tone(1318, 0.35, 'sine', 0.16); this.tone(1976, 0.5, 'sine', 0.12, null, 0.08); }
  finish() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.16, null, i * 0.09));
  }
  beep(go) { this.tone(go ? 988 : 660, go ? 0.45 : 0.18, 'square', 0.08); }
  click() { this.tone(1400, 0.04, 'triangle', 0.06); }
  whoosh() { this.burst(0.5, 'bandpass', 700, 0.18, 0.6); }
  pickup() { [1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, null, i * 0.05)); }
  door() { this.burst(0.12, 'lowpass', 400, 0.25); this.tone(140, 0.08, 'square', 0.05); }

  // Car horn: two detuned squares. far 0..1 makes it quieter (other drivers honking at you).
  horn(far = 0) {
    const g = 0.09 * (1 - far * 0.8);
    this.tone(415, 0.38, 'square', g); this.tone(523, 0.38, 'square', g * 0.8);
  }
  // Rain on the roof: a hiss that follows the weather.
  rainLevel(k) {
    if (!this.ctx) return;
    if (!this.rainLoop) this.rainLoop = this.noiseLoop('highpass', 1400, 0.4);
    this.to(this.rainLoop.g.gain, k * 0.09, 0.4);
  }
  shipHorn(far = 0) {
    if (!this.ctx) return;
    const g = 0.12 * (1 - far * 0.85);
    this.tone(98, 1.6, 'sawtooth', g * 0.5); this.tone(147, 1.6, 'triangle', g * 0.35);
  }
  cash() { this.tone(1568, 0.08, 'square', 0.05); this.tone(2093, 0.16, 'square', 0.05, null, 0.06); }
  boost() { this.burst(0.6, 'bandpass', 300, 0.25, 0.7); this.tone(120, 0.5, 'sawtooth', 0.06, 260); }

  // ---------- city ambience: a distant foghorn, traffic hum, gulls ----------
  ambience(dt, on, nearWater) {
    if (!this.ctx) return;
    if (!this.hum) this.hum = this.noiseLoop('lowpass', 160, 0.3);
    this.to(this.hum.g.gain, on ? 0.035 : 0, 0.5);
    if (!on) return;
    this.fogT = (this.fogT ?? 25) - dt;
    if (this.fogT <= 0) {
      this.fogT = 60 + Math.random() * 60;
      // The two-tone horn the bay is famous for: low, long, slightly sour.
      for (const [f, d] of [[110, 0], [92, 1.9]]) {
        const c = this.ctx, t = c.currentTime + d;
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.25);
        g.gain.setValueAtTime(0.11, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        o.connect(lp).connect(g).connect(this.master); o.start(t); o.stop(t + 1.9);
      }
    }
    this.gullT = (this.gullT ?? 6) - dt;
    if (this.gullT <= 0) {
      this.gullT = 4 + Math.random() * 9;
      if (nearWater) for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(1500 + Math.random() * 400, 0.16, 'sine', 0.025, 900, i * 0.2);
    }
  }

  // ---------- car radio: two little generated stations ----------
  // 0 off, 1 "Fog FM" (slow lo-fi chords), 2 "Bay Beat" (upbeat four-on-the-floor).
  setRadio(n) {
    this.radio = n;
    if (!this.ctx) return;
    if (!this.radioBus) {
      this.radioBus = this.ctx.createGain();
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; // car speakers
      this.radioBus.connect(lp).connect(this.master);
    }
    this.radioBus.gain.setTargetAtTime(n ? 0.6 : 0, this.ctx.currentTime, 0.1);
    this.radioNext = this.ctx.currentTime + 0.05;
    this.radioBeat = 0;
  }

  radioTick() {
    if (!this.ctx || !this.radio || !this.radioBus) return;
    const c = this.ctx;
    const bpm = this.radio === 1 ? 76 : 118;
    const step = 60 / bpm / 2; // eighth notes
    const note = (f, t, dur, type, gain) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.radioBus); o.start(t); o.stop(t + dur + 0.05);
    };
    const hit = (t, freq, dur, gain, type = 'highpass') => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.radioBus); src.start(t, Math.random()); src.stop(t + dur + 0.05);
    };
    const kick = (t, gain) => {
      const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(this.radioBus); o.start(t); o.stop(t + 0.3);
    };
    // Schedule a little ahead of the clock.
    while (this.radioNext < c.currentTime + 0.15) {
      const t = this.radioNext, b = this.radioBeat;
      const bar = Math.floor(b / 8) % 4;
      if (this.radio === 1) {
        // ii–V–I–vi in a warm key, Rhodes-ish triangles, lazy kick and a soft brushed hat.
        const chords = [[293.7, 349.2, 440, 523.3], [196, 246.9, 293.7, 349.2], [261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392]];
        if (b % 8 === 0) for (const f of chords[bar]) note(f, t, step * 7, 'triangle', 0.035);
        if (b % 8 === 0 || b % 8 === 5) kick(t, 0.22);
        if (b % 2 === 1) hit(t, 6000, 0.05, 0.03);
        if (b % 8 === 4) hit(t, 1800, 0.12, 0.06, 'bandpass');
        if (b % 4 === 2) note(chords[bar][3] * 2 * (b % 8 === 2 ? 1 : 1.122), t, step * 1.5, 'sine', 0.03);
      } else {
        const roots = [110, 110, 146.8, 130.8];
        kick(t, b % 2 === 0 ? 0.3 : 0.0001);
        if (b % 2 === 1) hit(t, 7000, 0.04, 0.05);
        if (b % 4 === 2) hit(t, 1500, 0.15, 0.09, 'bandpass');
        note(roots[bar] * (b % 2 ? 2 : 1), t, step * 0.9, 'sawtooth', 0.035);
        if (b % 8 === 0) for (const k of [2, 2.52, 3]) note(roots[bar] * k, t, step * 3, 'square', 0.012);
      }
      this.radioNext += step;
      this.radioBeat++;
    }
  }
}
