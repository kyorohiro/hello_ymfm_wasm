# Tauri signed macOS release automation

Started: 2026-11-14.

- [ ] Confirm hosted Mac with an imported signing certificate versus a local
      self-hosted runner using the existing keychain.
- [ ] Finish and test one hidden-prompt APPLE_PASSWORD bulk-registration command
      for the nine local Tauri GitHub repositories.
- [ ] Match SID deploy_mac.sh: CI=true, the supplied signing identity, Apple ID
      and team ID, both x86_64-apple-darwin and aarch64-apple-darwin,
      --bundles app,dmg and -- --locked.
- [ ] Update the applicable workflows, certificate/keychain handling and release
      artifact paths while preserving browser/Windows/Linux validation.
- [ ] Validate workflow structure and script behavior locally without uploading
      credentials, triggering workflows, or publishing releases.
- [ ] Document initial setup, password updates and the release procedure.

Current audit: nine Build Desktop workflows have unsigned macOS matrices and
only use GITHUB_TOKEN. No Apple secrets are consumed yet. Hosted GitHub Mac
runners need the signing certificate/private key in addition to Apple login;
the developer's local deploy script already finds these in the Mac keychain.

Existing root and nested-repository user changes must be preserved. Do not
commit/push/tag, upload secrets or dispatch releases without user instruction.
