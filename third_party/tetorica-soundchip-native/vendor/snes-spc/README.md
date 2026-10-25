# snes_spc adaptation

Upstream: https://github.com/blarggs-audio-libraries/snes_spc

Revision: `ec8ee2bbe30451614c1d02a83f7af1c97d497d45` (snes_spc 0.9.0).
Author: Shay Green. License: LGPL-2.1-or-later; see LICENSE and the original
copyright notices in each source file. Upstream documentation is retained in
README.upstream.md, readme.txt and snes_spc.txt.

The accurate `snes_spc/SPC_DSP` is used. The optional fast DSP, sound filter,
tempo adjustment and surround disabling are not used. No Nintendo IPL ROM or
game music/sample files are included. Upstream's default two-byte IPL fallback
is retained; an SPC that requires the complete IPL or later host transfers may
not play correctly.

Local changes: SPC_DSP has a separate output mute mask, forwarded by SNES_SPC.
It suppresses a voice's dry mix and new echo sends at `voice_output`, without
injecting KOFF, changing envelope/BRR state, or disabling pitch modulation.
Previously written echo tails remain audible. The muted mix changes subsequent
echo RAM; muting is an output control, not a bit-exact unmuted state trajectory.
With a zero mask the synthesis path is unchanged. The original upstream
`mute_voices` API, which repeatedly issues KOFF, is not used.

Two SMP-register dispatch predicates use an equivalent unsigned bit test instead
of upstream's negative signed left shift, whose behavior is undefined in C++.
The selected registers remain all of $F0..$FF except $F2 and $F4..$F7.
DSP sample-directory addresses wrap to 16 bits, including when DIR/SRCN select
an entry beyond $FFFF; this prevents an out-of-bounds read and matches RAM wrap.

Optional offline trace callbacks record DSP writes and CPU RAM changes (including
the optimized direct-page writes, stack and IPL-overlay paths). The trace clock
follows actual DSP advancement at 1,024,000 Hz; it preserves upstream's deferred
DSP catch-up rather than treating CPU instruction timestamps as DSP timestamps.
Capture does not alter the original PCM. The wrapper replays these events with
initial RAM/register bytes and the original four-frame output FIFO, without the
SPC700 CPU. Same-address RAM writes between DSP advances may be coalesced because
the DSP could not observe their intermediate values.

An optional per-instance DSP RAM read mask covers directory words, BRR headers
and payloads, and both channels of echo reads. A discovery pass collects their
address union; a fresh second pass may omit only CPU RAM writes outside that
union, before applying the trace event limit. The original CPU execution and all
DSP register writes are retained. Tracking is disabled for normal playback.
This preserves the original interval, not arbitrary edits that access new RAM.

Upstream's live-BRR RAM writes can depend on render block boundaries. Playground
conversion uses the same 128-native-frame blocks as its SPC player; the resulting
recorded timeline replays independently of render partitioning. This does not
change upstream RAM timing or promise a hardware-perfect transcription.

The wrapper `wasm/spc_wasm.cpp` and build script `scripts/build_spc_wasm.sh`
are kept in the repository. Rebuild with Emscripten from the repository root:

```sh
sh scripts/build_spc_wasm.sh
```

The complete modified library source and build wrapper must accompany a binary
distribution that includes this LGPL component, as with the existing Nuked
component. This repository does not change the licenses of the other chips.
