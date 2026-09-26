// The main thread's side of the piano engine (voices.worklet.js): start it on a context, hand it the samples, and
// send it notes.

import { outNode } from './piano.js?v=f771651970';

// Start the engine on an audio context (once). Returns null if this browser can't run the worklet.
export async function engineStart(ac) {
  if (ac._engine !== undefined) return ac._engine;
  ac._engine = null;
  if (!ac.audioWorklet) return null;
  try {
    await ac.audioWorklet.addModule(new URL('./voices.worklet.js?v=f771651970', import.meta.url).href);
    const node = new AudioWorkletNode(ac, 'cold-pitch-voices', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(outNode(ac));
    ac._engine = { ac, node, seq: 0, waits: new Map() };
    node.port.onmessage = (e) => { const w = ac._engine.waits.get(e.data.id); if (w) { ac._engine.waits.delete(e.data.id); w(e.data); } };
    return ac._engine;
  } catch (e) {}
  return null;
}
// samples: [{ midi, cents, gain, offset, attack, buffer: AudioBuffer }]. Both channels are copied and handed to the
// worklet (a mono buffer plays on both). `attack` is where in the file the note's attack is, in seconds.
export function engineLoad(eng, samples) {
  const out = samples.map((s) => {
    const l = s.buffer.getChannelData(0).slice(), r = s.buffer.numberOfChannels > 1 ? s.buffer.getChannelData(1).slice() : l.slice();
    return { midi: s.midi, cents: s.cents || 0, gain: s.gain || 1, offset: s.offset || 0, attack: s.attack || 0, sr: s.buffer.sampleRate, ch: [l, r] };
  });
  eng.node.port.postMessage({ type: 'samples', samples: out }, out.flatMap((s) => [s.ch[0].buffer, s.ch[1].buffer]));
}
// Resolves once the audio thread has received everything sent before it (e.g. the samples).
export function engineSync(eng) { const id = ++eng.seq; return new Promise((res) => { eng.waits.set(id, res); eng.node.port.postMessage({ type: 'ping', id }); }); }
// The note's attack lands at `when` (audio clock). A later engineOff with an earlier time replaces a pending one.
export function engineOn(eng, midi, when, level = 1, id = ++eng.seq) { eng.node.port.postMessage({ type: 'on', id, midi, when, level }); return id; }
export function engineOff(eng, id, when, tau = 0.03) { eng.node.port.postMessage({ type: 'off', id, when, tau }); }
