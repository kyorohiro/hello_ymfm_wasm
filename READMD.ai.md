# Tetorica — AI/SI development handoff

[English](README.md) | [日本語](README.ja.md) | [AI/SI](READMD.ai.md)

Updated: 2026-11-07 (English handoff; readable distributions, C64 Playground, SID Synth and browser SID Player). This is an entry point for AI agents investigating the repository and resuming work.

## C64 SID work in progress

The user authorized an implementation-first order. Start with
[`docs/issues/todo_sid_01.md`](docs/issues/todo_sid_01.md) and the linked core
selection / Playground integration notes. The standalone 6581 register lab is
at `docs/playground/sid-lab/index.html`. Regular **C64**
mode (`?mode=c64`, chip/global `sid`), Main / Worker clients, additional
instances, typed note / voice / shared-filter helpers and a read-only SID tab
are implemented. See [the guide](docs/sid.md). The standalone keyboard Synth is
at `docs/synth-sid/index.html` ([guide](docs/synth-sid/README.md)). A separate
browser [SID Player](docs/sid-player/index.html) selects a backend from each PSID
v2 subtune's speed bit: VBI defaults to actual VIC raster interrupts in the C64
machine; CIA uses CIA1 interrupts. Direct VBI is an explicit legacy option.
RSID v2 uses that machine for its
own interrupt or continuous code. All target PAL / one 6581. Local files,
original demos, subtunes, Play / Stop and live voice/filter state are implemented.
The C64 backend clocks CPU, both CIAs, VIC and IRQ/NMI; CIA playback does not
substitute host-periodic VBI calls. Current integration passed 93 player tests,
10 corpus-tool tests, 29 reference tests and 124 source/actual-ZIP
Chromium/WebKit checks on 2026-11-07. See [the current result](docs/issues/sid_c64_vbi_result_01.md)
and [package proof](docs/issues/sid_c64_vbi_package_01.json) for the checked scope.
Accepted machine ROM settings survive intermediate Direct VBI subtunes until
explicitly reapplied.
Relocation metadata describes free player-driver RAM, not a new tune load
address. Direct VBI accepts structurally valid ranges and FF/0 without adding a
RAM driver page. C64 VBI and CIA need safe driver RAM; CIA keeps its legacy
layout for 0/0. Explicit ranges use the first available page in 04..9F or C0..CF.
Machine modes reject FF/0 or a range with no usable page, suggesting Direct VBI
for a VBI tune rather than silently falling back or overwriting RAM.
Do not require the entire declared
window to avoid ROM, and do not rewrite the header or payload. The browser
validator's driverPage is null for Direct VBI, 0 for legacy CIA, or the chosen page;
the native C64 API reports driverAddress. The relocation path is covered by the
latest totals above; see phases 9 and 12 of the TODO and the linked reports.
The prior clean-file CIA PCM/trace/state stayed exact in nine cases, alongside
the existing twelve-case RSID baseline. The new native source kit reproduces
the packaged WASM byte for byte. VBI still owns its reserved caller and stack.
The bounded-VBI host sets the required PAL byte 02A6=1 and the entry-based
bank before every init/play call (37 below A000, otherwise 36 for the supported
payload range). Its timeout messages distinguish init from play, and JAM/KIL is
reported explicitly. The 100k/16k budgets are host policy, not PSID format limits;
they have not been increased. A pinned-m6502 microcycle guard accepts only an
unconsumed wrong-page VIC read from indexed STA (9D/99 post-IR phase3, 91 phase4)
whose corrected address is SID. Mirrored 1E/1F collision reads remain unsupported
because they clear state; only side-effect-free reads qualify. Actual VIC/CIA/ROM
accesses remain unsupported in this backend; do not broaden this to blanket I/O
reads. These legacy-host changes passed the historical phase-10 totals (83 player,
29 reference and 116 browser checks), twelve unchanged VBI
PCM/trace/state baselines and isolated source-kit rebuilds. Zyx.sid now renders
ten seconds and stops cleanly without changing its input bytes; see phase 10
and the sid_zyx_vbi_verification / sid_vbi_environment reports. The original
user timeout at 1EE4 still has no identified input; resolving Zyx's distinct
dummy-read failure does not resolve that unknown timeout.

The user also requested an audit of the local ww/C64Music corpus. Its original
check:sid-corpus tooling passed eight synthetic-corpus tests and a five-demo
pilot, including a zero-new-row resume with unchanged checkpoint hash. The full
default-subtune, two-second/48kHz PAL/6581 minimal-environment run completed all
61,157 files in about 21.6 minutes: 26,497 executed_nonzero, 1,050 executed_silent,
32,448 unsupported, 906 needs_rom and 256 runtime_failed. Read [the report](docs/issues/sid_corpus_audit_01.md).
Whole-corpus resume reused all 61,157 rows with zero new results and unchanged
checkpoint, input manifest, source/WASM fingerprint and classifications. No lock
remained. [Independent row/measurement verification](docs/issues/sid_corpus_audit_verification_01.json)
passed: 61,157 unique contiguous rows match the manifest; all 27,547 completed
windows have 96,000 finite samples and zero/stable Stop output, without missing
or duplicate rows or successful-row measurement anomalies.
These classifications do not establish that
all files or subtunes play correctly. Western_Games song1 reproduces 1EE4 and
returns from a legitimate init at 132,113 cycles in scratch diagnostics, then
hits a genuine STA DC04. The C64 VBI route now handles this without rewriting
speed or ignoring real I/O; all three Western Games subtunes passed separate
ten-second checks. The user's original timeout input remains unconfirmed.

The C64 VBI milestone is complete. It initializes VIC raster IRQ below
256, CIA1 TA running at 4025 with its IRQ masked, and other timers disabled at
FFFF; play runs from real interrupts and VIC/CIA are acknowledged afterward.
The 100k-cycle preflight may leave init pending; bounded render chunks retain
startup PCM until RTS or a 2M-cycle deadline from the driver bootstrap. The UI
yields while validating pending candidates before adoption; playback reloads a
fresh machine and streams the initial PCM. Play remains limited to 16k cycles.
Expansion I/O DE00..DFFF is explicitly unsupported in the new C64 VBI route;
do not describe this as complete C64 software, cartridge or disk support.
The shared browser validator keeps vbiBackend:'direct' by default for API
compatibility, while UI/C64 wrapper explicitly choose c64. CLI reference limits
and known NTSC/8580 rejection remain unchanged. The old 61,157-file audit is an
immutable Direct VBI baseline. This was a targeted retry of 3,233 prior VBI
failures plus 64 controls, not a new whole-corpus run. Of the old failures,
3,025 completed (3,015 nonzero and ten exact-zero windows); 195 ROM-access cases,
nine play timeouts, three init deadlines and one expansion-I/O case remained.
All 64 controls kept their prior status: VBI 24 nonzero/eight silent, CIA eight/eight,
RSID eight/eight. CIA/RSID RMS and peak were also exact; VBI scheduling changes
do not require PCM identity. All 3,089 completed windows had 96,000 finite frames,
zero/stable Stop and, for PSID, a returned init. Extra init-validation frames are
separate from the first two seconds used for RMS/peak. Full selected-set resume
reused all 3,297 rows with zero new executions and identical hashes/classifications.
See [the retry summary](docs/issues/sid_c64_vbi_retry_01.json) and
[18-check independent comparison](docs/issues/sid_c64_vbi_retry_comparison_01.json).
Seven separate real-file cases passed ten seconds, including Western Games
subtunes 1–3 ([evidence](docs/issues/sid_c64_vbi_verification_01.json)).
The isolated 29-input source kit rebuilt the 116,131-byte C64 WASM and receipt
byte-identically ([proof](docs/issues/sid_c64_vbi_sourcekit_01.json)); final WASM
SHA-256 is d05d625d863c434e6992a2b553019b4a261c00d484faeff7633bc357ac5b5c9c.
The readable 0.0.7-c64-vbi-preview ZIP contains 80 files/ten browser modules,
1,573,534 bytes, SHA-256 730c1c4d596506e96fba6cca40cbcc73c20d097f57a38c300697a9c6887ed895.
Outer/nested CRC, 68 original inputs, 43 native inputs and all extracted bytes
were checked. No publication, tag, commit or npm release was performed.
Commands, status meanings and restart instructions are in [the corpus guide](docs/sid-corpus.md).
Keep all input manifests and result
JSONL under release; only compact summaries belong in docs/issues. Checkpoint
resume must match sources, WASM, policy and inputs. Do not edit runtime or audit
worker sources while that run is active, and do not treat silence, a short
smoke test or header acceptance as musical or full-song compatibility.
The C64 backend's default firmware is an independently authored, limited IRQ/NMI
shim with fail-closed unsupported ROM access. Optional user Character / BASIC /
KERNAL ROMs apply to C64 PSID VBI, PSID CIA and RSID and stay in memory only.
Direct VBI remains independent of those settings and pending firmware reads.
After supplied-ROM boot, PSID installs the original RAM init/play caller, while RSID requests RUN or
SYS. Both PSID and RSID browser validators accept
unknown/either clock/model flags only after explicit PAL/6581 selection through
the initially unchecked playback-target setting. Declared hints and original
header bytes remain intact; selected target metadata is separate. Known
NTSC/8580/multi-SID are rejected even with that setting enabled. An isolated
8580 research prototype is described below; it has not been adopted. Do not add
a 6581 preview override or describe current Player playback as 8580 emulation. Real-ROM/BASIC
compatibility still needs confirmation. D418 volume-DAC digi is not modeled;
an executing program can remain silent. Read [the guide](docs/sid-player/README.md).
Pinned zlib chips headers compile unmodified as C11; the existing adapted SID
and original host/shim compile as C++17. `scripts/sid_rsid_artifacts.mjs --check`
authenticates the C64 RSID / PSID VBI/CIA WASM and matching source kit; `build:sid-rsid`
rebuilds it. The bounded VBI host has its own separate WASM/source receipt; the
SID Synth/Playground chip core and calibrated SDK remain unchanged. No GPL
reference player, Commodore ROM or game data is linked or bundled. A valid
header does not prove driver compatibility. No npm release / Native SDK is published.
The original zlib-licensed chips/m6581 header is pinned and retained alongside
the marked adaptation. BSD-3-Clause wrappers live in `tetorica_src/wasm/sid_*`
and `tetorica_src/runtime/sid*`; public modules are exact `docs/js` copies.
Do not modify the authenticated SDK snapshot to add this prototype.

Use `npm run build:sid`, `npm run test:sid`, `npm run test:sid:native`, and
`npm run test:sid:browser`. `scripts/sid_artifacts.mjs --check` verifies this
prototype's separate receipt, upstream hashes, modules, WASM and matching source
kit. The full runtime artifact catalog includes SID as an application instrument
with its separate receipt, while the fixed SDK remains unchanged.
`node scripts/package_sid_lab.mjs` creates a readable standalone lab package;
`sh scripts/package_itch_playground.sh` also ships the regular C64 mode.
6581 filter / combined waves remain approximations; production APIs provide no 8580 model.
Native / WASM equality verifies port consistency, not real-hardware fidelity.

The initial 8580 research/prototype milestone (phase 13) is a historical snapshot;
the current bounded-bus/real-6502 follow-up is described below. Production
adoption is still deferred. Read [the fixed-source/license selection](docs/issues/sid8580_core_selection_01.md)
and [prototype result](docs/issues/sid8580_probe_result_01.md) before continuing.
The candidate is sidera 1.1.1's dependency-free MIT library, revision
15041709d26c2bc36667ba27f729332c9f523696, crate SHA-256
b043512b891bdb03ad21b0205723dabb88ada23e3043c21f6a7f88b26defba35.
Original source stays in third_party/sidera/upstream; the adapted copy adds only
the marked cycle-access API. Its original clock()/clock_with_voices() output and
OSC/ENV reads remain exact for 376,200 samples across six rate/model settings.
The optional Cargo player and its dependencies are not compiled or represented
as license-audited. Required license closures ruled out perfect6581's noncommercial
netlist and MAME's GPL engine/tables as permissive production alternatives.

The standalone probe uses completed chip-cycle boundaries: reads/writes do not
advance time; c N advances exactly N cycles. At 44.1/48/96 kHz and both models,
14 self-authored fixtures produced 84 exact Native/WASM PCM/read/chunk matches
([verification](docs/issues/sid8580_probe_verification_01.json)). Chromium and
WebKit each matched 28 Native cases at 48 kHz, 56 browser matches total
([report](docs/issues/sid8580_probe_browser_01.json)). Those are plain WASM runs,
without AudioContext, AudioWorklet, physical output, C64 CPU, firmware or music.
Core-only throughput on Apple M2 was roughly 70x real time in these bounded
batch measurements; this is not end-to-end Player capacity or dropout evidence.

Twenty-eight comparisons use a NEW separate GPL libresidfp raw-bus oracle,
not a relaxed strict PSID CLI. They are diagnostics, not accuracy acceptance.
In the initial phase-13 snapshot, candidate write-only reads were [0,0,0], versus
[165,165,165] for the 8580 reference: bus behavior was absent. The current wrapper
now adds a bounded approximation; POT remains unsupported. Candidate reset
starts oscillator/envelope at zero, while the reference retains 0x555555/0xAA;
this affects raw PCM and early read comparisons. Filter resonance, analogue
offsets, external RC, scaling and sample-start/fixed-point sampling also differ.
Do not infer a gain correction from raw RMS or call port equality hardware fidelity.
The external GPL binary remains a separate local validation executable and is
excluded from the MIT/BSD candidate and source kit. Its protocol is
SID8PROBE 1 RATE MODEL, with no implicit clocks for read/write; DECIMATE reports
its actual frames/divisor/effective rate rather than claiming nominal frame identity.

[Initial source-kit rebuild](docs/issues/sid8580_probe_sourcekit_01.json)
checked 53 inputs and reproduced Native/WASM/receipt bytes exactly. That phase's WASM
is 1,390,542 bytes, SHA-256 96abb0664a7aa7f3df7b1a63fa8f9b8e576a492936ce4175db1fd7019b4610bd;
the phase-13 _01 reports identify this same WASM. Its historical readable archive
release/tetorica_sid8580_probe_20261107_sources.1.zip contains 71 files/541,950 bytes,
SHA-256 244d0aa1f07ea70728bca200f94d0a89e1b61b488ea49af79ca09738c557bd8d.
It includes matching sources/licenses, WASM and the installed Rust 1.91.1 standard
library's unmodified copyright/license notices, including COPYRIGHT-library.html.
Notice hashes/provenance live separately under third_party/sidera/toolchain-notices;
the 53 application build inputs and Native/WASM/rebuild hashes remain unchanged.
These standard-library notices do not imply optional Cargo player crates were built.
Native binaries, GPL SID reference code/binary, firmware and music are excluded. Rebuild with
sh scripts/build_sid8580_probe.sh; verify with node scripts/check_sid8580_probe.mjs
and node scripts/sid8580_probe_artifacts.mjs --check build/sid8580-probe.
The unchanged original sample APIs were rechecked with the CI compile commands.

The current follow-up adds an independent wrapper bus model, based on primary
hardware notes and 362 black-box probes of the external oracle
([measurements](docs/issues/sid8580_bus_reference_01.json)). No GPL bus implementation
was copied. The selected lifetimes are 7,424 cycles for 6581 and 663,552 for 8580,
reference-measured approximations rather than universal hardware constants.
Writes to all offsets and candidate OSC3/ENV3 reads refresh the latch; write-only
reads return it and halve remaining life with a minimum of one cycle. Completed
ticks age it, reset/Stop clear it, and instances stay independent. The minimum-one
rule deliberately avoids the oracle's observed residual-zero immortal-latch
anomaly. POT reads fail with error 5 without fabricating an analog value.

[Current probe verification](docs/issues/sid8580_probe_verification_02.json) preserves
all 84 original PCM cases exactly. [Bus checks](docs/issues/sid8580_bus_verification_01.json)
add 66 Native/WASM/chunk cases. A separate real pinned chips/m6502 bridge adds
[36 CPU cases](docs/issues/sid8580_cpu_verification_01.json), for 186 port cases total.
At cycle 41,219 the same program reads 0 on 6581 or A5 on 8580; its own CPU then
writes RAM signature 32hex/31hex and SID frequency-low 64/128. Another program
reads actual OSC/ENV [0,255,177,255], stores them in RAM and writes 177 to the SID.
No fixed read values are fed to the CPU. POT/JAM/unsupported ROM freeze with
address/error metadata. The environment is authored RAM, not a full C64 with
CIA/VIC/banking/firmware. One WASM owns CPU and SID, avoiding JS calls per chip tick.
[Current Chromium/WebKit](docs/issues/sid8580_probe_browser_02.json) each match
50 chip/bus and 12 CPU cases: 124 matches total, without AudioContext or Worklet.

[The native run(1) microbenchmark](docs/issues/sid8580_tick_performance_01.json)
measured a local median 5.09x improvement by clearing only the valid output length
on each run, while Stop/Reset still zero-fill. Valid PCM hashes remained exact;
only output[..output_len] is readable after each call. This is not a Player speed
guarantee. Current CPU+SID bounded batches measured roughly 40x real time in Node;
full C64/Worklet scheduling and real-time dropout behavior remain untested.

[The new independent source-kit proof](docs/issues/sid8580_probe_sourcekit_02.json)
checks 59 inputs, including the new C compiler/target/profile, and reproduces
both Native and both WASM outputs plus the receipt byte for byte. The kit itself
passes 84+66+36 checks without parent-source fallback or the GPL oracle. Original
sample APIs were rerun with the CI compile commands: 376,200 samples/six settings
still match upstream exactly. Current chip/bus WASM is 1,391,574 bytes, SHA-256
2b82f306f1c9460ef4558d7faf73cf1eb49b7de2eead09d8c5e38c858429667d;
CPU/SID WASM is 1,473,638 bytes, SHA-256
38118d68288cdde417a2fab099497ec057432de6c25058b7db467bb26e2dffb2.
The readable release/tetorica_sid8580_bus_cpu_20261107_sources.zip contains
86 files/962,936 bytes, SHA-256 dc8cc1b3c358e0fe86b3dcfa0f3d658f540dbdbc3a271f6124bad898b0227835.
It includes Node checkers, both WASMs, matching sources/licenses, pinned m6502's
zlib license and installed Rust standard-library notices. It excludes Native
binaries, GPL SID reference code/binary, ROM and music. Apple Clang without a
WASM backend can use Emscripten's LLVM compiler binary; the freestanding object
does not introduce an Emscripten runtime dependency. All phase-13 _01 reports
and their historical archive remain unchanged.

Phase 15 adds [controlled quality comparison](docs/issues/sid8580_quality_result_01.md)
with [explicit conditions](docs/issues/sid8580_quality_method_01.md): TEST/Gate and
observable OSC/ENV warmup, public chip-rate reference output, a common integer
sampler retained through skip, exact sample-tick harmonic/DC fitting and each
engine's own filtered/dry amplitude ratio. Raw PCM is never phase/gain/DC fitted.
The [seven analytical metric tests](test/sid8580_quality_metrics.test.mjs) pass;
[six capture/reference configurations](docs/issues/sid8580_quality_capture_reference_01.json)
verify warmup, split windows, tick/frame accounting and rejection before output.
This controls observable state and sample grid, not every hidden/noise/pipeline
or motherboard-RC condition.

The initial [228-case/165-transfer characterization](docs/issues/sid8580_quality_comparison_01.json)
led to an experimental 8580-only damping profile, 8580-resonance-logfit-v1,
OFF by default. Only FC128/sustain4/48kHz reference apparent Q at RES4/8/12/15
trained an exponential Q curve with the existing RES0 reciprocal coefficient
1448 preserved. The integers are independently fitted, not copied oracle tables.
The opt-in quality CLI flag is --8580-calibration; the controlled checker uses
--calibrated-8580. Cutoff, RC, global gain, wave/noise/ADSR and pipeline are unchanged.

[Before](docs/issues/sid8580_quality_validation_before_01.json) and
[after](docs/issues/sid8580_quality_validation_after_01.json) each cover 260 cases.
[Independent holdout analysis](docs/issues/sid8580_quality_validation_analysis_01.json)
separates eight true FC256 curves (RES2/6/10/14 at sustain4/15): mean absolute
relative Q error fell 13.43% to 3.10%, seven of eight improved. Across 176 held-out
frequency points, mean absolute error fell 1.437 to 1.126dB and maximum error
4.024 to 2.467dB, but 67 points worsened (109 improved). One low-RES curve worsened
slightly; near 1400Hz/RES14/sustain4 absolute error rose .053 to 2.436dB. Do not
claim universal improvement. The denser FC128/RES15 result is training-setting
replication, not a ninth independent holdout. All 260 reference objects and 61
candidate dry objects stayed exact across the before/after runs.

[Calibration policy](docs/issues/sid8580_calibration_policy_01.json) confirms six
default/invalid/reset/Stop configurations, 42 unchanged 6581 scenes, three effective
8580 controls and six independent-instance cases. Default 84 PCM, bus66, CPU36,
controlled228 and the original 376,200 sample API comparison remain unchanged.
[Current browsers](docs/issues/sid8580_probe_browser_03.json) each match 50 chip/bus,
12 CPU and 11 controlled-quality cases: 146 matches total, without AudioWorklet
or full-C64/listening acceptance.

[The phase-15 independent kit](docs/issues/sid8580_probe_sourcekit_03.json) rebuilds
all five outputs/receipt from 62 compiled inputs byte-identically and passes
eleven build/test commands, including the 228 candidate-only quality scenes and
seven math tests, without GPL reference or parent-source fallback. Archive
release/tetorica_sid8580_quality_20261107_sources.zip has 105 files/1,059,166 bytes,
SHA-256 8356799fd4b2f8313d570687e089f04615cbfd32366f731bcb3aaab681741b62.
It contains readable sources/tests/checkers, two WASMs and license/Rust notices;
Native binaries, GPL SID oracle, ROM/music/PCM are excluded. Large training-case
metadata is represented by pinned SHA/provenance; compact analyses are included.
Use node scripts/package_sid8580_sourcekit.mjs --plan for a read-only closure
check, or --version NEXT --verify for a new exclusive stage/archive and rebuild.
CI has thirteen steps; no GitHub Actions run, push, commit, tag or release occurred.

Phase 16 completes the separate [cutoff experiment](docs/issues/sid8580_cutoff_result_01.md),
using a [prefrozen matrix](docs/issues/sid8580_cutoff_plan_01.json) and
[explicit LP/HP method](docs/issues/sid8580_cutoff_method_01.md). The operational
same-harmonic LP=HP crossover cancels Q/common RC only under the stated linear
conditions; it is not an intrinsic pole or arbitrary-Q -3dB cutoff. Actual sample
ticks, observable warmup, validity guards and raw PCM are retained. Thirteen
analytical/synthetic-fit tests pass. The seven training FCs at 48k/sustain4/RES0
provide 189 captures; the fitted 8580-cutoff-crossover-v1 profile is frozen before
holdout and independent of the damping flag. FC0 retains the unmeasured original
30-Hz anchor. Both experimental flags remain OFF by default.

Four flag groups each cover 270 holdout captures: six untrained FC curves and
four separate rate/level/resonance interactions. [Independent analysis](docs/issues/sid8580_cutoff_validation_analysis_01.json)
finds all ten crossover errors improve with cutoff alone, mean absolute error
9.855% to 0.918%. Across 180 LP/HP amplitude-ratio bins mean absolute error falls
1.331 to .648dB, but 32 bins worsen (148 improve). Adding cutoff to resonance-only
improves ten of ten crossovers, 9.866% to .902%, and mean bin error 1.216 to .317dB,
with 164 improving and 16 worsening. The six true held-out FCs improve 9.769% to
.865%; keep the four interactions separate. FC96 still has -3.081% crossover
error and about 2.795dB maximum bin error. Nine predeclared frequencies are a
deterministic bracket estimate, not a physical-accuracy confidence interval.
No holdout retuning, reference implementation/table copying or PCM correction
was used. All reference 270 and candidate dry90 objects are unchanged.

[Cutoff policy](docs/issues/sid8580_cutoff_policy_01.json) checks independent flags,
default/invalid/reset/Stop/model/instance behavior, 42 inert 6581 scenes, nine old
PCM hashes, three effective 8580 controls, 24 Native-quality and 24 raw Rust model
cases. Old84/bus66/CPU36, the 376,200-sample original API and the earlier resonance
260-case PCM/read/range outputs are unchanged. [Refreshed browsers](docs/issues/sid8580_probe_browser_04.json)
match 146 prior cases; [cutoff browsers](docs/issues/sid8580_cutoff_browser_01.json)
match 30 per Chromium/WebKit, for 206 total batch-WASM matches, not Worklet/audio
or full-C64 acceptance.

[Source kit _04](docs/issues/sid8580_probe_sourcekit_04.json) independently rebuilds
all five outputs and receipt byte-identically from 63 compiled inputs, with
15 build/test commands and CRC/all-file equality. The new archive is
release/tetorica_sid8580_quality_20261107-cutoff_sources.zip: 122 files/1,214,079 bytes,
SHA-256 369fbbe97506407679c74f58c57cdad3973d7cea2880e79d86660717d27fc02c.
Readable sources, two WASMs, cutoff training metadata/plan/fit/analysis, tests and
license/Rust notices are included. Native binaries, GPL SID oracle, ROM/music/PCM
are excluded; the larger historical resonance training report remains SHA-only.
The 17-step CI covers cutoff math, offline fit recomputation, policy and candidate
holdout with both flags. Local checks and runtime33/68/75 plus old SID/PSID/RSID
receipts pass; no GitHub Actions run, commit/push/tag or publication was performed.
Older reports and archives remain historical and unchanged.

Phase 17 adds a separate [8580 research lab](docs/sid8580-lab/index.html)
([design](docs/issues/sid8580_machine_design_01.md), [result](docs/issues/sid8580_machine_result_01.md)).
Under a docs server use /sid8580-lab/. Pristine C64 CPU/CIA/VIC devices run with
a marked generated copy of the old BSD host and the pinned MIT sidera endpoint.
The machine WASM directly imports seven SID WASM export functions; separate
linear memories and scalar ABI avoid per-cycle JavaScript closures or trace
replay. Native links a Rust static library. Actual SID reads drive the real CPU.
The model's external RC/integer sampler is followed by the retained 12Hz host
software DC blocker. Both research profile flags stay OFF by default. POT reads
fail explicitly; Core/API OSC3/ENV3 observations are cached actual CPU reads, not fabricated
live voice state. Snapshots are not exported because they would copy SID ownership.

[Native/WASM checks](docs/issues/sid8580_machine_verification_01.json) pass 39 base
cases (13 authored programs at 44.1/48/96k) and four independent-profile controls:
43 total, including 997-chunk parity, real CIA/VIC IRQ/NMI, RAM/branch/SID read
feedback, Stop/reload, failed-candidate preservation and shared-module isolation.
Parser six plus pending-init six tests pass. Main-thread candidates must finish
bounded long PSID initialization before adoption; late ROM errors, cancellation
and the native 2M-cycle deadline preserve the old machine. A fresh Worklet load
streams the original retained initialization PCM.

[A small local-file smoke](docs/issues/sid8580_machine_hvsc_smoke_01.json) runs three
declared PAL8580 PSID v2 files through the Node Core for two seconds/48kHz each:
all 96,000 frames are finite/nonzero and Stop is zero. Actual play counts are
199 for CIA and 100 each for two VBI files. No music/PCM is saved. This is not
real-file AudioContext/Worklet or listening acceptance, nor an HVSC-wide audit.

[Actual AudioWorklet browsers](docs/issues/sid8580_machine_browser_01.json) pass
13 checks per Chromium/WebKit, 26 total. They explicitly cover CIA song2 as well
as VBI/RSID, real CPU-read causality, profile forwarding, failed Worklet POT RPC,
pending loads, Stop and a held Start acknowledgement. Physical output is muted;
this is not listening acceptance. Coarse Date.now measurements at 44.1k/128 frames
show ordinary-render means around .19–.47ms, maxima 1–2ms against a 2.902ms quantum;
load preflight is separately 10–20ms. These finite windows do not guarantee hard
real-time deadlines, glitch-free startup or long-session/device stability.

[Independent source-kit proof](docs/issues/sid8580_machine_sourcekit_01.json) passes
99 inputs, all three outputs (two WASMs and Native) plus receipt byte-identical,
and five build/check commands including 12 unit tests and 43 machine cases. There
is no parent-source fallback or GPL reference dependency. Darwin Native linking
omits debug records with absolute archive paths; the SID/machine behavior is
unchanged and all Native/WASM cases were rerun. The final archive is
release/tetorica_sid8580_machine_20261107-machine.1_research.zip: 161 files/856,803 bytes,
SHA-256 c7b725a2fe7c212597188454dc4e4a03b7b35a4f2d257dd6c33a666d8a3f8d6f.
CRC and all-file equality pass. Readable app/source/generators/tests, two WASMs,
matching receipt, zlib/MIT/BSD licenses, Rust/Emscripten notices and three authored
demos are included. Native binaries, GPL SID oracle, user ROM/game music/PCM
and the optional repository-only HVSC smoke tool are excluded. The first failed
stage is preserved; no archive was produced from it. The 12-step CI adds the
separate research build, unit/machine checks, source closure and old receipt
checks. No GitHub Actions run, commit/push/tag or publication was performed.

Next manually compare user-owned real 8580 VBI/CIA/RSID tunes and subtunes, then
measure long/background/device-switch workloads. Keep low-FC residuals,
mode-specific gain/loading, read/audio pipeline and DAC/digi quality separate.
Production Player/Synth/SDK and their known-8580 rejection remain unchanged;
only the explicitly experimental lab accepts its PAL/8580 subset. Production
model selection/adoption remains a later decision.

An offline [SID reference CLI](docs/sid-reference.md) now executes a bounded
PSID v2 PAL/6581 single-SID/VBI subset using pinned libsidplayfp/libresidfp in a
separate GPL validation executable. It preserves PHI2 writes, original PCM/WAV,
clock/sampling/DC differences and source hashes. Original self-authored fixtures
provide expected CPU writes. A marked reference-only serial table-initialization
patch makes repeat PCM deterministic; the application core is unchanged.
Its public `parsePsid()` entry still requires explicit PAL and 6581 header
declarations. The browser's target-choice support does not relax this CLI
contract or alter the native helper's accepted input subset.
Use `npm run test:sid-reference`, `npm run check:sid-reference`, or
`npm run sid:reference -- --fixture melody-filter --seconds 2`.
ROM dumps, game data, instrument import and real-hardware fidelity are outside
this milestone. Browser playback uses the selected VBI or C64 backend described
above, with different driver scheduling from libsidplayfp. The Node CLI is repository tooling,
outside the published CLI/runtime entry-point closures. Native SDK / audio
integration remains subsequent work. The Playground creation
clock is fixed (PAL default, optional NTSC); only model '6581' is supported.
Filter mode 'off' disables filter outputs; dry playback requires routing:0.
The high-level API and types accept all eight output masks: off, lowpass,
bandpass, lowpass+bandpass, highpass, notch (LP+HP), bandpass+highpass and
lowpass+bandpass+highpass. Each selects outputs of the same shared hardware
filter, with common cutoff/resonance. The DSP and WASM are unchanged.
SID Mixer gain is explicit unmeasured unity, preserving every measured gain.
`scripts/mixer_calibration_sid_revision.mjs` authenticates exact reviewed SID
routing additions and reconstructs the pre-SID bytes for legacy calibration
freshness checks. It never changes measurement reports or permits arbitrary
future renderer/gain edits. Do not regenerate that receipt without reviewing
the complete change and rerunning the focused rejection tests.

`docs/synth-sid/` uses the unchanged core / SidSynth, fixed PAL 985248 Hz and
strict `tetorica-sid-voice` v1 presets. Normal allocation uses three physical
voices; Sync / Ring switches to one carrier (voice 1) and silent oscillator
source (voice 3), with software ratio and Pitch. Live edits preserve ownership;
topology / TEST changes, preset load and Stop clear held notes, tails and Pitch.
Hardware ADSR / rapid Gate quirks remain unmodified. The shared filter is
register based. Independent LP/BP/HP toggle buttons enable and combine its
outputs; changing them preserves held notes. Turning off the last output or
disabling the master filter toggle routes carriers dry as a Synth convenience.
Re-enabling restores the stored outputs, or starts with LP if mode is off.
Strict v1 presets retain all combined mode strings; legacy notch loads as LP+HP.
An imported modeoff normalizes enabled to false after boolean validation.
Copy JavaScript preserves the combined mode. Master is separate software gain 0..3.8. Audio creation is lazy and startup
cancel / fatal retry retire old engines. Preset JSON, code export, two Pitch
wheels, focus handling, passive post-Master visualization and readable source
distribution follow the other Synths. Use `npm run test:sid-synth`,
`npm run test:sid-synth:browser`, and `sh scripts/package_itch_sid_synth.sh dev`.
The independent ZIP includes original browser modules / CSS, matching native
sources, licenses, rebuild instructions and hash-checked source inputs.
The user selected the beige / brown SID icon on 2026-11-07:
`docs/tetorica_sid_synth.webp` (1254 square), with the original PNG and prompt
receipt beside the other Synth assets. Header, favicon / Apple touch icon and
both home pages use that selected image; the standalone ZIP keeps it local.
This document records design decisions and work status. Before resuming, check the latest user request, the actual source and the Git state. Verification results recorded for a particular date do not guarantee the behavior of the latest published release.

## Check these first

```sh
pwd
git status --short
git diff
git diff --cached
git log -8 --oneline
```

- Preserve the user's in-progress and staged changes. Inspect the initial diff and distinguish those changes from your own.
- Read any `AGENTS.md` that applies to the files you will work on.
- Distinguish the parent repository from separate local repositories. Changes and commits inside `w/` are not automatically included in a parent-repository commit.
- Distinguish local implementations, generated distribution artifacts, published npm packages and releases on GitHub / itch.io. Confirm publication through release records and the actual distribution artifacts.
- Historical work records in this document do not authorize publishing, pushing or implementing a new feature. Work on the current request.

## Project direction and the role of each README

Tetorica is a toolkit for learning, playing and embedding many retro sound chips: Yamaha FM, Sega PSG, Game Boy / NES APUs, SNES S-DSP, PlayStation SPU, Saturn SCSP and more. Its original YM2612 goals now guide the wider toolkit. Preserving old game music and sound technology in a form that people can investigate and reconstruct is also a priority.

Distribution requirement clarified by the user on 2026-11-05: preserve readable,
modifiable authored JavaScript and CSS in Web ZIPs and Tauri applications. Copy
the original module files, comments and identifiers; do not minify, obfuscate or
serve a bundled rewrite in their place. `scripts/copy_readable_modules.mjs` uses
esbuild only to discover dependencies and copies the original bytes. Keep the
compiler-generated WASM / loader artifacts unchanged with their corresponding
C/C++ sources and rebuild recipes. A source ZIP alone does not make a minified
runtime sufficiently easy to modify. See the [work record](docs/issues/todo_readable_synth_distributions_20261105.md).

Keep these entry points clear in user-facing documentation:

- **Try immediately:** the [browser Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html) lets users try supported chips and live coding without installation.
- **High-level npm APIs:** the [`tetorica-fm2612` package](https://www.npmjs.com/package/tetorica-fm2612) provides Synth helpers for musical notes, presets and chip-specific sound controls, plus audio transports and an embeddable live-code runtime. The package name remains unchanged despite its multi-chip scope. Use the [API catalog](packages/fm2612/README.md#api-entry-points) for the actual imports and signatures.
- **Low-level APIs and WASM:** the same package provides register / RAM / PCM APIs, TypeScript declarations and prebuilt WASM. The [runtime source guide](tetorica_src/runtime/README.md) identifies wrappers and the complete generated artifact catalog.
- **Native C/C++:** reusable cores and build recipes are provided through [`tetorica-soundchip-native`](https://github.com/kyorohiro/tetorica-soundchip-native) for native apps and plug-ins.

API and backend coverage varies by chip. PS1 SPU and SCSP use explicit npm subpath imports; their Playground chip names are not automatically valid arguments to the package-root factory. Keep the original four goals while making this broader scope visible near the top of both user READMEs.

Decisions made during the README reorganization on 2026-10-10:

- Keep the English and Japanese READMEs as introductions for users, with an overview of the deliverables, links to the apps and simple npm usage examples.
- The user requested that app first-use instructions and Playground live-coding examples stay out of the READMEs. Direct readers to the actual apps.
- The user also requested removing the “Help and bug reports” section from both user READMEs.
- Retain the npm package's YM2612 do–re–mi example. It is a browser example using the sound-chip API, not code to run inside the Playground.
- Preserve the four established project goals: understanding the YM2612, documenting it so anyone can understand it, documenting how to embed it in apps and games, and preserving the technology as cultural heritage. The user values this specific list of goals.
- Move chip-specific details, limitations, implementation notes and verification records to `Memo.md`. Keep licensing and credits in the READMEs as well.
- Remove download instructions and outdated fixed version numbers. Put artifact creation, verification and publication procedures in `README_RELEASE.md`.
- Use `README.ja.md` for the Japanese README and the user-specified filename `READMD.ai.md` for the AI handoff. Do not silently change the spelling `READMD`. Write this AI handoff in English.

## Documentation references

| What to investigate | Reference |
| --- | --- |
| User-facing overview | [README.md](README.md), [README.ja.md](README.ja.md) |
| Chip-specific playback, limitations and implementation notes | [Memo.md](Memo.md) (English and Japanese; also preserves the original SN76489 reference links) |
| Support status by feature | [docs/feature-status.md](docs/feature-status.md) |
| Analyzer support matrix | [docs/vgm_analyzer/support.html](docs/vgm_analyzer/support.html) |
| CLI / Node API and format-specific limitations | [CLI.md](CLI.md) |
| Artifact creation and release procedures | [README_RELEASE.md](README_RELEASE.md) |
| npm publication records and procedures | [READMD_RELEASE_FM2612.md](READMD_RELEASE_FM2612.md), [READMD_RELEASE_VGM.md](READMD_RELEASE_VGM.md) |
| Audio package APIs and module catalog | [packages/fm2612/README.md](packages/fm2612/README.md) |
| Tetorica DMG Synth, one-APU allocation and portable presets | [Synth guide](docs/synth-dmg/README.md), [implementation TODO](docs/issues/todo_gameboy_synth_01.md) |
| 2A03 Synth, keyboard allocation, wave / modulation editing and portable presets | [Synth guide](docs/synth-2a03/README.md), [implementation TODO](docs/issues/todo_nes_fds_synth_01.md) |
| HuC6280 Synth, wavetable / Noise / paired LFO, five-bit DDA PCM, software Envelope and VGM voice import | [Synth guide](docs/synth-huc6280/README.md), [implementation TODO](docs/issues/todo_huc6280_synth_01.md) |
| VGM package examples | [packages/vgm/README.md](packages/vgm/README.md) |
| Virtual-file and shell APIs | [packages/virtual-files/README.md](packages/virtual-files/README.md) |
| Design and feature-specific work records | [docs/issues/](docs/issues/) |
| Audio-output design | [docs/issues/tetorica-audio-output.md](docs/issues/tetorica-audio-output.md) |
| Virtual-file / shell design history | [docs/issues/tetorica-virtual-files.md](docs/issues/tetorica-virtual-files.md), [docs/issues/tetorica-virtual-files-01.md](docs/issues/tetorica-virtual-files-01.md) |

`docs/issues/` also contains plans written before implementation. Compare the source, tests, update dates and publication records instead of determining the current state from an old “not implemented” or “not published” statement alone.

## Repository layout

| Location | Role |
| --- | --- |
| `src/` | ymfm-derived C++ sound-chip cores and related code |
| `tetorica_src/` | Entry point for Tetorica's own implementations; see the [source guide](tetorica_src/README.md) |
| `tetorica_src/wasm/` | WASM bridges for JavaScript |
| `tetorica_src/native/` | Parent-project C/C++ implementations, including native audio effects |
| `third_party/` | Pinned third-party cores, original sources, licenses and porting records |
| `tetorica_src/runtime/` | Reusable JavaScript runtime, chip wrappers, Synth helpers and audio engines |
| `tetorica_src/runtime/generated/` | Canonical artifacts for all 33 SDK builds and Native FX; shared manifests, synchronization and checks maintain the published copies |
| `tetorica_src/node/` | Node audio-output, Worker and Synth adapters |
| `docs/js/` | Copies of the shared runtime deployed to the website |
| `docs/playground/` | Playground UI, Monaco, Cassette, virtual-file integration, imports and runnable examples |
| `docs/synth/` | Browser synthesizer |
| `docs/synth-dmg/` | Tetorica DMG Synth (`tetorica-dmg-synth`): one APU, source-specific round robin, Wave RAM drawing and portable presets / JavaScript export; verify with `npm run test:dmg-synth` and `npm run test:dmg-synth:browser`. Icon: `docs/tetorica_dmg_synth.webp`. The former `/synth-gameboy/` URL redirects here; hardware API names and the portable preset format remain compatible. |
| `docs/synth-2a03/` | Tetorica 2A03 Synth (`tetorica-2a03-synth`): one NTSC NES APU + FDS, Pulse two-voice round robin, mono Triangle / Noise / DMC / FDS, 64-point Wave RAM and 32-command modulation editing, VGM / VGZ voice and DMC sample library import, raw DPCM loading / export and JavaScript export. Save DPCM writes committed original bytes as headerless 2a03-sample.dmc, excluding generated padding, drawing drafts and Redo data; it preserves audio, history and pending file reads. Playback settings stay in preset JSON. Standalone FDS / DMC default to Software click guard, a 5ms output-only smoothstep bridge in click_guard.js / processor.js: successful attacks and mono retriggers connect last emitted stereo sample to incoming PCM, matching releases / stops connect to zero and mute the raw off-filter tail. After5ms held PCM is byte-identical to the raw engine. Commands / registers / Envelope / owner timing remain immediate; stale noteOff(false) and invalid commands never change the bridge. Pulse / Triangle / Noise bypass it. setClickGuard(bool) is a standalone processor command, read exposes outputClickGuard metadata; the checkbox preference is session-only, outside preset v7 and Copy JS, with Off for raw comparison. This softens key edges, not internal sample / loop discontinuities; low-frequency onset transients may remain. panel_layout.js manages native details disclosures without rebuilding controls or changing sound commands. VGM / Hardware now / Instrument files / Output options start closed; Source / Keyboard / monitor and editor subsections start open. Disclosure state stays in page across preset edits and source changes, outside preset data. The monitor pins compactly only on wide / tall windows when Keep visible on desktop is checked; narrow / short windows release it automatically. Closing Source cancels only uncommitted FDS / DMC strokes, with closed-ancestor / zero-size checks at pointer move / up; committed data, history, held-key owners and VGM library survive. Hidden Source / Hardware stops observation, hidden monitor pauses visualization; summary pointer toggles blur for performance keys and native keyboard navigation remains. Hardware now is a passive software display: hardware_state.js projects actual core volume / Length, Triangle Linear (not amplitude), and FDS raw Volume / Depth gains (Volume effective cap32; Depth uncapped for authored33..63). hardware_monitor.js renders meters independently of editor.update, so drafts and focus survive. state_observer.js samples only visible running audio with a started held note, about100ms after each completed read, at most one outstanding read even across engine replacements; idle, hidden, suspended, failed and disposed leases discard stale replies and stop timers. Polling bypasses performance commands, never starts audio or changes preset data, and skips DMC (its existing DAC preview remains). Unknown / idle values display a dash, and fast changes between samples are explicitly disclosed. Preset v7 embeds Pulse / Triangle / Noise gates and counters plus Noise and FDS Volume / Depth Envelopes. Strict v1..v6 inputs migrate with previous Pulse / Noise fixed-volume Hold defaults (lengthHalt=true,lengthIndex1) and existing Envelope Loop behavior; missing Triangle controls use Hold defaults (control=true,linearReload127,lengthIndex1), missing Envelope controls stay off. Pulse / Noise store lengthHalt for fixed-volume mode and lengthIndex0..31; with Envelope enabled, envelope.loop selects the shared hardware Loop / Length-halt bit. UI gate choices show this bit and are disabled in Envelope mode, remembering the fixed-mode choice. Gate edits wait for the next attack, and live sound edits preserve the active bit. Copy JavaScript writes the authored Length index after frequency / helper defaults and before the final attack; index0 is valid. v4 extracts its volume-clock fields without changing values. Triangle stores control / linearReload0..127 / lengthIndex0..31, with a shared frozen LENGTH_TABLE (TRIANGLE_LENGTHS alias). Authored gate settings wait for the next note, expired counters keep held-key ownership, and Pitch retains active Length bits including index0; a timer-high boundary write reloads counters. VGM retains Triangle control / reload / Length settings while grouping pitch-only changes, and discloses the restarted elapsed-state / frame phase. fds_depth_controls.js provides an explicit slow-vibrato comparison setup: keep authored waveform / Volume controls / chosen direction / other sources, set modulation enabled with the Vibrato table, Rate8, Bias0, Depth Envelope on with Initial16 / Period31, and shared clock232 / unpaused. The button loads this setup and stops held notes; it does not rewrite Initial depth when direction is changed. Next-note hints explain endpoint / elapsed estimate / clock hold, not live gain. Increase means modulation amount rather than upward pitch: default Rate256 is fast FM, while Rate8 makes a clear vibrato comparison. Disabled / paused / no-change endpoints are visible, and retained counter / Bias can affect pitch even with table advance stopped. Preset v7 and core / WASM are unchanged. FDS Volume and Depth each store enabled / increase / period0..63 / initialGain0..63. Shared fds.envelopeClock stores masterSpeed0..255 / halt. Each new note restores fixed gains, seeds enabled envelopes after keyOn, sets the shared clock once and applies its halt line. Held Envelope / clock changes wait for the next note; Master / Pitch / Rate / Bias / modulation-enable edits preserve progress. VGM retains both known six-bit gains and clock settings; missing or progressed gains and missing master-speed defaults are disclosed, while modulation-table phase / counter remains a restarted audition. Pulse / Noise / FDS Envelope controls use the existing public register API; shared runtime / DSP / WASM are unchanged. Noise Envelope enable / period / loop edits apply on the next note; fixed volume and LFSR clock / mode remain live. VGM imports Noise Envelope settings without the former fixed-volume approximation. Copy JavaScript writes hardware Noise control after the existing noise.setVoice call and before noteOn. VGM DMC capture follows recorded CPU RAM (`0xc2`, raw bank `0x07` + RAM copy `0x68`) and real reader restart requests, snapshots owned bytes including address wrap, and discloses static DAC-level / live-change approximations. Missing RAM is never replaced with demo / zero bytes; compressed banks and NES DAC streams are not reconstructed. DMC uses 1..4081 bytes, padded to 16*n+1, one fixed-rate keyboard trigger, live Rate / Loop and next-trigger Initial level; Pitch is disabled. Explicit Synth release clears its DAC. Hardware output-unit byte continuation is retained; a completed one-shot keeps held-key ownership. Song / automation replay and audio-to-DPCM encoding remain follow-ups. Icon: `docs/tetorica_2a03_synth.webp`. The former `/synth-nes/` URL redirects here; NES APIs remain compatible. Verify with `npm run test:2a03-synth`, `npm run test:2a03-synth:browser`; package with `sh scripts/package_itch_2a03_synth.sh VERSION`. |
| `docs/synth-2a03/dmc_editor.js` | Passive DPCM editor: four-byte bit windows, exact DAC stairs / whole-data overview and manual target drawing. The session-only dmcAutoFit checkbox defaults Off; On uses dmc_fit.js to fit cursor height with nearby bits, including outside the Selected bytes page. Auto-fit pointer moves are coalesced per animation frame, with a synchronous final fit on release and cancellation of queued work when drafts are discarded. Cursor target / actual / error and neighbouring changes are reported. Switching the checkbox edits no committed data; checkbox focus retains editor Undo. The full fitted patch is one history step. Green is the requested after-bit DAC curve; blue is decoded DMC. Strokes preview locally and commit on release; source / sample / parameter / view changes, Escape, lost capture and resize discard drafts. Undo / Redo retains byte snapshots only (up to 64 edits, 256 KiB total bytes), one changed bit or committed stroke per step; cancelled / no-op edits add no step. Current Rate / Loop / Initial level and ordinary source changes keep history; successful file / Demo / VGM / preset loads and Reset clear it even for identical bytes. Shortcuts are scoped to editor focus; pointer edits blur for performance. Generated padding stays read-only; length and preset schema are unchanged. Uses existing DMC sound / VGM / preset paths. No audio-file PCM encoder or audio device. |
| `docs/synth-2a03/dmc_draw.js` | Pure manual DAC-target editing helper: nearest legal ±2 / boundary-hold step in LSB-first order, ties preserve the original bit, untouched bits and source length are retained. Bounded to the original 4081-byte sample, no padding edits, and tests compare drawn bytes with actual WASM. |
| `docs/synth-snes/` | Tetorica S-DSP Synth (`tetorica-sdsp-synth`), eight physical SNES voices through existing SnesDspCore / SnesSynth. Native 32kHz rendering with shared SpcResampler at device rate. Wave / BRR uses one canvas to draw a 128-frame cycle or preview raw BRR; Noise hides sample authoring and tuning controls and leaves the output monitor on actual DSP audio. Offline audio preparation mixes, resamples, clamps final mono only and encodes BRR in a cancellable readable module Worker; raw BRR has no root/rate/loop-address metadata. Preset v5 stores pmon:{enabled,source,ratio,wave,brr,envelope}, with source wave or brr and separate bounded BRR name/data/rootNote/basePitch/loopStartSamples metadata. Carrier source remains Wave / BRR / Noise with noise:{clock:0..31}, its own tuning and Echo settings. Strict v1..v4 inputs migrate: v4 preserves authored Wave PMON; v1..v3 add PMON off without changing source; v1 adds Echo off and v1 / v2 add Noise clock31. PMON defaults off, source wave, ratio1, Sine wave128, empty BRR draft and independent Direct GAIN64. Hardware ADSR/GAIN codes, signed voice volumes, safe initial 8-voice headroom, Master0–380%, two Pitch wheels, Octave and shared keyboard. Repeated sample edits rebuild one RAM bank; generation changes reset the resampler. Accepted carrier and modulator BRR payloads are elided on ordinary edits/replies and merged from acknowledged host caches. SPC snapshot import passively lists eight voice candidates via existing parseSpcFile / readSnesVoices / extractBrrSamples. Explicit selection loads validated BRR / resolved loop or captured hardware Noise, plus signed LR and exact envelope registers. Captured BRR PITCH is declared at C4, never inferred as the original note; Noise rows use CH# · Noise and show clock rather than musical tuning. Same-SRCN voice variants remain separate. For BRR voices, zero PITCH, unresolved loops and incomplete/over-budget samples are disabled with reasons. Noise imports accept PITCH0 and invalid SRCN / BRR because these sample values do not define its output; candidate.sample is null, source is noise, and batch.noiseClock comes from FLG &31. Captured Noise LFSR state is not restored. Base-mode omitted PMON and dry-mode Echo are explained. The initial-Off #spcIncludePmon checkbox, labeled Import PMON pairs, switches only recorded PMON non-Noise carrier rows to separately validated pair / pair+Echo variants; ordinary BRR and Noise rows keep ordinary variants. No SPC700 driver or song playback is started. Cancel/bad/stale reads preserve current sound and list; commit closes cancellation until ACK. Saved presets embed both selected sample assets without requiring the original SPC or audio files. Manual real-hardware Echo/FIR controls are available: shared eight-voice Echo Enable, Delay 0..15 (1..15 mean 16 ms steps to 240 ms; 0 means the four-byte/one-stereo-frame ring), signed Feedback and left/right Return, Send and eight signed FIR coefficients. FIR shapes Echo and its feedback only, leaving the dry voice unchanged. App Echo On/Off, sample/loop changes and Stop rebuild one bank and clear held voices/tails; other Echo parameters apply live. Stop retains the settings. Echo-enabled sample capacity is 33,786 BRR bytes / 60,064 frames versus dry 64,512 / 114,688, with no trimming. Shared SnesSynth.setEcho/getEcho and async Main/Worker/Native client methods reserve RAM before upload; first enable relocates directory to 0x7800 and BRR to 0x7c00, reserving the bottom 30 KiB for every EDL. Shared API Off keeps the reservation until a fresh Synth; the standalone app rebuilds on toggles. Copy JavaScript awaits setEcho before loadBRR. SPC candidates default to voice-only / Echo off. The passive Import Echo / FIR settings option prepares a second validated variant with captured EDL low bits, signed EFB/EVOL/FIR and selected-voice EON mapped to the app send switch. FLG Echo-write-disable imports Echo off while retaining parameters; captured/frozen RAM, past tails and original master mix are not restored. Import-mode changes alone preserve the instrument; selection markers include the mode. Echo budget overflow disables only that variant and never falls back silently. Hardware Noise uses NON with one shared generator / clock0..31 across all eight independently enveloped voices. Clock0 holds the current generator value, potentially DC, rather than muting. Nonzero codes change texture live while preserving held owners and generator phase; keys gate ADSR / GAIN and signed volumes, while musical Pitch / Octave are disabled. Noise still uses shared Echo / FIR. Source changes restore the matching routing; returning to Wave / BRR clears NON. Copy JavaScript uses existing raw writeDsp for NON / FLG while retaining Echo flag bits; no shared runtime, WASM or npm update is required. Manual hardware PMON is available for Wave / BRR. The previous voice’s envelope-scaled output modulates the next voice’s sample PITCH; fixed pairs0→1 / 2→3 / 4→5 / 6→7 use PMON0xaa and four-note round robin. Modulator L/R0 keeps it inaudible and Echo send covers carrier bits only. Ratio0.125..8 multiplies keyboard-note Hz including Pitch for a Wave modulator, or its own declared Root/base PITCH playback speed after keyboard transposition for a BRR modulator; no original BRR fundamental is inferred. Explicit modulator PITCH clamps1..16383. Both BRR references can be tuned independently. Ratio and independent modulator ADSR / GAIN change live while retaining owners and DSP phase; Pitch moves both voices. PMON toggles, active modulator-source/data/wave/loop changes rebuild the bank and clear held notes/tails. Root/base PITCH, Ratio and independent envelope edits apply live without resetting owners or phase. Noise pauses authored PMON without clearing settings and keeps eight voice envelopes. The existing single canvas switches Carrier / Modulator targets. Either BRR target is a read-only decoded preview with separate tuning/loop controls; either Wave target uses128-point drawing and shape buttons. Load audio / Load BRR replace the selected target, with that target named in buttons and conversion hints. Target changes alone send no sound command and cancel pending strokes/conversions. Empty BRR modulators remain valid drafts with null modulatorSample, but noteOn and Code export reject them until loaded. Active sample uploads share one combined64512-byte dry /33786-byte Echo budget. Each Wave uses72 encoded BRR bytes; each BRR uses its full data length. Wave modulators therefore retain carrier limits64440 dry /33714 Echo, while BRR reservations vary. Carrier and modulator count separately even for identical bytes/SRCN; no deduplication. Inactive drafts and paused PMON do not consume active RAM, but each BRR asset remains independently validated. Over-capacity edits fail before DSP mutation and preserve the current instrument. presetBankKey, pmonSampleBytes and sampleBudget share layout / budget decisions between core and UI. Generated JavaScript uses existing setEcho / loadBRR / writeDsp / keyOn APIs with one silent-modulator pair; shared runtime / WASM / npm are unchanged. SPC PMON pair import supports isolated adjacent BRR pairs only. Both Root references are C4, base PITCH preserves each captured value, and Ratio1 reproduces both PITCH values at C4; envelopes are independent. Captured modulator signed L/R remains inspection metadata, while audition forces modulator L/R0 and excludes its Echo send; carrier only feeds dry/Echo. Noise modulators, incoming/outgoing PMON chains, zero BRR PITCH, bad samples/loops and combined budget overflow leave pair variants unavailable with reasons. Pair mode never silently falls back; turning it off exposes the base voice again. Echo/PMON options are passive until selection and locked through commit ACK; selection identity includes both options. Elapsed envelope/ENVX, decoder phase/history, original master mix, SPC700 updates and song playback are not restored. [Guide](docs/synth-snes/README.md), [TODO](docs/issues/todo_snes_synth_01.md). `npm run test:snes-synth`, `test:snes-synth:browser`, `pack:snes-synth`. Distribution retains original readable modules, WASM and complete matching LGPL core sources/rebuild recipe. |
| `docs/synth-huc6280/` | Tetorica HuC6280 Synth (`tetorica-huc6280-synth`): one PC Engine PSG, six Wave or DDA voices, two Noise voices, paired CH1+CH2 LFO, one Main / LFO canvas, software ADSR and two Pitch wheels. VGM imports Wave / Noise / LFO pairs with independent periods, rate / depth / reset and CH2 output, plus complete supported DAC-stream PCM with recorded sample rate and Loop, and uniform explicitly bounded direct-DAC PCM. Recorded C4 reproduces the carrier period; other keys transpose CH1 only. Preset v3 embeds mono five-bit DDA PCM as bounded base64 with rate / rootNote / loop / speed; v1/v2 migrate compatibly. dda_pcm.js / audio_import.js prepare audio using offline decoding, area-average downsampling, mono mixing and DAC0..31 quantization with center16. DDA feeding / pitch / Loop / envelope are host software, one sample-and-hold update per output frame; high rates skip source values. Compensated cursor addition with bounded integer-edge correction avoids one-frame-late DAC updates at rational rates and remains render-chunk invariant. One-shot ends mute DAC16/keyOff while preserving held-key ownership. Live rate/speed/Pitch/Loop keep cursor; ended Loop-on waits for a new trigger. Audio/processor elide accepted PCM on metadata edits and omit it from replies, merging locally; concurrent preset mutations send full data, failures never replace cache. UI cancellation ends synchronously at onCommit before applyPreset begins. Copy DDA preset JS exports data and synchronous Instrument usage, not a fake single-register audition. VGM library offers a default-off keep-loudest Wave / PCM volume-variant view; vgm_pcm_variants.js exports mergeVgmVolumeVariants for Wave and PCM, comparing canonical presets excluding volume and descriptive names only, keeping the largest channel volume, merging uses/origins/warnings, and preserving raw voices. Noise and LFO remain separate; the legacy mergePcmVolumeVariants export retains PCM-only behavior. Toggling the cached view never sends audio commands and clears hidden selections without loading their louder representative. VGM PCM extraction uses bounded passes over complete uncompressed DAC stream data and direct register-6 writes. Direct regions require an observed DDA activation with an initial same-time DAC write, at least three positive-duration values, uniform spacing and an explicit gate-off / DDA-disable one period after the last value. Irregular / unbounded / interfering regions are omitted. Identical direct and stream PCM merges occurrences and origin metadata, retaining the earliest channel / time. Loop / musical root are not inferred for direct PCM. Compressed banks, unsupported streams, CD-ROM², elapsed phases and song automation remain unsupported. Live DDA rates accept finite numeric 1–192000 Hz, including exact fractional 44100 / tick spacing; audio conversion stays 8000–44100 Hz. Source-copy ZIPs retain JS / CSS and matching WASM / C++ / licenses. Shared runtime / WASM are unchanged. Checks: `npm run test:huc6280-synth` and `npm run test:huc6280-synth:browser`. |
| `docs/synth-2a03/dmc_fit.js` | Pure optional height fitter for existing DPCM: exact 64-state dynamic programming obeys LSB-first ±2 / boundary holds and initial DAC parity. The inclusive edit window is minTarget−62 through maxTarget+63, clipped to original bytes. Lexicographic objectives: squared cursor error outside a ±2 DAC tolerance, squared window-end error outside the same tolerance, full piecewise-linear reference SSE, exact window-end error, then changed-bit count. The reference connects the original pre-window DAC, latest supplied target heights, and original window-end DAC (without overwriting a supplied final target). The one-step cursor and end tolerances prevent parity-fixing trips to 0 or 126/127; nearby levels may differ by one DAC step rather than forcing an exact rejoin. Do not restore exact cursor / end priority: that caused boundary spikes even for a center-height click. Metadata reports actual cursor error and exact rejoined status. Prefix and suffix bits outside the window stay unchanged; suffix waveform is preserved only when the reported rejoined flag is true. Dense targets / storage are bounded to 32,648 bits (4081 bytes); full trace uses about 2.09 MB. No padding / initial-level / Rate / Loop / length changes or PCM audio import. Unit oracle and actual 44.1 / 48 kHz WASM tests cover legality. |
| `docs/synth-2a03/dmc_decode.js` | Pure seven-bit DAC preview before mixer / filters / Master: LSB-first ±2 with boundary holds and unchanged parity, hardware-length `0xaa` padding, rate-based time axis and Loop continuation. Its tests compare every decoded bit with actual WASM at 44.1 / 48 kHz. |
| `docs/vgm_analyzer/` | Analyzer UI and shared analysis / export modules also used by the CLI |
| `docs/generated/` | Published chip JS / WASM and metadata synchronized from the canonical artifacts |
| `tetorica_src/cli/` | `tetorica-vgm` CLI / Node API implementation |
| `packages/fm2612/`, `packages/vgm/` | npm distribution metadata and READMEs; these directories do not contain the entire implementation |
| `packages/virtual-files/src/` | `tetorica-virtual-files` implementation: virtual files and a lightweight shell |
| `examples/` | ymfm-derived `buildall/` and `vgmrender/`; the upstream layout is preserved at the user's request |
| `tetorica_examples/` | Tetorica's own `nodejs/`, `browser/` and `cpp/` examples; sound-generation experiments are also consolidated under `nodejs/sound-color/` |
| `docs/tutorials/` | Canonical Markdown for YM2612 lessons and published C++ copies; the editable C++ sources are in `tetorica_examples/cpp/tutorials/` |
| `scripts/` | Builds, synchronization, packaging and verification |
| `test/`, `test/runtime/`, `docs/*/*.test.mjs` | Feature, shared-engine and UI tests; the 277 tests formerly directly under web have been moved to `test/runtime/` |
| `dist/`, `release/` | npm build outputs, staged browser / itch artifacts and ZIPs |

The root `package.json` is a development workspace with `private: true`. Do not publish the root as an npm package.

See the [layout plan and TODO](docs/issues/todo_repository_organization_01.md) for the top-level directory reorganization. The ymfm-derived `src/` and `examples/` retain their upstream layout. Tetorica's implementations are under `tetorica_src/`, its examples under `tetorica_examples/`, and shared tests under `test/runtime/`. Synchronization and distribution scripts preserve the published website and npm layouts. Check Git and the actual files when locating implementations. Verify generated artifacts with `npm run check:runtime-artifacts` and the published C++ lesson copies with `npm run check:tutorials`.

`npm test` runs both the root tests and `test/runtime/`. Use `npm run test:runtime` for only the shared runtime and `npm run test:runtime:types` for SCSP source type checking. `tetorica_src/runtime/spc_test_fixture.mjs` and `tetorica_src/runtime/native_genesis_extra_creation_fixture.mjs` remain beside the implementation because shared checks and calibration use them as inputs.

### When changing the shared runtime

1. Edit the core implementation and JSDoc in `tetorica_src/runtime/`. Edit UI-specific code in directories such as `docs/playground/` and `docs/vgm_analyzer/`.
2. Synchronize shared JavaScript to the website.

```sh
sh scripts/sync_web_js_to_docs.sh
```

3. If distribution contents change, also generate and verify the affected packages. An existing `release/itch_playground_dev` is not updated automatically.
4. When adding a module dependency, check whether synchronization inputs, distribution scripts, module catalogs and Monaco reference models also need updates.

Synchronization adapts relative WASM paths and other references to the destination layout. Do not remove required path transformations while trying to make `tetorica_src/runtime/` and `docs/js/` manually identical.

### Languages of the published home pages

`docs/index.html` is English and `docs/index-ja.html` is Japanese. They are static pages with the same design and tool links, a language switch and an AI/SI link. Match each page's `lang`, title, description, Open Graph metadata, visible text and aria-labels to its language.

Reflect new tools, introduction pages and link changes in both home pages.

The YM2612 introduction is also split into `docs/introductions/index.html` (English) and `docs/introductions/index-ja.html` (Japanese). Each home page links to the introduction in its own language. The Japanese version translates the body, buttons and algorithm-audition status messages while preserving embedded code and demo behavior.

Other introductions (Sega PSG, Mega CD, Game Boy, tuning, the register introduction, all 15 FX chapters and their contents page) and `docs/for-ai.html` use the original URLs for English and `*_ja.html` for Japanese. Articles formerly available only in Japanese retain their content in the Japanese versions, with English versions added. Do not rename the existing `index-ja.html` pages. Match language switches, alternate links, previous / next chapters and links from the English and Japanese home pages to the respective language. The Game Boy dynamic UI and generated code comments use `docs/introductions/introduction-locale.js` to follow the page's `lang`. Embedded Playground, Synth and Analyzer apps are outside this translation scope.

## Open the browser version locally

```sh
npm ci
python3 -m http.server 8083 -d docs
```

Run the server in a separate terminal, then open:

- `http://localhost:8083/playground/index.html`
- `http://localhost:8083/synth/index.html`
- `http://localhost:8083/vgm_analyzer/index.html`

Start browser sound examples from a user gesture such as a click. README samples with bare npm imports need a resolver such as Vite. Distinguish Playground user code from general web-app code that imports npm modules.

## Verification commands

Choose tests relevant to the change and run the necessary scope. The following list helps locate checks; it is not an instruction to run everything on every change.

```sh
git diff --check
npm test
npm run test:analyzer
npm run test:sbi
npm run test:virtual-files
```

Audio package and type declarations:

```sh
npm run build:fm2612
node scripts/check_fm2612_types.mjs dist/fm2612
npm run test:fm2612
npm run test:fm2612:browser
```

- `build:fm2612` generates `dist/fm2612/`, creates declarations from JSDoc and checks their types.
- `check_fm2612_types.mjs dist/fm2612` checks the generated distribution with NodeNext, Bundler and Browser consumers without Node ambient types. Without an argument, it also performs the build.
- `test:fm2612` installs the tarball into an independent consumer and checks it there. Successful imports inside the repository alone do not establish that the npm distribution works.
- `test:fm2612:browser` uses a real browser. Run `npm run setup:browser` if Playwright Chromium is needed.

VGM and virtual-file builds:

```sh
npm run build:vgm
npm run build:virtual-files
```

For chip-core changes, check the corresponding `scripts/build_*_wasm.sh` and chip-specific tests. Read each script for prerequisites such as Emscripten. JSDoc-only or README-only changes do not require rebuilding WASM.

## Audio API assumptions

- Direct Transport generates PCM synchronously. Generating PCM alone does not play it through speakers. Offline WAV generation does not require waiting for the song's real-time duration.
- With Worklet Transport, an AudioWorklet generates audio. JavaScript helpers such as `sleep` and `beat` wait for performance progress or continuation; they do not provide sample-accurate scheduling by themselves.
- Audify provides native Node audio output. It is a separate output path from browser Web Audio, with different package and runtime requirements.
- `transport.flush()` is a queue-processing check / barrier. It is not meant to be called after every register write, nor is it required to start a song.
- Passing an `AbortSignal` somewhere does not automatically interrupt every `await`. Each operation must observe the signal and handle stopping or exceptions where needed.
- YM2612 `block` / `fnum` represent chip pitch. Use the `pitch.js` helper `hzToBlockFnum` for Hz, or `createPitchFromMidi` for MIDI note numbers. The chip input clock in Hz and the audio sample rate are separate values.
- Inclusion of a WASM wrapper, playback-engine support, Worklet execution, high-level Synth APIs, and VGM transcription / voice extraction each have their own coverage. A supported-chip list does not imply identical support across all APIs.
- The initial Game Boy mixer balance is 28%; other chips start at 100%. Distinguish mixer balance, output gain and Master. Clipping caused by high output is not automatically an emulator defect.
- When omitted, `createSoundChip` assigns `chip.id` automatically. IDs are reserved before initialization; this is not probabilistic UUID collision avoidance. Consult the shared implementation for ID and mixer ownership / release behavior.

## Information moved out of the user READMEs

### Editing TFI instruments extracted from VGM

These steps are retained for development and verification. They do not need to be restored automatically to the user READMEs.

1. Import a supported VGM / VGZ in the Playground.
2. Open `presets/<filename>/` in the virtual files and edit a `.tfi`.
3. Change FM parameters, move focus out of the input field, and audition with number / letter keys.
4. Use Export Cassette to save the project, including its virtual files.

OPN FM voices captured at key-on are saved to paths such as `/presets/song/ym2612_ch1_001.tfi`. Duplicate voices within the same channel are merged. Reimporting a file with the same name uses a new directory such as `song-2`. TFI stores static FM parameters; it does not store pan, LFO or changes in pitch / volume over time. Editing updates virtual files and does not write back to the original files on disk.

### Distribution and implementation details

- The complete web runtime archives are `web_runtime` / `web_runtime_exsample`. Their generation commands and verification have moved to `README_RELEASE.md`.
- Chip-specific limitations and verification records for Note-ish, MIDI, SBI, OPM, MSX, NES / FDS, ADPCM and related features have moved to `Memo.md`.
- The old paragraph stating “local 0.2.0, published npm 0.1.0” was removed because those fixed values were outdated. Do not restore it. Check each package's `package.json` and publication records for current versions.
- `READMD_RELEASE.md` remains as a pointer to `README_RELEASE.md`. Do not casually delete it and break existing links.

## Separate repository: Tauri desktop version

This development environment has a separate checkout at `w/tetorica-fm2612-playground-tauri/`. It may not exist in other environments, so first check its location and README.

- The Tauri app imports the parent repository's Playground distribution ZIP and tracks the extracted `dist/` in Git.
- `release.lock.json` records the integrity of the ZIP and extracted contents. Manually changing only `dist/` makes `import_release.py --check` fail.
- To incorporate parent-runtime changes, regenerate the distribution ZIP and update it through the Tauri import procedure. Do not disable the lock check as a workaround.
- Cassette autosave uses IndexedDB in Tauri's WebView. It saves code, assets, the file being edited and the file selected to run, then restores them on the next launch. Its scope differs from the regular browser version.
- Chips and effects run through Web Audio. Final PCM is sent to Node/Audify only when that output is selected. Startup uses WebView output.

Commands to run from the Tauri repository directory:

```sh
npm test
python3 scripts/import_release.py --check
node scripts/prepare_audio_sidecar.mjs
node scripts/check_audio_sidecar_bundle.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

On Windows, replace `python3` with `python`. Audio resources must also be prepared before running Cargo directly; do not rely solely on the Tauri CLI's beforeBuildCommand.

### Windows Audify fixes through v0.52.6

- Select WASAPI explicitly to avoid automatic ASIO discovery.
- Patch RtAudio inside Audify 1.10.1 to release WASAPI device objects before COM shutdown, then rebuild the Windows module.
- In Node 22, passing a `\\?\C:\...` path into main-module resolution caused termination with `EISDIR ... lstat 'C:'`. A relative script path alone does not resolve this. Convert both the executable path and working directory to normal Windows path syntax.
- Native-side conversion is in `src-tauri/src/audio.rs`; CI-side conversion is in `scripts/node_resource_path.mjs`. Account for drive / UNC paths, spaces and Japanese paths.
- Verify device enumeration, garbage collection, normal Node shutdown, and server startup / JSON responses from an isolated bundled directory.
- Stopping an unused output must not start a new Node process. Show complete failure details in the menu and Console.
- Keep Audify selected after an error and allow copying the error with “Copy error.” Retain the error until “Clear error” is used. Switch the actual audio connection back to WebView.

**Hardware verification as of 2026-10-10: the user confirmed operation on macOS and Windows. Linux was unchecked because no physical test machine was available. The user explicitly chose to release with Linux marked unchecked. CI success and confirmed audio playback on real hardware are separate results.**

## Separate repository: npm usage examples

`w/tetorica-fm2612-examples/` in this environment is a separate checkout of [tetorica-fm2612-examples](https://github.com/kyorohiro/tetorica-fm2612-examples). It contains Web / Node examples that consume the actual npm package.

Working audio-package changes in the parent repository do not automatically update the published npm package or the examples. After publication, update dependencies, lockfiles and deployed build outputs, then verify running, stopping and disposing the examples.

## Historical work status and verification records

Local settings as of 2026-10-10 (not a comparison against published releases):

| Target | Configured version |
| --- | --- |
| `packages/fm2612/package.json` | `0.2.12` |
| `packages/vgm/package.json` | `0.2.8` |
| `packages/virtual-files/package.json` | `0.1.1` |
| Local Tauri checkout | `0.52.6` |
| `tetorica-fm2612` dependency used by the examples | `0.2.12` |

Changes and checks recorded in that work period:

- Added or expanded public-function JSDoc in 40 files under `tetorica_src/runtime/` and synchronized it to `docs/js/`. Documented `createPlaygroundClock` options, return values, seconds / beats / samples and stop behavior. Executable code was unchanged.
- Generated and type-checked 192 declaration files with `build:fm2612`. NodeNext / Bundler / Browser consumer checks against the distribution also passed.
- Passed 37 related tests for clocks, asynchronous tasks, OPN, S98 and native FX. This records the scope run during that work, not the latest result for the entire test suite.
- Checked the README's do–re–mi example in a browser: actual WASM / AudioWorklet initialization, C4 / D4 / E4 note calls and AudioContext disposal after playback. This was not a listening evaluation.
- README reorganization and moving information to `Memo.md` / `README_RELEASE.md` were documentation changes. Link targets, code fences and diff whitespace were checked.
- The README changes included the user's edits and staged changes. On resuming, inspect Git state; do not discard changes in bulk or commit / publish without authorization.

Temporary browser-check scripts under locations such as `/private/tmp` are not guaranteed to exist in another environment or session. For repeatable verification, use the repository's check scripts, relevant tests and the actual README code.

## Updating this handoff

Record changed features, checked targets, verification commands run, unchecked scope, publication status and remaining work separately. Date version numbers and test counts. Put feature details in `Memo.md` or `docs/issues/`, user-facing explanations in the English and Japanese READMEs, and publication procedures in `README_RELEASE.md`. Avoid duplicating the same long explanation across several documents.
