# Cold Pitch

Train your pitch *onset*: hear a note, keep it in your head, then sing it straight on. The start of each note is scored before your ear has time to correct it.

**Use it:** https://storkme.github.io/cold-pitch/

## How it works

- Set your range by dragging the two handles under the keyboard; each key sounds as a handle reaches it. Dragging the bar between the handles moves the whole range.
- A round is 15 notes in a row, hands-free: a one-second reference note on a piano, a one-second silent step where you imagine it, then your cue to sing. A short pause follows each note, then the next one starts.
- The silent step rotates its cue from note to note (imagine, picture, feel, hold, visualise), because different people respond to different cues. Each note records its cue. A small meter shows what the mic hears during that step and turns red on anything hum-like, which voids the note.
- Every note gets two scores. **Start** is the first 100 ms after your voice begins. **Landing** is where the note settles, from 450 ms on. Both are percentages: 100% is on the note, 50% is half a semitone off. Each note is also described in words ("started about a whole tone flat, near B♭3, then slid up") and drawn as a piano roll.
- The keys play: press any key in a note's piano roll, or on the round's range keyboard, to hear that note for as long as you hold it. Slide to play neighbouring notes. Pen pressure (and some Android touchscreens) sets the volume.
- The end of a round shows both averages, a keyboard map of where in your range you start and land well, and up to three plain-language observations: a flat or sharp lean, sliding into notes, a weaker part of your range, warming up or tailing off.
- The reference is a recorded grand piano (Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0), one recording every three semitones, each retuned to exact equal temperament. A single AudioWorklet plays every note: it re-pitches the nearest recording, damps notes, caps the voice count and limits the mix, so the page never builds audio nodes per note.

## Your data

Nothing is uploaded. Everything stays in the browser, per site:

- **Rounds:** each round's scores and every note's full pitch curve are kept in IndexedDB.
- **Recordings:** by default the audio of each sung note is kept too (about 1.5 MB a round), so you can play any note back against its piano roll. You can turn this off in the progress card.
- **Moving data:** **Export** and **Import** move rounds and recordings between browsers or devices. Recordings export separately because they're larger.

## Notes

- Headphones work best: the reference tone stays out of the mic. On iPhone they also stop the tone going quiet while the mic is open. Wired is better than Bluetooth.
- A phone speaker works too. The page times the hold from when you actually hear the tone end (using the latency the browser reports) and ignores the mic while the tone's tail is still arriving. Low notes are thin through a phone speaker.
- The mic needs a secure page: the hosted https version, localhost, or the file opened directly in Chrome.
- If the mic or audio stops mid-round (screen lock, a call, another app taking the mic), the page says so and reconnects on the next tap instead of hanging.

## Development

One self-contained HTML file, with the piano samples embedded. There's no build step and no dependencies; fonts come from Google Fonts, with system fallbacks. Open it directly, or serve the folder:

    python3 -m http.server

GitHub Pages serves `main` from the repo root. `.nojekyll` skips the Jekyll build.

Motion follows a small design language, written at the top of `index.html`'s styles: principles, shared duration and easing values (`--t-*`, `--ease-*`), and named patterns (enter, pop, exit, swap, glide, reveal, count, press, ambient). New animations should use those values rather than their own timings. Reduced motion sets every duration to zero.
