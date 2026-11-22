# Synth Code API consistency

Started 2026-11-22. Scope is the JavaScript written in the Code tab of the
13 Synths, including the secondary chips available through `useSoundChip()`.
The DMG and 2A03 legacy page URLs redirect to their respective Synths.

## Priority 1. Code, declarations, and completion

- [x] Genesis PSG MIDI numbers. YM2612 Hz overload, per-operator immediate and
      timed key-off, and Worklet readback capability. RF5C164 Gate return types.
- [x] Supply physical channel constants through CH8 in S-DSP and CH9 in
      SMS/GEAR. Check completion and actual Code evaluation.
- [x] Correct DMG inherited methods, SCSP sample-null handling, 2A03 FDS table
      inputs, and asynchronous callbacks in the timed builder declarations.
- [x] Align returned values and snapshots in DS, 2A03, HuC6280, ASWAN, SPU,
      S-DSP, SCSP and SID. Expose usable methods in completion and remove
      unsupported methods from the appropriate Code-only types.
- [x] Align the CD-DA `list()` contract in Genesis and PC Engine and the
      PC Engine MSM5205 load options.

## Priority 2. Note ownership and cancellation

- [x] Match pitch input, immediate gates, and software releases where the
      chips share semantics. Keep hardware event retrigger behavior, channel
      restrictions, and documented physical versus logical channel IDs.
- [x] Make Code `allNotesOff()` release Code-owned voices. Preserve newer
      notes from the keyboard and other owners. Keep the UI global stop.
- [x] Separate removing future writes from releasing the voices owned by a
      cleared reservation. Make named cancellation and successful replacement
      release the appropriate held notes, including abandoned one-shots.
      Preserve other reservations and manual voices, even after a channel is
      reassigned. A rejected replacement keeps the previous reservation.
- [x] Align AY/SSG partial mixer and envelope updates. Preserve the ST's
      independent Tone/Noise gate flags and SID's single-voice combined
      waveform flags, including each renderer's waveform behavior.

## Priority 3. Timed operations

- [x] Compare `build`, `schedule`, `compile`, and snapshots. Share Sega PSG
      capabilities between Genesis and SMS/GEAR where equivalent. Keep record,
      schedule, and compile state contracts explicit for software envelopes.
- [x] Document the two legacy `scheduleWrites()` time units, per-chip register
      write fields, and which clients support a complete `client` baseline.

## Priority 4. Remaining interfaces and validation

- [x] Document intentional preset, Pan, Noise, reattack, sample preparation,
      and software FX differences. Align truly shared CD-DA/PCM behavior.
- [x] Run the existing Code/type tests across the Synths plus targeted
      regressions. Verify sample examples, owned Gate release, and named
      cancellation against actual rendered output where available.
- [x] Record compatibility changes, any remaining limitations and why they
      remain, and the commands and results of validation.

## Code compatibility

- Musical note names and integer MIDI are the pitch inputs for `setNote()` and
  `noteOn()`. `setFrequency()` takes Hz where available. Existing return
  values retain chip-specific data, for example an RF5C164 raw step and the
  Nitro DS rounded timer plus frequency. Raw methods keep their register
  units, including the YM2612 block/F-number overload and DS Noise timer.
- Synth Code uses zero-based physical channels unless the local declaration
  labels the argument as a software voice, lane or drum. CH constants map
  CH1 to zero. SCSP Code note lanes can allocate several slots for a sound.
  The SCSP source's `setPreset()` accepts a patch with a bank sample and
  rejects `sample: null` before writing. File presets retain their existing
  scope and formats.
- `keyOff()` is a raw gate. `noteOff()` uses a musical release where the
  app has one, including RF5C164's short fade. Scripts that relied on
  `rf5c164.keyOff()` for that fade should call `noteOff()`. A YM2612
  operator list in `keyOff(ch, ops)` releases those operators and preserves
  the other active operators. The empty list still clears the channel.
- Code `allNotesOff()` releases the client's held voices. Future reservations
  can still start notes. Named `clearSchedule()` cancels the future events and
  releases a gate still owned by that reservation on note-oriented chips.
  Raw 32X PWM clears its FIFO-write reservations via its own no-argument
  `clearSchedule()`. **Stop all sound** remains the manual whole-Synth action.
- Gain and Pan keep their chip units and coupling. OPNA SSG and ST expose
  per-channel mixer switches and a shared envelope. `setMixer(ch, {tone: true,
  noise: true})` enables both on the same channel. Partial `setEnvelope()`
  updates preserve the other field. A write to the shape retriggers. SID gates the voice once
  and keeps independent waveform control bits. SID combined-wave shapes
  follow the selected model. DS Pulse/Noise are alternative channel modes
  with hardware channel restrictions. CD-DA and MSM5205 are transports whose
  keyboard triggers are Synth features. Genesis and PC Engine CD-DA Code
  `list()` both return track metadata synchronously.
- `liveFx()` is a software audio route on the Synths that expose it. The
  Nitro DS Synth keeps its shared SkyEmu output path. It currently exposes
  neither `liveFx()` nor separate Code FX routing. The user preset and
  `captureState()` are independent. The latter is a detached compile baseline
  for timed clients with chip-specific resolution metadata.

## Scheduling and compilation

- `build()` records once using a synchronous callback and absolute offsets.
  Sample offsets default to a 44,100 Hz reference; device frames are assigned
  at execution. `compile()` uses applied state by default and can reuse a
  compatible saved snapshot or a reset baseline. Register results preserve bus
  information, including OPN ports and DS 32-bit address writes.
- `compile(..., {initialState: 'client'})` requires a complete local
  authored shadow. The ST client has it after initialization. Shared
  Playground/SDK clients with complete initialized shadows can use it too.
  Borrowed Synth clients, including Nitro DS, 2A03, S-DSP, SPU, HuC6280,
  ASWAN and SID, reject it when they cannot supply that state. Use
  `captureState()` to compare several plans without repeating Worklet RPCs.
- Raw YM2612 `scheduleWrites([{time, port, register, value}])` uses absolute
  AudioContext seconds. 32X PWM `scheduleWrites([{frame, register, value}])`
  uses frame offsets at the audio output rate, relative to when the command
  arrives. Those existing interfaces retain their units and return values.
- Genesis and SMS/GEAR share the Sega PSG operation resolver. Genesis PSG
  carries mono hardware and its timed operations write hardware gates.
  Code's optional PSG software envelope remains on the immediate note
  path. HuC6280 follows the same hardware/software split for compile.
  ASWAN can schedule its software-envelope notes. For a static hardware
  write list, use `setNote()`, `keyOn()` and `keyOff()`; the runtime may
  apply software envelope steps afterwards.
- The SCSP Synth retains its existing immediate controls and DSP APIs. Timed
  register authoring for SCSP stays deferred.
- If a real register read is unavailable on an AudioWorklet transport,
  completion omits `read()` and `readStatus()`. For OPN register
  inspection from Code, use the available `getState()`/`captureState()`
  methods with the documented state type.

## Verification

- All 4,419 tests passed for the 13 Synths, shared declaration suites and
  existing ZIP tests. They ran
  with `node --test --test-concurrency=3 docs/synth*/*.test.mjs
  docs/playground/*declarations*.test.mjs scripts/package_itch*test.mjs`.
- A separate runtime and historical PCM regression run passed 323 tests.
  The final ownership-focused run passed 147 tests. They exercised real WASM
  at 44.1 and 48 kHz,
  including regular and Nuked YM2612, PSG, OPNA, ST, NES, BRR and SPU gates.
  Named cancellation, the release of an existing gate without canceling a
  repeating pattern, and keyboard ownership were verified independently.
- Muted Chromium tests exercised all 13 Synths. WebKit also ran the S-DSP,
  SMS/GEAR, SPU and Nitro DS timed Code checks. There was no listening test.
- The measured gain reports were retained. Historical tests authenticate
  exact predecessor bytes before rerunning old audio fixtures. The Code API
  receipt captures only paths with an existing historical pin. Its manifest
  record uses the exact historical bytes from `0d5cf755` for the old NES and
  S-DSP verification scripts. The live manifest uses the current commands.
- The broader historical calibration suite was compared against `b7fe2c4d`.
  Its existing failures decreased from 90 to 84, with no new failing cases.
  This suite includes old source and report hashes beyond the Synth Code
  parity checks. The current Playground mixer defaults check passed.
- The Genesis and SID distribution packages and the Playground runtime
  dependency graph passed. The full Playground ZIP was generated. The browser
  upload step stopped at 1,037 entries against a limit of 1,000. Reducing the
  browser upload file count remains a separate task.
