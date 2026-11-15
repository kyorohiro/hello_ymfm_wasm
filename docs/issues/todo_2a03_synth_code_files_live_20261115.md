# 2A03 / NES + FDS Synth horizontal integration

Requested 2026-11-15. Begin from the existing playable Synth, shared Code /
Files components and reusable NES API. The working tree was clean at start.

## Code and Files

- [x] Add Keyboard / Code, Run / Apply / Stop, Monaco completion and expanded
      Code using the shared Synth components.
- [x] Store JavaScript, local modules, sound presets and original files in
      Files, with local recovery and Cassette import / export.
- [x] Connect Code to the same APU, Master, click guard and output monitor as
      manual keyboard playing and the upper instrument controls.
- [x] Keep Code running across sound edits, preset selection and view changes.
      Fence obsolete operations and releases when voices are reused.
- [x] Verify Pulse, Triangle, Noise, DMC and FDS, including the existing drawing,
      DPCM editing and sample ownership behavior.

## Reference songs and channel observation

- [x] Store original VGM / VGZ recordings under `/vgm/` and extracted instruments
      under `/presets/`, preserving the current edited instrument on import.
- [x] Add reference Play / Pause / Resume / Stop, position control and physical
      channel observation through the existing editor.
- [x] Add selected-channel paused audition and Capture while retaining song
      position and the authored instrument.
- [x] Keep manual controls available alongside Code or a reference song, with
      an explicit handoff between the two automatic transports.

## Distribution and verification

- [x] Verify actual AudioWorklet PCM with speakers muted, Code / manual
      coexistence, Files persistence, recovery and packaged browser operation.
- [x] Preserve readable distribution sources and existing preset compatibility.
- [x] Update the guide, package entry points and CI browser checks.

## Implementation decisions

- `useSoundChip("nes")` borrows the existing keyboard APU and Master. CH1 / CH2
  are Pulse, CH3 Triangle, CH4 Noise, CH5 DMC and CH6 FDS. Code has asynchronous
  nested methods, completion and implementation navigation.
- Auto retains the edited instrument and Pulse round robin. Numbered tabs
  align display, editing and keys with a physical channel. Selecting a tab
  reads its state. Edits apply to that channel.
- The song transport runs a separate native APU through the same AudioContext
  and Master. Human edits share that song APU while it plays. Pause retains
  the original APU and unconsumed PCM, and creates a silent audition clone.
- Paused audition retains authored gain / sample settings after release.
  Hardware now reports actual counters and gains. Its FDS / DMC key edges use
  the existing software click guard preference. Reference song PCM stays raw.
- Code and song playback hand off explicitly. Code continues through Keyboard
  view changes, Files preset selection, upper controls and manual keys.
- Original VGM bytes and extracted version-7 JSONs are committed as one Files
  operation. Unsupported playback leaves the extracted library usable.
- The packaged tree contains editable modules, declarations, native sources,
  Code FX sources, licenses and a source hash receipt. No version was changed.

## Follow-up

- [ ] Human listening with game VGM / VGZ recordings and longer sessions.
- [ ] Extend reference playback to compressed DPCM banks and DAC-stream
      commands. These formats currently produce an explicit load error.
- [ ] Import the Web ZIP into the 2A03 Tauri repository for its next release.
      Its existing local release-script changes were present before this task.
- [ ] Consider SCSP Code / Files integration separately.

## Verification

Automated checks use self-authored recordings and zero-gain speaker routes.

- 273 NES / FDS unit, native PCM, ownership, Files, transport and package tests
  passed. Existing version-1 through version-7 preset behavior is covered.
- Existing complete Synth browser checks passed in Chromium and WebKit,
  including DMC bits / drawing / fitting / Undo, FDS Envelopes, counters,
  keyboard focus, layout and AudioContext recovery.
- Packaged Code and song browser checks passed in both engines. They cover
  six-channel PCM, Run / Apply, Keyboard coexistence, direct edits, preset
  selection, local modules, Cassette recovery, paused FDS audition, retained
  position, Capture, seek, invalid replacement and transport handoff.
- Real CDN Monaco checks passed in both engines, including visible editor,
  worker diagnostics, completion, source navigation and fallback behavior.
- The checked ZIP contains 151 files, editable browser modules and the matching
  native source kit. The same package check verifies deterministic bytes and
  each included module / source hash.
- 104 calibration-freshness tests passed. An exact-byte passive NES source-link
  receipt retains the historical measurement reports and rejects later unknown
  changes to the shared definition viewer.
- GitHub Actions includes the packaged Code and song checks for the next push.
  The remote workflow has not been run in this task.
