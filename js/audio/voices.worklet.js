// The piano's voices: one AudioWorklet that plays every note (see the piano notes at the top of piano.js, and
// engine.js for the messages it takes).

const MAX_VOICES = 32, LOOK = 96, CEIL = 0.9;
class Voices extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = []; this.voices = []; this.inbox = [];
    this.delay = new Float32Array(LOOK); this.need = new Float32Array(LOOK).fill(1); this.w = 0; this.env = 1;
    this.steal = Math.exp(-1 / (0.005 * sampleRate));          // a stolen voice fades over ~20 ms
    this.relA = Math.exp(-1 / (0.06 * sampleRate));            // limiter release
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
      this.voices.push({ id: m.id, d: s.data, pos: (s.offset || 0) * s.sr, inc: Math.pow(2, (m.midi - s.midi) / 12 - (s.cents || 0) / 1200) * s.sr / sampleRate,
        amp: (s.gain || 1) * (m.level == null ? 1 : m.level), start: Math.max(now, Math.round(m.when * sampleRate)), rel: Infinity, k: 1, env: 1 });
    } else if (m.type === 'off') {
      for (const v of this.voices) if (v.id === m.id && v.rel === Infinity) {
        v.rel = Math.max(v.start, now, Math.round(m.when * sampleRate)); v.k = Math.exp(-1 / ((m.tau || 0.03) * sampleRate));
      }
    }
  }
  process(inputs, outputs) {
    const out = outputs[0][0], n = out.length, now = currentFrame;
    if (this.inbox.length) { const box = this.inbox; this.inbox = []; for (const m of box) this.handle(m, now); }
    out.fill(0);
    // the voice cap counts only notes sounding in this block; notes scheduled for later don't take a slot yet
    const sounding = this.voices.filter((v) => v.start < now + n && !v.stolen);
    if (sounding.length > MAX_VOICES) {
      sounding.sort((a, b) => a.start - b.start);
      for (const v of sounding.slice(0, sounding.length - MAX_VOICES)) { v.stolen = true; v.rel = Math.min(v.rel, now); v.k = Math.min(v.k, this.steal); }
    }
    for (const v of this.voices) {
      const d = v.d, last = d.length - 3;
      for (let k = Math.max(0, v.start - now); k < n; k++) {
        if (now + k >= v.rel) { v.env *= v.k; if (v.env < 1e-4) { v.done = true; break; } }
        let p = v.pos, i = p | 0; if (i >= last) { v.done = true; break; }
        const f = p - i, y0 = i > 0 ? d[i - 1] : d[i], y1 = d[i], y2 = d[i + 1], y3 = d[i + 2];
        const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        out[k] += (((c3 * f + c2) * f + c1) * f + y1) * v.amp * v.env;
        v.pos = p + v.inc;
      }
    }
    if (this.voices.some((v) => v.done)) this.voices = this.voices.filter((v) => !v.done);
    // look-ahead limiter: the output is delayed LOOK samples; the gain needed for the loudest sample in that
    // window is known before it arrives, so the gain eases down ahead of the peak instead of clipping it.
    const atk = 1 - Math.exp(-4 / LOOK);
    for (let k = 0; k < n; k++) {
      const x = out[k], a = Math.abs(x);
      this.need[this.w] = a > CEIL ? CEIL / a : 1;
      let target = 1; for (let j = 0; j < LOOK; j++) if (this.need[j] < target) target = this.need[j];
      this.env = target < this.env ? this.env + (target - this.env) * atk : target + (this.env - target) * this.relA;
      const y = this.delay[this.w] * this.env; this.delay[this.w] = x; this.w = (this.w + 1) % LOOK;
      out[k] = y > 0.99 ? 0.99 : y < -0.99 ? -0.99 : y;
    }
    return true;
  }
}
registerProcessor('cold-pitch-voices', Voices);
