// The end of a round (and a round reopened from the progress table): scores, observations, the keyboard map,
// each note in detail, and playing back its recording.

import { floorDb, thrDb } from './audio/mic.js?v=c238679ebb';
import { audioOut, ghostNote, wantSound, withPiano } from './audio/piano.js?v=c238679ebb';
import { bestScore, fmtDay } from './home.js?v=c238679ebb';
import { keyUnder, playable, rangeMap } from './keyboard.js?v=c238679ebb';
import { CURVE, SCORING } from './rescore.js?v=c238679ebb';
import { drawOverlay, markOverlay } from './overlay.js?v=c238679ebb';
import { show } from './round.js?v=c238679ebb';
import { duo, off, scoreNote, sentence, size, tierFromAcc, tierOf } from './scoring.js?v=c238679ebb';
import { run, setRound } from './state.js?v=c238679ebb';
import { clipCount, dataLine, DB, packTrace, rounds, setClipCount, unpackTrace } from './storage.js?v=c238679ebb';
import { $, clamp, mean, median, motion, nname, restart, slideThumb } from './util.js?v=c238679ebb';

/* ---------- summary ---------- */
function insights(notes) {
  const ok = notes.filter((n) => n.kind === 'ok');
  if (ok.length < 5) return [{ title: 'Not much to go on', body: `Only ${ok.length} note${ok.length === 1 ? '' : 's'} counted. Too few to spot habits.` }];
  const out = [];
  const medOn = median(ok.map((n) => Math.abs(n.onset)));
  const held = ok.filter((n) => n.settled != null);
  const medSet = held.length >= 4 ? median(held.map((n) => Math.abs(n.settled))) : null;

  // a different note, held: started 4+ semitones off and stayed there (not a slide, not the wrong octave)
  const wrong = held.filter((n) => Math.abs(n.onset) >= 400 && Math.abs(n.settled - n.onset) < 100);
  if (wrong.length) {
    const eg = wrong.slice(0, 2).map((n) => `${nname(n.midi)} as ${nname(n.midi + 12 * (n.oct || 0) + Math.round(n.onset / 100))}`).join(', ');
    out.push({ title: wrong.length === 1 ? 'One note was a different note' : `${wrong.length} notes were a different note`,
      body: `Started 4 or more semitones off and stayed there (${eg}). Listen back to hear it.` });
  }
  // a lean one way
  const offs = ok.filter((n) => Math.abs(n.onset) >= 15);
  const flat = offs.filter((n) => n.onset < 0);
  if (offs.length >= 5) {
    const isFlat = flat.length * 2 > offs.length, side = isFlat ? flat : offs.filter((n) => n.onset > 0);
    if (side.length / offs.length >= 0.7) out.push({ title: `You tend to start ${isFlat ? 'flat' : 'sharp'}`,
      body: `${side.length} of ${offs.length} misses started ${isFlat ? 'flat' : 'sharp'}, usually by ${size(median(side.map((n) => Math.abs(n.onset))))}.` });
  }
  // pulled toward the middle: low notes start sharp and high notes flat, as if starting from the middle of the range
  const midM = median(ok.map((n) => n.midi));
  const lowMiss = ok.filter((n) => n.midi < midM - 1 && Math.abs(n.onset) >= 30), highMiss = ok.filter((n) => n.midi > midM + 1 && Math.abs(n.onset) >= 30);
  const lowSharp = lowMiss.filter((n) => n.onset > 0).length, highFlat = highMiss.filter((n) => n.onset < 0).length;
  if (lowMiss.length >= 3 && highMiss.length >= 3 && lowSharp / lowMiss.length >= 0.7 && highFlat / highMiss.length >= 0.7)
    out.push({ title: 'You start toward the middle',
      body: `Low notes started sharp (${lowSharp} of ${lowMiss.length}) and high ones flat (${highFlat} of ${highMiss.length}), pulled toward ${nname(Math.round(midM))}.` });
  // big leaps: starts after a jump of 5 semitones or more from the note before, against smaller steps
  const leap = (n) => { const i = notes.indexOf(n); return i > 0 ? Math.abs(n.midi - notes[i - 1].midi) : null; };
  const big = ok.filter((n) => leap(n) >= 5), small = ok.filter((n) => leap(n) != null && leap(n) < 5);
  if (big.length >= 4 && small.length >= 4) {
    const aB = mean(big.map((n) => n.acc)), aS = mean(small.map((n) => n.acc));
    if (aS - aB >= 15) out.push({ title: 'Big leaps are harder',
      body: `Starts: ${Math.round(aB)}% after a jump of 5 semitones or more, ${Math.round(aS)}% after smaller steps.` });
  }
  // sliding into notes: of the held notes that started well off, how many then slid toward the note
  // (both ways at once is one habit, so one line)
  const slides = [true, false].map((up) => {
    const cand = held.filter((n) => (up ? n.onset <= -30 : n.onset >= 30));
    const sl = cand.filter((n) => (up ? n.settled - n.onset : n.onset - n.settled) >= 30);
    return sl.length >= 3 && sl.length / cand.length >= 0.6 ? { up, n: sl.length, of: cand.length } : null;
  }).filter(Boolean);
  const slid = slides.length > 0;
  if (slides.length === 2) {
    const [a, b] = slides[0].n / slides[0].of >= slides[1].n / slides[1].of ? slides : [slides[1], slides[0]], say = (s) => `${s.n} of ${s.of} ${s.up ? 'flat starts went up' : 'sharp starts came down'}`;
    out.push({ title: 'You slide into notes', body: `Whichever side you start on, you slide onto the note: ${say(a)}, ${say(b)}. Your ear finds it, just late.` });
  }
  else if (slid) { const { up, n, of } = slides[0]; out.push({ title: `You slide ${up ? 'up' : 'down'} into notes`,
    body: `${n} of ${of} ${up ? 'flat' : 'sharp'} starts slid ${up ? 'up' : 'down'} onto the note. Your ear finds it, just late.` }); }
  // where in the range
  const mids = [...new Set(ok.map((n) => n.midi))].sort((a, b) => a - b);
  if (ok.length >= 8 && mids.length >= 4 && mids[mids.length - 1] - mids[0] >= 4) {
    let split = null, bestGap = Infinity;
    for (let i = 1; i < mids.length; i++) { const nl = ok.filter((n) => n.midi < mids[i]).length, nh = ok.length - nl; if (nl >= 3 && nh >= 3 && Math.abs(nl - nh) < bestGap) { bestGap = Math.abs(nl - nh); split = mids[i]; } }
    if (split != null) {
      const low = ok.filter((n) => n.midi < split), high = ok.filter((n) => n.midi >= split);
      const aL = mean(low.map((n) => n.acc)), aH = mean(high.map((n) => n.acc));
      if (Math.abs(aL - aH) >= 15) {
        const weakHigh = aH < aL, weak = weakHigh ? high : low;
        const span = (g) => { const a = Math.min(...g.map((n) => n.midi)), b = Math.max(...g.map((n) => n.midi)); return a === b ? nname(a) : `${nname(a)} to ${nname(b)}`; };
        const lean = median(weak.map((n) => n.onset));
        const lL = mean(low.filter((n) => n.landAcc != null).map((n) => n.landAcc)), lH = mean(high.filter((n) => n.landAcc != null).map((n) => n.landAcc));
        const landGap = lL != null && lH != null && (weakHigh ? lL - lH : lH - lL) >= 10;
        const [aW, aS, lW, lS] = weakHigh ? [aH, aL, lH, lL] : [aL, aH, lL, lH], strong = weakHigh ? low : high;
        out.push({ title: weakHigh ? 'Your higher notes are harder' : 'Your lower notes are harder',
          body: `Starts: ${Math.round(aW)}% from ${span(weak)}, ${Math.round(aS)}% from ${span(strong)}.${Math.abs(lean) >= 30 ? ` Usually ${off(lean)} there.` : ''}`
            + (lW == null || lS == null ? '' : landGap ? ` Landings too: ${Math.round(lW)}% vs ${Math.round(lS)}%.` : ` Landings held up: ${Math.round(lW)}% vs ${Math.round(lS)}%.`) });
      }
    }
  }
  // the ear catching up
  if (!slid && medSet != null && medOn >= 30 && medSet <= 20) out.push({ title: 'Your ear gets you there',
    body: `You usually land ${medSet < 15 ? 'right on the note' : 'within a touch of it'}, but start ${size(medOn)} off. The miss is in the first moment.` });
  // not quite landing
  if (held.length >= 5) {
    const ends = held.map((n) => n.settled), m = median(ends), same = ends.filter((v) => Math.sign(v) === Math.sign(m) && Math.abs(v) >= 15).length;
    if (Math.abs(m) >= 20 && same / held.length >= 0.6) out.push({ title: `You land a little ${m < 0 ? 'flat' : 'sharp'}`,
      body: `${same} of ${held.length} notes landed ${off(m)}, even after correcting.` });
  }
  // through the round
  if (ok.length >= 10) {
    const a = mean(ok.slice(0, 5).map((n) => n.acc)), b = mean(ok.slice(-5).map((n) => n.acc));
    if (Math.abs(a - b) >= 15) out.push({ title: b > a ? 'You warmed up' : 'You tailed off',
      body: `First five: ${Math.round(a)}%. Last five: ${Math.round(b)}%.` });
  }
  if (!out.length) out.push({ title: 'Nice and even', body: `Starts typically ${medOn < 15 ? 'right on the note' : `${size(medOn)} off`}. No lean, no sliding, no weak spot.` });
  return out.slice(0, 3);
}

export function endRound() {
  const r = run; clearTimeout(r.timer); setRound(null);
  const ok = r.notes.filter((n) => n.kind === 'ok'), landed = ok.filter((n) => n.landAcc != null);
  const score = ok.length ? Math.round(mean(ok.map((n) => n.acc))) : null;
  const landing = landed.length ? Math.round(mean(landed.map((n) => n.landAcc))) : null;
  const prevBest = bestScore(), before = rounds.slice(-5);
  r.ts = Date.now();
  renderSummary(r, { score, landing, prevBest, before, fresh: true });
  if (score != null) {
    const rec = { ts: r.ts, v: SCORING, curve: CURVE, lo: r.lo, hi: r.hi, hold: r.hold, voice: r.voice, score, landing, floorDb: Math.round(floorDb), thrDb: Math.round(thrDb),
      notes: r.notes.map((n) => ({ midi: n.midi, kind: n.kind, onset: n.onset ?? null, settled: n.settled ?? null, oct: n.oct || 0, hold: n.hold, cue: n.cue, bleed: n.bleed ?? null, trace: packTrace(n.trace), rec: !!n.audio })),
      ...(r.retried.length ? { retried: r.retried } : {}) };
    const clips = r.notes.map((n, i) => n.audio && { id: `${r.ts}:${i}`, round: r.ts, note: i, midi: n.midi, ...n.audio }).filter(Boolean);
    rounds.push(rec);
    DB.saveRound(rec, clips).then(() => { setClipCount(clipCount + clips.length); dataLine(); if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); })
      .catch(() => { $('#saveErr').hidden = false; });
  }
}
function countUp(el, v) {
  const d = motion('--t-data');
  if (v == null || !d) { el.textContent = v == null ? '—' : v + '%'; return; }
  let t0 = null;                    // start timing on the first frame: drawing the summary can hold up the page for a moment
  el.textContent = '0%';
  const step = () => { const now = performance.now(); if (t0 == null) t0 = now + motion('--t-quick'); const k = clamp((now - t0) / d, 0, 1); el.textContent = Math.round(v * (1 - Math.pow(1 - k, 3))) + '%'; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// Shared by a round just sung and one reopened from the progress table.
function renderSummary(r, o) {
  const ok = r.notes.filter((n) => n.kind === 'ok'), landed = ok.filter((n) => n.landAcc != null);
  const { score, landing, prevBest, before } = o;
  stopClip(); show('summary');
  $('#saveErr').hidden = true;
  countUp($('#sumStart'), score); countUp($('#sumLand'), landing);
  for (const [id, v] of [['#boxStart', score], ['#boxLand', landing]]) {
    const box = $(id), t = tierFromAcc(v);
    if (t) box.dataset.tone = t.tone; else delete box.dataset.tone;
    box.querySelector('.si').textContent = t ? t.icon : ''; box.querySelector('.si').hidden = !t;
  }
  const bs = mean(before.map((x) => x.score)), bl = mean(before.filter((x) => x.landing != null).map((x) => x.landing));
  $('#sumSub').textContent = `${ok.length} of ${r.notes.length} notes counted${landed.length < ok.length ? `, ${ok.length - landed.length} too short to land` : ''}.`
    + (before.length ? ` ${o.fresh ? 'Last' : 'Previous'} ${before.length === 1 ? 'round' : before.length + ' rounds'}: ${Math.round(bs)}% · ${bl == null ? '—' : Math.round(bl) + '%'}.` : '');
  const chip = $('#sumBest');
  chip.hidden = score == null || !o.fresh;
  if (score != null && o.fresh) {
    const isBest = prevBest == null || score > prevBest;
    chip.textContent = prevBest == null ? 'First round' : isBest ? 'New best start' : `Best start ${prevBest}%`;
    chip.classList.toggle('quiet', !isBest || prevBest == null);
  }
  $('#doneTitle').textContent = !o.fresh ? `Round from ${fmtDay(r.ts)}` : score == null ? 'Round over' : 'Round complete';
  $('#insights').innerHTML = insights(r.notes).map((f, i) => `<li style="--i:${i}"><b>${f.title}</b><span>${f.body}</span></li>`).join('');
  summaryRun = r;
  mapPick = null; drawKeysMap();
  const chips = $('#chips');
  chips.innerHTML = r.notes.map((n, i) => `<button type="button" class="chip" style="--i:${i}" data-i="${i}" aria-pressed="false" aria-label="Note ${i + 1}: ${nname(n.midi)}, ${n.tier.word}"><i data-tone="${n.tier.tone}">${n.tier.icon}</i>${nname(n.midi)}</button>`).join('');
  summarySel = null; drawNotesChart(true); pickDetail(null);
  $('#doneTitle').focus({ preventScroll: true });
}
let summaryRun = null, summarySel = null;
// Every note on one chart (overlay.js), with the notes as chips under it. Tapping either selects a note, and the
// detail below shows it: its scores, in words, and its recording to play back (the playhead runs across the chart).
export function drawNotesChart(replay = false) {
  const el = $('#overlay'); if (!summaryRun) return;
  drawOverlay(el, summaryRun.notes, { sel: summarySel, replay });
  el._pick = pickDetail;
}
export function pickDetail(i) {
  const r = summaryRun, n = i == null ? null : r.notes[i];
  stopClip(); summarySel = n ? i : null;
  markOverlay($('#overlay'), summarySel);
  for (const c of document.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(+c.dataset.i === summarySel));
  const d = $('#detail');
  if (!n) { d.innerHTML = ''; return; }
  const canPlay = !!(n.audio || (n.rec && r.ts));
  d.innerHTML = `<div class="dhead"><span class="lead">Note ${i + 1}, ${nname(n.midi)}</span>${canPlay ? '<button type="button" class="btn small play">▶ Hear it</button>' : ''}</div>
    ${n.kind === 'ok' ? `<div class="duo">${duo(n)}</div>` : `<div class="verdict" data-tone="${n.tier.tone}"><span class="vicon">${n.tier.icon}</span><span class="vword">${n.tier.word}</span></div>`}
    <p class="vtext"></p>`;
  d.querySelector('.vtext').textContent = sentence(n);
  restart(d, 'swap');
  const btn = d.querySelector('.play');
  if (btn) btn.addEventListener('click', () => (playing && playing.btn === btn ? stopClip() : playClip(r, i, $('#overlay'), btn)));
}
// Reopen a stored round: rebuild its notes' curves and scores, then show the usual summary.
export function openRound(rec) {
  const i = rounds.indexOf(rec);
  const r = { ts: rec.ts, lo: rec.lo, hi: rec.hi, notes: rec.notes.map((n) => scoreNote({ ...n, trace: unpackTrace(n.trace) })) };
  renderSummary(r, { score: rec.score, landing: rec.landing, before: rounds.slice(Math.max(0, i - 5), i), fresh: false });
}

/* ---------- playing back a recorded note ---------- */
let playing = null;
// The recording is brought up or down to a peak of VOICE, and the note played under it sits GHOST_DB below it,
// however loud the voice was recorded (by the voice's level over its first second; PIANO_DB is a note's, at level 1).
const VOICE = 0.6, GHOST_DB = 9, PIANO_DB = -20;
async function playClip(r, i, chartEl, btn) {
  stopClip();
  const n = r.notes[i];
  if (!n.audio) { try { const c = await DB.clip(`${r.ts}:${i}`); if (c) n.audio = { sr: c.sr, t0: c.t0, pcm: c.pcm }; } catch (e) {} }
  const a = n.audio;
  if (!a) { btn.textContent = 'No recording'; btn.disabled = true; return; }
  const ac = audioOut();
  const buf = ac.createBuffer(1, a.pcm.length, a.sr), ch = buf.getChannelData(0);
  let pk = 1e-4; for (let k = 0; k < a.pcm.length; k++) { ch[k] = a.pcm[k] / 32768; pk = Math.max(pk, Math.abs(ch[k])); }
  const src = ac.createBufferSource(), g = ac.createGain();
  g.gain.value = Math.min(12, VOICE / pk);            // mic recordings are often quiet; bring them up to a comfortable level
  src.buffer = buf; src.connect(g); g.connect(withPiano(ac));
  const k0 = clamp(Math.round(-a.t0 * a.sr), 0, ch.length - 1), k1 = Math.min(ch.length, k0 + a.sr);
  let e = 0; for (let k = k0; k < k1; k++) e += ch[k] * ch[k];
  const voiceDb = 20 * Math.log10(g.gain.value * Math.sqrt(e / (k1 - k0)) + 1e-9);
  const ghostLevel = Math.min(1, Math.pow(10, (voiceDb - GHOST_DB - PIANO_DB) / 20));
  wantSound();
  const t = ac.currentTime + 0.05; src.start(t);
  // the note, softly, from the moment the voice starts, in the octave sung: you hear where you were against it
  const ghost = ghostNote(ac, n.midi + 12 * (n.oct || 0), t - a.t0, t + buf.duration, ghostLevel);
  btn.textContent = '■ Stop';
  const p = playing = { src, ghost, btn, chartEl, raf: 0 };
  const head = () => {   // a playhead across the chart, so you hear and see the same moment
    const line = chartEl.querySelector('.playhead'), g2 = chartEl._g, pos = ac.currentTime - t + a.t0;
    if (line && g2) {
      const vis = pos >= 0 && pos <= g2.tMax;
      line.setAttribute('visibility', vis ? 'visible' : 'hidden');
      if (vis) { line.setAttribute('x1', g2.X(pos)); line.setAttribute('x2', g2.X(pos)); }
    }
    btn.style.setProperty('--p', clamp((ac.currentTime - t) / buf.duration, 0, 1).toFixed(3));
    p.raf = requestAnimationFrame(head);
  };
  head();
  src.onended = () => { if (playing === p) stopClip(); };
}
export function stopClip() {
  if (!playing) return;
  const p = playing; playing = null;
  cancelAnimationFrame(p.raf);
  try { p.src.stop(); } catch (e) {}
  p.ghost.stop(p.ghost.ac.currentTime, 0.05);
  p.btn.textContent = '▶ Hear it'; p.btn.style.setProperty('--p', 0);
  const line = p.chartEl.querySelector('.playhead'); if (line) line.setAttribute('visibility', 'hidden');
}
let mapMode = 'start', mapPick = null;   // which view, and the key last tapped
export function setMapMode(m) { mapMode = m; }

export function drawKeysMap() {
  const r = summaryRun; if (!r) return;
  const land = mapMode === 'land', val = (n) => land ? n.settled : n.onset, score = (n) => land ? n.landAcc : n.acc;
  for (const b of document.querySelectorAll('[data-map]')) b.setAttribute('aria-pressed', String(b.dataset.map === mapMode));
  slideThumb($('#mapOpts'));
  const by = new Map();
  for (const n of r.notes) if (n.kind === 'ok' && val(n) != null) { if (!by.has(n.midi)) by.set(n.midi, []); by.get(n.midi).push(n); }
  const results = [...by].sort((a, b) => a[0] - b[0]).map(([m, list]) => {
    const c = median(list.map(val)), t = tierOf(c);
    return { m, tone: t.tone, icon: t.icon, dir: Math.abs(c) >= 15 ? Math.sign(c) : 0 };
  });
  const el = $('#keysMap');
  rangeMap(el, r.lo, r.hi, results, `Keyboard across your range, with ${land ? 'where you landed' : 'how you started'} above each note sung`);
  // Tapping a key plays it and shows its result in the caption (no hover: it's the same with a mouse or a finger).
  const legend = (land ? 'Where each note settled.' : 'How you started each note.') + ' ▼ flat, ▲ sharp. Tap a key to hear it.';
  const select = (m) => {
    mapPick = m;
    for (const g of el.querySelectorAll('.mk, .wkey, .bkey')) g.classList.toggle('sel', +(g.dataset.m ?? g.dataset.k) === m);
    const list = by.get(m) || [];
    $('#mapCap').textContent = m == null ? legend : list.length
      ? `${nname(m)}: ${land ? 'landed' : 'started'} ${off(median(list.map(val)))}, ${Math.round(mean(list.map(score)))}%${list.length > 1 ? ` (${list.length} notes)` : ''}.`
      : `${nname(m)}: ${land ? 'no landing scored' : 'not sung'} this round.`;
  };
  select(mapPick != null && el.querySelector(`[data-k="${mapPick}"]`) ? mapPick : null);
  el._select = select;
  if (!el._playable) {
    el._playable = true;
    playable(el, keyUnder(el, '.hit'), (m, on) => { const k = el.querySelector(`[data-k="${m}"]`); if (k) k.classList.toggle('down', on); if (on) el._select(m); });
  }
}
