// Re-scoring saved rounds from their recordings when the way a note is read changes, so old and new scores compare.
//
// Version 2 (2026-09-27): the voice is found by its clarity rather than its loudness, Start is timed from its first
// clear frame, the mic's DC offset is removed, and a miss of 6-9 semitones is a wrong note, not the wrong octave.
// Each re-scored note and round keeps its earlier values under `was`, and a note's recording has its t0 moved to
// match the new start. Notes without a recording keep their scores. A round waits until all of its recordings are
// here, since recordings can be imported after the rounds.

import { framesOf, leadIn, noteBegins, readNote, roomOf } from './audio/pitch.js?v=803d44b224';
import { accuracy } from './scoring.js?v=803d44b224';
import { DB, packTrace, rounds } from './storage.js?v=803d44b224';
import { hz, mean, r1 } from './util.js?v=803d44b224';

export const SCORING = 2;

// Re-read one recorded note. Null if no clear voice is found in it.
function rescoreNote(n, clip) {
  const frames = framesOf(clip.pcm, clip.sr, clip.t0), room = roomOf(frames);
  let i = 2; while (i < frames.length && !noteBegins(frames, i, room)) i++;
  if (i >= frames.length) return null;
  const s = readNote(frames, leadIn(frames, i - 2, room), hz(n.midi));
  return s && { ...s, shift: s.onsetT };               // the new start, on the old start's clock
}

let busy = null;
export function rescore() { return busy || (busy = run().finally(() => { busy = null; })); }
async function run() {
  const todo = rounds.filter((r) => (r.v || 1) < SCORING);
  if (!todo.length) return 0;
  const have = new Set(await DB.clipKeys());
  let done = 0;
  for (const r of todo) {
    const ids = r.notes.map((n, i) => n.rec ? `${r.ts}:${i}` : null);
    if (ids.some((id) => id && !have.has(id))) continue;          // a recording is missing: maybe it's imported later
    const clips = [];
    for (const [i, n] of r.notes.entries()) {
      if (!ids[i] || (n.kind !== 'ok' && n.kind !== 'void')) continue;
      const clip = await DB.clip(ids[i]), s = clip && rescoreNote(n, clip);
      if (!s) continue;
      n.was = { onset: n.onset, settled: n.settled, oct: n.oct, trace: n.trace };
      n.onset = r1(s.onset); n.settled = r1(s.settled); n.oct = s.oct; n.trace = packTrace(s.trace);
      if (clip.t0was == null) clip.t0was = clip.t0;
      clip.t0 = +(clip.t0 - s.shift).toFixed(4); clips.push(clip);
    }
    const ok = r.notes.filter((n) => n.kind === 'ok'), landed = ok.filter((n) => n.settled != null);
    r.was = { v: r.v || 1, score: r.score, landing: r.landing };
    if (ok.length) r.score = Math.round(mean(ok.map((n) => accuracy(n.onset))));
    r.landing = landed.length ? Math.round(mean(landed.map((n) => accuracy(n.settled)))) : null;
    r.v = SCORING; r.rescored = Date.now();
    await DB.putClips(clips); await DB.putRounds([r]);
    done++;
  }
  return done;
}
