# Browser and export workflows

[Developer README](../README.md) | [日本語](browser_workflows.ja.md)

Detailed operating notes retained from the root README. For current chip-specific
coverage, see the [Analyzer support table](vgm_analyzer/support.html) and
[package API reference](../packages/fm2612/README.md).

## Try it in the browser

You can try the WebAssembly build, the JavaScript wrapper, and the browser tools directly in the published pages.
This is the easiest way to test YM2612 control, sound design, and Genesis-oriented VGM analysis without setting up the full build flow first.

- Main page:
  [https://kyorohiro.github.io/hello_ymfm_wasm/](https://kyorohiro.github.io/hello_ymfm_wasm/)
- Sega Genesis / Mega Drive YM2612 FM Introduction with JavaScript:
  [https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html)
- Playground:
  [https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)
  Independent MSFA DX7 support is available through `await useSoundChip('dx7')`,
  including 16 voices, DX7 SysEx banks and Playground mixer/FX routing.
  Open `examples/dx7/dx7-init-sine.js` in FILES; the initial voice needs no external bank.
  Experimental SNES S-DSP is available through `await useSoundChip('snes')`: eight independent
  voices with BRR, explicit sample tuning and raw ADSR/GAIN controls.
  Try `examples/snes/snes-brr-melody.js`; its original BRR needs no game files.
  `Menu → Import → SPC…` offers **Song playback** (`useSoundChip('spc')`),
  **Instruments** (BRR, captured settings and editable SNES audition scripts),
  experimental **Song JavaScript** (readable BRR/instrument/note operations), and
  **Event trace** (a finite, editable DSP/RAM event timeline).
  All modes preserve the original SPC in a new Files folder. Instrument reference notes
  are assigned by the user; they are not inferred from BRR. Song playback runs until Stop.
  Song JavaScript records 0.1–600 seconds into `loadBRR`, `setPreset`, `setPitch`,
  `keyOn`, `timeline.waitUntil` and `keyOff` calls. The timeline starts after sample
  and preset loading; event times are elapsed seconds from that origin, so timer
  lateness does not slow all following events. PITCH remains in chip units, with no guessed
  original note names or loop structure. Song JavaScript automatically analyzes the
  BRR versions used in the chosen interval and lists their tuning reference notes.
  Reliable periodic sounds receive estimated fundamental/note/cents comments at
  32,000 Hz / PITCH4096; uncertain sounds retain provisional C4. You can correct
  each reference note and cents before converting, or use the defaults.
  Estimates can have octave errors and are not recovered original notes.
  Each confirmed reference configures both `loadBRR`'s `baseFrequencyHz` at
  `basePitch: 4096` and the generated note comments. Fractional cents are retained;
  unknown samples keep provisional `rootNote: "C4"`. This calibrates later
  `setNote`/`setFrequency` edits. The generated song itself keeps raw `setPitch`
  calls, BRR bytes, presets and timing, so its pitch does not change. No note-name
  playback calls are substituted. Reference edits reuse the capture; changing
  the duration or control step analyzes it again. Noise voices have no note label;
  pitch-modulated voices label the base pitch.
  The control step defaults to 20 ms
  (0 keeps all distinct changes; maximum 1000 ms). PITCH, volume and same-SRCN
  ADSR/GAIN updates are sampled; key and SRCN-change boundaries retain their
  original times. This is an editable approximation: initial envelope state,
  BRR snapshot timing and JavaScript timing can differ. Raw noise/pitch-modulation
  controls are retained; echo is omitted to protect relocated BRR. Warnings
  are saved with the source. Conversion rejects more than 20,000 musical events,
  256 BRRs or 64,512 total BRR bytes instead of saving partial data.
  Regenerate previously imported Song JavaScript from the original SPC to use
  the current timing and sample references; existing editable scripts are not rewritten.
  Event trace records 0.1–600 seconds, with a maximum of 1,000,000 writes.
  Edit its annotated `events` array to change raw chip values and timing; initial
  BRR/RAM and DSP bytes are saved alongside the code. It retains sample changes,
  echo, noise and pitch modulation. Note names, loops and tag fade are not inferred.
  Conversion first finds the RAM read by the DSP, then omits writes to unused CPU
  work RAM. All DSP writes remain. Generated rows include seconds and register
  labels, and the import status/source info report the retained DSP/RAM counts.
  This preserves the recorded playback; edits that reference other RAM regions
  may require additional original driver data that was not used in that interval.
  Song playback also supports opt-in `spc.onEvent(callback, {voices, types, intervalMs})`
  observations in Main and Worker. Callbacks receive distinct PITCH, signed stereo
  volume, instrument and key requests, plus raw global DSP writes. `clock` uses
  1,024,000 ticks per second; delivery is batched and is not an audio scheduling API.
  Initial notes are inferred, repeated KON requests retrigger, and a persistent KOFF
  is reported as `keyOffHeld`. The returned function unsubscribes. An `overflow`
  diagnostic reports interrupted observation; playback continues and observation
  resynchronizes without inventing missing history.
- Playground Runtime Embedded Demo:
  [https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html](https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html)
- Synth:
  [https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html)
  In `Envelope`, choose OP1–OP4 and drag the points to edit AR/TL,
  D1R/SL, D2R and RR while monitoring live chip-output RMS in cyan.
  Numeric controls and Cassette instruments update together.
  The graph shows relative register values; pitch, RS and SSG-EG affect actual timing.
- VGM Analyzer:
  [https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html)
  For SPC, open **Note-ish** to analyze the chosen interval in a background Worker.
  Eight SNES voices share Live History, Pitch, Song Timeline, keyboard and fretboard
  views. BRR reference notes/cents can be corrected without changing SPC playback.
  Estimates may have octave errors; uncertain samples use provisional C4, noise
  has no note, and pitch modulation shows its base pitch. Key requests are shown;
  audible envelopes, release tails, echo and later held-sample RAM edits are omitted.
  Analysis defaults to the first 120 seconds or the shorter tagged duration, up to
  600 seconds, 20,000 interpreted events and 256 BRRs / 64,512 BRR bytes.
  A 20 ms control step is adjustable down to 0.
  **Sheet Music** shares the same analysis controls. Once analysis completes,
  export MIDI, preview sheet music, or download MusicXML / LilyPond.
  Current BRR reference corrections apply to all note exports without changing
  SPC playback. Only the analyzed interval is exported; provisional references
  and other approximations are listed in each output. MIDI keeps timing and
  pitch bends on eight voice tracks with a fixed program / velocity. Scores use
  semitone pitches, a sixteenth-note grid and assumed 4/4 with an adjustable BPM;
  they are editable reference transcriptions. Original BRR timbres are not reproduced.

[VGM Analyzer sound chip support and limitations](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/support.html)

## CLI voice and score exports

### tetorica-vgm

The VGM Analyzer is also available as the [`tetorica-vgm` npm package](https://www.npmjs.com/package/tetorica-vgm)
for command-line analysis, export and WAV rendering (Node.js 22+).

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
npx tetorica-vgm render song.vgz --output song.wav
```

See the [CLI quick start](../packages/vgm/README.md) and [full CLI / Node API reference](../CLI.md).
For maintainers, see [release procedures](../README_RELEASE.md).

OPL-family melodic voices can be exported as SBI (2op or OPL3 4op), individually
or as a ZIP. The browser's **SBI Info** tab displays extracted voice parameters
and provides keyboard audition.

Export the voice on channel 1 at 1.5 seconds (`--channel` is 1-based):

```sh
npx tetorica-vgm export song.vgz --format sbi --at 1.5 --channel 1 --output voice.sbi
```

Extract melodic voices from the whole track into a ZIP:

```sh
npx tetorica-vgm export song.vgz --format sbi-zip --output voices.zip
```

