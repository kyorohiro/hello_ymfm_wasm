# Tetorica SID Synth

Product identifier: `tetorica-sid-synth`.

[Open the synthesizer](index.html) · [C64 Playground](../playground/index.html?mode=c64)

The selected beige / brown icon is [1254px WebP](../tetorica_sid_synth.webp),
with an [original PNG](../tetorica_sid_synth.png) and
[generation prompt](../issues/tetorica_sid_icon_prompt_20261107.txt).
The header, browser icon and Tetorica home use the same artwork; the standalone
ZIP includes its local WebP.

Play three SID voices from the keyboard and explore the chip's shared filter.
The browser UI follows Tetorica's FM2612 / SPU / DMG Synths: compact keyboard,
Octave, two synchronized Pitch controls, Master up to 380%, Waveform / Spectrum,
foldable sections and controls that leave computer keys available for playing.

## Play and change the sound

1. Select **Enable audio**, or play a key to prepare audio.
2. Choose Triangle, Saw, Pulse or Noise and change the hardware ADSR codes.
3. Enable the shared filter and move Cutoff / Resonance while holding notes.
4. Save the instrument as JSON, or copy its readable Playground JavaScript.

Opening the page and editing a preset start no audio device. Master is a
software output gain; values above 100% use the orange boost color. The
oscilloscope and spectrum observe the final Master-scaled output without
adding another speaker connection.

## Three voices and oscillator modulation

Normal playback uses the three physical SID voices in round-robin order.
Allocation prefers a silent voice, then an older released tail, then the oldest
held voice. Releasing an old key cannot release its replacement. Key release
lowers the hardware Gate and leaves the hardware release envelope running.
**Stop all sound** flushes voices, queued PCM and output tails while retaining
the instrument. Stop, preset load and topology changes also reset Pitch.

Sync / Ring use **voice 3 → voice 1** as one fixed pair, giving one keyboard
note. Voice 3 runs as a silent oscillator; it is not an extra emulated chip.
Its Gate/envelope and selected output waveform do not control the modulation:
hardware Sync resets phase, and Ring changes the Triangle oscillator's sign.
Choose **Triangle** to hear Ring. Other carrier waveforms can still use Sync.

**Modulator ratio** is a software tuning control for the physical third
oscillator. It follows the played note and Pitch, from 0.125× to 8×. It does not
add a hardware modulation-depth parameter. Ratios / notes / Pitch that exceed
the SID's frequency-register range are rejected before changing the current
sound. The hardware TEST control holds/resets an oscillator; topology changes
such as TEST or Sync / Ring stop currently held keys before reconfiguration.

ADSR parameters are four-bit **hardware codes**, not seconds. The emulation
retains SID envelope state and timing behavior: changing a rate on a held note
does not start a fresh software envelope. Very rapid Gate transitions at a
maximum envelope can expose SID retrigger behavior. No hidden envelope reset,
automatic normalization or post-mix compensation is applied.

## One shared SID filter

All keyboard carrier voices share the same filter and chip volume. Select LP,
BP, HP or Notch (LP + HP), then change Cutoff (`0..2047`, a register code, not
Hz) and Resonance (`0..15`). Selecting a filter mode enables it automatically.
Disabling it routes the carriers dry. The silent modulation source stays out
of this path.

Pulse width is `0..4095`. Chip volume is the shared hardware `0..15` volume;
the separate Master control changes the host output gain. Live waveform,
pulse width, ADSR, filter, volume, ratio and Pitch edits preserve active voice
ownership. Sync / Ring / TEST topology changes, preset load and Stop clear it.

## Presets and code reuse

The portable format is `tetorica-sid-voice`, version 1. It contains the carrier
waveform / pulse width / ADSR / TEST, Sync / Ring / software ratio and shared
filter / chip volume. It does not contain a SID tune or C64 program. Invalid
files, cancelled selection and rejected edits retain the accepted instrument.
Preset files are limited to 64 KiB.

**Copy JavaScript** produces code for the initialized `sid` API in C64 mode.
The code describes the fixed physical voices, routing and frequency ratio;
standalone keyboard allocation remains host software. The modules
[preset.js](preset.js), [instrument.js](instrument.js), [audio.js](audio.js),
[processor.js](processor.js), [editor.js](editor.js) and [synth.js](synth.js)
retain comments and imports for modification. The engine reuses
[SidCore](../js/sid.js) and [SidSynth](../js/sidsynth.js).

## Model and distribution

This first Synth uses the **6581 approximation** from chips/m6581 at a fixed
PAL clock of **985,248 Hz**. Output follows the audio device (8–96 kHz).
The programmable filter is a simplified model; 8580 and analog chip variation
are not modeled. A software 12 Hz output DC blocker follows the chip.
`.sid` song playback, sound extraction, Native audio output, software LFOs and
arbitrary modulation routing are separate work; none is implied by this UI.

The chip is **zlib**, the Tetorica wrapper / UI are **BSD-3-Clause**. The
[matching source kit](../sources/sid/README.md) contains the pinned original,
marked adaptation, Native host, WASM bridge, licenses and standalone rebuild
recipe. It is separate from the fixed sound-chip SDK snapshot.

From the repository root:

```sh
npm run test:sid-synth
npm run test:sid-synth:browser
sh scripts/package_itch_sid_synth.sh dev
```

The ZIP includes readable browser JS / CSS, the original WASM, corresponding
native sources / licenses / rebuild instructions and a hash-checked archive of
the original browser inputs. Packaging does not bundle or minify these modules.
Automated browser checks mute the final speaker output; human listening and
real SID hardware comparisons remain separate checks.
