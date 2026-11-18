# PC Engine / PC98 Synth refinements — 2026-11-18

Base `db1e739d5bf8dac68bf93aa3aea34ef098153b25` for these application files.
The prior staged SCSP work and index are retained. This task covers PC Engine
output level, PC98 ADPCM-B release, both New Cassette menus, and subsequent
user requests for editable media test waves and media keyboard playback.

## PC Engine output and media experiments

The HuC6280 source fader remains at the common measured 44% and its native
balance remains unity. A Synth-only HuC factor of four (+12.04 dB) now applies
once to keyboard / Code / audition and the HuC part of VGM playback. MSM5205
and CD-DA retain their prior levels, including mixed VGM's MSM component.
The raw song-engine default remains unity; the application opts into factor
four and uses a distinct checkpoint key. Raw native/WASM, wave/sample data
and generated common Mixer policy are unchanged.

This source-only correction precedes shared Code FX and increases HuC FX
drive. It is intentionally different from SCSP's shared post-FX compensation.
The Mixer label shows HuC6280 ×4 with an explanatory title; percentages retain
their input units. Default Sine peak at Master 100% changes from −33.27 to
−21.23 dBFS and at 380% from −21.68 to −9.63 dBFS. Default six-note 100% peaks
at about 0.475. Imported high-level sounds, dense sums and boosts can clip;
there is no limiter or per-note normalization.

Both media tabs now have **Test waveform · Software PCM**: Sine / Triangle /
Saw / Square, 128-point cycle drawing, Frequency / PCM level / Length, optional
5 ms edge smoothing and Auto load. Shapes load immediately, while drawing and
sliders load only after release/change. Auto Off stages an explicitly marked
draft. Loading never starts playback. Standard stereo PCM16 / 44.1 kHz WAVs
are saved under `samples/` within the existing Cassette budget; editor-owned
paths are reused only while their revision matches. User file/directory
conflicts allocate a suffix, and failed budget validation is atomic.

MSM5205 uses its existing ADPCM encoder, Rate, Loop and decoded-wave display.
CD-DA uses its original-rate PCM track player / seek. These are software test
sources, not new hardware oscillators. Separate widget cycles/parameters stay
in the current session, while the generated WAV is portable. New resets the
widgets and cancels their pending loads.

The shared keyboard is available in both tabs. Any key monophonically plays
the selected MSM sample at its chosen Rate / Loop or restarts the selected
CD-DA track at 44.1 kHz; Pitch is disabled. Empty sources remain silent and do
not initialize audio. Software-trigger ownership uses the source's accepted
playback generation and a conditional Stop. Older key-up cannot stop a newer
key or UI/Code playback; pending readiness is cancellable without cancelling
unrelated UI preparation. Tab changes, blur, Stop, New and disposal retire
keyboard-owned work. This is source Play/Stop behavior, not an emulated pitch
or envelope feature of either media device.

## PC98 ADPCM-B release

Keyboard and Synth Code `opna.adpcm.noteOff()` use an app-owned 64-step, 8 ms
volume fade with a one-128-frame scheduling lead. The existing audio-owner
performance queue applies register writes at sample positions. Owner-only
cancellation preserves unrelated FM/SSG reservations. Raw `keyOff()` remains
immediate, requested volume/gate captures remain canonical, and retrigger /
sample/preset/Stop/dispose or later VGM writes cannot receive an old tail.
Paused/playing reference audition uses frame-sliced app scheduling, with the
ordinary VGM render path unchanged when no manual release is active.

Thirty actual-native cases cover 44.1 / 48 kHz, short/long releases, Code,
repeat/one-shot, retrigger, mute / volume / capture, preset and song takeover.
The maximum release step falls by about 86–87%. No shared YM2608 runtime,
native core, performance queue implementation or calibrated gains changed.

## New Cassette and labels

Both menus place **New → Cassette…** above Import. Cancel, export-current and
create, or create-without-export use detached defaults / original starter and
fresh identity. PCE includes its existing three Code examples. Code never
auto-runs. Failure/cancellation restores portable Files/settings/identity;
already-retired runtime performance/media state is not restarted. External
CD-DA session WAV exclusion stays explicit. PC Engine's former Project · ZIP
labels now say **Cassette · ZIP**; existing Import / Export format is retained.

## Evidence

Artifacts live under `build/pce-opna-refinement-20261118/` and
`build/fm2608-pcm-noteoff-guard-20261118/`. The
[machine record](verification_pce_opna_refinements_20261118.json) binds final
application sources, unchanged shared inputs, native measurements, test logs,
browser reports and the actual independently extracted archives.

- Unit checks passed: **602 PCE** and **172 OPNA / shared-runtime** tests.
  The focused gain (61), test-wave (10) and media-keyboard (76) checks are
  subsets, not additional totals. Both deterministic package suites passed
  their two cases each.
- Offline checks used the unchanged native renderers: 14 PCE level cases
  and 30 OPNA release cases at 44.1 / 48 kHz. Browser PCM independently
  measured approximately 4× HuC and 1× MSM5205 / CD-DA output.
- Existing browser suites passed **188 groups** across source and extracted
  ZIP: PCE Mixer/CD-ROM² 60, OPNA 128. The new focused checker passed another
  **88 groups**: PCE 17 × two engines × two artifacts, OPNA 5 × two × two.
  All **276 groups / 20 browser runs** used permanently muted output.
- The focused checker was frozen at
  `6a194fac6f737d0f985d9fe6ec7f18f8eb232267eb43f5cd68cde02bd3474541`
  before testing the ZIPs. Its source/ZIP served-asset comparison matched
  127 PCE and 110 OPNA non-HTML assets. Real computer/screen keys, overlapping
  releases, delayed first-worklet readiness, UI/Code handoffs, tab/blur/Stop/New,
  WAV editing, backup/rollback and 390px layouts passed in Chromium / WebKit.
- Full archive comparison also verified PCE's 119 copied modules / 159 nested
  inputs / all 200 extracted files, and OPNA's 105 copied modules / 181 nested
  original inputs / 38 native inputs. Entry HTML and README transformations
  match the existing package rules. These checks use actual archive extraction,
  not just the package staging directories.
- Readable local validation archives:
  `release/tetorica_huc6280_synth_pce-opna-refine-20261118_itch.zip`
  (SHA-256 `e8077440d60b6b7264b4bb0d3e11c8ccb273d145320d768462c9edc60f2bc846`)
  and `release/tetorica_fm2608_synth_pce-opna-refine-20261118_itch.zip`
  (`f7cf044eb79f58f5ad4f48e5ea4c0094195b8b706375e935a3b74275accc77f4`).

The earlier SCSP verification's 22 source records still match both disk and
the Git index. No SCSP production, shared calibration, native core or WASM
bytes were changed by this task.

Physical output stays muted in browser checks; human listening was not
performed. No commit/push/tag, npm/version publication or Tauri changes.
