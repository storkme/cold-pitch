// Every note on one chart: each note's pitch over time, measured from the note it was aiming for, so the shape of
// your singing shows at a glance: how far the starts were off, which way they slid, where they settled. Time runs
// from your first sound; up is sharp and down is flat, in semitones, with the note itself the bright line across the
// middle. The Start and Landing windows are shaded.
// - The summary shows one round's notes. Tapping a line selects that note (the summary shows it below); tapping it
//   again, or the empty chart, clears that.
// - The home screen shows every note of your recent rounds, older rounds fading, with one round's notes bright
//   (your latest, or the one you point at on the progress chart or tap here).

import { tierFor } from './scoring.js?v=b3d99147c5';
import { clamp, median, motion, nname, WIN } from './util.js?v=b3d99147c5';

const R = 3;            // semitones either side of the note; curves beyond it leave the chart
const SETTLE = 0.45;    // s: where Landing is read from (see pitch.js)
const REACH = 24;       // px: how near a tap has to be to a line to pick it

// A note's curve without its glitches: a point far from its neighbours (a frame read an octave out) is dropped.
function clean(trace) {
  const pts = (trace || []).filter((p) => p.c != null && p.t >= 0 && p.t <= 1.35);
  return pts.filter((p, i) => Math.abs(p.c - median(pts.slice(Math.max(0, i - 3), i + 4).map((q) => q.c))) < 300);
}

let seq = 0;
// `notes` (curves unpacked); `sel`: what's selected, or null. `replay` draws the curves in, left to right. On the home
// screen, `group(n)` gives each note's round and `fade(n)` its line's strength, and a selection is a whole round.
// `plotH`: the plot's height in px (the sheet after each note draws its one note smaller).
export function drawOverlay(el, notes, { sel = null, replay = false, group = null, fade = null, plotH = 200 } = {}) {
  const Wd = Math.max(260, el.clientWidth || 480), top = 20, axisH = 22, padL = 30, padR = 10, H = top + plotH + axisH;
  const lines = notes.map((n, i) => ({ n, i, g: group ? group(n) : i, pts: n.kind === 'ok' ? clean(n.trace) : [] })).filter((l) => l.pts.length > 1);
  const tMax = clamp(Math.max(1, ...lines.map((l) => l.pts[l.pts.length - 1].t)), 1, 1.35);
  const X = (t) => padL + t / tMax * (Wd - padL - padR);
  const Y = (c) => top + (R - clamp(c / 100, -R - 2, R + 2)) / (2 * R) * plotH;
  let s = `<rect x="${X(0)}" y="${top}" width="${X(WIN) - X(0)}" height="${plotH}" fill="var(--ink)" opacity=".09"/>`
    + `<rect x="${X(SETTLE)}" y="${top}" width="${X(tMax) - X(SETTLE)}" height="${plotH}" fill="var(--ink)" opacity=".035"/>`
    + `<text x="${X(0)}" y="${top - 7}" class="lbl">Start</text><text x="${X(SETTLE)}" y="${top - 7}" class="lbl">Landing</text>`;
  for (let k = -R; k <= R; k++) {
    s += `<line x1="${padL}" x2="${Wd - padR}" y1="${Y(k * 100)}" y2="${Y(k * 100)}" class="${k ? 'grid' : 'zero'}"/>`
      + `<text x="${padL - 7}" y="${Y(k * 100)}" text-anchor="end" dominant-baseline="central" class="tick">${k > 0 ? '+' + k : k < 0 ? '−' + -k : '0'}</text>`;
  }
  for (const [t, label] of [[0, '0'], [0.5, '0.5'], [1, '1 s']]) s += `<text x="${X(t)}" y="${H - 6}" text-anchor="${t ? 'middle' : 'start'}" class="tick">${label}</text>`;
  // the curves, revealed left to right within the plot
  const dur = replay ? motion('--t-data') : 0, wait = motion('--t-quick'), id = 'ov' + (++seq);
  s += `<clipPath id="${id}"><rect x="${X(0) - 6}" y="${top}" height="${plotH}" width="${dur ? 0 : Wd}">${dur ? `<animate attributeName="width" from="0" to="${Wd}" begin="${wait}ms" dur="${dur}ms" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"/>` : ''}</rect></clipPath><g clip-path="url(#${id})">`;
  for (const l of lines) {
    let d = '', prev = null;
    for (const p of l.pts) { d += `${prev && p.t - prev.t <= 0.04 ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.c).toFixed(1)}`; prev = p; }
    s += `<path class="ln" data-g="${l.g}"${fade ? ` style="--o:${fade(l.n).toFixed(2)}"` : ''} d="${d}"/>`;
  }
  s += '</g>';
  // each note's Start, in its verdict's colour; one past the edge of the chart is an arrow at the edge
  for (const l of lines) {
    const c = l.n.onset, x = X(WIN / 2), tone = tierFor(l.n).tone, del = dur ? ` style="animation-delay:${Math.round(wait + dur * 0.12)}ms"` : '';
    if (Math.abs(c) <= R * 100) s += `<circle class="sd${dur ? ' sdot' : ''}" data-g="${l.g}" data-tone="${tone}"${del} cx="${x}" cy="${Y(c)}" r="4"/>`;
    else { const y = c > 0 ? top + 1 : top + plotH - 1, dy = c > 0 ? 7 : -7; s += `<path class="sd${dur ? ' sdot' : ''}" data-g="${l.g}" data-tone="${tone}"${del} d="M${x},${y}l5,${dy}h-10z"/>`; }
  }
  s += `<text class="nm" text-anchor="end"></text>`;
  s += `<line class="playhead" visibility="hidden" y1="${top}" y2="${top + plotH}" stroke="var(--accent)" stroke-width="2"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" height="${H}" role="img" aria-label="Every note's pitch over its first second, in semitones sharp or flat of the note it was aiming for">${s}</svg>`;
  el._g = { Wd, X, Y, tMax, lines, named: !group };
  markOverlay(el, sel);
  if (!el._wired) {
    el._wired = true;
    el.addEventListener('click', (e) => {
      const g = el._g, box = el.querySelector('svg').getBoundingClientRect(), k = g.Wd / box.width;
      const x = (e.clientX - box.left) * k, y = (e.clientY - box.top) * k;
      let best = null, bd = REACH * k;
      for (const l of g.lines) for (const p of l.pts) { const dd = Math.hypot(g.X(p.t) - x, g.Y(p.c) - y); if (dd < bd) { bd = dd; best = l.g; } }
      if (el._pick) el._pick(best === el._sel ? null : best);
    });
  }
}
// Show what's selected: its lines bright and on top, the others faded, and on the summary the note's name at the end
// of its line.
export function markOverlay(el, sel) {
  el._sel = sel;
  const svg = el.querySelector('svg'), g = el._g; if (!svg) return;
  svg.classList.toggle('has-sel', sel != null);
  for (const e of svg.querySelectorAll('[data-g]')) e.classList.toggle('sel', +e.dataset.g === sel);
  for (const line of svg.querySelectorAll(`.ln[data-g="${sel}"]`)) line.parentNode.appendChild(line);
  const l = g.named && g.lines.find((q) => q.g === sel), nm = svg.querySelector('.nm');
  if (!l) { nm.textContent = ''; return; }
  const p = l.pts[l.pts.length - 1];
  nm.textContent = nname(l.n.midi);
  nm.setAttribute('x', g.X(p.t) - 4); nm.setAttribute('y', clamp(g.Y(p.c) - 8, 12, g.Y(-R * 100) - 4));
}
