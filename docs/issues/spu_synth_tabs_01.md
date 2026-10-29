# SPU Synth: separate the live display from instrument settings

Date: 2026-10-29

## Interface

The upper Envelope view now contains only measured output-level history on a
dBFS axis. Waveform, Spectrum and the adjacent Pitch wheel remain available.
The editable ADSR guide is inside the ADSR settings tab.

Immediately below the monitor, four tabs edit the common instrument:

- **PCM**: draw or choose a short repeating waveform; selected initially.
- **ADSR**: envelope parameters, live/deferred edit option and draggable guide.
- **FX**: SPU reverb preset, send and return levels.
- **Audio**: load an audio file, choose its root note and looping option.

Instrument name and preset load/save/reset stay visible beneath every tab.
Clicking a tab or using Left/Right, Home and End changes its selected panel
and roving keyboard focus. Tab selection does not start an AudioContext,
change a sample or preset, allocate/release a note, or send an audio command.
An unfinished PCM/ADSR gesture is cancelled before its panel is hidden; the
standalone keyboard retains ownership of its sounding notes.

The shared Playground panel and the SPU engine/core are unchanged. The
standalone adapter assigns accessible panel IDs and controls visibility.
The passive analyser retains its frame limit, silence sleep and tail wake.

## Validation

`npm run test:spu-synth` passes **37 tests**. The additional output-envelope
check verifies the dBFS scale and history reset. Existing real-WASM playback,
pitch/round-robin/instrument tests and isolated distribution checks pass.

The actual candidate ZIP was CRC-checked and extracted into a new temporary
directory. Its root index passes Chromium 153.0.8010.12 and WebKit 26.6:

- Four tabs, initial PCM selection, ARIA panel relationships, keyboard wrap,
  Home/End and focus, with no audio initialization from tab navigation.
- Switching all tabs while holding a note sends zero audio commands and
  preserves the instrument, note ownership and measured PCM.
- Full-size 900 × 240 output-envelope canvas has no editable ADSR handles;
  the separate ADSR panel retains its working drag editor.
- Existing live/deferred ADSR, PCM drawing, sample import, reverb, Pitch,
  24-voice allocation, presets, tail sleep/wake, Stop and recovery checks pass.
- All four settings panels and the three monitor views fit 1440px / 390px
  layouts. Desktop ADSR/Audio and mobile PCM screenshots were reviewed.

Each browser recorded 37 PCM captures / 385,024 frames. Independent pilots and
callback clocks are continuous with no clock anomalies. Physical output was
muted; no human listening was performed. Every served byte and every extracted
ZIP member still matches the archive after execution, including the frozen
checker/helper hashes.

- [Package result](spu_synth_tabs_package_01.json)
- [Actual ZIP browser report](spu_synth_tabs_browser_01.json)
- [Distribution verification](spu_synth_tabs_distribution_01.json)

## Candidate

`release/tetorica_spu_synth_editor-tabs-dev_itch.zip`: **45 files / 5,459,216
bytes**, SHA256
`72e9ce307769eb592c804ea13696ec4ab4947a2f33f5a88e749a43057f1dac6e`.

Rebuild with `sh scripts/package_itch_spu_synth.sh editor-tabs-dev`, or supply
the desired release version. The earlier v0.1.0 ZIP and reports are retained.
No commit, push, tag, npm publication or itch.io upload was performed.
