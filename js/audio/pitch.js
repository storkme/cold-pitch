// Reading a voice from mic audio, shared by the live mic (mic.js) and by re-scoring saved recordings (rescore.js).
//
// The signal is the mic decimated to ~24 kHz with its DC offset removed (some headsets add one, which would otherwise
// read as room noise). Every ~10.5 ms a frame gets a level and, where there's sound above the room, a pitch (YIN,
// 65-1100 Hz) and a clarity: 1 for a perfectly periodic sound, low for noise.
//
// A voice is told from the room by its clarity, not its loudness. On a real headset mic, frames of a sung note read
// 0.97-0.99 and the room about 0.4 (95th percentile 0.71), while the voice sat only a few dB above the room: a
// loudness threshold started the clock on level wobbles, sometimes a quarter of a second into a note.

import { median, WIN } from '../util.js?v=536d47461a';

export const CLEAR = 0.9;              // clarity from which a pitched frame is a voice
const ABOVE = 6, LEAD_ABOVE = 3;       // dB over the room: a voice; the quieter start of one, leading into a note
const STEP = 100;                      // cents: the most a voice moves in one frame and still counts as one sound
const LEAD_MAX = 0.3;                  // s: how far back from a detected note its quieter start is looked for
const SETTLE = 0.45;                   // s: Landing is read from here on

// The detector for a signal at `sr` Hz: frames of N samples (21 ms plus the longest period looked for), HOP apart.
export function detector(sr) {
  const W = Math.round(sr * 0.021), TAUMAX = Math.ceil(sr / 65), TAUMIN = Math.max(2, Math.floor(sr / 1100));
  const N = W + TAUMAX, HOP = Math.round(sr * 0.0105), d = new Float32Array(TAUMAX + 2);
  // The pitch of the N samples in x, as { f, clar }, or null if there isn't one.
  function yin(x) {
    let run = 0; d[0] = 1;
    for (let tau = 1; tau <= TAUMAX; tau++) { let sum = 0; for (let j = 0; j < W; j++) { const q = x[j] - x[j + tau]; sum += q * q; } run += sum; d[tau] = run > 0 ? sum * tau / run : 1; }
    let tau = -1;
    for (let t = TAUMIN; t < TAUMAX; t++) if (d[t] < 0.15) { while (t + 1 < TAUMAX && d[t + 1] < d[t]) t++; tau = t; break; }
    if (tau < 0) { let mn = Infinity, mi = -1; for (let t = TAUMIN; t < TAUMAX; t++) if (d[t] < mn) { mn = d[t]; mi = t; } if (mn > 0.3 || mi < 1) return null; tau = mi; }
    const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
    return { f: sr / (tau + (den !== 0 ? Math.max(-1, Math.min(1, 0.5 * (a - c) / den)) : 0)), clar: 1 - b };
  }
  return { N, HOP, yin };
}
// Removes a DC offset: a one-pole high-pass at ~20 Hz, far below any sung note. Keeps state, so one per signal.
export function dcBlocker(sr) {
  const R = 1 - 2 * Math.PI * 20 / sr; let x1 = null, y1 = 0;
  return (x) => { if (x1 === null) x1 = x; const y = x - x1 + R * y1; x1 = x; y1 = y; return y; };
}
// The level from which a frame is worth a pitch: anything that could be the start of a voice.
export const worthPitch = (db, floorDb) => db > floorDb + LEAD_ABOVE;

const cents = (f, g) => 1200 * Math.log2(f / g);
const joins = (a, b) => Math.abs(cents(a.f, b.f)) < STEP;
export const isVoice = (fr, floorDb) => !!fr.f && fr.clar >= CLEAR && fr.db > floorDb + ABOVE;
// A note begins where three voiced frames in a row make one continuous sound; is frame i the third of them?
export function noteBegins(frames, i, floorDb) {
  if (i < 2) return false;
  const a = frames[i - 2], b = frames[i - 1], c = frames[i];
  return isVoice(a, floorDb) && isVoice(b, floorDb) && isVoice(c, floorDb) && joins(a, b) && joins(b, c);
}
// Where the note found at frame i really starts: back through any quieter, still clear voice leading into it.
export function leadIn(frames, i, floorDb) {
  let j = i;
  while (j > 0 && frames[i].t - frames[j - 1].t <= LEAD_MAX) {
    const p = frames[j - 1];
    if (!p.f || p.clar < CLEAR || p.db <= floorDb + LEAD_ABOVE || !joins(p, frames[j])) break;
    j--;
  }
  return j;
}

function summarise(trace) {
  const v = trace.filter((p) => p.c !== null && p.t >= 0);
  let on = v.filter((p) => p.t <= WIN).map((p) => p.c);
  if (on.length < 2) on = v.slice(0, 3).map((p) => p.c);
  if (!on.length) return null;
  const st = v.filter((p) => p.t >= SETTLE).map((p) => p.c);
  return { onset: median(on), settled: st.length >= 5 ? median(st) : null };
}
// A note that starts at frames[j], against a target of `target` Hz: Start and Landing in cents (in whichever octave
// was sung) and its pitch curve, timed from the start. Null if there's no pitch to read.
export function readNote(frames, j, target) {
  const t0 = frames[j].t;
  const raw = frames.filter((x) => x.t >= t0 - 0.1).map((x) => ({ t: x.t - t0, c: x.f && x.clar >= CLEAR ? cents(x.f, target) : null }));
  const pre = summarise(raw);
  if (!pre) return null;
  // Any octave counts, but a miss of 6-9 semitones is a wrong note, not the right one in the wrong octave.
  let k = Math.round(pre.onset / 1200);
  if (k && Math.abs(pre.onset - 1200 * k) > 300 && Math.abs(pre.onset) < 1200) k = 0;
  const trace = raw.map((p) => ({ t: p.t, c: p.c === null ? null : p.c - 1200 * k }));
  const s = summarise(trace);
  return { onsetT: t0, onset: s.onset, settled: s.settled, oct: k, trace };
}

// Frames from a stored recording (16-bit, as the mic kept it), timed like the live ones: t is each frame's centre,
// on the recording's own clock (its first sample is at t0). Older recordings still carry any DC offset, so it's
// removed here as well; removing it twice does no harm.
export function framesOf(pcm, sr, t0) {
  const det = detector(sr), dc = dcBlocker(sr), x = new Float32Array(pcm.length), out = [];
  for (let k = 0; k < pcm.length; k++) x[k] = dc(pcm[k] / 32768);
  for (let end = det.N; end <= x.length; end += det.HOP) {
    const fr = x.subarray(end - det.N, end); let s = 0;
    for (let k = 0; k < det.N; k++) s += fr[k] * fr[k];
    const p = det.yin(fr);
    out.push({ t: t0 + (end - det.N / 2) / sr, db: 10 * Math.log10(s / det.N + 1e-12), f: p ? p.f : null, clar: p ? p.clar : 0 });
  }
  return out;
}
// The room's level in a stored recording: its quieter frames before the note (the 20th percentile).
export function roomOf(frames) {
  const pre = frames.filter((f) => f.t < 0).map((f) => f.db).sort((a, b) => a - b);
  return pre.length ? pre[Math.floor(pre.length * 0.2)] : -70;
}
