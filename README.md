# Cold Pitch

Train your pitch *onset*: hear it, feel it, hit it. Hear a note, sing it silently in your head, then sing it straight on. The start of each note is scored before your ear has time to correct it.

**Use it:** https://storkme.github.io/cold-pitch/

## How it works

- Set your range by dragging the two handles under the keyboard; each key sounds as a handle reaches it. Dragging the bar between the handles moves the whole range.
- The first time you press Start round, you get a practice note instead: the same three steps, with nothing timed and nothing saved. Listen waits for Next (and plays the note again if you like). The silent step waits for two seconds of quiet, and if it hears your voice it starts over and says why. Then you sing, and see how it went. **How it works**, under Start round, opens it again, for handing your phone to someone new.
- A round is 10 notes in a row, hands-free: a one-second reference note on a piano (named in the circle while it plays), a one-second silent step where you imagine it, then your cue to sing. Any sound works (a hum, "aah", "ooh"): the pitch is what's measured. The piano rings on gently into the silent step and is gone before you sing. A short pause follows each note, then the next one starts.
- The silent step rotates its cue from note to note (imagine, picture, feel, remember, visualise), because different people respond to different cues. Each note records its cue. A small label says what the mic hears during that step and turns red on a voice, which voids the note. From the Sing cue, a live waveform shows the mic listening: the silence you just held (dotted), the cue, and your voice arriving.
- Rounds forgive a couple of slips. The first two notes a round that don't work out (a voice in the silent step, or nothing sung) don't take a place: a fresh note replaces each one. It's a fresh note rather than the same one again, because once you've sung it aloud it isn't cold any more. The saved round lists them.
- Every note gets two scores. **Start** is the first 100 ms after your voice begins. Your voice is found by how clearly pitched the sound is, not how loud, so a soft start counts from its first moment; breath and room noise never do. **Landing** is where the note settles, from 450 ms on. Both are percentages, on a curve that's flat near the note and gentle on near misses: 98% within 15 cents, 70% half a semitone off, 29% a semitone off, 7% two off. (It was a bell curve until 27 September 2026, 50% at half a semitone and nothing past a semitone and a half; saved rounds were moved onto the new one, keeping their old scores alongside.) Each note is also described in words ("started about a whole tone flat, near B♭3, then slid up") and drawn as a piano roll.
- The keys play: press any key in a note's piano roll (after each note), or on the round's range keyboard, to hear that note for as long as you hold it. Slide to play neighbouring notes. Pen pressure (and some Android touchscreens) sets the volume.
- The home screen charts your Start and Landing across rounds, and below that every note of your last 12 rounds on one chart: older rounds fainter, one round bright (the latest, or the one you point at or tap), so you can see whether your starts are tightening. The sound button sits by the range keyboard.
- The end of a round shows both averages and every note on one chart: each note's pitch over time, in semitones sharp or flat of its note, with the Start and Landing windows shaded, so the round's shape shows at a glance (where starts landed, which way they slid, where they settled). Tap a line, or a note under the chart, to see that note's scores and hear it back. Then a keyboard map of where in your range you start and land well, and up to three plain-language observations: a held wrong note, a flat or sharp lean, starts pulled toward the middle of your range, big leaps being harder, sliding into notes, a weaker part of your range, warming up or tailing off.
- The reference is a recorded grand piano (Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0), in stereo, one recording every three semitones, each retuned to exact equal temperament. It's Opus where the browser decodes it and lossless FLAC otherwise. A single AudioWorklet plays every note: it lands each attack on its scheduled sample, re-pitches the nearest recording, damps notes, caps the voice count and limits the mix, so the page never builds audio nodes per note. Keys played by hand are released the way a hand plays: bass strings damp more slowly than treble, and on a slide the last note lingers in proportion to how long it was held. Once the base set plays, extras load in the background: a second recording of each note, so repeated and slid-to keys alternate between two, and what a key does when it comes up (its release noise and the strings' resonance as the damper drops, cleaned where the recordings were off pitch), in a small room.

## Your data

Nothing is uploaded. Everything stays in the browser, per site:

- **Rounds:** each round's scores and every note's full pitch curve are kept in IndexedDB.
- **Recordings:** by default the audio of each sung note is kept too (about 1 MB a round), so you can play any note back from the summary's chart. The note you were aiming for plays softly under it, from the moment your voice starts and in the octave you sang, so you hear where you were against it. You can turn this off in the progress card.
- **Re-scoring:** when the way notes are read improves, rounds that have their recordings are re-scored from them, so old and new scores compare. The earlier numbers are kept alongside.
- **Moving data:** **Export** and **Import** move rounds and recordings between browsers or devices. Recordings export separately because they're larger.

## Notes

- Headphones work best: the reference tone stays out of the mic. Hear yourself in them too (sidetone, or the mic monitoring your headset or system offers): with closed headphones and no sidetone you can't correct by ear, and Landing suffers, though Start doesn't. On iPhone they also stop the tone going quiet while the mic is open. Wired is better than Bluetooth.
- A phone speaker works too. The page times the hold from when you actually hear the tone end (using the latency the browser reports) and ignores the mic while the tone's tail is still arriving. If the mic can hear the piano, the note fades sooner instead of ringing into the silent step, so it can't be mistaken for your voice. Low notes are thin through a phone speaker.
- The mic needs a secure page: the hosted https version, or localhost.
- Back (the browser's, or a phone's back gesture) returns to the home screen; mid-round it asks first. Back from home leaves the site.
- If the mic or audio stops mid-round (screen lock, a call, another app taking the mic), the page says so and reconnects on the next tap instead of hanging.

## Development

Plain files: no build step and no dependencies. Fonts come from Google Fonts, with system fallbacks. The scripts are ES modules and the piano samples are fetched, so the page needs a web server; opening `index.html` from disk won't work. Any static server does:

    python3 -m http.server

GitHub Pages serves `main` from the repo root. `.nojekyll` skips the Jekyll build.

Before committing, run `node tools/stamp.mjs`. Pages lets browsers cache files for 10 minutes, so it gives every script and stylesheet URL a `?v=` stamp from a hash of the sources: a deploy then can't mix old and new files. It also lists the modules for preloading in `index.html`. `node tools/stamp.mjs --check` fails if the stamps are stale (a local pre-commit hook can run it).

What lives where:

- `index.html`: the markup.
- `css/app.css`: all the styles, starting with the motion language and the colour tokens.
- `js/main.js`: start-up, buttons, keyboard shortcuts, redrawing on resize, and the frame loop.
- `js/state.js`: the state that several modules change (the round, the note in progress), with a setter for each.
- `js/util.js`: helpers, the round's constants, and the motion helpers. `js/scoring.js`: how a note is scored and described.
- `js/storage.js`: settings, rounds and recordings in IndexedDB, Export and Import.
- `js/home.js`, `js/round.js`, `js/stage.js`, `js/summary.js`: the home screen, a round (and the practice note), the stage during a note, and the summary. `js/wave.js` draws the live waveform, `js/overlay.js` the summary's chart of every note. `js/roll.js` and `js/keyboard.js` draw the piano roll and the keyboards, and make their keys playable.
- `js/audio/mic.js`: the mic and the room check, following each note live. Its tap is `tap.worklet.js`. `js/audio/pitch.js`: reading a voice from the audio (YIN pitch and clarity, where a note starts, its Start and Landing), shared with re-scoring.
- `js/rescore.js`: when the way notes are read changes, re-scores saved rounds from their recordings, keeping the earlier values under `was`.
- `js/audio/piano.js`: loading the samples, the hum stand-in, the sound button and held notes. `engine.js` is the page's side of the AudioWorklet that plays every note, `voices.worklet.js`.
- `tools/stamp.mjs`: version-stamps the script and style URLs (see above).
- `samples/salamander/`: one stereo recording every three semitones, as Opus (`.webm`) and FLAC, and `manifest.json` with each sample's tuning and level. `extras/` has the second recordings, the key release noise and the string resonances (Opus only). Its README says where they came from and how they were edited.

Motion follows a small design language, written at the top of `css/app.css`: principles, shared duration and easing values (`--t-*`, `--ease-*`), and named patterns (enter, pop, exit, swap, glide, reveal, count, press, ambient). New animations should use those values rather than their own timings. Reduced motion sets every duration to zero.
