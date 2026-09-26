// The stage during a note: the words, the Listen / imagine / Sing steps, the progress strip and the silence meter.

import { run } from './state.js?v=17222eed60';
import { $, nname, restart, ROUND_LEN, slideThumb } from './util.js?v=17222eed60';

/* ---------- stage ---------- */
const STAGE = {
  calib: ['Shh', 'Measuring the room.'],
  tone: ['Listen', ''],
  hold: ['Imagine it', 'Hear it in your head. Sing on the cue.'],     // replaced per note by the rotating cue below
  sing: ['Sing!', 'Straight onto the note.'],
  capture: ['Keep going', 'A second is plenty.'],
  done: ['', ''],
};
let stagePhase = null;
// Different people respond to different cues for holding a note in mind, so the imagine step rotates through them,
// one per note. Each note records which cue it had, so rounds can later show which cue works best for you.
export const CUES = [
  ['Imagine', 'Hear it in your head.'],
  ['Picture', 'See where it sits.'],
  ['Feel', 'Feel where it sits in your body.'],
  ['Hold', 'Keep it in mind.'],
  ['Visualise', 'See it before you sing it.'],
];
export function setStage(p) {
  if (p === stagePhase) return; stagePhase = p;
  const st = $('#stage'); st.dataset.phase = p;
  if (p !== 'done') { delete st.dataset.tone; delete st.dataset.split; $('#glyph').textContent = ''; }
  const cue = p === 'hold' && run && run.cue;
  $('#say').textContent = cue ? `${cue[0]} it` : STAGE[p][0]; $('#sub').textContent = cue ? cue[1] : STAGE[p][1];
  if (p !== 'done') { restart($('#say'), 'swap'); restart($('#sub'), 'swap'); }
  const STEPS = ['tone', 'hold', 'sing'], step = p === 'capture' ? 'sing' : p;
  if (STEPS.includes(step)) {                      // Listen · Hold · Sing: where you are, and what comes next
    for (const li of $('#steps').querySelectorAll('li')) {
      li.classList.toggle('on', li.dataset.s === step);
      li.classList.toggle('past', STEPS.indexOf(li.dataset.s) < STEPS.indexOf(step));
    }
    slideThumb($('#steps'), '.on', step === 'tone');   // a new note starts from Listen without sliding back across
  }
  $('#track').style.opacity = p === 'hold' ? 1 : 0;
  if (p !== 'capture') $('#core').style.transform = '';
  if (p === 'sing' && navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
}
export function renderProgress() {
  if (!run) return;
  let h = '';
  for (let i = 0; i < ROUND_LEN; i++) {
    const n = run.notes[i];
    if (n) h += `<span class="seg done${i === run.pop ? ' pop' : ''}" data-tone="${n.tier.tone}" title="${nname(n.midi)}: ${n.tier.word}">${n.tier.icon}</span>`;
    else h += `<span class="seg${i === run.notes.length ? ' now' : ''}"></span>`;
  }
  $('#progress').innerHTML = h; run.pop = null;
  $('#progress').setAttribute('aria-label', `${run.notes.length} of ${ROUND_LEN} notes sung`);
}

// The silence meter: a bar per mic frame (about every 10 ms) across the imagine step, filling left to right with the
// ring. Mirrored bars like a voice-memo waveform, so it reads as "what the mic hears".
export const PEEK_VOID = 5;                                // hum-like frames in the hold that void a note (see finish/noteDone)
let quietColors = null;
export function drawQuiet(r) {
  const cv = $('#quietWave'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); quietColors = null; }
  if (!quietColors) { const cs = getComputedStyle(document.documentElement); quietColors = { quiet: cs.getPropertyValue('--line').trim(), noise: cs.getPropertyValue('--warn').trim(), hum: cs.getPropertyValue('--crit').trim(), base: cs.getPropertyValue('--muted').trim() }; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const slots = Math.max(20, Math.round((r.go - r.bleedEnd) * 95)), bw = w / slots;
  g.fillStyle = quietColors.quiet; g.fillRect(0, h / 2 - 0.5, w, 1);                    // the baseline
  r.quiet.slice(0, slots).forEach((q, i) => {
    const bh = Math.max(2, q.lv * (h - 2));
    g.fillStyle = q.kind === 'quiet' ? quietColors.base : quietColors[q.kind];
    g.globalAlpha = q.kind === 'quiet' ? 0.45 : 1;
    g.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1), bh);
  });
  g.globalAlpha = 1;
  const state = r.peek ? 'hum' : r.quiet.some((q) => q.kind === 'noise') ? 'noise' : 'quiet', box = $('#quiet');
  if (box.dataset.state !== state || (state === 'hum' && r.peek >= PEEK_VOID) !== box._void) {
    box.dataset.state = state; box._void = state === 'hum' && r.peek >= PEEK_VOID;
    $('#quietLabel').textContent = state === 'quiet' ? 'Silent' : state === 'noise' ? 'Noise is fine' : box._void ? 'Voice heard. Won’t count.' : 'Voice heard';
  }
}
