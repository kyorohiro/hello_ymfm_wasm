# itch.io Playground browser ZIP entry limit

2026-10-28. The user reported that itch.io could not create the Run button for `hello_ymfm_wasm_dev_itch_playground_v0.93.1.zip`, then supplied the exact error: `Too many files in zip (1115 > 1000)`.

The original ZIP has 1,005 files and 110 directory records. itch.io counts all 1,115 entries. The prior dependency checks verified imports but did not enforce this hosting limit. [Official HTML ZIP requirements](https://itch.io/docs/creators/html5#zip-file-requirements) describe the 1,000-file limit, expanded sizes and path limits.

Both Chromium and WebKit start the exact original ZIP normally when served at the root and a nested path. No startup exception or failed resource request occurs. This was a hosting/archive limit, with a direct matching error, rather than a reproduced application startup fault.

## Packaging change

`sh scripts/package_itch_playground.sh` now creates two distributions:

- `release/hello_ymfm_wasm_dev_itch_playground.zip`: complete downloadable layout with expanded sources, preserving the existing format used by Tauri import.
- `release/hello_ymfm_wasm_dev_itch_playground_for_run.zip`: **the file to mark browser-playable on itch.io**. It contains 957 entries, all files, with no directory records.

The browser ZIP retains all 914 non-source assets byte-for-byte, including JS, WASM, samples, examples, declarations and licenses. It also keeps source guides, notices, provenance and receipts accessible. Only 50 C/C++/header/shell compilation files move out of the expanded browser layout.

All 91 original corresponding-source files remain, byte-for-byte, inside `sources/corresponding-source.zip`. Its root preserves the source/build paths. Browser-facing source guides gain a relative download link and extraction instruction; their original versions remain inside the source ZIP. Extract the inner ZIP into a new directory before following its build instructions. The complete downloadable distribution also keeps the original expanded source layout.

The new helper verifies source completeness and unchanged runtime assets. The shell uses `zip -D` for the browser ZIP, then checks the actual central-directory entries, including directory records, against 1,000. It also checks root `index.html`, expanded sizes, path lengths and invalid/duplicate/symlink paths. The original archive is a negative control and produces the exact `1115 > 1000` rejection.

## Validation and state

- Six meaningful helper tests pass, including real ZIP 1,000/1,001-entry boundaries and directory records, complete source extraction, unchanged licenses/runtime/receipts, guide links and destination protection.
- The exact browser ZIP passes CRC and all staging-byte comparisons. All 914 non-source files match the original; all 91 inner-source files restore the originals exactly. The full download payload also matches the original ZIP.
- Chromium 153 / WebKit 26.6 × root / nested path: all four browser-ZIP startup cases pass. Monaco is ready, Run is enabled, 26 modes are present, no page/console/network error, and no AudioContext is created during startup. These are startup checks, without audio playback.

Browser ZIP SHA256: `8d76fef18c9247dcbb98c566d860cec13d6e1e500a7e3e44e779abfb446e5cf2` (36,843,597 bytes).

Evidence: [itch_playground_file_limit_01.json](itch_playground_file_limit_01.json). The initial browser test approval was rejected accidentally; the user corrected that rejection, and the same request was retried normally and passed.

No upload, itch.io setting change, Tauri import, npm release, commit or tag was performed. Upload the `_for_run.zip` manually and select **This file will be played in the browser**. The ZIP without `_for_run` is for downloading, not browser execution.

## Next packaging improvement

The user suggested minimizing the Run build. Bundling JS would reduce file count further; minification would reduce size. This task does not bundle or minify application code. A subsequent Run-only bundle should preserve Worker / AudioWorklet entry points and WASM asset URLs and verify both Main and Worker playback before adoption.
