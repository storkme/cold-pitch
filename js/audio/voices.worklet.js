// The piano's voices: one AudioWorklet that plays every note, in stereo (see the piano notes at the top of piano.js,
// and engine.js for the messages it takes).
//
// Per note, on the audio thread:
// - the nearest recording is re-pitched with cubic (Hermite) interpolation on both channels, using its measured
//   tuning so the note is exactly equal-tempered;
// - the recording's attack lands exactly on the scheduled time: playback starts early by the sample's pre-roll. If the
//   message arrives too late for that, the voice skips in and fades in over 2 ms instead of clicking;
// - notes end with an exponential release whose time constant the caller picks (a damper), never a cut;
// - the voice count is capped, releasing the oldest sounding voices quickly when needed;
// - the mix runs through a linked stereo look-ahead limiter (one gain from the louder channel, so the image holds).

const MAX_VOICES = 32, LOOK = 96, CEIL = 0.9;
class Voices extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = []; this.voices = []; this.inbox = [];
    this.delay = [new Float32Array(LOOK), new Float32Array(LOOK)]; this.need = new Float32Array(LOOK).fill(1); this.w = 0; this.env = 1;
    this.steal = Math.exp(-1 / (0.005 * sampleRate));          // a stolen voice fades over ~20 ms
    this.relA = Math.exp(-1 / (0.06 * sampleRate));            // limiter release
    this.fadeN = Math.round(0.002 * sampleRate);               // a late note's fade-in
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'samples') { this.samples.push(...m.samples); this.samples.sort((a, b) => a.midi - b.midi); }
      else if (m.type === 'ping') this.port.postMessage({ type: 'pong', id: m.id, samples: this.samples.length });
      else this.inbox.push(m);
    };
  }
  nearest(midi) {
    let best = null; for (const s of this.samples) if (!best || Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s; return best;
  }
  handle(m, now) {
    if (m.type === 'on') {
      const s = this.nearest(m.midi); if (!s) return;
      const inc = Math.pow(2, (m.midi - s.midi) / 12 - (s.cents || 0) / 1200) * s.sr / sampleRate;
      const pos0 = (s.offset || 0) * s.sr, lead = ((s.attack || 0) * s.sr - pos0) / inc;   // output frames from the start to the attack
      let start = Math.round(m.when * sampleRate - lead), pos = pos0, fade = 0;
      if (start < now) { pos = pos0 + (now - start) * inc; start = now; fade = this.fadeN; }  // too late to start early: skip in
      this.voices.push({ id: m.id, s, pos, inc, amp: (s.gain || 1) * (m.level == null ? 1 : m.level), start, rel: Infinity, k: 1, env: 1, fade, fi: 0 });
    } else if (m.type === 'off') {
      // a note can be given its release ahead of time and then an earlier one (a key slid off before its time was up)
      for (const v of this.voices) if (v.id === m.id && v.rel > now) {
        const rel = Math.max(v.start, now, Math.round(m.when * sampleRate));
        if (rel < v.rel) { v.rel = rel; v.k = Math.exp(-1 / ((m.tau || 0.03) * sampleRate)); }
      }
    }
  }
  process(inputs, outputs) {
    const L = outputs[0][0], R = outputs[0][1] || L, n = L.length, now = currentFrame;
    if (this.inbox.length) { const box = this.inbox; this.inbox = []; for (const m of box) this.handle(m, now); }
    L.fill(0); if (R !== L) R.fill(0);
    // the voice cap counts only notes sounding in this block; notes scheduled for later don't take a slot yet
    const sounding = this.voices.filter((v) => v.start < now + n && !v.stolen);
    if (sounding.length > MAX_VOICES) {
      sounding.sort((a, b) => a.start - b.start);
      for (const v of sounding.slice(0, sounding.length - MAX_VOICES)) { v.stolen = true; v.rel = Math.min(v.rel, now); v.k = Math.min(v.k, this.steal); }
    }
    for (const v of this.voices) {
      const a = v.s.ch[0], b = v.s.ch[1], last = a.length - 3;
      for (let k = Math.max(0, v.start - now); k < n; k++) {
        if (now + k >= v.rel) { v.env *= v.k; if (v.env < 1e-4) { v.done = true; break; } }
        const p = v.pos, i = p | 0; if (i >= last) { v.done = true; break; }
        const f = p - i, j = i > 0 ? i - 1 : i;
        let g = v.amp * v.env; if (v.fi < v.fade) g *= ++v.fi / v.fade;
        let y0 = a[j], y1 = a[i], y2 = a[i + 1], y3 = a[i + 2];
        L[k] += (((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f) + y1) * g;
        if (R !== L) {
          y0 = b[j]; y1 = b[i]; y2 = b[i + 1]; y3 = b[i + 2];
          R[k] += (((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f) + y1) * g;
        }
        v.pos = p + v.inc;
      }
    }
    if (this.voices.some((v) => v.done)) this.voices = this.voices.filter((v) => !v.done);
    // look-ahead limiter: the output is delayed LOOK samples; the gain needed for the loudest sample in that
    // window is known before it arrives, so the gain eases down ahead of the peak instead of clipping it.
    const atk = 1 - Math.exp(-4 / LOOK);
    for (let k = 0; k < n; k++) {
      const xl = L[k], xr = R[k], pk = Math.max(Math.abs(xl), Math.abs(xr));
      this.need[this.w] = pk > CEIL ? CEIL / pk : 1;
      let target = 1; for (let q = 0; q < LOOK; q++) if (this.need[q] < target) target = this.need[q];
      this.env = target < this.env ? this.env + (target - this.env) * atk : target + (this.env - target) * this.relA;
      const yl = this.delay[0][this.w] * this.env, yr = this.delay[1][this.w] * this.env;
      this.delay[0][this.w] = xl; this.delay[1][this.w] = xr; this.w = (this.w + 1) % LOOK;
      L[k] = yl > 0.99 ? 0.99 : yl < -0.99 ? -0.99 : yl;
      if (R !== L) R[k] = yr > 0.99 ? 0.99 : yr < -0.99 ? -0.99 : yr;
    }
    return true;
  }
}
registerProcessor('cold-pitch-voices', Voices);
