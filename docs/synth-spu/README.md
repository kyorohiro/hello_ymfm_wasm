# Tetorica SPU Synth

PlayStation 1 SPU synthesizer / emulator

[Open the synthesizer](index.html). This standalone sound laboratory uses the
same PS1 SPU WebAssembly core and editing controls as Tetorica Playground, with
the Guitar / Bass / Ukulele keyboard from the FM2612 Synth. Its silver panels,
charcoal displays and red / yellow / blue accents follow the supplied SPU
Synth icon. The original icon is used in the header and browser icons.
Master volume uses the existing calibrated PS1 System gain as its reference.

## Play and edit

1. Select **Enable audio**. Opening the page does not start an audio context.
2. Play the displayed number/letter keys or click the on-screen keys.
3. Draw the PCM cycle, drag the ADSR points, and enable reverb to try the
   shared SPU effect presets. These three sections edit one common instrument.

The keyboard rotates through the SPU's 24 physical voices, choosing an available
voice for each new note. All voices play the same instrument; there is no
per-voice selector. If all 24 voices are held, the new note replaces the oldest
held note. Releasing the older key cannot release its replacement. Guitar,
Bass, Ukulele, fret positions and octave shifts
change the visible keyboard tuning. The Pitch control bends all sounding
keyboard notes by up to two semitones, without restarting their samples or
envelopes, and returns to centre on pointer release. The **Sustain** checkbox
retains released keyboard notes; turning it off releases those notes without
releasing keys that are still held.

**Release notes** follows the programmed release stage. **Stop all sound** also
clears infinite releases and reverb tails, preserving samples and settings.
Leaving the page releases keyboard notes.

## Instrument display

**Envelope** shows the editable A / D / S / R guide with a separate strip of
measured output RMS history. The guide describes the envelope shape, not
elapsed time. **Waveform** shows the live audio signal, and **Spectrum** shows
its frequency content on a logarithmic axis. Both read the final output after
Master volume; the ±2-semitone **Pitch** wheel stays beside each view.

The display observes a passive analyser branch without adding another speaker
connection or sending updates to the audio processor. Measurements run at up
to 30 frames per second while notes or release/reverb tails are audible.
Silence, a hidden page, and Stop suspend display updates.

## Audio and instrument files

Set **Root MIDI note** and **Loop imported audio** before choosing **Load audio**.
Audio files supported by the browser are decoded at 44,100 Hz, mixed to mono,
and encoded into SPU ADPCM in a preparation worker. Root MIDI note declares
the source recording's pitch; it does not estimate or correct that pitch.
Looped recordings use the complete 28-sample packets, dropping at most 27
frames from the end. The SPU has 512 KiB of shared sample RAM; oversized files
are rejected without truncating them. Reloading the page starts a fresh bank.

**Save preset** downloads a `.spu.json` instrument containing its ADPCM bytes,
tuning, ADSR, stereo volume, and shared reverb settings.
Editable short PCM cycles retain their drawing data too. **Load preset**
validates the complete instrument before applying it to all 24 voices.
Loading audio, loading a preset or resetting the instrument first stops the
current notes. New keyboard notes then use the updated instrument.

The current session is in memory. Save instruments before reloading or closing
the page. An explicit restart after an audio-engine failure also starts a fresh
sine instrument. This standalone version provides audio-file import and short
cycle drawing; microphone recording and the full Playground Sample Editor
remain available in [Playground](../playground/index.html?mode=ps1).

## Envelope behaviour

With **Apply ADSR / PCM edits while playing** on, changed ADSR parameters update
each sounding note's current envelope stage without resetting its level or
sample position. Attack changes do not restart a note already in Sustain;
Sustain Level is the Decay target. With the option off, the running note keeps
its ADSR through release, and the next Note On reads the latest instrument
settings. PCM edits update the common cycle. With the option on, held keyboard
notes restart with the edited waveform; with it off, they are not retriggered.
Because the sample RAM is shared, this does not preserve the old waveform for
notes that are already playing.

The envelope graph shows stage relationships, not measured elapsed time.
Rates are register indexes: lower is faster. In the retained core, release
rates 27–31 hold indefinitely. The core uses the same approximate ADSR,
linear interpolation and named reverb implementations as Playground.

## Development

Serve the repository's `docs` directory over localhost or HTTPS and open
`/synth-spu/index.html`. For example, from the repository root:

```sh
python3 -m http.server 8877 --directory docs
```

The application uses the existing generated PS1 WASM and JavaScript modules;
there is no second chip implementation. The new worklet has no UI polling or
per-audio-block state messages. UI snapshots follow explicit edits and notes
and are coalesced into browser animation frames.

```sh
npm run test:spu-synth
node scripts/check_spu_synth_browser.cjs
sh scripts/package_itch_spu_synth.sh dev
```

## itch.io release

From the repository root, build a versioned release ZIP:

```sh
sh scripts/package_itch_spu_synth.sh v0.1.0
```

The output is `release/tetorica_spu_synth_v0.1.0_itch.zip`. Change the version
argument for later releases; omitting it uses `dev`. The script bundles and
minifies the application, includes its icon, WASM, sources and licences, and
checks the ZIP's integrity. It does not upload or publish anything.

Upload this ZIP as an HTML project on itch.io and select the root `index.html`.

The product code is BSD-3-Clause. Retained SPU source attribution, upstream
licenses, local changes and reproducible build inputs are described in
[PS1 SPU sources](../sources/PS1-SPU.md).
