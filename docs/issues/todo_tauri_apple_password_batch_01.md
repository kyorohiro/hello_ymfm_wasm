# Tauri Apple password bulk setup

Started: 2026-11-14.

- [x] Inspect current Tauri workflows and their secret references.
- [ ] Provide one CLI command to register APPLE_PASSWORD across the local
      Tetorica Tauri repositories, with a preview and one hidden password prompt.
- [ ] Keep the password out of argv, logs, files and printed errors; verify with
      local stubs without uploading an actual secret.
- [ ] Document the command and current unsigned-workflow limitation.

Audit: nine repositories under w/*-tauri. All have macOS arm64/x86_64 builds,
but only GITHUB_TOKEN is connected; no Apple certificate import/notarization
credentials are configured. APPLE_PASSWORD alone cannot enable signed builds.
Signing workflow/certificate setup is separate from this password-registration
helper. No secret is uploaded by the agent, and no workflow/release is triggered.
