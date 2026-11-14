# Local Tauri release orchestration proposal

Proposed: 2026-11-14. User requires signing certificates and private keys to
remain on the local Mac. No secret upload, commit/tag/push, release upload or
publication is performed by this proposal.

- [ ] Add a local batch command with prepare/build and explicit draft-release
      stages. Reuse the normal Web batch collection, including the expanded
      Playground ZIP, for editable Tauri assets.
- [ ] Preflight all nine repositories, imported-asset local edits, current
      versions, tags and required local tools before replacing any dist.
      Preserve existing user work; import_release.py replaces dist and removes
      local-changes.json. DMG and S-DSP currently contain uncommitted changes.
- [ ] Import each matching Web ZIP, check its lock, update each app's version
      consistently and run the repository's required validation.
- [ ] Use existing local deploy_mac.sh behavior for Intel/Apple Silicon,
      app+dmg, locked dependencies, local keychain and notarization. Read the
      app-specific password once, without writing it to files/logs/argv.
- [ ] Verify signed/notarized artifacts, archive app bundles preserving their
      structure, collect per-product checksums, logs and resumable progress.
- [ ] On explicit release stage, create/push the reviewed commits/tags, attach
      local Mac artifacts to GitHub draft releases, and await Windows/Linux
      Actions artifacts. Keep final publication separate.
- [ ] Add an explicit publish stage to publish the verified draft releases
      together after all required platforms and recorded artifacts pass.
- [ ] Prevent tag Actions from uploading unsigned Mac assets over the locally
      signed assets. Existing tauri-action can replace same-name assets.
- [ ] Map one common Web/build ID to each application's own SemVer/tag in a
      release manifest; current app versions differ. Skip SCSP because no
      local Tauri repository exists for it.
- [ ] Add focused orchestration/failure/retry tests and document commands.

Suggested CLI (not implemented yet):
sh scripts/release_tauri_all.sh --prepare BUILD_ID
sh scripts/release_tauri_all.sh --release BUILD_ID
sh scripts/release_tauri_all.sh --publish BUILD_ID

This approach needs no APPLE_PASSWORD or signing certificate in GitHub Secrets:
only compiled signed Mac release files are uploaded. Windows/Linux remain on
GitHub-hosted runners. The local keychain/certificate setup stays in place.
