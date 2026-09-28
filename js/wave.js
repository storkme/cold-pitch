// The live waveform: what the mic hears over the last couple of seconds, as mirrored bars scrolling right to left,
// one per mic frame (about every 10 ms), newest at the right. A voice (a clearly pitched sound, see pitch.js) is
// bright; other sound is faint; anything at the room's level lies on the baseline, so a quiet room still shows the
// mic is live without looking busy. It's on the stage while the mic listens (the imagine step and singing) and in
// the mic tester on the home screen. Colours come from CSS: --ink, --muted, --line and --crit.

import { floorDb, heardAt, heardFrames } from './audio/mic.js?v=3948b70b10';
import { clamp } from './util.js?v=3948b70b10';

const SPAN = 2.4;       // seconds across the strip
const RANGE = 30;       // dB above the room for a full-height bar
const COL = 3;          // px from one bar to the next

// Times are the mic's (the audio context's clock). `from`: nothing earlier is drawn (on the stage, the piano).
// `zone`: [start, end), the imagine step: its baseline is dotted, and a voice in it shows in the warning colour.
// `mark`: a time for a short hairline across the strip (the Sing cue).
export function drawWave(cv, { from = -Infinity, zone = null, mark = null } = {}) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv._col = null; }
  if (!cv._col) {
    const cs = getComputedStyle(cv), v = (n) => cs.getPropertyValue(n).trim();
    cv._col = { voice: v('--ink'), noise: v('--muted'), line: v('--line'), hot: v('--crit') };
  }
  const col = cv._col, g = cv.getContext('2d'), fr = heardFrames;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  // frames arrive in small bursts; carry the clock on from the newest one so the strip scrolls smoothly
  const now = (fr.length ? fr[fr.length - 1].t : 0) + clamp((performance.now() - heardAt) / 1000, 0, 0.05);
  const X = (t) => w - (now - t) / SPAN * w, mid = h / 2;
  const za = zone ? clamp(X(zone[0]), 0, w) : 0, zb = zone ? clamp(X(zone[1]), 0, w) : 0;
  g.fillStyle = col.line; g.fillRect(0, mid - 0.5, za, 1); g.fillRect(zb, mid - 0.5, w - zb, 1);
  g.fillStyle = col.noise; for (let x = za; x < zb; x += 4) g.fillRect(x, mid - 0.5, 1.5, 1);
  if (mark != null && X(mark) >= 0 && X(mark) <= w) g.fillRect(Math.round(X(mark)) - 0.5, h * 0.2, 1, h * 0.6);
  // bars 2 px wide every 3 px, each the loudest of the frames in its slot of time, so they scroll with the sound
  const G = SPAN * COL / w, bars = new Map();
  for (const f of fr) {
    if (f.t < from || X(f.t) < -COL || X(f.t) > w) continue;
    const k = Math.floor(f.t / G), lv = clamp((f.db - floorDb - 3) / RANGE, 0, 1), b = bars.get(k);
    const hot = f.voice && !!zone && f.t >= zone[0] && f.t < zone[1];
    if (!b) bars.set(k, { lv, voice: f.voice, hot });
    else { b.lv = Math.max(b.lv, lv); b.voice ||= f.voice; b.hot ||= hot; }
  }
  for (const [k, b] of bars) {
    if (!b.voice && !b.lv) continue;
    const bh = b.voice ? Math.max(0.22, b.lv) * (h - 2) : Math.max(2, b.lv * (h - 2));
    g.fillStyle = b.hot ? col.hot : b.voice ? col.voice : col.noise;
    g.globalAlpha = b.voice ? 1 : 0.45;
    g.fillRect(X(k * G), mid - bh / 2, COL - 1, bh);
  }
  g.globalAlpha = 1;
}
