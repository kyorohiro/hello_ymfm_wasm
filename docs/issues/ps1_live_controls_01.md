# PS1 live ADSR and manual audition continuity

Date: 2026-10-29.

Keyboard note transitions and ADSR edits were producing avoidable discontinuities.
The editor had restarted the voice with KON after every applied ADSR edit,
resetting both the sample position and envelope level. Fast key-off and replacement
notes could also jump directly between nonzero PCM and silence. The louder initial
sample used only eleven filter-0 quantization levels.

## Changes

- Live ADSR edits explicitly refresh the active stage while retaining sample
  position and current envelope level. Attack changes during Sustain affect the
  next Attack rather than restarting it. Disabling the live checkbox retains
  next-key-on application.
- Manual audition uses per-voice 128-native-frame transitions, approximately
  2.9 ms at 44,100 Hz. Replacement notes fade the previous voice before restarting;
  very fast releases gain a minimum duration. Slower and indefinite releases
  keep their programmed behavior. A late note-off cannot cancel a replacement.
- The initial 64-byte sample now equals the existing editor's encoded 0.65 Sine.
  The preparation-side encoder is not added to AudioWorklet. Mixer gain remains
  0.128832, and uploaded samples retain their existing bytes.
- Browser and Native share the same C++ extensions. Native command admission
  validates the target channel, manual lease and matching on/off action.
  The common inspector restricts these controls to its own manual audition.
- The live checkbox is labelled **Apply ADSR / PCM edits to my held note**.
  ADSR edits no longer retrigger; explicit PCM edits still restart the voice.
  Existing raw register and musical Synth key-on/off semantics remain unchanged.

These are instrument extensions, not claims of hardware-accurate PS1 live ADSR.
Hard transport Stop still silences immediately. Replacing active waveform RAM,
large volume changes or deliberately discontinuous waveforms may produce their
own discontinuities; this change does not claim that all audible noise is removed.

## Fixed SDK source

Canonical changes are in `w/tetorica-soundchip-native`. A deterministic unpublished
0.1.7 local source candidate is imported into both the main repository and Tauri.
The pins explicitly identify its 0.1.6 base commit and all twelve changed paths;
no published commit or tag is claimed. Its source ZIP SHA256 is
`cf1e9c7a0426d72d04d470a9a24948659514fbe5247866631d24cc764a77fc71`.
The pristine upstream files are unchanged. The SDK recipe exports the two added
C functions, and source bundles retain licenses and the fixed-SDK manifest.

## Numerical checks

[Actual shipped WASM measurements](ps1_live_controls_offline_01.json) show a
maximum adjacent step reduction of 128 times for the DC fast-release fixture and
82.58 times for its repeated-note fixture. These are controlled fixture results,
not claims about every waveform or human listening.

An Attack edit during Sustain produces 8,192 stereo frames identical to an
unedited held voice, including phase. A live decreasing Sustain changes the
subsequent amplitude gradually; the first sample retains the original phase and
level. A stale note ID leaves the replacement's 1,024 stereo frames identical.

The standalone C++ fixtures compare 71,880 normal-playback stereo frames with
an authenticated SDK 0.1.6 golden: SHA256
`3146ef5d3ebdd4fa2775e1f845597a5274bf136c8c7809fbbd9518e2bafa5f81`.
This protects raw behavior independently of the new manual controls. Partitioning,
rapid on/off, cancellation, reset, long/infinite release and channel isolation
are covered. [The retained baseline](ps1_live_controls_baseline_01.json) identifies
the old source and exact fixture.

[Initial-sample measurements](ps1_live_controls_starter_levels_01.json) show that
the new starter and editor Sine produce identical PCM at 44.1 and 48 kHz. Relative
to the former coarse sample, RMS error against the target sine falls from
0.03452156 to 0.01665394. The first filter-0 packet still has quantization steps;
the maximum waveform step itself is not reduced by this sample replacement.

## Integration checks

- Native linked regression: 760 pass, two existing device/benchmark tests ignored.
- Native/Worklet JS tests: 36 pass, including actual live decay and no-KON phase
  continuity at 44.1 and 48 kHz.
- [Source browser checks](ps1_live_controls_browser_01.json): Chromium/WebKit ×
  Main/Worker, four routes. Keyboard, graph/numeric edits, other-voice isolation,
  reverb, error recovery, additional-SPU disconnect and idle safety are covered.
- Browser capture uses actual SPU AudioWorklet output with physical output muted.
  Human listening, the Tauri GUI and new remote CI are not represented by these
  automated results.

## Calibration and distributions

The changed shared runtime is covered by newly captured full raw calibration
reports for [PS1](ps1_chip_levels_live_controls_01.json),
[WonderSwan](wonderswan_chip_levels_live_controls_01.json) and
[POKEY](pokey_chip_levels_live_controls_01.json). All four original raw reports
remain byte-identical. New records require exact current script/runtime/WASM
hashes, rather than reusing the old reviewed UI receipts. Calibration and generator
regression: 371 pass. Both generated policies pass reproduction checks.

PS1 remains 0.128832; WonderSwan remains 1.172528. Genuine POKEY remeasurement
changes only its final RMS rounding digits: primary 0.413033 → 0.413037,
dual-first 0.413033 → 0.413038, dual-second 0.413034 → 0.413038, and
extra 0.413033 → 0.413039. The maximum change is 0.00145%; there is no hand-tuned
correction. Two global-clock diagnostics in the POKEY raw report are retained;
all independent captured PCM pilots are continuous.

Both Playground archives pass CRC validation. The Run ZIP contains 931 files,
SHA256 `ab0d5bbbd4dea1374cbc7230895a7a98e4a4365877e2c50db2ca763db9999493`.
The actual bundled/minified [Run ZIP browser checks](ps1_live_controls_run_browser_01.json)
pass WebKit Main/Worker, including Keyboard, ADSR dragging, held-note edits,
waveform/reverb edits, other-voice progress, disconnect and recovery.
The complete ZIP is SHA256
`16ecb27653fd5bd4c753c5b821a54a83bca65a7b9aeb8b99aa5c5125759c830a`.
Tauri imports its 1,066 nonmetadata frontend payloads and verifies the lock and
matching fixed SDK pin. Native tests used the same candidate SDK. Tauri Python
31 and Node 31 checks pass; no Tauri GUI or physical device is opened.

The local npm payload builds 335 modules / 28 engines / 385 checked declarations.
Its 1,004-file tarball passes isolated installation, actual Synth/Worklet PCM,
source/license checks and NodeNext/Bundler/browser types. This is a local build,
not an npm publication. SDK source/inventory tests: Node 107 and Python 26 pass.
No commit, push, SDK/npm/itch publication or new remote CI is performed.

