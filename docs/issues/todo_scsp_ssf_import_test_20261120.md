# SCSP SSF browser test: wait for folder import completion

Run `44548948779` passed the previous narrow-layout check, then failed in the
WebKit SSF browser test's initial folder import. The test requested
`00-standalone.ssf`, but the completed import subsequently selected
`20-unknown.ssf`; no page errors or audio contexts were recorded.

The song options appear at Files commit, before local persistence and the
import handler's automatic song selection finish. Seeing three options does
not mean the folder import has completed.

- [x] Wait for Files to be idle and the initial imported song to be loaded
  before starting the test's explicit song selection.
- [x] Keep actual SSF playback, library paths, native measurements, error
  handling and muted-output assertions unchanged.
- [x] Run the affected browser check locally and record evidence.

No runtime/audio changes, timeout increases, remote CI or publication planned.

## Evidence

- The previous layout check passed on Linux in this run, with zero mobile
  overflow in Chromium and WebKit. Code and VGM-song checks also passed before
  this later SSF failure.
- `importFolder()` now waits for Files `aria-busy=false`, an enabled Play button,
  and a matching public loaded-song status before returning. All original
  song/path, playback, native PCM and dependency assertions are retained.
- Local complete SSF checker passes ten checks per engine in Chromium/WebKit:
  `/private/tmp/scsp-ssf-import-browser.json`.
- Additional WebKit stress check passes the same ten checks while the temporary
  test server delays import persistence completion by 500ms:
  `/private/tmp/scsp-ssf-slow-import.json`. Injection exists only in
  `/private/tmp/scsp-ssf-slow-import.cjs`; application files were not changed.
- Physical output is muted; `git diff --check` passes.

No commit, push or remote rerun was performed. After pushing, run the latest
source explicitly rather than retrying the original failing commit:

```sh
gh workflow run scsp-synth.yml --ref main --repo kyorohiro/hello_ymfm_wasm
```
