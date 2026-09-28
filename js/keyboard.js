// The summary's range map, and making the keys of any drawn keyboard playable.

import { noteOff, noteOn } from './audio/piano.js?v=3948b70b10';
import { isBlack, MAX_NOTE, MIN_NOTE, nname, pc } from './util.js?v=3948b70b10';

/* ---------- the range map ---------- */
const rb = (x, y, w, h, r) => `M${x},${y}h${w}v${h - r}q0,${r} ${-r},${r}h${-(w - 2 * r)}q${-r},0 ${-r},${-r}z`;
// The summary's range map: a slim keyboard in the range card's style (the round's notes in ivory, the rest dimmed),
// with each sung note's result in a lane above its key. Black keys' results sit a lane higher, as the keys do, so
// neighbours never collide. It shows the whole C2-C6 keyboard where the keys can stay wide enough for the results,
// otherwise the round's notes and as much either side as fits.
// `results`: [{ m, tone, icon, dir }] (dir: -1 flat, 1 sharp, 0 on the note). Returns each key's geometry by note.
const MIN_KEY = 26;       // px: the narrowest a white key gets, so a result still fits above it
export function rangeMap(el, lo, hi, results, aria) {
  const Wd = Math.max(240, el.clientWidth || 480), white = (m) => !isBlack(m);
  let a = isBlack(lo) ? lo - 1 : lo, b = isBlack(hi) ? hi + 1 : hi;
  const count = (x, y) => { let n = 0; for (let m = x; m <= y; m++) if (white(m)) n++; return n; };
  const fit = Math.max(count(a, b), Math.floor(Wd / MIN_KEY));
  for (let left = true; count(a, b) < fit && (a > MIN_NOTE || b < MAX_NOTE); left = !left) {
    if (left && a > MIN_NOTE) { a--; if (!white(a)) a--; } else if (!left && b < MAX_NOTE) { b++; if (!white(b)) b++; }
  }
  const whites = []; for (let m = a; m <= b; m++) if (white(m)) whites.push(m);
  const kw = Wd / whites.length, bw = kw * 0.62, r = Math.max(5, Math.min(10, kw * 0.36)), ar = 9;
  const yB = ar + 3 + r, yW = yB + 2 * r + ar + 6, top = yW + r + 8, KH = 40, BH = Math.round(KH * 0.6), labH = 20;
  const geo = new Map(), inR = (m) => m >= lo && m <= hi;
  whites.forEach((m, i) => geo.set(m, { x: i * kw + kw / 2, x0: i * kw, w: kw, white: true }));
  for (let m = a; m <= b; m++) if (!white(m)) { const x = (whites.indexOf(m - 1) + 1) * kw; geo.set(m, { x, x0: x - bw / 2, w: bw, white: false }); }
  let s = `<rect x="0" y="${top}" width="${Wd}" height="${KH}" rx="2" fill="var(--key-bed)"/>`;
  for (const m of whites) { const k = geo.get(m); s += `<path data-k="${m}" class="wkey${inR(m) ? ' in' : ''}" d="${rb(k.x0 + 0.5, top, kw - 1, KH, 2)}"/>`; }
  for (const [m, k] of geo) if (!k.white) s += `<path data-k="${m}" class="bkey${inR(m) ? ' in' : ''}" d="${rb(k.x0, top, bw, BH, 2)}"/>`;
  for (const m of whites) if (m === lo || m === hi || pc(m) === 0) s += `<text x="${geo.get(m).x}" y="${top + KH + 15}" text-anchor="middle" font-size="12" class="${m === lo || m === hi ? 'end' : 'oct'}">${nname(m)}</text>`;
  results.forEach(({ m, tone, icon, dir }, i) => {
    const k = geo.get(m); if (!k) return;
    const y = k.white ? yW : yB;
    s += `<g class="mk" data-m="${m}" style="--i:${i}" data-tone="${tone}"><line x1="${k.x}" y1="${y + r}" x2="${k.x}" y2="${top}" class="stem"/>`
      + `<circle cx="${k.x}" cy="${y}" r="${r}" fill="var(--tone)"/><circle cx="${k.x}" cy="${y}" r="${r + 3}" class="ring"/>`
      + (r >= 8 ? `<text x="${k.x}" y="${y + 0.5}" text-anchor="middle" dominant-baseline="central" font-size="${r * 1.05}" font-weight="800" fill="var(--tone-ink)">${icon}</text>` : '')
      + (dir ? `<text x="${k.x}" y="${y - r - 3}" text-anchor="middle" font-size="${ar}" class="dir">${dir < 0 ? '▼' : '▲'}</text>` : '') + '</g>';
  });
  // hit areas: each key's whole column, lanes included; black keys last, so they win where they overlap
  for (const [m, k] of geo) if (k.white) s += `<rect class="hit" data-m="${m}" x="${k.x0}" y="0" width="${k.w}" height="${top + KH}"/>`;
  for (const [m, k] of geo) if (!k.white) s += `<rect class="hit" data-m="${m}" x="${k.x0}" y="0" width="${k.w}" height="${top + BH}"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${Wd} ${top + KH + labH}" width="${Wd}" height="${top + KH + labH}" role="img" aria-label="${aria}">${s}</svg>`;
  return geo;
}

// Make the keys of a drawn keyboard playable: press to play and hold, slide onto another key to play that one.
// `keyAt(x, y)` returns the key element (with data-m) under a point in this container; `mark(m, on)` shows it pressed.
export function playable(container, keyAt, mark) {
  container.addEventListener('pointerdown', (e) => {
    const k = e.button === 0 && keyAt(e.clientX, e.clientY); if (!k) return;
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
