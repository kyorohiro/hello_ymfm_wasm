# SPU Synth: icon, matching design and first release ZIP

Date: 2026-10-29

## Design and assets

The supplied 1254 × 1254 PNG is retained unchanged as
[`synth-spu/icon.png`](../synth-spu/icon.png). Its SHA256 is
`487976de5e09bbef144cc5f7b187153dc5a79cf8274c96977382f337ea65d580`.
The header, favicon and Apple touch icon use this same asset. Header sizing is
112px on desktop and 72px on mobile.

The interface follows the icon's silver casing, charcoal displays and red /
yellow / blue details. The SPU title letters use readable matching colours;
panels, fields, buttons and section markers share the updated palette. The
Envelope / Waveform / Spectrum display and vertical Pitch control retain their
behaviour. No audio-engine, core, generated WASM or Native changes were needed.

The package includes the icon at its local runtime path and in the original
input source archive with its byte count and hash. Both root and nested HTML
entry points resolve their image, favicon, touch icon, CSS and script locally.

## Validation

- `npm run test:spu-synth`: **36 passed**, including real WASM rendering and
  isolated packaging tests. PNG bytes and both entry points' asset paths are
  explicitly checked.
- The actual release ZIP was CRC-checked, extracted into a new temporary
  directory, and served from that directory for Chromium 153.0.8010.12 and
  WebKit 26.6. Both pass icon decoding, all three monitor modes, output-level
  and FFT checks, quiet-tail sleep/wake, real-pointer Pitch and recentering,
  24-voice round robin, ADSR/PCM/reverb edits, file import, preset round trip,
  Stop and audio recovery.
- Desktop 1440px and mobile 390px layouts have no horizontal overflow. The
  desktop Envelope and mobile Spectrum screenshots were visually reviewed.
- Each browser recorded 33 PCM captures / 344,064 frames. Pilots and callback
  clocks remain continuous with no clock anomalies. Physical output was
  muted; this is automated signal/UI validation rather than human listening.
- Every extracted member still matches the ZIP after browser execution. All
  served runtime hashes and the executed checker/helper hashes match the
  final report.

The optional unbundled source browser run did not start because its sandbox
escalation was interrupted while waiting for approval. It produced no new
report. The final verification above ran successfully against the actual ZIP.

- [Package result](spu_synth_icon_package_01.json)
- [Actual ZIP browser report](spu_synth_icon_browser_01.json)
- [Distribution verification](spu_synth_icon_distribution_01.json)

## Distribution

`release/tetorica_spu_synth_v0.1.0_itch.zip` contains **45 files / 5,456,858
bytes**. SHA256:
`18cc9d6ca2027a076cc12e021fbf707bedd4590e210d1c78826100e59773c635`.

Build it with:

```sh
sh scripts/package_itch_spu_synth.sh v0.1.0
```

The ZIP is ready for manual upload as an itch.io HTML project with root
`index.html`. Previous development ZIPs and raw reports are retained.
No commit, push, tag, npm publication or itch.io upload was performed.
