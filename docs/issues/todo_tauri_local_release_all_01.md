# Local Tauri batch release

## Current priority: version option in each app's existing importer

User correction: extend `npm run import:release` inside each of the nine
Tauri repositories. Accept `ZIP --version X.Y.Z` and update the app metadata
and both lockfiles during a successful import. The parent batch script is
not the interface requested for this operation.

- [x] Add a standalone sibling metadata helper in all nine app repositories.
- [x] Add optional --version to each existing importer, preserving legacy
      ZIP-only behavior and keeping Web provenance separate from app version.
- [x] Validate metadata before changing dist; retain all original files when
      version/metadata/ZIP validation fails. Restore import on update failure.
- [x] Add temporary fixture coverage and document per-repository commands.
- [x] Run existing Python import tests without modifying actual app versions,
      dist, lockfiles, user edits, Git index, tags or releases.

Verification: all nine Python suites passed (307 tests total), and all nine
`npm run import:release -- --help` commands advertise --version. Actual app
metadata/dist/release locks remain unchanged. See
verification_tauri_import_version_20261114.md.

## Earlier optional batch tooling

Started: 2026-11-14. Signing certificates/private keys stay on the local Mac.
Tests use temporary fixture repositories. The real nine apps have not been
imported, versioned, built, committed or tagged by this work.

Current implementation scope: a local tool that accepts the app VERSION at
execution time, imports an independently specified normal Web collection,
updates all five metadata/lock files, builds with each existing deploy_mac.sh,
and creates final local commits/tags only in a separate explicit stage.
VERSION sets the Tauri app versions. It must not select same-version Web ZIPs.
The Web collection version and Tauri app version may differ. Use the full,
editable Playground ZIP, not _for_run. Do not ask for an actual release version
while implementing the tool. No push or publication is performed by this tool.

- [x] Add scripts/release_tauri_all.sh with --plan, --prepare and --commit.
- [x] Preflight all nine repositories, imported-asset local edits, current
      versions, tags and required local tools before replacing any dist.
      Preserve existing user work; import_release.py replaces dist and removes
      local-changes.json. DMG and S-DSP currently contain uncommitted changes.
- [x] Select ZIPs from an independent --web-dir collection manifest and check
      their hashes; update all five metadata/lock files without dependency
      upgrades. Run npm ci/npm test, import --check and cargo test --locked.
      Prepare/check Playground's matching host sidecar before Cargo tests.
- [x] Use existing local deploy_mac.sh behavior for Intel/Apple Silicon,
      app+dmg, locked dependencies, local keychain and notarization. Read the
      app-specific password once, without writing it to files/logs/argv.
- [x] Verify app versions, code signatures, stapled tickets and architectures;
      collect fresh DMGs and app ZIPs with hashes/logs/progress records.
- [x] Verify complete builds and unchanged inputs/artifacts/HEAD before final
      local commits and annotated tags. Support recorded partial commit/tag
      retry, including a failed commit after staging verified paths.
- [x] Add focused fixture tests for version independence, preflight, secret
      isolation, build failure, lock drift, artifact collection and retry.
      Document commands/failure recovery in README_RELEASE.md.
- [ ] User-run first complete signed batch build after resolving existing
      local changes. The read-only plan correctly stops on DMG/S-DSP edits.
- [ ] Optional resumable prepare stage. The initial implementation retains
      failed state/working files and refuses automatic replacement/recovery.
- [ ] On explicit release stage, create/push the reviewed commits/tags, attach
      local Mac artifacts to GitHub draft releases, and await Windows/Linux
      Actions artifacts. Keep final publication separate.
- [ ] Add an explicit publish stage to publish the verified draft releases
      together after all required platforms and recorded artifacts pass.
- [ ] Prevent tag Actions from uploading unsigned Mac assets over the locally
      signed assets. Existing tauri-action can replace same-name assets.
- [x] Map the independently chosen Web collection to the common app VERSION
      in a local manifest. Skip SCSP because no local Tauri repo exists.

Implemented CLI (VERSION is the app version supplied at execution):

```sh
sh scripts/release_tauri_all.sh --plan VERSION --web-dir /path/to/itch_all_WEB_BUILD
sh scripts/release_tauri_all.sh --prepare VERSION --web-dir /path/to/itch_all_WEB_BUILD
sh scripts/release_tauri_all.sh --commit VERSION
```

This approach needs no APPLE_PASSWORD or signing certificate in GitHub Secrets:
only compiled signed Mac release files are uploaded. Windows/Linux remain on
GitHub-hosted runners. The local keychain/certificate setup stays in place.
