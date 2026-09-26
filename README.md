# Cold Pitch

Train your pitch *onset*: hear a note, keep it in your head, then sing it straight on. Only the first ~100 ms of your voice is scored, before your ear has time to correct it.

**Use it:** https://storkme.github.io/cold-pitch/

## How it works

- Plays a reference tone, waits a configurable hold time, then cues you to sing.
- Pitch is tracked in the browser (YIN, 65–1100 Hz) and scored as the median pitch in cents over the first 100 ms after your voice starts. It also reports the settled pitch (median from 450 ms on), the correction between the two, and how long it took to land within tolerance.
- Any voiced sound during the hold voids the attempt.
- Each session gets a report with simple significance tests: sharp or flat bias, scooping, register, pull from the previous note, change within the session, hold time, and change against earlier sessions.

## Notes

- Use headphones so the reference tone doesn't reach the mic. On iPhone they also stop the tone going quiet while the mic is open. Wired is better: Bluetooth adds a delay the timing doesn't account for.
- The mic needs a secure page: the hosted https version, localhost, or the file opened directly in Chrome.
- Nothing is uploaded. History is kept in the browser's localStorage for the page's origin, so the hosted site and a local copy each keep their own. Use Export and Import in Settings to move it between browsers or devices.

## Development

A single self-contained `index.html`: no build step and no dependencies (fonts come from Google Fonts, with system fallbacks). Open it directly, or serve the folder:

    python3 -m http.server

GitHub Pages serves `main` from the repo root. `.nojekyll` skips the Jekyll build.
