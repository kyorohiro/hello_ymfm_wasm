# Web release ZIPs

## Package all products locally

Use one shared version for all 13 Synths, VGM Analyzer, and Playground:

```sh
sh scripts/package_itch_all.sh 20261114
sh scripts/package_itch_all_for_run.sh 20261114
```

| Command | Collection |
| --- | --- |
| `package_itch_all.sh VERSION` | `release/itch_all_VERSION/`: normal distribution ZIPs. |
| `package_itch_all_for_run.sh VERSION` | `release/itch_all_VERSION_for_run/`: browser upload ZIPs. |

Each collection contains 15 individual product ZIPs, `manifest.json`,
`SHA256SUMS`, and `README.txt`. Upload each product ZIP to its own itch project;
the collection directory is not an application ZIP. Every ZIP filename includes
the shared version. Game Boy and NES compatibility aliases are omitted because
they duplicate DMG and 2A03.

Every ZIP inside `itch_all_VERSION_for_run/` ends in `_for_run.zip`. For example,
DMG uses `tetorica_dmg_synth_20261114_itch.zip` for normal distribution and
`tetorica_dmg_synth_20261114_itch_for_run.zip` for browser upload.
Only Playground has different ZIP contents: its browser collection selects
`*_itch_playground_for_run.zip` instead of the complete downloadable source kit.
The other 14 ZIPs have identical bytes under different collection filenames.
Original filenames directly under `release/` and individual builder outputs
remain unchanged.

The first invocation builds the 15 products and records all 16 output ZIPs
in `release/itch_all_VERSION.json`. Running the other command with the same
version verifies those hashes and reuses the completed batch. An older browser
collection can be updated with the same version: its contents are verified,
the old directory is kept as `*.before-for-run-names`, and a replacement uses
`_for_run.zip` for all 15 products. No product rebuild is needed.
Use a new version after changing sources. A version is required: 1–80 characters, starting with a
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

It runs on tag pushes and manual **Run workflow** requests, not ordinary branch
pushes or pull requests. It packages the four ZIPs, verifies their contents and
runs bounded Chromium checks. It does not remeasure all chip levels or run the
complete browser/SDK suite. The workflow only needs read permissions.
The local automation uses the maintainer's `gh` and `butler` sessions to attach
verified Web ZIPs and publish them. [Release instructions](../README_RELEASE.md)

Tag pushes also run the short VGM and SBI checks. Detailed per-Synth, npm
package, SDK and research workflows are manual-only, so a release tag does not
start all of them together.

After pushing your changes, start just the check you need:

```sh
# Bounded release packaging and Chromium checks (10-minute job limit)
gh workflow run itch-web.yml --ref main

# Existing complete calibration and browser regression suite (expensive)
gh workflow run itch-web-full.yml --ref main

# Detailed checks for one Synth or the SDK
gh workflow run scsp-synth.yml --ref main
gh workflow run wasm-sdk.yml --ref main
```

The same choices are available from **Actions → workflow → Run workflow**.
`gh run rerun RUN_ID --failed` retries the old run's original commit; it does
not test a newly pushed fix. Use `gh workflow run ... --ref main` for that.
Detailed verification can also be run locally using the commands in each
workflow; no CI run is required during routine editing.

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
| `hello_ymfm_wasm_dev_itch_playground_for_run.zip` | Playground: browser-playable upload within itch.io limits. |
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

## What release CI checks

The release workflow runs the three unchanged package scripts. Their existing
source-freshness, module graph and generated Mixer/default guards still apply.
Stale evidence is rejected; skipping remeasurement is not a freshness waiver.

It checks every archive's CRC, paths, root `index.html`, and exact agreement with
its staging directory. The three browser-playable ZIPs must meet the hosting
limits. The full Playground download is checked separately without imposing
browser hosting limits. The Run ZIP retains its bundle/source/license checks.

Only Chromium headless shell is installed in the release path. Existing browser
checks cover Analyzer parsing/Mixer, Synth TFI import/keyboard PCM/release, and
Playground Genesis Main/Worker playback, Monaco, Shell and Stop. Physical audio
output is muted. Additional chips and WebKit remain in manual validation.

Dependency installation, packaging and browser checks have individual timeouts;
the release job has a 10-minute limit. This bounds runtime rather than promising
an exact completion time on shared runners. npm's download cache is enabled.

If a check fails, download **itch-web-validation** for diagnostics. The verified
**itch-web-release-zips** artifact is uploaded only after the checks pass.

## Full validation

**itch web full validation** (`itch-web-full.yml`) is manual-only and retains all
of the previous release workflow's test commands and assertions: core tests,
historical calibration evidence, PS1/WonderSwan/POKEY/SCSP remeasurement,
Chromium/WebKit coverage, all configured Playground modes, sample editors and
conversion checks. It may take tens of minutes; invoke it deliberately for
changes that need that coverage. Its job limit remains 60 minutes.

It retains **itch-web-full-release-zips** after success and
**itch-web-full-validation** diagnostics, with the same retention periods.
The full validation is not a prerequisite secretly started by lightweight
packaging. Per-Synth and SDK workflows can be selected separately.
