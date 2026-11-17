# SCSP one-pole IIR low-pass example — 2026-11-17

**1-pole IIR low-pass** is now available in the existing DSP example chooser.
It stores preceding 24-bit internal output in TEMP, rather than the preceding
input used by the FIR example. The same Check / atomic setup Apply / live
coefficient workflow is used; no backend / native DSP API changes are required.

## Try / restart

Choose **DSP → Example → 1-pole IIR low-pass → Check → Apply program + coefficients**.
Enable DSP return and use direct level 0 for wet-only comparison. Saw / Noise
and Spectrum make high-frequency smoothing easier to observe. Choose a FIR or
Delay example with the same workflow to return to it.

Recommended codes are `[4095,3840,256]`. COEF0 is unused / disabled. COEF1 is
**Output feedback**, COEF2 is **Input**, and Delay Time is disabled. The tab and
routing hint identify IIR. The default name depends on COEF1 / COEF2, ignoring
unused COEF0; changed active values display **1-pole IIR (custom coefficients)**.
Manual / Code updates follow the existing state observer without replacing drafts.

The active recommended coefficients sum to 4096, giving nominal unity DC gain:

```text
state[n] = sat24(floor(state[n-1] * 3840 / 4096)
                 + floor(x[n] * 256 / 4096))
EFREG0 = state[n] >> 8
```

This is `a=0.9375`, `b=0.0625`. For another matched pair, try 3072 / 1024.
Individual edits also change gain; the UI does not calculate a cutoff / resonance
or automatically compensate input. The existing Code `setEffect({feedback})`
controls COEF1. Recommended feedback decays; other raw values can sustain history.

The readable fixture is [iir1-lowpass.scspasm](../synth-scsp/examples/iir1-lowpass.scspasm).
Copy / Save exports source with recommended coefficient comments, not an applied
configuration. Reload restores source only; the visible restore message explains
that coefficients are separate and an example can be selected again to stage them.
COEF0 / COEF2 are session-only; COEF1 remains the saved Feedback field. A voice
preset alone does not restore the IIR program. Portable / idle formats are unchanged.

## Three physical steps

1. TRA=1 reads preceding TEMP output. COEF1 multiplies it into the accumulator.
2. MIXS0 input × COEF2 is added using the preceding accumulator.
3. TWT / TWA=0 saves the preceding saturated 24-bit accumulator. EWT emits it
   to EFREG0 after an eight-bit shift. DEC decreases after each native frame,
   selecting this saved value as the next preceding output.

The feedback uses internal 24-bit state, not the 16-bit EFREG result. No sample /
Delay-ring RAM is accessed. Delay Time changes therefore retain the exact sequence.

## Recursive history and quantization

The FIR's one-frame initialization bound does not apply to this IIR. Inherited
TEMP values propagate recursively and can affect many later samples. At the
recommended feedback, a seeded positive history remains visible after 64 frames
and its emitted PCM reaches zero by frame 256 in the tested stimulus.

Negative zero-input state can reach a fixed-point residual: internal −15 emits
−1 PCM16 step. This matches the independent recursive floor reference. Full raw
coefficient range remains available; COEF1 = −4096 has unit feedback magnitude
and can preserve alternating history. No unconditional stability claim is made.

Stop resets the core's DSP history. Apply / Enable can clear Delay RAM without
resetting TEMP. No hidden frame is rendered and no unrelated voice reset is used
to prime the IIR; voice ownership and source sample phase are retained.

## Verification

Machine evidence: [verification_scsp_dsp_iir_20261117.json](verification_scsp_dsp_iir_20261117.json).

- `npm run test:scsp-synth`: 256/256 pass, including seven new IIR tests. The
  fixture matches browser source byte-for-byte and an independent three-step
  word vector. Existing example / backend / package tests continue to pass.
- Actual shipped-WASM EFREG and stereo PCM match an independent recursive Q24
  reference sample for sample, including signed full-range stimuli / coefficient
  extremes. Impulse input 16384 emits 1024, 960, 900, 843, 791, 741… after the
  zero prefix, continuing beyond two taps. Sample / ring RAM remains unchanged.
- Measured gain is above 0.98 at 86.1328125 Hz, 0.79–0.81 at 344.53125 Hz,
  below 0.046 at 11,025 Hz, and 0.032–0.033 at Nyquist, within 0.0006 amplitude
  gain of the independent response. Settled positive DC gain is above 0.999.
- Partitioned render is exact across Delay Time and unused COEF0 changes.
  Recursive inherited history / negative residual / Stop reset are verified.
  Applying IIR retains held Keyboard / Code owners and source phase / sample RAM.
- Named matching rejects FIR words paired with IIR coefficients and the reverse.
  IIR matching ignores unused COEF0 while still rejecting invalid raw code arrays.
- `npm run test:scsp-dsp-assembler`: 12/12 pass. Both mixer generators pass
  `--check`; existing measured inputs, gains and provenance remain unchanged.
- Source and isolated readable ZIP pass Chromium / WebKit: 15 scenarios each,
  60 total. Cases include cold staging / Check / Apply / migration, real wet
  signal, unused / Time controls, Code / custom synchronization, identical-setup
  continuity, rejection retention, old-ACK / newer-IIR-stage preservation,
  Delay / FIR restoration, cross-family matching, source export / fixture,
  390px layout and source-only reload / restore guidance.
- The preceding full FIR browser regression passes in both engines, including
  acknowledged Apply followed by held refresh / AudioContext close / restart.
  Existing complete-setup recovery and separate SSF / audition ownership remain.

Physical output is permanently muted before application scripts. PCM is measured
upstream, with no human listening or physical Saturn accuracy claim. The OS
clipboard is stubbed and optional Monaco CDN blocked; ordinary browser / native
apps are untouched. Desktop / mobile program and coefficient-card screenshots
are inspected; COEF0's disabled state and output-feedback role are visible.

## Distribution

Affected entry / view / model imports use `scsp-dsp-iir-1`. The readable ZIP
includes the new source fixture unchanged with its authenticated receipt. Existing
FIR / Delay fixtures and backend / audio / SDK / WASM files remain unchanged.

- ZIP: `release/tetorica_scsp_synth_dsp-iir1-20261117_itch.zip`.
- Stage: `release/itch_scsp_synth_dsp-iir1-20261117-m8DBWn`.
- 365 files; 4,236,424 compressed bytes.
- SHA-256: `8d78a55e7ed6d70414d5a45214ed55355e88981f93d96b0d92547b5b1ac2d119`.

No commit, push, publication, Tauri import or SDK / WASM rebuild.
