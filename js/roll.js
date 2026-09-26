// The piano roll: one note's pitch curve drawn over the keys around it.

import { keyUnder, playable } from './keyboard.js';
import { off, sentence, tierFor } from './scoring.js';
import { clamp, hideTip, isBlack, motion, nname, pc, placeTip, WIN } from './util.js';

/* ---------- piano roll ---------- */
export function mountRoll(el, n, H) {
  el._n = n; el._H = H;
  drawRoll(el, true);
  if (el._wired) return; el._wired = true;
  playable(el, keyUnder(el, '.rkey'), (m, on) => { const k = el.querySelector(`.rkey[data-m="${m}"]`); if (k) k.classList.toggle('down', on); });
  const move = (e) => {
    const g = el._g; if (!g) return;
    const box = el.querySelector('svg').getBoundingClientRect(), x = (e.clientX - box.left) * (g.Wd / box.width);
    const t = (x - g.keyW) / (g.Wd - g.keyW - g.padR) * g.tMax;
    const tip = el.querySelector('.tip-pop'), xh = el.querySelector('.xh');
    if (t < 0 || t > g.tMax || !g.pts.length) { hideTip(tip); xh.setAttribute('visibility', 'hidden'); return; }
    let best = g.pts[0]; for (const p of g.pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const px = g.X(best.t), py = g.Y(best.c / 100);
    xh.setAttribute('visibility', 'visible');
    xh.querySelector('line').setAttribute('x1', px); xh.querySelector('line').setAttribute('x2', px);
    xh.querySelector('circle').setAttribute('cx', px); xh.querySelector('circle').setAttribute('cy', py);
    const near = Math.abs(best.c) >= 70 ? ` · near ${nname(el._n.midi + Math.round(best.c / 100))}` : '';
    tip.textContent = `${(best.t * 1000).toFixed(0)} ms · ${off(best.c)}${near}`;
    placeTip(tip, px * box.width / g.Wd, py * box.height / g.H - 10, box.width);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerdown', move);
  el.addEventListener('pointerleave', () => { hideTip(el.querySelector('.tip-pop')); const xh = el.querySelector('.xh'); if (xh) xh.setAttribute('visibility', 'hidden'); });
}
let rollSeq = 0;
export function drawRoll(el, replay) {
  const n = el._n, H = el._H, Wd = Math.max(260, el.clientWidth || 480), keyW = 46, padR = 6, axisH = 20, plotH = H - axisH;
  const pts = (n.trace || []).filter((p) => p.c != null && p.t >= 0 && p.t <= 1.35);
  const tMax = Math.max(1, Math.min(1.35, pts.length ? pts[pts.length - 1].t : 1));
  const cs = pts.map((p) => p.c / 100);
  const lo = clamp(Math.round(Math.min(0, ...cs)) - 1, -7, -2), hi = clamp(Math.round(Math.max(0, ...cs)) + 1, 2, 7);
  const rows = hi - lo + 1, rh = plotH / rows;
  const Y = (s) => (hi + 0.5 - clamp(s, lo - 0.5, hi + 0.5)) * rh;
  const X = (t) => keyW + (t / tMax) * (Wd - keyW - padR);
  let s = '';
  for (let j = hi; j >= lo; j--) {
    const m = n.midi + j, y = Y(j) - rh / 2, blk = isBlack(m);
    s += `<rect x="${keyW}" y="${y}" width="${Wd - keyW}" height="${rh}" fill="var(${blk ? '--roll-black' : '--roll-white'})"/>`;
    if (j === 0) s += `<rect x="${keyW}" y="${y}" width="${Wd - keyW}" height="${rh}" fill="var(--accent-wash)"/>`;
    if ((pc(m) === 0 || pc(m) === 5) && j > lo) s += `<line x1="${keyW}" x2="${Wd}" y1="${y + rh}" y2="${y + rh}" stroke="var(--roll-sep)"/>`;
    // key strip: white keys run the full width, black keys are shorter and sit at the back
    s += `<rect x="0" y="${y}" width="${keyW}" height="${rh}" fill="var(${j === 0 ? '--accent' : '--key-white'})"/>`;
    if (blk && j !== 0) s += `<path d="M0,${y + 1}h${keyW * 0.56 - 3}q3,0 3,3v${rh - 8}q0,3 -3,3h${-(keyW * 0.56 - 3)}z" fill="var(--key-black)"/>`;
    if (blk && j !== 0) s += `<line x1="${keyW * 0.56}" x2="${keyW}" y1="${y + rh / 2}" y2="${y + rh / 2}" stroke="var(--roll-sep)"/>`;
    if (!blk && (pc(m) === 0 || pc(m) === 5) && j > lo) s += `<line x1="0" x2="${keyW}" y1="${y + rh}" y2="${y + rh}" stroke="var(--roll-sep)"/>`;
    const showLabel = j === 0 || (!blk && (rh >= 15 || pc(m) === 0));
    if (showLabel) s += `<text x="${keyW - 6}" y="${y + rh / 2}" text-anchor="end" dominant-baseline="central" font-size="${clamp(rh * 0.62, 9, 12)}" font-weight="800" fill="var(${j === 0 ? '--accent-ink' : '--ink-2'})">${nname(m)}</text>`;
  }
  for (let j = hi; j >= lo; j--) s += `<rect class="rkey" data-m="${n.midi + j}" x="0" y="${Y(j) - rh / 2}" width="${keyW}" height="${rh}"><title>Play ${nname(n.midi + j)}</title></rect>`;
  s += `<line x1="${keyW}" x2="${keyW}" y1="0" y2="${plotH}" stroke="var(--line)"/>`;
  s += `<rect x="${X(0)}" y="0" width="${X(WIN) - X(0)}" height="${plotH}" fill="var(--ink)" opacity=".08"/>`;
  let d = '', prev = null;
  for (const p of pts) { d += `${prev && p.t - prev.t <= 0.04 ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.c / 100).toFixed(1)}`; prev = p; }
  const dur = replay ? motion('--t-data') : 0, wait = motion('--t-quick'), id = 'reveal' + (++rollSeq);
  s += `<clipPath id="${id}"><rect x="0" y="0" height="${H}" width="${dur ? X(0) : Wd}">${dur ? `<animate attributeName="width" from="${X(0)}" to="${Wd}" begin="${wait}ms" dur="${dur}ms" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"/>` : ''}</rect></clipPath>`;
  s += `<path clip-path="url(#${id})" d="${d}" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (n.onset != null) s += `<circle${dur ? ` class="sdot" style="animation-delay:${Math.round(wait + dur * 0.12)}ms"` : ''} cx="${X(WIN / 2)}" cy="${Y(n.onset / 100)}" r="6" fill="var(--tone,var(--ink))" stroke="var(--surface)" stroke-width="2" data-tone="${tierFor(n).tone}"/>`;
  s += `<text x="${X(0)}" y="${H - 5}" font-size="11.5" font-weight="700" fill="var(--muted)">↑ scored</text>`;
  s += `<text x="${X(1)}" y="${H - 5}" text-anchor="end" font-size="11.5" font-weight="700" fill="var(--muted)">1 second</text>`;
  s += `<g class="xh" visibility="hidden"><line y1="0" y2="${plotH}" stroke="var(--ink)" stroke-opacity=".35"/><circle r="5" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/></g>`;
  s += `<line class="playhead" visibility="hidden" y1="0" y2="${plotH}" stroke="var(--accent)" stroke-width="2.5"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" height="${H}" role="img" aria-label="Piano roll of your pitch over the note. ${sentence(n)}">${s}</svg><div class="tip-pop track"></div>`;
  el._g = { Wd, H, keyW, padR, tMax, X, Y, pts };
}
