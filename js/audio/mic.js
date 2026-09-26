// The mic: opening it, the tap that feeds the pitch detector (YIN), measuring the room, and the per-frame logic
// that follows a note from the imagine step to the end of singing.

import { feedTester, tester } from '../home.js';
import { finish } from '../round.js';
import { setStage } from '../stage.js';
import { round, setLastFrameAt } from '../state.js';
import { clamp, hz, TONE } from '../util.js';

/* ---------- audio engine: pitch detection ---------- */
export let ctx = null, stream = null;
let tap = null, dec = 1, dsr = 24000;
let W, TAUMAX, TAUMIN, N, HOP, frameBuf, diff;
const RING = 1 << 16; let ring = null, total = 0, lastEnd = 0, accSum = 0, accN = 0, tMap = 0, iMap = 0;
export let floorDb = -70, thrDb = -50, lastDb = -100, calib = null;      // round and lastFrameAt are in state.js

export async function initAudio() {
  if ((!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)) { const e = new Error('insecure'); e.name = 'Insecure'; throw e; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  await ctx.resume();
  const sr = ctx.sampleRate;
  dec = Math.max(1, Math.round(sr / 24000)); dsr = sr / dec;
  W = Math.round(dsr * 0.021); TAUMAX = Math.ceil(dsr / 65); TAUMIN = Math.max(2, Math.floor(dsr / 1100));
  N = W + TAUMAX; HOP = Math.round(dsr * 0.0105);
  ring = new Float32Array(RING); frameBuf = new Float32Array(N); diff = new Float32Array(TAUMAX + 2);
  total = lastEnd = accSum = accN = 0;
  const src = ctx.createMediaStreamSource(stream);
  const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
  // The tap is an AudioWorklet (tap.worklet.js); if it can't load, a ScriptProcessor does the same job.
  let node = null;
  if (ctx.audioWorklet) {
    try {
      await ctx.audioWorklet.addModule(new URL('./tap.worklet.js', import.meta.url).href);
      node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (e) => ingest(e.data.d, e.data.t, sr);
    } catch (e) { node = null; }
  }
  if (!node) {
    node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (e) => ingest(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.currentTime - 128 / sr, sr);
  }
  src.connect(node); node.connect(mute); tap = node;
}
export function stopAudio() {
  if (tap) { if (tap.port) tap.port.onmessage = null; tap.onaudioprocess = null; try { tap.disconnect(); } catch (e) {} tap = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (ctx) { try { ctx.close().catch(() => {}); } catch (e) {} ctx = null; }
  calib = null; lastDb = -100;
}
export const micAlive = () => ctx && ctx.state !== 'closed' && stream && stream.getAudioTracks().some((t) => t.readyState === 'live');

function ingest(d, t, sr) {
  for (let k = 0; k < d.length; k++) { accSum += d[k]; if (++accN === dec) { ring[total & (RING - 1)] = accSum / dec; total++; accSum = 0; accN = 0; } }
  tMap = t + 128 / sr; iMap = total;
  while (total - lastEnd >= HOP) { lastEnd += HOP; if (lastEnd >= N) analyse(lastEnd); }
}
const timeOf = (i) => tMap + (i - iMap) / dsr;
function analyse(end) {
  const start = end - N; let s = 0;
  for (let k = 0; k < N; k++) { const v = ring[(start + k) & (RING - 1)]; frameBuf[k] = v; s += v * v; }
  const db = 10 * Math.log10(s / N + 1e-12); lastDb = db;
  onFrame({ t: timeOf(end - N / 2), db, f: db > thrDb - 6 ? yin() : null });
}
function yin() {
  const x = frameBuf, d = diff; let run = 0; d[0] = 1;
  for (let tau = 1; tau <= TAUMAX; tau++) { let sum = 0; for (let j = 0; j < W; j++) { const q = x[j] - x[j + tau]; sum += q * q; } run += sum; d[tau] = run > 0 ? sum * tau / run : 1; }
  let tau = -1;
  for (let t = TAUMIN; t < TAUMAX; t++) if (d[t] < 0.15) { while (t + 1 < TAUMAX && d[t + 1] < d[t]) t++; tau = t; break; }
  if (tau < 0) { let mn = Infinity, mi = -1; for (let t = TAUMIN; t < TAUMAX; t++) if (d[t] < mn) { mn = d[t]; mi = t; } if (mn > 0.3 || mi < 1) return null; tau = mi; }
  const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
  return dsr / (tau + (den !== 0 ? clamp(0.5 * (a - c) / den, -1, 1) : 0));
}
function onFrame(fr) {
  setLastFrameAt(performance.now());
  if (calib) { calib.dbs.push(fr.db); if (fr.t >= calib.until) { const c = calib; calib = null; c.done(); } return; }
  const r = round;
  if (!r || r.state === 'done') { if (tester && tester.live) feedTester(fr); return; }
  if (fr.t < r.bleedEnd) { heard(r, fr); return; }         // the tone may still be reaching the mic
  if (fr.t < r.go) {
    const loud = fr.db > thrDb, hum = loud && !!fr.f;
    if (hum) r.peek++;
    r.quiet.push({ lv: clamp((fr.db + 80) / 60, 0, 1), kind: hum ? 'hum' : loud ? 'noise' : 'quiet' });
    return;
  }
  const voiced = fr.db > thrDb;
  if (r.state !== 'capture') {
    r.state = 'listen'; r.frames.push(fr);
    r.run = voiced ? r.run + 1 : 0;
    if (r.run >= 3) { const l3 = r.frames.slice(-3); if (l3.filter((x) => x.f).length >= 2) { r.onsetT = l3[0].t; r.state = 'capture'; r.lastVoiced = fr.t; return; } }
    if (fr.t > r.go + 6) finish('timeout');
    return;
  }
  r.frames.push(fr);
  if (voiced) r.lastVoiced = fr.t;
  const el = fr.t - r.onsetT;
  if (el >= 1.3 || (el > 0.25 && fr.t - r.lastVoiced > 0.25)) finish('ok');
}
// Can the mic hear the piano (speakers, not earphones)? Then the reference note mustn't ring on into the imagine
// step, where the mic listens for a voice: pitched frames at the note (in any octave) while it plays end it sooner,
// fading from just before the step changes, and the mic ignores a little longer for the fade to pass.
function heard(r, fr) {
  if (r.bleed || fr.t > r.T + TONE - 0.2 || fr.db <= thrDb || !fr.f) return;
  const c = 1200 * Math.log2(fr.f / hz(r.midi)), off = Math.abs(c - 1200 * Math.round(c / 1200));
  if (off < 80 && ++r.hears >= 5) { r.bleed = true; r.tone.damp(r.T + TONE - 0.1); r.bleedEnd += 0.15; }
}
export function calibrate() {
  setStage('calib'); setLastFrameAt(performance.now());
  return new Promise((res) => {
    const c = { until: ctx.currentTime + 0.9, dbs: [], res };
    c.done = () => {
      const s = c.dbs.filter((v) => v > -119).sort((a, b) => a - b);
      floorDb = s.length ? s[Math.floor(s.length * 0.7)] : -70;
      thrDb = Math.min(-30, Math.max(-58, floorDb + 15));
      res(true);
    };
    calib = c;
  });
}

// The audio the detector analysed (24 kHz or so): from 0.6 s before the onset to the end of the note,
// as 16-bit samples. t0 is the first sample's time relative to the onset, so it lines up with the pitch curve.
export function grabAudio(r) {
  if (!ring) return null;
  const end = total, start = Math.max(end - RING + 1, Math.round(iMap + (r.onsetT - 0.6 - tMap) * dsr), 0), n = end - start;
  if (n <= 0) return null;
  const pcm = new Int16Array(n);
  for (let k = 0; k < n; k++) pcm[k] = clamp(Math.round(ring[(start + k) & (RING - 1)] * 32767), -32768, 32767);
  return { sr: dsr, t0: +(tMap + (start - iMap) / dsr - r.onsetT).toFixed(4), pcm };
}
