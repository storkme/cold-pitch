// The piano: recorded samples played by the engine, the hum that stands in until they're ready, the sound
// button, and notes held down on a drawn keyboard.

import { engineCancel, engineLoad, engineOff, engineOn, engineRoom, engineStart, engineSync } from './engine.js?v=c238679ebb';
import { ctx } from './mic.js?v=c238679ebb';
import { $, clamp, hz } from '../util.js?v=c238679ebb';

/* ---------- the piano: recorded grand-piano samples, played by one AudioWorklet ----------
   The voice is the Salamander Grand (samples/salamander/), recorded in stereo, one sample every three semitones:
   Opus where the browser decodes it, lossless FLAC otherwise. A single AudioWorklet on the audio thread plays every
   note: the page only sends "note on" and "note off" messages, so nothing is built or thrown away per note. The
   worklet lands each note's attack on the exact sample it was scheduled for, re-pitches the nearest recording with
   cubic interpolation (using each sample's measured tuning, so every note is exactly equal-tempered), ends notes
   with a damper, caps the number of voices, and limits the mix so stacked notes can't clip (engine.js,
   voices.worklet.js). If a browser can't run the worklet, the same samples play through plain buffer sources;
   and for the moment before the samples have decoded, the hum stands in, so a note is never silent.

   Once the base set plays, the extras (samples/salamander/extras/) load in the background: a second recording of
   each note, so repeated and slid-to keys alternate between two, and what a real piano does when a key comes up:
   the key's release noise and the strings' resonance as the damper drops, with a small room around it all. Until
   they arrive, and in browsers that fell back to FLAC, keys play as before. */

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
// button (in the range card on the home screen) pulses. Leaving home for a round or a summary turns sound on (see
// show()).
export let muted = true;
export function outNode(ac) {
  if (!ac._master) { ac._master = ac.createGain(); ac._master.gain.value = muted ? 0 : 1; ac._master.connect(ac.destination); }
  return ac._master;
}
// Where a sound that plays along with the piano goes: into the piano's limiter, so the two together can't clip.
export const withPiano = (ac) => (ac._engine && ac._engine.lim) || outNode(ac);
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
// The samples' files (samples/salamander/: a manifest, then one file per sample in each format), fetched once per
// format for the page. Each context decodes its own copy. If fetching fails, the next context to ask tries again.
const SAMPLES = new URL('../../samples/salamander/', import.meta.url);
const get = async (name) => { const r = await fetch(new URL(name, SAMPLES)); if (!r.ok) throw new Error(`${name}: ${r.status}`); return r; };
let manifest = null;
const files = new Map();         // format -> promise of every sample's bytes
const undecodable = new Set();   // formats this browser failed to decode: don't fetch them again
function grandInfo() {
  if (!manifest) { manifest = (async () => (await get('manifest.json')).json())(); manifest.catch(() => { manifest = null; }); }
  return manifest;
}
function grandFiles(info, fmt) {
  if (!files.has(fmt)) {
    const p = Promise.all(info.samples.map(async (g) => (await get(`${g.name}.${fmt}`)).arrayBuffer()));
    p.catch(() => files.delete(fmt)); files.set(fmt, p);
  }
  return files.get(fmt);
}
// Opus first where the browser says it might play it, then FLAC, which every browser with Web Audio decodes.
const opus = () => { try { return document.createElement('audio').canPlayType('audio/webm; codecs="opus"') !== ''; } catch (e) { return false; } };
async function decodeGrand(ac) {
  const info = await grandInfo();
  const formats = info.formats.filter((f) => !undecodable.has(f) && (f !== 'webm' || opus()));
  for (const [n, fmt] of formats.entries()) {
    const bytes = await grandFiles(info, fmt);
    try {
      ac._pianoFormat = fmt;
      return await Promise.all(info.samples.map(async (g, i) => {
        const buffer = await ac.decodeAudioData(bytes[i].slice(0));      // decoding takes over the bytes it's given
        // the attack is `info.attack` into every file; a decoder that adds lead-in pushes it later, so follow it there
        const heard = attackAt(buffer), attack = heard > info.attack + 0.01 ? heard : info.attack;
        return { midi: g.midi, cents: g.cents, gain: g.gain, peak: g.peak, buffer, offset: g.offset, attack };
      }));
    } catch (e) { if (n === formats.length - 1) throw e; undecodable.add(fmt); }
  }
  throw new Error('no sample format to decode');
}
// Start the engine and decode the samples on a context, once. Resolves when the piano can play there; the extras
// then load in the background.
export function pianoReady(ac) {
  if (!ac._piano) ac._piano = (async () => {
    const decoded = await decodeGrand(ac);
    const eng = await engineStart(ac);
    if (eng) { engineLoad(eng, decoded); await engineSync(eng); }
    ac._pianoSamples = decoded; ac._pianoEngine = eng;
    if (eng && ac._pianoFormat === 'webm') extrasReady(ac);
    return true;
  })().catch(() => false);
  return ac._piano;
}

// The extras' files (samples/salamander/extras/: a manifest, then Opus files only), fetched once for the page, each
// context decoding its own copy, as the base set. If anything fails, that context goes on without them.
const EXTRAS = new URL('extras/', SAMPLES);
let extrasFiles = null;
function extrasFetch() {
  if (!extrasFiles) {
    extrasFiles = (async () => {
      const g = async (name) => { const r = await fetch(new URL(name, EXTRAS)); if (!r.ok) throw new Error(`${name}: ${r.status}`); return r; };
      const info = await (await g('manifest.json')).json(), all = [...info.layers, ...info.keyNoise, ...info.resonance];
      const bytes = await Promise.all(all.map(async (s) => (await g(`${s.name}.${info.format}`)).arrayBuffer()));
      return { info, bytes: new Map(all.map((s, i) => [s.name, bytes[i]])) };
    })();
    extrasFiles.catch(() => { extrasFiles = null; });
  }
  return extrasFiles;
}
function extrasReady(ac) {
  if (!ac._extrasP) ac._extrasP = (async () => {
    const { info, bytes } = await extrasFetch(), eng = ac._pianoEngine;
    const decode = (list, extra) => Promise.all(list.map(async (s) => ({ ...s, ...extra, buffer: await ac.decodeAudioData(bytes.get(s.name).slice(0)) })));
    engineLoad(eng, await decode(info.layers, { attack: info.attack }), 'v9');
    engineLoad(eng, await decode(info.keyNoise, { fixed: true }), 'rel');
    for (const kind of ['S', 'L', 'V3']) engineLoad(eng, await decode(info.resonance.filter((s) => s.kind === kind)), 'harm' + kind);
    await engineSync(eng);
    ac._extras = { noteTrack: info.noteTrack, rel: bankParams(info.keyNoise), harm: bankParams(info.resonance) };
    engineRoom(eng, true);
  })().catch(() => { ac._extras = null; });
  return ac._extrasP;
}
const bankParams = (list) => new Map(list.map((s) => [(s.kind || '') + s.midi, s]));
// The same samples through plain buffer sources, for a browser without AudioWorklet (no limiter, so a little headroom).
function bufferVoice(ac, midi, T, level) {
  let s = ac._pianoSamples[0]; for (const x of ac._pianoSamples) if (Math.abs(x.midi - midi) < Math.abs(s.midi - midi)) s = x;
  const src = ac.createBufferSource(), out = ac.createGain(), rate = Math.pow(2, (midi - s.midi) / 12 - s.cents / 1200);
  src.buffer = s.buffer; src.playbackRate.value = rate;
  out.gain.value = Math.min(s.gain, 0.88 * s.gain / s.peak) * level;
  // start early by the pre-roll so the attack lands at T; if that's already past, start now, that far into the file
  const t0 = T - (s.attack - s.offset) / rate, late = Math.max(0, ac.currentTime - t0);
  src.connect(out); out.connect(outNode(ac)); src.start(t0 + late, s.offset + late * rate);
  return (t, tau = DAMPER) => { t = Math.max(t, ac.currentTime); out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, tau); try { src.stop(t + tau * 8); } catch (e) {} };
}
// What a key does when it comes up, once the extras are here, as the Salamander sfz plays its release groups:
// - the key's release noise (unpitched) and the strings' resonance (pitched to the key; the soft or the loud
//   recording by how hard the key was struck, plus a third, quiet layer), each at the sfz's volume and velocity
//   tracking, and quieter the longer the key was held (rt: dB per second);
// - the note's own damper, on keys played by hand, 0.6 times as long: the resonance carries the tail instead.
// A round's reference note gives its release sounds a damper of their own, REF_TAIL after the key comes up, so
// the whole note is gone (under -60 dB) by the Sing step; if the mic can hear the piano, sooner (see playTone).
const HAND_DAMP = 0.6, REF_TAIL = 0.45, REF_TAIL_TAU = 0.06, HEARD_TAIL = 0.1, HEARD_TAIL_TAU = 0.03;
const velTrack = (track, vel) => (1 - track / 100) + (track / 100) * (vel / 127) ** 2;
function releaseSounds(ac, v, t, tail) {
  const eng = ac._pianoEngine, x = ac._extras, held = Math.max(0, t - v.T), vel = clamp(60 * v.level, 1, 127), ids = [];
  const play = (bank, p) => {
    if (!p) return;
    const lv = Math.pow(10, (p.vol - p.rt * held) / 20) * velTrack(p.track, vel) / velTrack(x.noteTrack, vel) * v.level;
    const id = engineOn(eng, v.m, t, lv, bank); ids.push(id);
    if (tail) engineOff(eng, id, t + tail[0], tail[1]);
  };
  const c = clamp(36 + 3 * Math.round((v.m - 36) / 3), 36, 84);           // the resonance recordings' notes
  play('rel', x.rel.get('' + v.m));
  const kind = vel <= 44 ? 'S' : 'L';
  play('harm' + kind, x.harm.get(kind + c)); play('harmV3', x.harm.get('V3' + c));
  return ids;
}
// Repeated and slid-to keys alternate between the two recordings of their note (once the extras are here).
const turn = new Map();
function rrBank(ac, m) {
  if (!ac._extras) return 'notes';
  const c = clamp(36 + 3 * Math.round((m - 36) / 3), 36, 84), k = !turn.get(c); turn.set(c, k);
  return k ? 'notes' : 'v9';
}
// Strike a note at T, `level` times the normal loudness. It decays by itself, like a piano; stop(t, tau) drops the
// damper, and with the extras here, the key's release sounds start then. A second stop with an earlier time moves
// the key-up earlier (release sounds and all); a later one changes nothing; one before T means it's never heard. `hand`: played by hand (round-robin,
// a shorter damper); `tail`: the release sounds' own damper, [after, tau] (the reference note's).
function strike(ac, midi, T, level = 1, { hand = false, tail = null } = {}) {
  const eng = ac._pianoEngine;
  if (eng) {
    const v = { ac, m: midi, T, level, off: Infinity, rel: [] }, id = engineOn(eng, midi, T, level, hand ? rrBank(ac, midi) : 'notes');
    v.stop = (t, tau = DAMPER, tl = tail) => {
      t = Math.max(t, ac.currentTime); if (t >= v.off) return;
      v.off = t; engineCancel(eng, v.rel); v.rel = [];
      if (t <= T) { engineCancel(eng, [id]); return; }                  // up before it was struck: it never sounds
      if (!ac._extras) { engineOff(eng, id, t, tau); return; }
      engineOff(eng, id, t, hand ? tau * HAND_DAMP : tau);
      v.rel = releaseSounds(ac, v, t, tl);
    };
    return v;
  }
  if (ac._pianoSamples) return { ac, stop: bufferVoice(ac, midi, T, level) };
  pianoReady(ac);
  const h = hum(ac, midi, T, level); return { ac, stop: (t) => endHum(h, t) };
}
// A round's reference note, struck at T and held `dur` seconds. It doesn't stop dead when the step changes (in
// earphones that sounded abrupt): it rings on a moment, then dies away gently, under -60 dB before the singing step.
// It's always the same recording of its note (no round-robin), and its release sounds ring REF_TAIL. damp(t) ends
// it sooner, still gently, for when the mic can hear it (see heard() in mic.js): the key-up moves to t, and its
// release sounds, rescheduled there, are cut short so the mic doesn't hear them as a voice in the silent step.
export function playTone(ac, midi, T, dur, level = 1) {
  const v = strike(ac, midi, T, level, { tail: [REF_TAIL, REF_TAIL_TAU] });
  v.stop(T + dur + 0.25, 0.1);
  v.damp = (t) => v.stop(t, 0.05, [HEARD_TAIL, HEARD_TAIL_TAU]);
  return v;
}
// The note a recording was aiming for, played softly under it as it plays back, so you hear the two together: struck
// at T, its key up at `end` (the release sounds ring GHOST_TAIL after). stop(t) ends it sooner.
const GHOST_TAIL = [0.3, 0.06];
export function ghostNote(ac, midi, T, end, level) {
  const v = strike(ac, midi, T, level, { tail: GHOST_TAIL });
  v.stop(end, 0.1);
  return v;
}

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

// Keys played by hand (held notes and the range handles) are released the way a hand plays, not uniformly:
// - dampers stop bass strings more slowly than treble ones (damperTau: ~0.145 s at C2, 0.035 s from D5 up);
// - sliding onto the next key, the last note lingers in proportion to how long it was held (a quick slide
//   overlaps briefly, a slow one longer), never exactly the same twice;
// - slid-to notes are struck a little lighter than the first, and each a little differently.
// A round's reference note ends its own way (playTone): it has to be gone before the singing step.
const damperTau = (m) => 0.035 + 0.11 * clamp((74 - m) / 38, 0, 1);
const slideOverlap = (held) => clamp(held * 0.3, 0.02, 0.12) * (0.8 + 0.4 * Math.random());
const slideLevel = () => 0.82 + 0.12 * Math.random();
// Strike a key by hand. If `prev` is still sounding, this is a slide from it: it lingers a moment, then its damper drops.
function handStrike(ac, m, level, prev) {
  if (prev) { const t = prev.ac.currentTime; prev.stop(t + slideOverlap(t - prev.t), damperTau(prev.m)); }
  const now = ac.currentTime, v = strike(ac, m, now + 0.005, prev ? level * slideLevel() : level, { hand: true });
  v.m = m; v.t = now;
  return v;
}

// Held notes, one per finger (pointer). Like a piano key, pressure sets how hard the note is struck, read when it's
// pressed, where the device reports a real value; mice and most phones report a flat 0.5 (or 1) and get the normal
// level. The note fades by itself while held and the damper drops on release. A cap ends a note if its release is lost.
const heldNotes = new Map();
const realPressure = (p) => p > 0 && p !== 0.5 && p !== 1;
const pressLevel = (p) => realPressure(p) ? 0.35 + 0.95 * p : 1;
export function noteOn(id, m, pressure) {
  const prev = heldNotes.get(id);
  if (prev) { heldNotes.delete(id); clearTimeout(prev.cap); }
  const v = handStrike(audioOut(), m, pressLevel(pressure), prev);
  wantSound();
  v.cap = setTimeout(() => noteOff(id), 8000);
  heldNotes.set(id, v);
}
export function noteOff(id) { const v = heldNotes.get(id); if (!v) return; heldNotes.delete(id); clearTimeout(v.cap); v.stop(v.ac.currentTime, damperTau(v.m)); }

// Each key sounds softly as a handle reaches it, like running a finger along a piano. A key left alone is damped
// after half a second; reaching the next one first makes it a slide.
let blipNote = null;
export function blip(m) {
  try {
    const ac = audioOut(), prev = blipNote && blipNote.ac === ac && ac.currentTime < blipNote.t + 0.5 ? blipNote : null;
    blipNote = handStrike(ac, m, 0.5, prev);                        // quiet: these are feedback, not the lesson
    blipNote.stop(blipNote.t + 0.5, damperTau(m));
    wantSound();
  } catch (e) {}
}
