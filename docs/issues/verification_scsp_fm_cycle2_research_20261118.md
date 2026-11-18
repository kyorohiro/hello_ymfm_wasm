# SCSP bounded two-OP cycle research/prototype verification - 2026-11-18

Base: `553c59bbf05f601b38ee24196a8d570105c5c1db`.
This step investigates A -> B -> A through existing raw SCSP APIs. It does not
unlock cyclic graphs in SCSP Synth or change its API, UI, presets or core.

## Try it

Open **Tetorica FM2612 Playground in SCSP mode**
(`playground/index.html?mode=scsp`, Web Audio Main or Worker). Open
**Files -> examples -> scsp -> scsp-cycle2-prototype.js**, select it as Run file,
and Run. The [editable example](../playground/examples/scsp/scsp-cycle2-prototype.js)
is bundled with Playground. The Console displays the requested slot/register table.

Edit `feedbackDepth` or `forwardDepth` (0..12) and Run again for live depth
changes. Playground Run reevaluates with the same `livePrepare` value and
retains the dedicated chip/PCM/history. **Stop -> Run** creates a fresh instance;
use this for setup/sample edits or a fresh-history comparison. This is different
from the current Synth Code facade; the example belongs in Playground.

The original verification below used a new text file plus pasted source before
the example was registered. The subsequent
[Examples integration](verification_scsp_cycle2_examples_20261118.md) verifies
loading the bundled file directly. Its body is unchanged; historical measurement
JSON retains the original paths and hashes.

## Candidate and evidence

The chosen reference recipe is **current-forward-average12** for the pinned
zero-slot-delay core: A is physical slot 6, B is slot 7, A precedes B. A reads
`avg(B[n-1], B[n-2])` with X33/Y1; B reads A[n] with X63/Y63. At MDL8, requested
register words are **0x8841 / 0x8FFF**. A's direct output is off and B is the
only external output. Source TL/envelopes still affect the ring independently
of direct output. This is a minimal extension of the existing current-forward
operation, not a finding that this recipe sounds best or exactly matches the
physical chip pipeline. See [research and future design](scsp_fm_cycle2_research_20261118.md).

- **600** steady native cases cover 10 physical placements/order reversals,
  five timing profiles, raw native MDL0 versus adapter Off, MDL1/4/8/12 and
  44.1/48 kHz output. **40** lifecycle, **10** centered-output and **10**
  single-carrier cases bring the matrix to **660**, plus two deliberately
  incorrect history models and a separate startup/history-policy probe.
- Actual two-OP PCM is exact against a return-edge-cut reference fed with its
  own logged history. Scratch cells are restored before full 64-cell comparison.
  Two independent single-OP cores also reproduce raw operator values composed
  at their actual physical positions. Separated outputs match exact PCM;
  centered sums of independently rounded PCM differ by at most one 16-bit LSB.
  This rounding difference is recorded as non-exact rather than hidden behind
  a tolerance. Centered cut-edge two-OP PCM remains exact.
- Wrong return histories demonstrably fail, and the high-depth history choices
  differ in all 60 measured comparison groups. Maximum measured peak is below
  clipping. Reversing slot order changes the candidate's measured PCM; the
  tested both-previous1 recipe remains unchanged under that reversal.
- Fresh native history starts at zero. Key Off, retrigger, live changes and
  reuse retain cells; inactive values can be older than nominal sample ages.
  Native Stop/reset clears all cells while retaining RAM in the tested policy.
  The Code prototype relies on a fresh dedicated instance, not private writes
  or a claimed sample-atomic JavaScript pair trigger.
- **11 native tests +3 actual-example tests** pass. The example is evaluated
  through mocks for ownership/reevaluation/cleanup and through real WASM for
  slots/PCM guard/finite output/live depth. The generated example bundle's
  existing `--check` still passes, with no catalog/seed edits.
- **64 browser checks** pass: Chromium/WebKit x Main/Worker x 44.1/48 kHz, each
  eight checks. Actual public Worklet state, requested table, finite nonzero
  pre-mute output, reuse, live Off/On, Stop disposal/primary configuration and
  fresh bank ownership are verified. Ring/phase are not exposed by getState;
  their semantics come from native evidence and lifecycle, not an invented
  browser readback. Ordinary raw setters post commands and are not audio-thread
  acknowledgements or a sample-atomic two-slot transaction.

## Preservation and reproducibility

The independent audit checks all **7,512** base Git blobs. **7,511** are unchanged;
the only previously tracked change is four CI lines for the new tests/browser
and its artifacts. Historical JSON899, Synth109, runtime497 plus browser443,
vendor1085, generated85 and calibration/gain-related217 files remain unchanged.
Independent writer-clock enumeration checks **8,192** selector comparisons.
Native source/WASM/report hashes and browser/example/document evidence match.
Browser verification records **317** served assets and **251** protected source
files, unchanged before/after, with zero app-source injection and no page/asset/
processor errors. All physical output stays muted. Code/Console screenshots
were inspected, along with the relevant manufacturer PDF diagrams.

```sh
node --test scripts/scsp_fm_cycle2.test.mjs docs/playground/playground_scsp_cycle2_example.test.mjs
node scripts/probe_scsp_fm_cycle2.mjs
node scripts/check_scsp_cycle2_prototype_browser.cjs --root=docs --out=build/scsp-cycle2-20261118/browser-source.json
```

The full Node report is generated under `build/scsp-cycle2-20261118/`; no audio
device is opened. The existing production source receipt check passes. CI adds
the scoped test and browser commands while retaining its existing checks;
GitHub execution awaits a user push. Logs, primary-source manifest and figures
are local research evidence. The
[machine record](verification_scsp_fm_cycle2_research_20261118.json) binds them
by size/hash, without adding the manual's images to the distributed app.

No Synth/preset/runtime/core/WASM/gain change, new preset version, package
version bump, release ZIP, publication, commit/push/tag or Tauri update occurred.
Listening and bounded Synth integration are separate follow-up work.
