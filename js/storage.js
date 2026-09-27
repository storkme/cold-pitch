// Settings (localStorage), rounds and recordings (IndexedDB), and moving them in and out with Export and Import.

import { renderHistory } from './home.js?v=f594cb7eb2';
import { rescore } from './rescore.js?v=f594cb7eb2';
import { $, clamp, MAX_NOTE, MIN_NOTE, MIN_SPAN } from './util.js?v=f594cb7eb2';

/* ---------- storage ---------- */
// Settings live in localStorage. Finished rounds, with every note's full pitch curve, live in IndexedDB,
// which has room for years of them. Both belong to this site only, so Export/Import moves them between browsers.
const STORE = 'coldpitch.play.v1';
export const DEFAULT_LO = 48, DEFAULT_HI = 60;      // C3 to C4: a safe start for anyone, since any octave counts
export let settings = { lo: DEFAULT_LO, hi: DEFAULT_HI, keepAudio: true };
export let rounds = [];      // oldest first
try {
  const p = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (p && p.settings) settings = { ...settings, ...p.settings };
  else {   // borrow the range from the old detailed view, if it was used on this site
    const v1 = JSON.parse(localStorage.getItem('coldpitch.v1') || 'null');
    if (v1 && v1.settings && v1.settings.low != null) { settings.lo = +v1.settings.low; settings.hi = +v1.settings.high; }
  }
} catch (e) {}
delete settings.hold; delete settings.voice;                        // no longer choosable
settings.lo = clamp(settings.lo, MIN_NOTE, MAX_NOTE - MIN_SPAN); settings.hi = clamp(settings.hi, settings.lo + MIN_SPAN, MAX_NOTE);
export function saveSettings() { try { localStorage.setItem(STORE, JSON.stringify({ settings })); } catch (e) {} }

export const DB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB is not available'));
    const q = indexedDB.open('coldpitch', 2);
    q.onupgradeneeded = () => {   // v1: rounds. v2: one audio clip per note, kept apart so loading the rounds stays quick.
      const db = q.result;
      if (!db.objectStoreNames.contains('rounds')) db.createObjectStore('rounds', { keyPath: 'ts' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
    };
    q.onsuccess = () => { q.result.onversionchange = () => q.result.close(); res(q.result); };   // let a newer tab upgrade
    q.onerror = () => rej(q.error);
  }));
  const tx = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode), req = fn((name) => t.objectStore(name));
      t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    rounds: () => tx(['rounds'], 'readonly', (st) => st('rounds').getAll()),
    putRounds: (rs) => tx(['rounds'], 'readwrite', (st) => { rs.forEach((r) => st('rounds').put(r)); }),
    saveRound: (rec, clips) => tx(['rounds', 'audio'], 'readwrite', (st) => { st('rounds').put(rec); clips.forEach((c) => st('audio').put(c)); }),
    clip: (id) => tx(['audio'], 'readonly', (st) => st('audio').get(id)),
    clips: () => tx(['audio'], 'readonly', (st) => st('audio').getAll()),
    clipKeys: () => tx(['audio'], 'readonly', (st) => st('audio').getAllKeys()),
    putClips: (cs) => tx(['audio'], 'readwrite', (st) => { cs.forEach((c) => st('audio').put(c)); }),
  };
})();
// Frames come at a fixed hop, so a curve packs down to a start time, a step and whole cents (null where unvoiced).
export function packTrace(tr) {
  if (!tr || !tr.length) return null;
  const dt = tr.length > 1 ? (tr[tr.length - 1].t - tr[0].t) / (tr.length - 1) : 0.0105;
  return { t0: +tr[0].t.toFixed(4), dt: +dt.toFixed(6), c: tr.map((p) => p.c == null ? null : Math.round(p.c)) };
}
export const unpackTrace = (p) => p ? p.c.map((c, i) => ({ t: p.t0 + i * p.dt, c })) : null;

export let clipCount = 0;
export function setClipCount(v) { clipCount = v; }
export function dataLine() {
  $('#dataMsg').textContent = `Stored on this device${clipCount ? ` · ${clipCount} recording${clipCount === 1 ? '' : 's'}` : ''}. Export to back up or move.`;
}
function download(parts, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(parts, { type: 'application/json' })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const today = () => new Date().toISOString().slice(0, 10);
function toB64(i16) {
  const u8 = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength); let s = '';
  for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
  return btoa(s);
}
function fromB64(str) { const bin = atob(str), u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); return new Int16Array(u8.buffer); }

$('#keepAudio').addEventListener('change', (e) => { settings.keepAudio = e.target.checked; saveSettings(); });
$('#exportAudioBtn').addEventListener('click', async () => {
  let clips = [];
  try { clips = await DB.clips(); } catch (e) {}
  if (!clips.length) { $('#dataMsg').textContent = 'No recordings yet.'; return; }
  // Written in pieces so a big export never becomes one giant string. Samples are 16-bit little-endian, base64.
  const parts = ['{"app":"cold-pitch-audio","version":1,"format":"pcm_s16le","exported":"' + new Date().toISOString() + '","clips":['];
  clips.forEach((c, i) => parts.push((i ? ',' : '') + JSON.stringify({ id: c.id, round: c.round, note: c.note, midi: c.midi, sr: c.sr, t0: c.t0, pcm: toB64(c.pcm) })));
  parts.push(']}');
  download(parts, `cold-pitch-recordings-${today()}.json`);
  $('#dataMsg').textContent = `Exported ${clips.length} recording${clips.length === 1 ? '' : 's'}.`;
});
$('#exportBtn').addEventListener('click', () => {
  download([JSON.stringify({ app: 'cold-pitch-rounds', version: 1, exported: new Date().toISOString(), settings, rounds })], `cold-pitch-rounds-${today()}.json`);
  $('#dataMsg').textContent = `Exported ${rounds.length} round${rounds.length === 1 ? '' : 's'}.`;
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importEmpty').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app === 'cold-pitch-audio' && Array.isArray(d.clips)) {
      const have = new Set(await DB.clipKeys());
      const fresh = d.clips.filter((c) => c && typeof c.id === 'string' && typeof c.pcm === 'string' && !have.has(c.id)).map((c) => ({ ...c, pcm: fromB64(c.pcm) }));
      await DB.putClips(fresh); clipCount += fresh.length;
      $('#dataMsg').textContent = `Imported ${fresh.length} new recording${fresh.length === 1 ? '' : 's'}.`;
      rescoreSaved();
      return;
    }
    if (d.app !== 'cold-pitch-rounds' || !Array.isArray(d.rounds)) throw new Error('not ours');
    const have = new Set(rounds.map((r) => r.ts));
    const fresh = d.rounds.filter((r) => r && typeof r.ts === 'number' && typeof r.score === 'number' && Array.isArray(r.notes) && !have.has(r.ts));
    await DB.putRounds(fresh);
    rounds = [...rounds, ...fresh].sort((a, b) => a.ts - b.ts);
    renderHistory();
    $('#dataMsg').textContent = `Imported ${fresh.length} new round${fresh.length === 1 ? '' : 's'}.`;
    rescoreSaved();
  } catch (err) { $('#dataMsg').textContent = 'Not a Cold Pitch export.'; }
});
DB.clipKeys().then((k) => { clipCount = k.length; dataLine(); }).catch(() => {});
// Rounds scored the older way are re-scored from their recordings (rescore.js), then the history redrawn.
function rescoreSaved() {
  rescore().then((n) => { if (n) { renderHistory(); $('#dataMsg').textContent = `Re-scored ${n} round${n === 1 ? '' : 's'} from their recordings.`; } }).catch(() => {});
}
DB.rounds().then((rs) => { rounds = rs.sort((a, b) => a.ts - b.ts); renderHistory(); rescoreSaved(); })
  .catch(() => { $('#dataMsg').textContent = 'This browser won’t store rounds. Export to keep them.'; });
