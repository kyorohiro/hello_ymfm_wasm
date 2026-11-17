# SCSP Synth read-only DSP program view — 2026-11-17

The DSP tab now shows the built-in Synth Delay as six physical microsteps,
their decoded field instructions and their roles. It is available before audio
starts. The heading identifies the fixed Synth source; it is not a live dump
of the separate SSF player's DSP. Editing / Apply remains later work.

## Try

Reload SCSP Synth and select **DSP**. The table explains preparation, ring
read, read latching, output / feedback, input addition and ring writeback.
The **?** opens pipeline and configuration notes. The existing collapsed
experimental Delay controls remain usable; the tab reads **DSP · Delay on**
when that effect is enabled.

**Copy .scspasm** / **Save .scspasm** export annotated field source as
`tetorica-scsp-delay.scspasm`. Coefficients, RAM addresses, ring configuration,
send / return and Start remain separate; this exports the microprogram.
The [field assembler guide](../synth-scsp/DSP_ASSEMBLER.md) explains local reuse.

On narrow screens the table scrolls inside its own region. Touch / pointer or
Left / Right arrows reveal the Role column. Letter keys still play the Synth
while the region is focused. The explicit horizontal handler is needed for
WebKit, whose focused overflow region did not scroll with arrow keys in a
minimal independent HTML check.

## Implementation / validation

Machine evidence: [verification_scsp_dsp_program_view_20261117.json](verification_scsp_dsp_program_view_20261117.json).

- `dsp_program_view.js` derives the model from `delayProgram()` and the existing
  disassembler. The same source is used by both exports. Rows and comments
  retain the actual physical step positions; the source reconstructs all 512
  words, including trailing zeros. Row-role tests also check the underlying
  MRD / IWT / EWT / COEF / input / BSEL / MWT controls.
- Copy uses the browser clipboard where available, with a temporary selection
  fallback. The fallback restores focus and removes its textarea. Failure
  feedback offers Save. Disposal retires listeners and pending Blob URLs;
  late clipboard completion cannot update the disposed view.
- `npm run test:scsp-synth`: 210/210 pass, including three new listing tests and
  deterministic readable-package verification. `npm run test:scsp-dsp-assembler`:
  12/12 pass. Both existing mixer generators pass `--check` without changing
  measured evidence, gains or calibration adapters.
- Real Chromium / WebKit checks pass on source and the isolated packaged root
  (four cases). Cold view / navigation / exports do not create audio, change
  settings or replace global status. Clipboard success, fallback, denial
  feedback, temporary focus cleanup and real downloads are verified.
- Both browsers export identical 878-byte UTF-8 source through Copy / Save,
  SHA-256 `139b2669e0074922d069b2ecfd7f34d38e8d7735fcab66b5f908aeeb41c12713`.
  The downloaded text reassembles to the legacy program exactly.
- During actual upstream PCM generation, exports retain the held voice and
  settings, one AudioContext, one SCSP endpoint and the existing output route.
  Delay enable / return controls and indicator continue to work. Key release
  still silences the voice. No new sound commands are emitted by exports.
- At 390 px, document overflow is zero. Both browsers reach the Role column
  using ArrowRight and scroll back with ArrowLeft; a musical letter key still
  plays while that region is focused. Screenshots were inspected.
- No uncaught browser errors or missing resources. Final served asset hashes
  match the source / stage files. Runtime, DSP installer, assembler, processor,
  instrument, audio wrapper and core / WASM files remain byte-identical to HEAD.

All physical destinations were permanently muted before scripts ran. The OS
clipboard was stubbed, and real PCM was measured upstream. Human listening was
not performed. Browser tests use the supported local editor fallback rather
than fetching the optional Monaco CDN.

## Distribution / restart

Entry JavaScript and CSS use `scsp-dsp-view-1`; the new view is a static import
of the entry. The passive listing also tolerates old HTML without its elements.
The readable dependency graph includes the view and assembler unchanged; the
declaration, format guide and authored `.scspasm` fixture are copied verbatim
and included in the authenticated original-source archive.

- ZIP: `release/tetorica_scsp_synth_dsp-program-view-20261117_itch.zip`.
- Files: 360; compressed size: 4,188,728 bytes.
- SHA-256: `4a7faff8e3e84ff30c3184d48d09496d48f241ad899075fd3d6c8e079f0ae9cb`.
- Verified stage: `release/itch_scsp_synth_dsp-program-view-20261117-mkmSHF`.

No runtime / SDK / WASM rebuild, npm publication, Tauri import, commit, push or
release upload. The next implementation can address editable program drafts
and explicit Apply after replacement / failure / ownership semantics are set.
