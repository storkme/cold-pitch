// The piano: recorded samples played by the engine, the hum that stands in until they're ready, the sound
// button, and notes held down on a drawn keyboard.

import { engineLoad, engineOff, engineOn, engineStart, engineSync } from './engine.js';
import { ctx } from './mic.js';
import { $, hz } from '../util.js';

/* ---------- the piano: recorded grand-piano samples, played by one AudioWorklet ----------
   The voice is the Salamander Grand (samples/salamander/), one sample every three semitones. A single
   AudioWorklet on the audio thread plays every note: the page only sends "note on" and "note off" messages, so
   nothing is built or thrown away per note. The worklet starts each note on the exact sample it was scheduled for,
   re-pitches the nearest recording with cubic interpolation (using each sample's measured tuning, so every note is
   exactly equal-tempered), ends notes with a damper, caps the number of voices, and limits the mix so stacked notes
   can't clip (engine.js, voices.worklet.js). If a browser can't run the worklet, the same samples play through
   plain buffer sources; and for the moment before the samples have decoded, the hum stands in, so a note is never
   silent. */

// The hum (now only a stand-in for the moment before the piano samples have decoded) imitates a closed-mouth hum: a voice-like source whose harmonics fall away (1/n^slope),
// shaped by fixed resonances (a nasal peak, a closed-mouth notch, a gentle high cut), with a soft onset and a slight
// vibrato that fades in. The vibrato is symmetric, so the average pitch is exactly the target.
// Filters are [type, Hz, Q, dB]. `level` is the target loudness (RMS); playTone works out the gain that
// hits it at each pitch, so notes don't get louder or quieter as they pass through a resonance.
// (An "ooh" and a pure sine were tried too; see git history for their settings.)
const HUM = { slope: 1.4, vib: 7, rate: 5.2, attack: 0.09, release: 0.14, level: 0.11,
              filters: [['lowpass', 650, 0.6], ['peaking', 240, 1.4, 4], ['notch', 1150, 1.6]] };
function sourceWave(ac, slope) {
  if (!ac._waves) ac._waves = new Map();
  if (!ac._waves.has(slope)) {
    const n = 48, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = 1 / Math.pow(k, slope);
    ac._waves.set(slope, ac.createPeriodicWave(re, im));
  }
  return ac._waves.get(slope);
}
// RMS of the source's shape after the filters, at this pitch (harmonic k has amplitude 1/k^slope).
function toneRms(ac, v, f, filters) {
  const n = v.slope == null ? 1 : Math.min(47, Math.floor(ac.sampleRate / 2 / f));
  const fr = new Float32Array(n).map((_, i) => f * (i + 1)), mag = new Float32Array(n).fill(1), m = new Float32Array(n), ph = new Float32Array(n);
  for (const b of filters) { b.getFrequencyResponse(fr, m, ph); for (let i = 0; i < n; i++) mag[i] *= m[i]; }
  let e = 0; for (let i = 0; i < n; i++) e += (mag[i] / Math.pow(i + 1, v.slope ?? 1)) ** 2;
  return Math.sqrt(e / 2);
}
// One hum voice starting at T, at `level` times the normal loudness. It sounds until endHum(); playTone gives it a length.
function hum(ac, midi, T, level = 1) {
  const v = HUM, f = hz(midi);
  const filters = v.filters.map(([type, freq, q, db]) => {
    const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; if (db != null) b.gain.value = db; return b;
  });
  const o = ac.createOscillator();
  // A PeriodicWave is scaled so its peak is 1; measure that scale once per voice so the RMS target holds.
  let src = 1;
  if (v.slope != null) {
    if (!ac._peaks) ac._peaks = new Map();
    if (!ac._peaks.has(v.slope)) { let pk = 0; for (let t = 0; t < 1; t += 1 / 2048) { let y = 0; for (let k = 1; k < 48; k++) y += Math.sin(2 * Math.PI * k * t) / Math.pow(k, v.slope); pk = Math.max(pk, Math.abs(y)); } ac._peaks.set(v.slope, pk); }
    src = 1 / ac._peaks.get(v.slope);
  }
  const gain = v.level / (toneRms(ac, v, f, filters) * src);
  const out = ac.createGain(); out.connect(outNode(ac));
  out.gain.setValueAtTime(0, T);
  out.gain.setTargetAtTime(gain * level, T, v.attack / 3);            // ~95% after `attack`
  if (v.slope == null) o.type = 'sine'; else o.setPeriodicWave(sourceWave(ac, v.slope));
  o.frequency.setValueAtTime(f, T);
  let lfo = null;
  if (v.vib) {
    const depth = ac.createGain(); lfo = ac.createOscillator();
    lfo.frequency.value = v.rate;
    depth.gain.setValueAtTime(0, T + 0.3); depth.gain.linearRampToValueAtTime(f * (Math.pow(2, v.vib / 1200) - 1), T + 0.65);
    lfo.connect(depth); depth.connect(o.frequency); lfo.start(T);
  }
  let node = o;
  for (const b of filters) { node.connect(b); node = b; }
  node.connect(out);
  o.start(T);
  return { ac, out, o, lfo, gain };
}
function endHum(h, t) {
  t = Math.max(t, h.ac.currentTime);
  h.out.gain.cancelScheduledValues(t);
  h.out.gain.setTargetAtTime(0, t, HUM.release / 5);                 // <1% after `release`
  for (const n of [h.o, h.lfo]) if (n) { try { n.stop(t + HUM.release + 0.2); } catch (e) {} }
}

const DAMPER = 0.03;                               // the damper's time constant: under 1% after 5 of these
// Sound on/off. Every visit starts silent: no page should make noise you didn't expect. Every sound goes through one
// master volume per context, so muting catches everything. When something tries to play while muted, the sound
// button (home screen only) pulses. Leaving home for a round or a summary turns sound on (see show()).
export let muted = true;
export function outNode(ac) {
  if (!ac._master) { ac._master = ac.createGain(); ac._master.gain.value = muted ? 0 : 1; ac._master.connect(ac.destination); }
  return ac._master;
}
export function setMuted(v) {
  muted = v;
  for (const ac of [ctx, pctx]) if (ac && ac._master) ac._master.gain.setTargetAtTime(v ? 0 : 1, ac.currentTime, 0.02);
  const b = $('#soundBtn'); b.setAttribute('aria-pressed', String(!v)); b.setAttribute('aria-label', v ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off');
  b.classList.remove('nudge');
}
export function wantSound() {
  const b = $('#soundBtn');
  if (!muted || b.classList.contains('nudge')) return;   // don't restart the pulse on every key of a drag
  b.classList.add('nudge');
}
function attackAt(buf) {                          // first sample above 5% of the opening peak
  const d = buf.getChannelData(0), n = Math.min(d.length, Math.round(buf.sampleRate * 0.4));
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i]));
  let i = 0; while (i < n && Math.abs(d[i]) < 0.05 * pk) i++;
  return i / buf.sampleRate;
}
// The samples' files (samples/salamander/: a manifest, then one MP3 per sample), fetched once for the page. Each
// context decodes its own copy. If fetching fails, the next context to ask tries again.
const SAMPLES = new URL('../../samples/salamander/', import.meta.url);
let grand = null;
function grandFiles() {
  const get = async (name) => { const r = await fetch(new URL(name, SAMPLES)); if (!r.ok) throw new Error(`${name}: ${r.status}`); return r; };
  if (!grand) {
    grand = (async () => {
      const info = await (await get('manifest.json')).json();
      return { info, mp3s: await Promise.all(info.samples.map(async (g) => (await get(g.file)).arrayBuffer())) };
    })();
    grand.catch(() => { grand = null; });
  }
  return grand;
}
// Start the engine and decode the samples on a context, once. Resolves when the piano can play there.
export function pianoReady(ac) {
  if (!ac._piano) ac._piano = (async () => {
    const { info, mp3s } = await grandFiles();
    const decoded = await Promise.all(info.samples.map(async (g, i) => {
      const buffer = await ac.decodeAudioData(mp3s[i].slice(0));      // decoding takes over the bytes it's given
      // Chrome skips the MP3's encoder delay; a decoder that doesn't leaves extra silence, so skip that too
      return { midi: g.midi, cents: g.cents, gain: g.gain, peak: g.peak, buffer, offset: Math.max(g.offset, attackAt(buffer) - info.preroll) };
    }));
    const eng = await engineStart(ac);
    if (eng) { engineLoad(eng, decoded); await engineSync(eng); }
    ac._pianoSamples = decoded; ac._pianoEngine = eng;
    return true;
  })().catch(() => false);
  return ac._piano;
}
// The same samples through plain buffer sources, for a browser without AudioWorklet (no limiter, so a little headroom).
function bufferVoice(ac, midi, T, level) {
  let s = ac._pianoSamples[0]; for (const x of ac._pianoSamples) if (Math.abs(x.midi - midi) < Math.abs(s.midi - midi)) s = x;
  const src = ac.createBufferSource(), out = ac.createGain();
  src.buffer = s.buffer; src.playbackRate.value = Math.pow(2, (midi - s.midi) / 12 - s.cents / 1200);
  out.gain.value = Math.min(s.gain, 0.88 * s.gain / s.peak) * level;
  src.connect(out); out.connect(outNode(ac)); src.start(T, s.offset);
  return (t, tau = DAMPER) => { t = Math.max(t, ac.currentTime); out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, tau); try { src.stop(t + tau * 8); } catch (e) {} };
}
// Strike a note at T, `level` times the normal loudness. It decays by itself, like a piano; stop(t) drops the damper.
function strike(ac, midi, T, level = 1) {
  const eng = ac._pianoEngine;
  if (eng) { const id = engineOn(eng, midi, T, level); return { ac, stop: (t, tau = DAMPER) => engineOff(eng, id, Math.max(t, ac.currentTime), tau) }; }
  if (ac._pianoSamples) return { ac, stop: bufferVoice(ac, midi, T, level) };
  pianoReady(ac);
  const h = hum(ac, midi, T, level); return { ac, stop: (t) => endHum(h, t) };
}
// A note of `dur` seconds, damped so it's gone by T + dur.
export function playTone(ac, midi, T, dur, level = 1) { const v = strike(ac, midi, T, level); v.stop(T + dur - 5 * DAMPER); return v; }

// The context for sounds outside a round: the round's own if the mic is open, otherwise a small one of our own,
// made when the page loads (it waits, silent, for the first tap) so the piano is decoded before the first key.
export let pctx = null;     // a small audio context for sounds outside a round (key blips, playing back recordings)
export function setPctx(v) { pctx = v; }
export function audioOut() {
  const ac = ctx || pctx || (pctx = new (window.AudioContext || window.webkitAudioContext)());
  if (ac.state !== 'running') ac.resume().catch(() => {});
  pianoReady(ac);
  return ac;
}

// Held notes, one per finger (pointer). Like a piano key, pressure sets how hard the note is struck, read when it's
// pressed, where the device reports a real value; mice and most phones report a flat 0.5 (or 1) and get the normal
// level. The note fades by itself while held and the damper drops on release. A cap ends a note if its release is lost.
const heldNotes = new Map();
const LEGATO = { overlap: 0.07, tau: 0.06 };      // sliding onto the next key: the last note lingers briefly, then dies away gently
const realPressure = (p) => p > 0 && p !== 0.5 && p !== 1;
const pressLevel = (p) => realPressure(p) ? 0.35 + 0.95 * p : 1;
export function noteOn(id, m, pressure) {
  const prev = heldNotes.get(id);
  if (prev) { heldNotes.delete(id); clearTimeout(prev.cap); prev.stop(prev.ac.currentTime + LEGATO.overlap, LEGATO.tau); }
  const ac = audioOut(), v = strike(ac, m, ac.currentTime + 0.005, pressLevel(pressure));
  wantSound();
  v.cap = setTimeout(() => noteOff(id), 8000);
  heldNotes.set(id, v);
}
export function noteOff(id) { const v = heldNotes.get(id); if (!v) return; heldNotes.delete(id); clearTimeout(v.cap); v.stop(v.ac.currentTime); }

// Each key sounds softly as a handle reaches it, cutting off the one before, like running a finger along a piano.
let blipNote = null;
export function blip(m) {
  try {
    const ac = audioOut();
    if (blipNote) blipNote.stop(ac.currentTime + LEGATO.overlap, LEGATO.tau);
    blipNote = playTone(ac, m, ac.currentTime + 0.01, 0.5, 0.5);   // quiet: these are feedback, not the lesson
    wantSound();
  } catch (e) {}
}
