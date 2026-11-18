# SCSP self-feedback: primary-source research — 2026-11-18

Base `412d1d28`. This source investigation preceded the native experiment and
bounded implementation contract below. The research itself changed no common
SCSP runtime, native core or WASM.

## Manufacturer documentation

The original SEGA **Saturn SCSP User's Manual**, `ST-077-R2-052594`, is available
from a [public archival mirror](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf).
This is a manufacturer-authored document, not a current sega.com publication.

| Printed page | PDF page | Relevant evidence |
| --- | --- | --- |
| 56 | [68](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=68) | Figure 4.30: modulation read at OP2; stack write at OP7. |
| 57 | [69](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=69) | Figure 4.31: six slot ticks from calculation start to stack write. |
| 60 | [72](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf#page=72) | Figure 4.34: self uses latest `0x20` and past `0x00`; distinct generations on X/Y are recommended to avoid oscillation. |

The slot tick is `(1 / 44100) / 32`, about 708 ns. Six ticks are about 4.25 μs,
not six audio frames. Figures and surrounding text were checked visually.

The PDF SHA-256 is
`e4e02013a901d084b2e5156ce1035a5d85cda3857235443c3b4dca41244eba9c`.
Local research artifacts, including the original PDF, page PNGs and structured
source notes, are under `build/scsp-self-feedback-20261118/research/`.

## What the pinned core actually does

The standalone source is pinned to MAME revision
`a64a5d6602b19f67e091a4491f0c851a9dacf79d`; see
[its provenance](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/README.md).
The relevant paths are:

- [scsp.h](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.h),
  line 7: `SCSP_FM_DELAY=0`.
- [scsp.cpp](../../third_party/tetorica-soundchip-native/vendor/mame-scsp/scsp.cpp),
  lines 592–600: read X/Y relative to `BUFPTR`, average them, then adjust waveform
  addresses. Lines 698–723: write the stack after envelope/ALFO and TL processing,
  unless `STWINH` suppresses it.
- The same file, lines 729–779: process 32 slots per native frame, advance
  `BUFPTR` for every slot, and wrap its index modulo 64. The zero-delay build
  writes the current result immediately to that current index.
- Lines 255–282: key start resets phase/EG, and key stop changes active/release
  state; neither clears the stack. Lines 956–965: core reset clears the stack.

Although storage is allocated for 128 words, this modulation path uses the
64-entry index. Its stack data precedes final direct-output / DSP-return mixing;
Master volume is not feedback gain.

### Source-derived history model

For frame `n` and physical slot `s`, the read/write index is
`(32 * n + s) mod 64`. Before that frame's write:

| Self offset | Same-slot history, under continuous active writes |
| --- | --- |
| `32` (`0x20`) | `y[n - 1]` |
| `0` (`0x00`) | `y[n - 2]` |
| X/Y `32` / `0` | Average of those two stored generations, using core integer arithmetic. |

This deduction from the pinned implementation was subsequently checked against
independent native/WASM PCM in `build/scsp-self-feedback-20261118/research.json`.
It assumes the slot has been active, `STWINH` is clear,
and no host write or other owner replaces its stack history. Inactive slots,
inhibited writes, retriggering and slot reuse can leave older data. A new note
must not be described as starting from zero history without a separate policy
and test.

## Zero slot-write delay is an acknowledged approximation

The [pinned upstream header](https://github.com/mamedev/mame/blob/a64a5d6602b19f67e091a4491f0c851a9dacf79d/src/devices/sound/scsp.h#L18)
also selects zero delay. Its comment records a proposed four-slot value from
driver code that did not sound correct. The
[current upstream header](https://raw.githubusercontent.com/mamedev/mame/master/src/devices/sound/scsp.h),
checked 2026-11-18, retains that setting and unresolved note.

The manual's physical pipeline and MAME's configurable implementation are
different evidence. Matching the recommended `0x20` / `0x00` register selection
does not establish full physical timing fidelity. Changing the macro would also
alter existing non-feedback sounds and is outside this prototype.

## MDL zero: raw core versus existing JavaScript adapter

The raw modulation branch tests offsets as well as MDL. Raw `MDL=0` with a
nonzero offset therefore still enters its integer address-modulation calculation;
do not call that raw setting a general bypass.

The existing [ScspSynth adapter](../js/scspsynth.js), line 20, instead serializes
depth zero as register word zero, disconnecting both offsets. Its existing
`setModulation()` contract describes this behavior at lines 180–192. A Synth
prototype can preserve **depth 0 = Off** through this adapter without claiming
the same behavior for raw native register writes. This research does not request
an adapter change.

## Bounded implementation contract adopted after the experiment

- Custom2 only; at most one self-feedback operator, with at most one source per
  target. The other operator may receive that self-feedback operator, for example
  `B → B` plus `B → A`.
- Use the independently verified two-generation self selection X/Y `32` / `0`.
  Keep the existing receiving-operator MDL and adapter depth-zero behavior.
- General multi-operator cycles, two self operators, Custom4/6 feedback,
  adjustable delays and changes to common core timing remain outside this step.
- New Auto / Code self-feedback attacks clear only the newly owned physical
  self slot's two stack cells. This is explicit software initialization, not
  hardware Key On behavior. Live changes, raw manual attacks and non-self notes
  retain history.
- Implicit Custom4/6 resizing removes self edges but preserves supported external
  edges and outputs. Explicit unsupported graphs reject atomically. A dormant
  graph is projected when Custom is entered at that operator count.
- Actual supported self graphs use preset version 8, with optional per-OP depths.
  Versions 1–7 reject self graphs; non-self exports retain their old formats.

Suitable eventual wording is **self-feedback through two generations of the
existing SCSP sound stack, verified against this pinned core**. Avoid claims of
instantaneous feedback, exactly one physical sample of delay, or guaranteed
hardware-accurate slot timing.
