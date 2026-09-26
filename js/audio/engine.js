// The main thread's side of the piano engine (voices.worklet.js): start it on a context, hand it the samples, and
// send it notes.

import { outNode } from './piano.js';

// Start the engine on an audio context (once). Returns null if this browser can't run the worklet.
export async function engineStart(ac) {
  if (ac._engine !== undefined) return ac._engine;
  ac._engine = null;
  if (!ac.audioWorklet) return null;
  try {
    await ac.audioWorklet.addModule(new URL('./voices.worklet.js', import.meta.url).href);
    const node = new AudioWorkletNode(ac, 'cold-pitch-voices', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    node.connect(outNode(ac));
    ac._engine = { ac, node, seq: 0, waits: new Map() };
    node.port.onmessage = (e) => { const w = ac._engine.waits.get(e.data.id); if (w) { ac._engine.waits.delete(e.data.id); w(e.data); } };
    return ac._engine;
  } catch (e) {}
  return null;
}
// samples: [{ midi, cents, gain, offset, buffer: AudioBuffer }]. The first channel is copied and handed to the worklet.
export function engineLoad(eng, samples) {
  const out = samples.map((s) => ({ midi: s.midi, cents: s.cents || 0, gain: s.gain || 1, offset: s.offset || 0, sr: s.buffer.sampleRate, data: s.buffer.getChannelData(0).slice() }));
  eng.node.port.postMessage({ type: 'samples', samples: out }, out.map((s) => s.data.buffer));
}
// Resolves once the audio thread has received everything sent before it (e.g. the samples).
export function engineSync(eng) { const id = ++eng.seq; return new Promise((res) => { eng.waits.set(id, res); eng.node.port.postMessage({ type: 'ping', id }); }); }
export function engineOn(eng, midi, when, level = 1, id = ++eng.seq) { eng.node.port.postMessage({ type: 'on', id, midi, when, level }); return id; }
export function engineOff(eng, id, when, tau = 0.03) { eng.node.port.postMessage({ type: 'off', id, when, tau }); }
// A note of `dur` seconds whose damper has it gone (<1%) by when + dur.
function enginePlay(eng, midi, when, dur, level = 1, tau = 0.03) { const id = engineOn(eng, midi, when, level); engineOff(eng, id, when + dur - 5 * tau, tau); return id; }
