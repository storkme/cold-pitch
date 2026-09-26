// A round: screens, choosing notes, the timing of each note, pausing, quitting, a lost mic, and scoring what was
// sung.

import { calib, calibrate, ctx, grabAudio, initAudio, micAlive, stopAudio, stream } from './audio/mic.js?v=803d44b224';
import { muted, pctx, pianoReady, playTone, setMuted, setPctx, wantSound } from './audio/piano.js?v=803d44b224';
import { readNote } from './audio/pitch.js?v=803d44b224';
import { renderRange, stopTester, tester } from './home.js?v=803d44b224';
import { mountRoll } from './roll.js?v=803d44b224';
import { duo, scoreNote, sentence } from './scoring.js?v=803d44b224';
import { CUES, PEEK_VOID, renderProgress, setStage } from './stage.js?v=803d44b224';
import { round, run, setLastFrameAt, setRound, setRun } from './state.js?v=803d44b224';
import { settings } from './storage.js?v=803d44b224';
import { endRound, stopClip } from './summary.js?v=803d44b224';
import { $, clamp, HOLD, hz, motion, PAUSE, r1, restart, ROUND_LEN, TONE } from './util.js?v=803d44b224';

/* ---------- screens ---------- */
// Home is the bottom of the page's history and every other screen sits one entry above it, so the browser's Back
// (or a phone's back gesture) comes home rather than leaving the site, and Back from home leaves. Moving between
// screens above home replaces that entry; coming home by a button takes it back off (the popstate handler in main.js).
export function show(id) {
  if (id === 'home') { if (history.state && history.state.cp) history.back(); }
  else if (history.state && history.state.cp) history.replaceState({ cp: id }, '');
  else history.pushState({ cp: id }, '');
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  if (id !== 'run') { $('#sheet').hidden = true; $('#msg').hidden = true; }
  // The sound button lives on the home screen only. A round needs sound, and the summary is for listening back,
  // so both turn it on.
  $('#soundBtn').hidden = id !== 'home';
  if (id !== 'home' && muted) setMuted(false);
  window.scrollTo(0, 0);
}

/* ---------- a round ---------- */
function bag() {
  const a = []; for (let m = run.lo; m <= run.hi; m++) a.push(m);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function pick() {   // every note in the range comes up before any repeats
  if (!run.bag.length) run.bag = bag();
  let m = run.bag.pop();
  if (m === run.last && run.bag.length) { const k = run.bag.pop(); run.bag.unshift(m); m = k; }
  else if (m === run.last && run.hi > run.lo) { run.bag = bag(); run.bag.push(m); m = run.bag.find((x) => x !== run.last); run.bag.splice(run.bag.indexOf(m), 1); }
  return m;
}

export async function startRound() {
  hideMsg(); $('#homeErr').hidden = true;
  setMuted(false); stopTester();
  stopClip();
  if (pctx) { pctx.close().catch(() => {}); setPctx(null); }
  setRun({ keepAudio: settings.keepAudio, lo: settings.lo, hi: settings.hi, hold: HOLD, voice: 'piano', notes: [], bag: [], last: null, paused: false, timer: null, silent: 0 });
  show('run');
  renderProgress(); setStage('calib'); $('#noteNum').textContent = 'Getting ready';
  if (await ensureAudio()) playNext();
}
async function ensureAudio() {
  const r = run;
  if (ctx && micAlive()) {
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch (e) {} }
    return true;
  }
  stopAudio();
  try { await initAudio(); }
  catch (e) { stopAudio(); if (run === r) failStart(e); return false; }
  await pianoReady(ctx);                           // decode the piano on the round's context before the first note
  if (!(await calibrate())) return false;
  return run === r;
}
export function failStart(e) {
  setRun(null); stopTester(); show('home');
  let msg;
  if (e && e.name === 'Insecure') msg = 'The mic needs a secure (https) page.';
  else if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) msg = 'Mic blocked. Allow it in site settings, then try again.';
  else if (e && e.name === 'NotFoundError') msg = 'No mic found.';
  else msg = (e && e.message) || 'Couldn’t start the mic.';
  $('#homeErr').textContent = msg; $('#homeErr').hidden = false;
}

function playNext() {
  if (!run) return;
  clearTimeout(run.timer);
  if (run.notes.length >= ROUND_LEN) return endRound();
  closeSheet($('#sheet'));
  const m = pick(); run.last = m;
  const T = ctx.currentTime + 0.35;
  const hold = HOLD;
  const tone = playTone(ctx, m, T, TONE); wantSound();
  // Time the hold from when the tone is heard to end, not when the page finishes playing it. Through a phone
  // speaker or Bluetooth that can be a few tenths of a second later, and the tail also takes a while to come back
  // in through the mic, so ignore what the mic hears until then. Browsers that don't report latency get 0.
  const outLat = clamp((ctx.outputLatency || 0) + (ctx.baseLatency || 0), 0, 0.5);
  const inLat = clamp((stream && stream.getAudioTracks()[0] && stream.getAudioTracks()[0].getSettings().latency) || 0, 0, 0.3);
  const heardEnd = T + TONE + outLat;
  const qb = $('#quiet'); qb.dataset.state = 'quiet'; qb._void = false; $('#quietLabel').textContent = 'Silent';
  run.cue = CUES[run.notes.length % CUES.length];
  const li = $('#steps li[data-s="hold"]'); if (li.textContent !== run.cue[0]) { li.textContent = run.cue[0]; restart(li, 'swap'); }
  setRound({ midi: m, T, tone, toneEnd: heardEnd, bleedEnd: heardEnd + inLat + 0.25, go: heardEnd + Math.max(hold, inLat + 0.3),
    frames: [], start: 0, quiet: [], peek: 0, hears: 0, bleed: false, state: 'tone' });
  setLastFrameAt(performance.now());
  $('#stage').dataset.midi = m;
  $('#noteNum').textContent = `Note ${run.notes.length + 1} of ${ROUND_LEN}`; restart($('#noteNum'), 'swap');
  setStage('tone'); renderProgress();
}

function noteDone(n) {
  if (!run) return;
  scoreNote(n);
  n.hold = round ? r1(round.go - round.toneEnd) : null;
  n.bleed = round ? round.bleed : null;          // the mic could hear the piano (speakers rather than earphones)
  n.cue = run.cue ? run.cue[0] : null;
  run.notes.push(n); run.pop = run.notes.length - 1;
  run.silent = n.kind === 'silent' ? run.silent + 1 : 0;
  renderProgress();
  const st = $('#stage');
  if (n.kind === 'ok') {     // left half: how the note started; right half: where it landed
    st.dataset.split = ''; $('#glyph').textContent = '';
    for (const [side, t] of [['L', n.tier], ['R', n.ltier]]) {
      const tone = t ? t.tone : 'none';
      $('#half' + side).dataset.tone = tone; $('#glyph' + side).dataset.tone = tone; $('#glyph' + side).textContent = t ? t.icon : '–';
    }
  } else { delete st.dataset.split; st.dataset.tone = n.tier.tone; $('#glyph').textContent = n.tier.icon; }
  setStage('done');
  showSheet(n);
  if (run.silent >= 2) {
    showMsg('Can’t hear you', 'Check the mic level moves when you sing.',
      ['Carry on', () => { run.silent = 0; hideMsg(); playNext(); }], ['End round', quitRound]);
    return;
  }
  schedule();
}

function showSheet(n) {
  const sh = $('#sheet'), ok = n.kind === 'ok';
  if (ok) delete sh.dataset.tone; else sh.dataset.tone = n.tier.tone;       // a scored note gets a neutral sheet and two coloured cards
  $('#sVerdict').hidden = ok; $('#sDuo').hidden = !ok;
  $('#sIcon').textContent = n.tier.icon; $('#sWord').textContent = n.tier.word;
  $('#sDuo').innerHTML = ok ? duo(n) : '';
  $('#sText').textContent = sentence(n);
  openSheet(sh);
  const rollEl = $('#sRoll');
  rollEl.hidden = !n.trace;
  if (n.trace) mountRoll(rollEl, n, window.innerHeight < 700 ? 150 : 176);
  $('#pauseBtn').textContent = run.notes.length >= ROUND_LEN ? 'See results' : 'Pause';
}
function schedule() {
  const bar = $('#countdown i');
  bar.style.transition = 'none'; bar.style.width = '0%'; void bar.offsetWidth;
  bar.style.transition = `width ${PAUSE}ms linear`; bar.style.width = '100%';
  run.paused = false;
  run.timer = setTimeout(() => { if (run && !run.paused) playNext(); }, PAUSE);
}
export function pauseRound() {
  if (!run || run.paused) return;
  run.paused = true; clearTimeout(run.timer);
  const bar = $('#countdown i'); bar.style.width = getComputedStyle(bar).width; bar.style.transition = 'none';
  $('#pauseBtn').textContent = run.notes.length >= ROUND_LEN ? 'See results' : 'Continue';
}
export function togglePause() {
  if (!run) return;
  if (run.paused || run.notes.length >= ROUND_LEN) { run.paused = false; playNext(); return; }
  pauseRound();
}

export function askQuit() {
  if (!run) return;
  clearTimeout(run.timer); run.paused = true;
  if (round && round.state !== 'done') round.state = 'done';     // drop the note in progress
  showMsg('End round?', 'Unfinished rounds aren’t saved.',
    ['Keep going', () => { hideMsg(); run.paused = false; playNext(); }], ['End round', quitRound]);
}
function quitRound() { if (run) clearTimeout(run.timer); setRun(null); setRound(null); hideMsg(); show('home'); renderRange(); }

// Nothing but incoming audio ends a note or a room measurement, so if it stops, say so rather than hang.
export function micLost() {
  const c = calib;
  if (tester) { stopTester(); $('#micTestBtn').hidden = false; $('#homeErr').textContent = 'Mic stopped.'; $('#homeErr').hidden = false; }
  if (round) round.state = 'done';
  stopAudio();
  if (c) c.res(false);
  if (!run) return;
  clearTimeout(run.timer); run.paused = true;
  showMsg('Mic stopped', 'A screen lock or another app can cause this.',
    ['Reconnect', async () => { hideMsg(); run.paused = false; setStage('calib'); if (await ensureAudio()) playNext(); }], ['End round', quitRound]);
}

function showMsg(title, body, first, second) {
  closeSheet($('#sheet'));
  $('#mTitle').textContent = title; $('#mBody').textContent = body;
  $('#mFirst').textContent = first[0]; $('#mFirst').onclick = first[1];
  $('#mSecond').textContent = second[0]; $('#mSecond').onclick = second[1];
  openSheet($('#msg')); $('#mFirst').focus();
}
function hideMsg() { closeSheet($('#msg')); }
// Sheets sink away (the exit pattern) rather than vanishing; showing one again cancels a pending exit.
function closeSheet(el) {
  if (el.hidden || el.classList.contains('leaving')) return;
  const d = motion('--t-quick');
  if (!d) { el.hidden = true; return; }
  el.classList.add('leaving');
  el._leave = setTimeout(() => { el.hidden = true; el.classList.remove('leaving'); }, d);
}
function openSheet(el) { clearTimeout(el._leave); el.classList.remove('leaving'); el.hidden = false; }


/* ---------- a sung note ---------- */

export function finish(kind) {
  const r = round; r.state = 'done';
  if (kind === 'timeout') return noteDone({ midi: r.midi, kind: 'silent' });
  const s = readNote(r.frames, r.start, hz(r.midi));
  if (!s) return noteDone({ midi: r.midi, kind: 'silent' });
  noteDone({ midi: r.midi, kind: r.peek >= PEEK_VOID ? 'void' : 'ok', onset: r1(s.onset), settled: r1(s.settled), oct: s.oct, trace: s.trace, audio: run && run.keepAudio ? grabAudio(r) : null });
}
