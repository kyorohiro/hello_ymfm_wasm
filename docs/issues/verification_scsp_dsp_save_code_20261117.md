# Save the applied SCSP DSP setup as Code — 2026-11-17

**DSP → Save setup to Code** now saves the acknowledged Synth DSP program,
COEF0–2 and effect settings as readable JavaScript in Files. It uses the existing
Code compilation / application API; no new preset format was introduced.

## Try it

1. Apply a DSP program and adjust the live coefficients / effect settings.
2. Choose **Save setup to Code**, beside **Applied**.
3. Files selects **dsp/SCSP DSP setup.js**. Further saves use numbered names.
4. Select Code and **Run** the saved file to restore its DSP setup.

Saving keeps performance, Keyboard / Code mode and the source draft. It does not
run the saved file or apply staged source / recommended coefficients. Saving cold
also works without acquiring an AudioContext. Copy / Save `.scspasm` continues
to export the draft verbatim; the new action exports what is actually applied.

The generated code calls `compileDsp()` on canonical field source, then applies
the complete coefficient table and all five effect settings. It uses the
current PCM, voices and voice routing. Notes, PCM, routing, live ring / TEMP
history and the separate SSF engine are excluded. Save a voice preset separately
if its sample / voice configuration also needs to travel with the DSP setup.

## Implementation and boundaries

- Active saving reads `{words, custom, revision, coefficients, effect}` in one
  primary-owner turn through private `readDspSetup()`. It cannot combine words
  from one program with later coefficient / effect changes. Reading neither
  mutates the native core nor advances audio, and returns detached data.
- Cold saving combines the acknowledged Main word image with passive-model
  coefficient / effect state, without audio initialization or a native renderer.
- The pure generator reuses execution-profile, complete coefficient and effect
  validators. Inconsistent COEF1 / Feedback snapshots are rejected. Canonical
  instructions recover all 512 words and requested fractional Feedback values
  retain their matching quantized register codes.
- Files chooses an unused `.js` path, handles case-insensitive file / folder
  collisions and validates capacity before mutation. Saving preserves mode and
  runtime ownership. Local-store failure leaves the file in Files with a project
  export recovery message. Cassette export already includes the generated code.
- A workspace / audio identity guard prevents a late snapshot from reaching a
  replacement workspace. Once a file is created, a subsequent audio change does
  not invalidate that captured artifact or falsely report cancelled storage.
  Workspace / disposal guards remain active through editor and persistence work.
- Loading Files / a Cassette never executes the generated JavaScript. The
  current draft, pending example and separate audition are unaffected by saving.

No default sound, calibration, portable voice / idle format, native / WASM,
public npm API or DSP language was changed. No commit, push or publication.

## Verification

- `npm run test:scsp-synth`: **288 passed**. This includes deterministic generated
  source, real shipped-WASM round trips for Delay / FIR low-pass / FIR high-pass /
  IIR / custom programs, complete settings and native PCM equality, signed /
  fractional coefficient cases, invalid / inconsistent snapshots, one-turn
  primary snapshots, argument ownership, capacity / collision failures, stale
  guards, disposal and storage recovery.
- `npm run test:scsp-dsp-assembler`: **12 passed**.
- Both mixer / Playground calibration generators passed `--check` unchanged.
- New Save browser checker: source / isolated readable ZIP × Chromium / WebKit,
  **8 cases each, 32 total**. Cold saves create no audio; repeated saves retain
  earlier files; reload preserves source without execution; warm saves retain
  held Code and keyboard voices while ignoring invalid / staged drafts and
  separate audition. Explicit Run restores the captured setup, and the existing
  Cassette keeps its JavaScript. A held snapshot followed by project import is
  cancelled without inserting DSP code into the replacement workspace.
- Existing DSP Code browser suite also passed in both browsers, **11 cases each**.
- No missing assets or uncaught errors; 390px document overflow **0**. Desktop
  and mobile screenshots were inspected. Every physical destination remained
  permanently gain 0 before application modules loaded. PCM was measured
  upstream; no listening or native application interaction was performed.
- All 102 served source / ZIP assets matched their respective files; common
  101 assets were byte-identical. The root HTML entry relocation is intentional.
  Package tests verify deterministic output and byte-exact editable modules
  with authenticated browser / native source receipts.

Final validation ZIP:
`release/tetorica_scsp_synth_dsp-save-code2-20261117_itch.zip`.
368 files, 4,252,167 bytes, SHA-256
`32450c7f9bb344c73ae3bfbe023903b812935ce70f729c2a211163614f91f948`.

The earlier `dsp-save-code-20261117` validation archive predates the post-commit
audio-change status fix. Use the final `dsp-save-code2-20261117` artifact above.

[Machine evidence](verification_scsp_dsp_save_code_20261117.json) contains the
browser cases, generated source, restored setup, silent graph and asset hashes.
Usage is also documented in [DSP_ASSEMBLER.md](../synth-scsp/DSP_ASSEMBLER.md).
