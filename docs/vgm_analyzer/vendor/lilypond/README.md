# LilyPond WASM used by Tetorica

Browser engraving uses [Hlöðver Sigurðsson's lilypond-wasm](https://github.com/hlolli/lilypond-wasm), demonstrated at https://hlolli.github.io/lilypond/.
Thank you to its author and the LilyPond, Guile and dependency contributors.

- Engine/runtime: `@hlolli/lilypond-wasm` **0.1.0-alpha.1**, LilyPond **2.27.2**, Guile **3.0.11**, WASI Preview 1.
- npm archive: https://registry.npmjs.org/@hlolli/lilypond-wasm/-/lilypond-wasm-0.1.0-alpha.1.tgz
- Engine SHA256: `e957ee1839f0102d9fd543821019e7ecb5fac71584dcc7a92983dd7525499961`.
- Worker and helper: `https://hlolli.github.io/lilypond/lilypond.worker.js` and `https://hlolli.github.io/lilypond/assets/index-nbt8xjk8.js`. The helper bundle is unmodified. The worker has the small stdio adaptation described below; see `SHA256SUMS` for this snapshot.
- Editor/build source snapshot: `upstream-source.tar.gz`, from commit `bc1f9483776a2415c12cb43886497d6f0f6b3f22` of the repository above. Worker source is `editor/lilypond.worker.ts`.
- The full corresponding engine source archive and checksum are documented in [SOURCE.md](SOURCE.md). This is separate from the editor/build source snapshot.

## Local adaptation

Tetorica repacks the npm runtime files into `runtime/runtime-files.pack.gz` plus offsets in `runtime-files.json`.
`assets/index-3ptg5x02.js` replaces the demo's metadata module with the alpha.1 mount/environment configuration and empty writable directories required by the worker.
To reproduce these local adaptations, extract the pinned npm archive and run from the project root:

```sh
python3 scripts/pack_lilypond_runtime.py /path/to/extracted/package docs/vgm_analyzer/vendor/lilypond
```

The application starts a fresh worker for each preview, sends the generated `.ly` source, and displays the resulting SVG pages as images.
No score is uploaded. Runtime assets are served from the same application. The initial assets total approximately 72 MiB before HTTP compression; browser caching depends on hosting settings.
Closing/cancelling terminates the worker. Engraving has a three-minute timeout. PDF generation is not included.

## Licenses and source

Keep [LICENSE](LICENSE), [COPYING](COPYING), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [SOURCE.md](SOURCE.md), `licenses/`, and `editor-licenses/` with redistribution.
LilyPond and this WASM port include GPL-3.0-or-later work; dependencies have their own notices. These components are not relicensed under Tetorica's root license.
For rebuilding the engine, use the pinned source and upstream build instructions. When redistributing binaries, preserve the corresponding-source distribution described in SOURCE.md as well as these notices.

## Standard-stream position probes

Tetorica adds `withQuietStdioTell` from `wasi_stdio.js` around `N.getImportObject()` at WebAssembly instantiation in the bundled worker.
The original host throws/logs a WasiError and returns errno 76 (NOTCAPABLE) for `fd_tell` on descriptors 0–2.
The adapter returns the same code directly for these descriptors, preserving the capability restriction while avoiding misleading Console stack traces. All other descriptors and imports are unchanged.
These three probes also occur in successful engravings and are not evidence that engraving failed.

The worker error message also includes `Error.stack` so browser-only failures can be diagnosed in the preview.
