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

## extras/

What a real piano does beyond the struck note, from the same recording session and under the same licence
(Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0, edited). Opus only (`<name>.webm`, 48 kHz stereo); the page
loads them in the background after the base set, and only where it plays the base set's Opus files. About 2.2 MB.

- **A second recording of each note** (`<note>v9.webm`, the archive's velocity layer 9, 128 kbps; 1.1 MB), so
  repeated and slid-to keys alternate between two recordings instead of striking the same one each time. Edited as
  the base set, and aligned to it: the attack at 0.020 s (placed by matching v9's attack envelope to v8's), 3.0 s,
  the last 0.6 s faded. `gain` brings it to the base set's loudness (RMS 0.11 over the 0.5 s from the attack), so
  the two alternate at one level; `cents` is the base set's tuning plus v9's measured offset from v8 (under 1 c).
- **Key release noise** (`rel<key>.webm`, 64 kbps; 0.2 MB): the key and damper sound as a key comes up, one per
  key from C2 to C6 (the archive's `rel<key - 20>.wav`). Played unpitched. Faded in over 2 ms and out over the last
  50 ms; nothing else changed.
- **String resonance** (`harmS<note>`, `harmL<note>`, `harmV3<note>.webm`, one every three semitones, 64 kbps;
  0.9 MB): the strings ringing on as the damper drops, recorded soft (S), loud (L), and a quieter third layer (V3).
  Pitched to the key like the notes. Changes:
  - trimmed to 1.5 s, the last 0.3 s faded with a half cosine. What the trim removes is at least 60 dB below the
    note's peak (and includes a bump recorded at about 2.1 s in two of the files);
  - **cleaned where the recording was off pitch** (30 of 51 files, `"cleaned": true`). Measured against the key's
    own note, partial by partial up to 5 kHz (inharmonicity tracked), many resonances carry energy well off the
    key's pitch: most often the lowest partial, 20 to 65 cents sharp from C2 to A3, and some upper partials 5 to 10
    cents off. A cleaned file keeps only the partials that sit within 2.8 cents of each other (the window keeping
    the most energy) and filters out everything else: a fixed, zero-phase mask of narrow bands (12 Hz flat, 8 Hz
    cosine skirts) around each kept partial's measured frequency, so nothing in it varies over time. They lose
    0.3 to 9 dB, the energy that was off pitch. The other 21 files are within 3 cents as recorded and unchanged;
  - `cents` tunes each file to its note from these measurements: every partial within 20 dB of the file's strongest
    lands within 3 cents of the key's note (checked on every key, C2 to C6, on these encoded files).

`extras/manifest.json`: `layers` (`name`, `midi`, `cents`, `gain`, as the base set), `keyNoise` and `resonance`
(`name`, `midi`, `gain`, `cents` where pitched, `kind` S/L/V3), and for each release sound the level the archive's
sfz plays it at: `vol` (dB), `track` (velocity tracking, %) and `rt` (dB lost per second the key was held), with
`noteTrack` the notes' own velocity tracking. `gain` returns each file to the recording's level against the notes
(the files are peak-normalised to -1 dBFS).
