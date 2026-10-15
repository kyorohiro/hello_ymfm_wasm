# msfa DX7 MVP: investigation and adopted constraints

Recorded 2026-10-15 before implementation of the WASM adapter. This is a
standalone project; no existing Tetorica audio package or Dexed code is used.

## Upstream and license

Upstream is Google's [music-synthesizer-for-android](https://github.com/google/music-synthesizer-for-android),
pinned to [`f67d41d313b7dc85f6fb99e79e515cc9d208cfff`](https://github.com/google/music-synthesizer-for-android/tree/f67d41d313b7dc85f6fb99e79e515cc9d208cfff)
(2017-09-12, “Make Mac build generate audio”). The files copied from
`app/src/main/jni/` are listed in `vendor/msfa/UPSTREAM.md`; original copyright
headers and Apache-2.0 `COPYING` are retained. Upstream has no separate NOTICE
file. New project code also uses Apache-2.0; `THIRD_PARTY_NOTICES.md` identifies
the engine and changes. No unlicensed third-party SysEx bank is bundled.

Build the following `.cc` files from `vendor/msfa/`: `dx7note`, `env`, `exp2`,
`fm_core`, `fm_op_kernel`, `freqlut`, `lfo`, `patch`, `pitchenv`, `resofilter`,
`ringbuffer`, `sin`, and `synth_unit`. The support headers are vendored alongside
them. Platform hosts, Android glue, NEON assembly, sawtooth oscillator,
benchmarks, and the unrelated `log2` module are unnecessary for this path.

## Internal rate and shared state

**Adopted internal rate: 44,100 Hz, fixed for the entire lifetime.** The upstream
Mac host explicitly sets this rate in `SynthApp/SynthMain.mm` (lines 102 and
158), and Android defaults to 44,100 Hz / 64 frames in
`service/SynthesizerService.java` (line 68). Android can override it from the
output device property; upstream is therefore not formally restricted to
44,100 Hz. However, there is no complete rate-independent timing contract:

| Component | Upstream implementation | MVP decision |
| --- | --- | --- |
| FM frequency | `freqlut.cc`: process-global `lut`, calculated from `sample_rate` | Initialize at 44,100 Hz only |
| LFO | `lfo.cc`: static `Lfo::unit_`, derived from `N / sample_rate` | Initialize at 44,100 Hz only |
| Pitch envelope | `pitchenv.cc`: static `PitchEnv::unit_`, derived from `N / sample_rate` | Initialize at 44,100 Hz only |
| Amplitude envelope | `env.cc`: increment depends on `LG_N`; no sample-rate initialization | Preserve the 44,100 Hz behavior |
| Sine / exponential / tanh tables | Global lookup arrays initialized by `SynthUnit::Init`; rate-independent | Initialize once per WASM instance |
| Resonant filter | `resofilter.cc`: uses `Freqlut::lookup`; mutable history is per filter | Keep the upstream filter at the fixed internal rate |

Calling `SynthUnit::Init` with another rate in the same native process/WASM
memory would overwrite shared frequency/LFO/pitch-envelope state of existing
synths. The public API does not expose an internal rate. Each WASM-backed synth
owns a separate WebAssembly instance/memory, and all initialize at 44,100 Hz;
voice data, filter state, LFO phase, notes, buffers, and destruction are private.
Native reference instances share only lookup tables initialized at the same
fixed rate. Concurrent reinitialization is not a supported native API.

The public `sampleRate` is the **output** rate. 44,100 and 48,000 Hz outputs
must preserve pitch and elapsed time; a stateful output-side resampler is used
when rates differ. Its fractional position and source samples survive render
boundaries. The browser uses `AudioContext.sampleRate`, never assumes the
requested context rate was accepted. Multiple internal rates, internal clock
changes, and exact emulation of the real DX7 hardware sampling clock are out
of scope. The output resampler is an MVP quality choice, not an assertion of
hardware-identical aliasing or high-order resampling.

## Core, PCM, and timing

Reuse `Dx7Note` / six operators / all 32 algorithm routings, `SynthUnit`'s
16-voice allocation, LFO, envelopes, resonant output filter, and original
Int16 clipping. Do not rewrite the FM arithmetic or replace the filter.

`synth.h` defines `LG_N = 6`, so the DSP block is **64 internal frames**.
`SynthUnit::GetSamples` already retains surplus Int16 samples for nonmultiple
requests. The wrapper retains all block and resampling leftovers; rendering
the same event timeline in different caller-sized chunks must produce the
same PCM. Events affect the next not-yet-generated internal block. Already
generated surplus samples and resampling lookahead keep their original
meaning; this is not a sample-accurate event scheduler.

Public PCM is mono `Float32Array`. The original clipped signed Int16 value is
divided by 32,768: the representable range is -1 to 32767/32768. There is no
extra gain, compressor, dither, stereo panning, or master limiter. The original
engine is already quantized to 16-bit at its output. `render(frames)` returns
independent owned storage; `renderInto(buffer)` writes caller-owned storage
and advances the same timeline. The new API keeps channel count explicit
without introducing a general multichannel framework.

The portable scalar FM path is used for both native reference and WASM. On
ARM64 upstream otherwise uses an approximate NEON sine kernel, which would
make a native-versus-WASM PCM comparison measure different algorithms.
Compilation uses `MSFA_FORCE_SCALAR`; DSP formulae in the selected path remain
upstream's. Deterministic initial values and identical floating-point compiler
settings are required when comparing the filter's native/WASM output.

## Voice allocation and release

- `AllocateNote()` rotates over 16 slots and picks the first whose `keydown`
  flag is false. All 16 keys held: additional Note On is ignored. There is no
  custom stealing of held voices.
- A released slot can be reused while its old envelope is still audible. This
  is upstream allocation behavior and can truncate that release tail.
- Repeated same-pitch Note On allocates additional slots. A Note Off releases
  **all held voices of that pitch**, not just the oldest/newest one.
- Velocity zero Note On is Note Off. Normal Note Off enters each operator's
  release stage. The audible duration depends on the voice's envelopes.
- The thin `AllNotesOff()` adapter releases all live voices and clears sustain
  and key flags. It allows tails; it is not immediate silence. The separate
  panic/reset path discards voices, pending PCM, and filter/resampler history.
- Existing notes retain their copied operator/envelope parameters when a new
  voice is selected. The one shared per-synth LFO has its rate, waveform, sync, and delay
  increments reconfigured by voice selection (its running phase is retained),
  so modulation of existing notes can change. Already rendered leftovers stay
  unchanged. The demo can release notes while switching voices for clarity.
- Upstream does not mark released notes inactive after envelopes finish.
  Previously used slots continue to be computed, bounded at 16; no new
  automatic silence detector or voice reclamation algorithm is added.

## SysEx and known engine limitations

The upstream `ProcessMidiMessage` only recognizes one bulk-bank header and
contains a checksum TODO. It is **not** the public SysEx validator. A separate
JavaScript parser validates framing, manufacturer, voice/bank format, exact
length, 7-bit data, checksum, and parameter bounds. It retains raw parameters,
unpacks 128-byte bank voices, and supplies one 155-byte voice to the thin C++
adapter. The engine receives an extra internal byte 155 (`0x3f`, all operators
enabled), as upstream `UnpackPatch` does. Names and bank selection remain
outside the DSP. Voice application is ordered before subsequent Note On.

This is an msfa-derived DX7-compatible MVP, not a complete DX7 firmware or
bit-accurate hardware recreation. In this upstream version:

- Operator amplitude modulation sensitivity / LFO amplitude depth are stored
  by the parser but not applied by `Dx7Note::compute`.
- Voice transpose and oscillator-key-sync fields are not consulted by
  `Dx7Note::init`; operator phases always reset on note initialization.
- The one LFO is shared by the synth; each Note On calls its `keydown` method,
  rather than implementing every original hardware trigger detail.
- Pitch bend, if used through the internal MIDI parser, has a fixed three
  semitone range. Channelized/multi-timbral MIDI and raw SysEx streaming are
  not exposed by this MVP.
- The retained resonant filter is an msfa host feature, not proof of a matching
  DX7 analog output stage. Its source explicitly notes incomplete tuning and
  oversampling.

These limitations are documented rather than expanded into a new DSP project.

## Minimal local upstream changes

All modified files carry “Tetorica modification” notices:

1. `synth.h`: add `MSFA_FORCE_SCALAR` to select the existing portable path.
   `aligned_buf.h`: include standard size/integer definitions so it compiles
   independently on modern C++ toolchains.
2. `synth_unit.h`: standalone includes/header guard; destructor; deleted copying;
   public `SetVoice`, direct complete-message `SendMidi`, and `AllNotesOff`.
3. `synth_unit.cc`: deterministic initial LFO/controller/note/unused-bank state;
   paired deletion of allocated notes; direct 155-byte voice application;
   release-all convenience method; allow a null, unused MIDI ring buffer.

Value-initializing each allocated `Dx7Note` initializes its previously
indeterminate feedback history. Feedback state is **not** reset on every
reuse, preserving upstream reuse behavior. LFO phase/random/delay state is
initialized once. No FM, envelope, sine, filter, allocator, or clipping formula
has been changed. Native comparison uses these same minimal patches, not an
uninitialized stock build.

## Worklet MVP boundary

WASM initialization and voice parsing run outside `process()`. The public
browser creator resolves only after Worklet readiness; the demo keeps keys
disabled before this. Voice-load completion is acknowledged after application
in the Worklet, and port message ordering preserves load / selection / note
ordering. Output buffers and WASM render storage are reused by `process()`.
Disposal stops processing and rejects outstanding operations. The MVP needs
no preinitialization event queue, musical clock, or scheduled-event subsystem.

## Verification record

A native lifecycle probe was compiled with Apple clang 17, scalar DSP,
`-fwrapv -fno-strict-aliasing -ffp-contract=off`, and AddressSanitizer on macOS
ARM64. It ran 2,000 create/destroy and 1,000 panic cycles. Explicit global
`new`/`delete` accounting returned to the warmed baseline after every cycle
(final allocation delta: zero), with no ASAN memory errors. Two concurrently
live same-rate instances produced identical initial PCM; destroying one left
the other working. Panic returned exact zero PCM and the same instance could
play again. The native probe explicitly initialized a project-owned sine
voice; it did not rely on uninitialized heap memory or a third-party bank.

Apple's ASAN runtime did not provide a leak detector, so explicit allocation
accounting covered the adapter-owned synth/16-note lifetimes. This does not
assert that all browser allocations or operating-system resources are leak
free. A targeted reproducible lifecycle test can use the same fixed number of
create / load / note / render / panic / destroy cycles and check allocation
balance without adding a framework.

The read-only adapter audit confirmed one static-table initialization per WASM
memory, independent JS cores, persistent block/resampler state, panic clearing
both pending PCM and source lookahead, and dispose clearing native ownership
and JS views. Full native/WASM PCM equality, 44,100/48,000 Hz output-rate
correctness, message ordering, and browser playback remain executable checks
in the build/test workflow and README; investigation alone does not establish
those results.
