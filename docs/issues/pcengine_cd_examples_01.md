# PC Engine CD-ROM² external examples

Status: **implemented and verified locally**. No commit, push or GitHub Pages
publication was performed.

`w/tetorica-fm2612-examples` now installs the published
`tetorica-fm2612@0.2.32` exactly. The dependency lock, catalog, README and runtime
guide describe the updated version. The complete package, including WASM,
declarations, source bundles and notices, is copied into the generated website.

## New examples

| Example | Browser | Node output |
| --- | --- | --- |
| `pc-engine-cd/cdda/01-stereo-tracks` | Original stereo WAV, two tracks, Pause/Resume, Seek, EOF and replay | 172,800 frames, 48 kHz stereo PCM16, 3.6 seconds |
| `pc-engine-cd/adpcm/01-sample` | Original PCM encoded into 2,400 bytes of ADPCM RAM, odd nibble start, loop, Stop and replay | 124,800 frames, 48 kHz duplicated mono PCM16, 2.6 seconds |
| `pc-engine-cd/mix/01-three-sources` | HuC6280, MSM5205 and CD-DA individually, then together, with independent Mixer inputs | 144,000 frames, 48 kHz stereo PCM16, 3 seconds |

Every example contains independent Web/Node source files and a README. All audio
is generated in the code; no external game disc, BIOS or sample is needed.
CD-DA and MSM5205 use their application-audio APIs, rather than new generic
`createSoundChip()` names.

Browser pages use `Playground({chip:'huc6280', pcEngineCd:true})`, with Main/Worker
selection, editable code, cancellation during preparation and playback, and
`finalize()` cleanup. Demo track paths are resolved through `readCddaFile`.
Static importmap consumers use the actual `package_assets.js` path. No new UI
polling or per-block PCM requests were added.

The Web ensemble has longer sections and a final 0.8-second wait to allow the
default Worker PSG lookahead to drain. Node uses synchronous real cores and
`createCddaOffline({sources})` on a shared output-frame clock. Web and Node
therefore demonstrate the same APIs without claiming bit-identical timelines.

The source gains are explicit example settings, applied once. The ensemble PSG
uses hardware volume 26 so it can be heard with the PCM sources. System Mixer
defaults and the published package are unchanged. The faded ADPCM loop retains
the hardware decoder predictor. The Node mix explicitly stops the initially raw
MSM5205 core before rendering its unloaded phase.

## Verification

- `npm run check:node`: all **36** offline Node examples passed, including
  source frequencies, stereo/pan, exact Pause/EOF/Stop silence, track-relative
  Seek/replay identity, ADPCM loop level, and each source's ensemble gain.
- `npm run check:pcengine-cd -- --root=docs`: **12** configurations passed:
  Chromium 153.0.8010.12 / WebKit 26.6 × three examples × Main/Worker.
  Actual final PCM proves individual contributions and simultaneous CD-DA,
  PSG and ADPCM components. Pause/EOF/Stop checks have exactly zero output.
- The Browser cases also cover Stop during primary/media initialization,
  editing, replay, syntax/runtime errors, pagehide, source disconnection and
  AudioContext closure. No missing assets or unexpected hidden chips occurred.
- Browser audio was captured before a physically muted sink. No human listening
  or hardware comparison is claimed. Desktop and compact layouts were inspected.
- `npm run build` / `npm run build:docs`: both trees contain **1,181 files** and
  match byte for byte. All **191** Browser-served assets match both final trees.
- All **929** npm package members in the install and generated vendors match the
  verified published archive. Its SHA-256 is
  `57a8a6acc607b304b3fdadd2c525a3cee78f2ece85023d3cafd802c1461583c1`.
- The development server was started temporarily; **18** routes returned HTTP
  200 with exact source bytes, including all new pages and both WASM binaries.
  The temporary server and test browsers were closed.

The preview WAVs are under `w/tetorica-fm2612-examples/output/pc-engine-cd-*.wav`
(ignored generated output). Use `npm run dev` in that repository and select the
**PC Engine CD-ROM²** category to try the Web examples.

Receipts, source hashes, build identity and Browser details are in
[pcengine_cd_examples_01.json](pcengine_cd_examples_01.json).
The fixed SDK, Tauri application and VGM package were not changed by this task.
Collecting the new C cores into the SDK repository remains separate work.
