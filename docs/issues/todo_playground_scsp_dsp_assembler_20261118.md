# SCSP DSP assembler in Playground Code — 2026-11-18

User approved connecting the published pure assembler to Playground Code, with
Main / Worker bindings, types / completion and a Files example. Work directly
in the main checkout so these changes remain visible in the normal workspace.

- [x] Reuse `scsp_dsp_assembler.js` as pure synchronous Code helpers in Main,
  Worker and the shared Code runtime, with matching pg aliases where applicable.
  Compilation must not initialize WASM / audio or apply a DSP program.
- [x] Add precise global / pg declarations, completion documentation and source
  navigation using the actual public assembler. Keep canonical / served runtime
  copies aligned and update affected cache edges.
- [x] Add a readable Files example for source → 512 words → canonical source,
  including full physical positions / round-trip inspection. Use the existing
  example generator and preserve saved user files / current starter behavior.
- [x] Verify Main / Worker and shared runtime bindings, strict types / negative
  cases, navigation and example output. Inspect source and readable Playground
  package in isolated browsers, with physical audio blocked / permanently muted.
- [x] Run relevant package / source / calibration checks and record results.

Verification: [verification_playground_scsp_dsp_assembler_20261118.md](verification_playground_scsp_dsp_assembler_20261118.md).
Main / Worker and readable standalone packages pass in muted Chromium / WebKit.
The browser ZIP fits itch's 1,000-entry limit with complete sources preserved.

No new DSP execution facade, live SoundChip mutation, scheduling, synthesizer UI,
native / WASM build, npm publication / version bump, release tag, commit or push
is part of this task. The pure codec and Synth execution profile remain separate.
