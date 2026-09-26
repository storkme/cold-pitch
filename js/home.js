// The home screen: the range picker, the mic tester, and progress across rounds.

import { calibrate, ctx, initAudio, lastVoice, micAlive, stopAudio, thrDb } from './audio/mic.js?v=17222eed60';
import { blip, pianoReady } from './audio/piano.js?v=17222eed60';
import { failStart } from './round.js?v=17222eed60';
import { dataLine, DEFAULT_HI, DEFAULT_LO, rounds, saveSettings, settings } from './storage.js?v=17222eed60';
import { openRound } from './summary.js?v=17222eed60';
import { $, clamp, hideTip, isBlack, MAX_NOTE, mean, median, MIN_NOTE, MIN_SPAN, nname, pc, placeTip } from './util.js?v=17222eed60';

export function renderRange() {
  paintPicker();
  $('#keepAudio').checked = !!settings.keepAudio;
  renderHistory();
}
export const bestScore = () => rounds.length ? Math.max(...rounds.map((r) => r.score)) : null;

/* ---------- range picker: the keyboard with two handles under it ---------- */
// Every key from C2 to C6 is drawn once; handles snap to key centres. Key centres run left to right in pitch
// order (a black key sits between its neighbours), so the nearest centre to the pointer is the note.
const PK = { x: new Map(), el: new Map() };
export function buildPicker() {
  const whites = []; for (let m = MIN_NOTE; m <= MAX_NOTE; m++) if (!isBlack(m)) whites.push(m);
  const kw = 1 / whites.length; let keys = '', oct = '';
  whites.forEach((m, i) => {
    PK.x.set(m, (i + 0.5) * kw); keys += `<i class="wk" data-m="${m}"></i>`;
    if (pc(m) === 0) oct += `<span style="left:${((i + 0.5) * kw * 100).toFixed(3)}%">${nname(m)}</span>`;
  });
  for (let m = MIN_NOTE; m <= MAX_NOTE; m++) if (isBlack(m)) {
    const x = (whites.indexOf(m - 1) + 1) * kw; PK.x.set(m, x);
    keys += `<i class="bk" data-m="${m}" style="left:${((x - kw * 0.31) * 100).toFixed(3)}%;width:${(kw * 62).toFixed(3)}%"></i>`;
  }
  $('#pkeys').innerHTML = keys; $('#poct').innerHTML = oct;
  for (const el of $('#pkeys').children) PK.el.set(+el.dataset.m, el);
}
const keyAt = (fx) => { let best = MIN_NOTE, d = Infinity; for (const [m, x] of PK.x) { const dd = Math.abs(x - fx); if (dd < d) { d = dd; best = m; } } return best; };
function paintPicker() {
  const { lo, hi } = settings, xl = PK.x.get(lo) * 100, xh = PK.x.get(hi) * 100;
  for (const [m, el] of PK.el) el.classList.toggle('in', m >= lo && m <= hi);
  $('#knobLo').style.left = xl + '%'; $('#knobHi').style.left = xh + '%';
  $('#pfill').style.left = xl + '%'; $('#pfill').style.width = (xh - xl) + '%';
  for (const [id, m] of [['#knobLo', lo], ['#knobHi', hi]]) { $(id).setAttribute('aria-valuenow', m); $(id).setAttribute('aria-valuetext', nname(m)); }
  const name = `${nname(lo)} – ${nname(hi)}`;
  if ($('#rangeName').textContent !== name) {
    $('#rangeName').textContent = name;
    const rv = $('#rangeVal'); rv.classList.remove('tick'); void rv.offsetWidth; rv.classList.add('tick');
  }
  $('#rangeCount').textContent = `${hi - lo + 1} notes`;
  $('#resetRange').disabled = lo === DEFAULT_LO && hi === DEFAULT_HI;   // only there once you've moved away from the default
}
function showBubble(m, label, text) {
  const b = $('#bubble'), W = $('#pkeys').clientWidth;
  b.querySelector('b').textContent = text || nname(m); b.querySelector('small').textContent = label;
  const x = PK.x.get(m) * W, w = b.offsetWidth, bx = clamp(x, w / 2, W - w / 2);   // keep it on the card, arrow still on the key
  b.style.left = bx + 'px'; b.style.setProperty('--ax', (x - bx + w / 2) + 'px');
}
let hotKey = null;
function press(m) { if (hotKey) hotKey.classList.remove('hot'); hotKey = m == null ? null : PK.el.get(m); if (hotKey) hotKey.classList.add('hot'); }

$('#resetRange').addEventListener('click', () => {
  settings.lo = DEFAULT_LO; settings.hi = DEFAULT_HI; paintPicker(); saveSettings();
  const pk = $('#picker'); showBubble(Math.round((DEFAULT_LO + DEFAULT_HI) / 2), 'Range', `${nname(DEFAULT_LO)} – ${nname(DEFAULT_HI)}`);
  pk.classList.add('peek'); clearTimeout(pk._peek); pk._peek = setTimeout(() => pk.classList.remove('peek'), 1000);
  $('#knobLo').focus({ preventScroll: true });     // the button disappears, so don't leave focus on nothing
});
let drag = null;
const pickFrac = (e) => { const r = $('#pkeys').getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
function dragTo(fx) {
  const m = keyAt(fx); let { lo, hi } = settings;
  if (drag.which === 'lo') lo = clamp(m, MIN_NOTE, hi - MIN_SPAN);
  else if (drag.which === 'hi') hi = clamp(m, lo + MIN_SPAN, MAX_NOTE);
  else { lo = clamp(m - drag.grab, MIN_NOTE, MAX_NOTE - drag.span); hi = lo + drag.span; }
  if (lo !== settings.lo || hi !== settings.hi) { settings.lo = lo; settings.hi = hi; paintPicker(); }
  const note = drag.which === 'hi' ? hi : lo;
  if (drag.which === 'both') { showBubble(Math.round((lo + hi) / 2), 'Range', `${nname(lo)} – ${nname(hi)}`); press(null); }
  else { showBubble(note, drag.which === 'lo' ? 'Lowest' : 'Highest'); press(note); }
  if (note !== drag.note) {
    if (drag.note != null && navigator.vibrate) { try { navigator.vibrate(4); } catch (e) {} }
    if (drag.which !== 'both') blip(note);
    drag.note = note;
  }
}
$('#picker').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag) return;
  const fx = pickFrac(e), { lo, hi } = settings, knob = e.target.closest('.knob');
  let which;
  if (knob) which = knob.id === 'knobLo' ? 'lo' : 'hi';
  else if (e.target.closest('#pfill')) which = 'both';                  // grab the bar: move the whole range
  else which = Math.abs(fx - PK.x.get(lo)) <= Math.abs(fx - PK.x.get(hi)) ? 'lo' : 'hi';   // tap a key: the nearer handle jumps there
  drag = { which, id: e.pointerId, span: hi - lo, grab: keyAt(fx) - lo, note: null };
  const pk = $('#picker'); pk.setPointerCapture(e.pointerId); pk.classList.add('dragging');
  $('#knobLo').classList.toggle('active', which !== 'hi'); $('#knobHi').classList.toggle('active', which !== 'lo');
  e.preventDefault();
  dragTo(fx);
});
$('#picker').addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) dragTo(pickFrac(e)); });
const dragEnd = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null; press(null); saveSettings();
  $('#picker').classList.remove('dragging');
  for (const k of document.querySelectorAll('.knob')) k.classList.remove('active');
};
$('#picker').addEventListener('pointerup', dragEnd);
$('#picker').addEventListener('pointercancel', dragEnd);
for (const [id, which] of [['#knobLo', 'lo'], ['#knobHi', 'hi']]) $(id).addEventListener('keydown', (e) => {
  const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12 }[e.key];
  let v = settings[which];
  if (step) v += step; else if (e.key === 'Home') v = MIN_NOTE; else if (e.key === 'End') v = MAX_NOTE; else return;
  e.preventDefault();
  v = which === 'lo' ? clamp(v, MIN_NOTE, settings.hi - MIN_SPAN) : clamp(v, settings.lo + MIN_SPAN, MAX_NOTE);
  if (v === settings[which]) return;
  settings[which] = v; paintPicker(); saveSettings(); blip(v);
  const pk = $('#picker'); showBubble(v, which === 'lo' ? 'Lowest' : 'Highest');
  pk.classList.add('peek'); clearTimeout(pk._peek); pk._peek = setTimeout(() => pk.classList.remove('peek'), 900);
});

// The mic tester: opens the mic and measures the room before a round (the round then reuses both), and shows a
// scrolling waveform of the last couple of seconds. A voice (clearly pitched) is bright with the note it hears;
// background noise stays faint.
export let tester = null;
export async function testMic() {
  if (tester) return;
  $('#homeErr').hidden = true;
  const btn = $('#micTestBtn'); btn.disabled = true;
  tester = { frames: [], live: false };
  $('#mtLive').hidden = false; $('#mtLabel').textContent = 'Measuring the room…'; btn.hidden = true;
  if (!(ctx && micAlive())) {
    stopAudio();
    try { await initAudio(); } catch (e) { stopAudio(); btn.disabled = false; btn.hidden = false; failStart(e); return; }
    pianoReady(ctx);
  }
  btn.disabled = false;
  if (!tester || !(await calibrate())) return;
  tester.live = true; $('#mtLabel').textContent = 'Sing or hum to check.';
}
export function stopTester() { tester = null; $('#mtLive').hidden = true; $('#micTestBtn').hidden = false; }
export function feedTester(fr) {
  const voice = lastVoice, loud = fr.db > thrDb;
  tester.frames.push({ lv: clamp((fr.db + 80) / 60, 0, 1), kind: voice ? 'voice' : loud ? 'noise' : 'quiet', f: voice ? fr.f : null });
  if (tester.frames.length > 200) tester.frames.shift();
}
export function drawTester() {
  const cv = $('#mtWave'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const cs = getComputedStyle(document.documentElement), col = { voice: cs.getPropertyValue('--ink').trim(), noise: cs.getPropertyValue('--muted').trim(), quiet: cs.getPropertyValue('--line').trim() };
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const slots = 200, bw = w / slots, fr = tester.frames, off = slots - fr.length;
  g.fillStyle = col.quiet; g.fillRect(0, h / 2 - 0.5, w, 1);
  fr.forEach((q, i) => {
    const bh = q.kind === 'quiet' ? 1 : Math.max(2, q.lv * (h - 2));
    g.fillStyle = col[q.kind]; g.globalAlpha = q.kind === 'noise' ? 0.5 : 1;
    g.fillRect((off + i) * bw, (h - bh) / 2, Math.max(1, bw - 0.5), bh);
  });
  g.globalAlpha = 1;
  const recent = fr.slice(-30), voiced = recent.filter((q) => q.kind === 'voice');
  let label = 'Sing or hum to check.';
  if (voiced.length >= 12) {
    const f = median(voiced.map((q) => q.f)), m = Math.round(69 + 12 * Math.log2(f / 440));
    label = `Hearing you · ${nname(m)}`;
  } else if (recent.filter((q) => q.kind === 'noise').length >= 12) label = 'Background noise';
  if ($('#mtLabel').textContent !== label) $('#mtLabel').textContent = label;
}

/* ---------- progress across rounds ---------- */
export const fmtDay = (ts) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtWhen = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function renderHistory() {
  const el = $('#histChart'), n = rounds.length;
  $('#histMeta').textContent = n ? `${n} round${n === 1 ? '' : 's'}` : '';
  $('#histLegend').hidden = $('#histTbl').hidden = !n;
  // nothing saved yet: no card at all, just one faded line (with Import, to bring rounds over from another device)
  $('#histCard').hidden = !n; $('#histEmpty').hidden = !!n;
  if (!n) { el.innerHTML = ''; el._g = null; $('#histTrend').hidden = true; return; }
  const Wd = Math.max(260, el.clientWidth || 480), H = 170, padL = 40, padR = 12, padT = 12, padB = 24;
  const X = (i) => n === 1 ? (padL + Wd - padR) / 2 : padL + 8 + i / (n - 1) * (Wd - padL - padR - 16);
  const Y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  let s = '';
  for (const v of [0, 50, 100]) s += `<line x1="${padL}" x2="${Wd - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${padL - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="central" font-size="11" font-weight="700" fill="var(--muted)">${v}%</text>`;
  const fresh = el._count !== n; el._count = n;       // replay only when the rounds changed, not on every redraw
  for (const [k, col] of [['landing', 'var(--ink-2)'], ['score', 'var(--accent)']]) {   // start drawn last, on top
    let d = '';
    rounds.forEach((r, i) => { if (r[k] != null) d += `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r[k]).toFixed(1)}`; });
    s += `<path${fresh ? ' class="draw" pathLength="1"' : ''} d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    rounds.forEach((r, i) => { if (r[k] != null && (n <= 40 || i === n - 1)) s += `<circle${fresh ? ` class="dot-in" style="--i:${Math.min(i, 40)}"` : ''} cx="${X(i)}" cy="${Y(r[k])}" r="4" fill="${col}" stroke="var(--surface)" stroke-width="2"/>`; });
  }
  s += `<text x="${X(0)}" y="${H - 6}" font-size="11" font-weight="700" fill="var(--muted)" text-anchor="${n === 1 ? 'middle' : 'start'}">${fmtDay(rounds[0].ts)}</text>`;
  if (n > 1) s += `<text x="${X(n - 1)}" y="${H - 6}" font-size="11" font-weight="700" fill="var(--muted)" text-anchor="end">${fmtDay(rounds[n - 1].ts)}</text>`;
  s += `<g class="xh xh-glide" visibility="hidden"><line x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="var(--ink)" stroke-opacity=".3"/></g>`;
  el.innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" height="${H}" role="img" aria-label="Start and landing score for each round">${s}</svg><div class="tip-pop"></div>`;
  el._g = { Wd, H, X, Y, n };
  if (!el._wired) {
    el._wired = true;
    const move = (e) => {
      const g = el._g; if (!g) return;
      const svg = el.querySelector('svg'), box = svg.getBoundingClientRect(), x = (e.clientX - box.left) * g.Wd / box.width;
      let i = 0; for (let j = 0; j < g.n; j++) if (Math.abs(g.X(j) - x) < Math.abs(g.X(i) - x)) i = j;
      const r = rounds[i], tip = el.querySelector('.tip-pop'), xh = el.querySelector('.xh');
      const showing = xh.getAttribute('visibility') === 'visible';
      if (!showing) xh.style.transition = 'none';
      xh.style.transform = `translateX(${g.X(i)}px)`; xh.setAttribute('visibility', 'visible');
      if (!showing) { void xh.getBoundingClientRect(); xh.style.transition = ''; }
      tip.textContent = `${fmtWhen(r.ts)} · start ${r.score}% · landing ${r.landing == null ? '—' : r.landing + '%'}`;
      placeTip(tip, g.X(i) * box.width / g.Wd, g.Y(Math.max(r.score, r.landing ?? 0)) * box.height / g.H - 12, box.width);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', () => { hideTip(el.querySelector('.tip-pop')); const xh = el.querySelector('.xh'); if (xh) xh.setAttribute('visibility', 'hidden'); });
  }
  if (n >= 6) {
    const k = Math.min(5, Math.floor(n / 2)), a = rounds.slice(-2 * k, -k), b = rounds.slice(-k);
    const avg = (g, key) => Math.round(mean(g.filter((r) => r[key] != null).map((r) => r[key])));
    $('#histTrend').textContent = `Last ${k} rounds: ${avg(b, 'score')}% start, ${avg(b, 'landing')}% landing. The ${k} before: ${avg(a, 'score')}%, ${avg(a, 'landing')}%.`;
    $('#histTrend').hidden = false;
  } else $('#histTrend').hidden = true;
  $('#histTable').innerHTML = `<table><thead><tr><th>When</th><th>Range</th><th>Start</th><th>Landing</th><th></th></tr></thead><tbody>${
    [...rounds].reverse().map((r) => `<tr><td>${fmtWhen(r.ts)}</td><td>${nname(r.lo)}–${nname(r.hi)}</td><td>${r.score}%</td><td>${r.landing == null ? '—' : r.landing + '%'}</td><td><button type="button" class="linkbtn" data-open="${r.ts}">Open</button></td></tr>`).join('')}</tbody></table>`;
  dataLine();
}

$('#histTable').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) { const rec = rounds.find((r) => r.ts === +b.dataset.open); if (rec) openRound(rec); } });
