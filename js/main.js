// Start-up: the frame loop, buttons and shortcuts, redrawing on resize, and getting the piano ready. (Saved rounds
// start loading in storage.js.)

import { calib, ctx, lastDb, stream } from './audio/mic.js?v=c238679ebb';
import { audioOut, muted, setMuted } from './audio/piano.js?v=c238679ebb';
import { buildPicker, drawTester, renderRange, tester, testMic } from './home.js?v=c238679ebb';
import { askQuit, calmProgress, hearAgain, micLost, practiceNext, practiceNote, show, startFromHome, startPractice, startRound, togglePause } from './round.js?v=c238679ebb';
import { drawListen, setStage } from './stage.js?v=c238679ebb';
import { lastFrameAt, round } from './state.js?v=c238679ebb';
import { drawKeysMap, drawNotesChart, pickDetail, setMapMode } from './summary.js?v=c238679ebb';
import { $, clamp } from './util.js?v=c238679ebb';

function tick() {
  requestAnimationFrame(tick);
  if (tester && tester.live) drawTester();
  if ((calib || (round && round.state !== 'done')) && performance.now() - lastFrameAt > 2000) micLost();
  const r = round;
  if (!r || r.state === 'done' || !ctx) return;
  const now = ctx.currentTime;
  let phase;
  if (now < r.toneEnd) phase = 'tone';
  else if (now < r.go) {
    phase = 'hold';
    const p = r.practice ? calmProgress(r, now) : (now - r.toneEnd) / (r.go - r.toneEnd);
    $('#holdRing').setAttribute('stroke-dashoffset', (452.39 * (1 - p)).toFixed(1));
  }
  else if (r.state === 'capture') {
    phase = 'capture';
    const lv = stream ? clamp((lastDb + 80) / 60, 0, 1) : 0;
    $('#core').style.transform = `scale(${(0.92 + lv * 0.22).toFixed(3)})`;
  }
  else phase = 'sing';
  setStage(phase);
  if (phase !== 'tone') drawListen(r, phase, now);
}

/* ---------- wiring ---------- */
$('#startBtn').addEventListener('click', () => startFromHome());
$('#howBtn').addEventListener('click', () => startPractice());
$('#pReplay').addEventListener('click', hearAgain);
$('#pNext').addEventListener('click', practiceNext);
$('#pAnother').addEventListener('click', practiceNote);
for (const id of ['#pSkip', '#pStart']) $(id).addEventListener('click', () => startRound());
$('#micTestBtn').addEventListener('click', testMic);
$('#soundBtn').addEventListener('click', () => { setMuted(!muted); if (!muted) { try { audioOut(); } catch (e) {} } });
$('#soundBtn').addEventListener('animationend', () => $('#soundBtn').classList.remove('nudge'));
$('#quitBtn').addEventListener('click', askQuit);
$('#pauseBtn').addEventListener('click', togglePause);
$('#againBtn').addEventListener('click', () => startRound());
$('#homeBtn').addEventListener('click', () => { show('home'); renderRange(); });
// Back to home (see show()). Mid-round, Back asks before ending it, putting the entry back in case you keep going.
// Forward onto a screen that's already been left just steps back again.
if (history.state && history.state.cp) history.back();    // reloaded on a screen above home: the page opens at home
addEventListener('popstate', () => {
  const cur = document.querySelector('.screen:not([hidden])').id;
  if (history.state && history.state.cp) { if (cur === 'home') history.back(); return; }
  if (cur === 'home') return;
  if (cur === 'run') { history.pushState({ cp: 'run' }, ''); askQuit(); return; }
  show('home'); renderRange();
});
for (const b of document.querySelectorAll('[data-map]')) b.addEventListener('click', () => { setMapMode(b.dataset.map); drawKeysMap(); });
$('#chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) pickDetail(+b.dataset.i); });
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const inRun = !$('#run').hidden;
  if (e.key === 'Escape' && inRun && $('#msg').hidden) { e.preventDefault(); askQuit(); return; }
  if (e.key !== ' ' || (e.target.closest && e.target.closest('button,input,select,textarea'))) return;
  if (!$('#home').hidden) { e.preventDefault(); startFromHome(); }
  else if (inRun && !$('#sheet').hidden && $('#msg').hidden) { e.preventDefault(); togglePause(); }
});
let rz = null;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => {
  renderRange(); if (!$('#summary').hidden) { drawKeysMap(); drawNotesChart(); }
}, 80); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!$('#home').hidden) renderRange(); });

buildPicker();
try { audioOut(); } catch (e) {}                   // make the context and decode the piano now, so the first key is ready
renderRange();
requestAnimationFrame(tick);
