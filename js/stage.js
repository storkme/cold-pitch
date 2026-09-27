// The stage during a note: the words, the Listen / imagine / Sing steps, the progress strip, the listening strip,
// and the practice note's guidance.

import { run } from './state.js?v=46a1bebe13';
import { $, nname, restart, ROUND_LEN, slideThumb } from './util.js?v=46a1bebe13';
import { drawWave } from './wave.js?v=46a1bebe13';

/* ---------- stage ---------- */
const STAGE = {
  calib: ['Shh', 'Measuring the room.'],
  tone: ['Listen', ''],
  hold: ['Imagine it', 'Hear it in your head. Sing on the cue.'],     // replaced per note by the rotating cue below
  sing: ['Sing!', 'Straight onto the note.'],
  capture: ['Sing!', 'Straight onto the note.'],       // unchanged once your voice comes in: nothing new to read mid-note
  done: ['', ''],
};
// The practice note (see startPractice) explains the first two steps in its own words; nothing there is timed.
const PRACTICE = { tone: ['Listen', 'A piano plays a note.'], hold: ['Imagine it', 'Sing it in your head. No sound.'] };
let stagePhase = null;
// Different people respond to different cues for holding a note in mind, so the imagine step rotates through them,
// one per note. Each note records which cue it had, so rounds can later show which cue works best for you.
export const CUES = [
  ['Imagine', 'Hear it in your head.'],
  ['Picture', 'See where it sits.'],
  ['Feel', 'Feel where it sits in your body.'],
  ['Remember', 'Keep it in mind.'],
  ['Visualise', 'See it before you sing it.'],
];
export function setStage(p) {
  if (p === stagePhase) return; stagePhase = p;
  const st = $('#stage'); st.dataset.phase = p;
  if (p !== 'done') { delete st.dataset.tone; delete st.dataset.split; $('#glyph').textContent = ''; }
  const practice = !!(run && run.practice), cue = p === 'hold' && !practice && run && run.cue;
  const [say, sub] = practice && PRACTICE[p] ? PRACTICE[p] : cue ? [`${cue[0]} it`, cue[1]] : STAGE[p];
  const changed = $('#say').textContent !== say || $('#sub').textContent !== sub;
  $('#say').textContent = say; $('#sub').textContent = sub;
  $('#coach').hidden = !(practice && (p === 'tone' || p === 'hold'));
  $('#coachRow').hidden = p !== 'tone';
  if (practice) $('#coachText').textContent = COACH[p] || '';
  if (p !== 'done' && changed) { restart($('#say'), 'swap'); restart($('#sub'), 'swap'); }
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

// The listening strip: a label while the mic checks the imagine step is quiet, then from the Sing cue the live
// waveform (wave.js; drawn all along, shown from the cue, see the CSS). The imagine step's stretch of it is dotted
// and the cue is a hairline, so you see the silence, the cue and your voice arriving. The label says what the mic
// makes of it: in the imagine step grey is quiet, amber is noise without a pitch (fine), red is anything that sounds
// like a voice, which is what voids a note; then Listening, and Hearing you once a note starts.
export const PEEK_VOID = 5;                                // voice frames in the imagine step that void a note (see finish)
const LABELS = { quiet: 'Silent', noise: 'Noise is fine', hum: 'Voice heard', void: 'Voice heard. Won’t count.', listening: 'Listening', hearing: 'Hearing you' };
const COACH = { tone: 'Nothing here is timed or saved. Headphones help, and hearing yourself in them helps more.', hold: 'When the circle closes, sing it out loud.', loud: 'That was out loud. Keep it inside.' };
export function drawListen(r, phase, now) {
  const go = Number.isFinite(r.go) ? r.go : null;
  drawWave($('#wave'), { from: r.bleedEnd, zone: [r.bleedEnd, go ?? now], mark: go });
  let state;
  if (phase === 'hold') {
    // a practice note starts its silence over when it hears a voice, so there it only says so for a moment
    const loud = r.practice ? now - r.loudAt < 1.2 : r.peek > 0;
    state = loud ? (!r.practice && r.peek >= PEEK_VOID ? 'void' : 'hum') : r.noise ? 'noise' : 'quiet';
    if (r.practice) { const t = loud ? COACH.loud : COACH.hold; if ($('#coachText').textContent !== t) { $('#coachText').textContent = t; restart($('#coachText'), 'swap'); } }
  } else state = phase === 'capture' ? 'hearing' : 'listening';
  const box = $('#listen');
  if (box.dataset.state !== state) { box.dataset.state = state; $('#listenLabel').textContent = LABELS[state]; }
}
