# SMSGEAR Synth basic application verification — 2026-11-20

Entry: `docs/synth-smsgear/index.html`. Adopted icon: `docs/tetorica_smsgear_synth.webp`.
The app uses existing Sega PSG and YM2413 native endpoints, shared Files / Code
helpers and calibrated mixer policy. It does not instantiate a YM2612 instrument.
Application guide and limitations: [README](../synth-smsgear/README.md).

## Local checks

- `node --test docs/synth-smsgear/*.test.mjs scripts/package_itch_all.test.mjs`: **25 passed** (11 application checks, 14 batch-packaging checks).
- Actual WASM reference rendering at 44,100 and 48,000 Hz: Game Gear pan, output mute without stopping chip time, exact frozen Pause position, resumed writes; YM2413-only output is finite, nonzero and mono.
- Preset normalization, source-preserving VGM/VGZ import, invalid/truncated/dual-chip rejection, static capture pan and Cassette working/saved preservation.
- Code declaration selection checked in the suite; a strict TypeScript consumer was also checked locally against the generated declarations.
- `node scripts/generate_soundchip_mixer_presets.mjs --check`: **passed**. No canonical runtime/core or calibration policy edits.
- `git diff --check`: **passed**.

## Browser / ZIP checks

`node scripts/check_smsgear_synth_browser.cjs` checks Chromium and WebKit with
an unconditional zero-gain stage before every physical audio destination.
Actual signal is measured before that stage; no sound is played through speakers.

Checks include passive startup/import, PSG and FM notes, Code Run/Stop,
keyboard input view changes without stopping Code, persistent expanded layout,
VGM Play/Pause/Resume/Stop, frozen reference position while auditioning,
Capture keeping paused transport, failed import keeping the current sound and
390px layout without horizontal overflow. The CDN is blocked to verify the
plain-text editor fallback. This does not verify CDN-hosted Monaco itself.

The same checks pass on the extracted standalone ZIP in both engines:

```sh
node scripts/package_itch_smsgear_synth.mjs ready build/smsgear-check/package
node scripts/check_smsgear_synth_browser.cjs \
  --root=build/smsgear-check/package/extracted-ready \
  --entry=/index.html --out=build/smsgear-check/package-browser.json
```

Candidate ZIP: `build/smsgear-check/package/tetorica_smsgear_synth_ready_itch.zip`
(3,998,539 bytes), SHA-256:
`c904ba44ad26b576e69404da841a3ffe7a736d84041ceaeb1473e344dfb0331c`.
ZIP CRCs and all 179 browser-module source hashes were checked against the
working tree. Authored modules are distributed without minification/bundling;
WASM, reusable runtime source kits and component licenses are retained.
Screenshots/logs are local under `build/smsgear-check/`.

## Scope and follow-up

### Follow-up: operator editing and combined Envelope

The earlier default selected fixed ROM instrument 1 while showing the stored
User patch as disabled controls. New FM presets now select User (0); existing
fixed selections remain intact. A visible **Select User to edit operators**
action and context-specific status distinguish fixed ROM and reference read-only
views. The action selects the stored User patch; it does not copy ROM operators.

OP1/OP2 now share one canvas, with colored curves and operator selector buttons.
Separate A/DR/SL/RR handles edit the selected operator. D and S labels are
separated vertically on small screens, and pointer offsets prevent parameter
jumps when starting a drag. Numeric OP controls retain their existing write path.

- **18 application checks / 32 including batch packaging passed**.
- Actual muted Chromium/WebKit checks against the standalone ZIP verify both
  +/- buttons, all four graph handles for each OP and their native register
  nibbles. The other OP keeps its parameters. Fixed-ROM disable/User action,
  Monaco, Rhythm, fractional Pitch, CH clicks and seek/mute regressions pass.
- ZIP: `build/smsgear-check/package/tetorica_smsgear_synth_operator-editor_itch.zip`,
  4,011,636 bytes, SHA-256
  `a15d1af0884982448e465b5b2ee186c8a94f23abb2c04a204827b31643ad269f`.
  ZIP CRCs and 182 readable-module hashes were checked against authored files.
- Logs/screenshots: `build/smsgear-check/operator-*`. No shared chip API, native
  runtime, publication or commit/index changes were needed.

### Follow-up: fractional keyboard Pitch

The Synth previously passed `midi + pitch` to note-name/integer-MIDI chip APIs,
raising RangeError for fractional bends. The consumer now converts the base note
to Hz, applies the semitone ratio, then uses `setFrequency` for note start and
held-note retuning. Current note leases guard retunes; drum keys are excluded.
Tone-3 Noise retunes its shared oscillator. Shared chip APIs were not modified.
The keyboard wheel is placed on the left.

Application tests: **17 passed**. Muted Chromium/WebKit tests pass for PSG/OPLL
fractional bends on held/new notes, both wheel values, Tone-3 Noise and left-side
layout, along with existing Rhythm/Envelope/transport/Code checks.
Logs: `build/smsgear-check/pitch-*`. Rebuild ZIPs to include this follow-up.

### Follow-up: physical Rhythm CHs, common keyboard and User Envelope

- CH7–CH9 remain selectable in Rhythm mode, showing only assigned percussion
  (BD; SD/HH; TOM/CYM). The shared Rhythm switch stays visible. Fixed percussion
  hides melodic/User controls; Rhythm Off restores nine melodic channels.
- Reused FM2612's `synth_keyboard.js` four-row layout. Auto Rhythm maps 1–5 to
  BD/SD/TOM/CYM/HH; melodic CH1–6 retain normal number keys, while reserved CHs
  enable only their assigned drum keys. New presets default Rhythm On, saved
  Off stays Off. Startup percussion oscillator tuning is a Synth default.
- Added two colored, draggable User Envelope guides with actual 4-bit OPLL
  parameters. EGT and channel Sustain are represented; the curves are schematic,
  before TL/KSL, not a measured output/ADSR simulator. Fixed and reference views
  are read-only. Editing uses existing working/saved and Auto-apply behavior.
- Rhythm levels are written only while Rhythm is enabled, avoiding accidental
  CH8/CH9 instrument overwrites through the shared register nibbles while Off.
- **16 application tests / 30 including batch tests passed**. Pure tests cover
  keyboard roles, default/persisted mode, Envelope geometry and 0–15 edits.
- Chromium/WebKit passed source fallback and extracted ZIP / real Monaco checks,
  muted throughout. Tests read actual OPLL registers: drum gates and output,
  physical CH assignment, melodic number keys, Rhythm Off instrument edits, and
  OP1/OP2 graph drag → numeric value → native AR nibble. Existing transport,
  CH-click, seek/mute, Files and Code checks also pass.
- ZIP: `build/smsgear-check/package/tetorica_smsgear_synth_rhythm-envelope_itch.zip`,
  4,010,251 bytes, SHA-256
  `b7219cd9cd7e4d8f1ae7f08a9fb90432e2fb00f5193bd04851228f6f51eec3cc`.
  ZIP integrity and all 182 readable source-module hashes match the working tree.
  Logs/screenshots: `build/smsgear-check/rhythm-*`.

No shared runtime, native core, npm release, commit/push, Actions run or Tauri
change was needed. Human listening with actual songs remains a follow-up.

### Follow-up: CH selection during Live refresh

`renderChannels()` previously replaced all buttons every 150ms during Live
inspection. A pointer press could lose its target before release, dropping the
click; Playwright also reproduced the detached/unstable element. Buttons are
now rebuilt only when switching chips; polling updates existing buttons' selected
and disabled states. This also retains focus and pending native button actions.

The muted browser regression holds the mouse down for 400ms across multiple
Live updates, then selects a CH during Play, Pause and after Stop. It also checks
the existing seek/mute/Code flows. Application unit tests remain 13/13.
Logs: `build/smsgear-check/channel-before.log` and `channel-fixed*`.
Rebuild the distribution ZIP to include this follow-up.

### Follow-up: seek and reference channel mute

- Position bar now reconstructs native chip history in silent, bounded 1024-frame
  Worklet slices. Play/Pause is retained, boundary-time writes are visible at the
  destination, seeking to EOF ends playback, and Stop disposes pending work.
- Reference-only PSG CH1–3 / Noise and YM2413 CH1–9 output masks live in Mixer.
  They retain registers and chip phase; masks survive seeks and replacement.
  YM2413 Rhythm percussion shares its physical CH7–CH9 masks.
- Application tests: **13 passed**; including batch packaging: **27 passed**.
  At 44,100 / 48,000 Hz, post-seek PCM matches independent continuous rendering,
  including active Noise. Mute/unmute also preserves subsequent PCM exactly.
- Chromium and WebKit passed source fallback tests, then actual Monaco tests
  against the extracted ZIP. UI checks include paused/playing seeks, unchanged
  registers while muted, replacement retaining masks and Stop during seek.
  Physical outputs were muted throughout.
- Worklet code no longer depends on `structuredClone`, which is unavailable
  in the tested audio rendering scope; defensive array/object copies are used.
- Candidate: `build/smsgear-check/package/tetorica_smsgear_synth_seek-mute_itch.zip`,
  4,000,977 bytes, SHA-256
  `b36b21fdfa3b653f7e4630d82dd4cbfd3bcd176b3043d1d538b0cac1c287b9c5`.
  ZIP CRCs and all 179 readable-module hashes match the authored source.
  Logs/screenshots: `build/smsgear-check/seek-*`.

Checkpoint caching is still pending. Long jumps rebuild from the beginning and
can take time; the UI shows progress and allows Stop. No shared runtime/core,
calibration policy, CI workflow or publication changes were made.

### Follow-up: Monaco / expanded Code

The initial browser checks blocked the CDN and did not catch expanded Code
hiding the entire input section rather than its tab heading. The heading now
has its own wrapper; the expanded editor and Master slots belong to the main
pane beside Files. Chip-tab selection is also connected to the expanded view.

`node scripts/check_smsgear_synth_browser.cjs --monaco` now checks the actual
CDN-loaded Monaco widget, rendered source, usable dimensions, positioning
beside Files and return from chip tabs in Chromium and WebKit (muted).
Both engines pass; the application unit suite remains 11/11. Logs and
screenshots are under `build/smsgear-check/monaco-fixed*`. The ZIP hash above
records the earlier candidate; rebuild to include this follow-up.

Test music is original synthetic register data; no game assets are bundled.
Actual game-driver sound quality and human listening remain unverified.
Seek checkpoint caching, direct song edits, software PSG Envelope and timed APIs
remain in the [TODO](todo_smsgear_synth_20261120.md). There was no publication,
commit/push/tag, shared runtime rebuild or Tauri work in this change.
