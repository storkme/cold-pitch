// State that several modules change. An import is a live, read-only view of the exporting module's variable, so
// these are read directly and changed only through their setters.
export let run = null;          // the round in progress: its range, notes so far and pause timer (see startRound)
export let round = null;        // the note in progress: its timing, mic frames and silence meter (see playNext)
export let lastFrameAt = 0;     // when the mic last delivered a frame (performance.now()); tick() notices it stopping
export function setRun(v) { run = v; }
export function setRound(v) { round = v; }
export function setLastFrameAt(v) { lastFrameAt = v; }
