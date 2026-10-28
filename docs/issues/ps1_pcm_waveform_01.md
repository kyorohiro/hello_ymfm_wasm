# Per-voice PCM drawing in the PS1 SPU tab

Date: 2026-10-28. Base: `6bd7fdfc12e973b43da11d59728db078d9f82ac2`.

## Workflow

The SPU tab offers the same immediate waveform-editing workflow as the
PC Engine tab: select a voice, choose Sine/Triangle/Saw/Square or draw a cycle,
and audition it with Sustain play or Keyboard while adjusting ADSR and reverb.
Numeric editing addresses individual signed PCM samples.

This editor uses one 112-frame cycle. The preparation-side encoder converts
the normalized PCM to four 16-byte SPU ADPCM packets, loops from frame zero and
declares `44100 / 112` Hz at PITCH 4096. The displayed PCM is the original source;
the actual SPU sound includes ADPCM quantization and interpolation. Arbitrary
ADPCM uploads have no original PCM to display in this small cycle editor.
Long recordings remain the responsibility of the shared Sample Editor.

## Implementation boundaries

- A completed pointer stroke sends one edit. Moves update the draft only;
  cancellation, hidden tabs, voice changes and disconnected instances fence
  pending edits. Opening the panel neither creates audio nor modifies samples.
- Conversion runs on the preparation side, never in AudioWorklet. The audio
  owner validates fixed-size packets and PCM and writes the prepared RAM bytes.
- Each voice lazily allocates one 64-byte slot and reuses its sample ID/address
  on later edits. These slots belong to their physical voice; ordinary uploaded
  samples remain shareable. The shared initial sample and sibling voices are
  preserved. Full-RAM rejection must occur before mutation.
- Applied resource metadata is synchronized independently of queued voice
  settings across Worklet, Main and Worker authoring shadows. Public uploads
  after a waveform edit must keep sample IDs and addresses aligned. Stop and
  default reset retain RAM; `clearRam:true` discards the bank and owned slots.
- Waveform application preserves pitch, ADSR, volumes and reverb. The existing
  retrigger option restarts only editor-owned auditions. Voice-code copying
  includes PCM, encoding, upload, tuning and settings for use in a fresh bank.
- C++/WASM, Mixer gains, fixed SDK, Tauri Native and package versions are outside
  this change. No publication is requested.

## Verification

- 185 focused tests pass with no skips: preparation, actual SPU core, resource
  synchronization, inspector, panel, sample-instrument reuse, ownership and tabs.
  This includes the 70 core/admin cases and 26 panel cases. Another final group
  of 177 Main-runtime/panel cases (overlapping the 26 panel cases) validates
  emitted voice code under the complete Playground execution prologue.
- 110 Worker-runtime cases and all mode declarations pass. Real-core tests
  preserve a sibling voice's exact PCM phase during repeated private-slot
  edits. Full-RAM rejection, 24-slot reuse, owner restrictions, retained/reset
  banks, client attachment and interleaved Main/Worker clear-reset races pass.
  A reset carried by the real Worker PerformanceSender retains its resource
  fence; an expired reset cannot poison it.
- An existing polyphonic Sample Editor instrument skips channel-owned editor
  slots when checking identical RAM for reuse. A matching shareable upload is
  created once and reused on subsequent preparations.
- Browser testing found an emitted-code name collision: `const sample` caused
  a temporal-dead-zone error in Playground's execution prologue. Generated
  locals now use `ps1WavePcm`, `ps1WaveEncoded` and `ps1WaveSample`; both the
  runtime regression and actual browser execution cover this correction.
- Isolated npm pack/install passes: 991 files, 1,891,805 compressed bytes,
  7,069,469 unpacked bytes, 383 declarations, 1,089 local module/asset references,
  28 WASM engines and 15 renderer checks. Installed waveform preparation,
  actual SPU playback, slot reuse and owner isolation, normal uploads and
  positive/negative consumer types pass. Package version remains `0.2.32`.
- The Worklet's 58-module static import graph excludes both the PCM encoder
  and `ps1_waveform.js`. Encoding is bounded to one 112-frame cycle on the
  preparation side. No periodic inspector reads or pointer-move audio writes
  were added.
- Source and the actual final Run ZIP pass Chromium 153 / WebKit 26.6 × Main /
  Worker (8 routes) with one frozen checker. All routes verify real drawing,
  cancellation, one upload per completed stroke, numeric edits, stable sample
  ID/RAM, CH24 isolation, Keyboard/Sustain and portable generated code. The
  sine's third/fundamental ratio is 0.0002–0.0021 versus the square's
  0.331–0.334 at approximately 439.99 Hz. The subsequent public upload receives
  ID 2; copied code after clear RAM recreates ordinary ID 0 with exact ADPCM
  bytes. Existing ADSR/reverb/Stop/disconnect/error recovery checks also pass.
  All captured quanta are finite and continuous. Final served bytes match
  287 source assets and 215 archive assets; Chromium/WebKit PCM views were
  visually reviewed.
- Standard Synth, VGM Analyzer and Playground packaging commands pass; all
  four archives pass CRC, safe paths and complete stage-byte equality. The
  final Run ZIP has 923 entries, within itch.io's 1,000-entry limit. Analyzer's
  eight-reference calibration guard, actionlint and runtime versioner
  idempotence also pass.

Final browser receipts are recorded in [ps1_pcm_waveform_01.json](ps1_pcm_waveform_01.json). Physical
output is muted during automated PCM capture; human listening and hardware
comparison have not been performed. No commit, push, tag, publication,
SDK/Tauri import or remote CI run has been performed.

Run artifact:
`release/hello_ymfm_wasm_ps1-pcm-waveform-dev_itch_playground_for_run.zip`

SHA256: `7934d7ae4f88ef7d73a588f7bf815e9f21e1fc44e42af02447cf68561c5f7348`.
The full downloadable source archive omits `_for_run` in its name.
Public workflow: [PS1 SPU](../ps1_spu.md).
