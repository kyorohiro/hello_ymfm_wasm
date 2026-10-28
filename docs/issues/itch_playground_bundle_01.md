# Run-only Playground UI bundle and minification

2026-10-28. Added bundle + minify to the itch.io browser build, following the ZIP entry-limit fix.

Run the existing command:

```sh
sh scripts/package_itch_playground.sh
```

It produces the full downloadable ZIP and a separate `_for_run.zip`. Only the Run build bundles and minifies UI code. The full downloadable payload retains the previous bytes and expanded source layout, including the format used for Tauri import. No canonical `docs/` or `web/` runtime module is modified.

## Scope and output

`bundle_itch_playground_run.mjs` uses the existing esbuild dependency to bundle root-level page UI modules into the root `playground.js` ESM. It targets ES2022, keeps function names, does not mangle properties, and links legal comments when present. Original `import.meta.url` tokens retain their exact module URLs; source strings containing that text remain unchanged. The copied HTML startup URL includes the bundle SHA, giving changed bundles a fresh cache identity.

The existing audio modules, DSP, generated loaders/WASM, vendor modules and subdirectory scripts keep their original files and bytes. Three root Workers and their dependency closure remain separate: Sample Editor, Shell, and SPC trace. Static import edges and module URL references protect retained files; unknown root-level nonliteral imports conservatively disable pruning. The native/runtime source viewer and Monaco declarations remain available.

| Measurement | Before bundling | Bundled Run build |
| --- | ---: | ---: |
| Browser ZIP entries, after source packing | 957 | 888 |
| Root UI input code | 75 files / 1,204,257 bytes | 810,885-byte entry |
| Root UI input files removed from loose layout | 0 | 71 |
| ZIP directory records | 0 | 0 |
| Complete Run ZIP | 36,843,597 bytes | 37,106,027 bytes |

The active UI code is 32.7% smaller. The complete ZIP also retains original UI sources in `sources/browser-bundle-inputs.zip` (75 JS inputs plus two original license files), so total download size is a separate metric and grows slightly. The existing `sources/corresponding-source.zip` still contains all 91 original compilation-source files. All license/notice files are retained.

`sources/browser-bundle.json` records input/output hashes, external imports, removed and retained files, original URL transformations, build options and the original-input archive. Its paths are relative; no temporary build directory is embedded in the bundle or receipt. The existing duplicate `beat` completion-key warning is recorded and was not changed in this packaging task.

The source-packing helper applies bundling before the final hosting entry-limit check. This allows a larger input layout to shrink below the limit. The final ZIP uses no directory records and is checked against the actual archive entry count, sizes and paths.

## Verification

Ten targeted tests pass. They execute real minified ESM, check exact URL/query semantics and source-string preservation, function names, dynamic imports, Worker closure, untouched audio/assets/licenses, original-source ZIP bytes, legal sidecars, conservative unknown-loader retention and the 1,000-entry boundary. An integration fixture with 1,005 input files passes because bundling runs before the final limit check.

The exact resulting ZIP passed all **20 browser cases**: Chromium 153 / WebKit 26.6 × Genesis / Mega CD / Game Boy / NES / WonderSwan × Main at root / Worker at a nested path. Tests serve only the extracted artifact, with no repository fallback and no private production hooks.

The checks cover Monaco's semantic Worker, lazy CD-DA inspection, actual Shell Worker execution, relative Virtual File imports and WAV reading, finite audible PCM, Stop followed by exact-zero output, and replay. Mega CD additionally checks the individual FM/PSG/RF5C164/CD-DA contributions and independent CD-DA stereo. No page, console, HTTP or network errors occurred. The entry hash/cache URL matches its receipt; none of the 71 removed modules is requested. Physical output is muted after PCM capture; no human listening or hardware comparison was performed.

All archived payload bytes match the final stage. All non-root runtime assets and all license files match the original full distribution. Both original-source archives restore their recorded input bytes exactly. The full ZIP payload also matches the preceding v0.93.1 archive.

## Prepared artifacts and resume

- Browser upload: `release/hello_ymfm_wasm_bundle-dev_itch_playground_for_run.zip`, 888 entries, SHA256 `f7d576c77e592ec9e20d443e8e31733a11bb9f3f6636ab55c793ee6699b3d3f9`.
- Full download: `release/hello_ymfm_wasm_bundle-dev_itch_playground.zip`, 1,005 payload files, SHA256 `eeeeb379a82931acc0cb9d96c70d22a55b9bc842fb3049a406b0599478543fb2`.
- Main entry SHA256: `fd06b08e56439e3968aba1b790bf0c7354c40ee815d0ac64e1194fe311d00aa7`.
- Detailed evidence: [itch_playground_bundle_01.json](itch_playground_bundle_01.json).

Upload the `_for_run.zip` manually and select **This file will be played in the browser**. The default command uses version label `dev`; an argument changes the generated filename label. This verified candidate used `bundle-dev` to preserve the preceding known-working plain Run ZIP.

No upload, itch.io setting change, npm release, SDK change, Tauri import, commit, push or tag was performed. VGM Analyzer and Synth bundling are outside this change. A live itch.io check remains for after the manual upload; additional modes/features can use the same packaged-browser checker when changed.
