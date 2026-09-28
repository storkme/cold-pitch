// The main thread's side of the piano engine (voices.worklet.js): start it on a context, hand it the samples, and
// send it notes. The engine plays into a small room: engine -> dry, and engine -> room (a generated stereo reverb)
// -> wet; both into a limiter, then the page's master volume (outNode). The room is silent (wet 0) until
// engineRoom turns it on.

import { outNode } from './piano.js?v=3948b70b10';

// Start the engine on an audio context (once). Returns null if this browser can't run the worklet.
export async function engineStart(ac) {
  if (ac._engine !== undefined) return ac._engine;
  ac._engine = null;
  if (!ac.audioWorklet) return null;
  try {
    await ac.audioWorklet.addModule(new URL('./voices.worklet.js?v=3948b70b10', import.meta.url).href);
    const node = new AudioWorkletNode(ac, 'cold-pitch-voices', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const lim = new AudioWorkletNode(ac, 'cold-pitch-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    const room = ac.createConvolver(), wet = ac.createGain();
    room.normalize = false; room.buffer = roomIR(ac, ROOM.rt60); wet.gain.value = 0;
    node.connect(lim); node.connect(room); room.connect(wet); wet.connect(lim); lim.connect(outNode(ac));
    ac._engine = { ac, node, lim, wet, seq: 0, waits: new Map() };
    node.port.onmessage = (e) => { const w = ac._engine.waits.get(e.data.id); if (w) { ac._engine.waits.delete(e.data.id); w(e.data); } };
    return ac._engine;
  } catch (e) {}
  return null;
}
// samples: [{ midi, cents, gain, offset, attack, fixed, buffer: AudioBuffer }], into a bank ('notes' is the base set;
// see voices.worklet.js). Both channels are copied and handed to the worklet (a mono buffer plays on both).
// `attack` is where in the file the note's attack is, in seconds; `fixed` samples play unpitched.
export function engineLoad(eng, samples, bank = 'notes') {
  const out = samples.map((s) => {
    const l = s.buffer.getChannelData(0).slice(), r = s.buffer.numberOfChannels > 1 ? s.buffer.getChannelData(1).slice() : l.slice();
    return { midi: s.midi, cents: s.cents || 0, gain: s.gain || 1, offset: s.offset || 0, attack: s.attack || 0, fixed: !!s.fixed, sr: s.buffer.sampleRate, ch: [l, r] };
  });
  eng.node.port.postMessage({ type: 'samples', bank, samples: out }, out.flatMap((s) => [s.ch[0].buffer, s.ch[1].buffer]));
}
// Resolves once the audio thread has received everything sent before it (e.g. the samples).
export function engineSync(eng) { const id = ++eng.seq; return new Promise((res) => { eng.waits.set(id, res); eng.node.port.postMessage({ type: 'ping', id }); }); }
// The note's attack lands at `when` (audio clock). A later engineOff with an earlier time replaces a pending one.
export function engineOn(eng, midi, when, level = 1, bank = 'notes') { const id = ++eng.seq; eng.node.port.postMessage({ type: 'on', id, bank, midi, when, level }); return id; }
export function engineOff(eng, id, when, tau = 0.03) { eng.node.port.postMessage({ type: 'off', id, when, tau }); }
// Drop notes that haven't started yet (ones already sounding carry on).
export function engineCancel(eng, ids) { if (ids.length) eng.node.port.postMessage({ type: 'cancel', ids }); }

// The room: small (RT60 0.4 s), well below the piano (-18 dB). Stereo, decorrelated noise with an exponential decay
// whose highs die faster, after an 8 ms pre-delay, each channel's energy normalised to 1 so `wet` is its level.
const ROOM = { rt60: 0.4, wetDb: -18 };
export function engineRoom(eng, on) { eng.wet.gain.setTargetAtTime(on ? Math.pow(10, ROOM.wetDb / 20) : 0, eng.ac.currentTime, 0.05); }
function roomIR(ac, rt60) {
  const sr = ac.sampleRate, len = Math.ceil(sr * (rt60 * 1.2 + 0.02)), pre = Math.round(0.008 * sr), buf = ac.createBuffer(2, len, sr);
  let rnd = 12345; const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x3fffffff - 1; };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let lp = 0, e2 = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr, a = Math.min(0.95, 0.15 + 0.8 * t / rt60);      // a one-pole low-pass closing over time
      lp = lp * a + rand() * (1 - a); d[i] = lp * Math.pow(10, -3 * t / rt60); e2 += d[i] * d[i];
    }
    const g = 1 / Math.sqrt(e2); for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}
