# SCSP A -> B -> A research and Code prototype - 2026-11-18

Base `553c59bbf05f601b38ee24196a8d570105c5c1db`. This is a bounded
investigation, not Synth support for cyclic graphs. Production Synth UI,
types, presets, common runtime, native core, WASM and gains remain unchanged.

## Primary sources and their scope

[SEGA SCSP manual](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf),
`ST-077-R2-052594`, manufacturer-authored; archival mirror.
SHA-256: `e4e02013a901d084b2e5156ce1035a5d85cda3857235443c3b4dca41244eba9c`.
Diagrams visually inspected.

| Printed / PDF page | Evidence |
| --- | --- |
| 56 / [68](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=68) | Fig.4.30: OP2 read, OP7 write. |
| 57 / [69](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=69) | Fig.4.31: six-slot-tick pipeline. |
| 58 / [70](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=70) | Eq.4.1; Fig.4.32 X/Y average. |
| 59 / [71](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=71) | Duplicate external input on X/Y; Fig.4.33. |
| 60 / [72](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=72) | Fig.4.34: Self generations `0x20/0x00`. |
| 61 / [73](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=73) | Figs.4.35/36: M1->C2 latest=`0x1F`, past=`0x3F`. |

Tick=`(1/44100)/32`; six ticks approximate 4.25 us.
For `J=M-C`:

| Condition | Low five bits | Latest MSB | Past MSB |
| --- | --- | --- | --- |
| `J>=28` | `J` | 0 | 1 |
| `J<0` | `32+J` | 0 | 1 |
| Otherwise | `J` | 1 | 0 |

These manufacturer labels do not establish zero-delay-core ages.

## Pinned implementation

The standalone SCSP derives from MAME revision
`a64a5d6602b19f67e091a4491f0c851a9dacf79d`;
[provenance and BSD-3-Clause license](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/README.md)
are retained with the source. This investigation uses the current local
adaptation, whose hash is recorded separately from the pristine upstream files
in `build/scsp-cycle2-20261118/research/source-research.json`.

Relevant local source:

- [scsp.h:7](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.h#L7):
  `SCSP_FM_DELAY` is zero.
- [scsp.cpp:592](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp#L592):
  X/Y read relative to the current ring pointer, averaged with integer division,
  then scaled into waveform-address modulation. Raw MDL zero is not a general
  bypass when an offset remains nonzero.
- [scsp.cpp:712](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp#L712):
  active slot output enters the ring after EG/ALFO/TL unless stack writes are
  inhibited. This happens before direct-output/DSP-return mixing.
- [scsp.cpp:729](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp#L729):
  ascending physical slots, read-before-write at each slot, one ring-pointer
  increment per slot, modulo 64. This includes inactive slots' pointer advances.
- [scsp.cpp:255](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp#L255):
  Key On/Off does not clear the stack; reset does at line 961.

The [pinned upstream header](https://github.com/mamedev/mame/blob/a64a5d6602b19f67e091a4491f0c851a9dacf79d/src/devices/sound/scsp.h#L18)
also chooses zero delay and retains an unresolved note about a proposed
four-slot setting. No delay macro is changed here. The physical six-tick
pipeline and this immediate-write approximation are different models.

## Source-derived cross-slot ages

Let `n` be a native 44.1 kHz frame, `M` a source physical slot and `C` its
consumer. The consumer's ring index before writing is `(32*n + C) mod 64`.
For continuously active writes, define two offsets:

```text
d = (M - C) mod 64
p = (M - C + 32) mod 64
```

Modulo values below are nonnegative. The ring stores two banks of 32 slot
values, not a single previous-sample value per slot.

| Source order | Offset `d`: same frame-parity bank | Offset `p`: opposite bank |
| --- | --- | --- |
| `M < C` | `source[n]`, already written this frame | `source[n-1]` |
| `M > C` | `source[n-2]`, not yet overwritten this frame | `source[n-1]` |
| `M == C` | `source[n-2]`, own read precedes own write | `source[n-1]` |

Thus copying a forward DAG offset onto a return edge is consequential:
`(M-C) mod 64` on a later source reads two frames back, not one.
This deduction from the pinned code is independently checked by the
native/WASM experiment below. It assumes uninterrupted writes, no `STWINH`, and no
host or other owner changing those ring cells. Before startup, after inactive
periods or inhibited writes, stored values may be older.

For A in physical slot 0 and B in slot 1:

| Edge / requested input | X/Y selectors | Source ages in this core |
| --- | --- | --- |
| A -> B, current | `63 / 63` | `A[n]` |
| A -> B, previous | `31 / 31` | `A[n-1]` |
| A -> B, average | `63 / 31` | `avg(A[n], A[n-1])` |
| B -> A, same bank | `1 / 1` | `B[n-2]` |
| B -> A, previous | `33 / 33` | `B[n-1]` |
| B -> A, average | `33 / 1` | `avg(B[n-1], B[n-2])` |

Comparing the core-derived A -> B row with the manufacturer table above reveals
that the same selector labels do not imply the same history ages. This is an
implementation discrepancy to document, not evidence of physical fidelity.

Swapping A/B's physical positions swaps which logical edge can consume a
same-frame result. A cycle cannot be topologically sorted so that both edges
read a newly computed result. Its physical order and return history are part
of the sound, not an allocator detail.

## Native experiment and selected research candidate

The independent experiment passed 600 steady-state comparisons, 40 lifecycle
cases, 10 centered-output cases and 10 carrier-output cases, plus two deliberately
wrong history models that failed as expected. Evidence:
`build/scsp-cycle2-20261118/native-research.json`, `native-research.log` and
`native-tests.log`. No physical output device was opened.

The experiment compares the actual two-operator core with a cut return edge
in unused ring cells and with independently clocked single-operator cores. It
imports no Synth routing/command helper. Complete cut-edge ring comparisons
restore both banks of the scratch slots after each frame. For the independent-core
comparison, each operator's post-frame
value is placed at its actual physical slot/bank while untouched initial or
inactive cells are retained; that composed 64-cell image matches the actual
ring exactly. This does not claim the two isolated cores' entire raw rings
individually equal the coupled ring. Cut-edge PCM and raw-stack comparisons
match exactly. Independent per-operator PCM also matches for separate-panned
and carrier-only outputs; centered output can differ by one 16-bit LSB when
independently rounded streams are summed. This rounding limit is reported, not treated as a
full centered-PCM bit match.

Coverage includes physical pairs `(0,1)`, `(1,0)`, `(6,7)`, `(7,6)`, `(0,31)`,
`(31,0)`, `(6,31)`, `(31,6)`, `(12,27)` and `(27,12)`; receiving depths 0, 1, 4,
8 and 12; fresh/stale histories; and the existing 44.1/48 kHz resampler paths.
The five measured alternatives are current-forward/return-previous1,
current-forward/return-previous2, current-forward/return-average12,
both-previous1 and both-bank-average. All 60 high-depth comparison groups
separate the relevant history variants. A same-bank future-source read is
therefore distinguishable from a previous-frame return, even when both remain
finite. Peak output stayed below clipping: up to approximately 0.14634 in the
separate-output cases and 0.27961 in the centered cases. The A-direct0/B-direct5
carrier cases match exactly in both PCM and the composed raw-stack comparison.

The selected **research recipe** keeps the ordinary one-source current forward
edge and averages only the return history:

| Operator / physical slot | Source | X | Y | Input at native frame n | MDL8 word |
| --- | --- | --- | --- | --- | --- |
| A / 6, first | B / 7 | 33 | 1 | `avg(B[n-1], B[n-2])` | `0x8841` |
| B / 7, second | A / 6 | 63 | 63 | `A[n]` | `0x8FFF` |

The generic register word is `(depth << 12) | (X << 6) | Y`; the existing
JavaScript adapter emits zero instead when depth is zero. This preserves its
Off contract without redefining raw native MDL0. A uses TL12 and direct level 0;
B uses TL16 and direct level 5. B is the external output, while A continues
writing its stack even though its direct output is muted. Generated 64-point
sine PCM has amplitude 4096 with full-loop guard depth 12.

This choice is an explicit, tested recurrence for this core, not a conclusion
that it sounds best. No listening test has been performed. The alternative
recipes remain in the evidence. For this candidate, reversing physical order
while preserving logical waveform/frequency/TL identities changes the recurrence
and measured PCM. The same reversal also differs for the duplicated-return and
two-bank-average recipes. The both-previous1 recipe is different: both edges
read prior-frame values and its measured PCM is unchanged by the tested 6/7
order reversal. Do not generalize either result to every profile or hardware.

Native lifecycle measurements retain stack values across live Off/On, pitch
edits, release, raw retrigger and physical-slot sample reuse. After release
finishes, inactive slots stop updating their cells, so old markers persist.
Fresh instances start with zero history; core Stop/reset clears the complete
ring, with Stop retaining PCM RAM. A separate muted Off-depth two-native-frame
prime overwrites both banks and stays silent, then live enable retains those
primed values. An ordinary JavaScript wait cannot promise that exact start
phase/history; this is an optional native policy experiment, not a sample-exact
startup guarantee in the example. The runnable public-client prototype
uses a fresh dedicated instance at setup, not private per-cell writes or a
claim of clearing history on each note.

## Prototype destination and limits

The runnable [Code prototype](../playground/research/scsp-cycle2-prototype.js)
is for **Tetorica FM2612 Playground, SCSP mode**. Its
existing low-level SCSP client exposes physical `setModulation()` and slot
operations. Current **SCSP Synth Code** uses a logical performance facade and
does not expose raw physical modulation. Do not present the research example
as runnable in the Synth's Code panel.

The prototype uses a dedicated
`createSoundChip('scsp', {id:'scsp-cycle2-prototype'})`, retained by
`livePrepare('scsp-cycle2-prototype-setup', ...)`. `useSoundChip('scsp')` would
borrow the shared primary chip and is deliberately avoided. No primary sample
bank, modulation or DSP program is replaced by the example.

The [existing client](../js/playground_scsp.js) validates ordinary setters in
its JavaScript shadow and posts ordered commands; these setters are synchronous.
Adding `await` to `setModulation()` or another ordinary setter does not create
an audio-thread acknowledgement or a simultaneous multi-register transaction.
`loadPCM()` and `getState()` use asynchronous request/reply messages. The
prototype makes no claim of sample-atomic setup or JavaScript loop timing.
Its console table is computed from the requested recipe, not native register
readback. `setNote()` returns hardware-quantized realized frequency, whereas
`getState()` retains requested frequencies; a reported ratio can therefore
include the pitch-code quantization difference.

Playground Run reevaluates source while keeping its prepared values and live
loops. Reevaluation retains this dedicated chip, PCM and feedback history;
it is not a fresh attack. **Stop -> Run** disposes the dedicated instance and
creates a fresh one. The prototype initializes and keys its pair once, then
retunes with note/frequency setters, preserving the running stack across
melody notes. Key Off and All Notes Off do not themselves clear native history.
There is no public raw stack-write operation in this client; do not describe
the example as clearing four individual cells on every note.

The example is a research file, not a registered default/catalog entry. In
Files use `+` to create a JavaScript text file, paste its source, confirm the
Run file selection, and Run. Binary file import is not the verified path for
adding this JavaScript example.

The prototype owns exactly two physical slots, uses an explicit history
initialization policy and routes direct output intentionally. Setting a slot's
direct output to zero does not remove its stack contribution; Master changes
do not implement feedback gain. Hardware MDL, source TL/envelope, X/Y averaging
and the sample all affect the loop. The existing JavaScript adapter's depth-zero
serialization disconnects offsets; distinguish that Off behavior from raw MDL0.

No Synth graph unlock, preset version 11, multi-cycle graph architecture,
adjustable physical pipeline or core change is implied. General cycles,
shared-slot ownership and mixed Self/cross-cycle graphs need separate policy.

## Muted browser verification

`scripts/check_scsp_cycle2_prototype_browser.cjs` passed all eight checks in
each Chromium/WebKit, Main/Worker and 44.1/48 kHz combination: 64 checks total.
`build/scsp-cycle2-20261118/browser-source.json` and `.log` retain the results
and desktop screenshots. The source file was pasted unchanged into a new
JavaScript text file and run through the actual Playground paths. No served
application source or transport implementation was injected or replaced.

Public Worklet state confirmed the two physical slots, taps, source sample,
direct/TL levels and retained instance/PCM during source reevaluation and live
Depth Off/On. Main's message audit observed no repeated reset/upload/keyOn.
Stop disposed the dedicated instance while preserving the shared primary's
sample/configuration state; the next Run created a new bank. Output before the
test mute remained finite and nonzero; every physical destination route stayed
at zero gain. Page, asset and processor errors were zero.

The checker retains hashes for 317 served assets and verifies 251 protected
primary/runtime/Synth/core/WASM input files are byte-identical before/after.
Browser `getState()` does not expose raw ring contents or oscillator phase;
the browser confirms ownership/state continuity, while native probes establish
the raw history recurrence. Optional CDN requests were blocked, exercising the
existing text-editor fallback. No listening or physical Saturn test was done.

## Future Synth integration proposal - not implemented

A bounded two-operator recipe can be considered after the Code experiment and
human listening. It must state logical-to-physical order and which operator is
external output. The existing Synth commonly places B before A and outputs A;
this research example instead places A6 before B7 and outputs B for a readable
forward/return description. Neither ordering is a cosmetic rename.

A normal source-first DAG allocator cannot satisfy both edges of a cycle.
An eventual bounded cycle configuration would therefore retain an explicit
operator order and distinguish its delayed return from the current forward
edge. Existing receiving-operator depth controls could edit the two depths;
depth zero disconnects that edge and breaks the loop through the current
adapter. Source waveform, ratio, envelope, TL and direct/DSP routing still
belong to each operator. Both operators can be modulation sources and potential
outputs, even though the example exposes only B.

Before adding UI or persistence, decide the new Auto/Code attack history
policy, slot stealing, physical manual interference, release/Stop and how this
fixed recipe interacts with dormant Custom graphs. Do not reuse DAG sorting,
silently reinterpret historical graphs, or pretend the current Code facade has
raw modulation. Multiple cycles, combined Self/cross-cycle routing and arbitrary
per-edge delays are outside this proposal. No new preset schema/version or
Synth implementation is introduced by this research.

## Research artifacts and rights

Local PNGs for PDF pages 68-73, the extracted text and a structured source
manifest are under `build/scsp-cycle2-20261118/research/`. The cached original
manufacturer PDF remains under the prior Self research directory. Its pages
are research evidence, not app assets; no permission to redistribute the manual
as part of the Synth is assumed. This report paraphrases the relevant material
and records field values/equations rather than reproducing its prose or images.
The MAME-derived core's BSD-3-Clause notice and pinned upstream sources remain
unchanged. Experimental audio uses generated PCM, with no game recordings.
