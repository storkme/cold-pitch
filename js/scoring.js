// How a note is scored and described: tiers, percentages and plain-language sentences.

import { nname } from './util.js?v=ab2f569ee1';

/* ---------- scoring words ---------- */
// Tiers go by how far the first moment was from the note. Past half a semitone you were nearer a different note.
export const TIERS = [
  { key: 'perfect', max: 15, word: 'Perfect', icon: '✦', tone: 'good' },
  { key: 'great', max: 30, word: 'Great', icon: '✓', tone: 'good' },
  { key: 'close', max: 50, word: 'Close', icon: '≈', tone: 'warn' },
  { key: 'missed', max: Infinity, word: 'Missed', icon: '✕', tone: 'crit' },
];
export const OTHER = {
  void: { key: 'void', word: 'Didn’t count', icon: '–', tone: 'none' },
  silent: { key: 'silent', word: 'No note heard', icon: '?', tone: 'none' },
};
export const tierOf = (c) => TIERS.find((t) => Math.abs(c) <= t.max);
export const tierFor = (n) => n.kind === 'ok' ? tierOf(n.onset) : OTHER[n.kind];
// Start and Landing as percentages: a logistic curve on a log scale of distance from the note. It's flat near the
// note (98% within 15 cents), 70% at half a semitone, and a near miss still counts for something: 29% a semitone
// off, 7% two off. (Until 2026-09-27 it was a bell curve, 50% at half a semitone and nothing past a semitone and a
// half; rescore.js moves saved rounds onto this one.)
export const accuracy = (c) => Math.round(100 / (1 + (Math.abs(c) / 70) ** 2.5));

export function size(a) {
  if (a < 30) return 'a touch';
  if (a < 70) return 'about half a semitone';
  if (a < 140) return 'about a semitone';
  if (a < 250) return 'about a whole tone';
  return `about ${Math.round(a / 100)} semitones`;
}
export const off = (c) => Math.abs(c) < 15 ? 'right on the note' : `${size(Math.abs(c))} ${c < 0 ? 'flat' : 'sharp'}`;

export function sentence(n) {
  if (n.kind === 'silent') return 'No clear note heard. Check the mic level, top right.';
  const o = n.onset, s = n.settled;
  let txt = Math.abs(o) < 15 ? `Started right on ${nname(n.midi)}` : `Started ${off(o)}`;
  if (Math.abs(o) >= 70) txt += ` (near ${nname(n.midi + Math.round(o / 100))})`;
  if (s == null) txt += '.';
  else if (Math.abs(s - o) < 20) txt += Math.abs(o) < 15 ? ' and held it.' : ' and stayed there.';
  else if (Math.abs(s) < Math.abs(o)) txt += `, then slid ${s > o ? 'up' : 'down'}${Math.abs(s) < 15 ? ` onto ${nname(n.midi)}.` : `, ending ${off(s)}.`}`;
  else txt += `, then drifted ${s > o ? 'up' : 'down'} to ${off(s)}.`;
  if (n.oct) txt += ` You sang it an octave ${n.oct > 0 ? 'up' : 'down'}, which counts.`;
  if (n.kind === 'void') txt = 'Voice heard in the silent step, so it doesn’t count. ' + txt;
  return txt;
}

export function scoreNote(n) {
  n.tier = tierFor(n);
  n.acc = n.kind === 'ok' ? accuracy(n.onset) : null;                              // start score
  n.landAcc = n.kind === 'ok' && n.settled != null ? accuracy(n.settled) : null;    // landing score
  n.ltier = n.settled != null ? tierOf(n.settled) : null;
  return n;
}
// Two small scorecards, start and landing, each in its own colour.
export function duo(n) {
  const card = (label, acc, t, none) => `<div class="mini" data-tone="${t ? t.tone : 'none'}"><span class="mi">${t ? t.icon : '–'}</span>`
    + `<b class="mv">${acc == null ? '—' : acc + '%'}</b><span class="ml"><span>${label}</span><em>${t ? t.word : none}</em></span></div>`;
  return card('Start', n.acc, n.tier) + card('Landing', n.landAcc, n.ltier, 'too short to tell');
}
// A percentage's tier: the same bands as 15, 30 and 50 cents (98%, 89% and 70%).
const BANDS = TIERS.slice(0, 3).map((t) => accuracy(t.max));
export const tierFromAcc = (a) => a == null ? null : TIERS[BANDS.findIndex((b) => a >= b)] ?? TIERS[3];
