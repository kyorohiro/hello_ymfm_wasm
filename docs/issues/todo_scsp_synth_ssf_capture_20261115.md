# SCSP Synth paused SSF audition and Capture

Requested 2026-11-15 after read-only SSF Live inspection.

- [x] Define a bounded, validated capture of one ordinary PCM slot from a
      same-time native slot / RAM snapshot, with an explicit reference key.
- [x] Preserve supported PCM format, waveform, loop, Envelope, LFO and direct
      mix in the existing portable Synth preset format.
- [x] Explain unsupported hardware source / address / modulation / DSP cases
      without replacing the authored instrument or stopping the paused song.
- [x] Route paused keyboard audition to a separate captured-instrument voice
      state while retaining the selected Live slot and paused transport.
- [x] Add Capture to Synth beside the existing SSF Live controls; retain
      Pause / Resume and make the editable authored view explicit.
- [x] Preserve ordinary authored keyboard behavior outside paused Live view.
- [x] Verify sample / pitch / loop / preset round trips and failed capture
      preservation with the actual WASM and muted Chromium / WebKit browsers.
- [x] Verify the distributed ZIP and update guide / CI / handoff records.

First scope: an independently playable ordinary PCM slot. Paired modulation,
noise / source-bit transformations, native envelope-phase continuation and
the song's DSP program require separate handling. Capture is a software
snapshot of an instrument and does not modify the SSF recording or sound CPU.

## Implemented flow

1. Play an SSF, Pause, leave Live enabled and choose a physical slot.
2. Use Reference key C2–C6 (default C4). That key reproduces the observed
   hardware playback rate, with other keys transposed from it. The recording
   does not provide an original root note, so this is an explicit reference.
3. Play the keyboard to audition the selected supported PCM slot. Its native
   SCSP handle shares the compiled module, AudioWorklet, Master and existing
   AudioContext, with separate RAM / voices from the authored instrument.
   The paused song CPU, snapshot and transport remain fixed. An unapplied
   drawing in the authored editor stays intact.
4. Capture to Synth copies the click-time snapshot into the authored PCM
   instrument and turns Live Off. Capturing while playing first pauses the
   song. The original Pause / Resume remains available. Save to presets or
   Menu export then uses the existing portable JSON / Files workflow.
5. Live On returns to the song snapshot; Resume continues it. Slot, reference,
   Live and transport changes clear audition voices. Ordinary keyboard
   playing outside paused Live uses the authored instrument.

`ssf_capture.js` has a cheap eligibility check and a full validated converter.
Full PCM (2–65,535 samples), PCM8/16 format, one-shot / forward loop, Envelope,
LFO and direct mix are retained. Its portable v1 single-voice result loads
through the existing multi-operator preset reader and saves as the current
Synth format. The source waveform uses the same native 20-bit address wrap,
dummy RAM half and PCM16 alignment as the snapshot preview.

Unsupported cases show an explanation: source-bit operations, noise / zero,
reverse / alternating loops, attack hold / loop link / bypass / sound-direct,
short-wave / extended pitch coding, modulation input dependencies, unsafe
loop steps and muted direct output. MDL=0 / STWINH is allowed with a warning
that outgoing stack writes are not reproduced. Song DSP programs and global
master volume are not copied; an instrument with DSP send is captured dry.
Every note starts a fresh sample / envelope / LFO phase, using the Synth's
SCSP approximation and Master. Native interpolation and level can differ.

Validation failures preserve the prior authored patch and recording. A Stop
before the queued load cancels capture. A successful native load is the
commit point; a later explicit Resume / Stop does not falsely label the
already-copied instrument as cancelled.

## Verification

- 133 SCSP unit / actual-WASM / packaging tests passed; 110 mixer calibration
  tests passed with no shared measured-source or DSP changes.
- Actual native tests verify PCM8/16, full 1024-sample capture, nonzero loop
  start, one-shot ending, hardware pitch registers, KRS / LFO / direct mix,
  reference sine period and byte-identical export / load audio round trips.
- The preview and authored native handles share a module while retaining
  separate RAM and voices. Partitioned rendering is identical at 44.1 / 48 /
  96 kHz; stopping preview preserves authored notes, and invalid replacement
  preserves both instruments.
- The actual review ZIP passed 10 Capture scenario groups in Chromium and
  WebKit, including dirty draft restoration, delayed preparation key release
  / slot changes, unsupported slots, saved presets, Pause / Resume, before-
  and after-commit cancellation races, 390 px layout and one AudioContext.
- Live inspection's existing 10 scenario groups passed both browsers on the
  same ZIP, together with basic Synth, Code / Files, VGM Song and SSF folder
  regressions. The final archive contains 350 files, including the editable
  capture module and authenticated native source kits; its SHA-256 is
  `6cb5deaa3c016f6c62459a0def0381cd88935c80abccff0f4f0d3d3da6a29d41`.
- Real local SSF audit: 12 files at 1 / 2 / 3 seconds gave 376 active PCM
  slot-observations. 173 were eligible and all 173 full conversions passed.
  These are repeated observations, not distinct instruments. The other 203
  used attack / loop link. Capturable slots appeared in 11 of 12 files;
  `cbp2_00_04.ssf` had only loop-link voices at these sampled positions.
  All observed active slots used DSP send, so captured sounds are dry.
- Browser physical output was muted, and the real-set audit created no audio
  device. Human listening / long-duration comparison remains pending. Game
  data was read locally and is absent from source and distribution.

```sh
npm run test:scsp-synth
npm run test:scsp-synth:capture-browser
npm run test:scsp-synth:live-browser
```
