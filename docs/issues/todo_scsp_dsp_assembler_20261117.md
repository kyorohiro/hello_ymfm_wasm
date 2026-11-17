# SCSP DSP assembler — first working version, 2026-11-17

The user has now approved the first working version with "進めてみて!!".
The preparation notes below remain as context; their original documentation-only
scope is superseded for the bounded implementation checklist here.

- [x] Add a pure, provisional field assembler / disassembler for 128 SCSP DSP
  steps × four 16-bit words, with all bits and physical step positions retained.
- [x] Add an editable text fixture for the existing six-step Delay, usage notes
  and a small local Node CLI. Mark syntax experimental, not SEGA-tool compatible.
- [x] Verify independent field vectors, malformed input, opaque-bit preservation,
  and exact full-program round trips without mutating input data.
- [x] Verify the authored Delay assembles exactly to the legacy program, then
  compare real shipped-WASM PCM, impulse / feedback behavior and an intentional
  edit that changes output. Never open an audio device.
- [x] Record results / next steps, keeping the live Synth, DSP installer, runtime,
  SDK / WASM, npm distribution and calibration inputs unchanged.

No live program upload feature, UI integration, macros, optimizer, timed DSP
changes, package publication, commit, push or Tauri changes in this milestone.

## Preparation completed before implementation

- [x] Locate the current fixed Delay program and its encoding / upload path.
- [x] Identify the smallest read → write-back milestone and validation baseline.
- [x] Record a brief reader-facing memo with existing facts, a provisional
  direction and deferred decisions. Do not treat the draft as an approved API.

Keep existing Delay, song DSP, RAM reservations and shared sound APIs unchanged.

## 再開するときは、ここだけ読む

最初の動く版は、こちらに任せて組める見込みです。今は構文やAPIの細かな判断は不要です。

最初の目標は **既存Delay → 読める命令表記 → 元と同じ命令列** の往復です。
既存のDelayを基準にするので、バイナリ一致と同じPCM出力で正しさを確かめられます。
動く版ができてから、表記が読みやすいかを触って判断する進め方にできます。

現時点の仮方針は、DSPのfield名をそのまま残す小さな表現です。同じstepで並行する
処理や待ち時間を見える形にします。構文・マクロ・UI・公開APIの確定は後の判断です。

## Existing implementation / next bounded milestone

- [Current encoder](../synth-scsp/dsp.js) builds 512 16-bit words
  (128 steps × four words). The current Delay uses six steps and zero-fills
  the remainder. Coefficients, RAM addresses, routing and Start are installed
  separately by `DspDelay`; a codec need not replace that installer initially.
- The pinned core's field layout is in
  `third_party/tetorica-soundchip-native/vendor/mame-scsp/scspdsp.cpp:95`.
  Fields not interpreted by that core must still survive a lossless round trip;
  do not label them physically reserved without checking the hardware manual.
- Keep all step positions and raw bits. The current core uses the previous
  accumulator for its shifter / writeback, restricts RAM I/O to odd steps,
  and latches preceding reads. An optimizer or simplified serial `mul/add`
  syntax could obscure those semantics.
- [Existing tests](../synth-scsp/dsp.test.mjs) cover impulse delay, feedback
  decay, RAM protection and Stop silence. These are available validation
  baselines; they were inspected, not rerun during this preparation turn.

At the next implementation step, a provisional pure encoder / decoder plus
its readable Delay fixture can establish word-for-word equality, followed by
CPU-only shipped-WASM PCM comparison. Keep live program replacement and Synth
UI integration outside that first milestone. Consult the linked SCSP manual /
DSP assembler guide in [the existing DSP record](scsp_dsp_01.md) before claiming
compatibility with SEGA tools or physical hardware.

At the preparation checkpoint, no implementation, runtime / UI edits, tests,
builds, commit, push or publication had been performed. The user subsequently
approved implementation of the bounded first version above.

## First version completed

Pure codec / declarations: `docs/synth-scsp/dsp_assembler.js` / `.d.ts`.
Editable fixture: `docs/synth-scsp/examples/delay.scspasm`.
Read the existing program with `npm run scsp:dsp -- disassemble --delay`.

Targeted tests 12/12 and the SCSP Synth suite 207/207 pass. The fixture
reproduces all 512 legacy words; shipped-WASM stereo PCM and partitioned
render are exact at feedback 0 / 0.5. Editing only EWT changes actual output.
Both mixer checks and strict declaration-consumer checks pass. Runtime,
installer, WASM / SDK, live UI and package publication remain unchanged.

See [usage](../synth-scsp/DSP_ASSEMBLER.md),
[verification](verification_scsp_dsp_assembler_20261117.md) and
[machine evidence](verification_scsp_dsp_assembler_20261117.json).
No commit or push was performed during that milestone. The subsequent
[read-only DSP listing](todo_scsp_dsp_program_view_20261117.md) is now complete.
Live program replacement remains a later milestone.

That follow-up is now implemented separately in
[DSP draft / Check / Apply](todo_scsp_dsp_edit_apply_20261117.md), with a narrower
execution profile. The codec's lossless inspection format remains unchanged.
