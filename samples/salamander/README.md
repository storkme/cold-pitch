# Grand piano samples for Cold Pitch

Salamander Grand Piano V3 by Alexander Holm (a Yamaha C5), licensed CC BY 3.0:
http://creativecommons.org/licenses/by/3.0/ . Source: https://archive.org/details/SalamanderGrandPianoV3
(`SalamanderGrandPianoV3_48khz24bit.tar.bz2`, files `48khz24bit/<note>v8.wav`, velocity layer 8 of 16).

Changes, per note: no EQ or filtering. Every sample of real audio before the attack (8 to 16 ms in the originals) is
kept, faded in over its first min(5 ms, half of it); leading silence pads it so the attack sits at exactly 0.020 s.
Each is 3.0 s long, the last 0.6 s fading out with a half cosine, peak-normalised to -1 dBFS, and dithered to 16 bits.
Both microphones are kept (the original AB pair), so every file is stereo.

Two encodings of the same edit, the page uses the first its browser can decode:

- `<name>.webm`: Opus, 128 kbps stereo, 48 kHz (Chrome, Firefox, Edge). About 1.1 MB for the set.
- `<name>.flac`: FLAC, 16-bit, 48 kHz (the lossless fallback, e.g. for Safari). About 2.4 MB.

## manifest.json

`attribution`, `source`, `license`, `formats` (in the order to try), `seconds` (each file's length), `attack`
(seconds from a file's start to its attack) and `level` (the target RMS) describe the whole set. `samples` has one
entry per sample, one every three semitones, C2 to C6:

- `name`:   the note, and the file name before the extension.
- `midi`:   the note it was recorded at.
- `cents`:  how far its partial 1 sits from exact equal temperament (A4 = 440), positive = sharp: the
            envelope-weighted mean frequency of the fundamental over 0.08-0.85 s after the attack, across both
            channels together (what you hear in stereo). Play note `target` at rate 2^((target - midi)/12 - cents/1200).
- `gain`:   multiplier that brings the average power of the two channels, over the 0.5 s from the attack, to RMS
            0.11 at rate 1.
- `peak`:   the largest sample in either channel at that gain.
- `offset`: seconds of decoder lead-in to skip: 0 for both formats in Chrome and Firefox. `js/audio/piano.js` also
            measures each decoded attack, so a decoder that adds lead-in still lands on time.
- `monoChannel`, `monoGain`, `monoH1Db`: for a possible mono fold-down, not used yet. Summing L+R cancels the
            fundamental on some notes (`monoH1Db`, F#3 -23.8 dB), because the two microphones were spaced apart;
            `monoChannel` is the channel whose harmonic balance is closest to the stereo sound, and `monoGain` its gain.
