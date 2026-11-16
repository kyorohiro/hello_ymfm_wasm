# YM2149 Sync-buzzer example — 2026-11-17

Scope: a runnable, readable example using the existing browser timed API.
The implementation checkpoint is `2e67ed92`; the restart notes were committed
as `523705f2`. This follow-up changes the YM2149 Files adapter, example source,
tests and documentation. Runtime, DSP, WASM, mixer gains, saved default Code,
snapshot semantics and the original timed-source receipt are unchanged.

## User workflow and behavior

1. Open Files and press **Examples**.
2. Select `/examples/sync-buzzer.js`, switch to **Code**, and press **Run**.
3. Use the existing Waveform / Spectrum monitor. Console shows the compiled
   `R13 = 8` write and each new retrigger rate. `/examples/README.md` contains
   the experiment instructions.

The example uses CH1 for a melody, with separate named `melody` and
`buzzer-motion` loops. Notes occupy 0.4 beat plus a 0.1 beat gap. Every two
beats the motion loop replaces its compact Worklet reservation, stepping
through 100 / 125 / 160 / 200 Hz. Individual retriggers do not use JavaScript
timers. BPM changes musical loop timing, not the physical rates in Hz.

The slow rate step intentionally reanchors the repeat schedule. Removing the
entire motion loop on Apply cancels its reservation. Removing only the
`schedule()` call while keeping that loop does not; explicit `clearSchedule()`
within that owner is supported. Cancellation stops future writes and does not
restore previous registers or disable the natural hardware envelope.

The button adds missing JS / README files only. It waits for local restoration,
keeps `index.js`, edited examples, settings, selection and Keyboard / Code mode,
and never runs Code or acquires audio. Insertion is atomic through the existing
project size validation. Examples are ordinary editable Files and round-trip
through Cassette without a new project format.

## Hardware check

The shipped 2 MHz YM2149, type `0x10`, flags `1`, uses 32 envelope levels.
Period 100 and Shape 8 naturally repeat at 78.125 Hz (12.8 ms). Same-value R13
writes every 10 ms restart the shape sooner. The isolated-envelope test
disables both Tone / Noise on CH1 and keeps the other channels silent.

At both 44.1 and 48 kHz, compilation retains all 100 authored Shape 8 writes
in a one-second test. Dispatching the compiled writes to the shipped WASM
produces a waveform repeating at 441 / 480 frames, measurably different from
the free-running control. The natural control also agrees with its documented
12.8 ms period within output-frame quantization. No audio device is opened.

This deliberately aligned case is not a general claim of identical waveform
cycles at arbitrary trigger rates. R13 restarts the shape without resetting
every internal divider. The audible example also enables Tone, so its spectrum
contains the melody and envelope interaction.

Primary references:

- [Yamaha YM2149 datasheet](https://ftpmirror.your.org/pub/misc/bitsavers/components/yamaha/YM2149_199209.pdf).
- [Arnaud Carré's YM format specification, preserved mirror](https://www.lynn3686.com/ym3456_tidy.html), including Sync Buzzer / R13.
- [Included envelope implementation](../../third_party/mame-ay8910/ay8910.h).

## Automated verification

- `npm run test:ym2149-st-synth`: 126 passing, including the 11 example / real
  WASM cases and the 26 Files cases, plus existing Synth and deterministic
  source-preserving package checks. These counts overlap and are not additive.
- Both existing mixer-default generation checks pass. There is no need to
  remeasure unchanged audio code or modify historical calibration reports.
- [Source browser workflow](verification_ym2149_buzzer_browser_20261117.json)
  and [final packaged browser workflow](verification_ym2149_buzzer_package_browser_20261117.json)
  both pass Chromium / WebKit. All physical destination routes use Gain 0;
  actual pre-mute PCM is nonzero, and Stop reaches silence. This is not human
  listening evidence.
- The browser runs the actual Files example: 100 / 125 / 160 / 200 Hz motion,
  compiled R13 table, independent melody, rate / beat edits on Apply, failed
  Apply preserving the previous performance, owner cancellation after removing
  the motion loop, and no writes after Stop. Sentinels are written only after
  cancellation acknowledgements, so valid in-flight writes are not mistaken
  for leaks.
- Selecting CH1 and turning Tone off updates R7 while both loops remain active;
  keyboard press / release also preserves the performance. Files browsing,
  source edits and re-adding examples create no AudioContext before Run and
  preserve edited `index.js` / example text. At 390 px the document remains
  390 px wide; the Files / Code layout was also visually inspected at 1280 px.
- No uncaught browser errors or missing local resources. Browser checks block
  external CDN requests and exercise the existing offline text-editor fallback;
  they do not claim to test the CDN's availability or Monaco rendering.

## Distribution

Generated locally, not published:

- `release/tetorica_ym2149_st_synth_sync-buzzer-dev-20261117_itch.zip`.
- 202 files; 2,435,675 bytes.
- SHA-256: `27b5421691f73074e93f3f25df8e32e7f941aeeeff6cb3882430ea98b9e4d85b`.

The static example-module import is included unchanged by the existing readable
module copier and authenticated in the package source receipt / input archive.
No new minification, bundling, packager entry point or runtime sync is required.

## Remaining scope

This demonstrates host-scheduled YM2149 writes and hardware envelope behavior.
It does not emulate Atari ST instructions, MFP timer quantization or interrupt
latency, nor prove physical analog equivalence. Human listening remains useful.
Timed volume modulation and volume-register sample playback are later examples;
Native timed execution and new OPN resolver coverage remain separate tasks.

See [TODO](todo_ym2149_st_synth_20261116.md) and
[the previous timed API verification](verification_ym2149_timed_api_20261116.md).
