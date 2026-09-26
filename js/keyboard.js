// Drawn keyboards (the summary's range map), and making the keys of any drawn keyboard playable.

import { noteOff, noteOn } from './audio/piano.js?v=f771651970';
import { pauseRound } from './round.js?v=f771651970';
import { run } from './state.js?v=f771651970';
import { $, isBlack, nname } from './util.js?v=f771651970';

/* ---------- keyboard drawing (the summary's range map) ---------- */
const rb = (x, y, w, h, r) => `M${x},${y}h${w}v${h - r}q0,${r} ${-r},${r}h${-(w - 2 * r)}q${-r},0 ${-r},${-r}z`;
export function keyboard(el, a, b, o) {
  const Wd = Math.max(240, el.clientWidth || 480);
  if (isBlack(a)) a--; if (isBlack(b)) b++;
  const whites = []; for (let m = a; m <= b; m++) if (!isBlack(m)) whites.push(m);
  const kw = Wd / whites.length, H = o.H, bh = Math.round(H * 0.62), bw = kw * 0.6, labH = 22;
  const geo = new Map();
  let s = `<rect x="0" y="0" width="${Wd}" height="${H}" rx="2" fill="var(--key-bed)"/>`;
  whites.forEach((m, i) => {
    const x = i * kw; geo.set(m, { x: x + kw / 2, y: H - Math.min(22, kw * 0.55), x0: x, w: kw, h: H, white: true });
    s += `<path data-k="${m}" class="wkey" d="${rb(x + 1, 0, kw - 2, H - 1, 2)}" fill="${o.fill(m) || 'var(--key-white)'}"/>`;
  });
  for (let m = a; m <= b; m++) if (isBlack(m)) {
    const x = whites.indexOf(m - 1) * kw + kw - bw / 2; geo.set(m, { x: x + bw / 2, y: bh - Math.min(16, bw * 0.8), x0: x, w: bw, h: bh, white: false });
    s += `<path data-k="${m}" class="bkey" d="${rb(x, 0, bw, bh, 2)}" fill="${o.fill(m) || 'var(--key-black)'}"/>`;
  }
  for (const m of whites) if (o.label(m)) s += `<text x="${geo.get(m).x}" y="${H + 16}" text-anchor="middle" font-size="12" font-weight="${o.label(m) === 'bold' ? 800 : 700}" fill="var(${o.label(m) === 'bold' ? '--ink' : '--muted'})">${nname(m)}</text>`;
  if (o.marks) s += o.marks(geo, kw);
  el.innerHTML = `<svg viewBox="0 -2 ${Wd} ${H + labH}" width="${Wd}" height="${H + labH}" role="img" aria-label="${o.aria}">${s}</svg>`;
  return geo;
}

// Make the keys of a drawn keyboard playable: press to play and hold, slide onto another key to play that one.
// `keyAt(x, y)` returns the key element (with data-m) under a point in this container; `mark(m, on)` shows it pressed.
// During a round, playing pauses it first, so the sound can't land in the next note's silent hold.
export function playable(container, keyAt, mark) {
  container.addEventListener('pointerdown', (e) => {
    const k = e.button === 0 && keyAt(e.clientX, e.clientY); if (!k) return;
    if (run && !run.paused) { if ($('#sheet').hidden) return; pauseRound(); }
    e.preventDefault(); try { container.setPointerCapture(e.pointerId); } catch (err) {}
    let m = +k.dataset.m; noteOn(e.pointerId, m, e.pressure); mark(m, true);
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const k2 = keyAt(ev.clientX, ev.clientY);
      if (k2 && +k2.dataset.m !== m) { mark(m, false); m = +k2.dataset.m; noteOn(ev.pointerId, m, ev.pressure); mark(m, true); }
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      noteOff(ev.pointerId); mark(m, false);
      for (const [t, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) container.removeEventListener(t, f);
    };
    for (const [t, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) container.addEventListener(t, f);
  });
}
export const keyUnder = (container, sel) => (x, y) => { const el = document.elementFromPoint(x, y), k = el && el.closest && el.closest(sel); return k && container.contains(k) ? k : null; };
