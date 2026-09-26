// The end of a round (and a round reopened from the progress table): scores, observations, the keyboard map,
// each note in detail, and playing back its recording.

import { floorDb, thrDb } from './audio/mic.js';
import { audioOut, outNode, wantSound } from './audio/piano.js';
import { bestScore, fmtDay } from './home.js';
import { keyboard, keyUnder, playable } from './keyboard.js';
import { mountRoll } from './roll.js';
import { show } from './round.js';
import { duo, off, OTHER, scoreNote, sentence, size, tierFromAcc, tierOf, TIERS } from './scoring.js';
import { run, setRound } from './state.js';
import { clipCount, dataLine, DB, packTrace, rounds, setClipCount, unpackTrace } from './storage.js';
import { $, clamp, hideTip, mean, median, motion, nname, pc, placeTip, restart, ROUND_LEN, slideThumb } from './util.js';

/* ---------- summary ---------- */
function insights(notes) {
  const ok = notes.filter((n) => n.kind === 'ok');
  if (ok.length < 5) return [{ title: 'Not much to go on', body: `Only ${ok.length} note${ok.length === 1 ? '' : 's'} counted. Too few to spot habits.` }];
  const out = [];
  const medOn = median(ok.map((n) => Math.abs(n.onset)));
  const held = ok.filter((n) => n.settled != null);
  const medSet = held.length >= 4 ? median(held.map((n) => Math.abs(n.settled))) : null;

  // a lean one way
  const offs = ok.filter((n) => Math.abs(n.onset) >= 15);
  const flat = offs.filter((n) => n.onset < 0);
  if (offs.length >= 5) {
    const isFlat = flat.length * 2 > offs.length, side = isFlat ? flat : offs.filter((n) => n.onset > 0);
    if (side.length / offs.length >= 0.7) out.push({ title: `You tend to start ${isFlat ? 'flat' : 'sharp'}`,
      body: `${side.length} of ${offs.length} misses started ${isFlat ? 'flat' : 'sharp'}, usually by ${size(median(side.map((n) => Math.abs(n.onset))))}.` });
  }
  // sliding into notes: of the held notes that started well off, how many then slid toward the note
  let slid = false;
  for (const up of [true, false]) {
    const cand = held.filter((n) => (up ? n.onset <= -30 : n.onset >= 30));
    const sl = cand.filter((n) => (up ? n.settled - n.onset : n.onset - n.settled) >= 30);
    if (sl.length >= 3 && sl.length / cand.length >= 0.6) { slid = true; out.push({ title: `You slide ${up ? 'up' : 'down'} into notes`,
      body: `${sl.length} of ${cand.length} ${up ? 'flat' : 'sharp'} starts slid ${up ? 'up' : 'down'} onto the note. Your ear finds it, just late.` }); }
  }
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
    const rec = { ts: r.ts, v: 1, lo: r.lo, hi: r.hi, hold: r.hold, voice: r.voice, score, landing, floorDb: Math.round(floorDb), thrDb: Math.round(thrDb),
      notes: r.notes.map((n) => ({ midi: n.midi, kind: n.kind, onset: n.onset ?? null, settled: n.settled ?? null, oct: n.oct || 0, hold: n.hold, cue: n.cue, trace: packTrace(n.trace), rec: !!n.audio })) };
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
  $('#homeBtn').textContent = o.fresh ? 'Change range' : 'Back';
  countUp($('#sumStart'), score); countUp($('#sumLand'), landing);
  for (const [id, v] of [['#boxStart', score], ['#boxLand', landing]]) {
    const box = $(id), t = tierFromAcc(v);
    if (t) box.dataset.tone = t.tone; else delete box.dataset.tone;
    box.querySelector('.si').textContent = t ? t.icon : ''; box.querySelector('.si').hidden = !t;
  }
  const bs = mean(before.map((x) => x.score)), bl = mean(before.filter((x) => x.landing != null).map((x) => x.landing));
  $('#sumSub').textContent = `${ok.length} of ${ROUND_LEN} notes counted${landed.length < ok.length ? `, ${ok.length - landed.length} too short to land` : ''}.`
    + (before.length ? ` ${o.fresh ? 'Last' : 'Previous'} ${before.length === 1 ? 'round' : before.length + ' rounds'}: ${Math.round(bs)}% · ${bl == null ? '—' : Math.round(bl) + '%'}.` : '');
  const chip = $('#sumBest');
  chip.hidden = score == null || !o.fresh;
  if (score != null && o.fresh) {
    const isBest = prevBest == null || score > prevBest;
    chip.textContent = prevBest == null ? 'First round' : isBest ? 'New best start' : `Best start ${prevBest}%`;
    chip.classList.toggle('quiet', !isBest || prevBest == null);
  }
  $('#doneTitle').textContent = !o.fresh ? `Round from ${fmtDay(r.ts)}` : score == null ? 'Round over' : 'Round complete';
  const counts = new Map(); for (const n of r.notes) counts.set(n.tier.key, (counts.get(n.tier.key) || 0) + 1);
  $('#tally').innerHTML = [...TIERS, OTHER.void, OTHER.silent].filter((t) => counts.get(t.key) || TIERS.includes(t))
    .map((t, i) => `<span class="tal" style="--i:${i}"><i data-tone="${t.tone}">${t.icon}</i>${t.word} <b>${counts.get(t.key) || 0}</b></span>`).join('');
  $('#insights').innerHTML = insights(r.notes).map((f, i) => `<li style="--i:${i}"><b>${f.title}</b><span>${f.body}</span></li>`).join('');
  summaryRun = r;
  drawKeysMap();
  const chips = $('#chips');
  chips.innerHTML = r.notes.map((n, i) => `<button type="button" class="chip" style="--i:${i}" data-i="${i}" aria-pressed="false" aria-label="Note ${i + 1}: ${nname(n.midi)}, ${n.tier.word}"><i data-tone="${n.tier.tone}">${n.tier.icon}</i>${nname(n.midi)}</button>`).join('');
  const worst = ok.length ? r.notes.indexOf(ok.reduce((a, b) => (b.acc < a.acc ? b : a))) : 0;
  pickDetail(worst, true);
  $('#doneTitle').focus({ preventScroll: true });
}
let summaryRun = null;
export function pickDetail(i, isWorst) {
  const r = summaryRun, n = r.notes[i]; if (!n) return;
  stopClip();
  for (const c of document.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(+c.dataset.i === i));
  const d = $('#detail'), canPlay = !!(n.audio || (n.rec && r.ts));
  d.innerHTML = `<div class="dhead"><span class="lead">${isWorst && n.kind === 'ok' ? 'Trickiest: ' : ''}note ${i + 1}, ${nname(n.midi)}</span>${canPlay ? '<button type="button" class="btn small play">▶ Hear it</button>' : ''}</div>
    ${n.kind === 'ok' ? `<div class="duo">${duo(n)}</div>` : `<div class="verdict" data-tone="${n.tier.tone}"><span class="vicon">${n.tier.icon}</span><span class="vword">${n.tier.word}</span></div>`}
    <p class="vtext"></p><div class="roll"></div><p class="caption rollcap">Tap a key to hear it.</p>`;
  d.querySelector('.vtext').textContent = sentence(n);
  restart(d, 'swap');
  const rollEl = d.querySelector('.roll');
  if (n.trace) mountRoll(rollEl, n, 190); else { rollEl.remove(); d.querySelector('.rollcap').remove(); }
  const btn = d.querySelector('.play');
  if (btn) btn.addEventListener('click', () => (playing && playing.btn === btn ? stopClip() : playClip(r, i, rollEl, btn)));
}
// Reopen a stored round: rebuild its notes' curves and scores, then show the usual summary.
export function openRound(rec) {
  const i = rounds.indexOf(rec);
  const r = { ts: rec.ts, lo: rec.lo, hi: rec.hi, notes: rec.notes.map((n) => scoreNote({ ...n, trace: unpackTrace(n.trace) })) };
  renderSummary(r, { score: rec.score, landing: rec.landing, before: rounds.slice(Math.max(0, i - 5), i), fresh: false });
}

/* ---------- playing back a recorded note ---------- */
let playing = null;
async function playClip(r, i, rollEl, btn) {
  stopClip();
  const n = r.notes[i];
  if (!n.audio) { try { const c = await DB.clip(`${r.ts}:${i}`); if (c) n.audio = { sr: c.sr, t0: c.t0, pcm: c.pcm }; } catch (e) {} }
  const a = n.audio;
  if (!a) { btn.textContent = 'No recording'; btn.disabled = true; return; }
  const ac = audioOut();
  const buf = ac.createBuffer(1, a.pcm.length, a.sr), ch = buf.getChannelData(0);
  let pk = 1e-4; for (let k = 0; k < a.pcm.length; k++) { ch[k] = a.pcm[k] / 32768; pk = Math.max(pk, Math.abs(ch[k])); }
  const src = ac.createBufferSource(), g = ac.createGain();
  g.gain.value = Math.min(12, 0.7 / pk);            // mic recordings are often quiet; bring them up to a comfortable level
  src.buffer = buf; src.connect(g); g.connect(outNode(ac));
  wantSound();
  const t = ac.currentTime + 0.05; src.start(t);
  btn.textContent = '■ Stop';
  const p = playing = { src, btn, rollEl, raf: 0 };
  const head = () => {   // a playhead across the piano roll, so you hear and see the same moment
    const line = rollEl.querySelector('.playhead'), g2 = rollEl._g, pos = ac.currentTime - t + a.t0;
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
  p.btn.textContent = '▶ Hear it'; p.btn.style.setProperty('--p', 0);
  const line = p.rollEl.querySelector('.playhead'); if (line) line.setAttribute('visibility', 'hidden');
}
let mapMode = 'start';
export function setMapMode(m) { mapMode = m; }

export function drawKeysMap() {
  const r = summaryRun; if (!r) return;
  const land = mapMode === 'land', val = (n) => land ? n.settled : n.onset, score = (n) => land ? n.landAcc : n.acc;
  for (const b of document.querySelectorAll('[data-map]')) b.setAttribute('aria-pressed', String(b.dataset.map === mapMode));
  slideThumb($('#mapOpts'));
  $('#mapCap').textContent = (land ? 'Where each note settled.' : 'How you started each note.') + ' ▼ flat, ▲ sharp. Tap a key to hear it.';
  const by = new Map();
  for (const n of r.notes) if (n.kind === 'ok' && val(n) != null) { if (!by.has(n.midi)) by.set(n.midi, []); by.get(n.midi).push(n); }
  const el = $('#keysMap');
  const geo = keyboard(el, r.lo, r.hi, {
    H: 118, aria: `Keyboard across your range, with a dot on each note showing ${land ? 'where you landed' : 'how you started'}`,
    fill: (m) => m < r.lo || m > r.hi ? 'var(--key-out)' : null,
    label: (m) => m === r.lo || m === r.hi ? 'bold' : pc(m) === 0 ? 'muted' : null,
    marks: (g, kw) => {
      let s = '';
      [...by].sort((a, b) => a[0] - b[0]).forEach(([m, list], i) => {
        const k = g.get(m), c = median(list.map(val)), t = tierOf(c), rad = clamp(kw * (k.white ? 0.34 : 0.26), 5, 11);
        s += `<g class="mk" style="--i:${i}" data-tone="${t.tone}"><circle cx="${k.x}" cy="${k.y}" r="${rad}" fill="var(--tone)" stroke="var(--surface)" stroke-width="2"/>`;
        if (rad >= 8) s += `<text x="${k.x}" y="${k.y + 0.5}" text-anchor="middle" dominant-baseline="central" font-size="${rad * 1.05}" font-weight="800" fill="var(--tone-ink)">${t.icon}</text>`;
        s += '</g>';
        if (Math.abs(c) >= 15) s += `<text class="mk" style="--i:${i}" x="${k.x}" y="${k.y - rad - 5}" text-anchor="middle" font-size="${clamp(rad, 8, 11)}" fill="var(${k.white ? '--ink-2' : '--key-white'})">${c < 0 ? '▼' : '▲'}</text>`;
      });
      for (const [m, k] of g) s += `<rect class="hit" data-m="${m}" x="${k.x0}" y="0" width="${k.w}" height="${k.h}" fill="transparent"/>`;
      return s;
    },
  });
  // key tooltips: black keys are drawn last, so they win where they overlap white keys
  let tip = el.querySelector('.tip-pop'); if (!tip) { tip = document.createElement('div'); tip.className = 'tip-pop'; el.style.position = 'relative'; el.appendChild(tip); }
  const svg = el.querySelector('svg');
  const hover = (e) => {
    const h = e.target.closest && e.target.closest('.hit'); if (!h) { hideTip(tip); return; }
    const m = +h.dataset.m, list = by.get(m) || [], k = geo.get(m), box = svg.getBoundingClientRect(), sc = box.width / svg.viewBox.baseVal.width;
    tip.textContent = list.length ? `${nname(m)} · ${land ? 'landing' : 'start'} ${Math.round(mean(list.map(score)))}% · ${land ? 'ended' : 'started'} ${off(median(list.map(val)))}${list.length > 1 ? ` · ${list.length} notes` : ''}` : `${nname(m)} · ${land ? 'no landing scored' : 'not sung'} this round`;
    placeTip(tip, k.x * sc, k.y * sc - 16, box.width);
  };
  svg.addEventListener('pointermove', hover); svg.addEventListener('pointerdown', hover);
  if (!el._playable) { el._playable = true; playable(el, keyUnder(el, '.hit'), (m, on) => { const k = el.querySelector(`[data-k="${m}"]`); if (k) k.classList.toggle('down', on); }); }
  svg.addEventListener('pointerleave', () => hideTip(tip));
}
