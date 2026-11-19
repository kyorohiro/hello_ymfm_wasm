# SCSP Linux WebKit song-select overflow

Run `44542191810` still fails the strict 390px layout check with 15px root
overflow. Closed-help paragraphs no longer appear in the overflow diagnostics;
the remaining overflowing subtree is `.scsp-song-transport` (318px client,
369px scroll) even though every element border stays within the viewport.

- [x] Bound native song-select overflow with a dedicated wrapper, without
  hiding whole-page overflow or clipping expanded help.
- [x] Verify mobile long song names, help open/close, desktop layout and the
  existing real-core browser suite with physical output muted.
- [x] Preserve immutable historical source inputs and check current generation.
- [ ] Record local evidence and leave Linux CI verification explicit.

No audio core, gains, test tolerance, tag or remote test run changes are planned.

Local evidence:

- Source browser suite: `/private/tmp/scsp-select-browser.json`, Chromium and
  WebKit pass with `mobileOverflow: 0`, no page errors or missing assets.
- Final packaged browser suite: `/private/tmp/scsp-select-packaged-browser.json`,
  both engines pass with the long-option and help assertions and zero overflow.
- `sh scripts/package_itch_scsp_synth.sh linux-select-fix` succeeds: 389 files,
  four bundles. ZIP: `release/tetorica_scsp_synth_linux-select-fix_itch.zip`,
  SHA-256 `1f66c76a96322307454074800c999a294eb29f08338f01e3c532b4f810ed6c3a`.
- Nine historical-source/revision tests pass; both strict Mixer/default
  generators pass. The original HTML is archived from commit `4e77c0cc` for
  historical tests only; production freshness rules and measurements are intact.
- The native select keeps its keyboard focus outline inside its clipping box.
  Clipping is limited to that control; buttons and expanded help stay visible.

Linux WebKit could not be run locally (Docker engine unavailable); the fix still
needs verification on Linux after commit/push. The prior failure's diagnostics
point to the transport subtree; this change targets its native select rather
than claiming the local macOS result proves Linux success.

After pushing, run only this workflow, without creating a tag:

```sh
gh workflow run scsp-synth.yml --ref main
```

No commit, push, tag or remote execution was performed here.
