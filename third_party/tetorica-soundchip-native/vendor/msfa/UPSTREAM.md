# Vendored msfa core

- Repository: https://github.com/google/music-synthesizer-for-android
- Commit: `f67d41d313b7dc85f6fb99e79e515cc9d208cfff`
- Original directory: `app/src/main/jni/`
- Source license: Apache License 2.0, retained in `COPYING` and every source header.
- Retrieved: 2026-10-15.

This directory contains only the DX7 core, SynthUnit MIDI/voice allocation,
its filter, and supporting headers. Android/iOS/macOS host code, assembly,
benchmarks, third-party voice banks, and Dexed code are not included.

Local adapter/portability and live-control changes are documented in
`../../docs/research.md`. The 2026-10-16 extension modifies `env.{h,cc}`,
`dx7note.{h,cc}` and `synth_unit.{h,cc}` to add non-retriggering live operator
level/frequency/feedback control. These are local Apache-2.0 changes; no Dexed,
Synth_Dexed or MiniDexed source was incorporated.
`freqlut.cc` and `fm_core.cc` also define phase-shift bounds/wraparound for
extreme valid frequencies; original in-range arithmetic is retained.

Included files: `aligned_buf.h`, `controllers.h`, `dx7note.cc`, `dx7note.h`, `env.cc`, `env.h`, `exp2.cc`, `exp2.h`, `fm_core.cc`, `fm_core.h`, `fm_op_kernel.cc`, `fm_op_kernel.h`, `freqlut.cc`, `freqlut.h`, `lfo.cc`, `lfo.h`, `module.h`, `patch.cc`, `patch.h`, `pitchenv.cc`, `pitchenv.h`, `resofilter.cc`, `resofilter.h`, `ringbuffer.cc`, `ringbuffer.h`, `sin.cc`, `sin.h`, `synth.h`, `synth_unit.cc`, `synth_unit.h`.
