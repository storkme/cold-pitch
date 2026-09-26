// Start-up: the frame loop, buttons and shortcuts, redrawing on resize, and getting the piano ready. (Saved rounds
// start loading in storage.js.)

import { calib, ctx, lastDb, lastVoice, stream } from './audio/mic.js?v=17222eed60';
import { audioOut, muted, setMuted } from './audio/piano.js?v=17222eed60';
import { buildPicker, drawTester, renderRange, tester, testMic } from './home.js?v=17222eed60';
import { drawRoll } from './roll.js?v=17222eed60';
import { askQuit, micLost, show, startRound, togglePause } from './round.js?v=17222eed60';
import { drawQuiet, setStage } from './stage.js?v=17222eed60';
import { lastFrameAt, round } from './state.js?v=17222eed60';
import { drawKeysMap, pickDetail, setMapMode } from './summary.js?v=17222eed60';
import { $, clamp } from './util.js?v=17222eed60';

function tick() {
  requestAnimationFrame(tick);
  if (tester && tester.live) drawTester();
  if ((calib || (round && round.state !== 'done')) && performance.now() - lastFrameAt > 2000) micLost();
  const lv = ctx && stream ? clamp((lastDb + 80) / 60, 0, 1) : 0;
  const bars = $('#mic').children;
  for (let i = 0; i < 4; i++) bars[i].classList.toggle('lit', lv > (i + 0.5) / 4.5);
  $('#mic').classList.toggle('voice', lastVoice);
  const r = round;
  if (!r || r.state === 'done' || !ctx) return;
  const now = ctx.currentTime;
  if (now < r.toneEnd) setStage('tone');
  else if (now < r.go) { setStage('hold'); $('#holdRing').setAttribute('stroke-dashoffset', (452.39 * (1 - (now - r.toneEnd) / (r.go - r.toneEnd))).toFixed(1)); drawQuiet(r); }
  else if (r.state === 'capture') {
    setStage('capture');
    const level = lv;
    $('#core').style.transform = `scale(${(0.92 + level * 0.22).toFixed(3)})`;
  }
  else setStage('sing');
}

/* ---------- wiring ---------- */
$('#startBtn').addEventListener('click', () => startRound());
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
$('#chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) pickDetail(+b.dataset.i, false); });
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const inRun = !$('#run').hidden;
  if (e.key === 'Escape' && inRun && $('#msg').hidden) { e.preventDefault(); askQuit(); return; }
  if (e.key !== ' ' || (e.target.closest && e.target.closest('button,input,select,textarea'))) return;
  if (!$('#home').hidden) { e.preventDefault(); startRound(); }
  else if (inRun && !$('#sheet').hidden && $('#msg').hidden) { e.preventDefault(); togglePause(); }
});
let rz = null;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => {
  renderRange(); if (!$('#summary').hidden) drawKeysMap();
  for (const el of document.querySelectorAll('.roll')) if (el._n && el.offsetParent) drawRoll(el, false);
}, 80); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!$('#home').hidden) renderRange(); });

buildPicker();
try { audioOut(); } catch (e) {}                   // make the context and decode the piano now, so the first key is ready
renderRange();
requestAnimationFrame(tick);
