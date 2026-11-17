# SCSP FIR low-pass / high-pass comparison — 2026-11-17

**2-tap FIR high-pass** is now available in the existing DSP example chooser.
It uses `[4095,-2048,2048]`; only COEF1 changes sign from the low-pass table.
All 512 program words are identical. No new DSP instructions, audio engine or
public API are added.

## Try / restart

Choose **DSP → Example → 2-tap FIR high-pass → Check → Apply program + coefficients**.
Enable DSP return and use direct level 0 for wet-only comparison. Switch to
**2-tap FIR low-pass** using the same workflow. Spectrum and low notes make
high-pass attenuation clear. Selection / Check do not alter current sound.

```text
Low-pass:  y[n] ≈ 0.5*x[n] + 0.5*(4095/4096)*x[n-1]
High-pass: y[n] ≈ 0.5*x[n] - 0.5*(4095/4096)*x[n-1]
```

Adding adjacent samples reduces high frequencies; subtracting them reduces
low frequencies. Q12 rounding / saturation and the history gain 4095/4096 leave
a small DC residual, so this is not claimed to cancel DC exactly. The existing
first-frame TEMP-history bound and native 44.1 kHz timing remain unchanged.

The high-pass fixture [fir2-highpass.scspasm](../synth-scsp/examples/fir2-highpass.scspasm)
retains the same four instructions. Comments, recommended table, equation and
download filename identify the high-pass example. Source restore still stages
no coefficients; presets / idle state and session persistence keep their existing
formats. The separate SSF / audition DSP is unaffected.

## Applied state

The shared word image is identified as the `fir2` program family. Exact live
coefficient tables identify the named LP / HP variants. Other weights show
**2-tap FIR (custom coefficients)** instead of an incorrect low-pass label.

- Changing raw COEF1 between +2048 / −2048 changes the named variant when
  COEF0 / COEF2 match. Code `setEffect({feedback:0.5})` / `-0.5` does the same.
- The actual routing hint follows low-pass / high-pass / custom weights. All FIR
  variants retain tap roles and disabled Time because they do not use Delay RAM.
- Existing state observation updates Applied information without replacing
  source, Check results, pending example coefficients, export filename or status.
  Older Apply ACKs still preserve newer staged drafts.
- Unchanged words / codes skip display updates, and identical text is not
  reassigned to the aria-live label on every 100ms observation.

The internal program-view controller now exposes `update` / `dispose`; its only
caller is the Synth host. Public chip APIs and backend transactions are unchanged.
Program / coefficient acknowledgements and the previously fixed post-ACK refresh /
audio-close recovery continue to determine restart state.

## Verification

Machine evidence: [verification_scsp_dsp_fir_highpass_20261117.json](verification_scsp_dsp_fir_highpass_20261117.json).

- `npm run test:scsp-synth`: 249/249 pass. Model checks include LP / HP complete
  word equality, owned descriptors, fixture / browser source equality, family
  identification, strict coefficient variant matching and legacy word-only behavior.
- Actual shipped-WASM impulse input 4096 produces adjacent taps 2048 / −2048,
  followed by zeros. Signed full-range stimuli match the independent Q12 reference.
- High-pass amplitude gain is below 0.025 at 344.53125 Hz, 0.70–0.72 at 11,025 Hz,
  and above 0.99 at Nyquist. DC residual is nonzero but below 0.00025 of input.
- LP → HP setup replacement performs zero MPRO writes and leaves program revision,
  voice ownership and sample phase unchanged. Partitioned PCM remains exact.
- `npm run test:scsp-dsp-assembler`: 12/12 pass. Both mixer generators pass
  `--check`, preserving measured inputs, gains and provenance. Audio / DSP backend,
  processor, SDK and WASM files are unchanged from HEAD.
- Source and isolated readable ZIP pass Chromium / WebKit: 14 scenarios each,
  56 total. Cases cover cold staging / Apply / migration, real wet output,
  LP / HP same-word switching, manual / Code / custom classification, rejection
  retention, old-ACK / newer-stage ownership, Delay restoration, source downloads,
  reload scope and 390px layout. All served file hashes match final files.
- The preceding full FIR browser regression also passes in Chromium / WebKit,
  including acknowledged Apply followed by held refresh / AudioContext close /
  restart. Complete coefficients, program and Applied state are retained.

Every physical destination remains behind a permanent zero gain installed before
application scripts. Real PCM is measured upstream; no human listening or physical
Saturn accuracy is claimed. OS clipboard is stubbed, optional Monaco CDN blocked,
and ordinary browser / native apps untouched. Desktop / mobile screenshots are
inspected; document overflow at 390px is zero.

## Distribution

Affected entry / model / view imports use `scsp-dsp-hp-1`. Readable packaging
includes the high-pass fixture and authenticated source receipt; low-pass fixture
bytes remain unchanged. The deterministic package test passes.

- ZIP: `release/tetorica_scsp_synth_dsp-fir-highpass-20261117_itch.zip`.
- Stage: `release/itch_scsp_synth_dsp-fir-highpass-20261117-2CuxCm`.
- 364 files; 4,229,688 compressed bytes.
- SHA-256: `7f09fab6fd3b8955c2b646e66736184f56266c9b1b884cf2ccd32aefd0a01863`.

No commit, push, publication, Tauri import or SDK / WASM rebuild.
