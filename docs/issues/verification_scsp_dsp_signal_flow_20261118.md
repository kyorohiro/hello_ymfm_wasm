# SCSP Synth configured signal-flow view — 2026-11-18

Base: `ac5024067fb9404151bf66623e0c050cdae93b6d`.
User approved the compact, collapsible routing visualization. No npm work was
requested or performed.

## Usage / behavior

Open **SCSP Synth → DSP → Signal flow**. The view starts collapsed. Opening it
shows the selected Auto source / physical CH, its MIXS0/1 Send, the applied DSP
program, both shared Returns and their configured left/right outputs. The
Direct branch is separate from DSP Return Enable. Send, Return level and Pan
changes update the diagram without extra audio commands or focus changes.

Gain/IIR maps MIXS0 to Return 0 and MIXS1 to Return 1. The built-in Delay and
known FIR/IIR use MIXS0 / Return 0. A bus unused by a recognized program is
labelled accordingly; arbitrary edited programs remain **program-defined**.
Staging an example does not change the diagram until the program is applied.

This describes settings, not measured levels or voice activity. Send 0 removes
the selected contribution; another CH or DSP history can still feed a Return.
Return level 0 and disabled DSP Returns are distinct states. L/R highlights
show configured pan routes, not linear gain estimates. Auto modulator direct
output suppression follows the existing voice graph. SSF keeps its separate
engine and existing disabled Synth-DSP-tab policy; the passive hidden Synth
view labels that context rather than showing the song's routes as its own.

The standalone `dsp_signal_flow.js` module builds a detached description and
updates only changed DOM values. While collapsed, it retains the latest model
and defers diagram rendering. It imports no audio/engine code, starts no
context, writes no registers and does not move focus. More explanation stays
under the nested **?** control.

## Verification

- **318** Synth / standalone packaging tests pass, including **8** new pure
  model / passive-view tests. The tested graph handles known/unknown programs,
  Send / Return zero, disabled outputs, pan endpoints and duplicate center
  codes, Auto suppression, SSF context, deferred rendering and disposal.
- New/prior guard and parity checks: **24/24** pass; the added CI proof step
  passes **5** tests. Both Mixer generators and four existing parity recorders
  pass `--check`, retaining the prior 24 Synth / 36 runtime / 15 Worker packet
  evidence. No new measurement report or gain correction was introduced.
- Independent review reconstructs all **4** predecessor files from reverse
  hunks and matches Git objects without importing the official restorer.
  All **41** dependency / **10** report hashes match. Historical JSON **876**
  files and both SCSP WASM copies retain their original bytes. DSP owner,
  processor, audio transport and common runtime code remain unchanged.
- Source and exact extracted ZIP pass Chromium / WebKit at 48 kHz, **7 grouped
  cases per engine**. Cases cover cold opening with zero AudioContexts / zero
  transport writes, keyboard input with the disclosure summary focused, target
  selection, applied-versus-staged source, known/unknown connectivity, Send /
  Return / Pan / Direct, passive toggling with held notes, Code edits / Stop
  and actual paused SSF separation without changing the primary DSP setup.
- Each source / ZIP run verifies **110** served assets remain unchanged.
  Page errors and missing assets are zero. Stop output is exactly zero, and
  all physical speaker routes remain permanently muted. No listening test was
  performed.
- Desktop / 390px screenshots were inspected. Cards stack with downward arrows
  on narrow screens; both Return cards remain readable and horizontal overflow
  is zero. The collapsed view keeps the existing controls compact.

## Package / restart

`sh scripts/package_itch_scsp_synth.sh dsp-flow-20261118` succeeds.
Candidate: `release/tetorica_scsp_synth_dsp-flow-20261118_itch.zip`.

The **376-entry** archive passes CRC and complete stage-byte comparison. Its
**95** comparable live source/runtime files match the served files byte-for-byte,
including the new view. The CI workflow now checks the new proof and runs the
flow browser test on the extracted archive, retaining screenshots as artifacts.

[Machine evidence](verification_scsp_dsp_signal_flow_20261118.json) points to
logs, browser reports, screenshot paths and archive hashes in
`build/scsp-dsp-flow-20261118/`. No version bump, npm/itch publication, parent
commit/push/tag, core/WASM rebuild, API or Tauri change was performed.
