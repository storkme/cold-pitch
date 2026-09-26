# Grand piano samples for Cold Pitch

Salamander Grand Piano V3 by Alexander Holm (a Yamaha C5), licensed CC BY 3.0:
http://creativecommons.org/licenses/by/3.0/ . Changes: one microphone channel per note, trimmed to 3 ms before
the attack, 2.5 s long with a 120 ms fade-out, peak-normalised, re-encoded as 80 kbps mono MP3 at 44.1 kHz.
Source files: https://tonejs.github.io/audio/salamander/ (the Ogg versions).

Fixed on 2026-09-26: C3 and F#3 were rebuilt from the Ogg files. Their original right channel had a weak second
harmonic (H2 about -14 and -11 dB re H1, against -1 to -3 dB on the neighbouring samples), and C3 also decayed
unusually fast (-23 dB from 0.1 to 1 s). Both now use the left channel. F#3 also has one light minimum-phase cut,
-6.5 dB at its 6th harmonic, which was 13 dB stronger than on its neighbours. There's no other filtering, and
every other sample is unchanged. C3's unison strings beat (about 9 cents apart), so its measured pitch moves by a
few cents depending on the window (-7.6 to -10.5 on the sample alone). Its `cents` is set to -9.61, the value
that centres B2, C3 and C#3 on pitch as the engine actually plays them.

## manifest.json

`attribution`, `sourceRate`, `seconds`, `preroll` (the 3 ms kept before each attack, in seconds) and `level` (the
target RMS) describe the whole set. `samples` has one entry per sample, one every three semitones, C2 to C6:

- `name`:   the note, and the MP3's file name (`file`) in this folder.
- `midi`:   the note it was recorded at.
- `cents`:  how far its partial 1 sits from exact equal temperament (A4 = 440), positive = sharp. Measured as the
            envelope-weighted mean frequency of the fundamental over 0.08-0.85 s, the part a 1 s reference note
            plays at full level before its damper (piano unisons beat, so this is the pitch you hear). Play note
            `target` at rate 2^((target - midi)/12 - cents/1200).
- `gain`:   multiplier that brings the first 0.5 s (after offset) to RMS 0.11 at rate 1.
- `peak`:   the sample's peak level at that gain (C6 exceeds 1; cap or limit it).
- `offset`: seconds of decoder lead-in to skip before the 3 ms pre-roll. Chrome's decodeAudioData trims the MP3
            encoder delay, so this is 0 there; other decoders may not (`js/audio/piano.js` checks at decode time).

Decoded, each sample is 2.5 s: 110250 frames at 44.1 kHz, 120000 at 48 kHz (decodeAudioData resamples to the
context's rate).
