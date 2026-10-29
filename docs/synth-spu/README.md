# Tetorica SPU Synth

PlayStation 1 SPU synthesizer / emulator

[Open the synthesizer](index.html). This standalone sound laboratory uses the
same PS1 SPU WebAssembly core and voice editor as Tetorica Playground, with
the visual style and Guitar / Bass / Ukulele keyboard from the FM2612 Synth.
Master volume uses the existing calibrated PS1 System gain as its reference.

## Play and edit

1. Select **Enable audio**. Opening the page does not start an audio context.
2. Choose one of the 24 physical voices. Each starts with its own editable sine.
3. Play the displayed number/letter keys, click the on-screen keys, or use
   **Hold to play** / **Sustain play** in the voice editor.
4. Draw the PCM cycle, drag the ADSR points, and enable the selected voice's
   reverb send to try the shared SPU effect presets.

The keyboard plays the selected physical voice. Multiple presses on that same
voice replace its previous note; releasing an older press cannot release the
replacement. Guitar, Bass, Ukulele, fret positions and octave shifts change the
visible keyboard tuning. The Pitch control bends the selected voice by up to
two semitones, without restarting its sample or envelope, and returns to centre
on pointer release. The **Sustain** checkbox retains released keyboard notes.

**Release notes** follows the programmed release stage. **Stop all sound** also
clears infinite releases and reverb tails, preserving samples and settings.
Leaving the page or switching voices releases manual notes.

## Audio and instrument files

Set **Root MIDI note** and **Loop imported audio** before choosing **Load audio**.
Audio files supported by the browser are decoded at 44,100 Hz, mixed to mono,
and encoded into SPU ADPCM in a preparation worker. Root MIDI note declares
the source recording's pitch; it does not estimate or correct that pitch.
Looped recordings use the complete 28-sample packets, dropping at most 27
frames from the end. The SPU has 512 KiB of shared sample RAM; oversized files
are rejected without truncating them. Reloading the page starts a fresh bank.

**Save preset** downloads a `.spu.json` instrument containing the selected
voice's ADPCM bytes, tuning, ADSR, stereo volume, and shared reverb settings.
Editable short PCM cycles retain their drawing data too. **Load preset**
validates the complete instrument before applying it to the selected voice.
Importing an instrument's shared reverb settings also affects other voices on
the same SPU. Other voices retain their samples and voice settings.

The current session is in memory. Save instruments before reloading or closing
the page. An explicit restart after an audio-engine failure also starts fresh
sine voices. This first standalone version provides audio-file import and short
cycle drawing; microphone recording and the full Playground Sample Editor
remain available in [Playground](../playground/index.html?mode=ps1).

## Envelope behaviour

With **Apply ADSR / PCM edits while playing** on, changed ADSR parameters update
the current envelope stage without resetting its level or sample position.
Attack changes do not restart a voice already in Sustain; Sustain Level is
the Decay target. With the option off, the running note keeps its ADSR through
release, and the next Note On reads the latest voice settings. Drawing a PCM
cycle can restart this editor's held audition when the option is on.

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

The product code is BSD-3-Clause. Retained SPU source attribution, upstream
licenses, local changes and reproducible build inputs are described in
[PS1 SPU sources](../sources/PS1-SPU.md).
