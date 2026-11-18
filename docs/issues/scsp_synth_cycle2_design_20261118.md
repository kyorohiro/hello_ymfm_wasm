# SCSP Synth: bounded Cycle 2OP integration design - 2026-11-18

Status: **design only; not implemented**. Base
`29d1dc14deaf3f5a41086263dc0f58aff7dfa443`, initially clean worktree.
This describes the original planning step. Subsequent
[Phase-1 instrument/Code implementation](verification_scsp_synth_cycle2_runtime_20261118.md)
adds the bounded connection; UI selection and portable v11 presets still follow.
This proposal follows the [measured two-OP research](scsp_fm_cycle2_research_20261118.md)
and its [bundled Playground example](../playground/examples/scsp/scsp-cycle2-prototype.js).
The current Synth still rejects cross-operator cycles. Its existing defaults,
Custom DAG/Self graphs, APIs, presets, native core and gains remain unchanged.

## Chosen scope and configuration

Add one dedicated connection, **Cycle 2OP**, available only in `fm2` mode.
Its identifier `fm.algorithm: 'cycle2'` defines the fixed
`current-forward-average12` recipe: logical A precedes B in physical order;
A feeds B in the current native frame, and B feeds its two-history average
back to A. Do not admit this loop into `customRouting()` or its DAG sorter.
Do not add arbitrary cycles, Self plus a cross-cycle, per-edge delay selection,
an order selector, a graph compiler or a new scheduler.

Proposed Synth Code usage, **not runnable until implemented**:

```javascript
const saturn = await useSoundChip('scsp');
await saturn.setConfig({
  mode: 'fm2',
  fm: {
    algorithm: 'cycle2',
    cycle2: { outputs: [1] }, // B direct output; [] / [0] / [0, 1] also valid.
  },
});
```

`fm.cycle2` has exactly one field, `outputs`: a dense, unique list of operator
IDs 0 or 1, normalized into ascending order. Unknown keys, holes, duplicates
and other IDs reject. Entering the connection without saved cycle settings
initializes `{outputs: [1]}`. Explicit malformed/null settings reject rather
than defaulting. Preset loading requires the field explicitly (see below).

Reuse the existing source A/B PCM, envelopes, ratios, per-OP depth, TL, direct
levels/pans and DSP sends. Depth belongs to the receiving OP: A controls the
return from B; B controls the forward input from A. Both need full forward
loops starting at 0 and the existing guarded PCM policy up to MDL12. Keep the
existing depth/ratio normalization and all six stored source operators;
C-F remain inactive authoring data. No new amplitude compensation or silent
rewriting of source waveforms, levels or existing defaults accompanies selection.

Direct outputs are explicit because both OPs are modulators: the usual
"not a modulation source means output" inference would select neither one.
`outputs: []` intentionally suppresses direct output while explicit DSP sends
can still expose either OP. Muting a direct output does not mute its stack
contribution. Existing source keys `carrier`/`modulator` retain their storage
identity A/B; they do not imply that A must be the carrier for this connection.

## Physical plan and timing

Keep the current Auto/Code allocation pool: zero-based physical slots 6..31
(UI CH7..CH32). A two-slot group gets `[p, p+1]`, with **A at p, B at p+1**;
13 pairs remain available. Store `group.operatorSlots = [p, p+1]`. Central
operator mapping must use it for pitch, mix/LFO fanout, depth, DSP sends,
inspection and releases. The existing non-Custom fallback reverses operators;
changing only `voiceCommands()` would leave those other operations incorrect.

| Receiving OP | Source | X | Y | Current zero-slot-delay core input | MDL8 word |
| --- | --- | --- | --- | --- | --- |
| A at p | B at p+1 | 33 | 1 | `avg(B[n-1], B[n-2])` | `0x8841` |
| B at p+1 | A at p | 63 | 63 | `A[n]` | `0x8FFF` |

The existing adapter's Depth 0 emits word 0, disconnecting that receiving
edge. It retains the declared Cycle configuration and operator mapping;
turning depth up again resumes with existing stored history. Do not change
raw MDL0 semantics or remove the disabled edge from allocation topology.
History-age labels assume continuously active stack writes; after inactivity
the retained values may be older than those labels suggest.

This is the measured recurrence of the current `SCSP_FM_DELAY=0` core, not a
claim of matching Saturn's physical pipeline. A/B physical order is part of
this algorithm's sound. It is not equivalent to the existing B-before-A
Chain with a reverse arrow drawn on the screen.

## New attack and history ownership

Use one lease for the complete pair. Extend the existing Synth-only Self
startup policy, not native Key On behavior. A new Auto/Code attack performs
these steps in one synchronous instrument operation:

1. Select the candidate slots/victims without mutating ownership. Validate the
   complete configuration, both guarded samples and all ordinary commands.
2. Retire victims and revoke manual owners overlapping the selected slots,
   following the existing released-first, then oldest allocation policy.
3. Clear **only four owned sound-stack cells**, indices `p`, `p+32`, `p+1`,
   `p+33`, through the existing internal `core.write(0x600 + index*2, 0)`.
4. Install both complete slot presets before either Key On. Trigger the slots
   in ascending physical order and latch the existing release guard.
5. Publish the new group/order and reapply its existing direct/DSP ownership.

The Worklet handler calls this synchronously; it must not render, yield or
await between initialization and the pair's setup. No JavaScript delay or
shared-core reset is needed. This promises no intermediate audio render
inside that command, not sample-scheduled arrival of separate UI messages,
simultaneous physical-chip Key On or rollback after an unexpected core failure.
Validation errors occur before victim retirement/history writes. Keep the
existing prevalidation guarantee distinct from unexpected native failures.
For the new Cycle attack branch, if a core write fails after commit starts,
abort that attack, mark the error fatal and use the processor's existing
fatal-error shutdown path; do not claim rollback of partially written state.
That classification must be implemented and fault-tested: ordinary current
`#attack()` write exceptions are not automatically marked fatal today. Do not
change failure semantics for the existing non-Cycle attack paths in this step.

This four-cell initialization is **Synth software**. Raw physical Key On and
the public low-level SCSP API retain their native history behavior. Never add
the clearing to shared `ScspSynth.keyOn()` or reset every slot/DSP/PCM bank.
Other physical cells and DSP/RAM are untouched by the initialization. An
explicitly patched external CH can still read these four cells and hear the
change; the Synth does not discover or reserve arbitrary cross-group links.

## Live edits, release and competing owners

| Operation | Pair behavior |
| --- | --- |
| New Auto key or Code `noteOn` / `keyOn` | Acquire one pair, initialize its four cells, attack both OPs. A Code reattack replaces that lane's old group. |
| Pitch / ratio / Depth edits on an existing group | Update the existing pair without reattack or history clear, including Depth Off -> On. |
| Source PCM / envelope edits | Keep the existing next-attack sample/envelope policy; mix and LFO retain their existing live fanout. |
| Keyboard release / Code `noteOff` | Release both owned gates using the existing Click guard. Keep feedback/history during the native release. |
| Code `keyOff` | Release both owned gates with raw release behavior; no added click guard or history clear. |
| Output-list / connection / mode change | Structural change: reuse existing grouped-note retirement policy after validation. Keep Code session/loops running; they use the new config on their next attack. |
| Code Stop / session replacement | Retire only that session's groups. Do not reset the shared ring, DSP or unrelated keyboard/manual owners. |
| Global Stop | Keep existing shared-core Stop/reset behavior, including clearing history and preserving the existing sample/settings policy. |
| Physical CH parameter edit | Edit only that physical slot, using existing last-applied semantics. It can intentionally alter/break the pair. |
| Physical CH keyboard attack on either member | Retire the whole old group first; the chosen CH then owns only its current physical preset. Do not start its former partner or present this as pair audition. |
| Later Auto allocation over a manual CH | Revoke the overlapping manual lease and install the complete new pair; stale physical Note Off cannot release the new owner. |

After physical takeover, the chosen raw preset can still contain its previous
modulation taps; it is not silently rewritten into a standalone oscillator.
The other member is retired with the existing muted-stack policy. Old group
Note Off/Code Stop must never act on its replacement. Released/inactive slots
can retain history until a future owned Cycle attack initializes it again.

Configuration changes must include `cycle2.outputs` in the topology key in
both instrument and UI; otherwise output edits can leave stale group metadata.
Keep the existing structural-stop behavior, including its current distinction
when manual voices are present; this proposal does not redesign global Stop.
If a structural output change actually resets the shared core, the processor
must also reset its resampler cache even when mode/algorithm strings stay the
same. The current processor checks only those strings, so this is an explicit
integration task. Do not flush the resampler for live Depth/Ratio edits or
pretend a group-only retirement with manual owners performed a core reset.

## Mode transitions and dormant settings

Keep dormant `fm.custom` unchanged when entering/leaving Cycle. A saved
`fm.cycle2` output list may likewise remain dormant in in-memory settings;
validate it independently of the active operator count. Do not resize a Cycle
into four/six operators or reinterpret its mutual inputs as a Custom DAG.

- The UI changes from active Cycle to PCM/FM4/FM6 by explicitly submitting
  the target mode plus `algorithm: 'chain'` in one command. Returning to FM2
  does not silently re-enable Cycle; the user can select it again.
- Code setting only an incompatible mode while Cycle is active rejects the
  entire request. Code can explicitly set mode and a supported algorithm
  together. Failed requests preserve config, owners and history.
- Entering Custom reuses an existing dormant Custom graph. If none exists
  and the previous connection was Cycle, initialize the normal Chain template
  at the requested target operator count (for FM2: `B -> A`, output A).
  This also covers one-command transitions to Custom FM4/FM6; never seed
  Custom from Cycle's mutual inputs.
- Entering Cycle uses its fixed topology and remembered/default outputs.
  Supplying `fm.custom` alongside it changes only that dormant Custom data,
  after normal validation, and cannot change the active Cycle recipe.

## Code, UI and persistence

Extend the existing Synth `setConfig()` and its Code declarations; no new
`setModulation()` facade or performance scheduler is necessary. Logical Code
CH1 still selects a grouped performance lane, not physical slot 0. `getState()`
reports the normal config/routing and explicit group operator-slot mapping.
Keep Playground's raw example and its API distinct from the Synth example.

UI changes at implementation time:

- Add `Cycle 2OP` to Connection, enabled for FM2 in the editable Auto context.
  Source A/B selectors, existing per-OP Depth/Ratio and output checkboxes stay.
  Fixed inputs are shown read-only; Custom input controls remain Custom-only.
- Label the forward arrow **A -> B** and the distinct return path
  **B -> A · history average**. Do not draw both arrows on the same path.
  The routing summary identifies the fixed processing order and direct outputs.
- Call A's receiving depth `B -> A` and B's `A -> B`; show B's frequency ratio
  relative to A as `ratios[1] / ratios[0]`, without assuming the existing word
  "modulator" describes B. A's own ratio remains editable; do not force it to
  1 or change the meaning of the stored per-OP ratios. Label this as the
  requested ratio, distinct from realized hardware pitch quantization.
- Put the longer current-core timing and Synth-only initialization explanation
  behind the existing `?` pattern. A compact hint can state that changing
  outputs/connections stops grouped notes, while Depth/Ratio edits stay live.
- Physical CH tabs and SSF inspection keep their current single-slot/song
  controls. Merely selecting one never allocates or initializes a Cycle pair.

Reserve **voice preset version 11** for active `mode: 'fm2'` plus
`fm.algorithm: 'cycle2'` and an explicit valid `fm.cycle2.outputs`.
The version identifies this fixed order/history recipe; no history buffers,
physical slot numbers or live ownership are serialized. Keep all six source
operators and existing voice/effect settings as other preset versions do.

`writePatch()` emits v11 for an active Cycle regardless of mixed depths; for
other connections, strip inactive cycle data and retain the exact existing
v1-10 selection rules. Old versions explicitly reject `algorithm: 'cycle2'`
or any `fm.cycle2` field, even dormant. Version 11 rejects other modes/algorithms
or missing cycle metadata; it cannot be a fallback container for a DAG/Self
graph. New declarations describe this discriminated preset shape. Existing
JSON presets are never silently converted into a Cycle.

## Phased implementation and acceptance

1. **Instrument/Code first:** add the bounded planner/config/mapping and
   four-cell attack policy; preserve default/DAG/Self paths. Prove it with real
   WASM and a hand-authored raw reference before exposing a UI option.
2. **Persistence and UI:** implement v11/declarations, mode/dormant transitions,
   fixed arrows/controls and a readable Synth example using a deliberately
   modest source level. Its sample is separate from existing default patches.
3. **Browser/package checks:** exercise actual Code/UI and exported/reloaded
   presets in muted browsers, plus the existing default-parity/source guards.
   Record listening/hardware limits; no npm publication is implied.

Required tests before enabling the connection:

- All 13 allocations map A before B and produce the stated selectors/words.
  Compare actual PCM against an independent direct-register reference using
  the same initial history, samples, levels and physical order. Include both
  orders as a negative comparison; do not validate the planner with itself.
- Seed distinguishable markers in all 64 cells: a new attack clears exactly
  the owned four, not another group/Self/manual cell. Check no render between
  clearing/setup/keyOn; command validation failure performs no writes at all.
- Live Depth 0/1/4/8/12, ratio/pitch, release, reattack, sample reuse, 14th-note
  steal, Code/keyboard overlap, physical takeover and stale releases/Code Stop.
  Unrelated owned PCM, DSP state and groups remain intact where required.
- Both sources enforce full-loop/padding rules, including when depth is zero.
  PCM edits retain held sample references; native output remains finite across
  intended settings. Do not hide intended digital feedback with a new limiter.
- v11 roundtrip/invalid data/old-version rejection; old preset/default outputs
  remain unchanged. Cover mode-only failures, dormant Custom/Cycle re-entry,
  routing identity on live edits and idle audio migration without autoplay.
- Test native 44.1 kHz through 44.1/48 kHz output and resampler boundaries.
  Cover an outputs-only structural reset with cached audio, group-only
  retirement with manual owners, and fatal handling of a mid-commit write
  failure, without claiming complete native rollback.
  Browser verification follows the Synth's actual AudioWorklet/Code route;
  do not claim a nonexistent Synth Worker route from Playground's coverage.

Human listening remains outstanding: initial attack, sustained high-depth
feedback, release and the default Cycle audition level. No physical Saturn
fidelity conclusion follows from the emulator/reference match. Preparation
and muted implementation tests can proceed before that listening; a claim of
finished sound quality cannot.

## Existing implementation anchors

- [routing.js](../synth-scsp/routing.js#L17): DAG order, explicit Self handling,
  reversed legacy mapping and generated voice commands.
- [instrument.js](../synth-scsp/instrument.js#L181): group selection, startup
  Self history initialization and validated attack; lines 219-255 config/live
  updates; 289-341 physical ownership; 401-437 Code sessions and retuning.
- [patch.js](../synth-scsp/patch.js#L29): version gates and portable export.
- [fm_custom_view.js](../synth-scsp/fm_custom_view.js#L21),
  [synth.js](../synth-scsp/synth.js#L250): current graph controls/rendering and
  UI topology key at lines 1098-1100.
- [processor.js](../synth-scsp/processor.js#L83): synchronous instrument command
  execution on the renderer side, separate from asynchronous message arrival.
- [scsp.cpp](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp#L466):
  direct stack-cell writes, plus the source-derived recurrence in the research.

This design adds no runtime tests or implementation files. The
[implementation TODO](todo_scsp_synth_cycle2_design_20261118.md) separates the
completed planning work from future coding and listening.
