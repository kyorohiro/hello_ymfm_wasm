# SCSP Cycle 2OP UI and Synth example - 2026-11-18

Base `ce9ffdf6206c12c176054b0c95d0cdf863e974e8`; initially clean worktree.
This completes the bounded Cycle UI after the existing instrument/Code and
[v11 persistence support](verification_scsp_cycle2_presets_20261118.md).

## Using the UI

In editable **Auto**, select **2-operator FM -> Connection -> Cycle 2OP**.
The solid A -> B curve means current A; the separate amber dashed B -> A curve
is the history-average return. Both have accessible titles and the routing
summary names their meanings. Depth 0 dims only the corresponding path.

Select A or B to see its fixed input, change its receiving Depth or Ratio, and
toggle Direct output. Both, either or neither direct output can be selected.
The displayed B/A ratio is `ratios[1]/ratios[0]`; selecting A or inspecting the
ratio does not reset A to 1. Longer core-timing/Synth-initialization details stay
behind `?` instead of permanently expanding the panel.

Depth/Ratio changes retain running groups and history. Output changes follow
the existing structural-retirement policy: grouped notes retire while Code
keeps running, using the new outputs on its next attack. Independent physical
owners remain intact. Cycle controls are locked in physical CH/SSF contexts.
Changing Cycle to PCM/FM4/FM6 explicitly submits Chain and the mode in one
command. Re-entering FM2 does not silently re-enable Cycle. Dormant Custom/Self
settings retain the existing behavior.

## Readable Code example

[examples/cycle2.js](../synth-scsp/examples/cycle2.js) is included verbatim in
the distributed source and fresh Files projects. Open it in Code and Run.
It uses the borrowed Synth API, current full-loop PCM/envelopes, modest source
levels and beat-based notes. A/B direct levels are both usable while the
initial output mask selects B, so either Direct output checkbox can be explored.
Apply retains live knob edits; Run prepares its starting configuration again.

Existing saved workspaces remain user-owned and are not reseeded. If the
example is missing, save the linked file and add it with **Files -> Add files**;
reloading an older project does not inject or overwrite examples. Importing or
restoring the file does not execute it.

## Verification

- **444 SCSP/package tests** pass. Five new view tests cover fixed inputs,
  read-only/unused/context guards, output events, errors/disposal and ratio
  semantics. Two actual-example tests verify exact source, saved-project
  preservation and real-WASM playback through the borrowed client; Apply keeps
  live depth edits and notes use `beat()`.
- **16 source-browser checks** pass: Chromium/WebKit at 48 kHz. Actual UI/keys,
  focus release, A/B depths/ratios/outputs, Custom/Self/dormant and mode changes,
  Code continuity, physical/SSF contexts, v11/Cassette/draft restore and the
  bundled example are covered. Output stays permanently muted, 114 served
  assets are unchanged during checking, and page/processor/missing errors are
  zero. Desktop and 390 px screenshots were visually reviewed without overflow.
- The actual packaging CLI produces an isolated verification ZIP containing
  the readable helper/example; the extracted ZIP is checked by the same browser
  test, with another **16/16 checks** passing in both browsers at 48 kHz and
  zero page/processor/missing errors. This local artifact is a verification
  build, not a public release.
- Both Mixer generators and exact source guards pass. Native-critical routing,
  codec, allocator, processor, runtime/core/WASM and gains are unchanged; the
  prior 206-case native parity report remains byte-identical.

The new source receipt reconstructs complete reviewed predecessors. It also
fixes an inherited documentation-only calibration mismatch: the earlier v11
README update landed after its receipt was frozen. The README's separately
declared predecessor is actual Git `6ca7c946`, matching the original pinned
document hash; all other source predecessors use the current task's base.
No historical JSON or calibration result is rewritten or broadly exempted.

Evidence: `build/scsp-cycle2-ui-20261118/`. The
[machine record](verification_scsp_cycle2_ui_20261118.json) binds final source,
tests, receipt, browser evidence and verification archive. Package verification
uses `release/tetorica_scsp_synth_cycle2-ui-check-ce9ffdf_itch.zip`.

No arbitrary cycles, raw API/core changes, new preset format, npm/version/
publication/commit/push/tag or Tauri work. Human listening and physical Saturn
fidelity remain separate from muted current-core verification.
