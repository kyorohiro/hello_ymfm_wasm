# SID reference playback and cycle-trace comparison

This repository-only CLI executes a small PSID in an external C64 player,
records timed SID bus writes and replays them through Tetorica's unchanged
6581 core. It writes WAV files and diagnostic JSON; it opens no audio device.
The [SID Synth](synth-sid/index.html) and [C64 Playground](sid.md) remain separate
browser instruments. To choose and play a supported file without a command,
open the separate [SID Player](sid-player/index.html) ([scope and guide](sid-player/README.md)).
That bounded CPU host uses the Tetorica SID approximation; the external GPL
reference engine described here is not included in the browser. Instrument extraction is later work.

## Run an original diagnostic tune

From the repository root, with Node 22+, a C++17 compiler, GNU make,
`pkg-config`, Python 3, `curl` and `tar` available:

```sh
npm ci
npm run test:sid-reference
npm run sid:reference -- --fixture melody-filter --seconds 2
```

The first comparison downloads SHA-256-pinned official source archives and
builds the external tool under `build/sid-reference/`. It installs nothing
system-wide. The original archives, extracted build sources, licenses and
build manifest remain there. Subsequent runs verify the cached binary and build
inputs. After the first successful preparation, use `--offline`:

```sh
npm run sid:reference -- --fixture tone --seconds 2 --offline
npm run sid:reference -- ./my-tune.sid --subtune 1 --seconds 10 --offline
npm run check:sid-reference -- --offline
```

Other original fixtures are `pulse` and `noise`. These files contain only
self-authored 6502 code and data; no game music or Commodore ROM dump is included.
The [fixture source](../test/fixtures/sid-reference/fixture.mjs) supplies expected
init/play writes, checked against actual C64 program execution.

The CLI prints a unique `release/sid-reference/comparison-…/` directory. Runs
keep previous results and never overwrite the supplied tune. Its useful files are:

| File | Contents |
| --- | --- |
| `input.psid` | Exact input bytes |
| `capture.json` | External player metadata, timed writes and SID reads |
| `trace.json` | Validated, compact, versioned write trace |
| `reference.wav` | reSIDfp output, normalized from its signed 16-bit samples by 32768 |
| `tetorica.wav` | Tetorica output including its existing software 12 Hz DC blocker |
| `tetoricaRaw.wav` | Tetorica chip output before that software DC blocker |
| `*.f32le` | Original float PCM streams, without WAV headers |
| `comparison.json` | Input/build hashes, timing, states, level/band measurements and diagnostic differences |

WAV uses mono IEEE float32 with a `fact` chunk. Samples are neither normalized
nor clipped for export. For listening, start with a low player volume because
the engines' output gain and DC behavior differ.

## Supported first subset

The execution CLI accepts **PSID v2, one SID at `$D400`, explicitly PAL and
6581, VBI speed, no relocation request**, with payload in `$0800..$CFFF` and
explicit init/play subroutines inside the payload. A header init address of
zero means the effective load address. Header or embedded load-address layouts
are supported. Select a one-based subtune with `--subtune`.

The metadata parser also recognizes bounded v3/v4 headers, but the initial
execution CLI rejects those versions. It also rejects RSID, IRQ-style play
address zero, CIA-speed files, MUS/PlaySID extensions, NTSC/unknown/both clocks,
8580/unknown/both models and extra SID chips. These are explicit tool limits,
not claims that such files are malformed.

Input is bounded to 65,660 bytes. Duration is 0.25–60 seconds and output rate
is 8,000–96,000 Hz. The external player uses its upstream KERNAL stub, with
no supplied BASIC/KERNAL/character ROM dumps. The self-authored routines make no
ROM calls. Header validation cannot establish that an arbitrary game driver is
ROM independent or plays faithfully; real-game and RSID coverage need separate
testing and engine/ROM integration.

## Trace timing and comparison limits

`tetorica-sid-trace`, version 1, preserves every engine-decoded SID register
write, including repeated bytes and writes to read-only/reserved slots 25–31.
It does not reconstruct the original physical address of mirrored SID accesses.
The key timing fields are:

```js
{
  format: 'tetorica-sid-trace', version: 1,
  clockHz: 985248, model: '6581', sampleRate: 48000,
  cyclePhase: 'phi2', writeTiming: 'tick-then-commit',
  durationCycles: 985248,
  input: {sha256: '…64 hex digits…', subtune: 1},
  engine: {/* pinned engine, clocks, initialization, sampling and read metadata */},
  writes: [{cycle: 168000, register: 0, value: 0}]
}
```

`cycle = t` means **t ticks have completed before this bus cycle**. A write
consumes one tick and commits its byte at the end. Audio generated during that
tick uses the previous byte. Cycle zero is valid, cycles are strictly increasing,
and `durationCycles` is exclusive. The Tetorica renderer collects samples from
every tick, including write ticks: exactly
`floor(durationCycles * sampleRate / clockHz)` frames. Flush-buffer size never
changes oscillator, envelope, filter or DC state.

Both hosts start with zero registers/volume. The upstream player's requested
reset volume is recorded separately; the adapter sets volume zero without
inventing a CPU write or advancing time. Driver warm-up and all subsequent
real CPU writes retain their original cycle positions.

The player schedules PAL C64 cycles at about 985248.611111 Hz and passes the
float clock 985248.625 to reSIDfp. Tetorica uses its existing integer 985248 Hz.
The pinned reSIDfp RESAMPLE implementation quantizes two resampler periods in
units of 1/1024; its effective output rate can differ slightly from the nominal
WAV rate. For example, nominal 48 kHz gives about 48010.4765 Hz internally.
The actual frame counts, quantized periods and clocks are saved rather than
silently stretching or trimming the reference. CPU scheduling can finish an
event beyond the requested endpoint; the reference SID itself is clamped at the
exact endpoint and later writes are excluded.

Measurements compare the streams' common sample-index prefix. There is **no
gain fitting, phase alignment, resampling or extra DC correction**. Peak, RMS,
mean, AC RMS, last-window spectrum/band fractions, raw RMSE and correlation are
diagnostic values. Different filter/analog/DAC/sampling models are expected to
produce different PCM. Native/WASM consistency and a match to another emulator
do not prove real-SID fidelity.

SID reads are retained in `capture.json`; the compact trace keeps their count
and a few examples. A program using OSC3/ENV3 for decisions follows the
reference chip's responses. Replaying its writes is therefore an **open-loop
comparison**, not CPU execution driven by Tetorica's SID reads.

Trace JSON is limited to 32 MiB, one million strictly ordered writes and bounded
JSON metadata. The native protocol validates the whole stream before emitting
PCM. Unsupported/coerced fields, duplicate cycles and out-of-window writes fail
explicitly.

## External source and license boundary

The verifier uses official pinned **libsidplayfp 3.1.2** and **libresidfp 1.2.3**,
both GPL-2.0-or-later. The reference-only C++ adapter is also GPL-2.0-or-later.
See [the exact sources, licenses and build recipe](../third_party/sid-reference/README.md).

A marked reference-only patch serializes the initial 6581 filter-table tasks.
The unmodified upstream initialization shares mutable dither state across its
worker threads, causing small run-to-run differences. The patch retains table
calculations and fixes their initialization order; it does not change DSP
equations, playback scheduling or the browser core. Original archive hashes,
patched-file before/after hashes and the patch digest are authenticated by the
build provider. Reports name this engine **1.2.3+serial-table-init**.

The Node parser, trace renderer, metrics and fixtures are original BSD code;
the reused chip keeps its existing zlib notices. The GPL reference executable is
a separate validation process, outside the browser, Synth ZIP and npm entry-point
dependency closures. This milestone does not change or publish those runtimes.

## Verification

```sh
npm run test:sid-reference
node scripts/prepare_sid_reference.mjs --offline --check
node scripts/check_sid_reference.mjs --offline \
  --work-dir release/sid-reference-validation \
  --out docs/issues/sid_reference_comparison_01.json
```

Unit tests cover malformed PSID/trace input, original bytecode, same-cycle and
end-boundary semantics, actual WASM output, buffering/DC behavior, WAV preservation
and build-cache provenance. The integration checker runs four original profiles
at 48 kHz, the known A4 tone additionally at 44.1/96 kHz, then repeats the
filtered tune with different player/render chunks. Expected CPU writes,
same-backend PCM and chunk invariance are strict checks. Cross-engine waveform
differences remain measurements. CI is in
[sid-reference.yml](../.github/workflows/sid-reference.yml).

References: [official SID format](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt),
[libsidplayfp](https://github.com/libsidplayfp/libsidplayfp),
[libresidfp](https://github.com/libsidplayfp/libresidfp),
[implementation TODO and results](issues/todo_sid_01.md).
