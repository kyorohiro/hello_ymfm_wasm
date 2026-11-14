# Web release ZIPs

## Package all products locally

Use one shared version for all eight Synths, VGM Analyzer, and Playground:

```sh
sh scripts/package_itch_all.sh 20261114
sh scripts/package_itch_all_for_run.sh 20261114
```

| Command | Collection |
| --- | --- |
| `package_itch_all.sh VERSION` | `release/itch_all_VERSION/`: normal distribution ZIPs. |
| `package_itch_all_for_run.sh VERSION` | `release/itch_all_VERSION_for_run/`: browser upload ZIPs. |

Each collection contains ten individual product ZIPs, `manifest.json`,
`SHA256SUMS`, and `README.txt`. Upload each product ZIP to its own itch project;
the collection directory is not an application ZIP. Every ZIP filename includes
the shared version. Game Boy and NES compatibility aliases are omitted because
they duplicate DMG and 2A03.

Only Playground differs between the collections: normal distribution selects
the complete downloadable source kit, while browser upload selects
`*_itch_playground_for_run.zip`. The other nine ZIPs have identical bytes in both
collections.

The first invocation builds the ten products and records all eleven output ZIPs
in `release/itch_all_VERSION.json`. Running the other command with the same
version verifies those hashes and reuses the completed batch. Use a new version
after changing sources. A version is required: 1–80 characters, starting with a
letter or number, followed by letters, numbers, `.`, `_`, `+`, or `-`.
These commands can also be invoked by absolute path from another working
directory.

Without a completed batch record, existing same-version ZIPs or output paths
stop the batch before any product command runs. A failed child command reports
the product and its log under `release/itch_all_VERSION_logs/`; completed files
remain available for inspection, and no success record is written. Inspect the
specific outputs or start with a new version. A per-version lock prevents two
batches from writing the same version concurrently; if an interrupted process
left a lock, inspect the path reported in the error and the running processes.
The standalone product scripts retain their existing overwrite behavior.

## GitHub Actions artifacts

The `itch web release ZIPs` GitHub Actions workflow builds the same artifacts as
the local release commands:

```sh
sh scripts/package_itch_synth.sh
sh scripts/package_itch_vgm_analyzer.sh
sh scripts/package_itch_playground.sh
```

It runs on pushes, pull requests, and manual **Run workflow** requests. No tag or
publishing credentials are required. GitHub Release attachments and itch.io
uploads remain manual.

## Download the verified artifacts

1. Open **Actions → itch web release ZIPs** and select the successful run for the
   intended commit.
2. Download the **itch-web-release-zips** artifact. Artifacts are retained for
   14 days, so attach the files to a GitHub Release for permanent distribution.
3. Extract the downloaded Actions artifact to obtain the four individual ZIPs,
   `SHA256SUMS`, and `itch-web-release.json`.
4. Attach the individual ZIPs and checksum file to the GitHub Release. Upload
   the appropriate individual ZIP to itch.io using the table below.

| ZIP | Purpose |
| --- | --- |
| `hello_ymfm_wasm_dev_itch_synth.zip` | Synth: browser-playable upload. |
| `hello_ymfm_wasm_dev_itch_vgm_analyzer.zip` | VGM Analyzer: browser-playable upload. |
| `hello_ymfm_wasm_dev_itch_playground_for_run.zip` | Playground: browser-playable upload, with bundled and minified UI. |
| `hello_ymfm_wasm_dev_itch_playground.zip` | Playground: full download with expanded sources. Its entry count can exceed itch.io's browser hosting limit. |

The outer Actions artifact is a container for these files. Upload the individual
application ZIPs to itch.io. The default `dev` filenames match the three commands
above; the manifest identifies the source commit and each archive's SHA-256.

To verify the downloaded files, run from their extracted directory:

```sh
# macOS
shasum -a 256 -c SHA256SUMS

# Linux
sha256sum -c SHA256SUMS
```

## What CI checks

The workflow tests Run ZIP preparation and bundling, then runs the three package
scripts. It checks every archive's CRC, paths, root `index.html`, and exact
agreement with its staging directory. The three browser-playable ZIPs must meet
the hosting limits, including the 1,000-entry limit. The full Playground download
is checked separately without imposing browser hosting limits.

For the Playground Run ZIP, it also verifies the bundle receipt, cache URL,
preserved runtime assets, licenses, and byte-exact source archives against the
full distribution. Packaging uses the checked-in audio/WASM artifacts.

Chromium and WebKit checks cover the packaged Analyzer, Synth TFI import and
keyboard playback, and Playground Main/Worker playback in five modes. Audio is
captured for validation while physical output is muted. The Playground check
serves only the extracted Run ZIP; the Synth check serves only its extracted ZIP.
The Analyzer check serves the stage whose bytes were matched to its ZIP.
Game Boy Sample Editor checks also cover converted wave comparisons, actual chip
preview, editing and cancellation, saved Keyboard instruments, and the minified
Run ZIP's public editor UI.

If a check fails, open its failed step and download **itch-web-validation** for
logs, browser reports, and screenshots. Diagnostics are retained for seven days.
The verified release artifact is uploaded only after all checks pass.
