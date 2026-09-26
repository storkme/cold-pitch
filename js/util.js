// Small helpers shared by every module: DOM lookup, note names and numbers, statistics, the round's constants,
// and the motion helpers that read their timings from CSS.

export const $ = (s) => document.querySelector(s);
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const pc = (m) => ((m % 12) + 12) % 12;
export const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const nname = (m) => NAMES[pc(m)] + (Math.floor(m / 12) - 1);
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(pc(m));
export const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
export const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r1 = (v) => v == null ? null : Math.round(v * 10) / 10;
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

export const ROUND_LEN = 15, WIN = 0.1, TONE = 1, HOLD = 1, PAUSE = 2800, MIN_NOTE = 36, MAX_NOTE = 84, MIN_SPAN = 2;

// Motion durations live in CSS (see the motion language at the top of the styles); read them from there.
// Under reduced motion they're all zero.
export const motion = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
export const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
// Tooltips are centred over the point, but kept inside their chart using their real width. The first time one
// shows it appears in place; after that it glides between snapped points (unless it tracks the pointer).
export function placeTip(tip, x, y, width) {
  const was = tip.classList.contains('on');
  if (!was) tip.style.transition = 'none';
  const half = tip.offsetWidth / 2;
  tip.style.left = clamp(x, half, Math.max(half, width - half)) + 'px'; tip.style.top = y + 'px';
  if (!was) { void tip.offsetWidth; tip.style.transition = ''; }
  tip.classList.add('on');
}
export const hideTip = (tip) => { if (tip) tip.classList.remove('on'); };

// A thumb behind the chosen item of a group, gliding between items (the glide pattern). It's placed without
// sliding the first time, or when `jump` is set.
export function slideThumb(group, sel = '[aria-pressed="true"]', jump = false) {
  const th = group.querySelector('.thumb'), on = group.querySelector(sel);
  if (!th || !on) return;
  const still = jump || !th.style.width;
  if (still) th.style.transition = 'none';
  th.style.width = on.offsetWidth + 'px'; th.style.transform = `translateX(${on.offsetLeft}px)`;
  if (still) { void th.offsetWidth; th.style.transition = ''; }
}
